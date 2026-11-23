/**
 * Reading every registered Codex destination's rollout logs into burn sessions — the effectful half of
 * `./modelBurn.ts`.
 *
 * Each rollout file is one session, and two bounded slices of it are enough:
 *
 *  - **its HEAD** holds `session_meta` (who opened it: `thread_source: slopweaver` is a Slopweaver pass, anything
 *    else a seat) and the first `turn_context`, which names the `model` and `effort` the session ran on. MEASURED
 *    across a sample of this machine's rollouts, the first `turn_context` starts 71–79 KB in, behind a
 *    `session_meta` line carrying the whole base instruction text — so {@link HEAD_READ_BYTES} is 192 KB.
 *    Reproduce: `grep -b -m1 '"type":"turn_context"' <rollout>.jsonl`.
 *    A head holding no `turn_context` is doubled until it does or the file runs out, so a longer base
 *    instruction text never leaves a session unattributed.
 *  - **its TAIL** holds the budget readings. Only the newest few matter, because the report credits each rise
 *    to the reading that closes it and the rises telescope — so a 256 KB tail, not `./quotaLog.ts`'s 2 MB one:
 *    a three-week scan opens thousands of files, and 2 MB each is most of the 2.9 GB this machine holds. A tail
 *    holding no reading at all — one oversized line can outgrow it — is widened until it does
 *    (`readRolloutTailUntil`), so a session is never read as reading-less because of one long tool output.
 *    It widens further until the first visible reading's windows were all open when the session began
 *    (`tailCoversSession`): then readings an oversized line hides EARLIER are of those same windows and need
 *    not be recovered, because the rises telescope and the next visible reading closes the same total against
 *    the file before it. The one place that loses points is a file that OPENS its timeline, whose first
 *    visible reading becomes the baseline — the same as the scan starting one reading later. It under-counts
 *    that edge; it never masks a cap and never invents a draw.
 *
 * EVERY registered Codex row is read, a paused one included — a paused account's history is still history,
 * and it is exactly where the older model ran. Read-only, no network, no credential: `auth.json` is never
 * opened.
 */
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { Result } from "#lib/result.js";
import { ok } from "#lib/result.js";

import { parseIsoMs } from "../lib/date.js";
import { isRecord } from "../lib/parsers.js";
import type { PlanRegisterError } from "../plans/errors.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { plansForProvider } from "../plans/register.js";
import { type CodexWindowReading, parseGaugeLine } from "./gauge.js";
import type { BurnReading, BurnSession } from "./modelBurn.js";
import { readRolloutTailUntil, rolloutsModifiedWithin } from "./quotaLog.js";

/** One day, in the milliseconds a file's mtime is compared in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** How much of a rollout's start is read for its `session_meta` and first `turn_context`. See the header. */
const HEAD_READ_BYTES = 192 * 1024;

/** How much of a rollout's end is read first for its budget readings, widened when it holds none. See the header. */
const TAIL_READ_BYTES = 256 * 1024;

/** What a scan read, and what it could not. */
export interface ModelBurnScan {
  readonly sessions: readonly BurnSession[];
  readonly filesRead: number;
  /** Every destination read, by alias, so a report can say which accounts it covers. */
  readonly destinations: readonly string[];
}

/**
 * Read up to `bytes` of a file from its start. "" on any read failure — a file the scan cannot read is a
 * session it does not count, never a crash.
 *
 * @param path the rollout file
 * @param bytes how many leading bytes at most
 * @returns the slice as text and whether it reached the file's end; its last line may be a fragment
 */
function readLeadingBytes({ path, bytes }: { path: string; bytes: number }): { text: string; whole: boolean } {
  try {
    const size = statSync(path).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, 0);
    } finally {
      closeSync(fd);
    }
    return { text: buffer.toString("utf8"), whole: length === size };
  } catch {
    return { text: "", whole: true };
  }
}

