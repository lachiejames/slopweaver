/**
 * The expanded half of an Automations card, read off `automation status --json`: what each firing posted or filed, and
 * every request sent to the supervisor about the row with its answer and the row's dated timeline.
 *
 * The same rules as `./readAutomations.ts`: refuse rather than substitute, never a shorter list. Every field is the
 * verb's (`src/automations/outputs.ts`, `src/automations/steering.ts`); `null` on the wire reads as `undefined`.
 */

import { type Bag, bags, bool, every, nullableStr, num, str, sub } from "../../lib/bag";

/** Where a firing posted, as the executor recorded it when the post was confirmed. */
export interface Posting {
  readonly channel: string;
  readonly ts: string;
  readonly postedAtIso: string;
}

/** The board row a failed firing filed. */
export interface Finding {
  readonly slug: string;
  readonly summary: string | undefined;
  readonly status: string;
  readonly settlement: string | undefined;
}

/** What one firing produced, or why the page cannot say. */
export interface FiringOutput {
  readonly slotIso: string;
  readonly posting: Posting | undefined;
  /** Why the ledger, read whole, holds no posting for it. */
  readonly postingNote: string | undefined;
  /** Why its posting record would not read, when it would not. */
  readonly postingUnreadable: string | undefined;
  readonly finding: Finding | undefined;
  /** Why the finding it filed would not read, when it would not. */
  readonly findingNote: string | undefined;
}

/** What a row produced. */
export interface AutomationOutputs {
  readonly firings: readonly FiringOutput[];
  readonly postingsNote: string | undefined;
  readonly readings: readonly {
    readonly atIso: string;
    readonly producer: string;
    readonly file: string;
    readonly bytes: number;
  }[];
  readonly notes: readonly { readonly atIso: string; readonly what: string; readonly url: string | undefined }[];
  /** Why the readings or notes above may be missing — their store would not read. */
  readonly storeGap: string | undefined;
}

/** One request sent to the supervisor about a row. */
export interface Steer {
  readonly turnId: string;
  readonly slug: string;
  readonly sentAtIso: string;
  readonly words: string;
  readonly delivery: { readonly kind: string; readonly detail: string; readonly atIso: string } | undefined;
  readonly answer: { readonly settlement: string; readonly witness: string | undefined } | undefined;
  readonly answerUnreadable: string | undefined;
  /** Whether the board read and no row claims this request, so no answer will land. */
  readonly boardRowMissing: boolean;
}

/** The first firing after a timeline entry. */
export interface FiringAfter {
  readonly slotIso: string;
  readonly startedAtIso: string;
  readonly outcome: string;
  readonly posting: Posting | undefined;
  /** Why its posting record would not read, when it would not. */
  readonly postingUnreadable: string | undefined;
}

/** One dated entry on a row's timeline, oldest first. */
export interface TimelineEntry {
  readonly atIso: string;
  readonly kind: "stated" | "steer";
  /** Which record dated a `stated` entry: the row file's birth, or its oldest firing on the ledger. */
  readonly earliestFrom: "file-born" | "oldest-firing" | undefined;
  readonly text: string;
  readonly steer: Steer | undefined;
  readonly firingAfter: FiringAfter | undefined;
  readonly rowEditedAfterIso: string | undefined;
}

/** How a row has been steered. */
export interface AutomationSteering {
  readonly key: string | undefined;
  readonly keyRefusal: string | undefined;
  readonly steers: readonly Steer[];
  readonly unanswered: number;
  readonly nextFiringIso: string | undefined;
  readonly timeline: readonly TimelineEntry[];
  /** Why the steers above may be missing — the relay store would not read. */
  readonly storeGap: string | undefined;
}

/** A nested object or `null`, read by `read`: the value, `undefined` for `null`, `false` for anything else. */
function nullableSub<T>({
  bag,
  key,
  read,
}: {
  bag: Bag;
  key: string;
  read: (inner: Bag) => T | undefined;
}): T | undefined | false {
  if (bag[key] === null) {
    return undefined;
  }
  const inner = sub({ bag, key });
  if (inner === undefined) {
    return false;
  }
  const value = read(inner);
  if (value === undefined) {
    return false;
  }
  return value;
}

