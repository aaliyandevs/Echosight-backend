# EchoSight API Contract (v1)

Base URL:

- `https://echosight-backend.vercel.app/`

Auth:

- Required for all `/v1/*` endpoints.
- Header mode (`AUTH_MODE=header`): `X-User-Id: <string>`
- JWT mode (`AUTH_MODE=jwt`): `Authorization: Bearer <token>`
- JWT claim used as user identity: `sub` (fallback: `user_id`, `uid`)

### `POST /auth/register`

Body:

```json
{
  "name": "Shayan",
  "email": "user@example.com",
  "password": "strong-password"
}
```

Response `201` data:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque-refresh-token>",
  "expiresIn": 900,
  "tokenType": "Bearer",
  "user": {
    "user_id": "uuid",
    "email": "user@example.com",
    "name": "Shayan"
  }
}
```

### `POST /auth/login`

Body:

```json
{
  "email": "user@example.com",
  "password": "strong-password"
}
```

Response `200`: same token payload as register.

### `POST /auth/refresh`

Body:

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

Response `200`: rotated token pair. The submitted refresh token is revoked.

### `POST /auth/logout`

Body:

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

Response `200`: refresh token revoked when present.

Content type:

- Request: `application/json`
- Response: `application/json`

Response headers:

- `X-Request-Id` on every response
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on `/v1/*`

## Standard response envelope

Success:

```json
{
  "ok": true,
  "message": "success",
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "message": "Some information is missing or invalid.",
  "errors": {
    "code": "INVALID_INPUT",
    "hint": "Please review your input and try again.",
    "fields": [
      {
        "field": "sensitivity",
        "message": "Number must be less than or equal to 1"
      }
    ],
    "retry_after_seconds": null,
    "request_id": "1b5c3977-8ac7-4b8e-9dd6-40d3f72f5c0f"
  }
}
```

## Endpoints

### `GET /health`

Purpose:

- Service health check.

Response `200`:

```json
{
  "ok": true,
  "message": "EchoSight backend is healthy",
  "data": {
    "service": "echosight-backend"
  }
}
```

### `GET /ready`

Purpose:

- Readiness check for dependencies (MongoDB ping).

Response `200`:

```json
{
  "ok": true,
  "message": "Service is ready",
  "data": {
    "mongo": "up"
  }
}
```

### `GET /v1/users/me`

Purpose:

- Fetch signed-in user profile data (name used for name-call detection).

Response `200` data:

```json
{
  "user_id": "demo-user",
  "name": "Shayan",
  "updated_at": "2026-04-03T10:30:00.000Z"
}
```

### `PUT /v1/users/me`

Body:

```json
{
  "name": "Shayan"
}
```

Response `200`: updated user profile.

### `POST /detect-sound`

Purpose:

- Real-time environmental sound detection for 500ms-1s audio chunks.

Auth:

- Required (`X-User-Id` header or JWT mode).

Input options:

1. JSON body with base64 WAV:

```json
{
  "audioBase64": "<base64-wav>",
  "speechHint": "Shayan are you there"
}
```

2. Binary WAV body (`application/octet-stream` or `audio/wav`).

Response `200` data:

```json
{
  "label": "Siren",
  "category": "Non-Speech Sounds",
  "confidence": 0.92,
  "direction": "Right",
  "distance": "10-15m",
  "isUserNameDetected": false,
  "shouldAlert": true,
  "model": "yamnet",
  "topPredictions": [
    {
      "label": "Siren",
      "confidence": 0.92
    }
  ]
}
```

When name is detected in speech:

```json
{
  "label": "Speech",
  "category": "Speech Sounds",
  "confidence": 0.88,
  "direction": "Front",
  "distance": "5m",
  "isUserNameDetected": true,
  "alert": "Someone is calling your name"
}
```

Response `503`:

```json
{
  "ok": false,
  "message": "Service is still starting up. Please try again shortly.",
  "errors": {
    "code": "SERVICE_UNAVAILABLE",
    "hint": "Database connection is not ready yet.",
    "fields": [],
    "retry_after_seconds": null,
    "request_id": null
  }
}
```

### `GET /v1/profiles/me`

Purpose:

- Get user alert profile; auto-creates default on first call.

Response `200` data:

```json
{
  "user_id": "demo-user",
  "monitored_sounds": [
    "siren"
  ],
  "priority_overrides": {
    "siren": "emergency"
  },
  "haptic_patterns": {
    "siren": "long_pulse",
    "emergency": "long_strong_repeat",
    "high": "triple_strong_pulse",
    "medium": "double_pulse",
    "low": "single_pulse"
  },
  "haptic_settings": {
    "enabled": true,
    "mode": "strong",
    "intensity_scale": 1,
    "repeat_count": 3,
    "repeat_interval_ms": 500,
    "emergency_repeat_until_ack": true
  },
  "sensitivity": 0.7,
  "updated_at": "2026-04-03T10:30:00.000Z"
}
```

### `PUT /v1/profiles/me`

Body:

```json
{
  "monitored_sounds": [
    "siren",
    "horn"
  ],
  "priority_overrides": {
    "siren": "emergency"
  },
  "haptic_patterns": {
    "siren": "long_pulse",
    "emergency": "long_strong_repeat"
  },
  "haptic_settings": {
    "enabled": true,
    "mode": "strong",
    "intensity_scale": 1,
    "repeat_count": 3,
    "repeat_interval_ms": 500,
    "emergency_repeat_until_ack": true
  },
  "sensitivity": 0.7
}
```

Rules:

- `sensitivity` must be `0.0` to `1.0`.
- `priority_overrides` values: `emergency | high | medium | low`.
- `haptic_settings.mode` values: `normal | strong | critical`.
- Default profile is strong haptics for accessibility-first alerts.

Response `200`: updated profile object.

### `POST /v1/events/batch`

Body:

```json
{
  "events": [
    {
      "device_id": "pixel-8",
      "label": "siren",
      "confidence": 0.96,
      "priority": "emergency",
      "direction": "front_left",
      "ts": "2026-04-03T10:30:00.000Z",
      "meta": {
        "latency_ms": 142,
        "app_version": "0.1.0"
      }
    }
  ]
}
```

Rules:

- `events` minimum length is 1.
- `confidence` must be `0.0` to `1.0`.
- `priority` values: `emergency | high | medium | low`.
- `direction` values:
  `front | back | left | right | front_left | front_right | back_left | back_right | unknown`.
- Optional idempotency header: `Idempotency-Key: <string>`.

Response `200` data:

```json
{
  "inserted_count": 1
}
```

If an existing idempotency key is replayed, response includes:

```json
{
  "inserted_count": 1,
  "idempotent_replay": true
}
```

If the same key is currently in progress, response is `409`:

```json
{
  "ok": false,
  "message": "A similar request is already being processed. Please wait a moment and retry.",
  "errors": {
    "code": "REQUEST_IN_PROGRESS",
    "hint": null,
    "fields": [],
    "retry_after_seconds": null,
    "request_id": null
  }
}
```

### `GET /v1/events`

Query params:

- `from_ts` (optional, ISO datetime)
- `to_ts` (optional, ISO datetime)
- `cursor` (optional, ISO datetime, returns records older than this timestamp)
- `device_id` (optional, string)
- `limit` (optional, integer, default `50`, max `500`)

Response `200` data:

```json
{
  "items": [
    {
      "user_id": "demo-user",
      "device_id": "pixel-8",
      "label": "siren",
      "confidence": 0.96,
      "priority": "emergency",
      "direction": "front_left",
      "ts": "2026-04-03T10:30:00.000Z",
      "meta": {
        "latency_ms": 142,
        "app_version": "0.1.0"
      }
    }
  ],
  "next_cursor": "2026-04-03T10:30:00.000Z",
  "has_more": true
}
```

### `GET /v1/models/latest`

Query params:

- `platform` (required): `ios | android`
- `channel` (optional): `stable | beta` (default `stable`)

Response `200` data:

```json
{
  "platform": "android",
  "channel": "stable",
  "version": 3,
  "model_name": "yamnet-v2-q8",
  "download_url": "https://example.com/models/yamnet-v2-q8.tflite",
  "checksum_sha256": "abc123",
  "min_app_version": "0.1.0",
  "created_at": "2026-04-03T10:30:00.000Z"
}
```

Response `404`:

```json
{
  "ok": false,
  "message": "No model update is available for this platform yet.",
  "errors": {
    "code": "MODEL_NOT_AVAILABLE",
    "hint": null,
    "fields": [],
    "retry_after_seconds": null,
    "request_id": null
  }
}
```

### `POST /v1/models`

Body:

```json
{
  "platform": "android",
  "channel": "stable",
  "version": 3,
  "model_name": "yamnet-v2-q8",
  "download_url": "https://example.com/models/yamnet-v2-q8.tflite",
  "checksum_sha256": "abc123",
  "min_app_version": "0.1.0"
}
```

Response `201`: created model object with `created_at`.

### `POST /v1/devices/register`

Body:

```json
{
  "device_id": "pixel-8",
  "platform": "android",
  "device_model": "Google Pixel 8",
  "os_version": "15",
  "app_version": "0.1.0"
}
```

Response `200`: upserted device record with `user_id` and `updated_at`.

### `POST /v1/feedback`

Body:

```json
{
  "type": "false_alert",
  "device_id": "pixel-8",
  "label": "siren",
  "note": "Sound was actually a pressure cooker",
  "event_ts": "2026-04-03T10:30:00.000Z"
}
```

Rules:

- `type` values: `false_alert | missed_alert | general`.

Response `200`:

```json
{
  "ok": true,
  "message": "feedback accepted",
  "data": null
}
```

### `POST /v1/ai/classify`

Purpose:

- Development-time AI inference endpoint.
- Works without AI API key when `AI_PROVIDER=mock`.

Body:

```json
{
  "hint": "traffic noise",
  "device_id": "pixel-8"
}
```

Response `200` data:

```json
{
  "provider": "mock",
  "device_id": "pixel-8",
  "hint": "traffic noise",
  "result": {
    "label": "siren",
    "confidence": 0.95,
    "priority": "emergency",
    "direction": "front_left",
    "ts": "2026-04-03T10:30:00.000Z"
  },
  "note": "Mock inference result for development; no API key required."
}
```

Response `503` examples:

- `AI features are temporarily unavailable.`
- `AI service is not configured yet.`

## Common errors

- `401` missing/invalid auth header or token
- `400` validation error
- `403` origin blocked by CORS policy
- `429` rate limit exceeded
- `409` idempotency key in progress
- `500` internal server error
