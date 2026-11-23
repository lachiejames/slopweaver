/**
 * The slice of a recorded `github landing` document that `github reviewer` reads: per row, who opened it, who
 * GitHub names as its code owners, whether it is a draft or stacked, what Slack said, its ask trail and its
 * bump verdict — and the document's `people` and `logins`.
 *
 * Parsed with a schema rather than trusted, because the document is a file on disk that older builds wrote.
 * A field the verb decides on refuses the reading when malformed; `askTrail` and `bump` may be ABSENT (a
 * reading recorded before they existed) and read as `undefined`, which the hook words as not known — never
 * as "nobody asked". Everything else in the document is ignored, so the page's own fields can grow freely.
 *
 * Pure.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";

import type { LandingAsk } from "./askTrail.js";
import type { BumpVerdict } from "./cadence.js";
import { type ReviewError, ReviewErrors } from "./errors.js";

/** One row as the hook and the suggestion read it. */
export interface ReviewerReadingRow {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string;
  readonly blockedOn: readonly string[];
  readonly draft: boolean;
  readonly stacked: boolean;
  readonly slackAsked: "yes" | "no" | "unknown";
  readonly slackWhy: string;
  /** `undefined` when the reading predates the field. */
  readonly askTrail: readonly LandingAsk[] | undefined;
  /** `undefined` when the reading predates the field. */
  readonly bump: BumpVerdict | undefined;
}

/** What one reading gives the verb. */
export interface ReviewerReading {
  readonly rows: readonly ReviewerReadingRow[];
  /** Slack id → name, as the document resolved them. */
  readonly people: ReadonlyMap<string, string>;
  /** Lower-cased GitHub login → Slack id, as the document resolved them. */
  readonly logins: ReadonlyMap<string, string>;
  /** Lower-cased GitHub login → every Slack id the roster held for them; empty on a reading that predates it. */
  readonly slackIdsForLogin: ReadonlyMap<string, readonly string[]>;
}

const askSchema = z.object({
  atIso: z.string(),
  channel: z.string(),
  isDirectMessage: z.boolean(),
  leg: z.enum(["corpus", "live"]),
  messageKey: z.string(),
  permalink: z.string(),
  recipients: z.array(z.string()).min(1),
});

const bumpSchema = z.discriminatedUnion("kind", [
  z.object({ eligibleSinceIso: z.string(), kind: z.literal("due"), silentSinceIso: z.string() }),
  z.object({ kind: z.literal("replied"), why: z.string() }),
  z.object({ eligibleAtIso: z.string(), kind: z.literal("too-soon"), why: z.string() }),
  z.object({ kind: z.literal("unknown"), why: z.string() }),
]);

const rowSchema = z.object({
  askTrail: z.array(askSchema).optional(),
  authorLogin: z.string(),
  blockedOn: z.array(z.string()),
  bump: bumpSchema.optional(),
  number: z.number().int().positive(),
  repoSlug: z.string().min(1),
  slack: z.object({ asked: z.enum(["yes", "no", "unknown"]), why: z.string() }),
  stack: z.object({ stacked: z.boolean() }),
  tests: z.array(z.object({ id: z.string(), verdict: z.string() })),
  title: z.string(),
  url: z.string(),
});

const documentSchema = z.object({
  loginSlackIds: z.record(z.string(), z.array(z.string())).optional(),
  logins: z.record(z.string(), z.string()).optional(),
  people: z.record(z.string(), z.object({ name: z.string() })).optional(),
  rows: z.array(rowSchema),
});

/**
 * Read the verb's slice of one landing document.
 *
 * @param document the parsed JSON of the reading
 * @returns the rows, names and logins, or the first field that does not parse
 */
export function reviewerReadingOf({ document }: { document: unknown }): Result<ReviewerReading, ReviewError> {
  const parsed = documentSchema.safeParse(document);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    let where = "the document";
    if (first !== undefined && first.path.length > 0) {
      where = first.path.join(".");
    }
    return err(ReviewErrors.readingMalformed({ where }));
  }
  const { rows, people = {}, logins = {}, loginSlackIds = {} } = parsed.data;
  return ok({
    logins: new Map(Object.entries(logins)),
    people: new Map(Object.entries(people).map(([id, entry]) => [id, entry.name])),
    rows: rows.map((row): ReviewerReadingRow => ({
      askTrail: row.askTrail,
      authorLogin: row.authorLogin,
      blockedOn: row.blockedOn,
      bump: row.bump,
      draft: row.tests.some((test) => test.id === "undrafted" && test.verdict === "fail"),
      number: row.number,
      repoSlug: row.repoSlug,
      slackAsked: row.slack.asked,
      slackWhy: row.slack.why,
      stacked: row.stack.stacked,
      title: row.title,
      url: row.url,
    })),
    slackIdsForLogin: new Map(Object.entries(loginSlackIds)),
  });
}
