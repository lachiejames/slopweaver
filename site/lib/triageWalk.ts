/**
 * A voice triage pass over the owner's Queue, held by the page: which card comes next, which they have seen, what they
 * ruled, and which they sent back to be rewritten. Pure, so the unit lane holds the whole walk; `../components/voice/triageRun.ts`
 * runs `triage_next` and `triage_end` over it and `../components/voice/useTriageWalk.ts` keeps it and its clock.
 *
 * - **Seen, never zero.** The point is that the owner has had a quick look at each thing in their Queue, never an empty
 *   Queue as the goal. So the pass is measured in cards SEEN of the cards it started with, and every card that reaches
 *   the owner's Queue while it runs is walked too.
 * - **A rewritten card comes back first**, because it is fresher in memory sooner. The owner never waits for one: the
 *   pass moves on, and each next card looks for it first.
 * - **The clock never rules.** Two minutes a card, said by the voice (`TRIAGE_DUE_TEXT`), never shown; a card the owner
 *   has ruled has no clock left to run.
 *
 * **When a card the owner sent back is back.** Their words land on the card and take it off the Queue
 * (`landRelayCard`), and the chair puts the rewrite back with `talk restore` (`src/talk/triageVocabulary.ts`). So a
 * card is back when it is on the Queue again after the pass has seen it gone, or when its words differ from the ones
 * the owner could not follow — the second because a landing can lag the next card by seconds, and a card still showing
 * then is not yet gone. A rewrite posted as a NEW card is walked as an arrival, never claimed as the owner's card
 * rewritten.
 */
import { isLifted } from "./queueFocus";
import { triageOrder } from "./triage";
import type {
  TriageFront,
  TriagePick,
  TriageRuled,
  TriageSettled,
  TriageVisit,
  TriageWalk,
  TriageWalkRow,
} from "./triageWalkTypes";
import type { TriageLabel, TriageRulingWire, TriageVerdict } from "./triageWords";

/**
 * Whether a row is a card the owner ruled, with words they ruled it on.
 *
 * @param settled the cards the owner ruled, each with the words they ruled on
 * @param row a Queue row now
 * @returns `true` when the walk must not take it
 */
function isSettled({ settled, row }: { settled: readonly TriageSettled[]; row: TriageWalkRow }): boolean {
  return settled.some((one) => one.key === row.key && one.fingerprint === row.fingerprint);
}

/**
 * The walk's ordering basis: the SET of the owner's focus board tags, each once and sorted, so two urgent workstreams
 * naming one tag lift exactly what one does and never read as a focus switched on.
 *
 * @param focus the board tags of the owner's focus now, one per urgent workstream
 * @returns the tags, each once, sorted
 */
function focusBasis({ focus }: { focus: readonly string[] }): readonly string[] {
  return [...new Set(focus)].toSorted();
}

/**
 * Begin a pass over the Queue as it stands, in the Queue's own order (`./triage.ts`), leaving out every card a pass
 * before it saw the owner rule whose words have not changed since. A pass spent past `TRIAGE_PASS_IDLE_MS`
 * (`./triageWalkClock.ts`) still hands its rulings on: a card the owner ruled stays on their Queue until the chair
 * acts on it, and walking those again means one ruled card a second, each opening its Slack thread.
 *
 * @param walkId the page's id for this pass, which every visit id carries
 * @param rows the Queue's rows now
 * @param focus the board tags of the owner's focus now, none while no focus stands
 * @param nowMs when it begins
 * @param before the pass this one replaces, whose ruled cards it carries whole
 * @returns the pass, with nothing shown yet
 */
export function startTriageWalk({
  walkId,
  rows,
  focus,
  nowMs,
  before,
}: {
  walkId: string;
  rows: readonly TriageWalkRow[];
  focus: readonly string[];
  nowMs: number;
  before?: TriageWalk | undefined;
}): TriageWalk {
  // Carried whole, on the owner's Queue or off it and whatever its words now: a register still loading draws none of
  // its cards, and words can change and change back, so `nextTriageCard` judges each pick by the words it has then.
  let settled: readonly TriageSettled[] = [];
  if (before !== undefined) {
    settled = before.settled;
  }
  const walked = rows.filter((row) => !isSettled({ row, settled }));
  const order = triageOrder({ rows: walked, sectionOf: (row) => row.section }).map((row) => row.key);
  return {
    current: undefined,
    focus: focusBasis({ focus }),
    order,
    out: [],
    paused: false,
    previous: undefined,
    rulings: [],
    settled,
    shown: [],
    stoppedMs: undefined,
    touchedMs: nowMs,
    visits: 0,
    walkId,
  };
}

