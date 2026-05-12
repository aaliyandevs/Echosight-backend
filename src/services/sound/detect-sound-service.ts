import { getDb } from "../../db/mongo";
import { env } from "../../config";
import { calculateRms, decodeAndPreprocessAudio } from "./audio-preprocess";
import { isNameInTranscript } from "./name-matcher";
import { soundClassifier } from "./sound-classifier";
import { estimateDirection, estimateDistance } from "./spatial-estimation";
import { speechToTextService } from "./speech-to-text";
import { DetectSoundInput, DetectSoundResult } from "./types";

const clampConfidence = (value: number): number => {
  return Number(Math.max(0.01, Math.min(0.99, value)).toFixed(2));
};

const EMERGENCY_KEYWORDS = ["siren", "alarm", "fire alarm", "smoke alarm", "glass"];
const HIGH_KEYWORDS = ["horn", "car horn", "truck", "bike", "shout", "yell"];

type AlertDecision = {
  shouldAlert: boolean;
  alert?: string;
  alertCode?: "EMERGENCY" | "HIGH" | "MEDIUM";
  alertPriority?: "emergency" | "high" | "medium";
};

const distanceLabelToMeters = (distance: "5m" | "10-15m" | "20m+"): number => {
  if (distance === "5m") {
    return 5;
  }
  if (distance === "10-15m") {
    return 12;
  }
  return 25;
};

const directionLabelToAngle = (direction: "Left" | "Right" | "Front" | "Back"): number => {
  if (direction === "Left") {
    return 270;
  }
  if (direction === "Right") {
    return 90;
  }
  if (direction === "Back") {
    return 180;
  }
  return 0;
};

class DetectSoundService {
  private readonly userNameCache = new Map<string, { name: string; expiresAt: number }>();

  async warmup(): Promise<void> {
    await Promise.all([soundClassifier.warmup(), speechToTextService.warmup()]);
  }

  private async getUserName(userId: string): Promise<string> {
    const now = Date.now();
    const cached = this.userNameCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.name;
    }

    const db = getDb();
    const user = await db
      .collection("users")
      .findOne({ user_id: userId }, { projection: { _id: 0, name: 1 } });

    const userName = typeof user?.name === "string" ? user.name : "";
    this.userNameCache.set(userId, {
      name: userName,
      expiresAt: now + env.USER_NAME_CACHE_TTL_MS,
    });
    return userName;
  }

  async detect(input: DetectSoundInput): Promise<DetectSoundResult> {
    const audio = decodeAndPreprocessAudio(input.audioBuffer, 16_000);
    const classified = await soundClassifier.classify(audio.mono);
    const direction = estimateDirection(audio);
    const distance = estimateDistance(audio);
    const rms = calculateRms(audio.mono);

    let isUserNameDetected = false;
    let alertDecision: AlertDecision = {
      shouldAlert: false,
    };

    if (
      classified.category === "Speech Sounds" &&
      classified.confidence >= env.SPEECH_STT_MIN_CONFIDENCE
    ) {
      const userName = await this.getUserName(input.userId);
      if (userName) {
        const transcript = await speechToTextService.transcribe(
          audio.mono,
          audio.sampleRate,
          input.speechHint
        );
        isUserNameDetected = isNameInTranscript(transcript, userName);
        if (isUserNameDetected) {
          alertDecision = {
            shouldAlert: true,
            alert: "Someone is calling your name",
            alertCode: "HIGH",
            alertPriority: "high",
          };
        }
      }
    }

    if (!alertDecision.shouldAlert) {
      alertDecision = this.decideEnvironmentalAlert(classified.label, classified.confidence);
    }

    return {
      label: classified.label,
      category: classified.category,
      confidence: clampConfidence(classified.confidence),
      rms: Number(Math.max(0, Math.min(1, rms)).toFixed(4)),
      timestamp: Date.now(),
      direction,
      distance,
      distanceMeters: distanceLabelToMeters(distance),
      directionAngle: directionLabelToAngle(direction),
      isUserNameDetected,
      shouldAlert: alertDecision.shouldAlert,
      ...(classified.model ? { model: classified.model } : {}),
      ...(classified.topPredictions ? { topPredictions: classified.topPredictions } : {}),
      ...(alertDecision.alert ? { alert: alertDecision.alert } : {}),
      ...(alertDecision.alertCode ? { alertCode: alertDecision.alertCode } : {}),
      ...(alertDecision.alertPriority ? { alertPriority: alertDecision.alertPriority } : {}),
    };
  }

  private decideEnvironmentalAlert(label: string, confidence: number): AlertDecision {
    if (confidence < env.ALERT_MIN_CONFIDENCE) {
      return { shouldAlert: false };
    }

    const normalized = label.toLowerCase();
    if (EMERGENCY_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return {
        shouldAlert: true,
        alert: "Emergency sound detected nearby",
        alertCode: "EMERGENCY",
        alertPriority: "emergency",
      };
    }

    if (HIGH_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return {
        shouldAlert: true,
        alert: "High-priority sound detected nearby",
        alertCode: "HIGH",
        alertPriority: "high",
      };
    }

    return {
      shouldAlert: true,
      alert: "Sound detected nearby",
      alertCode: "MEDIUM",
      alertPriority: "medium",
    };
  }
}

export const detectSoundService = new DetectSoundService();
