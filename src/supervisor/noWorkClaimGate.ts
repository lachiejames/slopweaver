/**
 * THE NO-WORK CLAIM GATE — a chair may not say there is no work while the board it read holds open rows.
 *
 * ## The thing it makes impossible
 *
 * A chair said there was nothing to seat, no runnable row and an empty queue, over a reconciliation holding 116
 * open rows, 84 of them blocked only for naming no `repo:` (`./heldWork.ts` carries the reading and its repro).
 * Every gate passed that tick: `./idleCapacityGate.ts` judges only `ready`, and its two ready rows were answered
 * by hold rationales. Nothing judged the SENTENCE, and the sentence is what the owner reads.
 *
 * ## The predicate, exactly
 *
 * A text CLAIMS no work when it matches {@link NO_WORK_CLAIMS}: no work, nothing to do or seat or start, nothing
 * seatable or runnable, an empty queue or board, no runnable rows. It deliberately does not match "nothing of the owner's
 * left to land", which is a true claim about pull requests, not about the board.
 *
 * It refuses when a text claims it AND the reconciliation the tick read holds ANY open row (`rankedCount > 0`).
 * Not only the rows the fleet could lift itself: a board whose every row waits on the owner is still not "no work",
 * it is work waiting on them, and the sentence that says so names what holds it — which is what
 * {@link ./heldWork.ts}'s line is for. A claim over a reconciliation it cannot decode is `unreadable`: a "no work"
 * sentence with no reading behind it is exactly the defect.
 *
 * A board with no open row at all (`rankedCount === 0`) is clean.
 *
 * ## What a lexical gate cannot see, stated
 *
 * It reads words, not intent: a sentence QUOTING the claim ("the owner heard 'no work left'") or negating it trips it
 * the same way, and so does one whose subject is not the board but which uses the board's own words ("nothing
 * to seat on a pull request"). Generic words are anchored to a subject by one rule ({@link NO_WORK_CLAIMS}); the board's
 * own words are not, on purpose. That is accepted rather than parsed around — a natural-language parser is a
 * fragile second gate — and the way past is the sentence it asks for anyway: say what the board holds, or open
 * the hatch for the one exception.
 *
 * Pure — texts and a parsed reconciliation in, a verdict out.
 */
import { type HeldWork, heldWorkOf } from "./heldWork.js";

/**
 * The subject that makes a generic "no work" the board's: "there is", "there are", "we have", "the board has",
 * "the fleet holds". A pull request, a recipe or a CI run as the subject is not one.
 */
const SUBJECT = String.raw`(?:there(?:['’]s| is| was| are| were)|we(?:['’]ve got| have| had)|the (?:fleet|board) (?:has|had|holds|held))`;

/** The start of a sentence or clause, where a fragment like "No work left." has no other subject to belong to. */
const OPENER = String.raw`(?<=^\s*|[.!?;:—–(]\s*)`;

/** Words that are generic: true of a pull request, a recipe or a CI run as much as of the board. */
const GENERIC_HELD = String.raw`(?:runnable|startable|ready|seatable) (?:work|rows?|items?|docs?|asks?)`;

/**
 * Every phrasing of "there is no work" a chair has used or would. Word-bounded and case-blind; each names the
 * BOARD's emptiness, never a pull request's or a recipe's. ONE rule decides which may stand bare: a GENERIC word —
 * work, do, run, start, runnable, rows, items — counts only after a {@link SUBJECT} or at an {@link OPENER},
 * because "this pull request needs no more work" and "the nightly-cleanup recipe has no runnable rows" are true of something
 * else. The board's OWN words — seat, spawn, dispatch, seatable, the board, the work
 * queue — count anywhere, since nothing else in this system is seated or spawned.
 */
