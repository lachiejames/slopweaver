/**
 * A recorded question that stopped a run on something the owner has ALREADY greenlit. Pure.
 *
 * ## Why a classifier and not another memory
 *
 * Recording a live cassette is ALWAYS greenlit, and an agent that stops to ask
 * permission for it is a DEFECT. The hesitancy is trained-in rather than reasoned, which is why
 * the answer is a mechanism rather than a note — a session that has never seen the rule reproduces the stop,
 * and the stop is silent: `handover question` records it, the run parks, and the board prints an ordinary
 * `WAITING ON OWNER` row indistinguishable from a real one.
 *
 * So the stop is CLASSIFIED where it is already read: `./boardState.ts` labels the row, and
 * `../devLint/registerHygiene.ts` reports it as a finding on every push. Neither refuses anything — the
 * question is already written down by the time this runs, and un-asking it is not a thing a gate can do. What
 * changes is that it stops being invisible.
 *
 * ## The criterion, stated rather than counted
 *
 * A question matches when it names a RECORDING SUBJECT and asks for PERMISSION. Both halves are required and
 * both are deliberately narrow:
 *
 * - The subject is `cassette`/`polly` outright, or a `record`/`re-record`/`recording` word standing beside a
 *   test-lane word (`integration`, `test`, `suite`, `lane`, `fixture`, `live`). A bare `record` is far too
 *   common in this tree to carry the class on its own — "should I record the ruling on the row" is an
 *   entirely proper question, and flagging it would teach a reader to skip this finding.
 * - The permission half is an explicit ask: `permission`, `ok to`, `okay to`, `should i`, `shall i`, `may i`,
 *   `can i`, `am i allowed`, `approve`, `go ahead`, `green light`/`greenlit`.
 *
 * The error direction is deliberate. Missing a real stop costs one board row that reads like an ordinary
 * pause — the status quo. A false positive costs a session's trust in every finding this gate prints, which
 * is what actually switches a gate off.
 *
 * Pure: one string in, a verdict or nothing out. No filesystem, no clock.
 */

/** One class of thing the owner has already greenlit, with the words that recognise a question about it. */
interface PreApprovedClass {
  /** Stable id, used in the finding text and in tests. */
  readonly id: string;
  /** Why no permission is needed, in one clause the reader can act on. */
  readonly why: string;
  /** Where the full ruling lives. */
  readonly canon: string;
  /** The subject test — does this question name the thing at all? */
  readonly namesSubject: (haystack: string) => boolean;
}

/** Words that make a bare `record` unambiguously about the test lanes rather than about a journal row. */
const LANE_WORDS = /\b(integration|test|tests|suite|lane|fixture|cassettes?|live|polly)\b/;

/** A `record` word in any of the forms a question actually uses. */
const RECORD_WORD = /\b(re-?record(?:ed|ing|s)?|record(?:ed|ing|s)?)\b/;

/**
 * Every pre-approved class. One entry today; the shape is the point, because the next ruling of this kind
 * lands as a row here rather than as a second gate.
 */
const PRE_APPROVED_CLASSES: readonly PreApprovedClass[] = [
  {
    canon: ".claude/rules/testing.md § Recording a cassette is pre-approved",
    id: "cassette-recording",
    namesSubject: (haystack) =>
      /\b(cassettes?|polly)\b/.test(haystack) || (RECORD_WORD.test(haystack) && LANE_WORDS.test(haystack)),
    why: "recording a live cassette is ALWAYS greenlit (owner ruling) — the self-addressed traffic a record lap makes (the bot's own DM, the owner's own mailbox, a throwaway Linear issue, a private Notion page) is expected test traffic, and the duty that comes with it is cleanup, not permission",
  },
];

/** The phrases that make a question an ASK for permission rather than a statement about one. */
const PERMISSION_PHRASES =
  /(permission|\bok(?:ay)? to\b|\bshould i\b|\bshall i\b|\bmay i\b|\bcan i\b|\bam i allowed\b|\bapprove\b|\bapproval\b|\bgo ahead\b|\bgreen ?li(?:ght|t)\b)/;

/** A recorded question that asked for something already granted, and the canon that grants it. */
export interface PreApprovedStop {
  /** Which class of pre-approved act was asked about. */
  readonly id: string;
  /** Why the run should not have stopped, phrased to be printed directly. */
  readonly why: string;
  /** The canon section carrying the full ruling. */
  readonly canon: string;
}

/**
 * Whether a recorded question stopped a run on something already greenlit.
 *
 * @param question the run journal's recorded question, exactly as written
 * @returns the matched class, or `undefined` when the question is an ordinary one
 */
export function preApprovedStopOf({ question }: { question: string }): PreApprovedStop | undefined {
  const haystack = question.toLowerCase();
  if (!PERMISSION_PHRASES.test(haystack)) {
    return undefined;
  }
  const matched = PRE_APPROVED_CLASSES.find((candidate) => candidate.namesSubject(haystack));
  if (matched === undefined) {
    return undefined;
  }
  return { canon: matched.canon, id: matched.id, why: matched.why };
}

/**
 * The one sentence every surface prints about a pre-approved stop, so the board and the gate cannot drift
 * into describing the same defect two different ways.
 *
 * @param stop the matched class
 * @returns the sentence, with no leading or trailing whitespace
 */
export function preApprovedStopLine({ stop }: { stop: PreApprovedStop }): string {
  return `DOCTRINE VIOLATION — this run stopped to ask permission for something already granted: ${stop.why}. Record it and carry on; the ruling is ${stop.canon}.`;
}
