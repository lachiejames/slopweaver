/**
 * `cmux spawn`'s doc preflight — every reason to refuse a workspace before any worktree or session effect.
 *
 * Split out of `./run.ts` rather than living beside the verb: `run.ts` is already at this repo's file-size
 * ceiling, and this is the half with a real invariant to protect — independent refusals about the doc and its
 * journal, each named in `preflightDocForSpawn` below and each checked before any worktree or session effect.
 */

import { readFileSync } from "node:fs";

import {
  launchOperationForRun,
  resolveSpawnPickupCommand,
  type SpawnPickupLocation,
} from "../../../cmux/pickupCommand.js";
import { slopweaverHome } from "../../../config.js";
import { settledAskRefusal } from "../../../handover/askRow.js";
import { unrootedDocBriefRefusal } from "../../../handover/briefPathGate.js";
import { derivedRowState } from "../../../handover/derivedRowState.js";
import { type HandoverDoc, isTerminalDocStatus } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { pausedRefusal } from "../../../handover/paused.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ResolvedInitialMessage } from "../../../sessionHarness/launch.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { finishedCycleRefuses, rerunAllowedBy } from "../handover/finishedCycleGate.js";
import { cmuxHandoverDir } from "./core.js";

/**
 * Read the run events that decide whether this spawn starts or resumes, preserving any refusal for the caller.
 *
 * @param home the state home the run journal lives under, or `undefined` for the ambient one
 * @param slug the doc whose journal is read
 * @returns the journal's events, or why they could not all be read
 */
export function readSpawnRunEvents({
  home,
  slug,
}: {
  home: string | undefined;
  slug: string;
}): Result<readonly RunEvent[], string> {
  let stateHome = slopweaverHome();
  if (home !== undefined) {
    stateHome = home;
  }
  const read = readRunJournal({ runsDir: stateHomePaths({ home: stateHome }).runs, slug });
  if (read.isErr()) {
    return err(read.error.message);
  }
  if (read.value.unreadable.length > 0) {
    return err(
      `${slug}'s run journal has unreadable line(s) ${read.value.unreadable.join(", ")} — refusing to guess start versus resume`,
    );
  }
  return ok(read.value.events);
}

/**
 * Re-read and resolve the state-dependent pickup command at the last responsible moment, with the launch act that
 * same read decides — so the line sent and the act the ledger records come from one journal read.
 *
 * @param docPath the doc the pickup command names
 * @param home the state home the run journal lives under, or `undefined` for the ambient one
 * @param slug the doc's slug, whose journal decides start versus resume
 * @param location the `--dir` and `--home` the spawn was explicitly given, carried onto the lifecycle verb exactly
 *   as the preview plan carries them, so the line shown before launch is the line delivered
 * @returns the resolved pickup command and its act, or why the journal could not be read
 */
export function currentSpawnPickupCommand({
  docPath,
  home,
  slug,
  // A plan with no location is a spawn given neither `--dir` nor `--home`: its pickup line is the bare one.
  location = {},
}: {
  docPath: string;
  home: string | undefined;
  slug: string;
  location: SpawnPickupLocation | undefined;
}): Result<ResolvedInitialMessage, string> {
  return readSpawnRunEvents({ home, slug }).map((runEvents) => ({
    operation: launchOperationForRun({ runEvents }),
    text: resolveSpawnPickupCommand({ docPath, location, runEvents, slug }),
  }));
}

/**
 * Find the one doc on the board claiming this slug, or the exit code to stop on.
 *
 * @param slug the slug the spawn was requested by
 * @param parsed the verb's parsed flags, for the handover directory
 * @returns the single claiming doc, or the exit code to stop on
 */
