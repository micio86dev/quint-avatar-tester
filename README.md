# quint-avatar-tester

A local app to **experiment with and compare AI avatar providers** in a spoken
interview flow. It drives an avatar through a prompt/script, captures the live
transcript, runs lightweight webcam **proctoring**, and shows a per-provider **cost
meter** — so you can evaluate **HeyGen** vs **Tavus** on behaviour, latency, and price
side by side.

The goal is to **decouple the technical layer** (HeyGen/Tavus SDKs, session wiring)
from the **product-study layer** (the interview prompt), so prompts can be authored and
refined freely without touching code.

> This is a **testing/experimentation app**, not a product: no user login, no
> multi-tenancy, no external integrations. Single operator, single machine.
> Project rules live in [`CLAUDE.md`](CLAUDE.md).

> **Status:** the app is being refactored from an earlier candidate-based demo toward a
> single-session, prompt-driven model. The provider abstraction, persistence, proctoring
> and cost meter are stable; the prompt CRUD and prompt selection are being wired in.

---

## Stack

- **Astro 7 — SSR** (`output: 'server'`, `@astrojs/node` standalone), TypeScript.
- **Backend:** thin **Astro API routes** under `src/pages/api/` — no separate service.
- **Persistence:** **SQLite** via `better-sqlite3` (`./data/interviews.db`), driven by a
  versioned migration runner + seeder.
- **Providers:** **HeyGen LiveAvatar** (FULL mode: HeyGen does ASR+LLM+TTS) and
  **Tavus CVI**, behind one provider-agnostic contract.
- **Proctoring:** MediaPipe `tasks-vision` face landmarker, in the browser.
- **Node 24** (pinned via [`.nvmrc`](.nvmrc) + `package.json` `engines`).

All code, identifiers, comments and UI copy are **English**. Only the interview content
(prompts/questions) stays in its authored language (Italian).

## Architecture

- **Provider abstraction** (`src/providers/types.ts`): one `InterviewProvider`
  interface both implementations satisfy, so the UI and persistence stay
  provider-agnostic. Every transcript event is normalized to
  `{ role: 'user' | 'avatar', text, ts, seq? }`.
  - `HeyGenProvider` — `@heygen/liveavatar-web-sdk`, FULL mode.
  - `TavusProvider` — `@daily-co/daily-js`, joins the conversation room.
- **API keys** are read **server-side only** (typed `astro:env`), never in the browser.
- **Prompts** are the experiment variable: a prompt carries the shared functional
  content (`body` + `greeting` + `language`) plus a **per-provider config block**
  (`heygen_config` / `tavus_config`, stored as JSON so the two providers' different
  parameter surfaces can each evolve independently). At runtime the shared body/greeting
  are routed into each provider's own field (HeyGen Context `prompt`/`opening_text` vs
  Tavus `conversational_context`/`custom_greeting`).

## Data layer (migrations + seeders)

The schema is owned by **versioned SQL migrations** in [`migrations/`](migrations/),
applied by a small runner and tracked in a `_migrations` table (idempotent). A seeder
provisions the default prompt. Everything runs identically **locally and on first
deploy** — start from a virgin DB:

```bash
npm run db:migrate   # apply pending migrations
npm run db:seed      # migrate + seed the default prompt
npm run db:reset     # wipe the local DB file and re-seed
```

`./data` is gitignored; the DB path can be overridden with `DATABASE_PATH` (point it at
a persistent volume in a deployed environment).

## Setup

### 1. Node

```bash
nvm use            # Node 24, from .nvmrc
```

### 2. Install

```bash
npm install
```

### 3. Environment

Create `.env` from `.env.example` and fill in the provider secrets:

```dotenv
# HeyGen LiveAvatar
LIVEAVATAR_API_KEY=
LIVEAVATAR_AVATAR_ID=ab0765ad-69de-41fb-9f8a-bd01c3c52d6f   # Alessandra
LIVEAVATAR_VOICE_ID=c84af063-5ce2-4370-8ef8-dcd0ef903d43    # Alessandra IT voice
LIVEAVATAR_LANGUAGE=it

# Tavus CVI
TAVUS_API_KEY=
TAVUS_PERSONA_ID=p8a490c4dfd4
TAVUS_REPLICA_ID=rf4e9d9790f0

# Optional cost-meter rate overrides (defaults in src/lib/pricing.ts)
# TAVUS_USD_PER_MIN=0.37
# HEYGEN_USD_PER_CREDIT=0.10
# HEYGEN_CREDITS_PER_MIN=2

# Optional per-session timer (defaults in src/lib/timing.ts)
# SESSION_TIME_LIMIT_SECONDS=285
# SESSION_WARN_SECONDS=60
```

| Var | Where to get it |
| --- | --- |
| `LIVEAVATAR_API_KEY` | HeyGen LiveAvatar dashboard → API key |
| `TAVUS_API_KEY` | Tavus dashboard → PAL Maker → API Key |
| `TAVUS_REPLICA_ID` | Tavus dashboard → Faces (replica id) |
| `TAVUS_PERSONA_ID` | Tavus dashboard → PAL Maker (persona/PAL id) |

Global provider secrets stay in `.env`; per-experiment provider knobs live on the prompt
record (managed under `/admin`), not in env.

### 4. Seed + run

```bash
npm run db:seed
npm run dev
```

Open **http://localhost:4321**. Mic + WebRTC work on `http://localhost` (a secure
context), so no HTTPS setup is needed.

## Cost meter (HeyGen vs Tavus)

A floating meter estimates **≈ $ this session** to compare providers:

- **HeyGen** — anchored to the real remaining balance (`/api/credits`), decrementing at
  ~2 credits/min (FULL mode) × ~$0.10/credit.
- **Tavus** — estimate only (no balance API): elapsed minutes × **$0.37/min**. Free tier
  = 25 min/month, **1 concurrent** conversation, ~5 min cap.

Rates live in `src/lib/pricing.ts` and can be overridden via the env vars above.

## Notes

- HeyGen video starts at `quality: 'low'` so latency feels instant while testing.
- Tavus's live utterance events are captured client-side, so transcripts work on the
  free tier (the post-call transcript webhook is a paid feature).
- **Local only** — no deployment target is configured, and none is added without an
  explicit request. Any future deploy must be a **new, separate** project (never the
  unrelated `avatar-test`).