/**
 * A rollout's head, doubled from {@link HEAD_READ_BYTES} until it holds a complete `turn_context` line or
 * the file runs out — the head's mirror of the tail's `readRolloutTailUntil`, because a `session_meta` line
 * carrying a longer base instruction text than the bound would otherwise hide the model and leave the session
 * unattributed.
 *
 * @param path the rollout file
 * @returns the head's lines
 */
function headLines({ path }: { path: string }): readonly string[] {
  for (let bytes = HEAD_READ_BYTES; ; bytes *= 2) {
    const slice = readLeadingBytes({ bytes, path });
    const lines = slice.text.split("\n");
    if (slice.whole || firstPayload({ eventType: "turn_context", lines }) !== undefined) {
      return lines;
    }
  }
}

/** The `payload` of the first complete line whose event `type` is `eventType`, or undefined. */
function firstPayload({
  lines,
  eventType,
}: {
  lines: readonly string[];
  eventType: string;
}): Record<string, unknown> | undefined {
  const marker = `"type":"${eventType}"`;
  for (const line of lines) {
    if (!line.includes(marker)) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value) && value["type"] === eventType && isRecord(value["payload"])) {
        return value["payload"];
      }
    } catch {
      // A fragment at the slice's edge, or a line that is not JSON — not this session's metadata.
    }
  }
  return undefined;
}

/** A string field of a payload, or undefined. */
function stringOf({ payload, key }: { payload: Record<string, unknown> | undefined; key: string }): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Every weekly and five-hour window reading in a tail, one reading per line. */
function readingsIn({ nowMs, tail }: { nowMs: number; tail: string }): readonly BurnReading[] {
  return tail.split("\n").flatMap((line) => {
    const gauge = parseGaugeLine({ line });
    if (gauge === undefined) {
      return [];
    }
    // A reading claiming a time after the scan is a skewed clock or a hand-edited file; sorted in with the
    // rest it would invent a rise (a Codex review), so it is no reading — as `./gaugeScan.ts` drops it too.
    const observedMs = parseIsoMs({ tsIso: gauge.observedAtIso });
    if (observedMs !== undefined && observedMs > nowMs) {
      return [];
    }
    return gauge.windows.flatMap((window): BurnReading[] => {
      if (window.label !== "weekly" && window.label !== "five-hour") {
        return [];
      }
      return [
        {
          observedAtIso: gauge.observedAtIso,
          planType: gauge.planType,
          resetAtIso: window.resetAtIso,
          usedPercent: window.usedPercent,
          window: window.label,
        },
      ];
    });
  });
}

/** The session id `session_meta` names, or the file's own path when it names none — an `if`, said out loud. */
function sessionIdOf({ meta, path }: { meta: Record<string, unknown> | undefined; path: string }): string {
  const named = stringOf({ key: "id", payload: meta });
  if (named === undefined) {
    return path;
  }
  return named;
}

/**
 * Whether a tail is wide enough for its readings to stand for the whole session: it holds one the report will
 * keep — dated, not after the scan, its window not yet reset when read — and that one's windows were all
 * already open when the session began. A reading the report drops cannot end the widening (a Codex review). Then any reading an oversized line hid earlier
 * in the file is of those SAME windows, and the rises telescope into the first visible one. A first visible
 * reading of a window that opened mid-session could follow a hidden rise of the window before it, which no
 * later reading closes — a Codex review built exactly that, so the tail widens past it. An unknown session
 * start proves nothing, so the tail widens to the whole file (the largest measured is 9.98 MB).
 */
function tailCoversSession({
  nowMs,
  sessionStartMs,
  text,
}: {
  nowMs: number;
  sessionStartMs: number | undefined;
  text: string;
}): boolean {
  if (sessionStartMs === undefined) {
    return false;
  }
  for (const line of text.split("\n")) {
    const gauge = parseGaugeLine({ line });
    const observedMs = gauge === undefined ? undefined : parseIsoMs({ tsIso: gauge.observedAtIso });
    if (gauge === undefined || observedMs === undefined || observedMs > nowMs) {
      continue;
    }
    const open = gauge.windows.filter((window) => {
      const resetMs = window.resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: window.resetAtIso });
      return resetMs !== undefined && resetMs > observedMs;
    });
    if (open.length > 0) {
      return open.every((window) => openedBy({ sessionStartMs, window }));
    }
  }
  return false;
}

