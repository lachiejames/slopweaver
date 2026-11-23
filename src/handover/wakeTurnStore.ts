/**
 * When `handover wake` last served each waking park — read its checks, or asked `handover finish` about it — the
 * memory that keeps a run that cannot reach every park from serving the same few on every tick.
 *
 * A run judges inside a bounded window and asks at most `WAKE_FINISH_ASKS` finishes
 * (`../cli/commands/handover/wakeJudge.ts`, `../cli/commands/handover/wakeFinish.ts`). Ordered by park age alone,
 * the oldest parks whose reads keep timing out, or whose finish keeps refusing, would take every read and every ask
 * on every tick and the rest would starve behind them. Reading this file, a run serves the
 * park longest since its last turn — or since due, never served — first (`./wakeOrder.ts`).
 *
 * **A snapshot, never a journal, and it RECOVERS.** It is rewritten whole and atomically after each run, pruned to
 * the parks still waking, so it never grows past the board. A file that will not read or decode costs the order of
 * ONE run: the caller says so, serves oldest first, and the rewrite that run makes replaces it — an append-only
 * ledger that one torn line made unreadable would have cost the order of every run after it. Two wakes writing at
 * once lose one's turns to the other's — a `--retry` beside a tick included, since each rewrites from the snapshot it
 * read before its own reads: the residue is one run's rotation, never a read, an ask or a
 * reseat. A lock around the read-and-rewrite is the mechanism that would close it.
 *
 * Its own file rather than a wake-journal kind: every checkout on the machine reads the wake journal with a strict
 * decoder that fails the whole read on a row it does not know, and a reseat is refused while it does.
 */
import { readFileSync } from "node:fs";

import { z } from "zod";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import { isUtcInstant } from "./parkWake.js";

/** When one park was last served: its checks read, and its finish asked. */
export interface WakeTurn {
  readonly readAtIso?: string | undefined;
  readonly askedAtIso?: string | undefined;
}

const INSTANT = z.string().refine((text) => isUtcInstant({ text }), { message: "not a UTC instant" });

const SNAPSHOT_SCHEMA = z
  .object({
    turns: z.record(
      z.string().min(1),
      z.object({ askedAtIso: INSTANT.optional(), readAtIso: INSTANT.optional() }).strict(),
    ),
    version: z.literal(1),
  })
  .strict();

/** Owner-only, like every other ledger. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The key one park's turns share: its run, its position in that run's journal, and its own instant — so a park
 * re-parked fresh starts unserved.
 *
 * @returns the key
 */
export function wakeParkKey({
  parkIndex,
  parkedAtIso,
  slug,
}: {
  parkIndex: number;
  parkedAtIso: string;
  slug: string;
}): string {
  return `${slug}:${String(parkIndex)}:${parkedAtIso}`;
}

/** What the file came to: its turns — none for a fresh install — or why it did not read, which the caller says. */
export type WakeTurnsRead =
  | { readonly kind: "read"; readonly turns: ReadonlyMap<string, WakeTurn> }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Each park's last turns, keyed by {@link wakeParkKey}.
 *
 * @param home the state home
 * @returns the turns, or why the file did not read or decode
 */
export function readWakeTurns({ home }: { home: string }): WakeTurnsRead {
  const path = stateHomePaths({ home }).handoverWakeTurnsJson;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { kind: "read", turns: new Map() };
    }
    return { kind: "unreadable", why: `the wake turns at ${path} did not read: ${String(error)}` };
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "the wake turns", text });
  } catch (error: unknown) {
    return { kind: "unreadable", why: `the wake turns at ${path} are not JSON: ${String(error)}` };
  }
  const decoded = SNAPSHOT_SCHEMA.safeParse(value);
  if (!decoded.success) {
    return { kind: "unreadable", why: `the wake turns at ${path} did not decode: ${decoded.error.message}` };
  }
  return { kind: "read", turns: new Map(Object.entries(decoded.data.turns)) };
}

/** The snapshot could not be replaced; the next run's order is what it costs. */
export interface WakeTurnsUnwritableError {
  readonly code: "WAKE_TURNS_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** The one way {@link writeWakeTurns} fails. */
const WakeTurnsErrors = {
  unwritable: ({ cause, path }: { cause: unknown; path: string }): WakeTurnsUnwritableError => ({
    code: "WAKE_TURNS_UNWRITABLE",
    message: `the wake turns at ${path} could not be written: ${String(cause)}`,
    path,
  }),
} as const;

/**
 * Replace the snapshot whole, atomically.
 *
 * @param turns every park's turns to keep — the caller prunes to the parks still waking
 * @returns ok, or why the write failed
 */
export function writeWakeTurns({
  home,
  turns,
}: {
  home: string;
  turns: ReadonlyMap<string, WakeTurn>;
}): Result<void, WakeTurnsUnwritableError> {
  const path = stateHomePaths({ home }).handoverWakeTurnsJson;
  const value = { turns: Object.fromEntries(turns), version: 1 };
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "the wake turns", value })}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path,
    });
  } catch (error: unknown) {
    return err(WakeTurnsErrors.unwritable({ cause: error, path }));
  }
  return ok(undefined);
}
