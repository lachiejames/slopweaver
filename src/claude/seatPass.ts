/**
 * The cached PASS the `UserPromptSubmit` seat check leaves for a seat it judged on a plan, so the next prompt from
 * that same process is answered by `bin/slopweaver` in bash without starting node.
 *
 * The reader, the measurement that made it necessary and the full invalidation rule are at
 * `../../hooks/lib/seat-pass.sh`. This side decides only WHAT may be written, and it is deliberately narrow:
 *
 * - **Only `on-plan`.** A refusal must fire on every prompt, and `unmeasured` passes on blindness, which is a reading
 *   to repeat rather than to remember. The `unrouted-seat` hatch only ever overrides a refusal, so it never
 *   reaches here.
 * - **Only with a recorded process start.** The marker is keyed on pid AND start so a reused pid cannot inherit it.
 * - **Only a session id that cannot leave the directory.** It arrives in the hook payload, so it is a path segment
 *   from outside; the reader applies the same pattern.
 *
 * The hook's own environment is not keyed: the reader re-checks the two API-key variables on every hit instead,
 * because Claude can reload its settings' `env` mid-life. Two live processes carrying one session id read `unread` (`./seatAttestRead.ts`), which is never
 * cached, and the reader's registry match binds a marker to ONE of them.
 *
 * ## A plan with a usage limit caches a BOUNDED pass, or none
 *
 * A seat on a plan under 100% is judged on its last recorded reading by the per-turn usage gate (`./seatUsageGate.ts`),
 * so its pass can only stand while that judgement does. Its marker carries three more fields — the plan, the epoch
 * second the pass was judged, and the epoch second it expires — and the reader misses outside that window or once the
 * plan's usage snapshot is at least as new as the marker. The lower bound is what keeps a wall clock stepped back
 * behind the marker from stretching the pass, since that same step would let a newer snapshot land with an mtime
 * older than the marker. A plan with no limit carries one more field, `-`, so a two-field marker — written before the gate
 * existed, saying nothing about a limit — is a miss. A monthly-spend plan caches nothing: no file the reader can test changes when a spend reading
 * lands, so each of its prompts is judged in full.
 *
 * Pure: `../cli/commands/claude/seatRun.ts` writes what this returns.
 */
import { join } from "node:path";

import { isPlanAlias } from "../plans/register.js";
import type { ClaudeAccountAlias } from "./contracts.js";
import type { SeatReading, SeatVerdict } from "./seatAttest.js";

/**
 * How long a pass may stand: indefinitely for a plan with no usage limit, across a window of epoch seconds for a
 * weekly-window plan with one, or not at all.
 */
export type SeatPassCachePolicy =
  | { readonly kind: "unlimited" }
  | {
      readonly kind: "limited-weekly";
      readonly alias: ClaudeAccountAlias;
      readonly validFromEpochSeconds: number;
      readonly validUntilEpochSeconds: number;
    }
  | { readonly kind: "uncacheable" };

/**
 * Whether a cache bound is an epoch second the bash reader can compare: a positive safe integer.
 *
 * @param seconds the bound
 * @returns true when it can be written
 */
function isEpochSecond({ seconds }: { seconds: number }): boolean {
  return Number.isSafeInteger(seconds) && seconds > 0;
}

/** A session id safe as one path segment, and the exact class the bash reader extracts. */
const SAFE_SESSION_ID = /^[0-9A-Za-z-]+$/;

/**
 * A process start the bash reader can split off a tab and match inside a JSON string unescaped: printable ASCII bar
 * `"`, `[`, `\` and `]` — `ps`'s `lstart` spelling needs none of those — so every byte it writes is one the reader
 * lists by name rather than by a range a UTF-8 locale could widen.
 */
const SAFE_PROC_START = /^[ !#-Z^-~]+$/;

/**
 * The third field of a pass for a plan with NO usage limit — outside the alias class, so it never names a plan. A
 * marker with only two fields was written before the usage gate existed and never said whether its plan was limited,
 * so the reader treats one as a miss rather than as a pass.
 */
const UNLIMITED_FIELD = "-";

/** One marker to write: where, and its exact contents. */
export interface SeatPassWrite {
  readonly path: string;
  readonly contents: string;
}

/**
 * Where one session's marker lives — undefined for a session id that could leave the directory, which no marker is
 * ever written or removed for.
 *
 * @param seatPassDir the markers' directory, `stateHomePaths().live.seatPassDir`
 * @param sessionId the session the hook payload named
 * @returns the marker's path, or undefined
 */
export function seatPassPath({
  seatPassDir,
  sessionId,
}: {
  seatPassDir: string;
  sessionId: string;
}): string | undefined {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    return undefined;
  }
  return join(seatPassDir, sessionId);
}

/**
 * Decide whether this judgement leaves a cached pass, and what it says.
 *
 * @param cache how long the pass may stand, which the caller derives from the plan's usage limit
 * @param seatPassDir the markers' directory, `stateHomePaths().live.seatPassDir`
 * @param sessionId the session the hook payload named
 * @param reading what the boot-credential read established, which carries the registry's pid and start
 * @param verdict the judgement of that reading
 * @returns the marker to write, or undefined when this judgement must be made again next prompt
 */
export function seatPassWrite({
  cache,
  seatPassDir,
  sessionId,
  reading,
  verdict,
}: {
  cache: SeatPassCachePolicy;
  seatPassDir: string;
  sessionId: string;
  reading: SeatReading;
  verdict: SeatVerdict;
}): SeatPassWrite | undefined {
  if (cache.kind === "uncacheable") {
    return undefined;
  }
  if (verdict.kind !== "on-plan" || reading.kind !== "read" || reading.process === undefined) {
    return undefined;
  }
  const { pid, procStart } = reading.process;
  const path = seatPassPath({ seatPassDir, sessionId });
  if (path === undefined || !SAFE_PROC_START.test(procStart) || !Number.isSafeInteger(pid) || pid <= 0) {
    return undefined;
  }
  if (cache.kind === "unlimited") {
    return { contents: `${String(pid)}\t${procStart}\t${UNLIMITED_FIELD}\n`, path };
  }
  const { alias, validFromEpochSeconds, validUntilEpochSeconds } = cache;
  const boundsWritable =
    isEpochSecond({ seconds: validFromEpochSeconds }) &&
    isEpochSecond({ seconds: validUntilEpochSeconds }) &&
    validFromEpochSeconds < validUntilEpochSeconds;
  if (!isPlanAlias({ alias }) || !boundsWritable) {
    return undefined;
  }
  const fields = [String(pid), procStart, alias, String(validFromEpochSeconds), String(validUntilEpochSeconds)];
  return { contents: `${fields.join("\t")}\n`, path };
}
