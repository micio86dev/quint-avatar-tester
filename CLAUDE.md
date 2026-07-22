# quint-avatar-tester

A local app to **experiment with and compare AI avatar providers** in a spoken
interview flow. It drives an avatar through a scripted set of questions, captures the
live transcript, runs lightweight webcam **proctoring**, and tracks a per-provider
**cost meter** — so we can evaluate HeyGen vs Tavus behaviour, latency, and price
side by side.

This is a **testing/experimentation app**, not a product. No user login, no
multi-tenancy, no external integrations. Single operator, single machine.

---

## Stack

| Layer | Choice |
|---|---|
| App | **Astro 7 — SSR** (`output: 'server'`, `@astrojs/node` standalone). TypeScript. |
| Backend | **Astro API routes** under `src/pages/api/` — a thin, simple API. No separate service. |
| Persistence | **SQLite via `better-sqlite3`** (`src/lib/db.ts`, file at `./data/interviews.db`). |
| Avatar providers | **HeyGen LiveAvatar** and **Tavus CVI**, behind one provider abstraction. |
| Proctoring | **MediaPipe tasks-vision** (face landmarker) in the browser. |

No PocketBase, no Laravel, no Nuxt. If persistence ever outgrows SQLite we revisit it
then — not before.

### Why `better-sqlite3` shapes the config

`better-sqlite3` is a **native Node addon**, so the app must run as a persistent Node
process. That's why `astro.config.mjs` uses the Node standalone adapter and marks
`better-sqlite3` as `ssr.external` — Vite must not try to bundle the native module; it
stays a real `require` at runtime.

---

## Structure

```
src/
  pages/
    index.astro        # the interview / avatar session
    admin/             # operator management pages (see below)
    review/            # session review
    api/               # API routes: candidate, interview, snapshot, credits
  providers/
    types.ts           # provider-agnostic contract (UI + persistence talk ONLY to this)
    heygen.ts          # HeyGen LiveAvatar implementation
    tavus.ts           # Tavus CVI implementation
  lib/
    db.ts              # better-sqlite3 persistence + schema/migrations on boot
    prompt.ts          # avatar prompt assembly
    proctor-config.ts  # proctoring taxonomy + summarizeIntegrity()
    pricing.ts         # per-provider cost-rate meter
    timing.ts          # per-question timer
    i18n.ts            # it/en strings
  scripts/
    interview-client.ts  # client-side session driver
    proctor.ts           # client-side proctoring loop
prompts/               # avatar system prompts (JSON + Markdown)
questions.json         # the interview question set
```

### Management UI (`/admin`, and a planned `/manage`)

Operator-only pages to edit **avatar prompts** and **configuration** (provider,
questions, timers). **No authentication** — these pages are for local use only and
must not be exposed publicly. `/admin` already exists; extend it (or add `/manage`)
rather than introducing an admin backend.

---

## Provider abstraction (keep it clean)

`src/providers/types.ts` is the contract. The UI and the persistence layer talk **only**
to this interface, so HeyGen and Tavus stay interchangeable. When adding provider
behaviour, extend the shared types — never leak a provider's own SDK shape into the UI.

---

## Configuration

All secrets/config live in `.env` (see `.env.example`) and are declared as typed,
**server-only** `astro:env` vars in `astro.config.mjs` (never reach the browser). Keys
cover HeyGen (`LIVEAVATAR_*`), Tavus (`TAVUS_*`), optional cost-rate overrides, and the
per-question timer. Each endpoint validates its own inputs and returns friendly JSON —
missing keys degrade gracefully instead of throwing.

Provider asset prep (MediaPipe wasm + face model): `npm run proctor:assets`.

---

## Working conventions

- **English everywhere in artifacts.** All code, identifiers, comments, `.md`
  docs, UI copy, and commit messages are in English — no exceptions.
- **Conventional commits only.** Never add Co-Authored-By / AI attribution.
- **Versioning: SemVer** (`M.m.p`). Currently `0.1.0`.
- Write tests where they add real value (provider contract, `db.ts`, scoring/timing
  logic). This is a test app — don't impose heavyweight process on throwaway spikes.
- Keep the provider abstraction and the `types.ts` contract intact when changing UI.
- Defaults for language are `it`/`en`.

## Deploy

Local-first. No deploy target is configured, and none should be added without an
explicit request.

**Hard constraint — never touch `avatar-test`.** There is a **separate, unrelated**
project named `avatar-test` on the deploy platforms (Vercel and/or Railway). Any
future deploy for THIS repo must be a **brand-new, separate project** — never link to,
overwrite, or reuse `avatar-test`. Node is pinned to **24** (`.nvmrc` + `engines`).
