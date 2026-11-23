/**
 * The half of `hand post` that runs once a step is BUILT: who may post it, every admission rule, the append (with
 * its picture and any re-cut it settles), closing the superseded note, raising the new one, and the receipt.
 *
 * Its own module because a second verb composes steps too: `incident note` builds its step from a form — quotes and
 * details no `hand post` flag carries — and must still meet every rule `hand post` applies, in the same order, with
 * the same words. A second copy of this sequence is the drift that would let one of them skip a rule; one function
 * both call cannot.
 */
import type { HandPostReceipt } from "../../../hand/multiAppend.js";
import { dismissHandNote } from "../../../hand/note/markers.js";
import { macosOnly, raiseHandNote } from "../../../hand/note/raise.js";
import { postingRefusal } from "../../../hand/posting.js";
import { seatPostVerdict } from "../../../hand/seatPost.js";
import { declaringBranchLine } from "../../../hand/secretName.js";
import type { ReadShot } from "../../../hand/shotStore.js";
import { snoozeActive, snoozeWakeLabel } from "../../../hand/snooze.js";
import { snoozeOf, snoozePending } from "../../../hand/snoozeStore.js";
import type { HandStep } from "../../../hand/step.js";
import { kindAnswerOffer } from "../../../monitor/noteAnswers.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { fleetSignInExit, namedDraftExit } from "../handover/namedDraftAdmission.js";

import type { HandDeps } from "./deps.js";
import { undrawnDraftExit } from "./draftCarried.js";
import { openedAskMachineIdExit } from "./openedAskMachineId.js";
import { appendWithPicture } from "./postPicture.js";

/**
 * Every refusal a built step meets before the register is touched — the posting form and the drafts it cites — or
 * `undefined` when it may be appended. The board row it names is judged under the lock, by the caller's
 * `admitRow`. Each refusal has already written its diagnostic.
 *
 * Exported for `incident note --dry-run`, which admits against the owner's real home and then records into a throwaway one.
 *
 * @param step the validated step
 * @param home the state home the row and drafts are read from
 * @param deps the output seams
 * @returns the exit code a refusal ends the verb with, or `undefined` when the step is admitted
 */
export function handAdmissionExit({
  step,
  home,
  deps,
}: {
  step: HandStep;
  home: string;
  deps: HandDeps;
}): number | undefined {
  const refused = postingRefusal({ step });
  if (refused !== undefined) {
    deps.writeDiagnostic(`hand post: ${refused.message}`);
    // The pure rule cannot read git, so the verb says which branch carries each missing row.
    if (refused.code === "SECRET_NAME_UNREGISTERED") {
      refused.names.forEach((name) => {
        deps.writeDiagnostic(`  ${declaringBranchLine({ name, refs: deps.branchesDeclaring({ name }) })}`);
      });
    }
    return EXIT_ERROR;
  }
  // The ask a step opens draws its own decision on the step's card, and the posting form, pure, cannot read it.
  const openedAsk = openedAskMachineIdExit({ home, step, write: deps.writeDiagnostic });
  if (openedAsk !== undefined) {
    return openedAsk;
  }
  // A step naming a parked Slack draft is a card asking the owner to react to it, and the console draws the draft on it;
  // one naming a draft the register does not hold would draw nothing to react to. The
  // details count: an incident note names its cross-post drafts there, behind the disclosure row.
  const texts = [step.what, step.where, step.unblocks, step.ifIgnored, step.witness];
  if (step.details !== undefined) {
    texts.push(...step.details);
  }
  const drafts = namedDraftExit({
    command: "slopweaver hand post",
    env: process.env,
    home,
    texts,
    write: deps.writeDiagnostic,
  });
  if (drafts !== undefined) {
    return drafts;
  }
  // A Datadog or GitHub sign-in is the fleet's to press through (owner ruling): a step may ask the owner
  // only once a fresh `browser sign-in` look reached a wall that is genuinely the owner's. Every field the card draws counts,
  // the same ones the draft check reads: a sign-in ask in `unblocks` reaches the owner as surely as one in `what`.
  const fleetSignIn = fleetSignInExit({
    command: "slopweaver hand post",
    env: process.env,
    home,
    nowIso: deps.now(),
    texts,
    write: deps.writeDiagnostic,
  });
  if (fleetSignIn !== undefined) {
    return fleetSignIn;
  }
  // A step asking the owner to react to a message drafted as them must carry it — by id, or by opening the ask that
  // offers it — or the card has nothing to draw, and the owner cannot find the drafts.
  return undrawnDraftExit({ env: process.env, home, step, write: deps.writeDiagnostic });
}

