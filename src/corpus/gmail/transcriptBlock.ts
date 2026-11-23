/**
 * Finding the RAW TRANSCRIPT inside a Gemini / Meet meeting-notes document, and refusing a document that
 * has none.
 *
 * ## Why the summary is not kept at all
 *
 * A Meet notes document holds two things: a block Gemini WROTE about the call, and a block of what the
 * call actually contained. The rule: a transcript summary produced by other software
 * has no value to the owner, so only the second one is stored, and a document carrying only the first
 * is REFUSED rather than reduced to its summary. That refusal is the point of this module: a lane that
 * silently fell back to the summary would put exactly the content the ruling excludes into the corpus,
 * under a record kind whose whole promise is that it holds raw speech.
 *
 * Measured on the owner's own corpus, over the 60 meeting documents an earlier pass had
 * already read: 40 carried a tab titled `Transcript`, 1 carried its transcript inline in a single
 * untitled tab, and 19 carried a summary and nothing else. Re-derive the split from a fresh pass with
 * `slopweaver refresh --source gmail --since <date> --no-derive`, whose notes name what was stored and
 * whose warnings name each refusal kind.
 *
 * ## Two shapes, because Meet writes two
 *
 * The common one is a TAB titled `Transcript`, sitting beside a `Notes` tab. The other is a single-tab
 * document whose text carries the transcript under a bare `Transcript` line — the shape Meet wrote before
 * the notes document was tabbed, and one real document in the corpus still has it. Reading only the tab
 * title would refuse that document while its transcript sat in the text, so both are looked for, tab
 * title first.
 *
 * ## A marker is not evidence — speaker lines are
 *
 * Neither shape is trusted on its heading alone. A tab Google titled `Transcript` that holds
 * "no transcript was recorded" is a summary-only document wearing the right label, and storing it would
 * make the record's own kind a lie. So the candidate text must carry at least
 * {@link MIN_SPEAKER_LINES} speaker-shaped lines before it is accepted; anything else is refused exactly
 * as a document with no marker at all is.
 *
 * Pure: no I/O, no clock.
 */
import type { DocContent } from "../../live/gmail/docs.js";

/**
 * How many `Speaker: said something` lines a candidate must carry before it counts as a transcript.
 *
 * Two rather than one: a single colon-bearing line is what an attendee roster (`Attendees: Ana, Bo`) or a
 * labelled summary field looks like, and one of those under a `Transcript` heading would otherwise be
 * stored as a meeting's raw speech. Two consecutive-ish speaker lines is a conversation. A real meeting
 * transcript in this corpus carries hundreds, so the bound never decides a genuine case — it only
 * separates a transcript from a heading with nothing under it.
 */
export const MIN_SPEAKER_LINES = 2;

/** The tab title Meet gives the transcript, compared case-insensitively after trimming. */
const TRANSCRIPT_TAB_TITLE = "transcript";

/**
 * A line of the form `Name: what they said`.
 *
 * The speaker half is a bounded class that cannot contain a colon or a newline, so the pattern has one way
 * to match at each position and cannot backtrack over a 70,000-character transcript — the same requirement
 * every pattern run over provider-derived text carries here.
 */
const SPEAKER_LINE = /^[^:\n]{1,80}: \S/u;

/**
 * How many lines of the candidate look like speech.
 *
 * Counted rather than short-circuited at the bound because the count is what
 * {@link MeetingTranscript.speakerLines} reports, and a caller that wants to know how thin a transcript is
 * should not have to re-scan for it. Pure.
 *
 * @param text the candidate block
 * @returns the number of speaker-shaped lines in it
 */
export function speakerLineCount({ text }: { text: string }): number {
  let found = 0;
  for (const line of text.split("\n")) {
    if (SPEAKER_LINE.test(line)) {
      found += 1;
    }
  }
  return found;
}

/**
 * The transcript one document yielded, and how it was found.
 *
 * @internal — the declared return shape of {@link transcriptBlock}; every caller gets one from that.
 */
export interface MeetingTranscript {
  /** The raw transcript text, speaker and timestamp lines exactly as the document wrote them. */
  readonly text: string;
  /** `tab` when a tab titled `Transcript` held it, `inline` when a bare `Transcript` line marked it. */
  readonly foundBy: "tab" | "inline";
  /** How many speaker-shaped lines it carries — the evidence that decided it was one. */
  readonly speakerLines: number;
}

/**
 * The text after a bare `Transcript` line, when the tab carries one.
 *
 * The marker line itself is dropped and everything below it kept: in the single-tab shape the lines above
 * it are the document's own header and attendee roster, which the record already carries as `attrs`, and
 * the lines below it are the speech. A tab with no such line contributes nothing rather than its whole
 * text — falling back to "the tab, entire" is how a summary tab would get stored. Pure.
 *
 * @param text one tab's text
 * @returns the transcript half, or undefined when the tab carries no marker
 */
export function afterTranscriptMarker({ text }: { text: string }): string | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim().toLowerCase() === TRANSCRIPT_TAB_TITLE);
  if (at === -1) {
    return undefined;
  }
  const below = lines
    .slice(at + 1)
    .join("\n")
    .trim();
  return below.length === 0 ? undefined : below;
}

/** A candidate block and the shape it was found by, before the speaker-line test judges it. */
interface Candidate {
  readonly text: string;
  readonly foundBy: "tab" | "inline";
}

/** Every candidate a document offers, tab titles first, then inline markers — in that preference order. */
function candidates({ document }: { document: DocContent }): readonly Candidate[] {
  const titled: Candidate[] = [];
  const inline: Candidate[] = [];
  for (const tab of document.tabs) {
    if (tab.title?.trim().toLowerCase() === TRANSCRIPT_TAB_TITLE && tab.text.trim().length > 0) {
      titled.push({ foundBy: "tab", text: tab.text.trim() });
      continue;
    }
    const below = afterTranscriptMarker({ text: tab.text });
    if (below !== undefined) {
      inline.push({ foundBy: "inline", text: below });
    }
  }
  return [...titled, ...inline];
}

/**
 * The raw transcript inside a meeting-notes document, or nothing when it carries none.
 *
 * @param document the document as the Docs API returned it
 * @returns the transcript and how it was found, or undefined when this document is summary-only
 */
export function transcriptBlock({ document }: { document: DocContent }): MeetingTranscript | undefined {
  for (const candidate of candidates({ document })) {
    const speakerLines = speakerLineCount({ text: candidate.text });
    if (speakerLines >= MIN_SPEAKER_LINES) {
      return { foundBy: candidate.foundBy, speakerLines, text: candidate.text };
    }
  }
  return undefined;
}
