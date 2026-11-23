/**
 * The running list — the place beside the conversation where the owner and the fleet leave things for each other, and the
 * pure half of it: what an item is, what the list holds, and what one append does to it. `./runningListStore.ts` is
 * the file it lives in.
 *
 * The owner wants a place where each side can put things for the other to look at, separate from the conversation but
 * visible to both; items survive hanging up, and once it holds ten it never again drops below ten items. So the list keeps the newest {@link RUNNING_LIST_KEPT} and
 * nothing else: an append past ten pushes the oldest off, and there is no edit, delete or clear.
 *
 * An item's `id` is the writer's request id. A retry carrying an id the list still holds is the same append, answered
 * with the stored item and no write; an id whose item has already rolled off is a new append. A retry comes seconds
 * after its first try, so ten other appends landing in between is not a case worth an id archive.
 *
 * Pure: no I/O.
 */

import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";

import { redactCredentials, survivingSecrets } from "./fileRedaction.js";
import { type RunningListError, RunningListErrors } from "./runningListErrors.js";
import { retiredOriginRow } from "./runningListRetiredOrigin.js";

/** How many items the list keeps: the owner's number, over the eight an earlier build chose. */
export const RUNNING_LIST_KEPT = 10;

/** The most code points one item's text may carry — a long Slack message, not a file. */
export const RUNNING_LIST_TEXT_MAX = 8 * 1024;

/** The most code points a label may carry: a few words naming what the item is for. */
export const RUNNING_LIST_LABEL_MAX = 80;

/** The most code points a fleet writer's name may carry: a session or workspace slug. */
const RUNNING_LIST_FROM_MAX = 80;

/** The most code points a request id may carry. */
const RUNNING_LIST_ID_MAX = 256;

/**
 * The origin of an item the owner put in the list. `site/lib/runningList.ts` restates it for the console, held equal
 * by `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const OWNER_ORIGIN = "owner" as const;

/** Who put an item in the list: the owner, the console voice, or a fleet session through the verb. */
export type RunningListOrigin = typeof OWNER_ORIGIN | "voice" | "fleet";

/** Every origin, in the order a usage line names them. */
export const RUNNING_LIST_ORIGINS: readonly RunningListOrigin[] = [OWNER_ORIGIN, "voice", "fleet"];

/** One item, as the list holds it. */
export interface RunningListItem {
  /** Its place in the order every item ever added was given, from 1; the newest is the highest. */
  readonly seq: number;
  /** The writer's request id. */
  readonly id: string;
  /** When the list took it. */
  readonly atIso: string;
  readonly origin: RunningListOrigin;
  /** The fleet session that put it there; only a fleet item carries one. */
  readonly from?: string;
  /** A few words naming what it is for. */
  readonly label?: string;
  /** Exactly what was put there. */
  readonly text: string;
  /**
   * The line of `text` its "Show more" starts on, counted from 1, when its author folded it: the voice's `below_fold`
   * (`site/lib/runningListCopy.ts`). Only where it is drawn; the text is whole either way.
   */
  readonly foldLine?: number;
}

/** The list as it is stored: the next number to give, and the items, newest first. */
export interface RunningListDocument {
  readonly version: 1;
  readonly nextSeq: number;
  readonly items: readonly RunningListItem[];
}

/** What a writer asks the list to hold, before the list numbers and times it. */
export interface RunningListDraft {
  readonly id: string;
  readonly origin: RunningListOrigin;
  readonly from?: string;
  readonly label?: string;
  readonly text: string;
  readonly foldLine?: number;
}

/** What a reader is answered: the newest number given, and the items newer than its cursor, newest first. */
export interface RunningListSnapshot {
  /** The highest `seq` the list holds, or 0 for a list nothing was ever added to. */
  readonly newestSeq: number;
  readonly items: readonly RunningListItem[];
}

/** One item as the voice reads it: its credentials masked, or withheld when masking did not hold. */
export type RunningListVoiceItem =
  | (RunningListItem & { readonly withheld?: undefined })
  | {
      readonly seq: number;
      readonly id: string;
      readonly atIso: string;
      readonly origin: RunningListOrigin;
      readonly from?: string;
      readonly withheld: string;
    };