/** One posting. */
function posting(bag: Bag): Posting | undefined {
  const channel = str({ bag, key: "channel" });
  const ts = str({ bag, key: "ts" });
  const postedAtIso = str({ bag, key: "postedAtIso" });
  if (channel === undefined || ts === undefined || postedAtIso === undefined) {
    return undefined;
  }
  return { channel, postedAtIso, ts };
}

/** One finding. */
function finding(bag: Bag): Finding | undefined {
  const slug = str({ bag, key: "slug" });
  const status = str({ bag, key: "status" });
  const summary = nullableStr({ bag, key: "summary" });
  const settlement = nullableStr({ bag, key: "settlement" });
  if (slug === undefined || status === undefined || summary === false || settlement === false) {
    return undefined;
  }
  return { settlement, slug, status, summary };
}

/** One firing's output. */
function firingOutput(bag: Bag): FiringOutput | undefined {
  const slotIso = str({ bag, key: "slotIso" });
  const posted = nullableSub({ bag, key: "posting", read: posting });
  const postingNote = nullableStr({ bag, key: "postingNote" });
  const postingUnreadable = nullableStr({ bag, key: "postingUnreadable" });
  const found = nullableSub({ bag, key: "finding", read: finding });
  const findingNote = nullableStr({ bag, key: "findingNote" });
  if (slotIso === undefined || posted === false || postingNote === false || postingUnreadable === false) {
    return undefined;
  }
  if (found === false || findingNote === false) {
    return undefined;
  }
  return { finding: found, findingNote, posting: posted, postingNote, postingUnreadable, slotIso };
}

/** One reading. */
function reading(bag: Bag): AutomationOutputs["readings"][number] | undefined {
  const atIso = str({ bag, key: "atIso" });
  const producer = str({ bag, key: "producer" });
  const file = str({ bag, key: "file" });
  const bytes = num({ bag, key: "bytes" });
  if (atIso === undefined || producer === undefined || file === undefined || bytes === undefined) {
    return undefined;
  }
  return { atIso, bytes, file, producer };
}

/** One floating note. */
function note(bag: Bag): AutomationOutputs["notes"][number] | undefined {
  const atIso = str({ bag, key: "atIso" });
  const what = str({ bag, key: "what" });
  const url = nullableStr({ bag, key: "url" });
  if (atIso === undefined || what === undefined || url === false) {
    return undefined;
  }
  return { atIso, url, what };
}

/**
 * A card's outputs.
 *
 * @param bag the card's `outputs` object, or `undefined` when it was not one
 * @returns the outputs, or `undefined` when any part is not the verb's shape
 */
export function readAutomationOutputs({ bag }: { bag: Bag | undefined }): AutomationOutputs | undefined {
  if (bag === undefined) {
    return undefined;
  }
  const firings = every({ list: bags({ bag, key: "firings" }), read: firingOutput });
  const readings = every({ list: bags({ bag, key: "readings" }), read: reading });
  const notes = every({ list: bags({ bag, key: "notes" }), read: note });
  const postingsNote = nullableStr({ bag, key: "postingsNote" });
  const storeGap = nullableStr({ bag, key: "storeGap" });
  if (firings === undefined || readings === undefined || notes === undefined) {
    return undefined;
  }
  if (postingsNote === false || storeGap === false) {
    return undefined;
  }
  return { firings, notes, postingsNote, readings, storeGap };
}

/** A delivery line. */
function delivery(bag: Bag): Steer["delivery"] {
  const kind = str({ bag, key: "kind" });
  const detail = str({ bag, key: "detail" });
  const atIso = str({ bag, key: "atIso" });
  if (kind === undefined || detail === undefined || atIso === undefined) {
    return undefined;
  }
  return { atIso, detail, kind };
}

