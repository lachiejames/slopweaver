/**
 * The `profile-held` check's runner: read the PreToolUse payload, ask the session's delivery marker, and hold the call
 * when the session's context lacks the owner's profile — delivering it in the refusal when any copy exists. The decision and
 * the ruling it implements are `./profileHeld.ts`.
 *
 * FAILS CLOSED on everything: a load that throws holds the call with the STOP block, because doing
 * nothing beats acting misaligned, and a payload naming no session is refused outright — both hosts require
 * `session_id`, so one without it is malformed (`./profileHeld.ts`, `PROFILE_HELD_ANONYMOUS_LINES`). A subagent's call
 * is read against its OWN context's marker, never its parent's, and a marker a compaction has since outdated is no
 * marker (`../context/profileDelivery.ts`). A marker that cannot be written is recorded as a failed load rather than
 * dropped, since every retry is held again until it can.
 *
 * Cheap on the path every call takes: the marker, and the transcript bytes the turn before this call appended. The
 * load it falls back to is `../context/cachedContext.ts`, which opens no store, so this check adds no database driver
 * to the dispatcher's bundle.
 */
import { isRecord } from "#lib/parsers.js";
import type { Result } from "#lib/result.js";

import { type LoadedContext, loadCachedContext } from "../context/cachedContext.js";
import { ownerAbsentField } from "../context/loadLedger.js";
import { appendProfileLoad } from "../context/loadLedgerStore.js";
import {
  type DeliveryContext,
  deliveryContextOf,
  MARKER_UNWRITTEN_REASON,
  markProfileDelivered,
  profileWasDelivered,
} from "../context/profileDelivery.js";
import { stateHomePaths } from "../stateHome.js";
import { markFirstBootSession } from "./firstBootSession.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";
import { type FirstBootReadError, readFirstBootEvidence } from "./profileFirstBoot.js";
import { type FirstBootEvidence, PROFILE_HELD_ANONYMOUS_LINES, profileHeldDecision } from "./profileHeld.js";

/** What the cached read's banner says the live read was replaced by. */
const HELD_REASON = "the session-start load did not reach this context, so a guarded call reloaded from the cache";

/**
 * Run the check over one PreToolUse payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param afterEmit queues the delivery marker to be written once the refusal has really been printed
 * @param home the Slopweaver home the marker, the cache and the ledger live under
 * @param nowIso the instant the load and its ledger row are stamped at
 * @param defaultHomes `~/.slopweaver` under `$HOME` and the account's own home (`machineDefaultHomes`), read for
 *   first-boot evidence beside `home`, so a session pointed at an empty home on a machine whose default one holds the owner's
 *   profile is held rather than read as a first boot; an error is a machine that cannot be ruled fresh
 * @param env the environment the store selection is read from
 * @param load the cache-only loader; a test passes a plain fake so no cache file is needed
 * @returns the exit code (2 hold, 0 allow)
 */
export async function runProfileHeld({
  readStdin,
  writeError,
  afterEmit,
  home,
  defaultHomes,
  env,
  nowIso,
  load = loadCachedContext,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  afterEmit: (commit: () => void) => void;
  home: string;
  defaultHomes: Result<readonly string[], FirstBootReadError>;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
  load?: typeof loadCachedContext;
}): Promise<number> {
  const payload = await readPayload({ readStdin });
  const context = deliveryContextOf({ payload });
  if (!isRecord(payload) || context === undefined) {
    writeError(`${PROFILE_HELD_ANONYMOUS_LINES.join("\n")}\n`);
    return EXIT_BLOCK;
  }
  const sessionId = String(payload["session_id"]);
  const cwd = typeof payload["cwd"] === "string" ? payload["cwd"] : "";
  const delivered = profileWasDelivered({ context, home });
  // Every home a first boot is read across; none when the defaults cannot be named, which is never a first boot.
  const evidenceHomes = defaultHomes.isOk() ? [home, ...defaultHomes.value] : undefined;
  const decision = profileHeldDecision({
    command: bashCommandOf({ payload }),
    // An unreadable marker is no marker: the safe side is a reload, never a pass.
    delivered: delivered.isOk() && delivered.value,
    firstBoot: () => firstBootOf({ homes: evidenceHomes }),
    load: () =>
      loadOrStop({
        load: () =>
          load({ cachePath: stateHomePaths({ home }).profileContextJson, env, home, nowIso, reason: HELD_REASON }),
      }),
  });
  // A first boot runs with no delivery marker and no ledger row, since no profile was loaded and none was lost. It does
  // mark the session, which is no configuration trace: the door holds it if this call configures the machine and a
  // later write in it acts without loading the profile it made (`./firstBootSession.ts`).
  if (decision.kind === "first-boot") {
    // Invariant: `firstBootOf` answers only off a settled read, so a first boot always named its homes.
    markFirstBootSession({ homes: evidenceHomes!, sessionId });
    return EXIT_ALLOW;
  }
  if (decision.kind === "pass") {
    return EXIT_ALLOW;
  }
  writeError(`${decision.lines.join("\n")}\n`);
  holdCall({ afterEmit, context, decision, ledger: { cwd, home, nowIso, sessionId } });
  return EXIT_BLOCK;
}