/** The empty list: what a home that has never held an item reads as. */
export const EMPTY_RUNNING_LIST: RunningListDocument = { items: [], nextSeq: 1, version: 1 };

/** How many code points a string carries, counting an astral character once. */
function codePoints({ text }: { text: string }): number {
  return Array.from(text).length;
}

/** A control character, which no id, label or name may carry. */
const CONTROL = /\p{Cc}/u;

/**
 * Why one short field will not do, or `undefined` when it will.
 *
 * @returns the reason, or `undefined`
 */
function shortFieldWhy({ value, max }: { value: string; max: number }): string | undefined {
  if (value.length === 0) {
    return "it is empty";
  }
  if (codePoints({ text: value }) > max) {
    return `it is over ${String(max)} characters`;
  }
  if (CONTROL.test(value)) {
    return "it carries a control character";
  }
  return undefined;
}

/**
 * Why an item's text will not do, or `undefined` when it will: one to {@link RUNNING_LIST_TEXT_MAX} code points, and
 * no other rule, because the text is kept exactly as given.
 *
 * @returns the reason, or `undefined`
 */
function textWhy({ text }: { text: string }): string | undefined {
  if (text.length === 0) {
    return "it is empty";
  }
  if (codePoints({ text }) > RUNNING_LIST_TEXT_MAX) {
    return `it is over ${String(RUNNING_LIST_TEXT_MAX)} characters`;
  }
  return undefined;
}

/**
 * Why an item's `from` will not do, or `undefined` when it will or is absent: only a fleet item names who put it there.
 *
 * @returns the reason, or `undefined`
 */
function fromWhy({ origin, from }: { origin: RunningListOrigin; from: string | undefined }): string | undefined {
  if (from === undefined) {
    return undefined;
  }
  if (origin !== "fleet") {
    return "only a fleet item names who put it there";
  }
  return shortFieldWhy({ max: RUNNING_LIST_FROM_MAX, value: from });
}

/**
 * Why an item's `foldLine` will not do, or `undefined` when it will or is absent: a line of the text past the first,
 * with something beyond whitespace both above it and from it on, since an empty head or an empty "Show more" hides
 * nothing.
 *
 * @returns the reason, or `undefined`
 */
function foldLineWhy({ text, foldLine }: { text: string; foldLine: number | undefined }): string | undefined {
  if (foldLine === undefined) {
    return undefined;
  }
  const lines = text.split("\n");
  if (!Number.isSafeInteger(foldLine) || foldLine < 2 || foldLine > lines.length) {
    return `it must be a line of the text from 2 to ${String(lines.length)}`;
  }
  const head = lines.slice(0, foldLine - 1).join("\n");
  const rest = lines.slice(foldLine - 1).join("\n");
  if (head.trim() === "" || rest.trim() === "") {
    return "the text above it and from it on must each carry something";
  }
  return undefined;
}

/**
 * Check a writer's draft against what the list holds, before any I/O: text of one to
 * {@link RUNNING_LIST_TEXT_MAX} code points kept exactly as given, a short label and id, a `from` only on a fleet
 * item, and a fold only on a line that leaves something on both sides of it.
 *
 * @returns the draft unchanged, or the first field it fails on
 */
