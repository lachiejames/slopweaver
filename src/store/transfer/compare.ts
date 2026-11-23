/**
 * An import's plan: every part of an export compared, key by key, with what the live store holds now, and
 * the questions the owner must answer before anything in it takes effect. Pure.
 *
 * Two rulings shape it. A restored INSTRUCTION — an owner directive or correction, a standing ask — is never
 * active on import, so every one the store does not already hold identically gets an activation question.
 * And a row that disagrees with what the store holds now is never settled by assumption, so every
 * conflicting row, whatever its role, gets a question showing both sides. A new record or measurement is plain
 * data and is asked about only where it disagrees. Where its part is append-only (`isAppendOnlyImportPart`) the
 * live row can never be rewritten, so that question is an ALIGNMENT, answered only by keeping the current row:
 * the import keeps it, reports the difference, and leaves the imported row staged.
 *
 * An import never deletes, so a row the live store holds and the export does not is outside the plan.
 *
 * A standing ask is compared by its cards as well as its id (`./standingCompare.ts`): one that meets a live ask
 * under another id covering one of its cards is a CONFLICT, never an activation, and every live ask it meets is
 * in that one question. `take-imported` there means stopping every one of them; `keep-current` changes nothing.
 *
 * A memory is compared by its import key as well as its recording id, since the register holds both unique: one the
 * store does not hold under its id, whose import key a live memory under another id already holds, CONFLICTS with
 * that memory, so the import keeps it and asks the difference as an alignment rather than planning a write the
 * register would refuse.
 *
 * A plan also names every need a row it writes has that nothing live or written provides (`./closure.ts`), so a
 * recall of a memory an alignment kept out is refused before an apply rather than by the register during one.
 *
 * The plan digest binds every imported row's whole payload as well as its classification, so an apply re-planning
 * from staged rows matches the approved plan only when every field it would write is the one the export held.
 */
import { createHash, type Hash } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";

import { type UnmetDependency, unmetDependencies } from "./closure.js";
import type { StoreTransferError } from "./errors.js";
import { isAppendOnlyImportPart, STORE_EXPORT_PARTS, type StoreExportPartKind } from "./parts.js";
import { type PartRole, partRole, type RetainedEntry } from "./retained.js";
import { classify, indexedSides, type LiveSide, type RowStatus, sortedKeys } from "./rowClassify.js";

/**
 * One part's comparison: unavailable in the export, or counted by what each of its rows is to the store.
 *
 * @internal reached as {@link ImportPlan.parts}, never named outside this file
 */
export type PartPlan =
  | { readonly kind: StoreExportPartKind; readonly status: "unavailable" }
  | {
      readonly kind: StoreExportPartKind;
      readonly status: "compared";
      readonly role: PartRole;
      /** Rows the live store does not hold under that key; for a standing ask, one meeting no live ask at all. */
      readonly new: number;
      /** Rows the live store already holds with the same logical content. */
      readonly identical: number;
      /**
       * Rows the live store holds under the same key with different content; for a standing ask, also one sharing
       * a card with a live ask under another id.
       */
      readonly conflicting: number;
    };

/** An answer an import question takes. */
export type ImportAction = "activate" | "leave-inactive" | "keep-current" | "take-imported";

/** What the owner must decide about one row before an import may take it. */
export interface ImportQuestion {
  /**
   * Stable across runs over the same export and the same live row, and distinct across two exports even when
   * their rows conflict alike: `import-q-` and 16 hex.
   */
  readonly id: string;
  /**
   * `activation` for an instruction the store does not hold, `conflict` for a row the store holds differently,
   * `alignment` for one an append-only part holds differently, whose live row stands whatever the answer.
   */
  readonly kind: "activation" | "conflict" | "alignment";
  readonly part: StoreExportPartKind;
  readonly key: string;
  /** The imported row, one line. */
  readonly imported: string;
  /**
   * What it disagrees with in the live store, one line, or `null` for an instruction the store does not hold. For
   * a standing ask that is every live ask it meets, in id order, each naming why, joined by `; `.
   */
  readonly live: string | null;
  /** The answers the question takes. */
  readonly actions: readonly ImportAction[];
}

/**
 * Which comparison rules this build plans by. A rule change that can move a row from one status to another, or
 * change which questions a part raises, bumps it: a batch staged under another version answered questions this
 * build would not ask, so it is never applied or re-staged as if it were current. It is in every question id and
 * the plan digest, and a staged batch records it. Version 2 compares a standing ask by its cards as well as its id;
 * version 3 keys a steer measurement by its event id and compares its exact line and source ordinal, every line one
 * row, where version 2 kept only the folded readings still standing, keyed by turn and kind. Version 4 asks an
 * append-only part's differing row as an alignment, which takes only `keep-current`, where version 3 asked it as a
 * conflict an apply could not honour. Version 5 meets a memory by its import key as well as its id, and binds each
 * imported row's payload digest into the plan digest.
 */
