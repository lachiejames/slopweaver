/**
 * The current-owner ruling overlay: explicit, low-latency judgement that sits beside the slower mined profile.
 *
 * A mined profile is evidence-derived and immutable between accepted mining passes. That is the right contract
 * for durable principles and worked examples, but the wrong latency for "I have decided this; do it this way
 * next time." An owner directive is therefore a separate object with explicit provenance. Only a feedback memory
 * carrying `metadata.slopweaver.ownerDirective: true` can produce one; ordinary memories never become control.
 *
 * ## Corrections, and why they are a second type rather than a field
 *
 * A DIRECTIVE is standing guidance: it applies to every turn, and nothing has to match for it to bind. A
 * CORRECTION is bound to one thing the bot got wrong about one specific record — _"that one's wrong,
 * because…"_ — and it applies when that record is in front of the answer.
 *
 * They are consulted differently, so they are typed differently. Collapsing them into an optional `subject`
 * on {@link OwnerDirective} would leave every consumer branching on whether the field is present in order to
 * work out which of two contracts it was holding, which is the shape this repo's error-handling rule exists
 * to prevent.
 *
 * **Matching is EXACT and it is never similarity.** A correction carries the same source/container/sourceId
 * tuple a retrieved record is pinned by, so "does this apply?" is a set membership test, not a judgement. The
 * rule here is the one for any matching problem: similarity may NOMINATE a thing, it may never CONCLUDE. A
 * correction that fired on a fuzzy topic match would put words in the owner's mouth about a record the owner never saw.
 *
 * **What lives here and what does not.** This module owns the shape and the matching. It does not own
 * capture — how a correction gets from the owner saying it in a thread to a memory file — and it deliberately
 * holds no correction text of its own, for the same partition reason the rest of this file names.
 */
import { z } from "zod";

import { sha256Text } from "../lib/hash.js";
import { err, ok, type Result } from "../lib/result.js";
import type { MemoryLeaf } from "../memory/types.js";
import { type OwnerDirectiveError, OwnerDirectiveErrors } from "./ownerDirective.errors.js";

/**
 * Stored overlay version. A different version is refused rather than reinterpreted.
 *
 * **2** — added `corrections`. Bumped rather than made optional, and the reason is the whole point of the
 * feature: with an optional field, a file carrying no `corrections` key is ambiguous between "there are
 * none" and "this was written before corrections existed", and those are exactly the two readings a
 * fail-closed consultation must not confuse.
 *
 * The overlay is no longer stored as a file: the `owner_directive` and `owner_correction` tables are the
 * authority (`../store/schema/ownerJudgement.ts`), and this shape is what their ACTIVE rows project to — for
 * a turn brief, for reflection and for a store export, whose fingerprint is computed over it. The version
 * still gates the one place a file is read: the one-time import of the legacy `judgement/owner-directives.json`
 * (`./ownerDirectiveImport.ts`), which refuses a file at any other version as `OWNER_DIRECTIVE_HOME_FILE_OUTDATED`
 * and imports nothing, rather than reinterpreting a shape this build does not read. Keeping that apart from
 * corrupt bytes is the lesson of the v2 bump, when the two shared one outcome and the documented recovery
 * could not run: an outdated file is moved aside and each directive re-recorded from the memory that owns it.
 */
export const OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION = 2;

/** Hard bounds keep a control-plane overlay from turning every turn brief into an unbounded wall of text. */
const OWNER_DIRECTIVE_LIMIT = 64;
const OWNER_DIRECTIVE_TEXT_LIMIT = 1_000;
/**
 * Corrections get their own, larger cap: a directive is standing guidance and a handful cover a whole
 * working style, whereas corrections accrue one per mistake and their whole value is that none is dropped.
 * They also cost nothing per turn that does not match one — unlike directives, which are all injected.
 */
const OWNER_CORRECTION_LIMIT = 512;

/** Provenance for one explicit ruling, containing no private absolute path. */
interface OwnerDirectiveSource {
  readonly contentHash: string;
  readonly file: string;
  readonly modified: string | null;
}

/** One current owner ruling a visible session must apply when its described situation matches. */
export interface OwnerDirective {
  readonly id: string;
  readonly text: string;
  readonly source: OwnerDirectiveSource;
}

/**
 * The exact corpus object a correction is about.
 *
 * Structurally the same tuple `retrieval/pinnedSlice.ts` pins a retrieved record by, and deliberately
 * declared here rather than imported: the control-plane overlay must not depend on the retrieval stack, and
 * the two are assignable, so a caller matches one against the other with no conversion. `url` is carried
 * when the source has one because it is what a human checks the correction against; it is never what
 * matching uses, since the same object can be reachable by more than one URL.
 */
