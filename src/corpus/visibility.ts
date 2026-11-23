/**
 * The per-record visibility axis (PR4.5) — the leak-safety choke-point. This module is the SINGLE
 * producer of a `private` stamp: `stampVisibility` is the only function anywhere that returns a record
 * carrying `visibility: "private"`. Every private-lane record (Slack private channels / DMs / mpim) is
 * routed through it at projection time, where the private signal is known — so nothing reaches disk
 * unstamped. `visibilityForRecord` is the mirror reader: it defaults an absent/unknown mark to `public`,
 * which is the migration contract (a record written before this field reads back as public).
 *
 * Pure, no I/O. A public stamp is a pass-through (the field stays absent), so a public record serialises
 * byte-identically to pre-PR4.5 bronze and never churns the dedup fingerprint.
 */
import { ALWAYS_PRIVATE_SOURCES } from "../integrations/corpusSources.js";
import type { CorpusKind, CorpusRecord, CorpusSource, CorpusVisibility } from "./types.js";

/**
 * Sources whose EVERY record is private by construction, independent of any stamp.
 *
 * `self` is the owner's own written thinking scanned off the owner's filesystem — org names, teammate names, internal
 * project names, PII, in prose never written for an audience. There is no public lane within it to decide
 * between, so the mark is a property of the source rather than of the record, and both functions below read it.
 *
 * `gmail` is here for a stronger reason than `self`, and it is the reason a mailbox is different in kind from
 * the four org-shared sources. Slack, GitHub, Linear and Notion are surfaces a colleague is already inside,
 * so a private lane within them is about which colleague. A mailbox has counterparties who never joined this
 * workspace at all — a 1:1 thread's other half did not consent to being ingested and cannot be asked — so
 * there is no lane within mail that a non-owner may read, and the source-level mark says so rather than
 * leaving it to every projection path to remember.
 *
 * `calendar` is here on exactly the mailbox's argument. Every attendee on every event is a counterparty who
 * never joined this workspace, a 1:1 in the diary is as private as a 1:1 in the inbox, and an event the
 * owner marked `private` in Google carries no title precisely because it was not meant to be read. There is
 * no lane within a diary a non-owner may read.
 *
 * `fathom` is the sharpest case of the same argument, and it is why the set is a SOURCE-level mark rather
 * than a per-lane one. A recorded call's other voices are a customer's, a vendor's or a partner's, captured
 * because they agreed to talk to the owner — not to be indexed. There is no lane within a meeting recorder
 * a non-owner may read.
 *
 * That redundancy is the point. The default is PUBLIC, and an unmarked record reads back public, so any single
 * projection path that forgot to stamp would leak the whole corpus into a non-owner lane with nothing to show
 * that it had happened. Deriving the mark from the source as well as the field means the leak needs two
 * independent failures rather than one omission.
 *
 * `chatgpt` is the owner talking to an assistant in words written for nobody — the most personal text this
 * corpus can hold. There is no lane within it a non-owner may read.
 *
 * Each integration declares this as `alwaysPrivate` on its manifest's corpus row, and `self` on its local row, so the
 * set is derived ({@link ALWAYS_PRIVATE_SOURCES}) and a new private source is its manifest.
 */
const ALWAYS_PRIVATE_SOURCE_SET: ReadonlySet<CorpusSource> = new Set(ALWAYS_PRIVATE_SOURCES);

/**
 * KINDS whose every record is private by construction, whatever lane they were found in.
 *
 * The same argument as {@link ALWAYS_PRIVATE_SOURCE_SET}, one axis down. `gmail` is private because the SOURCE
 * has no public lane; `huddle` and `transcript` are private because the RECORD is one — a huddle is a recorded conversation
 * between named people, and its counterparties agreed to talk to each other rather than to publish. Slack as
 * a source plainly does have a public lane, so the mark cannot come from the source, and it must not come
 * from the containing channel either: the huddle canvas for a 1:1 call is discovered through a
 * workspace-wide `files.list` and shared into DMs, so a lane-derived stamp would be deciding a call's
 * privacy from where its notes file happened to be filed. `transcript` is the same shape one source over: a
 * meeting transcript arrives through `gmail`, which is already always-private, and the kind is marked
 * anyway so the same record projected from any future source cannot arrive public.
 *
 * Same redundancy as the source set, for the same reason: the default is PUBLIC, so a projection path that
 * forgot to stamp would leak. Deriving the mark from the kind as well as the field means the leak needs two
 * independent failures rather than one omission.
 */
const ALWAYS_PRIVATE_KINDS: ReadonlySet<CorpusKind> = new Set(["huddle", "transcript"]);

/**
 * Whether every record of this kind is private regardless of what it carries.
 *
 * @param kind the record's unit type
 * @returns true when the kind has no public lane at all
 *
 * @internal — the mirror of `isAlwaysPrivateSource`; both readers below are the callers.
 */
export function isAlwaysPrivateKind({ kind }: { kind: CorpusKind }): boolean {
  return ALWAYS_PRIVATE_KINDS.has(kind);
}

/**
 * Whether every record from this source is private regardless of what it carries.
 *
 * @param source the record's origin system
 * @returns true when the source has no public lane at all
 */
export function isAlwaysPrivateSource({ source }: { source: CorpusSource }): boolean {
  return ALWAYS_PRIVATE_SOURCE_SET.has(source);
}

/**
 * Stamp a record's read scope — the ONLY producer of a `private` mark. A `private` visibility sets the
 * field; a `public` visibility returns the record unchanged (the field stays absent, i.e. the default),
 * so public records stay byte-identical to legacy bronze.
 *
 * A record from an {@link isAlwaysPrivateSource} source, or of an {@link isAlwaysPrivateKind} kind, is
 * stamped private whatever the caller asked for — the choke-point refuses to produce a public `self` or
 * `huddle` record rather than trusting every call site.
 *
 * @param record the projected record
 * @param visibility the lane it was projected from (`private` for Slack private channels / DMs / mpim)
 * @returns the record with a `private` stamp when private, else the record unchanged
 */
export function stampVisibility({
  record,
  visibility,
}: {
  record: CorpusRecord;
  visibility: CorpusVisibility;
}): CorpusRecord {
  return visibility === "private" ||
    isAlwaysPrivateSource({ source: record.source }) ||
    isAlwaysPrivateKind({ kind: record.kind })
    ? { ...record, visibility: "private" }
    : record;
}

/**
 * A record's effective read scope. Only an explicit `"private"` is restrictive; an absent or unrecognised
 * mark reads as `public` (the default-public migration contract), so a legacy record is never fail-closed —
 * EXCEPT for an {@link isAlwaysPrivateSource} source or an {@link isAlwaysPrivateKind} kind, either of which
 * reads private with or without the field.
 *
 * @param record the record to classify
 * @returns `"private"` iff the record is explicitly private, comes from an always-private source, or is of
 *   an always-private kind
 */
export function visibilityForRecord({ record }: { record: CorpusRecord }): CorpusVisibility {
  return record.visibility === "private" ||
    isAlwaysPrivateSource({ source: record.source }) ||
    isAlwaysPrivateKind({ kind: record.kind })
    ? "private"
    : "public";
}
