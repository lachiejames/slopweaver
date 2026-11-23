/**
 * `slopweaver profile hook` — the `SessionStart` emitter (boot, resume, clear, and the `compact` re-run every
 * compaction makes), in its own module because it is the one profile verb that parses nothing.
 *
 * It writes the delivery marker (`../../../context/profileDelivery.ts`) only AFTER its block is on stdout, and
 * `hooks/profile-context.sh` cleared it before node started, so a run the envelope kills leaves the session marked
 * as lacking their profile — which the PreToolUse `profile-held` check then holds and reloads.
 *
 * Loading what is known about them is MECHANICALLY ENFORCED rather than left
 * to a session remembering. This is that mechanism's shell — the harness runs it, it prints the always-loaded
 * block as `additionalContext`, and every project the plugin is installed into gets the same block.
 *
 * It also RECORDS every load it attempts, against the session the hook payload names
 * (`../../../context/loadLedger.ts`). A session can only act as the owner if it can load their profile — and a
 * load that failed open with nothing written down was invisible to everything that could
 * have refused on it or told them. The row is what the door gate and the `profile-unloaded` monitor read.
 *
 * It does not live in {@link ./run} because that module parses flags, and a verb whose loader reaches a flag
 * spec is one `help-flag-opt-out` tells you to GUARD — which would make it refuse an unknown flag, the exact
 * behaviour the paragraph below rules out. Separating the module is what makes the opt-out true rather than
 * merely asserted.
 */
import { markFirstBootSession } from "../../../admit/firstBootSession.js";
import { machineDefaultHomes, machineNeverConfigured } from "../../../admit/profileFirstBoot.js";
import { slopweaverHome } from "../../../config.js";
import { noProfileIn } from "../../../context/cachedContext.js";
import { type LoadedContext } from "../../../context/load.js";
import { ownerAbsentField, type ProfileLoadRow, profileBlockLines } from "../../../context/loadLedger.js";
import { appendProfileLoad } from "../../../context/loadLedgerStore.js";
import { type DeliveryContext, deliveryContextOf, markProfileDelivered } from "../../../context/profileDelivery.js";
import { contextOutput } from "../../../handover/hookShell.js";
import { sessionIdFromPayload } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { readStdin } from "../../../lib/readStdin.js";
import { hookEventName } from "../../../memory/hookPayload.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";

import { loadContextSettlingMarks } from "./contextLoad.js";

/** What a person who runs it by hand is told; the harness never reads this. */
const HOOK_USAGE = "usage: slopweaver profile hook";

/**
 * How long a session-start read may take before the cache answers instead.
 *
 * The hook lives inside a host deadline it does not control, so the inner bound has to be short enough that a
 * cached emit still happens rather than the whole hook being killed mid-read. Two seconds is comfortably above
 * a warm local query — `docs/store/query-and-streaming.md` measures every store read on this stack between 1.2 and 5.8 ms — and
 * well under any hook timeout; reproduce the query side with `slopweaver store status`.
 */
const HOOK_BOUND_MS = 2_000;

/** The events this hook is wired to; anything else in a payload is answered as a session start. */
const CONTEXT_EVENTS: ReadonlySet<string> = new Set(["SessionStart", "PostCompact"]);

/**
 * Parse the payload, tolerating anything — a wiring fault must never cost a session its profile.
 *
 * @returns the parsed value, or `undefined` for anything that is not JSON
 */
function parsePayload({ raw }: { raw: string }): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * What one run of the hook prints and records, decided from the payload and the load.
 *
 * @param payload the parsed hook payload, `undefined` when there was none
 * @param loaded what the load produced
 * @param atIso when the load ran
 * @param firstBoot whether nothing loaded on a machine never configured, which injects the first-boot lines instead
 * @returns the event to answer under, the injected lines (the loud warning first when nothing loaded), and the row
 *   to record — `undefined` when the payload names no session, since a row nobody can be matched to proves nothing,
 *   and on a first boot, which lost no profile
 */
