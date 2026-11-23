/**
 * `slopweaver session respawn loop` — the Slack loop's own way to get back onto current `main` without a
 * human noticing it had drifted off it.
 *
 * ## Why a verb rather than a paragraph in a skill
 *
 * Because a paragraph is what was there, and it did not work. The loop has had a "respawn at a quiet moment"
 * instruction and was measured still running a two-day-old worktree, 74 commits behind, through a day of
 * public failures. The respawn has to be impossible to get wrong, and prose cannot check three preconditions and
 * refuse.
 *
 * ## The loop is the ONLY target, because it is the only standing session left
 *
 * There is no standing recipe-scheduler and no dispatcher for one. An automation now runs in a session `automation seat` opens per supervisor pass, which closes
 * when it is done and so has nothing to respawn: there is no registration to retire and no successor to boot.
 *
 * ## What it does, and what it deliberately leaves to the session
 *
 * It owns everything mechanical and checkable: the three gates (`live/standing/respawn.ts`), booting the
 * successor into a worktree cut from the freshly-fetched remote, verifying the pickup landed, recording the
 * retirement on the session ledger, and publishing `respawned` onto the supervisor stream.
 *
 * ## The loop's respawn is TWO phases, and `respawned` is published only by the second
 *
 * Measured: `session respawn loop --successor <the 31aug-d loop doc>` booted a
 * session into the right worktree at the right HEAD, published `respawned`, and every downstream gate read
 * green — while the session in there was analysing a table row it had been sent as its pickup and no second
 * listener ever armed. Nothing in the chain asked whether the booted session was RUNNING THE LOOP, and the
 * one signal that answers that — a new `armed` row carrying an arm id that is not the predecessor's — cannot
 * exist at boot time, because `listen arm` refuses while the predecessor's arm is live and the predecessor is
 * the only session that may disarm it.
 *
 * So the boot (phase one) REPLACES the pending record (`live/standing/respawnStore.ts`) — a per-boot id, the
 * predecessor's arm id, the successor's slug, and the tree the boot's own `spawned` session-ledger row names —
 * and publishes nothing. The earlier record is removed BEFORE the boot, so a boot that fails, throws or cannot
 * name its tree leaves nothing standing rather than an earlier seat's answer.
 * `--confirm` (phase two) reads it back, reads `listen status`, resolves the live arm's pid to the checkout it
 * runs from, and publishes `respawned` only when that arm is not the predecessor's, is up, and runs from the
 * successor's own tree (`live/standing/respawn.ts`'s `successorArmVerdict`). A record already confirmed answers
 * 0 again only while the arm it confirmed is the live one (`confirmedRecordVerdict`:
 * an earlier successor's confirmation was answering for a boot whose arm never went live). The successor runs
 * `--confirm` right after it arms — that is the "successor reports its own arm id" the loop chain's own protocol
 * asks for — and any hand-run gate or supervisor tick can run the same verb and read the same answer.
 *
 * It does NOT stop the outgoing session's own process, nor disarm its listener, and that is doctrine rather
 * than an omission: the listener is the loop session's own child (`docs/listener-supervision.md`), so the
 * session that owns it is the only thing that may stop it, and the same rule keeps a respawn from being a way
 * to kill a session remotely. What this verb does instead is print, in one line, the two steps the caller must
 * run itself — `listen disarm` first so supervision does not read the outgoing arm as an unexplained death,
 * then stopping its own child.
 *
 * The successor is booted BEFORE the outgoing one is asked to stand down, on purpose: a tag arriving with no
 * listener is a no-op by design (AGENTS.md rule 2), so the dark window between the two is real, and the only
 * lever anything here has over it is ordering.
 */
import { randomUUID } from "node:crypto";

