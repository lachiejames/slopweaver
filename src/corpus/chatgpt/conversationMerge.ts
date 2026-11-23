/**
 * Which held copy's version of each conversation a refresh writes: a held export's, or the live copy's
 * (`conversationInput.ts`). Every rule below is stated for exports and holds for the live copy unchanged, since it is
 * one more held copy of the same conversations in the same shape.
 *
 * An export is a snapshot of the owner's whole account, but no one instant orders two snapshots for every chat in them. The owner
 * can delete the chat touched last and then add a message to an older one: the earlier export still holds the
 * account's latest instant, while the later one holds the newer version of every other chat it shares. A file's
 * time orders them no better, since a copy renews it. So the choice is made per CONVERSATION, by that
 * conversation's own newest instant (`update_time`, else `create_time`): the version that ran latest is written, and
 * every other export's copy of it is left alone, whichever export the chronology calls newest.
 *
 * Two versions are compared by what they would WRITE (each projected record's content fingerprint, plus the count of
 * messages each could not write), so a field the projection never reads cannot make two copies of one chat look
 * different. Choosing a version never exempts the other copies from the ingest's coverage checks: every copy of
 * every chat is checked, so a gap in a copy left to another export still fails the refresh. Two that differ and cannot be ordered
 * (the same newest instant on both, or none on one) are named as a coverage gap, failing the refresh and withholding
 * every receipt, never decided by which export happened to be read first. So is a latest version that changed a
 * message and dates it before another copy does, which bronze would drop as stale, or that lacks a message another
 * copy holds. A copy that will not read may be
 * the latest one, so the conversation it names is written from no export, and one naming none writes nothing.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";

import { readJsonArrayElements } from "#lib/jsonArrayFile.js";

import { projectChatConversation } from "../chatHistory/project.js";
import { recordContentFingerprint } from "../recordSerialisation.js";
import type { StoredConversationInput } from "./conversationInput.js";
import { parseExportConversation } from "./exportConversation.js";
import { elementIds, readExportElement } from "./exportElement.js";

/** One held copy's version of one conversation. */
export interface ConversationVersion {
  /** The held copy it is in, by {@link StoredConversationInput.key}. */
  readonly inputKey: string;
  /** That copy's {@link StoredConversationInput.kind} and {@link StoredConversationInput.label}, for a gap line. */
  readonly kind: StoredConversationInput["kind"];
  readonly label: string;
  /** Its newest instant, or `undefined` when it carries none. */
  readonly activityIso: string | undefined;
  /** A digest of the records it would write. */
  readonly digest: string;
  /** Each record it would write, by `sourceId`: its content fingerprint and the instant it is dated by. */
  readonly messages: ReadonlyMap<string, { readonly fingerprint: string; readonly tsIso: string }>;
}

/** Which export each conversation is written from, and the conversations whose versions cannot be ordered. */
export interface MergePlan {
  /** Conversation id → the held export whose version is written. An id absent here is written wherever it is read. */
  readonly takeFrom: ReadonlyMap<string, string>;
  /**
   * Ids written from no export: versions that differ with no order between them, a latest that backdates a change, or
   * a copy that would not read.
   */
  readonly unordered: ReadonlySet<string>;
  /** The refresh's coverage gaps for the unordered; a copy that would not read is the ingest's to name. */
  readonly gaps: readonly string[];
}

/** A plan that writes every conversation wherever it is read — one export alone. */
export const SINGLE_EXPORT_PLAN: MergePlan = { gaps: [], takeFrom: new Map(), unordered: new Set() };

/**
 * What could not be weighed. A conversation an unreadable element names may be that conversation's LATEST copy, so no
 * export's version of it is written; one naming no conversation may be any of them, so none is. The ingest names each
 * element as a gap; this only keeps an older copy from standing in for it.
 */
export interface UnweighedElements {
  /** Every id an element that would not read named, and every id one export holds twice in two versions. */
  readonly ids: ReadonlySet<string>;
  /** Whether an element that would not read named no conversation, or a file was not read whole. */
  readonly anonymous: boolean;
}

/** Every held export's version of every conversation, and what could not be weighed. */
export interface ExportIndex {
  /** Each conversation id's versions, in the order the exports were given. */
  readonly versions: ReadonlyMap<string, readonly ConversationVersion[]>;
  readonly unweighed: UnweighedElements;
}

/** Nothing left unweighed. */
const ALL_WEIGHED: UnweighedElements = { anonymous: false, ids: new Set() };

