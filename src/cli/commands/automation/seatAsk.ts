/**
 * The ask a seat's board row carries — the rows one seated session holds and the exact command for each —
 * apart from `./seat.ts`, which claims those rows and opens the session. The text is pure; the claiming is not.
 */
import {
  ALIGNMENT_BRIEFING_KIND,
  BUMP_FIX_KIND,
  CALL_ASSESSMENT_KIND,
  ERROR_TRACKING_BATCH_KIND,
  INBOX_TRIAGE_KIND,
  LINEAR_BRIEFING_KIND,
  OWED_REPLY_KIND,
  THREAD_CHASE_KIND,
} from "../../../live/automation/kinds.js";

/**
 * The line a WORKLIST row carries ABOVE its command, because for such a kind the command comes LAST.
 *
 * A `run-due` settles the firing it runs, and a `bump-fix`, `error-tracking-batch`, `thread-chase`, `owed-reply`,
 * `call-assessment`, `inbox-triage`, `linear-briefing` or `alignment-briefing` row's firing is the whole batch of work — so the seated session works the worklist first and
 * runs the command only once the batch is done. Named here rather than left to the skill, because the order is the one thing a session reading "one
 * row at a time, in this order" would otherwise get backwards. The procedure itself is the reference, never
 * this string.
 */
const WORKLIST_PREAMBLES: Readonly<Record<string, string>> = {
  [BUMP_FIX_KIND]:
    "  (bump-fix: follow skills/automation/reference/bump-fix.md — work the bump worklist to its end FIRST, " +
    "then run this command LAST to settle the firing)",
  [ERROR_TRACKING_BATCH_KIND]:
    "  (error-tracking-batch: follow skills/automation/reference/error-tracking-batch.md — raise the batch " +
    "FIRST, then run this command LAST to settle the firing)",
  [THREAD_CHASE_KIND]:
    "  (thread-chase: follow skills/automation/reference/thread-chase.md — park the chases and the finding " +
    "follow-ups (slack finding-followups --json) FIRST, then run this command LAST to settle the firing)",
  [OWED_REPLY_KIND]:
    "  (owed-reply: follow skills/automation/reference/owed-reply.md — park the replies FIRST, " +
    "then run this command LAST to settle the firing)",
  [CALL_ASSESSMENT_KIND]:
    "  (call-assessment: follow skills/automation/reference/call-assessment.md — classify and record every " +
    "due call, then the day's slice of stored rows, FIRST, then run this command LAST to settle the firing)",
  [INBOX_TRIAGE_KIND]:
    "  (inbox-triage: follow skills/automation/reference/inbox-triage.md — card the inbox FIRST, " +
    "then run this command LAST to settle the firing)",
  [LINEAR_BRIEFING_KIND]:
    "  (linear-briefing: follow skills/automation/reference/linear-briefing.md — card the briefing " +
    "FIRST, then run this command LAST to settle the firing)",
  [ALIGNMENT_BRIEFING_KIND]:
    "  (alignment-briefing: follow skills/automation/reference/alignment-briefing.md — publish the page and " +
    "card FIRST, then run this command LAST to settle the firing)",
};

/**
 * The ask the board row carries: which rows this session holds, and the exact command that runs each one.
 *
 * It spells the commands rather than describing them, because the claim token is the only way the seated
 * session can run a spawn-shaped row at all and a token retyped from memory is a refusal. It names the
 * SKILL for everything else, so this string cannot drift from `skills/automation/SKILL.md`. A worklist
 * row's command is preceded by its {@link WORKLIST_PREAMBLES} line, which only points at its reference, and
 * is listed after every other row's, so a seat holding one beside another kind still runs it LAST.
 *
 * @param seated each row this seat claimed, with its kind and the token it minted
 * @returns the ask text for the board row
 */
export function seatAsk({ seated }: { readonly seated: readonly SeatedRow[] }): string {
  const ordered = [
    ...seated.filter((row) => WORKLIST_PREAMBLES[row.kind] === undefined),
    ...seated.filter((row) => WORKLIST_PREAMBLES[row.kind] !== undefined),
  ];
  const commands = ordered.flatMap((row) => {
    const command = `  slopweaver automation run-due --recipe ${row.recipeId} --claim-id ${row.claimId}`;
    const preamble = WORKLIST_PREAMBLES[row.kind];
    if (preamble !== undefined) {
      return [preamble, command];
    }
    return [command];
  });
  return [
    `Run ${String(seated.length)} automation(s) that need a session, then close this workspace.`,
    "",
    "Follow `skills/automation/SKILL.md` § The seated session. One row at a time, in this order:",
    "",
    ...commands,
    "",
    "Each command runs its row, stamps the slot it covered and drops its claim. A row that fails is",
    "INSPECTED before this session ends: one that cannot succeed unattended becomes a board finding with",
    "the exact steps, never a card asking whether to resync.",
  ].join("\n");
}

/** One row this seat claimed, the firing it took, and the token the seated session quotes back to run it. */
export interface SeatedRow {
  readonly recipeId: string;
  /** The row's kind, read off the stored definition at claim time — what decides the ask's per-row procedure. */
  readonly kind: string;
  readonly claimId: string;
  /** The cadence firing this seat took, so a release can name the exact record it is giving back. */
  readonly slotIso: string;
}