import { currentSessionId, runOwnership } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { isIgnoredAsk } from "../../../live/ask/ignore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { readListenerArm } from "../../../live/listen/supervise/store.js";
import { productionStandingInspectDeps, type StandingInspectDeps } from "../../../live/standing/inspect.js";
import { asksHoldingWorkers, type RespawnVerdict, respawnVerdict } from "../../../live/standing/respawn.js";
import { clearPendingLoopRespawn, writePendingLoopRespawn } from "../../../live/standing/respawnStore.js";
import { loopLiveness } from "../../../live/standing/sessionLiveness.js";
import { parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { spawnExitWhy } from "../cmux/run.js";
import { holderLiveness } from "../handover/lifecycleRunCore.js";
import { boolFlag, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { respawnLoop, targetTreeRefusal } from "./respawnBoot.js";
import { confirmLoopRespawn } from "./respawnConfirm.js";
import { holderWorktreeWords, predecessorArmWords, spawnedSuccessorTree } from "./respawnWords.js";
import { LOOP_SESSION, loopRespawnFreshness, reportProblems } from "./standingFreshness.js";

/** Which standing session a respawn is about. One — the target is still named, never assumed. */
const TARGETS: readonly string[] = [LOOP_SESSION];

/**
 * How many asks the loop still has a live WORKER on — the quiet-moment test for its half.
 *
 * See `live/standing/respawn.ts`'s `asksHoldingWorkers` for why this reads `activeDispatch` rather than
 * `activeAsks`, and for the measurement where the earlier register made this gate impossible to open.
 *
 * @param home the resolved state home
 * @returns the count of non-ignored asks still holding a dispatch
 */
function loopInFlight({ home }: { readonly home: string }): number {
  const ignored = currentlyIgnoredAsks({ home });
  const lifecycles = [
    ...foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events }).values(),
  ];
  return asksHoldingWorkers({
    isIgnored: ({ channel, messageTs }) => isIgnoredAsk({ askIdentity: { channel, messageTs }, ignored }),
    lifecycles,
  });
}

/**
 * The live session already holding a doc's run, if any — gate 3.
 *
 * `elsewhere` plus a `live` writer is the only answer that blocks: an `elsewhere` writer this machine can
 * prove is DEAD is exactly what a respawn is replacing, and refusing on it would make the gate a deadlock
 * rather than a guard. An `unknown` liveness blocks too, because "I could not tell whether a session is on
 * this doc" is not a licence to put a second one there.
 *
 * @param home the resolved state home
 * @param slug the successor doc's slug
 * @returns a description of the holder, or `undefined` when the run is free to take
 */
function heldByLiveSession({ home, slug }: { readonly home: string; readonly slug: string }): string | undefined {
  const journal = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug });
  if (journal.isErr()) {
    return undefined;
  }
  const ownership = runOwnership({ events: journal.value.events, sessionId: currentSessionId({ env: process.env }) });
  if (ownership.kind !== "elsewhere") {
    return undefined;
  }
  const liveness = holderLiveness({ ownership });
  if (liveness?.kind === "dead") {
    return undefined;
  }
  const where = holderWorktreeWords({ writer: ownership.writer });
  return liveness?.kind === "unknown"
    ? `session ${ownership.writer.sessionId} at ${where}, liveness UNKNOWN (${liveness.why})`
    : `session ${ownership.writer.sessionId} at ${where}`;
}

/** What one target's gates measured, before a verdict is taken. */
interface RespawnContext {
  readonly fresh: ReturnType<typeof loopRespawnFreshness>;
  readonly inFlight: number;
  readonly inFlightNoun: string;
  readonly heldBy: string | undefined;
  /** The loop's live arm at measurement time — what `--confirm` must later see REPLACED. */
  readonly predecessorArmId: string | undefined;
}

/**
 * Measure every gate for one target.
 *
 * @param home the resolved state home
 * @param successor the successor doc slug, for the loop's held-run gate
 * @param nowMs the current instant, epoch milliseconds
 * @param inspect the git and process-table reads the freshness gate measures through
 * @returns everything a verdict needs
 */
function measureGates({
  home,
  inspect,
  successor,
  nowMs,
}: {
  readonly home: string;
  readonly inspect: StandingInspectDeps;
  readonly successor: string | undefined;
  readonly nowMs: number;
}): RespawnContext {
  const liveness = loopLiveness({ home, nowMs });
  // The arm RECORD rather than the liveness verdict: a predecessor whose arm is recorded but already dead is
  // still the arm id a successor's must differ from, and reading it through the verdict would drop it.
  const recordedArm = readListenerArm({ home });
  return {
    fresh: loopRespawnFreshness({ deps: inspect, home, liveness, successor }),
    heldBy: successor === undefined ? undefined : heldByLiveSession({ home, slug: successor }),
    inFlight: loopInFlight({ home }),
    inFlightNoun: "ask(s)",
    predecessorArmId: recordedArm.isOk() ? recordedArm.value?.armId : liveness.armId,
  };
}