interface CorrectionSubject {
  readonly source: string;
  readonly container: string;
  readonly sourceId: string;
  readonly url?: string | undefined;
}

/**
 * One thing the owner has said the bot got wrong about one specific record.
 *
 * `text` is what the owner said, bounded exactly as a directive's is. `subject` is what makes it checkable: it is
 * how a later turn knows the correction applies without anybody guessing.
 */
export interface OwnerCorrection {
  readonly id: string;
  readonly text: string;
  readonly source: OwnerDirectiveSource;
  readonly subject: CorrectionSubject;
}

/** The whole private overlay embedded into new turn briefs. */
export interface OwnerDirectiveOverlay {
  readonly schemaVersion: 2;
  readonly directives: readonly OwnerDirective[];
  /**
   * Corrections bound to specific records. Separate from `directives` because they are consulted by
   * MATCHING rather than injected wholesale — see this module's header.
   */
  readonly corrections: readonly OwnerCorrection[];
}

/**
 * What one memory says to do to the overlay. `ignore` means it carries no explicit directive field.
 *
 * `upsert-correction` is a separate arm from `upsert` rather than a flag on it, so a consumer that has not
 * been taught about corrections fails to compile instead of silently dropping one on the floor.
 */
export type OwnerDirectiveMemoryChange =
  | { readonly kind: "ignore" }
  | { readonly kind: "remove"; readonly id: string; readonly sourceFile: string }
  | { readonly kind: "upsert"; readonly directive: OwnerDirective }
  | { readonly kind: "upsert-correction"; readonly correction: OwnerCorrection };

/** An explicit revocation, bound to the same memory file that owns the stored ruling. */
export interface OwnerDirectiveRemoval {
  readonly id: string;
  readonly sourceFile: string;
}

const contentHashPattern = /^sha256:[0-9a-f]{64}$/;

/** The strict schema for one directive. */
export const ownerDirectiveSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z
      .object({
        contentHash: z.string().regex(contentHashPattern, "contentHash must be sha256:<64 hex chars>"),
        file: z.string().min(1).max(255),
        modified: z.string().min(1).nullable(),
      })
      .strict(),
    text: z.string().min(1).max(OWNER_DIRECTIVE_TEXT_LIMIT),
  })
  .strict() satisfies z.ZodType<OwnerDirective>;

/** The strict schema for one correction's subject. */
const correctionSubjectSchema = z
  .object({
    container: z.string().min(1).max(255),
    source: z.string().min(1).max(64),
    sourceId: z.string().min(1).max(255),
    url: z.string().min(1).max(2_048).optional(),
  })
  .strict() satisfies z.ZodType<CorrectionSubject>;

/** The strict schema for one correction. */
export const ownerCorrectionSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z
      .object({
        contentHash: z.string().regex(contentHashPattern, "contentHash must be sha256:<64 hex chars>"),
        file: z.string().min(1).max(255),
        modified: z.string().min(1).nullable(),
      })
      .strict(),
    subject: correctionSubjectSchema,
    text: z.string().min(1).max(OWNER_DIRECTIVE_TEXT_LIMIT),
  })
  .strict() satisfies z.ZodType<OwnerCorrection>;

