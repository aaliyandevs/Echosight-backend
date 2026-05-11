import { exec } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { env } from "../../config";

const normalizeWhitespace = (text: string): string => {
  return text.replace(/\s+/g, " ").trim();
};

const encodeWavMono16 = (
  samples: Float32Array,
  sampleRate: number
): Buffer => {
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, 4, "ascii");
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 32768 : clamped * 32767;
    buffer.writeInt16LE(int16, offset);
    offset += 2;
  }

  return buffer;
};

const executeCommand = (command: string): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: env.STT_EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        stdout,
        stderr,
      });
    });
  });
};

class SpeechToTextService {
  async warmup(): Promise<void> {
    if (env.STT_MODE !== "whisper_cpp" || !env.WHISPER_CPP_COMMAND) {
      return;
    }
    // Warm start command process and IO path with tiny silent clip.
    await this.whisperCppTranscribe(new Float32Array(1_600), 16_000);
  }

  private mockTranscribe(samples: Float32Array, speechHint?: string): string {
    if (speechHint && speechHint.trim().length > 0) {
      return normalizeWhitespace(speechHint);
    }
    if (samples.length > 12_000) {
      return "hello there";
    }
    return "";
  }

  private async whisperCppTranscribe(
    samples: Float32Array,
    sampleRate: number
  ): Promise<string | null> {
    if (!env.WHISPER_CPP_COMMAND) {
      return null;
    }

    const folder = mkdtempSync(join(tmpdir(), "echosight-whisper-"));
    const inputPath = join(folder, "input.wav");
    const outputPath = join(folder, "output.txt");

    try {
      const wavData = encodeWavMono16(samples, sampleRate);
      writeFileSync(inputPath, wavData);

      const command = env.WHISPER_CPP_COMMAND
        .replaceAll("{input}", `"${inputPath}"`)
        .replaceAll("{output}", `"${outputPath}"`);

      const result = await executeCommand(command);
      let transcript = result.stdout;

      try {
        const outputText = readFileSync(outputPath, "utf-8");
        if (outputText.trim().length > 0) {
          transcript = outputText;
        }
      } catch {
        // output file is optional depending on whisper command flags
      }

      return normalizeWhitespace(transcript);
    } catch {
      return null;
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  async transcribe(
    samples: Float32Array,
    sampleRate: number,
    speechHint?: string
  ): Promise<string> {
    if (env.STT_MODE === "disabled") {
      return "";
    }

    if (env.STT_MODE === "mock") {
      return this.mockTranscribe(samples, speechHint);
    }

    const whisperResult = await this.whisperCppTranscribe(samples, sampleRate);
    return whisperResult ?? "";
  }
}

export const speechToTextService = new SpeechToTextService();
