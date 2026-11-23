/**
 * The GitHub REVIEW-DRAFT register: a review of somebody else's pull request — a verdict, a body and line comments
 * — PARKED for the owner to read before anything reaches GitHub.
 *
 * The flow: a review surfaces its findings in a queue card where the owner approves the draft PR comments on the
 * relevant lines, as with Slack native UI drafts. So this is the sibling of the as-me Slack draft register (`../slack/draftRegister.ts`): the same
 * append-only events, the same digest-bound release, a different payload.
 *
 * Every comment carries the diff HUNK it sits on, captured when it was recorded, because the console that draws
 * the card may only run listed verbs (`site/lib/liveVerbs.ts`) and a live diff read per poll would spend GitHub
 * quota for a picture that is only true of the head the review was written against anyway.
 *
 * Everything here is pure. The filesystem edge is `../../admit/reviewDraftStore.ts`; the diff reading that
 * builds a hunk is `../../cli/commands/github/reviewDraftDiff.ts`.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { stableStringify } from "../../lib/stableStringify.js";
import { strictForm } from "../strictForm.js";
import { type ReviewDraftError, ReviewDraftErrors } from "./reviewDraftErrors.js";

/** The register's schema version, stamped onto every line. */
const REVIEW_DRAFT_SCHEMA_VERSION = 1;

/** GitHub's three review events, in the order the card offers them. */
export const REVIEW_VERDICTS = ["APPROVE", "COMMENT", "REQUEST_CHANGES"] as const;

/** One review event. */
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** One line of a stored diff hunk, as GitHub draws it above a review comment. */
export interface HunkLine {
  readonly kind: "header" | "add" | "del" | "context";
  /** The line as the patch carries it, without its `+`/`-`/space marker. */
  readonly text: string;
  /** The base-side number, absent on an added line and on the header. */
  readonly oldLine?: number | undefined;
  /** The head-side number, absent on a removed line and on the header. */
  readonly newLine?: number | undefined;
}

/** One line comment, anchored on the head side of the diff. */
export interface ReviewDraftComment {
  readonly path: string;
  /** The head-side line the comment sits on — the LAST line of a range. */
  readonly line: number;
  /** The first head-side line of a multi-line comment; absent on a single line. */
  readonly startLine?: number | undefined;
  readonly body: string;
  /** The lines GitHub shows above the comment, captured at recording. Not in the digest. */
  readonly hunk: readonly HunkLine[];
}

/** One parked review, exactly as a post re-checks it. */
export interface ParkedReviewDraft {
  readonly id: string;
  readonly tsIso: string;
  /** `owner/name`. */
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** The pull request's author login, when GitHub named one. */
  readonly author: string | undefined;
  /** The head commit the review was written against. Digest-bound: a new push invalidates the owner's approval. */
  readonly headSha: string;
  readonly verdict: ReviewVerdict;
  readonly body: string;
  readonly comments: readonly ReviewDraftComment[];
  /** Why a deeper review is worth offering, when the fleet saw risk it did not settle. Commentary, not posted. */
  readonly deeperReview?: string | undefined;
  /** One line saying what this review is for, so a row in a list reads without opening it. */
  readonly why: string;
  /** Binds what would be posted. See {@link reviewDraftDigest}. */
  readonly digest: string;
}

/** What has happened to one row. Appended, never rewritten. */
export type ReviewDraftEvent =
  | { readonly kind: "parked"; readonly id: string; readonly tsIso: string; readonly draft: ParkedReviewDraft }
  | { readonly kind: "posted"; readonly id: string; readonly tsIso: string; readonly url: string }
  | { readonly kind: "dropped"; readonly id: string; readonly tsIso: string; readonly note: string };

