/**
 * The Codex worker's own identity, read once before it starts the ACP adapter and handed down as the GUARDIAN of every
 * command the session's model runs (`adapterEnvironment.ts`).
 *
 * Inside Codex's seatbelt sandbox `/bin/ps` cannot be exec'd at all — `codex sandbox -c
 * 'sandbox_mode="workspace-write"' -- /bin/ps -o lstart= -p 1` exits 71, "execvp() of '/bin/ps' failed: Operation not
 * permitted" — so a `slopweaver` verb the model runs cannot stamp its own operation lock, and was refused every
 * never-stale lease. The worker runs outside the sandbox, so it reads its OWN exact start stamp here and the verb
 * records it beside its pid (`src/admit/processGuardian.ts`). It is not an override: it can only keep a live holder's
 * lease standing, never declare a holder dead.
 *
 * The stamp must be byte-identical to what the CLI's one probe reads later (`src/talk/relayLease.ts`
 * `processStartOf`): the same `/bin/ps` by path, the same fields, in UTC and the C locale and inheriting nothing else,
 * parsed the same way. The desktop builds apart from `src/` and restates all of it, and
 * `desktop/__tests__/unit/processGuardian.test.ts` fails the moment the two differ.
 */
import { execFileSync } from "node:child_process";

/** The worker as a guardian: its pid, and its start stamp exactly as `ps -o lstart=` prints it. */
export interface ProcessGuardian {
  readonly pid: number;
  readonly start: string;
}

/** The environment field carrying the guardian's pid — `src/admit/processGuardian.ts` `GUARDIAN_PID_ENV`. */
export const GUARDIAN_PID_ENV = "SLOPWEAVER_SESSION_GUARDIAN_PID";

/** The environment field carrying the guardian's start stamp — `src/admit/processGuardian.ts` `GUARDIAN_START_ENV`. */
export const GUARDIAN_START_ENV = "SLOPWEAVER_SESSION_GUARDIAN_START";

/** The `ps` columns asked for: the state, so a zombie is told apart, then the start stamp. */
export const GUARDIAN_PS_FIELDS = "stat=,lstart=";

/** The only environment `ps` runs under: `lstart` is rendered in the caller's timezone and locale. */
export const GUARDIAN_PS_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
});

/** `lstart` in the C locale: weekday, month, a space-padded day, the time to the second, the year. */
const LSTART_STAMP = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/u;

/**
 * The start stamp one `ps -o stat=,lstart=` row carries, byte for byte as the CLI's `processStartFromPs` extracts it:
 * the row trimmed, split at its first gap, the rest trimmed — so a space-padded day keeps both its spaces.
 *
 * @param text the row as `ps` printed it, or empty when it printed nothing or failed
 * @returns the stamp, or `undefined` for a zombie, a row that is not one row, or a stamp not shaped as `lstart`
 */
export function guardianStampFromPs({ text }: { text: string }): string | undefined {
  const row = text.trim();
  const gap = row.search(/\s/u);
  if (gap === -1) {
    return undefined;
  }
  const state = row.slice(0, gap);
  const start = row.slice(gap).trim();
  if (/[\n\r\p{Zl}\p{Zp}]/u.test(start) || state.startsWith("Z") || !LSTART_STAMP.test(start)) {
    return undefined;
  }
  return start;
}

/**
 * This worker as a guardian: its pid and its own exact start stamp, read from `/bin/ps` once. A failed read is no
 * guardian at all, which leaves a sandboxed verb exactly as it was without one.
 *
 * @returns the guardian, or `undefined` when `ps` gave no stamp
 */
export function ownProcessGuardian(): ProcessGuardian | undefined {
  let text: string;
  try {
    text = execFileSync("/bin/ps", ["-o", GUARDIAN_PS_FIELDS, "-p", String(process.pid)], {
      encoding: "utf8",
      env: { ...GUARDIAN_PS_ENVIRONMENT },
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
  } catch {
    return undefined;
  }
  const start = guardianStampFromPs({ text });
  if (start === undefined) {
    return undefined;
  }
  return { pid: process.pid, start };
}
