// Session timing budget. The interview now runs as ONE continuous session; its cap is
// derived from the template's provider config (with a plan ceiling) via resolveSessionCap.
// warnSeconds still drives the client countdown; SESSION_TIME_LIMIT_SECONDS survives only
// as a fallback duration when a config supplies no explicit max. These are read
// server-side and RETURNED to the client in the /api/interview/start response (the browser
// can't read server secrets), and also drive the provider-side hard caps.
import { SESSION_TIME_LIMIT_SECONDS, SESSION_WARN_SECONDS } from 'astro:env/server';

function int(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Provider plan ceilings (seconds). A session cap can be lowered per-template via config,
// but never raised above these — they protect the account from overrun/overspend.
export const HEYGEN_MAX_SECONDS = 1200; // HeyGen Essential plan ~20 min
export const TAVUS_MAX_SECONDS = 3600; // Tavus default max call duration

export interface Timing {
  limitSeconds: number; // fallback budget when a config supplies no explicit max
  warnSeconds: number; // countdown turns amber at/under this remaining
}

export const timing: Timing = {
  limitSeconds: int(SESSION_TIME_LIMIT_SECONDS, 285), // 4:45 fallback
  warnSeconds: int(SESSION_WARN_SECONDS, 60),
};

// Resolve the hard session cap (seconds) for a provider: use the template config value
// when present, otherwise the provider default, then clamp to the plan ceiling so a
// misconfigured template can never overrun the account limit.
export function resolveSessionCap(
  provider: 'heygen' | 'tavus',
  maxFromConfig?: number,
): number {
  // Floor at 1s: a non-positive config value must never reach the provider body.
  if (provider === 'heygen') {
    return Math.max(1, Math.min(maxFromConfig ?? HEYGEN_MAX_SECONDS, HEYGEN_MAX_SECONDS));
  }
  return Math.max(1, Math.min(maxFromConfig ?? TAVUS_MAX_SECONDS, TAVUS_MAX_SECONDS));
}
