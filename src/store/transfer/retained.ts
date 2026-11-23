/**
 * What an import keeps of each row it reads: the row's LOGICAL identity, a fingerprint of its logical content,
 * a one-line summary a question can show, and the decoded row as JSON, which staging stores. Comparing reads
 * only the first three, so what two stores must agree on is the fingerprint, never the payload's spelling.
 *
 * Both sides of a comparison are built here, by the same functions: an export's rows as they stream off disk,
 * and the live store's rows serialised the way an export of it would hold them. So two rows are identical
 * exactly when their fingerprints are, and what counts as "the same row" is decided once, per part, by the
 * columns its own domain already compares. Pure.
 */
import { createHash } from "node:crypto";

import { stableStringify } from "#lib/stableStringify.js";

import type { OwnerDirectiveOverlay } from "../../judgement/ownerDirective.js";
import type { RecallRecord } from "../../knowledge/recallRestore.js";
import type { RestoredRecording } from "../../knowledge/restore.js";
import { MEMORY_COMPARED, RECALL_COMPARED } from "../../knowledge/restoreMerge.js";
import type { StandingAsk } from "../../profile/standingAsks.js";
import { type DecodedSteerMeasurement, steerMeasurementSummary } from "../../profile/steerMeasurementTransfer.js";
import type { VoiceCohort } from "../profile/types.js";

import { anotherClaimThan, claimOfKind, type Dependency, recordingOfClaim } from "./closure.js";
import type { PortableOwnerProfile } from "./decode.js";
import type { StoreExportPartKind } from "./parts.js";

/** One logical row as an import keeps it. */
export interface RetainedEntry {
  /** The row's identity inside its part: the key two stores agree the row by. */
  readonly key: string;
  /** `sha256:` over the row's logical content, canonically serialised. */
  readonly fingerprint: string;
  /** One line a person reads, at most {@link SUMMARY_LIMIT} characters. */
  readonly summary: string;
  /**
   * A standing ask's cards, which its comparison reads to find a live ask under another id covering one of them
   * (`./standingCompare.ts`). Comparison metadata only: it is already inside the fingerprinted content, and no
   * other part sets it.
   */
  readonly covers?: readonly string[];
  /**
   * A memory's import key, which the knowledge register holds unique beside its recording id, so its comparison
   * finds a live memory under another id holding the same one. Comparison metadata only: it is already inside the
   * fingerprinted content, and no other part sets it.
   */
  readonly importKey?: string;
  /**
   * `sha256:` over the whole decoded row, every field its fingerprint leaves out included (a memory's `seq`, which a
   * merge renumbers but orders its writes by). The plan digest binds the imported side's, so an apply writes exactly
   * the rows the approved plan was made of. Never compared with the live side; set by every builder of a staged row.
   */
  readonly payloadDigest?: string;
  /**
   * What a written row makes true that another row may need: a memory provides its recording of its claim, and its
   * claim under its kind (`./closure.ts`). Comparison metadata only.
   */
  readonly provides?: readonly Dependency[];
  /** What a written row needs some other live or written row to provide: a recall its recording, a memory its supersedes. */
  readonly requires?: readonly Dependency[];
}

/** The comparison metadata fields an entry may carry beside its key, fingerprint and summary. */
type ComparisonMetadata = Pick<RetainedEntry, "covers" | "importKey" | "payloadDigest" | "provides" | "requires">;

/**
 * An entry's comparison metadata — the fields beside its key, fingerprint and summary — with an unset one left out,
 * so a copy of an entry carries exactly what the entry did.
 *
 * @returns the set fields among `covers`, `importKey`, `payloadDigest`, `provides` and `requires`
 */
export function comparisonMetadata({ entry }: { entry: RetainedEntry }): ComparisonMetadata {
  const { covers, importKey, payloadDigest, provides, requires } = entry;
  return {
    ...(covers === undefined ? {} : { covers: [...covers] }),
    ...(importKey === undefined ? {} : { importKey }),
    ...(payloadDigest === undefined ? {} : { payloadDigest }),
    ...(provides === undefined ? {} : { provides: [...provides] }),
    ...(requires === undefined ? {} : { requires: [...requires] }),
  };
}

/** A value JSON text can hold, which is what a staged row is stored as. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * An entry an export's part decoded to, carrying the whole decoded row beside its fingerprint, so staging an
 * import keeps the row itself and never needs the export directory again.
 */
