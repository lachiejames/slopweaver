/**
 * The running list as the console reads and writes it: what the owner, the voice and the fleet leave for each other, newest
 * ten, kept across calls and restarts. It is always available and separate from the transcript: all three can add to
 * it, it holds ten items, each carries a copy icon, and a dot marks what the voice or the fleet added until the owner
 * opens it.
 *
 * The list lives in `$SLOPWEAVER_HOME/talk/running-list.json`, and only the CLI touches it (`src/talk/runningList.ts`):
 * the console runs `slopweaver talk list --json` and `talk list-add` (`app/api/talk/list/route.ts`), since `site/`
 * never imports `src/` and the state home has one path derivation. So this module is the wire: the snapshot, the
 * append receipt and the route's two answers decoded strictly, the POST body read, and the argv each verb runs with.
 * Who an item is from in words, the unread count, and the order and follow rule it is drawn by are
 * `./runningListDraw.ts`'s. Pure.
 */

/**
 * The origin of an item the owner put on the list — `src/talk/runningList.ts`'s `OWNER_ORIGIN`, restated because
 * `site/` never imports `src/` and held equal by `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const OWNER_ORIGIN = "owner" as const;

/** Who put an item on the list. */
export type RunningListOrigin = typeof OWNER_ORIGIN | "voice" | "fleet";

/** One item, as `talk list --json` prints it. */
export interface RunningListItem {
  readonly seq: number;
  readonly id: string;
  readonly atIso: string;
  readonly origin: RunningListOrigin;
  /** The fleet session that added it, on a fleet item only. */
  readonly from?: string;
  /** What it is for ("reply to Ari"), when its author named it. */
  readonly label?: string;
  /** Exactly what was added — what a copy puts on the owner's clipboard. */
  readonly text: string;
  /** The line of `text` its "Show more" starts on, counted from 1, when its author folded it. */
  readonly foldLine?: number;
}

/** The list as `talk list --json` prints it: newest first, with the newest item's number (0 with none ever). */
export interface RunningListSnapshot {
  readonly newestSeq: number;
  readonly items: readonly RunningListItem[];
}

/** What `talk list-add --json` prints: the item on the list, and whether this add put it there or found it there. */
export interface RunningListReceipt {
  readonly appended: boolean;
  readonly item: RunningListItem;
}

/** The argv the console reads the list with. */
export const RUNNING_LIST_READ_ARGV: readonly string[] = ["talk", "list", "--json"];

/** The longest text one add carries, in Unicode code points — the store's own cap. */
export const RUNNING_LIST_TEXT_MAX = 8192;

/** The longest label one add carries, in Unicode code points — the store's own cap. */
export const RUNNING_LIST_LABEL_MAX = 80;

/** The longest request id one add carries, in Unicode code points — the store's own cap. */
const ID_MAX = 256;

/** An object off the wire, its fields still unread. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The fields one item may carry, as `talk list --json` prints it. */
const ITEM_KEYS: readonly string[] = ["seq", "id", "atIso", "origin", "from", "label", "text", "foldLine"];

/** Whether a record carries no field outside the ones its arm sends. */
function onlyKeys({ record, keys }: { record: Record<string, unknown>; keys: readonly string[] }): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

/** A positive whole number a sequence can be. */
function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** An optional string field: absent, or a non-empty string. */
function optionalText({ value }: { value: unknown }): { readonly ok: boolean; readonly text: string | undefined } {
  if (value === undefined) {
    return { ok: true, text: undefined };
  }
  if (typeof value === "string" && value !== "") {
    return { ok: true, text: value };
  }
  return { ok: false, text: undefined };
}

/**
 * One item off the wire, or `undefined` for anything not exactly one.
 *
 * @param value one entry of the snapshot's `items`
 * @returns the item
 */
export function runningListItemOf({ value }: { value: unknown }): RunningListItem | undefined {
  if (!isRecord(value) || !onlyKeys({ keys: ITEM_KEYS, record: value })) {
    return undefined;
  }
  const { seq, id, atIso, text } = value;
  const origin = value["origin"];
  if (!isSeq(seq) || typeof id !== "string" || id === "" || typeof text !== "string" || text === "") {
    return undefined;
  }
  if (typeof atIso !== "string" || Number.isNaN(Date.parse(atIso))) {
    return undefined;
  }
  if (origin !== OWNER_ORIGIN && origin !== "voice" && origin !== "fleet") {
    return undefined;
  }
  const from = optionalText({ value: value["from"] });
  const label = optionalText({ value: value["label"] });
  if (!from.ok || !label.ok || (from.text !== undefined && origin !== "fleet")) {
    return undefined;
  }
  const { foldLine } = value;
  if (foldLine !== undefined && (typeof foldLine !== "number" || !foldLineFits({ foldLine, text }))) {
    return undefined;
  }
  return {
    atIso,
    id,
    origin,
    seq,
    text,
    ...(from.text === undefined ? {} : { from: from.text }),
    ...(label.text === undefined ? {} : { label: label.text }),
    ...(foldLine === undefined ? {} : { foldLine }),
  };
}