/**
 * The next card in the pass: a card stopping the owner's work they have not seen this pass, else one they sent back
 * that is back, else the next of the cards the pass began with that is
 * still on their Queue, else a card that arrived since. Every card they sent back that is now off their Queue is noted
 * as gone first, which is what lets it read as back later. When their focus was switched on or off since the order was
 * taken, the cards the pass began with are first re-ordered in the Queue's order as it stands now; an arrival still
 * comes after every one of them.
 *
 * @param walk the pass so far
 * @param rows the Queue's rows now
 * @param focus the board tags of the owner's focus now, none while no focus stands
 * @param nowMs when the card goes in front of the owner
 * @returns the pass with the card current, and the card — or no card when every one has been seen
 */
export function nextTriageCard({
  walk,
  rows,
  focus,
  nowMs,
}: {
  walk: TriageWalk;
  rows: readonly TriageWalkRow[];
  focus: readonly string[];
  nowMs: number;
}): { readonly walk: TriageWalk; readonly pick: TriagePick | undefined } {
  const live = new Map(rows.map((row) => [row.key, row]));
  const noted = walk.out.map((one) => (live.has(one.key) ? one : { ...one, seenGone: true }));
  const back = noted.find((one) => {
    const row = live.get(one.key);
    return row !== undefined && (one.seenGone || row.fingerprint !== one.fingerprint);
  });
  // The ordering basis is the owner's focus itself. Switched on or off mid-pass, the order is re-taken over the cards
  // the pass began with that are on their Queue now, in the Queue's order, the cards off the Queue kept after it in
  // their old order; unchanged, the pass keeps the order it began with, whatever section a card has moved to since.
  // With no focus ever standing the basis is empty and never changes.
  const focusNow = focusBasis({ focus });
  let order = walk.order;
  if (focusNow.join("\n") !== walk.focus.join("\n")) {
    const startedRows = walk.order.flatMap((key) => {
      const row = live.get(key);
      if (row === undefined) {
        return [];
      }
      return [row];
    });
    order = [
      ...triageOrder({ rows: startedRows, sectionOf: (row) => row.section }).map((row) => row.key),
      ...walk.order.filter((key) => !live.has(key)),
    ];
  }
  // A card stopping the owner's work goes in front of them in the Queue's order, whether the pass began with it or it
  // arrived since: a blocker on a priority before anything else the pass holds, a stopped automation once no card of
  // the owner's priorities the Queue draws ahead of it is still unshown. The priorities' own cards keep the pass's
  // order.
  const lead = triageOrder({ rows, sectionOf: (row) => row.section }).find(
    (row) => isLifted(row.section) && !walk.shown.includes(row.key) && !isSettled({ row, settled: walk.settled }),
  );
  let stopping: TriageWalkRow | undefined;
  if (lead !== undefined && lead.section !== "focus") {
    stopping = lead;
  }
  let chosen: { row: TriageWalkRow; rewritten: boolean; arrived: boolean } | undefined;
  if (stopping !== undefined) {
    chosen = { arrived: !walk.order.includes(stopping.key), row: stopping, rewritten: false };
  } else if (back !== undefined) {
    chosen = { arrived: false, row: live.get(back.key)!, rewritten: true };
  } else {
    const started = order.find((key) => {
      const row = live.get(key);
      return row !== undefined && !walk.shown.includes(key) && !isSettled({ row, settled: walk.settled });
    });
    if (started !== undefined) {
      chosen = { arrived: false, row: live.get(started)!, rewritten: false };
    } else {
      const arrival = triageOrder({ rows, sectionOf: (row) => row.section }).find(
        (row) =>
          !walk.order.includes(row.key) && !walk.shown.includes(row.key) && !isSettled({ row, settled: walk.settled }),
      );
      if (arrival !== undefined) {
        chosen = { arrived: true, row: arrival, rewritten: false };
      }
    }
  }
  // A card back stays noted as sent back while a stopping card goes in front of the owner first, so it is still back
  // next.
  const out = noted.filter((one) => stopping !== undefined || one.key !== back?.key);
  // A second `triage_next` with no card in front of the owner keeps the card before as the one just left.
  let previous = walk.previous;
  if (walk.current !== undefined) {
    previous = walk.current;
  }
  if (chosen === undefined) {
    return {
      pick: undefined,
      walk: { ...walk, current: undefined, focus: focusNow, order, out, previous, touchedMs: nowMs },
    };
  }
  const visits = walk.visits + 1;
  const visit: TriageVisit = {
    arrived: chosen.arrived,
    fingerprint: chosen.row.fingerprint,
    key: chosen.row.key,
    opened: false,
    presentedMs: nowMs,
    rewritten: chosen.rewritten,
    ruled: false,
    visitId: `${walk.walkId}-${String(visits)}`,
  };
  const shown = walk.shown.includes(visit.key) ? walk.shown : [...walk.shown, visit.key];
  // A new card with none in front of the owner follows a refused open, so the card before it is that one, never theirs
  // to rule: an older card kept as `previous` would be two visits behind.
  if (walk.current === undefined) {
    previous = undefined;
  }
  return {
    pick: { visit },
    walk: { ...walk, current: visit, focus: focusNow, order, out, previous, shown, touchedMs: nowMs, visits },
  };
}

