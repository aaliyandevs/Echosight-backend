import { existsSync, readFileSync } from "fs";
import path from "path";
import { env } from "../../config";
import {
  calculateRms,
  calculateZeroCrossingRate,
} from "./audio-preprocess";
import { ClassifiedSound, SoundCategory } from "./types";

type TfRuntime = {
  tensor1d: (data: Float32Array) => unknown;
  dispose: (tensor: unknown) => void;
  loadGraphModel: (
    url: string,
    options?: Record<string, unknown>
  ) => Promise<YAMNetModel>;
};

type YAMNetModel = {
  predict: (input: unknown) => unknown;
};

type TensorLike = {
  shape?: number[];
  data: () => Promise<Float32Array | Int32Array | Uint8Array>;
  mean?: (axis: number) => TensorLike;
};

const YAMNET_SAMPLE_RATE = 16_000;
const YAMNET_MIN_SAMPLE_COUNT = 15_600;

const SPEECH_KEYWORDS = [
  "speech",
  "talk",
  "shout",
  "laugh",
  "conversation",
  "announcement",
  "name",
  "voice",
];

const NON_SPEECH_KEYWORDS = [
  "siren",
  "horn",
  "footstep",
  "door",
  "construction",
  "engine",
  "alarm",
  "object",
  "fall",
  "drill",
];

const CATEGORY_NAMES = {
  speech: "Speech Sounds" as SoundCategory,
  nonSpeech: "Non-Speech Sounds" as SoundCategory,
  ambient: "Background / Ambient Sounds" as SoundCategory,
};

const mapLabelToCategory = (label: string): SoundCategory => {
  const normalized = label.toLowerCase();
  if (SPEECH_KEYWORDS.some((item) => normalized.includes(item))) {
    return CATEGORY_NAMES.speech;
  }
  if (NON_SPEECH_KEYWORDS.some((item) => normalized.includes(item))) {
    return CATEGORY_NAMES.nonSpeech;
  }
  return CATEGORY_NAMES.ambient;
};

const scoreFromNormalized = (value: number): number => {
  return Number(Math.max(0.01, Math.min(0.99, value)).toFixed(2));
};

const heuristicClassify = (samples: Float32Array): ClassifiedSound => {
  const rms = calculateRms(samples);
  const zcr = calculateZeroCrossingRate(samples);

  if (rms > 0.16 && zcr < 0.08) {
    return {
      label: "Siren",
      category: CATEGORY_NAMES.nonSpeech,
      confidence: scoreFromNormalized(0.82 + Math.min(0.12, rms)),
      model: "heuristic",
    };
  }

  if (rms > 0.035 && zcr > 0.075 && zcr < 0.22) {
    return {
      label: "Speech",
      category: CATEGORY_NAMES.speech,
      confidence: scoreFromNormalized(0.7 + Math.min(0.2, zcr)),
      model: "heuristic",
    };
  }

  if (rms > 0.09) {
    return {
      label: "Traffic Noise",
      category: CATEGORY_NAMES.ambient,
      confidence: scoreFromNormalized(0.66 + Math.min(0.2, rms)),
      model: "heuristic",
    };
  }

  return {
    label: "Ambient Noise",
    category: CATEGORY_NAMES.ambient,
    confidence: 0.64,
    model: "heuristic",
  };
};

export const parseYamnetClassMap = (filePath: string): string[] => {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!existsSync(resolvedPath)) {
    return [];
  }
  const raw = readFileSync(resolvedPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const labels: string[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length >= 3) {
      labels.push(parts.slice(2).join(","));
    } else if (parts.length >= 2) {
      labels.push(parts[1]);
    }
  }

  return labels;
};

const parseCsvLine = (line: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"" && next === "\"") {
      current += "\"";
      i += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
};

const asTensorArray = (value: unknown): TensorLike[] => {
  if (Array.isArray(value)) {
    return value as TensorLike[];
  }
  if (value && typeof value === "object" && !("data" in value)) {
    return Object.values(value as Record<string, TensorLike>);
  }
  return [value as TensorLike];
};