export function runningListDraftOf({
  id,
  origin,
  from,
  label,
  text,
  foldLine,
}: RunningListDraft): Result<RunningListDraft, RunningListError> {
  if (!RUNNING_LIST_ORIGINS.includes(origin)) {
    return err(
      RunningListErrors.inputInvalid({ field: "origin", why: `"${origin}" is not the owner, voice or fleet` }),
    );
  }
  const failures = [
    { field: "text", why: textWhy({ text }) },
    { field: "id", why: shortFieldWhy({ max: RUNNING_LIST_ID_MAX, value: id }) },
    {
      field: "label",
      why: label === undefined ? undefined : shortFieldWhy({ max: RUNNING_LIST_LABEL_MAX, value: label }),
    },
    { field: "from", why: fromWhy({ from, origin }) },
    { field: "foldLine", why: textWhy({ text }) === undefined ? foldLineWhy({ foldLine, text }) : undefined },
  ];
  const failure = failures.find((check) => check.why !== undefined);
  if (failure?.why !== undefined) {
    return err(RunningListErrors.inputInvalid({ field: failure.field, why: failure.why }));
  }
  return ok({
    id,
    origin,
    text,
    ...(from === undefined ? {} : { from }),
    ...(label === undefined ? {} : { label }),
    ...(foldLine === undefined ? {} : { foldLine }),
  });
}

/** One stored item's shape. */
const itemSchema = z
  .object({
    atIso: z.iso.datetime(),
    foldLine: z.number().int().optional(),
    from: z.string().optional(),
    id: z.string(),
    label: z.string().optional(),
    origin: z.enum([OWNER_ORIGIN, "voice", "fleet"]),
    seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    text: z.string(),
  })
  .strict();

/** The stored document's shape. */
const documentSchema = z
  .object({
    items: z.array(itemSchema).max(RUNNING_LIST_KEPT),
    nextSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    version: z.literal(1),
  })
  .strict();

/**
 * Decode a stored list, holding it to what an append writes: at most {@link RUNNING_LIST_KEPT} items, newest first
 * with strictly falling numbers, every number below `nextSeq`, every id once, and every item a draft the list would
 * take.
 *
 * @param value the parsed JSON
 * @param path the file it came from, named in the error
 * @returns the document, or why it is not a running list
 */
export function runningListDocumentOf({
  value,
  path,
}: {
  value: unknown;
  path: string;
}): Result<RunningListDocument, RunningListError> {
  const retired = retiredOriginRow({ value });
  if (retired !== undefined) {
    return err(RunningListErrors.retiredOrigin({ origin: retired.origin, path, row: retired.row }));
  }
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) {
    return err(RunningListErrors.storeUnreadable({ path, why: parsed.error.issues[0]!.message }));
  }
  const items: RunningListItem[] = [];
  const ids = new Set<string>();
  for (const raw of parsed.data.items) {
    const item = storedItemOf({ raw });
    const why = storedItemWhy({ ids, item, nextSeq: parsed.data.nextSeq, previous: items.at(-1) });
    if (why !== undefined) {
      return err(RunningListErrors.storeUnreadable({ path, why }));
    }
    ids.add(item.id);
    items.push(item);
  }
  return ok({ items, nextSeq: parsed.data.nextSeq, version: 1 });
}

/**
 * One schema-checked stored item as a {@link RunningListItem}, an absent optional field left absent.
 *
 * @returns the item
 */
function storedItemOf({ raw }: { raw: z.infer<typeof itemSchema> }): RunningListItem {
  return {
    atIso: raw.atIso,
    id: raw.id,
    origin: raw.origin,
    seq: raw.seq,
    text: raw.text,
    ...(raw.from === undefined ? {} : { from: raw.from }),
    ...(raw.label === undefined ? {} : { label: raw.label }),
    ...(raw.foldLine === undefined ? {} : { foldLine: raw.foldLine }),
  };
}

/**
 * Why one stored item breaks what an append writes, or `undefined` when it does not.
 *
 * @param ids every id held by the items above it
 * @param previous the item above it, absent for the first
 * @param nextSeq the number the next append takes
 * @returns the reason, naming the item, or `undefined`
 */
function storedItemWhy({
  ids,
  item,
  nextSeq,
  previous,
}: {
  ids: ReadonlySet<string>;
  item: RunningListItem;
  nextSeq: number;
  previous: RunningListItem | undefined;
}): string | undefined {
  const draft = runningListDraftOf(item);
  if (draft.isErr()) {
    return `item ${String(item.seq)}: ${draft.error.message}`;
  }
  if (previous !== undefined && item.seq >= previous.seq) {
    return `item ${String(item.seq)} is out of order`;
  }
  if (item.seq >= nextSeq) {
    return `item ${String(item.seq)} is not below nextSeq`;
  }
  if (ids.has(item.id)) {
    return `the id "${item.id}" is held twice`;
  }
  return undefined;
}