/** The strict parse-edge schema for the complete overlay. */
const ownerDirectiveOverlaySchema = z
  .object({
    corrections: z.array(ownerCorrectionSchema).max(OWNER_CORRECTION_LIMIT),
    directives: z.array(ownerDirectiveSchema).max(OWNER_DIRECTIVE_LIMIT),
    schemaVersion: z.literal(OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((overlay, context) => {
    const seen = new Set<string>();
    overlay.directives.forEach((directive, index) => {
      if (seen.has(directive.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate owner directive id: ${directive.id}`,
          path: ["directives", index, "id"],
        });
      }
      seen.add(directive.id);
    });
    // Corrections carry their own id space, so a correction and a directive MAY share an id here: two memory
    // files can name one id as different kinds, and a pair one file left behind stays readable. A memory becomes
    // exactly one kind, though, so the merges retire a same-id, same-file entry of the other kind when that memory
    // next syncs (`withoutKindChanges`).
    const seenCorrections = new Set<string>();
    overlay.corrections.forEach((correction, index) => {
      if (seenCorrections.has(correction.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate owner correction id: ${correction.id}`,
          path: ["corrections", index, "id"],
        });
      }
      seenCorrections.add(correction.id);
    });
  }) satisfies z.ZodType<OwnerDirectiveOverlay>;

/**
 * Parse an already-decoded overlay.
 *
 * @param value the decoded JSON value
 * @returns the typed overlay, or every schema violation
 */
export function parseOwnerDirectiveOverlay({
  value,
}: {
  value: unknown;
}): Result<OwnerDirectiveOverlay, OwnerDirectiveError> {
  const parsed = ownerDirectiveOverlaySchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(OwnerDirectiveErrors.schemaInvalid({ issues: parsed.error.issues.map((issue) => issue.message) }));
}

/**
 * Convert one parsed memory leaf into a current ruling when, and only when, it explicitly opts in.
 *
 * The description is the bounded retrieval-grade statement already designed to stand on its own. The memory
 * body remains evidence behind it and never gets copied wholesale into every turn. A tagged non-feedback memory
 * is refused: project/reference/user memories are context, not owner-authored corrections to bot behaviour.
 *
 * @param leaf the parsed memory leaf
 * @returns `null` for an ordinary memory, the directive for a valid opt-in, or why the opt-in is invalid
 */
export function ownerDirectiveChangeFromMemory({
  leaf,
}: {
  leaf: MemoryLeaf;
}): Result<OwnerDirectiveMemoryChange, OwnerDirectiveError> {
  if (leaf.ownerDirective === null) {
    return ok({ kind: "ignore" });
  }
  if (leaf.schemaFindings.length > 0) {
    return err(OwnerDirectiveErrors.invalidFrontmatter({ file: leaf.file }));
  }
  if (leaf.declaredType !== "feedback") {
    return err(OwnerDirectiveErrors.notFeedback({ file: leaf.file }));
  }
  if (leaf.declaredName === null || leaf.description === null) {
    return err(OwnerDirectiveErrors.missingNameOrDescription({ file: leaf.file }));
  }
  if (!leaf.ownerDirective) {
    return ok({ id: leaf.declaredName, kind: "remove", sourceFile: leaf.file });
  }
  const source = {
    contentHash: sha256Text({ text: `${leaf.declaredName}\n${leaf.description}` }),
    file: leaf.file,
    modified: leaf.declaredModified,
  };
  // The one rule that decides which of the two this memory becomes: a named subject makes it a CORRECTION
  // (it binds when that record is in front of an answer); no subject makes it standing guidance.
  if (leaf.correctionSubject !== null) {
    const correction: OwnerCorrection = {
      id: leaf.declaredName,
      source,
      subject: leaf.correctionSubject,
      text: leaf.description,
    };
    const parsedCorrection = ownerCorrectionSchema.safeParse(correction);
    return parsedCorrection.success
      ? ok({ correction: parsedCorrection.data, kind: "upsert-correction" })
      : err(
          OwnerDirectiveErrors.schemaInvalid({
            issues: parsedCorrection.error.issues.map((issue) => `${leaf.file}: ${issue.message}`),
          }),
        );
  }
  const directive: OwnerDirective = { id: leaf.declaredName, source, text: leaf.description };
  const parsed = ownerDirectiveSchema.safeParse(directive);
  return parsed.success
    ? ok({ directive: parsed.data, kind: "upsert" })
    : err(
        OwnerDirectiveErrors.schemaInvalid({
          issues: parsed.error.issues.map((issue) => `${leaf.file}: ${issue.message}`),
        }),
      );
}

/**
 * The other kind's entries an upsert set leaves standing. One memory file is one ruling: when it upserts an id
 * as one kind that it held as the other (a subject added to a directive, or taken off a correction), the
 * memory changed kind, so its old entry goes rather than standing beside the new one. The same id held by a
 * DIFFERENT file is another ruling in the other id space and stays.
 */
function withoutKindChanges<T extends { readonly id: string; readonly source: { readonly file: string } }>({
  entries,
  upserts,
}: {
  entries: readonly T[];
  upserts: readonly { readonly id: string; readonly source: { readonly file: string } }[];
}): readonly T[] {
  const changed = new Set(upserts.map((upsert) => `${upsert.source.file}\u0000${upsert.id}`));
  return entries.filter((entry) => !changed.has(`${entry.source.file}\u0000${entry.id}`));
}

/**
 * Upsert corrections by their explicit stable id, keeping the same file-ownership rule directives use.
 *
 * A separate function from {@link mergeOwnerDirectives} rather than a widened one: the two live in the same
 * overlay but have different id spaces and different consultation contracts, and one merge that took both
 * would have to branch internally on which it was holding.
 *
 * @param overlay the current valid overlay
 * @param corrections newly recorded or updated corrections
 * @param removals explicitly revoked ids, bound to the memory file that owns each one
 * @returns the validated merged overlay, or the bound/schema violation
 */
export function mergeOwnerCorrections({
  overlay,
  corrections,
  removals = [],
}: {
  overlay: OwnerDirectiveOverlay;
  corrections: readonly OwnerCorrection[];
  removals?: readonly OwnerDirectiveRemoval[];
}): Result<OwnerDirectiveOverlay, OwnerDirectiveError> {
  const byId = new Map(overlay.corrections.map((correction) => [correction.id, correction]));
  for (const removal of removals) {
    const current = byId.get(removal.id);
    if (current !== undefined && current.source.file !== removal.sourceFile) {
      return err(
        OwnerDirectiveErrors.conflict({
          action: "revoke",
          attemptedBy: removal.sourceFile,
          id: removal.id,
          ownedBy: current.source.file,
        }),
      );
    }
    byId.delete(removal.id);
  }
  for (const correction of corrections) {
    const current = byId.get(correction.id);
    if (current !== undefined && current.source.file !== correction.source.file) {
      return err(
        OwnerDirectiveErrors.conflict({
          action: "replace",
          attemptedBy: correction.source.file,
          id: correction.id,
          ownedBy: current.source.file,
        }),
      );
    }
    byId.set(correction.id, correction);
  }
  return parseOwnerDirectiveOverlay({
    value: {
      corrections: [...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
      directives: withoutKindChanges({ entries: overlay.directives, upserts: corrections }),
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    },
  });
}

/**
 * Which stored corrections apply to a retrieved slice — EXACT tuple membership, never similarity.
 *
 * This is the whole matching contract, and it is deliberately three string comparisons rather than anything
 * cleverer. A correction is the owner saying the bot got a specific thing wrong; firing one on a record the
 * owner never saw would put words in the owner's mouth, and the cost of a miss (the bot repeats a mistake) is smaller than
 * the cost of a false positive (the bot attributes a correction to the wrong record, in public).
 *
 * `url` is not compared: the same object is reachable by more than one URL, so matching on it would produce
 * both misses and false positives for no gain.
 *
 * @param corrections every correction in the overlay
 * @param subjects the records in front of the answer, in the same source/container/sourceId shape
 * @returns the corrections whose subject is present, in overlay order
 */
export function correctionsForSubjects({
  corrections,
  subjects,
}: {
  corrections: readonly OwnerCorrection[];
  subjects: readonly { readonly source: string; readonly container: string; readonly sourceId: string }[];
}): readonly OwnerCorrection[] {
  const present = new Set(subjects.map((s) => `${s.source}\u0000${s.container}\u0000${s.sourceId}`));
  return corrections.filter((correction) =>
    present.has(
      `${correction.subject.source}\u0000${correction.subject.container}\u0000${correction.subject.sourceId}`,
    ),
  );
}

/**
 * Convert one memory to the directive it upserts, preserving the earlier convenient projection for callers
 * that do not apply removals themselves.
 *
 * @param leaf the parsed memory leaf
 * @returns an upsert directive, or `null` for an ordinary memory or explicit removal
 */
export function ownerDirectiveFromMemory({
  leaf,
}: {
  leaf: MemoryLeaf;
}): Result<OwnerDirective | null, OwnerDirectiveError> {
  const change = ownerDirectiveChangeFromMemory({ leaf });
  if (change.isErr()) {
    return err(change.error);
  }
  return ok(change.value.kind === "upsert" ? change.value.directive : null);
}

/**
 * Upsert directives by their explicit stable id and return a canonical, sorted overlay.
 *
 * @param overlay the current valid overlay
 * @param directives newly recorded or updated rulings
 * @param removals explicitly revoked rulings, bound to the memory file that owns each one
 * @returns the validated merged overlay, or the bound/schema violation
 */
export function mergeOwnerDirectives({
  overlay,
  directives,
  removals = [],
}: {
  overlay: OwnerDirectiveOverlay;
  directives: readonly OwnerDirective[];
  removals?: readonly OwnerDirectiveRemoval[];
}): Result<OwnerDirectiveOverlay, OwnerDirectiveError> {
  const byId = new Map(overlay.directives.map((directive) => [directive.id, directive]));
  for (const removal of removals) {
    const current = byId.get(removal.id);
    if (current !== undefined && current.source.file !== removal.sourceFile) {
      return err(
        OwnerDirectiveErrors.conflict({
          action: "revoke",
          attemptedBy: removal.sourceFile,
          id: removal.id,
          ownedBy: current.source.file,
        }),
      );
    }
    byId.delete(removal.id);
  }
  for (const directive of directives) {
    const current = byId.get(directive.id);
    if (current !== undefined && current.source.file !== directive.source.file) {
      return err(
        OwnerDirectiveErrors.conflict({
          action: "replace",
          attemptedBy: directive.source.file,
          id: directive.id,
          ownedBy: current.source.file,
        }),
      );
    }
    byId.set(directive.id, directive);
  }
  return parseOwnerDirectiveOverlay({
    value: {
      // Carried through, bar the one the same memory file now upserts as a directive: this merge owns the
      // directive id space only, and dropping the corrections here would delete them every time a directive changed.
      corrections: withoutKindChanges({ entries: overlay.corrections, upserts: directives }),
      directives: [...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    },
  });
}
