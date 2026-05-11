import { existsSync, readFileSync } from "fs";
import { env } from "../../config";
import {
  calculateRms,
  calculateZeroCrossingRate,
} from "./audio-preprocess";
import { ClassifiedSound, SoundCategory } from "./types";

type TfRuntime = {
  tensor1d: (data: Float32Array) => unknown;
  dispose: (tensor: unknown) => void;
};

type YAMNetModel = {
  predict: (input: unknown) => unknown;
};

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
    };
  }

  if (rms > 0.035 && zcr > 0.075 && zcr < 0.22) {
    return {
      label: "Speech",
      category: CATEGORY_NAMES.speech,
      confidence: scoreFromNormalized(0.7 + Math.min(0.2, zcr)),
    };
  }

  if (rms > 0.09) {
    return {
      label: "Traffic Noise",
      category: CATEGORY_NAMES.ambient,
      confidence: scoreFromNormalized(0.66 + Math.min(0.2, rms)),
    };
  }

  return {
    label: "Ambient Noise",
    category: CATEGORY_NAMES.ambient,
    confidence: 0.64,
  };
};

const parseYamnetClassMap = (filePath: string): string[] => {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const labels: string[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    if (parts.length >= 3) {
      labels.push(parts.slice(2).join(",").replace(/^"|"$/g, ""));
    } else if (parts.length >= 2) {
      labels.push(parts[1].replace(/^"|"$/g, ""));
    }
  }

  return labels;
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
        const tfModule = await dynamicImport("@tensorflow/tfjs-node");
        this.tf = tfModule;
        this.model = (await tfModule.loadGraphModel(env.YAMNET_MODEL_URL, {
          fromTFHub: true,
        })) as YAMNetModel;

        if (env.YAMNET_CLASS_MAP_PATH) {
          this.labels = parseYamnetClassMap(env.YAMNET_CLASS_MAP_PATH);
        }
      } catch {
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

    const input = this.tf.tensor1d(samples);
    let predicted: any = null;
    let pooledScores: any = null;

    try {
      predicted = this.model.predict(input);
      const scores = Array.isArray(predicted) ? predicted[0] : predicted;
      pooledScores = typeof scores.mean === "function" ? scores.mean(0) : scores;

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
      };
    } catch {
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