/** Whether a window had opened by `sessionStartMs`; one whose length or reset is unknown proves nothing. */
function openedBy({ sessionStartMs, window }: { sessionStartMs: number; window: CodexWindowReading }): boolean {
  const resetMs = window.resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: window.resetAtIso });
  if (resetMs === undefined || window.windowMinutes === undefined) {
    return false;
  }
  return resetMs - window.windowMinutes * 60_000 <= sessionStartMs;
}

/**
 * One rollout file as a burn session.
 *
 * @param destination the alias of the destination whose home holds it
 * @param path the rollout file
 * @returns the session, its model undefined when the head carried no `turn_context`
 */
function sessionOf({ destination, nowMs, path }: { destination: string; nowMs: number; path: string }): BurnSession {
  const head = headLines({ path });
  const meta = firstPayload({ eventType: "session_meta", lines: head });
  const turn = firstPayload({ eventType: "turn_context", lines: head });
  const startIso = stringOf({ key: "timestamp", payload: meta });
  const sessionStartMs = startIso === undefined ? undefined : parseIsoMs({ tsIso: startIso });
  return {
    destination,
    effort: stringOf({ key: "effort", payload: turn }),
    model: stringOf({ key: "model", payload: turn }),
    origin: stringOf({ key: "thread_source", payload: meta }) === "slopweaver" ? "pass" : "seat",
    readings: readingsIn({
      nowMs,
      tail: readRolloutTailUntil({
        holds: (text) =>
          tailCoversSession({
            nowMs,
            sessionStartMs,
            text,
          }),
        initialBytes: TAIL_READ_BYTES,
        path,
      }),
    }),
    sessionId: sessionIdOf({ meta, path }),
  };
}

/**
 * A home's real path, so two spellings of one directory are one home; its resolved spelling when absent.
 *
 * @param storeDir the Codex home a plan register row names
 * @returns the path every spelling of it resolves to
 */
export function realHomeOf({ storeDir }: { storeDir: string }): string {
  try {
    return realpathSync(storeDir);
  } catch {
    return resolve(storeDir);
  }
}

/**
 * Read every registered Codex destination's recent rollout logs into burn sessions.
 *
 * Each physical home is read ONCE, under the first row naming it: two rows whose spellings resolve to one
 * directory (`/x` and `/x/.`) would otherwise credit every rise twice — a Codex review found that shape.
 *
 * @param home the state home holding the plan register
 * @param nowMs the scan instant; a reading claiming a later one is dropped, and a test passes a fixed instant
 * @param days how many days behind each home's newest rollout a file may have been modified and still be read —
 *   the scan's only bound, by mtime rather than directory name (`./quotaLog.ts`'s `rolloutsModifiedWithin`)
 * @param port where the register is read — `planRegisterPort()` at a composition root, a seam in a test
 * @returns the sessions and what was read, or the register's own typed error — a store outage included
 */
export async function scanModelBurn({
  days,
  home,
  nowMs = Date.now(),
  port,
}: {
  days: number;
  home: string;
  nowMs?: number;
  port: PlanRegisterPort;
}): Promise<Result<ModelBurnScan, PlanRegisterError>> {
  const read = await port.read({ home });
  return read.andThen((register) => {
    const seen = new Set<string>();
    const plans = plansForProvider({ plans: register.plans, provider: "codex" }).filter((plan) => {
      const real = realHomeOf({ storeDir: plan.storeDir });
      if (seen.has(real)) {
        return false;
      }
      seen.add(real);
      return true;
    });
    const sessions = plans.flatMap((plan) =>
      rolloutsModifiedWithin({ codexHome: plan.storeDir, nowMs, windowMs: days * DAY_MS }).map((candidate) =>
        sessionOf({ destination: plan.alias, nowMs, path: candidate.path }),
      ),
    );
    return ok({ destinations: plans.map((plan) => plan.alias), filesRead: sessions.length, sessions });
  });
}