/**
 * Record one held call: a failed load at once, a delivery only once its refusal has left the process.
 *
 * @param decision the hold — `stop` when no copy loaded, `deliver` when the refusal carries the owner's profile
 * @param context the context a delivery's marker is written for
 * @param ledger where the row goes and what it is stamped with
 * @param afterEmit queues the delivery's marker and row behind the printed refusal
 */
function holdCall({
  decision,
  context,
  ledger,
  afterEmit,
}: {
  decision: { readonly kind: "stop" | "deliver"; readonly loaded: LoadedContext };
  context: DeliveryContext;
  ledger: LedgerTarget;
  afterEmit: (commit: () => void) => void;
}): void {
  if (decision.kind === "stop") {
    // A failure is true whether or not its text arrives, and the `profile-unloaded` monitor reads it as the hold firing.
    recordLoad({ ...ledger, loaded: decision.loaded });
    return;
  }
  // Queued, never written here: `writeError` only collects, and the row and the marker both say the owner's profile reached
  // this context, so neither may exist before the refusal carrying it has left the process whole (a truncated
  // refusal must not unlock the retry, nor clear the monitor).
  afterEmit(() => {
    commitDelivery({ ...ledger, context, loaded: decision.loaded });
  });
}

/** Where one hold's ledger row is written, and what it is stamped with. */
interface LedgerTarget {
  readonly home: string;
  readonly nowIso: string;
  readonly cwd: string;
  readonly sessionId: string;
}

/**
 * Write the marker for a delivered refusal, then the ledger row saying so — or, when the marker cannot be written,
 * a failed load naming why, since every retry will be held again rather than recording a load that cannot stick.
 *
 * @param context the context the refusal delivered the owner's profile into
 * @param loaded what the refusal carried
 */
function commitDelivery({
  context,
  loaded,
  ...ledger
}: LedgerTarget & { context: DeliveryContext; loaded: LoadedContext }): void {
  const marked = markProfileDelivered({ context, home: ledger.home });
  if (marked.isErr()) {
    const reason = `${MARKER_UNWRITTEN_REASON}${marked.error.message}`;
    recordLoad({ ...ledger, loaded: { lines: [], origin: "none", reason } });
    return;
  }
  recordLoad({ ...ledger, loaded });
}

/**
 * Append one hold's row to the profile load ledger.
 *
 * @param loaded what the hold loaded, whose origin and reason the row carries
 */
function recordLoad({ home, nowIso, cwd, sessionId, loaded }: LedgerTarget & { loaded: LoadedContext }): void {
  appendProfileLoad({
    home,
    row: {
      atIso: nowIso,
      cwd,
      event: "PreToolUse",
      origin: loaded.origin,
      reason: loaded.reason,
      sessionId,
      source: "hook",
      ...ownerAbsentField({ loaded }),
    },
  });
}

/**
 * The first-boot evidence across every home, or none when it cannot be settled — an evidence read that cannot be
 * settled is a configured home, so the safe side is the hold, never a pass.
 *
 * @param homes the resolved home then every machine default, or `undefined` when the defaults could not be named
 * @returns the evidence, or `undefined` when it could not be read
 */
function firstBootOf({ homes }: { homes: readonly string[] | undefined }): FirstBootEvidence | undefined {
  if (homes === undefined) {
    return undefined;
  }
  const evidence = readFirstBootEvidence({ homes });
  return evidence.isOk() ? evidence.value : undefined;
}

/**
 * The PreToolUse payload, parsed.
 *
 * @param readStdin reads the raw payload
 * @returns the parsed value, or `undefined` when it is not JSON — which names no session, so the call is refused
 */
async function readPayload({ readStdin }: { readStdin: () => Promise<string> }): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readStdin());
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * A Bash call's command only, as the bash lane's `profile_is_reload` reads it: a Monitor's `command` naming the reload
 * is still a Monitor, held like any other.
 *
 * @param payload the parsed PreToolUse payload
 * @returns the command, or `undefined` for any other tool
 */
function bashCommandOf({ payload }: { payload: Record<string, unknown> }): string | undefined {
  const input = payload["tool_input"];
  if (payload["tool_name"] !== "Bash" || !isRecord(input) || typeof input["command"] !== "string") {
    return undefined;
  }
  return input["command"];
}

/**
 * The load, or the `none` block when it throws — so a defect in the reader holds the call rather than passing it.
 *
 * @param load the read to attempt
 * @returns what it loaded, or origin `none` naming the throw
 */
function loadOrStop({ load }: { load: () => LoadedContext }): LoadedContext {
  try {
    return load();
  } catch (error: unknown) {
    const reason = `reading the cached profile threw: ${error instanceof Error ? error.message : String(error)}`;
    return { lines: [], origin: "none", reason };
  }
}
