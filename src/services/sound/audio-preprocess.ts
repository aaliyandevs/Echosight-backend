import { DecodedAudio } from "./types";

type WavChannels = {
  channels: Float32Array[];
  sampleRate: number;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const readPcmSample = (
  buffer: Buffer,
  offset: number,
  bitsPerSample: number
): number => {
  if (bitsPerSample === 16) {
    return clamp(buffer.readInt16LE(offset) / 32768, -1, 1);
  }
  if (bitsPerSample === 32) {
    return clamp(buffer.readInt32LE(offset) / 2147483648, -1, 1);
  }
  throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
};

const decodeWavBuffer = (buffer: Buffer): WavChannels => {
  if (buffer.length < 44) {
    throw new Error("Audio payload is too small to be a valid WAV file.");
  }

  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Only WAV audio is supported. Please send PCM WAV.");
  }

  let offset = 12;
  let audioFormat = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = buffer.readUInt16LE(chunkDataOffset);
      channelCount = buffer.readUInt16LE(chunkDataOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1) {
    throw new Error("Only PCM WAV audio is supported for detection.");
  }
  if (channelCount < 1 || channelCount > 2) {
    throw new Error("Only mono or stereo WAV audio is supported.");
  }
  if (sampleRate <= 0 || bitsPerSample <= 0) {
    throw new Error("WAV audio metadata is invalid.");
  }
  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error("WAV file has no audio data.");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channelCount;
  const sampleCount = Math.floor(dataSize / frameSize);

  const channels = Array.from(
    { length: channelCount },
    () => new Float32Array(sampleCount)
  );

  for (let i = 0; i < sampleCount; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const sampleOffset = dataOffset + i * frameSize + c * bytesPerSample;
      channels[c][i] = readPcmSample(buffer, sampleOffset, bitsPerSample);
    }
  }

  return {
    channels,
    sampleRate,
  };
};

const resampleLinear = (
  source: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array => {
  if (sourceRate === targetRate) {
    return source;
  }

  const ratio = targetRate / sourceRate;
  const targetLength = Math.max(1, Math.round(source.length * ratio));
  const result = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i += 1) {
    const sourcePos = i / ratio;
    const left = Math.floor(sourcePos);
    const right = Math.min(source.length - 1, left + 1);
    const frac = sourcePos - left;
    result[i] = source[left] * (1 - frac) + source[right] * frac;
  }

  return result;
};

const mixToMono = (channels: Float32Array[]): Float32Array => {
  if (channels.length === 1) {
    return channels[0];
  }
  const length = channels[0].length;
  const result = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    result[i] = (channels[0][i] + channels[1][i]) / 2;
  }
  return result;
};

export const decodeAndPreprocessAudio = (
  audioBuffer: Buffer,
  targetSampleRate = 16_000
): DecodedAudio => {
  const decoded = decodeWavBuffer(audioBuffer);
  const [leftRaw, rightRaw] = decoded.channels;

  const left =
    decoded.channels.length > 1
      ? resampleLinear(leftRaw, decoded.sampleRate, targetSampleRate)
      : null;
  const right =
    decoded.channels.length > 1
      ? resampleLinear(rightRaw, decoded.sampleRate, targetSampleRate)
      : null;

  const monoRaw = mixToMono(decoded.channels);
  const mono = resampleLinear(monoRaw, decoded.sampleRate, targetSampleRate);

  return {
    mono,
    left,
    right,
    sampleRate: targetSampleRate,
    channels: decoded.channels.length,
  };
};

export const calculateRms = (samples: Float32Array): number => {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
};

export const calculateZeroCrossingRate = (samples: Float32Array): number => {
  if (samples.length < 2) {
    return 0;
  }
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const current = samples[i];
    if ((prev >= 0 && current < 0) || (prev < 0 && current >= 0)) {
      crossings += 1;
    }
  }
  return crossings / (samples.length - 1);
};