/** Whether a number is a line of the text past its first, the only place a fold can start. */
function foldLineFits({ foldLine, text }: { foldLine: number; text: string }): boolean {
  return isSeq(foldLine) && foldLine >= 2 && foldLine <= text.split("\n").length;
}

/**
 * An item as the list draws it: the head shown at once and, when its author folded it, the rest behind "Show more".
 * The two joined by one `\n` are the item's text exactly, which is what a copy carries either way.
 *
 * @returns the head, and the fold or `undefined`
 */
export function runningListItemFold({ item }: { item: Pick<RunningListItem, "text" | "foldLine"> }): {
  readonly head: string;
  readonly belowFold: string | undefined;
} {
  if (item.foldLine === undefined) {
    return { belowFold: undefined, head: item.text };
  }
  const lines = item.text.split("\n");
  return {
    belowFold: lines.slice(item.foldLine - 1).join("\n"),
    head: lines.slice(0, item.foldLine - 1).join("\n"),
  };
}

/**
 * The snapshot `talk list --json` printed, or `undefined` for anything else: every item whole, newest first, none
 * above the newest number, and no id twice.
 *
 * @param value the parsed stdout
 * @returns the snapshot
 */
export function runningListSnapshotOf({ value }: { value: unknown }): RunningListSnapshot | undefined {
  if (!isRecord(value) || !onlyKeys({ keys: ["items", "newestSeq"], record: value })) {
    return undefined;
  }
  const { newestSeq, items } = value;
  if (typeof newestSeq !== "number" || !Number.isSafeInteger(newestSeq) || newestSeq < 0 || !Array.isArray(items)) {
    return undefined;
  }
  const read: RunningListItem[] = [];
  const ids = new Set<string>();
  let above = newestSeq + 1;
  for (const entry of items) {
    const item = runningListItemOf({ value: entry });
    if (item === undefined || item.seq >= above || ids.has(item.id)) {
      return undefined;
    }
    above = item.seq;
    ids.add(item.id);
    read.push(item);
  }
  return { items: read, newestSeq };
}

/**
 * The receipt `talk list-add --json` printed, or `undefined` for anything else.
 *
 * @param value the parsed stdout
 * @returns the receipt
 */
export function runningListReceiptOf({ value }: { value: unknown }): RunningListReceipt | undefined {
  if (!isRecord(value) || !onlyKeys({ keys: ["appended", "item"], record: value })) {
    return undefined;
  }
  const { appended, item } = value;
  const read = runningListItemOf({ value: item });
  if (typeof appended !== "boolean" || read === undefined) {
    return undefined;
  }
  return { appended, item: read };
}

/**
 * Whether the item a receipt names is the add that was sent, byte for byte: a retry of a held id answers the STORED
 * item, so an id reused with other words lands nothing new while the call file would record the new ones.
 *
 * @param receipt what the list answered
 * @param add what was sent
 * @returns whether the list holds exactly that add's origin, text and fold
 */
export function receiptHoldsAdd({ add, receipt }: { add: RunningListAdd; receipt: RunningListReceipt }): boolean {
  const { item } = receipt;
  return item.origin === add.origin && item.text === add.text && item.foldLine === add.foldLine;
}

/** What the console's route answers a read: the list, or why it could not be read. */
export type RunningListRead =
  | { readonly outcome: "read"; readonly snapshot: RunningListSnapshot }
  | { readonly outcome: "unread"; readonly why: string };

/**
 * What the console's route answers an add. The third arm is the one a two-armed shape would hide: a verb killed on its
 * timeout may have written the item, so the tray reads the list again rather than calling the add failed.
 */
export type RunningListAddResult =
  | {
      readonly outcome: "added";
      readonly receipt: RunningListReceipt;
      /** Why the call or conversation the owner named was not told the list changed; `undefined` when it was, or none was named. */
      readonly untold: string | undefined;
    }
  | { readonly outcome: "refused"; readonly why: string }
  | { readonly outcome: "unknown"; readonly why: string };

/**
 * The route's answer to a read, or `undefined` for anything it never sends.
 *
 * @param value the parsed response body
 * @returns the answer
 */
export function runningListReadOf({ value }: { value: unknown }): RunningListRead | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { outcome, snapshot, why } = value;
  if (outcome === "unread" && typeof why === "string" && onlyKeys({ keys: ["outcome", "why"], record: value })) {
    return { outcome, why };
  }
  const read = runningListSnapshotOf({ value: snapshot });
  if (outcome !== "read" || read === undefined || !onlyKeys({ keys: ["outcome", "snapshot"], record: value })) {
    return undefined;
  }
  return { outcome, snapshot: read };
}

