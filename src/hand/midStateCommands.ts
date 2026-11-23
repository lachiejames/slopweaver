/**
 * The two command lines `hand surface` prints for a checked report: the `handover register --finding` line the seat
 * runs itself, every route, and the checked `hand post` line it sends the pinned supervisor on a note route. The
 * report and its criterion are `./midState.ts`; this is only how they become commands.
 *
 * Pure: no clock, no filesystem.
 */
import { err, type Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { type CheckedPostLine, checkedPostLine } from "./checkedPost.js";
import { consoleBaseFrom, consoleQueueLink } from "./consoleLink.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import type { MidStateReport, MidStateUrgency } from "./midState.js";

/** The longest id `hand post` accepts (`./step.ts`'s `ID_MAX`). */
const ID_MAX = 60;

/** Every note step's id starts with this, so a second report on the same Queue row is visibly the same card. */
const MID_STATE_ID_PREFIX = "mid-state";

/** An urgency that pushes a note. */
type NoteUrgency = Exclude<MidStateUrgency, { kind: "none" }>;

/**
 * The `handover register --finding` command that puts the report's decision on the owner's Queue without pausing a run.
 *
 * @param report the seat's report, already checked
 * @returns the argv and its pasteable line
 */
export function midStateQueueCommand({ report }: { report: MidStateReport }): CheckedPostLine {
  const { decision } = report;
  const argv = [
    "slopweaver",
    "handover",
    "register",
    "--slug",
    report.askSlug,
    "--ask",
    decision.question,
    "--finding",
    "--evidence",
    decision.evidence.join(","),
    "--observed-by",
    decision.observedBy,
    "--problem",
    decision.problem,
    "--options",
    decision.optionsText.trim(),
    "--lean",
    decision.lean,
    "--risk",
    decision.risk,
    "--blast-radius",
    decision.blastRadius,
    "--still-real",
    decision.stillReal,
  ];
  // No --workspace: `--context` names the console the note lands on, not whose work the row is, so the row stays
  // a finding on both views — where the note's link still finds it.
  return { argv, line: shellCommandLine({ command: argv }) };
}

/**
 * The note step's id: `mid-state-<ask slug>`, cut to the id limit without a dangling separator.
 *
 * @param askSlug the Queue row the note opens
 * @returns the id
 */
export function midStateStepId({ askSlug }: { askSlug: string }): string {
  return `${MID_STATE_ID_PREFIX}-${askSlug}`.slice(0, ID_MAX).replace(/[-.]+$/u, "");
}

/**
 * What a note says is waiting on the owner, per urgency kind.
 *
 * @param report the seat's report
 * @param urgency its urgency, already narrowed to a note kind
 * @returns the `--unblocks` sentence
 */
function noteUnblocks({ report, urgency }: { report: MidStateReport; urgency: NoteUrgency }): string {
  switch (urgency.kind) {
    case "breaking":
      return `board row ${report.row}: ${urgency.breaks} by ${urgency.by}`;
    case "blocked-send":
      return `board row ${report.row}: ${urgency.send}, which you already approved`;
    case "fleet-idle":
      return `board row ${report.row}, and every seat waiting on this answer`;
    case "keen":
      return `board row ${report.row}, which you said you are keen to see`;
    case "close-call":
      return `board row ${report.row}, before ${urgency.ifSilent}`;
    default: {
      const unreachable: never = urgency;
      return unreachable;
    }
  }
}

/**
 * Who the note says posted it: the seat's session when it named one, else the verb itself — an unnamed seat is
 * absence by design, not a missing value.
 *
 * @param bySession the session `--by-session` named, if any
 * @returns the `postedBy` the step records
 */
function postedByOf({ bySession }: { bySession: string | undefined }): string {
  if (bySession === undefined) {
    return "hand surface";
  }
  return bySession;
}

/**
 * The checked `hand post` line the chair runs for a note route.
 *
 * @param report the seat's report, already checked
 * @param urgency its urgency, already narrowed to a note kind
 * @returns the argv and line, or the first posting rule the step breaks
 */
export function midStateNoteCommand({
  report,
  urgency,
}: {
  report: MidStateReport;
  urgency: NoteUrgency;
}): Result<CheckedPostLine, HandStepError> {
  const id = midStateStepId({ askSlug: report.askSlug });
  const open = `ask:${report.askSlug}`;
  const unblocks = noteUnblocks({ report, urgency });
  const witness = shellCommandLine({ command: ["slopweaver", "hand", "done", id, "--did", "answered-on-queue"] });
  const url = consoleQueueLink({
    base: consoleBaseFrom({ configured: undefined }),
    context: report.context,
    key: open,
  });
  if (url.isErr()) {
    return err(HandStepErrors.invalidField({ field: "ask-slug", why: url.error.join("; ") }));
  }
  const draft = {
    context: report.context,
    id,
    postedBy: postedByOf({ bySession: report.bySession }),
    postedIso: "1970-01-01T00:00:00.000Z",
    row: report.askSlug,
    unblocks,
    url: url.value,
    what: urgency.noteWhat,
    witness,
  };
  const argv = [
    "slopweaver",
    "hand",
    "post",
    "--id",
    id,
    "--what",
    urgency.noteWhat,
    "--open",
    open,
    "--unblocks",
    unblocks,
    "--witness",
    witness,
    "--context",
    report.context,
    "--row",
    report.askSlug,
    "--blocks",
    ...(report.bySession === undefined ? [] : ["--by-session", report.bySession]),
  ];
  return checkedPostLine({ argv, draft });
}
