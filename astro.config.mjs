import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// Local-only server app (`output: 'server'`). The Node standalone adapter lets us run
// a persistent Node process locally, which is required for the native `better-sqlite3`
// module used by the transcript persistence layer.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),

  // Keep Vite from trying to bundle the native SQLite addon into the SSR build —
  // it must stay a real Node require at runtime.
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ['better-sqlite3'] },
    optimizeDeps: { exclude: ['better-sqlite3'] },
  },

  // Typed env. ALL vars are `context: 'server'` + `access: 'secret'`:
  //  - none of them ever reaches the browser bundle (framework-guaranteed), and
  //  - `secret` values are read at RUNTIME (not inlined at build), so changing .env
  //    takes effect without rebuilding and the guards evaluate per request.
  // All optional with a default so astro:env never throws its own EnvInvalidVariables
  // page on an empty value — each endpoint owns validation and returns friendly JSON.
  env: {
    schema: {
      // HeyGen LiveAvatar
      LIVEAVATAR_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      LIVEAVATAR_AVATAR_ID: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      LIVEAVATAR_VOICE_ID: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      LIVEAVATAR_LANGUAGE: envField.string({ context: 'server', access: 'secret', default: 'it' }),
      // Tavus CVI
      TAVUS_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      TAVUS_REPLICA_ID: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      TAVUS_PERSONA_ID: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      // Optional cost-rate overrides for the comparison meter (non-secret; defaults in pricing.ts).
      TAVUS_USD_PER_MIN: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      HEYGEN_USD_PER_CREDIT: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      HEYGEN_CREDITS_PER_MIN: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      // Per-question timer (seconds). Defaults in timing.ts (285 = 4:45, warn at 60).
      SESSION_TIME_LIMIT_SECONDS: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      SESSION_WARN_SECONDS: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      // App access gate. GATE_PASSWORD unlocks the whole app; override it in .env to rotate.
      // GATE_SESSION_SECRET signs the session cookie; when empty it derives from GATE_PASSWORD
      // (so changing the password invalidates existing sessions). Prefixed to avoid clashing
      // with a generic APP_PASSWORD that may already exist in the shell environment.
      GATE_PASSWORD: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
      GATE_SESSION_SECRET: envField.string({ context: 'server', access: 'secret', optional: true, default: '' }),
    },
  },
});
