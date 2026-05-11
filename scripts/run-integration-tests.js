const { spawnSync } = require("node:child_process");

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const env = {
  ...process.env,
  RUN_INTEGRATION_TESTS: "1",
};

const result = spawnSync(command, ["exec", "--", "tsx", "--test", "tests/api.integration.test.ts"], {
  stdio: "inherit",
  env,
  timeout: 180000,
});

if (result.error && result.error.code === "ETIMEDOUT") {
  console.error(
    "Integration tests timed out while starting test MongoDB. Set INTEGRATION_MONGODB_URI to use an existing Mongo instance."
  );
  process.exit(1);
}

if (result.error) {
  console.error("Failed to start integration tests:", result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error(`Integration tests terminated by signal: ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