/**
 * Say what the post did, as one JSON document or as the human lines.
 *
 * @param step the step recorded
 * @param receipt what the append wrote and what it replaced
 * @param drawn the phrase saying what the note did
 * @param json whether `--json` was passed
 * @param deps the output seams
 */
function reportPost({
  step,
  receipt,
  drawn,
  json,
  deps,
}: {
  step: HandStep;
  receipt: HandPostReceipt;
  drawn: string;
  json: boolean;
  deps: HandDeps;
}): void {
  if (json) {
    deps.writeOut(JSON.stringify({ ...receipt, note: drawn, step }));
    return;
  }
  deps.writeOut(`hand post: ${step.id} ${receipt.appended ? "recorded" : "already recorded"} — ${step.what}`);
  deps.writeOut(`  unblocks ${step.unblocks} · settles with ${step.witness}`);
  if (step.ifIgnored !== undefined) {
    deps.writeOut(`  if the owner does nothing: ${step.ifIgnored}`);
  }
  if (receipt.superseded !== undefined) {
    deps.writeOut(`  supersedes ${receipt.superseded}, settled on the same register line`);
  }
  if (receipt.droppedTornBytes > 0) {
    deps.writeOut(
      `  dropped a cut-short last line (${String(receipt.droppedTornBytes)} bytes) an interrupted write left`,
    );
  }
  deps.writeOut(`  note: ${drawn}`);
}

/**
 * Print the seat verdict's lines, and say whether it refused the post — only the pinned supervisor posts a card.
 *
 * @param deps the diagnostic channel
 * @param home the state home whose supervisor pin the verdict reads
 * @param command the verb the refusal names, so its escape-hatch line reruns the right one
 * @returns `true` when this seat may not post
 */
export function handSeatRefused({ deps, home, command }: { deps: HandDeps; home: string; command: string }): boolean {
  const seat = seatPostVerdict({ command, env: process.env, pin: readSupervisorPin({ home }) });
  if (seat.kind !== "ok") {
    seat.lines.forEach((line) => {
      deps.writeDiagnostic(line);
    });
  }
  return seat.kind === "refused";
}

/**
 * Tell a superseded card's note to close, saying so when it could not be told — the post itself stands either way.
 *
 * @param deps the diagnostic channel
 * @param home the state home the note lives under
 * @param nowIso the instant the close is stamped with
 * @param superseded the id of the step the new one replaced
 */
function closeSupersededNote({
  deps,
  home,
  nowIso,
  superseded,
}: {
  deps: HandDeps;
  home: string;
  nowIso: string;
  superseded: string;
}): void {
  const closed = dismissHandNote({ home, id: superseded, nowIso });
  if (closed.isErr()) {
    deps.writeDiagnostic(
      `hand post: ${superseded} is settled, but its note could not be told to close — ${closed.error.message}`,
    );
  }
}

/**
 * Draw the note, reporting what happened in one phrase rather than failing the post.
 *
 * A step that was recorded and could not be drawn is still recorded, and that is the strictly better half to
 * keep: the surfacing can be retried with `hand show`, while a lost record cannot be retried at all.
 *
 * A step whose note is already up keeps that note: re-posting an id is idempotent, and a second window over
 * the same step is exactly what the owner has met. A step posted while ANOTHER step's note is up draws its
 * own note in front, in the next free cascade slot, and both stay up.
 *
 * @param step the validated step
 * @param home the state home
 * @param nowIso the instant the liveness check judges at
 * @param deps the verb's seams
 * @returns one phrase saying what the note did
 */