export interface StagedEntry extends RetainedEntry {
  /** The complete decoded row, as JSON: an instant is its ISO text, and nothing the decoder kept is dropped. */
  readonly payload: JsonValue;
}

/**
 * What a part's rows ARE to the installation, which decides what an import must ask about them.
 *
 * - `instruction` steers the fleet the moment it is live (an owner directive or correction, an active standing
 *   ask), so a restored one is never active until the owner says so.
 * - `record` is knowledge or a description (a memory, a recall, the owner profile, a voice cohort): restored as
 *   data, asked about only where it disagrees with what the store holds now.
 * - `measurement` is history the fleet read off the owner's own turns (a steer measurement): restored as history, asked
 *   about only where the store holds the same measurement over a different line.
 */
export type PartRole = "instruction" | "record" | "measurement";

/** The longest summary kept, so a question stays one line however long the row is. */
const SUMMARY_LIMIT = 100;

/**
 * Which role a part's rows play.
 *
 * @param kind the part
 * @returns its role
 */
export function partRole({ kind }: { kind: StoreExportPartKind }): PartRole {
  switch (kind) {
    case "owner-directives":
    case "standing-asks":
      return "instruction";
    case "steer-verdicts":
      return "measurement";
    case "memories":
    case "memory-recalls":
    case "owner-profile":
    case "owner-voice":
      return "record";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/**
 * One line, whitespace collapsed, every other control or format character shown as `�`, cut to the summary
 * limit. An export is input from a file, so a summary never carries a sequence a terminal would act on.
 */
function oneLine({ text }: { text: string }): string {
  const flat = text
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/[\p{Cc}\p{Cf}]/gu, "�")
    .trim();
  return flat.length <= SUMMARY_LIMIT ? flat : `${flat.slice(0, SUMMARY_LIMIT - 1)}…`;
}

/**
 * An entry for one row: its key, the fingerprint of the content given, and its summary.
 *
 * @param key the row's identity inside its part
 * @param content exactly the logical content two stores must agree on, and nothing local to one store. It is
 *   a row a part decoder parsed from JSON text — the export's lines and the live store's alike — so it holds
 *   JSON values only; `stableStringify` writes a stray `undefined` as `null`, which JSON text never carries

 * @param summary what a person is shown, cut to one line
 * @returns the entry
 */
export function retainedEntry({
  key,
  content,
  summary,
}: {
  key: string;
  content: unknown;
  summary: string;
}): RetainedEntry {
  const fingerprint = `sha256:${createHash("sha256")
    .update(stableStringify({ value: content }))
    .digest("hex")}`;
  return { fingerprint, key, summary: oneLine({ text: summary }) };
}

/**
 * A retained entry carrying its whole decoded row. One row's JSON is bounded by its own domain, so the round
 * trip through one string is per row, never per part.
 *
 * @param row the decoded domain value, staged as its JSON form
 * @returns the entry with its payload
 */
function stagedEntry({
  key,
  content,
  summary,
  row,
}: {
  key: string;
  content: unknown;
  summary: string;
  row: unknown;
}): StagedEntry {
  // JSON.parse returns `any`; the value it produced from JSON text is a JsonValue by construction.
  const payload: JsonValue = JSON.parse(JSON.stringify(row));
  const payloadDigest = `sha256:${createHash("sha256")
    .update(stableStringify({ value: payload }))
    .digest("hex")}`;
  return { ...retainedEntry({ content, key, summary }), payload, payloadDigest };
}

/** What a recording's `supersedes` needs: that claim under its own kind, or — superseding itself — what nothing provides. */
function supersedesNeed({ recording }: { recording: RestoredRecording }): { requires?: readonly Dependency[] } {
  if (recording.supersedes === null) {
    return {};
  }
  if (recording.supersedes === recording.id) {
    return { requires: [anotherClaimThan({ claimId: recording.id })] };
  }
  return { requires: [claimOfKind({ claimId: recording.supersedes, kind: recording.kind })] };
}

/**
 * A knowledge-register row: keyed by `recordingId`, compared on every column a merge compares, its two
 * instants by the instant rather than the text, and never on `seq`, which a merge renumbers. It provides its recording
 * and its claim under its kind, and needs what its `supersedes` names (`./closure.ts`).
 *
 * An instant is compared at MILLISECOND precision on purpose: both columns are `timestamp(precision: 3)`
 * (`src/store/schema/memories.ts`, `memoryRecalls.ts`), so two exported instants that differ below a
 * millisecond land as the same stored row, and `knowledge restore --merge` compares them by `getTime()` too.
 *
 * @returns the entry
 */
export function memoryEntry({ recording }: { recording: RestoredRecording }): StagedEntry {
  const columns = Object.fromEntries(MEMORY_COMPARED.map((column) => [column, recording[column]]));
  const content = {
    ...columns,
    createdAtMs: recording.createdAt.getTime(),
    recordedAtMs: recording.recordedAt.getTime(),
  };
  const summary = `${recording.kind}: ${recording.claim}`;
  const entry: StagedEntry = {
    ...stagedEntry({ content, key: recording.recordingId, row: recording, summary }),
    provides: [
      recordingOfClaim({ claimId: recording.id, recordingId: recording.recordingId }),
      claimOfKind({ claimId: recording.id, kind: recording.kind }),
    ],
    ...supersedesNeed({ recording }),
  };
  return recording.importKey === null ? entry : { ...entry, importKey: recording.importKey };
}

/**
 * A recall-ledger row, keyed by `recallId` and compared the way a merge compares recalls.
 *
 * @returns the entry
 */
export function recallEntry({ recall }: { recall: RecallRecord }): StagedEntry {
  const columns = Object.fromEntries(RECALL_COMPARED.map((column) => [column, recall[column]]));
  const content = { ...columns, createdAtMs: recall.createdAt.getTime(), recordedAtMs: recall.recordedAt.getTime() };
  const summary = `${recall.outcome} recall of ${recall.memoryId}`;
  return {
    ...stagedEntry({ content, key: recall.recallId, row: recall, summary }),
    requires: [recordingOfClaim({ claimId: recall.memoryId, recordingId: recall.recordingId })],
  };
}

/**
 * The owner row, the part's one key. Its portable half is already all of its logical content.
 *
 * @returns the entry
 */
export function ownerEntry({ owner }: { owner: PortableOwnerProfile }): StagedEntry {
  return stagedEntry({ content: owner, key: "owner", row: owner, summary: `owner profile for ${owner.displayName}` });
}

/**
 * One voice cohort, keyed by surface and cohort, the pair the register upserts on.
 *
 * @returns the entry
 */
export function voiceEntry({ cohort }: { cohort: VoiceCohort }): StagedEntry {
  const key = `${cohort.surface}/${cohort.cohort}`;
  return stagedEntry({ content: cohort, key, row: cohort, summary: `voice register ${key}` });
}

/**
 * The directive overlay as entries: directives and corrections in their own key spaces, since the two merges
 * keep separate id spaces.
 *
 * @returns one entry per directive, then one per correction
 */
export function directiveEntries({ overlay }: { overlay: OwnerDirectiveOverlay }): readonly StagedEntry[] {
  return [
    ...overlay.directives.map((directive) =>
      stagedEntry({ content: directive, key: `directive:${directive.id}`, row: directive, summary: directive.text }),
    ),
    ...overlay.corrections.map((correction) =>
      stagedEntry({
        content: correction,
        key: `correction:${correction.id}`,
        row: correction,
        summary: correction.text,
      }),
    ),
  ];
}

/**
 * The standing asks the journal leaves active, one entry per ask rather than per journal event: activating
 * one is a single decision however many lines recorded it. Each carries its cards, so the comparison can find
 * a live ask under another id covering one of them.
 *
 * @returns one entry per active ask
 */
export function standingAskEntries({ asks }: { asks: readonly StandingAsk[] }): readonly StagedEntry[] {
  return asks.map((ask) => ({
    ...stagedEntry({
      content: ask,
      key: ask.id,
      row: ask,
      summary: `standing ask ${ask.id}, covers ${ask.covers.join(", ")}`,
    }),
    covers: ask.covers,
  }));
}

/**
 * One steer measurement, keyed by its event id: every measurement is its own row, a read that named nothing, a
 * withdrawal and a line that does not parse alike. Compared on the exact line and its source ordinal, the two
 * things a store cannot re-derive; the parse status follows from the line. Its part line never enters the payload.
 *
 * @returns the entry
 */
export function steerMeasurementEntry({ measurement }: { measurement: DecodedSteerMeasurement }): StagedEntry {
  const { envelope } = measurement;
  return stagedEntry({
    content: { exactText: envelope.exactText, sourceOrdinal: envelope.sourceOrdinal },
    key: envelope.eventId,
    row: envelope,
    summary: steerMeasurementSummary({ measurement }),
  });
}
