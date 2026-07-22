# Deploy — Railway (quint-avatar-tester)

> **Never touch the unrelated `avatar-test` project.** This deploys a **new, separate**
> Railway project named `quint-avatar-tester`. Deploy platform is **Railway (not Vercel)**.

The app is Astro 7 SSR (Node standalone) with a native `better-sqlite3` store. It builds
from the `Dockerfile` and persists its SQLite file on a mounted volume.

## One-time setup

1. **Authenticate** (interactive, run it yourself):
   ```bash
   railway login
   ```
2. **Create a new project** (do NOT link to `avatar-test`):
   ```bash
   railway init            # name it: quint-avatar-tester
   ```
3. **Add a volume** for the SQLite file, mounted at `/data`:
   - Railway dashboard → the service → *Variables/Volumes* → add a volume at mount path `/data`.
4. **Set environment variables** (dashboard → Variables, or `railway variables set K=V`):

   | Variable | Value / notes |
   |---|---|
   | `DATABASE_PATH` | `/data/interviews.db` (the mounted volume) |
   | `GATE_PASSWORD` | **set a real password** (do not ship the `12345Abc$` default) |
   | `GATE_SESSION_SECRET` | optional; a long random string |
   | `LIVEAVATAR_API_KEY` | HeyGen LiveAvatar API key |
   | `LIVEAVATAR_AVATAR_ID` | HeyGen avatar id |
   | `LIVEAVATAR_VOICE_ID` | HeyGen voice id |
   | `LIVEAVATAR_LANGUAGE` | e.g. `it` |
   | `TAVUS_API_KEY` | Tavus API key |
   | `TAVUS_REPLICA_ID` | Tavus replica/face id |
   | `TAVUS_PERSONA_ID` | Tavus persona/PAL id |

   `HOST=0.0.0.0` and `NODE_ENV=production` are already set in the Dockerfile. Railway
   injects `PORT`; the Node adapter binds it automatically.

## Deploy

```bash
railway up          # builds the Dockerfile and deploys
```
Or connect the GitHub repo (`micio86dev/quint-avatar-tester`) in the Railway dashboard for
push-to-deploy. Then open the generated URL, unlock with `GATE_PASSWORD`, and go to `/admin`.

## Notes
- Migrations auto-apply on first DB open; the default prompt/questions/template are seeded
  at container start (idempotent).
- `better-sqlite3` uses prebuilt binaries; the full `node:24` image can compile it if needed.
- The proctor assets (MediaPipe model) are downloaded during the image build.