export const STORE_IMPORT_COMPARISON_VERSION = 5;

/** The whole plan, and the digest a later apply binds its answers to. */
export interface ImportPlan {
  /** {@link STORE_IMPORT_COMPARISON_VERSION} as this plan was made. */
  readonly comparisonVersion: number;
  readonly parts: readonly PartPlan[];
  readonly questions: readonly ImportQuestion[];
  /**
   * Every need a row it writes has that nothing live or written provides (`./closure.ts`) — a recall of a memory an
   * alignment kept out, above all. Empty for an import whose writes all close; an apply refuses one that is not.
   */
  readonly unmet: readonly UnmetDependency[];
  /**
   * `sha256:` over the comparison version, the export's content digest, every row's classification and payload
   * digest in key order, and the questions.
   */
  readonly digest: string;
}

const ACTIVATION_ACTIONS: readonly ImportAction[] = ["activate", "leave-inactive"];
const CONFLICT_ACTIONS: readonly ImportAction[] = ["keep-current", "take-imported"];
const ALIGNMENT_ACTIONS: readonly ImportAction[] = ["keep-current"];

/**
 * The answers a question of one kind takes. The kind decides them, so a stored question needs no copy.
 *
 * @returns the actions, in the order a question lists them
 */
export function actionsForImportQuestion({ kind }: { kind: ImportQuestion["kind"] }): readonly ImportAction[] {
  switch (kind) {
    case "activation": {
      return ACTIVATION_ACTIONS;
    }
    case "conflict": {
      return CONFLICT_ACTIONS;
    }
    case "alignment": {
      return ALIGNMENT_ACTIONS;
    }
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/**
 * A question's stable id: the same export row against the same live row is the same question. The export's
 * content digest is in it, so two exports that conflict alike over one row never share a staged question.
 */
function questionId({
  contentDigest,
  kind,
  part,
  key,
  imported,
  live,
}: {
  contentDigest: string;
  kind: ImportQuestion["kind"];
  part: StoreExportPartKind;
  key: string;
  imported: string;
  live: unknown;
}): string {
  const canonical = stableStringify({
    value: { comparison: STORE_IMPORT_COMPARISON_VERSION, contentDigest, imported, key, kind, live, part, v: 2 },
  });
  return `import-q-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

/** One canonical record fed to the plan digest, newline-terminated. */
function feed({ digest, value }: { digest: Hash; value: unknown }): void {
  digest.update(`${stableStringify({ value })}\n`);
}

/** The `sha256:` a fingerprint opens with, which a tag leaves out. */
const TAG_PREFIX = "sha256:".length;
/** The fewest hex characters a content tag shows. */
const TAG_HEX = 12;

/**
 * The two lines a conflict question shows. A summary is cut to one line, some parts summarise a row by its key
 * alone, and two different strings can look the same, so two sides of a disagreement can read alike. Each line
 * therefore carries its content fingerprint, at least {@link TAG_HEX} hex and longer where the two share that
 * prefix: a conflicting row's fingerprints differ, so the two tags always do. A standing ask can meet several
 * live asks, each tagged the same way, in the order given, on the one live line.
 */
function conflictLines({ row, live }: { row: RetainedEntry; live: readonly RetainedEntry[] }): {
  readonly imported: string;
  readonly current: string;
} {
  let end = TAG_PREFIX + TAG_HEX;
  for (const there of live) {
    let shared = 0;
    while (shared < row.fingerprint.length && row.fingerprint[shared] === there.fingerprint[shared]) {
      shared += 1;
    }
    end = Math.max(end, shared + 1);
  }
  const tag = ({ entry }: { entry: RetainedEntry }) =>
    `${entry.summary} [content ${entry.fingerprint.slice(TAG_PREFIX, end)}]`;
  return { current: live.map((entry) => tag({ entry })).join("; "), imported: tag({ entry: row }) };
}

/**
 * The question one row raises, or `null` for a row that needs no decision. It branches on the status the
 * caller already computed, so a row is compared exactly once.
 */
function questionFor({
  contentDigest,
  part,
  key,
  row,
  liveSide,
  role,
  status,
}: {
  contentDigest: string;
  part: StoreExportPartKind;
  key: string;
  row: RetainedEntry;
  /** The live side a conflict shows and binds; set whenever the status is `conflicting`. */
  liveSide: LiveSide | undefined;
  role: PartRole;
  status: RowStatus;
}): ImportQuestion | null {
  if (status === "identical") {
    return null;
  }
  if (status === "conflicting") {
    const side = liveSide!;
    const kind = isAppendOnlyImportPart({ part }) ? "alignment" : "conflict";
    const id = questionId({ contentDigest, imported: row.fingerprint, key, kind, live: side.identity, part });
    const lines = conflictLines({ live: side.shown, row });
    return {
      actions: actionsForImportQuestion({ kind }),
      id,
      imported: lines.imported,
      key,
      kind,
      live: lines.current,
      part,
    };
  }
  if (role !== "instruction") {
    return null;
  }
  const id = questionId({ contentDigest, imported: row.fingerprint, key, kind: "activation", live: null, part });
  return {
    actions: actionsForImportQuestion({ kind: "activation" }),
    id,
    imported: row.summary,
    key,
    kind: "activation",
    live: null,
    part,
  };
}

/** One part as compared: its plan, its questions, and the rows it writes whatever the answers. */
interface ComparedPart {
  readonly plan: PartPlan;
  readonly questions: readonly ImportQuestion[];
  /** Every row new to the store, which an apply writes whatever the answers. */
  readonly written: readonly RetainedEntry[];
}

/** One part the export holds, compared key by key, every row's classification fed to the digest. */
function comparePart({
  contentDigest,
  part,
  fromExport,
  fromLive,
  digest,
}: {
  contentDigest: string;
  part: StoreExportPartKind;
  fromExport: readonly RetainedEntry[];
  fromLive: readonly RetainedEntry[];
  digest: Hash;
}): Result<ComparedPart, StoreTransferError> {
  const sides = indexedSides({ fromExport, fromLive, part });
  if (sides.isErr()) {
    return err(sides.error);
  }
  const { current, exported, importKeys } = sides.value;
  const role = partRole({ kind: part });
  const counts = { conflicting: 0, identical: 0, new: 0 };
  const questions: ImportQuestion[] = [];
  const written: RetainedEntry[] = [];
  for (const key of sortedKeys({ keyed: exported })) {
    const row = exported.get(key)!;
    const { status, liveSide } = classify({ current, importKeys, part, row });
    counts[status] += 1;
    if (status === "new") {
      written.push(row);
    }
    const payload = row.payloadDigest === undefined ? {} : { payload: row.payloadDigest };
    feed({ digest, value: { fingerprint: row.fingerprint, key, part, status, ...payload } });
    const question = questionFor({ contentDigest, key, liveSide, part, role, row, status });
    if (question !== null) {
      questions.push(question);
    }
  }
  return ok({ plan: { kind: part, role, status: "compared", ...counts }, questions, written });
}

/**
 * Compare an export with the live store.
 *
 * @param imported each part the export held, as entries; a part it did not hold is absent
 * @param live each part of the live store, as entries
 * @param contentDigest the export's own content digest, which the plan digest binds
 * @returns the plan, or the first part either side holds a key in twice
 */
export function planImport({
  imported,
  live,
  contentDigest,
}: {
  imported: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
  live: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
  contentDigest: string;
}): Result<ImportPlan, StoreTransferError> {
  const digest = createHash("sha256");
  feed({ digest, value: { comparison: STORE_IMPORT_COMPARISON_VERSION, contentDigest, v: 1 } });
  const parts: PartPlan[] = [];
  const questions: ImportQuestion[] = [];
  const written: (readonly [StoreExportPartKind, readonly RetainedEntry[]])[] = [];
  for (const spec of STORE_EXPORT_PARTS) {
    const fromExport = imported.get(spec.kind);
    if (fromExport === undefined) {
      parts.push({ kind: spec.kind, status: "unavailable" });
      feed({ digest, value: { part: spec.kind, status: "unavailable" } });
      continue;
    }
    const compared = comparePart({
      contentDigest,
      digest,
      fromExport,
      fromLive: live.get(spec.kind)!,
      part: spec.kind,
    });
    if (compared.isErr()) {
      return err(compared.error);
    }
    parts.push(compared.value.plan);
    questions.push(...compared.value.questions);
    written.push([spec.kind, compared.value.written]);
  }
  for (const question of questions) {
    feed({ digest, value: { question: question.id } });
  }
  return ok({
    comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
    digest: `sha256:${digest.digest("hex")}`,
    parts,
    questions,
    unmet: unmetDependencies({ live: [...live.entries()], written }),
  });
}
