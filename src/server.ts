import { createApp } from "./app";
import { configValidation, env } from "./config";
import { closeMongo, connectToMongo } from "./db/mongo";
import { detectSoundService } from "./services/sound/detect-sound-service";

const app = createApp();

// Vercel export
export default async (req: any, res: any) => {
  if (!configValidation.ok) {
    console.error(configValidation.message);
    res.status(500).send("Config error");
    return;
  }

  await connectToMongo();
  void detectSoundService.warmup();

  app(req, res);
};

// Local dev only
if (process.env.NODE_ENV !== "production") {
  const start = async () => {
    await connectToMongo();
    void detectSoundService.warmup();

    const server = app.listen(env.PORT, () => {
      console.log(`EchoSight backend listening on http://localhost:${env.PORT}`);
    });

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close(async () => {
        await closeMongo();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("unhandledRejection", async (error) => {
      console.error("Unhandled promise rejection:", error);
      await shutdown();
    });
    process.on("uncaughtException", async (error) => {
      console.error("Uncaught exception:", error);
      await shutdown();
    });
  };

  start().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}