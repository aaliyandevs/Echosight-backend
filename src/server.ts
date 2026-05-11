import { createApp } from "./app";
import { configValidation, env } from "./config";
import { closeMongo, connectToMongo } from "./db/mongo";
import { detectSoundService } from "./services/sound/detect-sound-service";

const start = async () => {
  if (!configValidation.ok) {
    // eslint-disable-next-line no-console
    console.error(configValidation.message);
    process.exit(1);
  }

  await connectToMongo();
  void detectSoundService.warmup();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`EchoSight backend listening on http://localhost:${env.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    server.close(async () => {
      await closeMongo();
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", async (error) => {
    // eslint-disable-next-line no-console
    console.error("Unhandled promise rejection:", error);
    await shutdown();
  });
  process.on("uncaughtException", async (error) => {
    // eslint-disable-next-line no-console
    console.error("Uncaught exception:", error);
    await shutdown();
  });
};

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", error);
  process.exit(1);
});