/** The supervisor's recorded answer. */
function answer(bag: Bag): Steer["answer"] {
  const settlement = str({ bag, key: "settlement" });
  const witness = nullableStr({ bag, key: "witness" });
  if (settlement === undefined || witness === false) {
    return undefined;
  }
  return { settlement, witness };
}

/** One steer. */
function steer(bag: Bag): Steer | undefined {
  const turnId = str({ bag, key: "turnId" });
  const slug = str({ bag, key: "slug" });
  const sentAtIso = str({ bag, key: "sentAtIso" });
  const words = str({ bag, key: "words" });
  const delivered = nullableSub({ bag, key: "delivery", read: delivery });
  const answered = nullableSub({ bag, key: "answer", read: answer });
  const answerUnreadable = nullableStr({ bag, key: "answerUnreadable" });
  const boardRowMissing = bool({ bag, key: "boardRowMissing" });
  if (turnId === undefined || slug === undefined || sentAtIso === undefined || words === undefined) {
    return undefined;
  }
  if (delivered === false || answered === false || answerUnreadable === false || boardRowMissing === undefined) {
    return undefined;
  }
  return { answer: answered, answerUnreadable, boardRowMissing, delivery: delivered, sentAtIso, slug, turnId, words };
}

/** The first firing after an entry. */
function firingAfter(bag: Bag): FiringAfter | undefined {
  const slotIso = str({ bag, key: "slotIso" });
  const startedAtIso = str({ bag, key: "startedAtIso" });
  const outcome = str({ bag, key: "outcome" });
  const posted = nullableSub({ bag, key: "posting", read: posting });
  const postingUnreadable = nullableStr({ bag, key: "postingUnreadable" });
  if (
    slotIso === undefined ||
    startedAtIso === undefined ||
    outcome === undefined ||
    posted === false ||
    postingUnreadable === false
  ) {
    return undefined;
  }
  return { outcome, posting: posted, postingUnreadable, slotIso, startedAtIso };
}

/** One timeline entry. */
function timelineEntry(bag: Bag): TimelineEntry | undefined {
  const atIso = str({ bag, key: "atIso" });
  const kind = str({ bag, key: "kind" });
  const text = str({ bag, key: "text" });
  const steered = nullableSub({ bag, key: "steer", read: steer });
  const after = nullableSub({ bag, key: "firingAfter", read: firingAfter });
  const rowEditedAfterIso = nullableStr({ bag, key: "rowEditedAfterIso" });
  const earliestFrom = nullableStr({ bag, key: "earliestFrom" });
  if (atIso === undefined || text === undefined || (kind !== "stated" && kind !== "steer")) {
    return undefined;
  }
  if (steered === false || after === false || rowEditedAfterIso === false || earliestFrom === false) {
    return undefined;
  }
  if (earliestFrom !== undefined && earliestFrom !== "file-born" && earliestFrom !== "oldest-firing") {
    return undefined;
  }
  return { atIso, earliestFrom, firingAfter: after, kind, rowEditedAfterIso, steer: steered, text };
}

/**
 * A card's steering.
 *
 * @param bag the card's `steering` object, or `undefined` when it was not one
 * @returns the steering, or `undefined` when any part is not the verb's shape
 */
export function readAutomationSteering({ bag }: { bag: Bag | undefined }): AutomationSteering | undefined {
  if (bag === undefined) {
    return undefined;
  }
  const key = nullableStr({ bag, key: "key" });
  const keyRefusal = nullableStr({ bag, key: "keyRefusal" });
  const nextFiringIso = nullableStr({ bag, key: "nextFiringIso" });
  const unanswered = num({ bag, key: "unanswered" });
  const steers = every({ list: bags({ bag, key: "steers" }), read: steer });
  const timeline = every({ list: bags({ bag, key: "timeline" }), read: timelineEntry });
  if (key === false || keyRefusal === false || nextFiringIso === false || unanswered === undefined) {
    return undefined;
  }
  const storeGap = nullableStr({ bag, key: "storeGap" });
  if (steers === undefined || timeline === undefined || storeGap === false) {
    return undefined;
  }
  return { key, keyRefusal, nextFiringIso, steers, storeGap, timeline, unanswered };
}
