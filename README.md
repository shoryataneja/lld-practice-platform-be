# lld-practice-platform-be

Backend API for the LLD Lab learning platform. Express 5 + Prisma 7 + PostgreSQL (Neon), with a rule-based and an optional AI (Groq) evaluator for low-level design submissions.

## Setup

```bash
npm install
cp .env.example .env   # if present, or create .env (see below)
npx prisma migrate deploy
npm run seed
npm run dev
```

The API listens on `http://localhost:4000`.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Neon PostgreSQL connection string (Prisma `pg` driver). |
| `JWT_SECRET` | prod only | ephemeral (dev) | Secret used to sign session cookies. In production this **must** be set; in dev an ephemeral random secret is generated and sessions reset on restart. |
| `NODE_ENV` | no | dev | When `production`, session cookies are `Secure` + `SameSite=None` and `JWT_SECRET` is required. |
| `CORS_ORIGIN` | no | all (dev) | Comma-separated allowed origins for credentialed CORS (e.g. `https://lld.example.app`). |
| `DEMO_PASSWORD` | no | `demo1234` | Password for the seeded demo user. Only applied if the demo user has no password yet. |
| `SESSION_COOKIE_NAME` | no | `lld_session` | Name of the HttpOnly session cookie. |
| `SESSION_TTL_DAYS` | no | `7` | Session lifetime in days. |
| `EVALUATOR_TYPE` | no | `auto` | Evaluator selection: `auto` (AI with rule-based fallback), `ai`, or `rule-based`. |
| `GROQ_API_KEY` | ai | — | API key for the AI evaluator. |
| `GROQ_MODEL` | no | `openai/gpt-oss-120b` | Groq model used by the AI evaluator. |

`DATABASE_URL` uses the `pg` driver (Prisma 7). The schema lives in `prisma/schema.prisma`; a `.env` file with `DATABASE_URL` (and `GROQ_API_KEY` if you want AI evaluation locally).

## Demo account

The seed script creates/backfills the demo learner:

- **email:** `demo@lld.dev`
- **password:** the value of `DEMO_PASSWORD` (default `demo1234`)

If the demo user already has a password, seeding keeps it.

## Auth (MVP)

Sessions are JWT-based and cookie-based — no session table, no refresh tokens.

- `POST /api/auth/signup` — create an account (email, password ≥ 8 chars, optional name). Sets the session cookie.
- `POST /api/auth/login` — log in with email + password. Sets the session cookie.
- `POST /api/auth/logout` — clears the session cookie.
- `GET /api/auth/me` — returns the current user (requires a session).

The JWT is stored in the `lld_session` HttpOnly cookie: always `HttpOnly`, `Secure` + `SameSite=None` in production, `Lax` in dev. All `/api/attempts` routes and attempt creation require a session; every attempt is scoped to the authenticated user.

## API overview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check. |
| `POST` | `/api/auth/signup` | Create account + session. |
| `POST` | `/api/auth/login` | Log in + session. |
| `POST` | `/api/auth/logout` | End session. |
| `GET` | `/api/auth/me` | Current user. |
| `GET` | `/api/problems` | List published problems. |
| `GET` | `/api/problems/:slug` | Problem detail (with best submission/evaluation for current user). |
| `POST` | `/api/problems/:slug/attempts` | Start a new attempt for the current user. |
| `GET` | `/api/attempts` | Current user’s attempt history. |
| `GET` | `/api/attempts/:id` | Attempt detail (scoped to current user). |
| `PUT` | `/api/attempts/:id/sections` | Save submission sections. |
| `POST` | `/api/attempts/:id/submit` | Submit for evaluation. |

## Tests

```bash
npm test
```

Runs `node --test` across the test suite (unit + integration). Integration tests use a real Neon database and a dedicated test learner; the private-key auth test suite requires rule-based evaluation for determinism.

## Migrations

```bash
npx prisma migrate dev   # dev: apply + regenerate client
npx prisma migrate deploy  # prod: apply only
npx prisma generate      # regenerate client without migrating
```