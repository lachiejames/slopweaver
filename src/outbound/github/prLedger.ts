/**
 * The record of which pull requests slopweaver opened — the at-most-once primitive for CREATE, and a cache of
 * the form each was last rendered from.
 *
 * ## It used to be the ownership authority too, and that was the defect
 *
 * `update` would only touch a pull request this file had a usable record for. The reasoning was sound as far as
 * it went: under a personal token GitHub attributes every write to the operator, so `user.login` is the human
 * whether slopweaver opened the pull request or they clicked the button themselves; `author_association`
 * describes a repository relationship rather than process provenance; `performed_via_github_app` would settle
 * it but this product deliberately resolves no app identity; and a marker in the body would be forgeable.
 *
 * All true, and all answering the wrong question. **"Did slopweaver open this?" is unanswerable. "Is this pull
 * request authored by the account I am authed as?" is one API call.** That is the check that protects
 * something, it needs no local state, and it is what `../../cli/commands/github/updateCore.ts` now does.
 *
 * The cost of the old posture was measured rather than argued: of the 19 records in one real ledger, 10 no
 * longer decoded — every one gold, all failing on the `proof.commit` field a later change made required — so
 * the gate refused more than half the pull requests slopweaver ITSELF opened. And because a gold anchor is
 * invalidated by every subsequent push, those were precisely the descriptions that needed rewriting most.
 *
 * What this file keeps is the part that genuinely needs local state:
 *
 *  - **At-most-once on create.** Unlike Linear there is no caller-chosen id to reserve beforehand, so a
 *    create whose response is lost cannot be addressed by an id GitHub already agreed to. The `wx`
 *    reservation is that guard, and the branch-pair listing below is how it is later settled.
 *  - **The stored form, as a CACHE.** A fast path for a surgical edit, never a licence. A cache hit requires
 *    the digest AND that the stored form still re-renders the live body byte for byte; on a miss the live
 *    description is parsed instead. See `./recovery.ts`.
 *
 * ## Why the key is the branch locus and not a content hash
 *
 * Linear can reserve the remote id before the write, because `IssueCreateInput.id` accepts a caller-supplied
 * UUID. GitHub has no equivalent: the number and node id exist only after creation. So the strongest
 * available key is the INTENT — base repository, base ref and head ref, together the *branch locus*.
 *
 * A content-derived key was considered and rejected: a retried create whose form changed even slightly
 * would hash differently, so the guard would not recognise it as the same intent and would happily open a
 * second pull request for the same branch. The locus is stable across exactly the edits a retry makes.
 *
 * The consequence is honest rather than hidden: after a lost response this lane LISTS candidates by head and
 * base rather than addressing a pre-chosen remote id the way Linear can, and what that listing settles is the
 * RESERVATION, not permission to send blind. Exactly one candidate recovers the number onto the record
 * (`backfillPrIdentity` below, or `confirmPr` where the form is in hand). Zero means no pull request occupies
 * the pair, so the reservation guards nothing and is released. SEVERAL stays `indeterminate` — there is no way
 * to say which of them the reservation meant, and a guess is what opens a duplicate.
 *
 * **The residue of releasing on zero, stated rather than left to be discovered.** It assumes `pulls.list` is
 * not lagging a create GitHub did commit. If it ever lags, the outcome is a second pull request on the pair,
 * which GitHub permits and a human closes in one click. The measured alternative is what makes that the better
 * side: a numberless reservation left standing blocks its locus permanently, and was recovered three times by
 * hand-deleting a record under `$SLOPWEAVER_HOME/ledgers/github-prs` — five times in one session, when a create failed on six consecutive attempts. The check is not infallible; it is better than a
 * ledger an operator edits with `rm`.
 *
 * ## Why the body digest is the conflict signal
 *
 * The record stores the body as GitHub STORES it, digested. That is what makes a surgical update safe: if
 * the live body still digests to what we last wrote, nobody has touched it and re-rendering from the stored
 * form cannot destroy anyone's work. If it differs, a human edited the description on github.com, and
 * overwriting it is precisely the data loss this whole feature exists to stop.
 *
 * The digest is taken over the STORED body rather than the sent one deliberately. Linear was measured
 * normalising markdown on ingest, which made a naive sent-versus-stored comparison refuse every first
 * update as a phantom conflict. Digesting what came back sidesteps that whether or not GitHub normalises.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";
import { lfLineEndings } from "./lineEndings.js";
import { storedPrFormSchema } from "./schema.js";
import type { PrForm, PrTarget } from "./types.js";

/** One pull request slopweaver reserved, and what became of it. */
export interface PrRecord {
  /** The branch locus this record is keyed by. */
  readonly locus: string;
  /** When the locus was reserved, before the create was attempted. */
  readonly reservedIso: string;
  /** GitHub's pull-request number, present ONLY once the create was confirmed on the wire. */
  readonly number?: number | undefined;
  /** GitHub's node id, present only once confirmed. */
  readonly nodeId?: string | undefined;
  /** When the create was confirmed. Absent ⇒ the outcome is UNKNOWN, not that it failed. */
  readonly confirmedIso?: string | undefined;
  /** The stamped form as last rendered and written. The surgical update merges into this. */
  readonly form?: PrForm | undefined;
  /** A digest of the body as GitHub stored it at the last write. The conflict signal. */
  readonly bodyHash?: string | undefined;
}

