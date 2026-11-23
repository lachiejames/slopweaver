/**
 * `handover park <slug>` — park a seat on the owner's open question and close it, as ONE act (a seat that cannot
 * proceed without the owner's steer is parked, its question on the owner's Queue, and closed in cmux with its
 * worktree, branch, last screen read and Queue question named on its board row, so the owner's answer reseats it).
 *
 * `--wake-on-checks <owner/name>#<n>` or `--wake-at <iso>` parks a seat on somebody else's CI or a clock instead,
 * with or without a question. The wake rides the `parked` event, and `handover wake` (`./wakeRun.ts`) reseats the
 * seat by a visible `cmux spawn` once due. A checks wake on the run's OWN open pull request, or a clock wake while the
 * run's own pull request is open, is refused before anything touches cmux (`./parkOwnLanding.ts`): its CI, rebase,
 * red-CI fix and landing are the seat's work.
 *
 * The order is the design. The journal is written FIRST and the workspace closed after, because a seat parking
 * ITSELF is killed by its own close: whatever was meant to be written after that never is. The `parked` event
 * releases the writer (`../../../handover/runOwner.ts`), which is what keeps `handover reap` from orphaning a
 * run whose seat is gone on purpose, and lets the reseat claim it without `--force`.
 *
 * A row carrying the owner's STANDING-SESSION ruling is refused before anything touches cmux, and again on the last
 * journal read before the append: its seat waits for them by design (`../../../handover/standingSession.ts`).
 *
 * Which seat, and whether it may be closed now, are `../../../handover/parkPolicy.ts`'s — pure, and tested
 * there — read off the screen by `./parkChooseSeat.ts`. This file owns the socket, the append and the close.
 */

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { rowOwnerWordsBeforeReaskRefusal } from "../../../handover/ownerWordsBeforeReaskRead.js";
import { activeParkedCheckpoint } from "../../../handover/parked.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";
import { parkHolder, parkRunTree, parkSeatHost } from "../../../handover/parkPolicy.js";
import { type ParkWake, parseParkWake } from "../../../handover/parkWake.js";
import { ownershipAmbiguousLines } from "../../../handover/unknownKind.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchEnvVar } from "../../../hatch/types.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type CmuxHostSurface, withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import type { SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { productionMonitorDeps } from "../monitor/deps.js";
import { readOwnerWordsOf } from "./askLaterOwnerWords.js";
import {
  lifecycleUsage,
  nowIso,
  ownershipAmbiguityRefusal,
  parseLifecycleArgs,
  type Resolved,
  resolve,
  stringFlag,
  VERB_ARG_OFFSET,
} from "./lifecycleRunCore.js";
import { type ChosenSeat, chooseSeat, judgeSeat } from "./parkChooseSeat.js";
import { closeSeat } from "./parkCloseSeat.js";
import { type ParkFailure, parkFailureLines } from "./parkFailure.js";
import { ownLandingRefusal, productionParkOwnLandingDeps } from "./parkOwnLanding.js";
import {
  appendParked,
  type ParkPlan,
  parkedEventOf,
  printParked,
  standingAfterPark,
  standingSessionRefusal,
  unmovedDrafts,
} from "./parkRunJournal.js";
import { fireSteerAtRiskIfSteered } from "./steerRiskCard.js";

/**
 * This verb's own hatch, resolved once so the refusal text and the variable name cannot drift apart. The key is
 * `SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT`, spelled here so the row in `../../../hatch/registry.ts` naming this file
 * as its reader is checkable by `escape-hatch` rather than taken on trust.
 */
const PARK_RUNNING_SEAT_HATCH = hatchFor({ id: "park-running-seat" });

/** What the act did, for the lines printed after it. */
interface Parked {
  readonly event: ParkedEvent;
  readonly forced: boolean;
  readonly residueLines: readonly string[];
}

/**
 * Park the run's seat on the owner's open question, or on the clock or CI it names, and close it.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverPark(argv: readonly string[]): Promise<number> {
  const wake = wakeOf({ argv });
  if (typeof wake === "number") {
    return wake;
  }
  const resolved = resolve({ argv, verb: "park" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const plan = parkPlanOf({ resolved, wake });
  if (typeof plan === "number") {
    return plan;
  }
  const ownLanding = await ownLandingRefusal({
    deps: productionParkOwnLandingDeps({ home: resolved.home }),
    env: process.env,
    recordedBranch: resolved.context.run.branch,
    runTree: plan.runTree,
    seatTree: process.cwd(),
    slug: resolved.context.doc.slug,
    wake,
  });
  if (ownLanding.length > 0) {
    ownLanding.forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_ERROR;
  }
  const outcome = await parkThroughHost({ plan, resolved });
  if (outcome.isErr()) {
    const slug = resolved.context.doc.slug;
    for (const msg of parkFailureLines({ failure: outcome.error, hatch: PARK_RUNNING_SEAT_HATCH, slug })) {
      logger.error({ msg });
    }
    return EXIT_ERROR;
  }
  if (outcome.value.forced) {
    logger.error({
      msg: `handover park: FORCED past a running turn by ${hatchEnvVar({ suffix: "PARK_RUNNING_SEAT" })}=1 — the thought it held is gone`,
    });
  }
  logger.out({ line: `handover park: closed ${outcome.value.event.workspaceRef}` });
  outcome.value.residueLines.forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * Choose the seat, journal the park and close it, all over ONE session host. The park hatch is read here, by a
 * reader each judgement asks after its own screen read, so the choice and the pre-append re-read each see it then.
 */
async function parkThroughHost({
  plan,
  resolved,
}: {
  plan: ParkPlan;
  resolved: Resolved;
}): Promise<Result<Parked, ParkFailure>> {
  const callerWorkspaceId = process.env["CMUX_WORKSPACE_ID"];
  const runningSeatHatchOpen = (): boolean => process.env[hatchEnvVar({ suffix: "PARK_RUNNING_SEAT" })] === "1";
  return withCmuxSessionHost({
    body: async ({ harness, host: client }): Promise<Result<Parked, ParkFailure>> => {
      const chosen = await chooseSeat({
        callerWorkspaceId,
        client,
        plan,
        requested: stringFlag({ name: "workspace", parsed: resolved.parsed }),
        runningSeatHatchOpen,
      });
      if (chosen.isErr()) {
        return err(chosen.error);
      }
      const seat = { callerWorkspaceId, chosen: chosen.value, client, harness };
      return journalAndClose({ ...seat, plan, resolved, runningSeatHatchOpen });
    },
  });
}

/**
 * The wake the two flags name, read BEFORE anything touches the board, so a malformed one is refused with no read
 * at all. A tail that does not parse, or asks for help, is left to `resolve`, which prints that answer itself.
 *
 * @returns the wake or `undefined`, or the usage exit code of the refusal it printed
 */
function wakeOf({ argv }: { argv: readonly string[] }): ParkWake | undefined | number {
  const parsed = parseLifecycleArgs({ rest: argv.slice(VERB_ARG_OFFSET), verb: "park" });
  if (parsed.isErr()) {
    return undefined;
  }
  const wake = parseParkWake({
    wakeAt: stringFlag({ name: "wake-at", parsed: parsed.value }),
    wakeOnChecks: stringFlag({ name: "wake-on-checks", parsed: parsed.value }),
  });
  if (wake.isErr()) {
    logger.error({ msg: `handover park: ${wake.error.message}` });
    logger.error({ msg: lifecycleUsage({ verb: "park" }) });
    return EXIT_USAGE;
  }
  return wake.value;
}

/**
 * The refusal for parking on a held question the owner has since spoken over, unread
 * (`../../../handover/ownerWordsBeforeReask.ts`): a seat leaving the question on the owner's Queue for good after the
 * owner may already have answered it is the re-park this gate closes. `undefined` when the run holds no question waiting on the
 * owner, or every such word is named in `--read-owner-words`. The journal is read again here rather than taken from
 * `resolved`, so a question answered since the command began no longer refuses over words said to it.
 */
function ownerWordsRefusalOf({ resolved }: { resolved: Resolved }): readonly string[] | undefined {
  return rowOwnerWordsBeforeReaskRefusal({
    acknowledged: readOwnerWordsOf({ parsed: resolved.parsed }),
    command: "slopweaver handover park",
    home: resolved.home,
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
}

/** Print a refusal's lines whole, and answer the exit code it carries. */
function refusedWith({ lines }: { lines: readonly string[] }): number {
  for (const msg of lines) {
    logger.error({ msg });
  }
  return EXIT_ERROR;
}

/** The refusal for a run no session holds: never held at all, or parked already. */
function unheldRefusal({ resolved }: { resolved: Resolved }): number {
  const { context } = resolved;
  const slug = context.doc.slug;
  const parkedAlready = activeParkedCheckpoint({ events: context.events });
  if (parkedAlready === undefined) {
    return refusedWith({ lines: [`handover park: no session has ever held ${slug}, so there is no seat to park`] });
  }
  return refusedWith({
    lines: [`handover park: ${slug} is parked already (${parkedAlready.workspaceRef} closed ${parkedAlready.atIso})`],
  });
}

/**
 * The question or wake, holder and tree the journal names, or the exit code of the refusal it printed. A seat
 * parks on the owner's open question, or on a wake it names — a clock or CI it would otherwise sit open through.
 */
function parkPlanOf({ resolved, wake }: { resolved: Resolved; wake: ParkWake | undefined }): ParkPlan | number {
  const { context } = resolved;
  const slug = context.doc.slug;
  const ambiguity = ownershipAmbiguityRefusal({ context, verb: "handover park" });
  if (ambiguity !== undefined) {
    return ambiguity;
  }
  const question = context.run.phase === "waiting-on-owner" ? context.run.openQuestion : undefined;
  const parkable = wake === undefined ? question !== undefined : context.run.phase !== "closed";
  if (!parkable) {
    logger.error({
      msg:
        `handover park: ${slug} is ${context.run.phase}, not waiting on a recorded question or a named wake — ` +
        `put the question on the owner's Queue first with \`slopweaver handover ask ${slug} --question "…"\`, or name ` +
        `what it waits on with --wake-on-checks <owner/name>#<n> or --wake-at <UTC instant>`,
    });
    return EXIT_ERROR;
  }
  const unread = ownerWordsRefusalOf({ resolved });
  if (unread !== undefined) {
    return refusedWith({ lines: unread });
  }
  const writer = parkHolder({ events: context.events });
  if (writer === undefined) {
    return unheldRefusal({ resolved });
  }
  const runTree = parkRunTree({ events: context.events, holder: writer });
  const ambiguousLines = ownershipAmbiguousLines({ journal: context });
  // `SLOPWEAVER_ALLOW_PARK_STANDING_SESSION`, the `park-standing-session` row's key, spelled for `escape-hatch`.
  const standingHatchOpen = process.env[hatchEnvVar({ suffix: "PARK_STANDING_SESSION" })] === "1";
  const standing = standingSessionRefusal({ events: context.events, hatchOpen: standingHatchOpen, nowIso: nowIso() });
  if (standing !== undefined) {
    for (const msg of parkFailureLines({ failure: standing, hatch: PARK_RUNNING_SEAT_HATCH, slug })) {
      logger.error({ msg });
    }
    return EXIT_ERROR;
  }
  return {
    ambiguousLines,
    question,
    runTree,
    seatHost: parkSeatHost({ events: context.events }),
    standingHatchOpen,
    wake,
    writer,
  };
}

/**
 * The parked event for a seat, at ONE clock sample: the instant the standing-session bound is judged at is the
 * instant the checkpoint carries. Refused instead when the owner has spoken unread over the held question.
 */
function parkedNow({
  plan,
  resolved,
  screen,
  seat,
}: {
  plan: ParkPlan;
  resolved: Resolved;
  screen: Parameters<typeof parkedEventOf>[0]["screen"];
  seat: CmuxWorkspaceSummary;
}): Result<{ atIso: string; event: ReturnType<typeof parkedEventOf> }, ParkFailure> {
  const { context, home, runsDir } = resolved;
  const atIso = nowIso();
  const drafts = unmovedDrafts({ home, nowIso: atIso, plan, runsDir, slug: context.doc.slug });
  if (drafts.isErr()) {
    return err(drafts.error);
  }
  // The owner's words read again here, and `journalAndClose` appends with no await after this returns: the seat
  // choice and screen read before it can take seconds, and words said meanwhile must refuse the park too. A word
  // written after this read is the residue a journal append cannot close, since the call file is written under its
  // own lock.
  const unread = ownerWordsRefusalOf({ resolved });
  if (unread !== undefined) {
    return err({ kind: "owner-words", lines: unread });
  }
  const event = parkedEventOf({
    atIso,
    drafts: drafts.value,
    plan,
    recordedBranch: context.run.branch,
    screen,
    seat,
  });
  return ok({ atIso, event });
}

/** Journal the park, print it, then close the seat — in that order, because a seat parking itself dies here. */
async function journalAndClose({
  callerWorkspaceId,
  chosen,
  client,
  harness,
  plan,
  resolved,
  runningSeatHatchOpen,
}: {
  callerWorkspaceId: string | undefined;
  chosen: ChosenSeat;
  client: CmuxHostSurface;
  harness: SessionHarness;
  plan: ParkPlan;
  resolved: Resolved;
  runningSeatHatchOpen: () => boolean;
}): Promise<Result<Parked, ParkFailure>> {
  const { context, home, runsDir } = resolved;
  const { seat } = chosen;
  const slug = context.doc.slug;
  // Both re-read right before the append: a seat starting a turn after the screen was read
  // no longer shows it idle, and a writer releasing leaves no host to trust. The screen goes FIRST and the journal
  // last, with no await from that journal read to the append, so a release cannot land between them in this
  // process; another process's append there is the filesystem residue rowEvent.ts states. cmux has no atomic
  // check-and-close, so a turn starting from the screen read to the close is residue too.
  const fresh = await judgeSeat({ callerWorkspaceId, client, plan, runningSeatHatchOpen, seat });
  if (fresh.isErr()) {
    return err(fresh.error);
  }
  const parked = parkedNow({ plan, resolved, screen: fresh.value.screen, seat });
  if (parked.isErr()) {
    return err(parked.error);
  }
  const { atIso, event } = parked.value;
  const appended = appendParked({ atIso, event, hatchOpen: plan.standingHatchOpen, runsDir, slug });
  if (appended.isErr()) {
    return err(appended.error);
  }
  // Fired before the close: a clock-park on a row the owner explicitly steered is the moment nobody is working their
  // deliverable, and the note has to land while the seat that knows it is still here — and before the receipt, so
  // an output channel that fails cannot stop it.
  await fireSteerAtRiskIfSteered({ deps: productionMonitorDeps(), home, slug, verb: "handover park" });
  // Printed BEFORE the close too: a seat parking itself does not outlive it.
  printParked({ event, journalPath: appended.value.path, slug });
  const late = standingAfterPark({ atIso, hatchOpen: plan.standingHatchOpen, runsDir, slug });
  if (late !== undefined) {
    return err(late);
  }
  const forced = chosen.forced || fresh.value.forced;
  const closed = await closeSeat({ callerWorkspaceId, client, forced, harness, home, seat });
  if (closed.isErr()) {
    return err(closed.error);
  }
  return ok({ event, forced, residueLines: closed.value });
}

export const handoverParkCommand = defineCommand({ run: runHandoverPark });
