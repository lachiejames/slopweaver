/**
 * What a `gmail clear-meeting-notes` run prints and the exit code it owes. Pure: every fact here was gathered by the
 * run, and nothing is decided that `./clearMeetingNotesCore.ts` did not already judge.
 */
import { type CardReceipt, meetingCardSlug } from "./clearMeetingNotesCard.js";
import {
  type ClearMeetingNotesMode,
  keptReasonNeedsOwner,
  keptReasonText,
  type MeetingDisposition,
  type MeetingOutcome,
  meetingLabel,
  NO_TRANSCRIPT_TEXT,
} from "./clearMeetingNotesCore.js";

/** Every fact the report renders, gathered by the run. */
export interface ClearMeetingNotesReport {
  readonly mode: ClearMeetingNotesMode;
  readonly query: string;
  readonly complete: boolean;
  /** The listed id of each message Gmail answered that could not be parsed, so could not be judged. */
  readonly unparsed: readonly string[];
  readonly dispositions: readonly MeetingDisposition[];
  /** The ids this run archived (empty under dry-run and audit). */
  readonly archived: readonly string[];
  /** The card per kept message id. */
  readonly cards: ReadonlyMap<string, CardReceipt>;
  /** The proven message ids whose open card this run settled, the mail being out of the inbox. */
  readonly cardsSettled: readonly string[];
}

/**
 * The lines a run prints, one per mail and one summary. Pure.
 *
 * @param report what the run found and did
 * @returns the lines, in order
 */
export function clearMeetingNotesLines({ report }: { report: ClearMeetingNotesReport }): readonly string[] {
  const archived = new Set(report.archived);
  const cardsSettled = new Set(report.cardsSettled);
  const lines = [
    `gmail clear-meeting-notes (${report.mode}): ${String(report.dispositions.length)} meeting-notes mail(s) ` +
      `for \`${report.query}\`${report.complete ? "" : " — NOT every match was read; raise --limit"}`,
  ];
  for (const disposition of report.dispositions) {
    lines.push(dispositionLine({ archived, cards: report.cards, cardsSettled, disposition, mode: report.mode }));
  }
  for (const id of report.unparsed) {
    lines.push(`  ${id} — kept: Gmail answered it with no id or thread id, so it could not be judged`);
  }
  const proven = report.dispositions.filter((disposition) => disposition.outcome.kind === "proven").length;
  const untranscribed = report.dispositions.filter(
    (disposition) => disposition.outcome.kind === "no-transcript",
  ).length;
  const kept = report.dispositions.length + report.unparsed.length - proven - untranscribed;
  lines.push(
    `proven ${String(proven)} · no transcript ${String(untranscribed)} · archived ${String(archived.size)} · kept ` +
      `${String(kept)} · carded ${String(report.cards.size)}`,
  );
  return lines;
}

/** What became of a mail that may leave the inbox: archived now, its card settled, or what a run would do. */
function leftText({
  archived,
  cardsSettled,
  disposition,
  mode,
}: {
  archived: ReadonlySet<string>;
  cardsSettled: ReadonlySet<string>;
  disposition: MeetingDisposition;
  mode: ClearMeetingNotesMode;
}): string {
  const { messageId } = disposition;
  const done = archived.has(messageId) ? " · archived" : "";
  const settled = cardsSettled.has(messageId) ? ` · card ${meetingCardSlug({ messageId })} settled` : "";
  const wouldArchive = mode !== "run" && disposition.inInbox ? "; a run archives it" : "";
  return `${wouldArchive}${done}${settled}`;
}

/** One mail's line. */
function dispositionLine({
  archived,
  cards,
  cardsSettled,
  disposition,
  mode,
}: {
  archived: ReadonlySet<string>;
  cards: ReadonlyMap<string, CardReceipt>;
  cardsSettled: ReadonlySet<string>;
  disposition: MeetingDisposition;
  mode: ClearMeetingNotesMode;
}): string {
  const head = `  ${disposition.messageId} ${meetingLabel({ disposition })}${disposition.inInbox ? "" : " (archived)"}`;
  const { outcome } = disposition;
  if (outcome.kind === "proven") {
    const how = outcome.ingestedNow ? "ingested now" : "already held";
    const left = leftText({ archived, cardsSettled, disposition, mode });
    return `${head} — proven: gmail ${outcome.sourceId} (${how})${left}`;
  }
  if (outcome.kind === "no-transcript") {
    return `${head} — no transcript: ${NO_TRANSCRIPT_TEXT}${leftText({ archived, cardsSettled, disposition, mode })}`;
  }
  return `${head} — kept: ${keptReasonText({ reason: outcome.reason })}${cardText({ cards, disposition })}`;
}

/** The card a kept mail's line carries, and for a settled card the step the owner's answer leaves. */
function cardText({
  cards,
  disposition,
}: {
  cards: ReadonlyMap<string, CardReceipt>;
  disposition: MeetingDisposition;
}): string {
  const card = cards.get(disposition.messageId);
  if (card === undefined) {
    return "";
  }
  const slug = meetingCardSlug({ messageId: disposition.messageId });
  if (card === "settled") {
    return (
      ` · card ${slug} (settled, off the Queue: if the owner said archive it, run ` +
      `\`slopweaver gmail archive ${disposition.messageId}\`)`
    );
  }
  return ` · card ${slug} (${card})`;
}

/** Whether one mail's outcome fails the run: an audit fails on any kept mail, a run on any kept mail the next pass
 * repairs (a carded one is a hand step placed). A proven or never-transcribed mail fails none. A dry run fails on
 * none. */
function failsTheRun({ mode, outcome }: { mode: ClearMeetingNotesMode; outcome: MeetingOutcome }): boolean {
  if (outcome.kind !== "kept") {
    return false;
  }
  if (mode === "audit") {
    return true;
  }
  return mode === "run" && !keptReasonNeedsOwner({ reason: outcome.reason });
}

/**
 * The exit code a finished run owes, given what it found. Pure.
 *
 * A run exits 3 over an empty scope, 1 when any mail stayed for a reason the next pass repairs (it is the
 * scheduled row's signal) or the audit could not read every match, else 0 — a carded mail is a hand step placed,
 * not a failure. An audit exits 0 only when every mail is proven or never had a transcript to prove.
 *
 * @param report what the run found and did
 * @returns the exit code
 */
export function clearMeetingNotesExit({ report }: { report: ClearMeetingNotesReport }): 0 | 1 | 3 {
  if (report.dispositions.length === 0 && report.unparsed.length === 0) {
    return report.complete ? 3 : 1;
  }
  if (!report.complete || report.unparsed.length > 0) {
    return 1;
  }
  const failed = report.dispositions.some(({ outcome }) => failsTheRun({ mode: report.mode, outcome }));
  return failed ? 1 : 0;
}