/**
 * The branch locus for a target — the duplicate-guard key, and the record's filename.
 *
 * Lower-cased because GitHub owner and repository names are case-insensitive, so `O/R` and `o/r` are the
 * same repository and must not reserve twice. Refs are NOT lower-cased: git refs are case-sensitive and
 * `Feature` and `feature` are genuinely different branches.
 *
 * @param target the pull request's routing fields
 * @returns a stable key
 */
export function locusOf({ target }: { target: PrTarget }): string {
  const repo = `${target.owner.toLowerCase()}/${target.repo.toLowerCase()}`;
  return `${repo}#${target.base}...${target.head}`;
}

/**
 * A filesystem-safe name for a locus.
 *
 * A locus carries `/`, `#` and `.` — all meaningful in a path — so the record is named by a digest of it
 * rather than by the locus itself. The locus is stored INSIDE the record, so nothing is lost and a human
 * reading the directory can still find which is which.
 *
 * @param locus the branch locus
 * @returns a hex filename stem
 */
export function locusFilename({ locus }: { locus: string }): string {
  return createHash("sha256").update(locus, "utf8").digest("hex").slice(0, 32);
}

/**
 * The digest of a stored pull-request body.
 *
 * An ABSENT body and an EMPTY one are different states and must not hash alike: the first means GitHub
 * returned nothing (a failed or partial read), the second means the pull request genuinely has no
 * description. Collapsing them would let a failed read compare equal to a description someone emptied.
 *
 * The digest is of the CONTENT, CRLF read as LF (`./lineEndings.ts`), because a `--pull` file's digest is compared
 * against the live body's at `--file` time. GitHub's web editor re-saving the same description with CRLF is not a
 * change, and since `github pr update` sends nothing over an unchanged re-send, nothing rewrites that body back to
 * LF: a byte digest would refuse the pulled file as stale over line endings alone.
 *
 * @param body the body as GitHub stores it, or undefined when the read yielded none
 * @returns a stable hex digest
 */
export function bodyHash({ body }: { body: string | undefined }): string {
  const material = body === undefined ? "\u0000absent" : `present:${lfLineEndings({ text: body })}`;
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
}

/** Whether this caller now holds the reservation for a locus. */
export type PrReservation = { readonly kind: "fresh" } | { readonly kind: "taken"; readonly record: PrRecord };

/**
 * The directory holding one record per reserved pull request.
 *
 * @param home the state home
 * @returns `$home/ledgers/github-prs`
 */
export function ledgerDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "github-prs");
}

function recordPath({ home, locus }: { home: string; locus: string }): string {
  return join(ledgerDir({ home }), `${locusFilename({ locus })}.json`);
}

function ensureDir({ home }: { home: string }): void {
  mkdirSync(ledgerDir({ home }), { recursive: true });
}