const NO_WORK_CLAIMS: readonly RegExp[] = [
  new RegExp(String.raw`\b${SUBJECT} no (?:more |remaining |open )?work\b`, "iu"),
  new RegExp(String.raw`${OPENER}no (?:more |remaining |open )?work (?:left|remaining|to (?:do|run|start))\b`, "iu"),
  /\bno (?:more |remaining |open )?(?:work|rows?|items?) (?:left )?to (?:seat|spawn|dispatch)\b/iu,
  // "nothing to do with capacity" fails the trailing look; "nothing to do on a pull request" fails it too.
  new RegExp(
    String.raw`\b${SUBJECT} nothing (?:left |more |else )?to (?:do|run)\b` +
      String.raw`(?=\s*(?:[.,;:!?)—–-]|$|for (?:now|the fleet|this (?:pass|tick|hour))|right now|today))`,
    "iu",
  ),
  /\bnothing (?:left |more |else )?(?:to (?:seat|dispatch|spawn)|for the fleet)\b/iu,
  /\bnothing (?:is |was |left )?(?:seatable|ready to seat)\b/iu,
  new RegExp(String.raw`${OPENER}nothing (?:is |was |left )?(?:runnable|startable|ready to (?:run|start))\b`, "iu"),
  /\bnothing (?:can|could) (?:be )?(?:seated|spawned|dispatched)\b/iu,
  // "the merge queue is clear" and "the owner's Queue is clear" are true of other queues, so only the board, a named work
  // queue, or "the queue" with nothing between the article and the noun counts.
  /\b(?:the )?(?:board|(?:work|fleet|seat|dispatch) queue) (?:is|was|sat|reads?|read) (?:empty|clear)\b/iu,
  /\bthe queue (?:is|was|sat) empty\b/iu,
  new RegExp(String.raw`\b${SUBJECT} no ${GENERIC_HELD}\b`, "iu"),
  new RegExp(String.raw`${OPENER}no ${GENERIC_HELD}\b`, "iu"),
  new RegExp(String.raw`\b${SUBJECT} no (?:rows?|items?|work) (?:left )?to (?:run|start)\b`, "iu"),
];

/** One text a gate reads, with where it came from so a refusal can point at it. */
export interface ClaimText {
  /** Where the text sits, e.g. `headline.sentences[0]` or `the chair's last reply`. */
  readonly label: string;
  readonly text: string;
}

/** One claim found: where, and the exact words that claimed it. */
interface NoWorkClaim {
  readonly label: string;
  readonly words: string;
}

/** Whether the chair may say what it said about the board. */
export type NoWorkClaimVerdict =
  /** No text claims no work, or the board holds no open row. */
  | { readonly kind: "clean" }
  /** A text claims no work and the reconciliation could not be read to check it. */
  | { readonly kind: "unreadable"; readonly why: string; readonly claims: readonly NoWorkClaim[] }
  /** A text claims no work while the board holds open rows. */
  | { readonly kind: "refused"; readonly claims: readonly NoWorkClaim[]; readonly held: HeldWork };

/**
 * Every no-work claim in one text, as the words that matched.
 *
 * @param text one sentence, label or reply
 * @returns each matched phrase, in pattern order; empty when the text claims nothing
 */
export function noWorkClaimsIn({ text }: { text: string }): readonly string[] {
  return NO_WORK_CLAIMS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match === null ? [] : [match[0]];
  });
}

/**
 * Judge texts a chair wrote against the reconciliation it read.
 *
 * @param texts every text the chair is about to put in front of the owner
 * @param reconciliation the parsed `handover reconcile --json` document the texts rest on
 * @returns the verdict
 */
export function judgeNoWorkClaim({
  texts,
  reconciliation,
}: {
  texts: readonly ClaimText[];
  reconciliation: unknown;
}): NoWorkClaimVerdict {
  const claims = texts.flatMap(({ label, text }) => noWorkClaimsIn({ text }).map((words) => ({ label, words })));
  if (claims.length === 0) {
    return { kind: "clean" };
  }
  const held = heldWorkOf({ reconciliation });
  if (held.kind === "unreadable") {
    return { claims, kind: "unreadable", why: held.why };
  }
  if (held.value.ranked === 0) {
    return { kind: "clean" };
  }
  return { claims, held: held.value, kind: "refused" };
}
