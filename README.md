# EchoSight Backend (Node.js + TypeScript + MongoDB)

## 1) Setup

```bash
cd backend
npm install
copy .env.example .env
```

Update `.env`:

```env
NODE_ENV=development
PORT=8000
MONGODB_URI=mongodb+srv://devshayan5_db_user:<db_password>@clusterechosight.3ygbrpp.mongodb.net/
MONGODB_DB_NAME=echosight
CORS_ORIGINS=*
REQUEST_BODY_LIMIT=1mb
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_READ_MAX=180
RATE_LIMIT_WRITE_MAX=60
DETECT_SOUND_RATE_LIMIT_MAX=240
AUTH_MODE=header
JWT_SECRET=change_me_with_a_long_secret_key
AI_PROVIDER=mock
OPENAI_API_KEY=
SOUND_CLASSIFIER_MODE=mock
YAMNET_MODEL_URL=https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1
YAMNET_CLASS_MAP_PATH=
STT_MODE=mock
WHISPER_CPP_COMMAND=
STT_EXEC_TIMEOUT_MS=12000
SPEECH_STT_MIN_CONFIDENCE=0.6
USER_NAME_CACHE_TTL_MS=60000
```

## 2) Run

```bash
npm run dev
```

API base URL: `https://echosight-backend.vercel.app/`

API contract:

- `backend/docs/api-contract.md`
- Error responses are intentionally user-friendly and avoid exposing debug internals.

Available scripts:

- `npm run dev`
- `npm run typecheck`
- `npm run test`
- `npm run test:integration`
- `npm run build`
- `npm start`

Notes for integration tests:

- `npm test` runs schema tests and keeps API integration tests skipped by default.
- `npm run test:integration` runs the API integration tests end-to-end.
- Integration tests use an ephemeral MongoDB via `mongodb-memory-server`.
- If memory Mongo startup is blocked/slow, set `INTEGRATION_MONGODB_URI` to an existing Mongo database for integration runs.

## 3) Current auth

Auth is switchable with `AUTH_MODE`.

Header mode (`AUTH_MODE=header`) uses:

- `X-User-Id: your-user-id`

JWT mode (`AUTH_MODE=jwt`) uses:

- `Authorization: Bearer <token>`

JWT token must include one of these claims for user identity:

- `sub` or `user_id` or `uid`

## 4) AI provider mode (no key needed)

For development without any AI API key:

- Set `AI_PROVIDER=mock` (default)
- Keep `OPENAI_API_KEY` empty

Available modes:

- `mock`: deterministic fake classifications (best for frontend/backend development)
- `openai`: expects `OPENAI_API_KEY` (currently still returns deterministic dev output)
- `disabled`: AI endpoint returns `503`

## 4.1) Sound AI + Speech-to-Text modes

- `SOUND_CLASSIFIER_MODE=mock|yamnet`
- `YAMNET_MODEL_URL` points to TFJS YAMNet graph model URL
- `YAMNET_CLASS_MAP_PATH` optional local CSV path for YAMNet labels
- `STT_MODE=mock|whisper_cpp|disabled`
- `WHISPER_CPP_COMMAND` command template with `{input}` and optional `{output}` placeholders
  Example: `whisper-cli -m ./models/ggml-base.en.bin -f {input}`
- `STT_EXEC_TIMEOUT_MS` timeout for STT command execution
- `SPEECH_STT_MIN_CONFIDENCE` only runs STT when speech classification confidence is above this threshold
- `USER_NAME_CACHE_TTL_MS` in-memory user-name cache to reduce DB lookups and latency

Enable pretrained YAMNet mode:

```bash
npm install @tensorflow/tfjs-node
```

Then set:

- `SOUND_CLASSIFIER_MODE=yamnet`
- optional `YAMNET_CLASS_MAP_PATH=./assets/yamnet_class_map.csv`
- for high-accuracy speech transcription, set `STT_MODE=whisper_cpp` and provide `WHISPER_CPP_COMMAND`

## Accessibility defaults

- New user profiles default to strong haptics.
- Default profile includes emergency/high/medium/low haptic patterns.
- You can override via `PUT /v1/profiles/me` using:
  - `haptic_patterns`
  - `haptic_settings`

## 5) Endpoints

- `GET /health`
- `GET /ready`
- `POST /detect-sound`
- `GET /v1/users/me`
- `PUT /v1/users/me`
- `GET /v1/profiles/me`
- `PUT /v1/profiles/me`
- `POST /v1/events/batch`
- `GET /v1/events?from_ts=&to_ts=&cursor=&device_id=&limit=`
- `GET /v1/models/latest?platform=ios&channel=stable`
- `POST /v1/models`
- `POST /v1/devices/register`
- `POST /v1/ai/classify`
- `POST /v1/feedback`

Write endpoints support basic rate limiting and return standard rate limit headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

`POST /v1/events/batch` also supports idempotent replay:

- Optional header: `Idempotency-Key: <unique-key>`
- If same key is being processed concurrently, endpoint returns `409`

## 6) Quick test examples (Windows PowerShell)

```powershell
curl -X PUT "https://echosight-backend.vercel.app/v1/users/me" `
  -H "Content-Type: application/json" `
  -H "X-User-Id: demo-user" `
  -d "{\"name\":\"Shayan\"}"
```

```powershell
curl -X POST "https://echosight-backend.vercel.app/detect-sound" `
  -H "Content-Type: application/json" `
  -H "X-User-Id: demo-user" `
  -d "{\"audioBase64\":\"<base64-wav-chunk>\",\"speechHint\":\"Shayan are you there\"}"
```

```powershell
curl -X GET "https://echosight-backend.vercel.app/v1/profiles/me" `
  -H "X-User-Id: demo-user"
```

```powershell
curl -X PUT "https://echosight-backend.vercel.app/v1/profiles/me" `
  -H "Content-Type: application/json" `
  -H "X-User-Id: demo-user" `
  -d "{\"monitored_sounds\":[\"siren\",\"horn\"],\"priority_overrides\":{\"siren\":\"emergency\"},\"haptic_patterns\":{\"siren\":\"long_pulse\"},\"sensitivity\":0.7}"
```

```powershell
curl -X POST "https://echosight-backend.vercel.app/v1/events/batch" `
  -H "Content-Type: application/json" `
  -H "X-User-Id: demo-user" `
  -H "Idempotency-Key: event-upload-001" `
  -d "{\"events\":[{\"device_id\":\"pixel-8\",\"label\":\"siren\",\"confidence\":0.96,\"priority\":\"emergency\",\"direction\":\"front_left\",\"ts\":\"2026-04-03T10:30:00Z\"}]}"
```

```powershell
curl -X POST "https://echosight-backend.vercel.app/v1/ai/classify" `
  -H "Content-Type: application/json" `
  -H "X-User-Id: demo-user" `
  -d "{\"hint\":\"traffic noise\",\"device_id\":\"pixel-8\"}"
```

## 7) Production notes

- Set strict CORS in production, for example:
  `CORS_ORIGINS=https://app.example.com,https://admin.example.com`
- Use `AUTH_MODE=jwt` in production with a strong `JWT_SECRET`.
- Keep `AI_PROVIDER=mock` until you are ready to integrate real AI provider calls.
- CI workflow runs on each backend push/PR:
  `.github/workflows/backend-ci.yml`

## 8) Docker

Build image:

```bash
docker build -t echosight-backend ./backend
```

Run container:

```bash
docker run --rm -p 8000:8000 --env-file backend/.env echosight-backend
```
"# Echo_Sight" 
