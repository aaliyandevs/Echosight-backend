export type SoundCategory =
  | "Speech Sounds"
  | "Non-Speech Sounds"
  | "Background / Ambient Sounds";

export type DirectionLabel = "Left" | "Right" | "Front" | "Back";

export type DistanceLabel = "5m" | "10-15m" | "20m+";

export type DetectSoundInput = {
  userId: string;
  audioBuffer: Buffer;
  mimeType?: string;
  speechHint?: string;
};

export type DetectSoundResult = {
  label: string;
  category: SoundCategory;
  confidence: number;
  direction: DirectionLabel;
  distance: DistanceLabel;
  isUserNameDetected: boolean;
  alert?: string;
  alertCode?: "EMERGENCY" | "HIGH" | "MEDIUM";
  alertPriority?: "emergency" | "high" | "medium";
  shouldAlert: boolean;
  model?: "heuristic" | "yamnet";
  topPredictions?: Array<{
    label: string;
    confidence: number;
  }>;
};

export type ClassifiedSound = {
  label: string;
  category: SoundCategory;
  confidence: number;
  model?: "heuristic" | "yamnet";
  topPredictions?: Array<{
    label: string;
    confidence: number;
  }>;
};

export type DecodedAudio = {
  mono: Float32Array;
  left: Float32Array | null;
  right: Float32Array | null;
  sampleRate: number;
  channels: number;
};
