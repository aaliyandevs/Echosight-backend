import { calculateRms } from "./audio-preprocess";
import { DecodedAudio, DirectionLabel, DistanceLabel } from "./types";

const energy = (samples: Float32Array | null): number => {
  if (!samples) {
    return 0;
  }
  return calculateRms(samples);
};

export const estimateDirection = (audio: DecodedAudio): DirectionLabel => {
  if (!audio.left || !audio.right) {
    return "Front";
  }

  const leftEnergy = energy(audio.left);
  const rightEnergy = energy(audio.right);
  const ratio = leftEnergy / Math.max(0.0001, rightEnergy);

  if (ratio > 1.2) {
    return "Left";
  }
  if (ratio < 0.83) {
    return "Right";
  }
  return "Front";
};

export const estimateDistance = (audio: DecodedAudio): DistanceLabel => {
  const rms = calculateRms(audio.mono);
  if (rms >= 0.2) {
    return "5m";
  }
  if (rms >= 0.08) {
    return "10-15m";
  }
  return "20m+";
};

