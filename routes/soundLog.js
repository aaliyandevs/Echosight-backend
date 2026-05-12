const { Router } = require("express");
const { body, param, validationResult } = require("express-validator");

const soundLogRouter = Router();
const soundLogs = [];
const MAX_LOGS_PER_USER = 500;

const addCorsHeaders = (_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
};

const sendValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      ok: false,
      message: "Sound log payload is invalid.",
      errors: errors.array(),
    });
    return;
  }
  next();
};

soundLogRouter.use(addCorsHeaders);

soundLogRouter.options("/api/sound-log", (_req, res) => {
  res.sendStatus(204);
});

soundLogRouter.options("/api/sound-log/:userId", (_req, res) => {
  res.sendStatus(204);
});

soundLogRouter.post(
  "/api/sound-log",
  [
    body("userId").isString().trim().notEmpty().withMessage("userId is required."),
    body("label").isString().trim().notEmpty().withMessage("label is required."),
    body("angle").isFloat({ min: -180, max: 180 }).withMessage("angle must be between -180 and 180."),
    body("distance").isFloat({ min: 0, max: 100 }).withMessage("distance must be between 0 and 100 meters."),
    body("timestamp").isNumeric().withMessage("timestamp must be a Unix timestamp."),
  ],
  sendValidationErrors,
  (req, res) => {
    const entry = {
      userId: String(req.body.userId).trim(),
      label: String(req.body.label).trim(),
      angle: Number(req.body.angle),
      distance: Number(req.body.distance),
      timestamp: Number(req.body.timestamp),
      createdAt: Date.now(),
    };

    soundLogs.push(entry);

    const userLogs = soundLogs.filter(item => item.userId === entry.userId);
    if (userLogs.length > MAX_LOGS_PER_USER) {
      const removeCount = userLogs.length - MAX_LOGS_PER_USER;
      for (let index = 0; index < removeCount; index += 1) {
        const removeAt = soundLogs.findIndex(item => item.userId === entry.userId);
        if (removeAt >= 0) {
          soundLogs.splice(removeAt, 1);
        }
      }
    }

    res.status(201).json({
      ok: true,
      message: "Sound log created.",
      data: entry,
    });
  }
);

soundLogRouter.get(
  "/api/sound-log/:userId",
  [param("userId").isString().trim().notEmpty().withMessage("userId is required.")],
  sendValidationErrors,
  (req, res) => {
    const userId = String(req.params.userId).trim();
    const data = soundLogs
      .filter(item => item.userId === userId)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 50);

    res.status(200).json({
      ok: true,
      message: "Sound logs fetched.",
      data,
    });
  }
);

module.exports = {
  soundLogRouter,
};