/** One element's version, or the ids it names when it will not read — the ingest names that gap, by id or position. */
function versionOf({
  text,
  label,
}: {
  text: string;
  label: string;
}):
  | { id: string; version: Omit<ConversationVersion, "inputKey" | "kind" | "label"> }
  | { unreadable: readonly string[] } {
  const read = readExportElement({ label, text });
  if (read.isErr()) {
    return { unreadable: read.error.ids };
  }
  const parsed = parseExportConversation({ value: read.value });
  if (parsed.isErr()) {
    return { unreadable: elementIds({ value: read.value }) };
  }
  const conversation = parsed.value;
  const projected = projectChatConversation({ conversation, source: "chatgpt" });
  const messages = new Map(
    projected.records.map((record) => [
      record.sourceId,
      { fingerprint: recordContentFingerprint({ record }), tsIso: record.tsIso },
    ]),
  );
  const hash = createHash("sha256");
  for (const fingerprint of [...messages.values()].map((one) => one.fingerprint).toSorted()) {
    hash.update(`${fingerprint}\0`);
  }
  // A message it cannot write still makes a copy different: the ingest names it as a gap on every copy, and this
  // keeps a copy carrying one from weighing as identical to one that does not.
  hash.update(`undated ${String(projected.undated)}\0`);
  for (const [kind, count] of [...conversation.unknownKinds].toSorted(([a], [b]) => a.localeCompare(b))) {
    hash.update(`unknown ${kind} ${String(count)}\0`);
  }
  // `update_time` orders versions whenever it is there; a `create_time` past it says nothing about which ran later.
  return {
    id: conversation.id,
    version: { activityIso: activityOf({ conversation }), digest: hash.digest("hex"), messages },
  };
}

/** When a conversation last moved: its `update_time` when the export carries one, else when it began. */
function activityOf({
  conversation,
}: {
  conversation: { updatedIso?: string | undefined; createdIso?: string | undefined };
}): string | undefined {
  const updated = conversation.updatedIso;
  if (updated !== undefined) {
    return updated;
  }
  return conversation.createdIso;
}

/**
 * Every conversation's version in every export, read one element at a time, and what would not read. An export
 * holding one id twice in two versions leaves that id unweighed: the ingest names the second copy as a gap, and
 * either may be the latest.
 *
 * @param inputs every held copy a refresh reads, exports and the live copy alike
 * @returns each conversation id's versions, in the order the copies were given, and what could not be weighed
 */
export function indexVersions({ inputs }: { inputs: readonly StoredConversationInput[] }): ExportIndex {
  const versions = new Map<string, ConversationVersion[]>();
  const ids = new Set<string>();
  let anonymous = false;
  for (const input of inputs) {
    for (const file of input.files) {
      const read = readJsonArrayElements({
        onElement: ({ text, index }) => {
          const found = versionOf({ label: `chatgpt merge ${basename(file)} element ${String(index)}`, text });
          if ("unreadable" in found) {
            if (found.unreadable.length === 0) {
              anonymous = true;
            }
            found.unreadable.forEach((id) => ids.add(id));
            return true;
          }
          const version = { ...found.version, inputKey: input.key, kind: input.kind, label: input.label };
          const known = versions.get(found.id);
          const sameExport = known?.find((one) => one.inputKey === input.key);
          if (known === undefined) {
            versions.set(found.id, [version]);
          } else if (sameExport === undefined) {
            known.push(version);
          } else if (sameExport.digest !== version.digest) {
            ids.add(found.id);
          }
          return true;
        },
        path: file,
      });
      if (read.isErr()) {
        // What a file held past its break was never seen, so it may be any conversation's latest copy.
        anonymous = true;
      }
    }
  }
  return { unweighed: { anonymous, ids }, versions };
}

/** The gap line for one conversation whose two versions cannot be ordered. */
function unorderedLine({ id, a, b }: { id: string; a: ConversationVersion; b: ConversationVersion }): string {
  // Two exports are the owner's to choose between. A live copy disagreeing with an export at the same instant is a
  // shape the reader does not know, since both are the same conversation read through the same parser.
  const bothExports = a.kind === "export" && b.kind === "export";
  const advice = bothExports ? "move one of those exports aside" : "the reader does not yet know this shape; report it";
  return (
    `chatgpt: conversation ${id} differs between ${a.label} and ${b.label}, and neither carries a later update, ` +
    `so which version is newer cannot be told — ${advice}`
  );
}

/** The export one conversation is written from, or the line saying its versions cannot be ordered. */
function pickVersion({
  id,
  versions,
}: {
  id: string;
  versions: readonly ConversationVersion[];
}): { readonly takeFrom: string } | { readonly gap: string } {
  const first = versions[0]!;
  if (versions.every((one) => one.digest === first.digest)) {
    return { takeFrom: first.inputKey };
  }
  const undated = versions.find((one) => one.activityIso === undefined);
  if (undated !== undefined) {
    return { gap: unorderedLine({ a: undated, b: versions.find((one) => one.digest !== undated.digest)!, id }) };
  }
  const latestIso = versions
    .map((one) => one.activityIso!)
    .toSorted()
    .at(-1)!;
  const latest = versions.filter((one) => one.activityIso === latestIso);
  const rival = latest.find((one) => one.digest !== latest[0]!.digest);
  if (rival !== undefined) {
    return { gap: unorderedLine({ a: latest[0]!, b: rival, id }) };
  }
  return { takeFrom: latest[0]!.inputKey };
}