/** One row, folded to its current state. */
export interface ReviewDraftItem {
  readonly id: string;
  readonly state: "held" | "posted" | "dropped";
  readonly draft: ParkedReviewDraft;
  /** When it was posted or dropped. Absent while it is still held. */
  readonly resolvedIso?: string | undefined;
  /** The posted review's URL, or the drop's note. */
  readonly outcome?: string | undefined;
}

/**
 * The identity the owner's approval is BOUND to: which pull request, at which head, and exactly what would be
 * posted — the verdict, the body, and each comment's anchor and words.
 *
 * Not the whole row, and each omission is deliberate. The id, the instant and the `why` are bookkeeping. The
 * title and URL are GitHub's, and can change without changing what the owner approved. The hunks are a picture of the
 * diff for the owner to read, recaptured from the live diff before a post rather than trusted. `deeperReview` is an
 * offer to the owner, never posted.
 *
 * @param draft the row's bound fields
 * @returns a 32-char hex digest, identical for an identical pull request, head and posted content
 */
export function reviewDraftDigest({
  draft,
}: {
  draft: Pick<ParkedReviewDraft, "repo" | "number" | "headSha" | "verdict" | "body"> & {
    readonly comments: readonly Pick<ReviewDraftComment, "path" | "line" | "startLine" | "body">[];
  };
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        value: {
          body: draft.body,
          comments: draft.comments.map(({ body, line, path, startLine }) => ({
            body,
            line,
            path,
            ...(startLine === undefined ? {} : { startLine }),
          })),
          headSha: draft.headSha,
          number: draft.number,
          repo: draft.repo,
          verdict: draft.verdict,
        },
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Encode one event as a JSONL line.
 *
 * @param event the event to append
 * @returns the JSON line, with no trailing newline
 */
export function reviewDraftEventLine({ event }: { event: ReviewDraftEvent }): string {
  return JSON.stringify({ schemaVersion: REVIEW_DRAFT_SCHEMA_VERSION, ...event });
}

const hunkLineSchema = strictForm({
  kind: z.enum(["header", "add", "del", "context"]),
  newLine: z.number().int().positive().optional(),
  oldLine: z.number().int().positive().optional(),
  text: z.string(),
});

const commentSchema = strictForm({
  body: z.string().min(1),
  hunk: z.array(hunkLineSchema),
  line: z.number().int().positive(),
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
});

const draftSchema = strictForm({
  author: z.string().optional(),
  body: z.string(),
  comments: z.array(commentSchema),
  deeperReview: z.string().optional(),
  digest: z.string().regex(/^[0-9a-f]{32}$/),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  id: z.string().min(1),
  number: z.number().int().positive(),
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  title: z.string(),
  tsIso: z.string().min(1),
  url: z.string().min(1),
  verdict: z.enum(REVIEW_VERDICTS),
  why: z.string().min(1),
});

/** Every line carries the version it was written under; a line from another version does not read. */
const schemaVersion = z.literal(REVIEW_DRAFT_SCHEMA_VERSION);

const eventSchema = z.discriminatedUnion("kind", [
  strictForm({
    draft: draftSchema,
    id: z.string().min(1),
    kind: z.literal("parked"),
    schemaVersion,
    tsIso: z.string().min(1),
  }),
  strictForm({
    id: z.string().min(1),
    kind: z.literal("posted"),
    schemaVersion,
    tsIso: z.string().min(1),
    url: z.string().min(1),
  }),
  strictForm({
    id: z.string().min(1),
    kind: z.literal("dropped"),
    note: z.string(),
    schemaVersion,
    tsIso: z.string().min(1),
  }),
]);

/** The register's lines, split into the events this version can vouch for and how many it passed over. */
export interface ReviewDraftLog {
  readonly events: readonly ReviewDraftEvent[];
  /** Lines that did not parse — said aloud by the caller, never silently dropped. */
  readonly skipped: number;
}

/**
 * Read the register's lines.
 *
 * @param lines every line in file order
 * @returns the events and the count of lines that did not read
 */
export function parseReviewDraftLog({ lines }: { lines: readonly string[] }): ReviewDraftLog {
  const events: ReviewDraftEvent[] = [];
  let skipped = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    const event = eventOf({ line });
    if (event === undefined) {
      skipped += 1;
      continue;
    }
    events.push(event);
  }
  return { events, skipped };
}

/** One line as an event, or `undefined` when it is not JSON or not an event this version reads. */
function eventOf({ line }: { line: string }): ReviewDraftEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const { schemaVersion: _version, ...event } = parsed.data;
  if (event.kind !== "parked") {
    return event;
  }
  // `author` is a required key whose value may be absent, which Zod's `.optional()` types as an optional key.
  return { ...event, draft: { ...event.draft, author: event.draft.author } };
}

