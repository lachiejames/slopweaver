/**
 * The queue's rows for the hand register: one per step only the owner's hands can take, each drawing the decision of the ask
 * it opens, and the board rows those steps absorbed. Split from `./queueRows.ts`, which folds every register into one
 * list, so that file stays under the 300-line cap.
 */

import type { Board, BoardRow, HandStep } from "../components/live/read";
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { LiveState } from "../components/live/useLive";
import { openedAskArtifact } from "./cardPages";
import { handDraftForm } from "./draftAsOwner";
import { handCard } from "./handCard";
import { handPill } from "./handPill";
import {
  askPendingOf,
  decisionForHand,
  handDrafts,
  type LinkedHandDecision,
  linkedHandDecision,
  openedAskAction,
} from "./handStepAsk";
import { queueProvenanceOf } from "./provenance";
import { ruledAskIso } from "./queueAskWait";
import { handSource, sourceForm } from "./queueCardSource";
import { firstRefusal, hint, placedIn } from "./queueRowFields";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import { handAbsorbsAsk, handPlacement, joinedPlacement } from "./registerPlacement";
import { drawnOnceForm } from "./slackDraftIds";
import { slackLinksIn } from "./slackLink";
import { waitingTierOf } from "./waitingRank";
import type { WorkspacePlacer } from "./workspacePlacement";

/** The id prefix a monitor posts its hand steps under — `src/monitor/registry.ts`'s, which this tree cannot import. */
const MONITOR_STEP_PREFIX = "mon-";

/**
 * One row per hand step, in the register's order, and every ask a decision step absorbed.
 *
 * @param boardRows the board's own rows, empty while it is unread
 * @param readRows the same rows, or `undefined` while the board is unread, which a card's source says aloud
 * @param askRowSlugs every slug the ask loop in `./queueRows.ts` stands a row up for
 * @param placer the organisation's address readers, which place every row
 * @returns the rows, without tags yet, and the board rows they absorbed; none until the register has read
 */
export function handStepRows({
  hands,
  board,
  boardRows,
  readRows,
  askRowSlugs,
  posts,
  placer,
}: {
  placer: WorkspacePlacer;
  hands: LiveState<readonly HandStep[]>;
  board: LiveState<Board>;
  boardRows: readonly BoardRow[];
  readRows: readonly BoardRow[] | undefined;
  askRowSlugs: ReadonlySet<string>;
  posts: LiveState<readonly ParkedDraft[]>;
}): { rows: Omit<QueueRow, keyof QueueTags>[]; joined: ReadonlySet<BoardRow> } {
  const out: Omit<QueueRow, keyof QueueTags>[] = [];
  // Every ask a decision hand step absorbed, so the ask loop does not draw the same decision twice — the
  // board ROW itself, never its slug, so a second row sharing a slug is never dropped with it (the r1 counterexample).
  const joined = new Set<BoardRow>();
  // Every ask slug a hand row already answers the deep link for — a joined decision or an unread-ask step alike.
  const linkAnswered = new Set<string>();
  if (hands.phase !== "ready") {
    return { joined, rows: out };
  }
  for (const step of hands.value) {
    const decision = linkedHandDecision({ rows: boardRows, step });
    // Every step opening the ask draws its decision — a second note on the owner's screen asks the same question, and
    // falling back to the note's own buttons is the unreadable card this join exists to end. Only the first
    // answers to the ask's key, so a deep link opens one row, deterministically.
    const placement = joinedPlacement({ board, placement: handPlacement({ placer, rows: boardRows, step }) });
    let aliases: readonly string[] = [];
    if (
      decision !== undefined &&
      !joined.has(decision.ask) &&
      handAbsorbsAsk({ ask: decision.ask, placement, placer })
    ) {
      joined.add(decision.ask);
      linkAnswered.add(decision.ask.slug);
      aliases = [`ask:${decision.ask.slug}`];
    }
    // `witness` is deliberately NOT in the hint. It is the `slopweaver hand done …` line that settles
    // the step, so it carries the word `slopweaver` on every row in the register whatever the step is
    // about — feeding it to the filter would place every hand step in one context by construction.
    const handHint = `${step.what} ${hint({ value: step.where })} ${hint({ value: step.unblocks })}`;
    const { card, form: built } = handCard({
      artifact: openedAskArtifact({ rows: boardRows, step }),
      decision: decisionForHand({ linked: decision, step }),
      step,
    });
    const stepDrafts = handDrafts({ decision, posts, step });
    const offered = openedAskAction({ rows: boardRows, step });
    const pending = askPendingOf({ board, offered, step });
    const askPending = pending?.pending;
    const boardStale = pending?.stale === true;
    const ruledIso = ruledAskIso({ rows: boardRows, step });
    // While the ask is unread no decision joins, so the step answers its own `ask:` link — the first step only, and
    // never over an ask row the reading in hand already stands up for that slug (a settled row stands none).
    if (
      pending !== undefined &&
      aliases.length === 0 &&
      !askRowSlugs.has(pending.slug) &&
      !linkAnswered.has(pending.slug)
    ) {
      linkAnswered.add(pending.slug);
      aliases = [`ask:${pending.slug}`];
    }
    // A step asking the owner to react to a message drafted as the owner, carrying none, is refused rather than drawn
    // as a question with nothing to react to.
    const source = handSource({ rows: readRows, step });
    const form = handDraftForm({
      askUnread: askPending !== undefined,
      draftIds: stepDrafts.map((draft) => draft.id),
      form: firstRefusal({ forms: [sourceForm({ source }), built, drawnOnceForm({ named: stepDrafts })] }),
      offered: offered?.action,
      what: step.what,
      where: step.where,
    });
    out.push({
      aliases,
      card,
      hint: handHint,
      id: step.id,
      key: `hand:${step.id}`,
      kind: "hand",
      pill: handPill({ step, workstreams: [] }),
      provenance: queueProvenanceOf({ placement }),
      record: {
        askPending,
        boardStale,
        decision,
        drafts: stepDrafts,
        form,
        kind: "hand",
        offered,
        step,
      },
      placement,
      ...(ruledIso === undefined ? {} : { ruledIso }),
      source,
      threadUrl: handThreadUrl({ decision, step }),
      tier: waitingTierOf({ checkIn: step.checkIn, teamFacing: placedIn({ placement, workspace: "team" }) }),
      currencyFloorIso: step.postedIso,
      verifiedBy: "the hands register still holds it",
      // A monitor's step is confirmed only by its monitor's pass, never by the register holding it — so with no
      // currency reading to say so, it has no confirmation at all (`handFact` on the producer).
      verifiedIso: step.id.startsWith(MONITOR_STEP_PREFIX) ? undefined : hands.observedAtIso,
      whenIso: step.postedIso,
    });
  }
  return { joined, rows: out };
}

/**
 * The Slack thread a hand row names: one in the step's own prose first, else the thread its joined ask names.
 *
 * @param step the hand step
 * @param decision the ask it opens, when it opens one
 * @returns the thread, or `undefined`
 */
function handThreadUrl({
  step,
  decision,
}: {
  step: HandStep;
  decision: LinkedHandDecision | undefined;
}): string | undefined {
  const own = slackLinksIn({ text: `${step.what} ${hint({ value: step.where })}` }).at(0);
  if (own !== undefined || decision === undefined) {
    return own;
  }
  return decision.threadUrl;
}