export function profileHookOutcome({
  payload,
  loaded,
  atIso,
  firstBoot,
}: {
  payload: unknown;
  loaded: LoadedContext;
  atIso: string;
  firstBoot: boolean;
}): { event: string; lines: readonly string[]; row: ProfileLoadRow | undefined } {
  const declared = hookEventName({ payload });
  const event = declared !== null && CONTEXT_EVENTS.has(declared) ? declared : "SessionStart";
  const lines = profileBlockLines({ firstBoot, loaded });
  const sessionId = sessionIdFromPayload({ payload });
  // A first boot records nothing: no profile was lost, and an absent ledger is what the bash recovery lane reads as one.
  if (sessionId === undefined || firstBoot) {
    return { event, lines, row: undefined };
  }
  const cwd = isRecord(payload) && typeof payload["cwd"] === "string" ? payload["cwd"] : "";
  const recorded = matchedEvent({ event, payload });
  return {
    event,
    lines,
    row: {
      atIso,
      cwd,
      event: recorded,
      origin: loaded.origin,
      reason: loaded.reason,
      sessionId,
      source: "hook",
      ...ownerAbsentField({ loaded }),
    },
  };
}

/**
 * The event as a transcript names the run — `SessionStart:compact`, with the payload's `source` as its matcher — so a
 * compaction's run is told apart from a boot's or a resume's when the ledger decides which loads share a burst.
 */
function matchedEvent({ event, payload }: { event: string; payload: unknown }): string {
  const source = isRecord(payload) ? payload["source"] : undefined;
  return event === "SessionStart" && typeof source === "string" && source.length > 0 ? `${event}:${source}` : event;
}

/**
 * The session a hook's first-boot verdict marks, as the PreToolUse hold marks the sessions it admits on one: the
 * session-start hook may be the only first-boot verdict a session meets before a door write, and an unmarked session
 * reads unobserved — which the door passes — once another session configures the machine.
 *
 * @param firstBoot whether this load was a first boot
 * @param payload the parsed hook payload
 * @returns the session to mark, or `undefined` when this was no first boot or the payload names no session
 */
export function firstBootSessionToMark({
  firstBoot,
  payload,
}: {
  firstBoot: boolean;
  payload: unknown;
}): string | undefined {
  return firstBoot ? sessionIdFromPayload({ payload }) : undefined;
}

/** Mark a session in the resolved and default homes, best-effort like the hold's: a failed mark never wedges a first boot. */
function markHookFirstBoot({ sessionId }: { sessionId: string }): void {
  const defaults = machineDefaultHomes();
  // A first boot read every default home, so they were named; were they not, there is nowhere further to mark.
  if (defaults.isErr()) {
    return;
  }
  markFirstBootSession({ homes: [slopweaverHome(), ...defaults.value], sessionId });
}

/**
 * Load their profile for a hook and record the attempt against the session the payload names — the step the Claude
 * `profile hook` and the Codex `codex rules-context` hook share, so a Codex session is held to the same record.
 *
 * Throws nothing it can avoid: a payload that cannot be read is no payload, and losing the row never loses the
 * profile, so the block it returns is printable whatever stdin did. The row is written AFTER the load, and a failed
 * write of it is dropped — the row is for whoever reads the ledger next, never a reason to hold up the boot.
 *
 * It does NOT write the delivery marker: nothing has been printed yet, and a marker ahead of its output is the one
 * false "present" `../../../context/profileDelivery.ts` exists to rule out. The caller prints, then calls
 * {@link markHookDelivery}.
 *
 * @param readInput supplies the hook payload
 * @returns the event to answer under, the lines to inject (the loud warning first when nothing loaded), and the session
 *   the block delivers their profile to — `undefined` when nothing loaded or the payload names no session
 */