/**
 * Add one draft to the list: the same id already held answers with that item and changes nothing; otherwise the draft
 * is numbered, timed and put on top, and the list cut back to the newest {@link RUNNING_LIST_KEPT}.
 *
 * @param document the list as read under the lock
 * @param draft a draft {@link runningListDraftOf} accepted
 * @param atIso the instant the list takes it
 * @returns the list to write, the item, and whether it was added — `false` for a retry, which writes nothing
 */
export function withRunningListItem({
  document,
  draft,
  atIso,
}: {
  document: RunningListDocument;
  draft: RunningListDraft;
  atIso: string;
}): { readonly document: RunningListDocument; readonly item: RunningListItem; readonly appended: boolean } {
  const held = document.items.find((item) => item.id === draft.id);
  if (held !== undefined) {
    return { appended: false, document, item: held };
  }
  const item: RunningListItem = { ...draft, atIso, seq: document.nextSeq };
  return {
    appended: true,
    document: {
      items: [item, ...document.items].slice(0, RUNNING_LIST_KEPT),
      nextSeq: document.nextSeq + 1,
      version: 1,
    },
    item,
  };
}

/**
 * What a reader is answered: every item newer than its cursor, newest first.
 *
 * @param since the highest `seq` the reader already has; omitted, every item
 * @returns the newest number given and the items above the cursor
 */
export function runningListSnapshotOf({
  document,
  since,
}: {
  document: RunningListDocument;
  since?: number;
}): RunningListSnapshot {
  const newest = document.items[0];
  return {
    items: since === undefined ? document.items : document.items.filter((item) => item.seq > since),
    newestSeq: newest === undefined ? 0 : newest.seq,
  };
}

/**
 * The list as the voice may read it. Every item's credentials are masked the way a local file is
 * (`./fileRedaction.ts`), and an item the hygiene gate still flags after masking is withheld whole, its text
 * replaced by why. Every item, whatever its origin, because `list-add --origin` is the writer's own word, so a fleet
 * session could file one as the owner's and walk it past a fleet-only mask. The owner's ordinary words
 * cost nothing for it: only a credential shape or a denylisted string is masked, so a channel ID the owner typed still
 * reads back exactly. Every field is masked, its label, its session's name and its id as well as its text, since
 * each is read out the same way. A withheld item is named by its number alone.
 *
 * @param denylist the owner's private list of secret strings
 * @returns each item, newest first, masked, or withheld where masking did not hold
 */
export function voiceSafeRunningList({
  snapshot,
  denylist,
}: {
  snapshot: RunningListSnapshot;
  denylist: readonly string[];
}): readonly RunningListVoiceItem[] {
  const mask = ({ text }: { text: string }): { readonly text: string; readonly survivors: readonly string[] } => {
    const masked = redactCredentials({ denylist, source: false, text }).text;
    return { survivors: survivingSecrets({ denylist, text: masked }), text: masked };
  };
  return snapshot.items.map((item): RunningListVoiceItem => {
    const text = mask({ text: item.text });
    const id = mask({ text: item.id });
    const label = item.label === undefined ? undefined : mask({ text: item.label });
    const from = item.from === undefined ? undefined : mask({ text: item.from });
    const survivors = [
      ...new Set([text, id, label, from].flatMap((field) => (field === undefined ? [] : field.survivors))),
    ];
    if (survivors.length > 0) {
      return {
        atIso: item.atIso,
        id: `#${String(item.seq)}`,
        origin: item.origin,
        seq: item.seq,
        withheld: `withheld: it still carries a ${survivors.join(", ")} after masking`,
      };
    }
    return {
      ...item,
      id: id.text,
      text: text.text,
      ...(label === undefined ? {} : { label: label.text }),
      ...(from === undefined ? {} : { from: from.text }),
    };
  });
}