/**
 * The visit a ruling may name. With the page having heard the answer it came in begin, exactly ONE card: the one in
 * front of the owner at that moment (`TriageFront`), while the pass still holds it as the card in front of them or the
 * one before. Their words came before the answer, so they can only be about a card they already had — never one a
 * `triage_next` put up after, in this answer or in another one running beside it, which no comparison of answer ids
 * can order. The key must name that card, so a model naming the other of two cards is refused rather
 * than believed; a card the owner already ruled takes their latest word.
 *
 * With the answer's beginning unheard, only a card nothing can be confused with: the card in front of the owner once
 * the one before it is ruled, or the card before when none is in front of them. While both are held unruled — the only
 * window in which a ruling and the `triage_next` after it can have run the wrong way round — no key is believed, and
 * the ruling lands nowhere. A key naming a ruled card before is a stale one and lands nowhere. Either
 * way only a card whose open went through, and never on a pass `triage_end` stopped — the same refusal a relay meets
 * when ending dropped the pass.
 *
 * @param walk the pass so far
 * @param key the card the ruling names
 * @param front the card in front of the owner as the ruling's answer began
 * @returns that visit, or `undefined` when the key is not the card the ruling may name or the pass is stopped
 */
export function triageVisitFor({
  walk,
  key,
  front,
}: {
  walk: TriageWalk;
  key: string;
  front: TriageFront;
}): TriageVisit | undefined {
  if (walk.stoppedMs !== undefined) {
    return undefined;
  }
  const { previous, current } = walk;
  if (front.seen) {
    const then = [current, previous].find((visit) => visit !== undefined && visit.visitId === front.visitId);
    return then?.key === key && then.opened ? then : undefined;
  }
  const reorderWindow = previous !== undefined && previous.opened && !previous.ruled;
  if (current === undefined) {
    return reorderWindow && previous.key === key ? previous : undefined;
  }
  // An unruled card before this one and no answer to tell which card the owner's words were about: a key alone cannot
  // say, so the ruling lands on neither rather than on a card put up after the answer began — even once that card is
  // ruled by a later answer the page did hear.
  if (reorderWindow) {
    return undefined;
  }
  return current.key === key && current.opened ? current : undefined;
}

/**
 * Mark a visit opened, once its open went through, so it is the owner's to rule — the card in front of them, or the one
 * before it when a second `triage_next` moved past it while it opened.
 *
 * @param walk the pass now, which a relay or another `triage_next` may have changed while the card opened
 * @param visitId the visit whose open went through
 * @returns the pass with that visit opened, or unchanged when it is neither of those cards or the pass is stopped — an
 *   open that resolves after `triage_end` makes nothing the owner's to rule
 */
export function markTriageOpened({ walk, visitId }: { walk: TriageWalk; visitId: string }): TriageWalk {
  if (walk.stoppedMs !== undefined) {
    return walk;
  }
  if (walk.current?.visitId === visitId) {
    return { ...walk, current: { ...walk.current, opened: true } };
  }
  if (walk.previous?.visitId === visitId) {
    return { ...walk, previous: { ...walk.previous, opened: true } };
  }
  return walk;
}