function raised({
  step,
  home,
  nowIso,
  deps,
}: {
  step: Parameters<typeof raiseHandNote>[0]["step"];
  home: string;
  nowIso: string;
  deps: HandDeps;
}): string {
  const platform = macosOnly({ platform: deps.platform });
  if (platform !== undefined) {
    return platform.message;
  }
  // A re-post of a step the owner snoozed is the same step restated, never a reason to draw it early: only `hand show`
  // and `hand wake` bring a snoozed note back, and a raise here would forget the owner's snooze as well.
  if (snoozePending({ home, id: step.id })) {
    return "snoozed — the owner's press is on record, so no note was drawn";
  }
  const snooze = snoozeOf({ home, id: step.id });
  if (snooze.isErr()) {
    return snooze.error.message;
  }
  if (snooze.value !== undefined && snoozeActive({ nowIso, untilIso: snooze.value.untilIso })) {
    return `snoozed until ${snoozeWakeLabel({ untilIso: snooze.value.untilIso })} — its note comes back then`;
  }
  const outcome = raiseHandNote({
    home,
    kindAnswers: kindAnswerOffer({ step }),
    level: "ordinary",
    nowIso,
    run: deps.run,
    step,
    whenLive: "keep",
  });
  if (outcome.isErr()) {
    return outcome.error.message;
  }
  if (outcome.value.kind === "kept") {
    return "already floating — its note is up, so no second one was drawn";
  }
  return `floating, top right in the cascade (slot ${String(outcome.value.slot)}) — ${outcome.value.bundlePath}`;
}

/** What recording a built, admitted step needs. */
interface RecordHandStep {
  readonly step: HandStep;
  readonly home: string;
  readonly deps: HandDeps;
  readonly nowIso: string;
  readonly read: ReadShot | undefined;
  readonly supersedes: string | undefined;
  readonly admitRow: Parameters<typeof appendWithPicture>[0]["admitRow"];
  readonly quiet: boolean;
  readonly json: boolean;
}

/**
 * Post a BUILT step: admit it, append it (storing its picture, settling the step it re-cuts), close the re-cut's
 * note, raise the new one unless asked not to, and report. The seat check is the caller's, before it builds. Its
 * fields are {@link recordHandStep}'s.
 *
 * @returns the process exit code
 */
export async function applyHandPost(args: RecordHandStep): Promise<number> {
  const refusedWith = handAdmissionExit({ deps: args.deps, home: args.home, step: args.step });
  if (refusedWith !== undefined) {
    return refusedWith;
  }
  return recordHandStep(args);
}

/**
 * Record an ADMITTED step: append it with its picture, close the note of the step it re-cuts, raise its own note
 * unless asked not to, and report. {@link applyHandPost} admits first; `incident note --dry-run` admits against the owner's
 * real home and records into a throwaway one, so the note is drawn exactly and the owner's queue never holds it.
 *
 * @param step the admitted step
 * @param home the state home the register, the picture and the note markers live under
 * @param nowIso the instant the append and the raise are stamped with
 * @param read the checked picture, or `undefined` for a step without one
 * @param supersedes the id the step re-cuts, when it re-cuts one
 * @param admitRow the register's check on the board row the step names, run inside the append's lock
 * @param quiet whether to record without drawing
 * @param json whether to report as one JSON document
 * @returns the process exit code
 */
export async function recordHandStep({
  step,
  home,
  deps,
  nowIso,
  read,
  supersedes,
  admitRow,
  quiet,
  json,
}: RecordHandStep): Promise<number> {
  const written = await appendWithPicture({ admitRow, deps, home, nowIso, read, step, supersedes });
  if (written === undefined) {
    return EXIT_ERROR;
  }
  // The old card's note closes BEFORE the new one is raised, so the re-cut never stands beside the very card it
  // replaces.
  const superseded = written.superseded;
  if (superseded !== undefined) {
    closeSupersededNote({ deps, home, nowIso, superseded });
  }
  const drawn = quiet ? "not drawn (--quiet)" : raised({ deps, home, nowIso, step });
  reportPost({ deps, drawn, json, receipt: written, step });
  return EXIT_OK;
}