export function findDoc({ slug, parsed }: { slug: string; parsed: ParsedFlags }): HandoverDoc | number {
  const scan = scanBoard({ handoverDir: cmuxHandoverDir({ parsed }) });
  if (scan.isErr()) {
    logger.error({ msg: `cmux spawn: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const matches = scan.value.docs.filter((doc) => doc.slug === slug);
  if (matches.length === 0) {
    logger.error({ msg: `cmux spawn: no doc on the board claims the slug "${slug}"` });
    return EXIT_USAGE;
  }
  if (matches.length > 1) {
    logger.error({ msg: `cmux spawn: "${slug}" is claimed by ${String(matches.length)} docs` });
    return EXIT_ERROR;
  }
  return matches[0]!;
}

/**
 * The journal read and the doc preflight, as one step.
 *
 * The journal is read BEFORE the preflight rather than after it, which is the fix rather than a tidy-up: its
 * own closure is one of the facts {@link preflightDocForSpawn} judges, and reading it afterwards is exactly
 * what left a `finished` cycle invisible to this door.
 *
 * @param doc the doc the spawn was requested against
 * @param home the state home the run journal lives under, or `undefined` for the ambient one
 * @param slug the slug it was requested by, for the error text
 * @returns the declared repo and the journal `buildSpawnPlan` needs, or the exit code to stop on
 */
export function spawnPreflight({
  doc,
  home,
  slug,
}: {
  doc: HandoverDoc;
  home: string | undefined;
  slug: string;
}): { readonly repo: string; readonly runEvents: readonly RunEvent[] } | number {
  const runEvents = readSpawnRunEvents({ home, slug: doc.slug });
  if (runEvents.isErr()) {
    logger.error({ msg: `cmux spawn: ${runEvents.error}` });
    return EXIT_ERROR;
  }
  const preflight = preflightDocForSpawn({
    doc,
    rerunAllowed: rerunAllowedBy({ env: process.env }),
    runEvents: runEvents.value,
    slug,
  });
  return typeof preflight === "number" ? preflight : { repo: preflight.repo, runEvents: runEvents.value };
}

/**
 * Refuse a doc `cmux spawn` should not open a session against, before any worktree/workspace effect — a real
 * gap once: cmux found any matching doc and chose start-versus-resume purely from the journal, with no
 * doc-status preflight at all, so it would happily spawn a session on a doc the board itself refuses to start.
 *
 * The status check alone left the same gap open for ASK rows, which is a second measured spawn rather than a
 * hypothetical: a settled ask keeps `status: ready` because `settlement:` is the one authority on whether it
 * is terminal, so `isTerminalDocStatus` says nothing about it. See `../../../handover/askRow.ts`'s
 * `settledAskRefusal` for the workspace that came of it.
 *
 * A PAUSED row is the third shape with the same property: it is not terminal, its probes say nothing useful,
 * and spawning it would restart work its author deliberately parked on a person. Unpausing is a decision, so
 * the door names the fact and the verb rather than quietly opening a workspace.
 *
 * A brief naming a path relative to the STATE HOME is another, and unlike the others it is about what
 * the seat will do once it is open rather than whether there is work to do: a path with no root sends the
 * session hunting for it across the disk. The docs seat (workspace:157) ran a breadth-first scan from `/`
 * for `supervisor-scratch/handoff-<n>/owner-turn-<n>-18-images` — three cores for eleven minutes — because
 * the row's own `summary:` named it that way. See `../../../handover/briefPaths.ts` for the criterion and
 * the measurement behind scoping it to the BRIEF rather than the whole doc.
 *
 * A FINISHED run is another, and it is the one this door was measured getting wrong: nothing here read the
 * journal's own closure at all, only what the doc declares about itself, and a run closed with a failing or
 * waived probe leaves `status: ready` standing by design. See `../../../handover/boardRefusal.ts`'s
 * `finishedRunRefusal` for the 78 rows and the workspace that nearly re-landed shipped work — and
 * `../handover/finishedCycleGate.ts` for the one copy `handover start` shares.
 *
 * @param doc the doc a spawn was requested against
 * @param slug the slug it was requested by, for the error text
 * @param runEvents the doc's run journal, already read to choose start-versus-resume
 * @param rerunAllowed whether the caller's environment set the finished-run break-glass
 * @param readDoc reads the doc's markdown, for the brief-path check (defaults to the real filesystem)
 * @returns the doc's declared repo, narrowed past its optional type, or the exit code to stop on
 */
function preflightDocForSpawn({
  doc,
  slug,
  runEvents,
  rerunAllowed,
  readDoc = ({ path }) => readFileSync(path, "utf8"),
}: {
  doc: HandoverDoc;
  slug: string;
  runEvents: readonly RunEvent[];
  rerunAllowed: boolean;
  readDoc?: (input: { path: string }) => string;
}): { repo: string } | number {
  const settled = settledAskRefusal({ doc });
  if (settled !== undefined) {
    logger.error({ msg: `cmux spawn: ${settled}` });
    return EXIT_ERROR;
  }
  const paused = pausedRefusal({ doc });
  if (paused !== undefined) {
    logger.error({ msg: `cmux spawn: ${paused}` });
    return EXIT_ERROR;
  }
  if (finishedCycleRefuses({ doc, events: runEvents, rerunAllowed, unreadableLines: [], verb: "cmux spawn" })) {
    return EXIT_ERROR;
  }
  // The DERIVED status, not the `status:` line: a row whose journal recorded a `closed` ending reads terminal
  // here even though nothing ever edited its front-matter, which is the whole point of
  // `../../../handover/derivedRowState.ts`. The line is still the answer for a row whose register is silent.
  const derived = derivedRowState({ doc, events: runEvents });
  if (isTerminalDocStatus(derived.status)) {
    logger.error({ msg: `cmux spawn: ${slug} is ${derived.status} — refusing to spawn a session on closed work` });
    if (derived.statusSummary !== undefined) {
      logger.error({ msg: `  ${derived.statusSummary}` });
    }
    return EXIT_ERROR;
  }
  if (doc.repo === undefined) {
    logger.error({ msg: `cmux spawn: ${slug} names no \`repo:\`, so there is nowhere to open a worktree in` });
    return EXIT_USAGE;
  }
  // The RESOLVED state home rather than the caller's `--home`, deliberately: the criterion asks whether a
  // first segment names a directory of the state home THIS MACHINE has, which is what a reading seat would
  // go looking under. A `--home` pointed at another journal directory does not change that.
  const unrooted = unrootedDocBriefRefusal({
    command: "slopweaver cmux spawn",
    docText: readDoc({ path: doc.path }),
    env: process.env,
    repoRoot: doc.repo,
  });
  if (unrooted !== undefined) {
    logger.error({ msg: `cmux spawn: ${unrooted}` });
    return EXIT_ERROR;
  }
  return { repo: doc.repo };
}