/** Print a non-`respawn` verdict and map it to the exit code that says what it is. */
function refuseVerdict({ verdict }: { readonly verdict: RespawnVerdict }): number {
  logger.out({ line: verdict.why });
  return verdict.kind === "not-owed" ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Parse and validate the verb's own arguments, before anything on disk is read.
 *
 * Split out of {@link runSessionRespawn} to keep it under the line cap; every branch here refuses without
 * touching the state home, so this is also the whole surface a caller can get wrong for free.
 *
 * @param rest the argv after the noun and verb
 * @returns the resolved arguments, or the exit code the refusal already printed
 */
function respawnArguments({
  rest,
}: {
  readonly rest: readonly string[];
}): { readonly code: number } | { readonly target: string; readonly parsed: ParsedFlags; readonly confirm: boolean } {
  const parsed = parseSessionArgs({ rest, verb: "respawn" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "respawn" }) });
    return { code: EXIT_USAGE };
  }
  const target = parsed.value.positionals[0];
  if (target === undefined || !TARGETS.includes(target)) {
    logger.error({ msg: `session respawn: name which standing session — one of ${TARGETS.join(", ")}` });
    logger.error({ msg: sessionUsage({ verb: "respawn" }) });
    return { code: EXIT_USAGE };
  }
  const confirm = boolFlag({ name: "confirm", parsed: parsed.value });
  if (
    confirm &&
    (boolFlag({ name: "dry-run", parsed: parsed.value }) || boolFlag({ name: "force", parsed: parsed.value }))
  ) {
    logger.error({
      msg: "session respawn: --confirm takes neither --dry-run nor --force — it reads the live arm and either publishes or refuses",
    });
    return { code: EXIT_USAGE };
  }
  if (confirm) {
    return { confirm, parsed: parsed.value, target };
  }
  const successor = stringFlag({ name: "successor", parsed: parsed.value });
  if (target === LOOP_SESSION && successor === undefined) {
    logger.error({
      msg:
        "session respawn loop: --successor <slug> is required — the loop's replacement is a dated handover doc, " +
        "and this verb will not invent one. Write today's doc first, then name it here",
    });
    return { code: EXIT_USAGE };
  }
  return { confirm, parsed: parsed.value, target };
}

/**
 * Run the `session respawn` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionRespawn(argv: readonly string[]): Promise<number> {
  return runSessionRespawnOver({ argv, inspect: productionStandingInspectDeps() });
}

/**
 * The verb over injected git and process-table reads — the seam a test passes fakes through, because the real
 * ones read the whole process table and run git (a fetch included) over every checkout a live session names.
 *
 * @param argv the full process argv
 * @param inspect the git and process-table reads the freshness gate measures through
 * @returns the process exit code
 */
export async function runSessionRespawnOver({
  argv,
  inspect,
}: {
  readonly argv: readonly string[];
  readonly inspect: StandingInspectDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "respawn" }) });
    return EXIT_OK;
  }
  const resolved = respawnArguments({ rest });
  if ("code" in resolved) {
    return resolved.code;
  }
  const { parsed, target } = resolved;
  const namedHome = stringFlag({ name: "home", parsed });
  const home = resolveHome({ named: namedHome });
  const nowMs = Date.now();
  if (resolved.confirm) {
    return confirmLoopRespawn({ home, nowMs });
  }
  const successor = stringFlag({ name: "successor", parsed });
  const gates = measureGates({ home, inspect, nowMs, successor });
  reportProblems({ prefix: "session respawn", problems: gates.fresh.problems });
  const verdict = respawnVerdict({
    request: {
      force: boolFlag({ name: "force", parsed }),
      grade: gates.fresh.freshness?.grade,
      heldBy: gates.heldBy,
      inFlight: gates.inFlight,
      inFlightNoun: gates.inFlightNoun,
      session: target,
      unmeasured: gates.fresh.unmeasured,
    },
  });
  if (verdict.kind !== "respawn") {
    return refuseVerdict({ verdict });
  }
  logger.out({ line: verdict.why });
  // The target-tree check runs BEFORE the dry-run returns, not inside `act`. Measured, minutes
  // after the check landed: `--dry-run` printed "every gate passed" for a target whose real invocation
  // refused, because the check sat past this early return. A dry run that disagrees with the real one is the
  // same reports-success-does-nothing defect the check itself exists to remove, in the one tool a caller uses
  // to decide whether to act.
  const bootRefusal = targetTreeRefusal({ successor });
  if (bootRefusal !== undefined) {
    logger.out({ line: bootRefusal });
    return EXIT_EXPECTED_EMPTY;
  }
  if (boolFlag({ name: "dry-run", parsed })) {
    logger.out({ line: "session respawn: --dry-run — every gate passed; nothing was retired or booted" });
    return EXIT_OK;
  }
  return act({ gates, home, namedHome, nowMs, successor });
}

/**
 * Remove whatever record an earlier boot left, so it can never answer `--confirm` for this one.
 *
 * @param home the resolved state home
 * @param consequence what failing to remove it means at this call site, printed after the reason
 * @returns `true` once no earlier record stands, `false` (having printed why) when one may still
 */
function clearedEarlierRecord({ home, consequence }: { readonly home: string; readonly consequence: string }): boolean {
  const cleared = clearPendingLoopRespawn({ home });
  if (cleared.isErr()) {
    logger.error({
      msg: `session respawn: ${cleared.error.join("; ")} — an EARLIER respawn's record may still stand, ${consequence}`,
    });
  }
  return cleared.isOk();
}