/**
 * The route's answer to an add, or `undefined` for anything it never sends. JSON drops an `undefined` field, so an
 * absent `untold` is one the call was told, or none was named.
 *
 * @param value the parsed response body
 * @returns the answer
 */
export function runningListAddResultOf({ value }: { value: unknown }): RunningListAddResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { outcome, receipt, untold, why } = value;
  const failed = outcome === "refused" || outcome === "unknown";
  if (failed && typeof why === "string" && onlyKeys({ keys: ["outcome", "why"], record: value })) {
    return { outcome, why };
  }
  const read = runningListReceiptOf({ value: receipt });
  if (outcome !== "added" || read === undefined || (untold !== undefined && typeof untold !== "string")) {
    return undefined;
  }
  if (!onlyKeys({ keys: ["outcome", "receipt", "untold"], record: value })) {
    return undefined;
  }
  return { outcome, receipt: read, untold };
}

/** One add the console asked for: the owner's words or the voice's, under the id the caller minted. */
export interface RunningListAdd {
  readonly origin: typeof OWNER_ORIGIN | "voice";
  readonly id: string;
  readonly text: string;
  readonly label?: string;
  /** The line of `text` the voice's "Show more" starts on; only the voice folds, the owner's own words show whole. */
  readonly foldLine?: number;
  /** The call or typed conversation up as the owner added it, told the list changed; absent with none. */
  readonly callId?: string;
}

/** Code points, as the store counts them. */
function codePoints({ text }: { text: string }): number {
  return Array.from(text).length;
}

/**
 * The POST body read into one add, or the sentence it is refused with. The text is never trimmed or rewritten;
 * whitespace only decides whether there is anything to add. The fleet adds through the CLI, never through here.
 *
 * @param body the parsed JSON body
 * @returns the add, or why not
 */
export function runningListAddOf({
  body,
}: {
  body: unknown;
}): { readonly kind: "add"; readonly add: RunningListAdd } | { readonly kind: "refused"; readonly why: string } {
  if (!isRecord(body)) {
    return { kind: "refused", why: "the body is not an object" };
  }
  const { id, text, label, callId, foldLine } = body;
  const origin = body["origin"];
  if (origin !== OWNER_ORIGIN && origin !== "voice") {
    return { kind: "refused", why: "origin must be the owner or the voice" };
  }
  if (typeof id !== "string" || id === "" || codePoints({ text: id }) > ID_MAX || /\p{Cc}/u.test(id)) {
    return { kind: "refused", why: "id must be a request id of one line" };
  }
  if (typeof text !== "string" || text.trim() === "") {
    return { kind: "refused", why: "there is nothing to add" };
  }
  if (codePoints({ text }) > RUNNING_LIST_TEXT_MAX) {
    return { kind: "refused", why: `the text is over ${String(RUNNING_LIST_TEXT_MAX)} characters` };
  }
  let named: string | undefined;
  if (label !== undefined) {
    if (typeof label !== "string" || codePoints({ text: label }) > RUNNING_LIST_LABEL_MAX) {
      return { kind: "refused", why: `label must be at most ${String(RUNNING_LIST_LABEL_MAX)} characters` };
    }
    if (label.trim() !== "") {
      named = label;
    }
  }
  if (callId !== undefined && (typeof callId !== "string" || callId === "")) {
    return { kind: "refused", why: "callId must be the id of the call or conversation up, or left out" };
  }
  let fold: number | undefined;
  if (foldLine !== undefined) {
    if (origin !== "voice" || typeof foldLine !== "number" || !foldLineFits({ foldLine, text })) {
      return { kind: "refused", why: "foldLine must be a line of the voice's text past its first, or left out" };
    }
    fold = foldLine;
  }
  return {
    add: {
      id,
      origin,
      text,
      ...(named === undefined ? {} : { label: named }),
      ...(fold === undefined ? {} : { foldLine: fold }),
      ...(callId === undefined ? {} : { callId }),
    },
    kind: "add",
  };
}

/**
 * The argv one add runs `talk list-add` with; its text goes on stdin, never here.
 *
 * @returns the argv after `slopweaver`
 */
export function runningListAddArgv({ add }: { add: RunningListAdd }): readonly string[] {
  const argv = ["talk", "list-add", "--origin", add.origin, "--id", add.id, "--json"];
  if (add.label !== undefined) {
    argv.push("--label", add.label);
  }
  if (add.foldLine !== undefined) {
    argv.push("--fold-line", String(add.foldLine));
  }
  return argv;
}