/**
 * Record the owner's ruling on the card it names: the one in front of them, or the one just left (`triageVisitFor`). A
 * `rewrite` sends it out to be rewritten, remembering the words the owner could not follow; a second ruling on the same
 * card replaces the first, since the latest word is the one that stands.
 *
 * @param walk the pass so far
 * @param key the card the ruling names
 * @param ruling the verdict and label the owner gave or agreed to
 * @param front the card in front of the owner as the ruling's answer began
 * @returns the pass with the ruling recorded and that card's clock spent, or unchanged when the key is neither card
 */
export function noteTriageRuling({
  walk,
  key,
  ruling,
  front,
}: {
  walk: TriageWalk;
  key: string;
  ruling: TriageRulingWire;
  front: TriageFront;
}): TriageWalk {
  const visit = triageVisitFor({ front, key, walk });
  if (visit === undefined) {
    return walk;
  }
  const ruled: TriageRuled = { key, label: ruling.label, verdict: ruling.verdict };
  const rulings = [...walk.rulings.filter((one) => one.key !== key), ruled];
  const words = { fingerprint: visit.fingerprint, key };
  let settled = walk.settled;
  if (!walk.settled.some((one) => one.key === key && one.fingerprint === visit.fingerprint)) {
    settled = [...walk.settled, words];
  }
  let out = walk.out.filter((one) => one.key !== key);
  if (ruling.verdict === "rewrite") {
    out = [...out, { fingerprint: visit.fingerprint, key, seenGone: false }];
  }
  const spent = { ...visit, ruled: true };
  return {
    ...walk,
    current: walk.current?.visitId === visit.visitId ? spent : walk.current,
    out,
    previous: walk.previous?.visitId === visit.visitId ? spent : walk.previous,
    rulings,
    settled,
  };
}

/** What the pass came to, as `triage_end` and a done `triage_next` say it. */
export interface TriageSummary {
  /** Cards the owner has been shown. */
  readonly seen: number;
  /** Cards the pass has known: the ones it began with and every arrival the owner was shown. */
  readonly of: number;
  /** The owner's rulings, counted by verdict, only the verdicts given. */
  readonly verdicts: readonly { readonly verdict: TriageVerdict; readonly count: number }[];
  /** How many rulings carried each label, only the labels given. */
  readonly labels: readonly { readonly label: TriageLabel; readonly count: number }[];
  /** Cards the owner sent back that are not back yet. */
  readonly outForRewrite: number;
  /** Cards the pass began with that are still on the owner's Queue and not yet seen. */
  readonly notReached: number;
  /** Cards the pass began with that left the owner's Queue before they were reached. */
  readonly leftBeforeReached: number;
}

/**
 * The pass's summary against the Queue now.
 *
 * @param walk the pass
 * @param rows the Queue's rows now
 * @returns the counts
 */
export function triageSummary({
  walk,
  rows,
}: {
  walk: TriageWalk;
  rows: readonly { readonly key: string }[];
}): TriageSummary {
  const live = new Set(rows.map((row) => row.key));
  const unseen = walk.order.filter((key) => !walk.shown.includes(key));
  const verdicts = [...new Set(walk.rulings.map((one) => one.verdict))].map((verdict) => ({
    count: walk.rulings.filter((one) => one.verdict === verdict).length,
    verdict,
  }));
  const given = walk.rulings.flatMap((one) => (one.label === undefined ? [] : [one.label]));
  const labels = [...new Set(given)].map((label) => ({ count: given.filter((one) => one === label).length, label }));
  return {
    labels,
    leftBeforeReached: unseen.filter((key) => !live.has(key)).length,
    notReached: unseen.filter((key) => live.has(key)).length,
    of: new Set([...walk.order, ...walk.shown]).size,
    outForRewrite: walk.out.length,
    seen: walk.shown.length,
    verdicts,
  };
}

/** A visit id's shape: the page's pass id (a UUID) and the visit's number. */
const VISIT_ID = /^[0-9a-f-]{36}-[0-9]{1,6}$/u;

/**
 * The visit id a request carries, or `undefined` when it is not one.
 *
 * @param value the request body's `visitId`
 * @returns the id, or `undefined`
 */
export function triageVisitIdOf({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string" || !VISIT_ID.test(value)) {
    return undefined;
  }
  return value;
}