/**
 * Carry out an approved respawn and record it.
 *
 * @param gates what the gates measured, for the event's own HEAD
 * @param home the resolved state home
 * @param namedHome the `--home` this verb was given, which the boot is handed too
 * @param nowMs the current instant, epoch milliseconds
 * @param successor the successor doc slug
 * @returns the exit code
 */
async function act({
  gates,
  home,
  namedHome,
  nowMs,
  successor,
}: {
  readonly gates: RespawnContext;
  readonly home: string;
  readonly namedHome: string | undefined;
  readonly nowMs: number;
  readonly successor: string | undefined;
}): Promise<number> {
  // Cleared BEFORE the boot: a boot that fails or throws after launching a session must not leave an
  // earlier boot's record answering `--confirm` for it.
  if (!clearedEarlierRecord({ consequence: "so nothing was booted", home })) {
    return EXIT_ERROR;
  }
  // Reachable only once `runSessionRespawn` has refused a missing `--successor`, so this is a fact the type
  // system cannot see rather than a value to invent a default for.
  const booted = await respawnLoop({ namedHome, successor: successor! });
  if (booted !== EXIT_OK) {
    logger.error({ msg: `session respawn: ${spawnExitWhy({ exitCode: booted })}` });
    return booted;
  }
  const successorTree = spawnedSuccessorTree({
    events: parseSessionLog({ text: readSessionLogText({ home }) }).events,
    sinceMs: nowMs,
    successor: successor!,
  });
  return recordLoopBoot({
    home,
    nowMs,
    predecessorArmId: gates.predecessorArmId,
    successor: successor!,
    successorTree,
  });
}

/**
 * Phase one's ending for the loop: REPLACE the pending record with this boot's, and say, in one line, that
 * NOTHING has been confirmed yet and who confirms it.
 *
 * No `respawned` event here, deliberately — see the header. The successor's tree is the one the boot's own
 * `spawned` row names (`respawnWords.ts`'s `spawnedSuccessorTree`), so the record names the directory the boot
 * actually landed in. The earlier record is removed FIRST, whatever happens next: otherwise
 * a boot that could not resolve its tree would leave the previous successor's CONFIRMED record standing, and
 * `--confirm` exiting 0 on it. With it gone, a boot that records nothing leaves `--confirm` nothing to confirm,
 * which is what this function then says.
 *
 * @param home the resolved state home
 * @param nowMs the current instant, epoch milliseconds
 * @param predecessorArmId the arm that was live when the gates were measured, or `undefined` when none was
 * @param successor the successor doc's slug
 * @param successorTree the tree this boot's `spawned` row names, or `undefined` when it recorded none
 * @returns the exit code
 */
export function recordLoopBoot({
  home,
  nowMs,
  predecessorArmId,
  successor,
  successorTree,
}: {
  readonly home: string;
  readonly nowMs: number;
  readonly predecessorArmId: string | undefined;
  readonly successor: string;
  readonly successorTree: string | undefined;
}): number {
  if (!clearedEarlierRecord({ consequence: "so `--confirm` cannot be trusted for this boot", home })) {
    return EXIT_ERROR;
  }
  if (successorTree === undefined) {
    logger.error({
      msg:
        `session respawn: the successor booted but this boot recorded no \`spawned\` row for ${successor}, so ` +
        "there is no tree to confirm its arm against — the earlier record was removed, nothing new was " +
        "recorded, and `--confirm` will refuse with nothing pending",
    });
    return EXIT_ERROR;
  }
  const written = writePendingLoopRespawn({
    home,
    pending: {
      bootedAtIso: new Date(nowMs).toISOString(),
      bootId: randomUUID(),
      ...(predecessorArmId === undefined ? {} : { predecessorArmId }),
      successor,
      successorTree,
    },
  });
  if (written.isErr()) {
    logger.error({ msg: `session respawn: ${written.error.join("; ")}` });
    return EXIT_ERROR;
  }
  logger.out({
    line:
      "session respawn: the successor is booting — NOT YET RESPAWNED. NOW run `slopweaver listen disarm`, stop " +
      "your own listener child, and end this session — this verb never stops a process it does not own. " +
      `The successor arms itself and then runs \`slopweaver session respawn loop --confirm\`, which publishes ` +
      `\`respawned\` only once an arm that is not ${predecessorArmWords({ predecessorArmId })} is live from ` +
      `${successorTree}. Until then nothing reads as respawned, by design.`,
  });
  return EXIT_OK;
}

export const sessionRespawnCommand = defineCommand({ run: runSessionRespawn });