/**
 * Parse a record, returning undefined when it is absent or unreadable.
 *
 * An unreadable record reads as ABSENT, and that is now safe in a way it was not when this file also granted
 * permission: a missing cache entry costs a surgical edit its fast path and nothing more, because the live
 * description is parsed instead. Authorisation is a live authorship read-back and does not consult this file.
 *
 * The stored form is DECODED with the real schema rather than cast. A cast would let a record written by an
 * older or hand-edited version flow straight into the renderer as if it were valid, and the first sign of
 * trouble would be a malformed pull-request body. Decoding costs a schema evaluation per read and buys the
 * guarantee that a form reaching `applyEdit` is one the renderer can handle.
 *
 * The trade is deliberate: a record whose form is not the C3 shape — a reading-order form stored before C3, say —
 * stops decoding, its form is dropped, and the surgical path falls back to parsing the live description. A cache
 * miss, never a refusal.
 *
 * @param raw the file contents
 * @returns the record, or undefined when it cannot be trusted
 */
export function parsePrRecord({ raw }: { raw: string }): PrRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["locus"] !== "string" || typeof parsed["reservedIso"] !== "string") {
      return undefined;
    }
    const number = parsed["number"];
    const nodeId = parsed["nodeId"];
    const confirmedIso = parsed["confirmedIso"];
    const form = parsed["form"];
    const hash = parsed["bodyHash"];
    return {
      locus: parsed["locus"],
      reservedIso: parsed["reservedIso"],
      ...(typeof number === "number" ? { number } : {}),
      ...(typeof nodeId === "string" ? { nodeId } : {}),
      ...(typeof confirmedIso === "string" ? { confirmedIso } : {}),
      ...decodedForm({ form }),
      ...(typeof hash === "string" ? { bodyHash: hash } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Decode a stored form, contributing nothing when it is absent or no longer valid. */
function decodedForm({ form }: { form: unknown }): { form?: PrForm } {
  if (!isRecord(form)) {
    return {};
  }
  const parsed = storedPrFormSchema.safeParse(form);
  return parsed.success ? { form: parsed.data } : {};
}

/**
 * Read one record, or undefined.
 *
 * @param home the state home
 * @param locus the branch locus
 * @returns the record, or undefined
 */
export function readPrRecord({ home, locus }: { home: string; locus: string }): PrRecord | undefined {
  try {
    return parsePrRecord({ raw: readFileSync(recordPath({ home, locus }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Claim a locus exclusively, BEFORE the create is attempted.
 *
 * @param home the state home
 * @param locus the branch locus
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed, `taken` when the locus is already claimed
 */
export function reservePr({ home, locus, nowIso }: { home: string; locus: string; nowIso: string }): PrReservation {
  ensureDir({ home });
  const record: PrRecord = { locus, reservedIso: nowIso };
  try {
    writeFileSync(recordPath({ home, locus }), JSON.stringify(record), { flag: "wx" });
    return { kind: "fresh" };
  } catch {
    const existing = readPrRecord({ home, locus });
    // An unwritable or unparseable slot counts as TAKEN, never as free. The safe direction is to refuse a
    // create we cannot record, because an unrecorded create is one `update` can never own afterwards.
    return { kind: "taken", record: existing ?? record };
  }
}

/**
 * Release a locus's reservation, because the pull request it named no longer occupies it.
 *
 * The caller is expected to have positively confirmed that first — a live read showing the recorded number
 * is no longer OPEN, whether closed or merged. GitHub's own `pulls.create` has no objection to a fresh pull
 * request on a base/head pair whose only prior occupant is closed; the reservation is this repository's OWN
 * bookkeeping, so once the prior occupant is confirmed gone, clearing it removes a purely local obstacle.
 *
 * Absent is treated the same as removed: a caller that already lost the race, or is releasing speculatively,
 * gets the same clean outcome either way.
 *
 * @param home the state home
 * @param locus the branch locus
 * @returns nothing; the record file is removed if present
 */
export function releasePrRecord({ home, locus }: { home: string; locus: string }): void {
  try {
    unlinkSync(recordPath({ home, locus }));
  } catch {
    // Already gone. Same outcome either way.
  }
}

/**
 * Record that a write actually landed, with the identity GitHub returned and the body it stored.
 *
 * Used for both the create and every subsequent update: an update that does not refresh the digest would
 * make the NEXT update believe a human had edited the description, refusing forever.
 *
 * @param home the state home
 * @param locus the branch locus
 * @param number GitHub's pull-request number
 * @param nodeId GitHub's node id
 * @param nowIso when the write was confirmed
 * @param form the form as rendered for this write
 * @param storedBody the body as read back from GitHub after the write
 * @param writeAtomic the durable-replace seam, so a test can make the rewrite die part-way
 * @returns nothing; the record is written to disk
 */
export function confirmPr({
  home,
  locus,
  number,
  nodeId,
  nowIso,
  form,
  storedBody,
  writeAtomic = writeFileAtomic,
}: {
  home: string;
  locus: string;
  number: number;
  nodeId: string;
  nowIso: string;
  form: PrForm;
  storedBody: string | undefined;
  writeAtomic?: typeof writeFileAtomic;
}): void {
  ensureDir({ home });
  const existing = readPrRecord({ home, locus });
  const record: PrRecord = {
    bodyHash: bodyHash({ body: storedBody }),
    confirmedIso: nowIso,
    form,
    locus,
    nodeId,
    number,
    reservedIso: existing?.reservedIso ?? nowIso,
  };
  writeAtomic({ contents: JSON.stringify(record), path: recordPath({ home, locus }) });
}

/**
 * Every locus slopweaver has reserved, for reconciliation and for `doctor`.
 *
 * Records are named by a digest, so the locus cannot be recovered from the filename — each file is read and
 * its stored `locus` returned. An unreadable record is SKIPPED rather than reported as a locus, because a
 * corrupt file has no locus to report, and nothing downstream grants permission on the strength of one.
 *
 * @param home the state home
 * @returns every reserved locus, sorted
 */
export function listPrLoci({ home }: { home: string }): readonly string[] {
  try {
    return readdirSync(ledgerDir({ home }))
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          return parsePrRecord({ raw: readFileSync(join(ledgerDir({ home }), name), "utf8") });
        } catch {
          return undefined;
        }
      })
      .filter((record): record is PrRecord => record !== undefined)
      .map((record) => record.locus)
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * Recover a pull request's identity onto a reservation that never got one, WITHOUT inventing a form.
 *
 * The case is a create whose POST failed with no response while GitHub committed it anyway: the record on
 * disk carries only `{locus, reservedIso}`, and the number is recoverable by listing the branch pair. What is
 * NOT recoverable that way is the form the body was rendered from — the caller may not have one at all, as
 * `../../cli/commands/github/releaseReservationRun.ts` does not.
 *
 * So this writes the identity and the body digest and leaves `form` exactly as it found it, absent included.
 * A record with a number and no form is an already-supported state: the surgical update path takes a cache
 * MISS and parses the live description instead, which is this file's own documented fallback. A fabricated
 * form would be worse than no form, because `applyEdit` would merge into it and write the result.
 *
 * `confirmPr` is the right call wherever the form IS in hand — see `../../cli/commands/github/reservation.ts`.
 *
 * @param home the state home
 * @param locus the branch locus
 * @param nodeId GitHub's node id for the recovered pull request
 * @param number GitHub's pull-request number
 * @param nowIso when the recovery was confirmed
 * @param storedBody the body as GitHub reports it now, digested as the conflict signal
 * @returns nothing; the record is written to disk
 */
export function backfillPrIdentity({
  home,
  locus,
  nodeId,
  number,
  nowIso,
  storedBody,
}: {
  home: string;
  locus: string;
  nodeId: string;
  number: number;
  nowIso: string;
  storedBody: string | undefined;
}): void {
  ensureDir({ home });
  const existing = readPrRecord({ home, locus });
  const reservedIso = existing === undefined ? nowIso : existing.reservedIso;
  const carriedForm = existing?.form === undefined ? {} : { form: existing.form };
  const record: PrRecord = {
    bodyHash: bodyHash({ body: storedBody }),
    confirmedIso: nowIso,
    ...carriedForm,
    locus,
    nodeId,
    number,
    reservedIso,
  };
  writeFileAtomic({ contents: JSON.stringify(record), path: recordPath({ home, locus }) });
}