/** Why one message's copy in the version to be written cannot be written over another held copy — or `undefined`. */
function messageDrift({
  now,
  held,
}: {
  now: { readonly fingerprint: string; readonly tsIso: string } | undefined;
  held: { readonly fingerprint: string; readonly tsIso: string };
}): string | undefined {
  if (now === undefined) {
    return "dropped";
  }
  if (now.fingerprint !== held.fingerprint && now.tsIso < held.tsIso) {
    return "changed";
  }
  if (now.fingerprint === held.fingerprint && now.tsIso !== held.tsIso) {
    return "retimed";
  }
  return undefined;
}

/**
 * The gap line when the version to be written changed a message AND dates it earlier than another held copy does,
 * holds it unchanged at another instant, or does not hold it at all.
 *
 * Only the chosen version is written, so a message another held copy carries and it lacks would never be read.
 * Bronze keeps one message's latest instant and refuses a changed record dated before it (`../corpusWriter.ts`), so
 * that newer text would be dropped while the refresh reported nothing to write — and the older copy is the one
 * bronze already holds whenever an export carrying it was read first. Bronze's dedup fingerprint leaves the instant
 * out, so an unchanged message at a new instant is dropped as already held, keeping the old one. ChatGPT records an
 * edit as a new message, never moves one's time and keeps every branch, so no export has been seen to carry any of
 * these shapes; each is named rather than let through behind a receipt.
 *
 * Not closed: the comparison is across the exports the home HOLDS. An export deleted from the home by hand leaves
 * only bronze's copy of its messages, so a later export backdating a change to one is dropped by bronze's stale rule
 * with no gap. Closing it means comparing against bronze's own latest view per message, which the refresh does not
 * read; it takes both a hand deletion and a shape ChatGPT has never been seen to write.
 */
function backdatedLine({
  id,
  chosen,
  versions,
}: {
  id: string;
  chosen: string;
  versions: readonly ConversationVersion[];
}): string | undefined {
  const written = versions.find((one) => one.inputKey === chosen)!;
  for (const other of versions.filter((one) => one.inputKey !== chosen)) {
    for (const [sourceId, held] of other.messages) {
      const now = written.messages.get(sourceId);
      const drift = messageDrift({ held, now });
      if (drift === "dropped") {
        return (
          `chatgpt: message ${sourceId} is in ${other.label} but not in the latest version ` +
          `of conversation ${id}, ${written.label}, so writing that version alone would leave it unread — ` +
          "the reader does not yet know this shape; report it"
        );
      }
      if (drift === "changed") {
        return (
          `chatgpt: message ${sourceId} changed in ${written.label} and is dated ${now!.tsIso} there, ` +
          `before the ${held.tsIso} ${other.label} gives it, so the corpus would keep the ` +
          `older text of conversation ${id} — the reader does not yet know this shape; report it`
        );
      }
      if (drift === "retimed") {
        return (
          `chatgpt: message ${sourceId} is unchanged in ${written.label} but dated ${now!.tsIso} there, ` +
          `not the ${held.tsIso} ${other.label} gives it, so the corpus would keep the ` +
          `older time in conversation ${id} — the reader does not yet know this shape; report it`
        );
      }
    }
  }
  return undefined;
}

/**
 * Which export each conversation is written from: its latest version, or, among identical ones, the first given.
 * A conversation an unreadable element names is written from no export, and an unreadable element naming none
 * writes no conversation at all. Pure.
 *
 * @param versions each conversation id's versions, as {@link indexVersions} read them
 * @param unweighed what {@link indexVersions} could not read
 * @returns the plan, naming every conversation whose differing versions cannot be ordered
 */
export function planMerge({
  versions,
  unweighed = ALL_WEIGHED,
}: {
  versions: ReadonlyMap<string, readonly ConversationVersion[]>;
  unweighed?: UnweighedElements;
}): MergePlan {
  const takeFrom = new Map<string, string>();
  const unordered = new Set<string>();
  const gaps: string[] = [];
  for (const [id, found] of versions) {
    const picked = pickVersion({ id, versions: found });
    const gap = "gap" in picked ? picked.gap : backdatedLine({ chosen: picked.takeFrom, id, versions: found });
    if (gap !== undefined) {
      unordered.add(id);
      gaps.push(gap);
    } else if ("takeFrom" in picked) {
      takeFrom.set(id, picked.takeFrom);
    }
  }
  const blocked = unweighed.anonymous ? [...versions.keys(), ...unweighed.ids] : [...unweighed.ids];
  for (const id of blocked) {
    takeFrom.delete(id);
    unordered.add(id);
  }
  if (unweighed.anonymous) {
    gaps.push(
      "chatgpt: an export or the live copy holds an element that would not read and names no conversation, or a file that would not " +
        "read whole, so which chat's latest copy it holds cannot be told and no conversation is written this run",
    );
  }
  return { gaps, takeFrom, unordered };
}