const findScoresTensor = (value: unknown): TensorLike | null => {
  const tensors = asTensorArray(value);
  return (
    tensors.find((tensor) => {
      const shape = tensor?.shape ?? [];
      return shape.length >= 1 && shape[shape.length - 1] === 521;
    }) ?? null
  );
};

export const prepareYamnetWaveform = (samples: Float32Array): Float32Array => {
  if (samples.length >= YAMNET_MIN_SAMPLE_COUNT) {
    return samples;
  }

  const padded = new Float32Array(YAMNET_MIN_SAMPLE_COUNT);
  padded.set(samples);
  return padded;
};

const topK = (
  scores: number[],
  labels: string[],
  limit: number
): Array<{ label: string; confidence: number }> => {
  return scores
    .map((confidence, index) => ({
      label: labels[index] ?? `Class-${index}`,
      confidence: scoreFromNormalized(confidence),
    }))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit);
};

class SoundClassifier {
  private tf: TfRuntime | null = null;
  private model: YAMNetModel | null = null;
  private labels: string[] = [];
  private loadingPromise: Promise<void> | null = null;

  private async loadYamnet(): Promise<void> {
    if (this.model || env.SOUND_CLASSIFIER_MODE !== "yamnet") {
      return;
    }
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = (async () => {
      try {
        const dynamicImport = new Function(
          "name",
          "return import(name)"
        ) as (name: string) => Promise<any>;
        const tfModule = await dynamicImport("@tensorflow/tfjs");
        this.tf = tfModule;
        this.model = (await tfModule.loadGraphModel(env.YAMNET_MODEL_URL, {
          fromTFHub: true,
        })) as YAMNetModel;

        this.labels = parseYamnetClassMap(env.YAMNET_CLASS_MAP_PATH);
        if (this.labels.length !== 521) {
          console.warn(
            `YAMNet class map expected 521 labels, loaded ${this.labels.length}.`
          );
        }
      } catch (error) {
        console.warn(
          `YAMNet failed to load; falling back to heuristic classifier: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
        this.model = null;
        this.tf = null;
      }
    })();

    await this.loadingPromise;
  }

  async warmup(): Promise<void> {
    await this.loadYamnet();
  }

  private async yamnetClassify(samples: Float32Array): Promise<ClassifiedSound> {
    if (!this.tf || !this.model) {
      return heuristicClassify(samples);
    }

    const waveform = prepareYamnetWaveform(samples);
    const input = this.tf.tensor1d(waveform);
    let predicted: any = null;
    let pooledScores: any = null;

    try {
      predicted = this.model.predict(input);
      const scores = findScoresTensor(predicted);
      if (!scores) {
        throw new Error("YAMNet scores tensor was not found in model output.");
      }

      pooledScores =
        scores.shape && scores.shape.length > 1 && typeof scores.mean === "function"
          ? scores.mean(0)
          : scores;

      const scoreArray = Array.from(
        (await pooledScores.data()) as Iterable<number>
      ) as number[];
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let i = 0; i < scoreArray.length; i += 1) {
        const candidate = Number(scoreArray[i]);
        if (candidate > bestScore) {
          bestScore = candidate;
          bestIndex = i;
        }
      }

      const label = this.labels[bestIndex] ?? `Class-${bestIndex}`;
      return {
        label,
        category: mapLabelToCategory(label),
        confidence: scoreFromNormalized(bestScore),
        model: "yamnet",
        topPredictions: topK(scoreArray, this.labels, env.YAMNET_TOP_K),
      };
    } catch (error) {
      console.warn(
        `YAMNet inference failed; falling back to heuristic classifier: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      return heuristicClassify(samples);
    } finally {
      this.tf.dispose(input);
      if (predicted) {
        this.tf.dispose(predicted);
      }
      if (pooledScores) {
        this.tf.dispose(pooledScores);
      }
    }
  }

  async classify(samples: Float32Array): Promise<ClassifiedSound> {
    if (env.SOUND_CLASSIFIER_MODE !== "yamnet") {
      return heuristicClassify(samples);
    }

    await this.loadYamnet();
    return this.yamnetClassify(samples);
  }
}

export const soundClassifier = new SoundClassifier();