/**
 * The line a caller prints when some register lines did not read, or `undefined` when all of them did.
 *
 * @param skipped how many lines were passed over
 * @returns the note, or `undefined`
 */
export function skippedReviewDraftNote({ skipped }: { skipped: number }): string | undefined {
  if (skipped === 0) {
    return undefined;
  }
  return `${String(skipped)} line(s) of the review-draft register did not read and are not shown — a draft may be missing`;
}

/**
 * Fold events into one row per draft, newest first. A `posted` or `dropped` whose `parked` is not in the log is
 * ignored rather than invented: it could only produce a row with no content. A second `parked` under an id already
 * seen is ignored too, since the first recording owns the id. Otherwise a reused id would bring a posted review
 * back to held.
 *
 * @param events the register's events, in file order
 * @returns one item per parked draft, newest first
 */
export function foldReviewDrafts({ events }: { events: readonly ReviewDraftEvent[] }): readonly ReviewDraftItem[] {
  const items = new Map<string, ReviewDraftItem>();
  for (const event of events) {
    if (event.kind === "parked") {
      if (!items.has(event.id)) {
        items.set(event.id, { draft: event.draft, id: event.id, state: "held" });
      }
      continue;
    }
    const standing = items.get(event.id);
    if (standing === undefined) {
      continue;
    }
    items.set(
      event.id,
      event.kind === "posted"
        ? { ...standing, outcome: event.url, resolvedIso: event.tsIso, state: "posted" }
        : { ...standing, outcome: event.note, resolvedIso: event.tsIso, state: "dropped" },
    );
  }
  return [...items.values()].toSorted((left, right) => right.draft.tsIso.localeCompare(left.draft.tsIso));
}

/**
 * The one row an id names, refusing rather than answering `undefined`, and refusing a spent row by name.
 *
 * @param id the row the caller named
 * @param items every folded row
 * @param mustBeHeld whether a posted or dropped row is a failure — true for a post or a drop, false for a read
 * @returns the row, or which check refused it
 */
export function reviewDraftById({
  id,
  items,
  mustBeHeld,
}: {
  id: string;
  items: readonly ReviewDraftItem[];
  mustBeHeld: boolean;
}): Result<ReviewDraftItem, ReviewDraftError> {
  const found = items.find((item) => item.id === id);
  if (found === undefined) {
    return err(ReviewDraftErrors.notFound({ id }));
  }
  if (mustBeHeld && found.state !== "held") {
    return err(ReviewDraftErrors.spent({ id, state: found.state }));
  }
  return ok(found);
}

/**
 * Refuse a row whose recorded digest is not the digest of its own content — a register line edited after the owner
 * read the card. The approval gate compares against the RECOMPUTED digest, so this is what names the drift.
 *
 * @param draft the stored row
 * @returns the row's digest, or the drift
 */
export function recomputedDigest({ draft }: { draft: ParkedReviewDraft }): Result<string, ReviewDraftError> {
  const recomputed = reviewDraftDigest({ draft });
  if (recomputed !== draft.digest) {
    return err(ReviewDraftErrors.drifted({ id: draft.id, recomputed, recorded: draft.digest }));
  }
  return ok(recomputed);
}