export async function loadProfileForHook({
  readInput,
}: {
  readInput: () => Promise<string>;
}): Promise<{ event: string; lines: readonly string[]; deliversTo: DeliveryContext | undefined }> {
  let raw = "";
  try {
    raw = await readInput();
  } catch {
    raw = "";
  }
  const loaded = await loadContextSettlingMarks({ boundMs: HOOK_BOUND_MS });
  const payload = parsePayload({ raw });
  const firstBoot = noProfileIn({ loaded }) && machineNeverConfigured({ home: slopweaverHome() });
  const outcome = profileHookOutcome({ atIso: new Date().toISOString(), firstBoot, loaded, payload });
  const firstBootSession = firstBootSessionToMark({ firstBoot, payload });
  if (firstBootSession !== undefined) {
    markHookFirstBoot({ sessionId: firstBootSession });
  }
  if (outcome.row !== undefined) {
    appendProfileLoad({ home: slopweaverHome(), row: outcome.row });
  }
  let deliversTo: DeliveryContext | undefined;
  if (outcome.row !== undefined && loaded.origin !== "none") {
    deliversTo = deliveryContextOf({ payload });
  }
  return { deliversTo, event: outcome.event, lines: outcome.lines };
}

/**
 * Record that a hook's printed block put their profile into a session's context — called only AFTER the block was
 * written to stdout. A failed write is dropped: no marker is the safe side, and the session's next action reloads.
 *
 * @param deliversTo the context {@link loadProfileForHook} said the block delivers to, `undefined` for none
 */
export function markHookDelivery({ deliversTo }: { deliversTo: DeliveryContext | undefined }): void {
  if (deliversTo === undefined) {
    return;
  }
  markProfileDelivered({ context: deliversTo, home: slopweaverHome() });
}

/**
 * The payload reader both hooks use: stdin, or nothing when stdin is a terminal — run by hand, a hook must not wait
 * on a payload no harness is going to send.
 *
 * @returns the payload text
 */
export async function hookPayloadFromStdin(): Promise<string> {
  return process.stdin.isTTY === true ? "" : readStdin();
}

/**
 * Run the hook with an injected payload reader. ALWAYS returns 0.
 *
 * ALWAYS exits zero, and that is the rule rather than a nicety. A session start that a profile read can fail
 * is worse than one whose profile is missing: the whole point is that the owner's own context arrives without
 * anyone remembering to fetch it, and a hook that can break a session would be turned off. So a refusal, a
 * timeout and an unreachable database all produce an injected block that SAYS SO, which a session can act on,
 * rather than an error a session never sees. Loud is the injected text and the recorded row, never the exit code.
 *
 * @param argv the full process argv
 * @param readInput supplies the hook payload — a seam so a throwing reader can stand in for every failure
 * @returns always `EXIT_OK`
 */
export async function runProfileHookWith({
  argv,
  readInput,
}: {
  argv: readonly string[];
  readInput: () => Promise<string>;
}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    logger.out({ line: HOOK_USAGE });
    return EXIT_OK;
  }
  try {
    const block = await loadProfileForHook({ readInput });
    const line = contextOutput({ event: block.event, lines: block.lines });
    if (line !== null) {
      logger.out({ line });
      markHookDelivery({ deliversTo: block.deliversTo });
    }
  } catch {
    // Deliberately silent: a hook that printed a stack trace into a session's context would be worse
    // than one that said nothing, and the next session start tries again.
  }
  return EXIT_OK;
}

/**
 * Print the always-loaded context as the harness's own `additionalContext`, in every project the plugin is
 * installed into, and record the attempt. Run by hand on a terminal it reads no payload rather than waiting on one.
 *
 * @param argv the full process argv
 * @returns always `EXIT_OK`
 */
export async function runProfileHook(argv: readonly string[]): Promise<number> {
  return runProfileHookWith({ argv, readInput: hookPayloadFromStdin });
}

export const profileHookCommand = defineCommand({ run: runProfileHook });
