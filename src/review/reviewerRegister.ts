/**
 * The reviewer register — who the owner has asked to review what, and which suggested reviewers they approved or
 * turned down. `ledgers/reviewers.jsonl`, append-only, one row per line.
 *
 * ## Why a register, and not a fold of the readings
 *
 * The suggestion on the pull-request page is "who the owner has picked before for this kind of change", and every
 * landing reading already carries each open pull request's ask trail. But the readings ledger is 169 files and
 * 193 MB on the owner's machine (`du -sh $SLOPWEAVER_HOME/readings/github-landing`), and a page polls; folding
 * it on every poll is the read the plan refused. So `github landing --record-reading` appends each NEW ask it
 * saw here, deduplicated on `prKey|messageKey`, and the suggestion reads one small file. Asks on pull requests
 * that closed before any recorded reading saw them come from `github reviewer backfill`, which folds the local
 * corpus through the same classifier (`./reviewerBackfill.ts`); an ask neither has seen is simply absent.
 *
 * ## The three row kinds
 *
 * - `asked` — one certified ask on one pull request, with the recipients `askDecisionFor` scoped to it, and
 *   the code-owner teams GitHub named at the time, so "who reviews @acme/security changes" has an answer.
 * - `pick` — the owner's verdict on a suggested reviewer, `approve` or `decline`. A decline carries the feedback that
 *   says why, and the suggestion never offers that person on that pull request again. A pick SENDS NOTHING;
 *   the ask an approve leads to is a parked draft in the Slack draft register, never a field here.
 * - `read` — a VISIBLE session's reading of one message on one pull request, written by `github reviewer
 *   read`: an ask and whom, or not, with the exact line it read. The landing honours it over the classifier's
 *   abstention and, for a message the corpus never held, contributes the ask itself (`./readingMerge.ts`).
 *   Without it the page says "not known who was asked" on every pull request whose unsettled messages nobody
 *   has read, because nothing a reader decided could be written back.
 *
 * Pure: parsing, validation and the dedupe. The file lives in `./reviewerRegisterStore.ts`.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";

import type { LandingRow } from "./landing.js";

/** One certified ask, as the register keeps it. */
export interface ReviewerAskedRow {
  readonly schema: 1;
  readonly kind: "asked";
  /** `owner/repo#number`. */
  readonly prKey: string;
  readonly repoSlug: string;
  readonly number: number;
  readonly authorLogin: string;
  /** The `@org/team` code owners GitHub still named when the ask was read. */
  readonly codeOwnerTeams: readonly string[];
  readonly messageKey: string;
  readonly atIso: string;
  readonly permalink: string;
  readonly channel: string;
  readonly isDirectMessage: boolean;
  /** Who this message asked about THIS pull request — `askDecisionFor`'s recipients, never its tags. */
  readonly recipients: readonly string[];
  /** The names the reading resolved for those recipients — a recipient it could not name is absent. */
  readonly names: Readonly<Record<string, string>>;
  readonly recordedAtIso: string;
}

/** The owner's verdict on one suggested reviewer for one pull request. */
export interface ReviewerPickRow {
  readonly schema: 1;
  readonly kind: "pick";
  readonly prKey: string;
  readonly repoSlug: string;
  readonly number: number;
  /** The Slack member id the owner approved or turned down. */
  readonly reviewer: string;
  readonly verdict: "approve" | "decline";
  /** Why, in the owner's words. Required on a decline; optional on an approve. */
  readonly feedback?: string;
  /** Which session recorded it — the console's own, when the owner pressed the button. */
  readonly bySession: string;
  readonly atIso: string;
}

/**
 * A visible session's reading of one message on one pull request. A later reading of the same
 * `prKey|messageKey` supersedes an earlier one — a re-read is a correction, never a repeat.
 */
export interface ReviewerReadRow {
  readonly schema: 1;
  readonly kind: "read";
  readonly prKey: string;
  readonly repoSlug: string;
  readonly number: number;
  /** `channel:ts` — the message's own identity, the key a landing mention is matched on. */
  readonly messageKey: string;
  readonly permalink: string;
  /** When the message was posted. */
  readonly atIso: string;
  /** The conversation id it sits in; a mention from the same conversation supplies the name a page prints. */
  readonly channel: string;
  readonly isDirectMessage: boolean;
  readonly verdict: "ask" | "non-ask";
  /** Who it asked about THIS pull request — people or groups. Non-empty exactly when `verdict` is `ask`. */
  readonly recipients: readonly string[];
  /** The line the reading rests on, verbatim from the message — checked against its text when recorded. */
  readonly quote: string;
  /** Why it is not an ask, in a phrase — present exactly when `verdict` is `non-ask`. */
  readonly why?: string;
  readonly bySession: string;
  readonly readAtIso: string;
}

/** One line of the register. */
export type ReviewerRow = ReviewerAskedRow | ReviewerPickRow | ReviewerReadRow;

/** The register's file cannot be read or reached. */
export interface ReviewerRegisterUnreadableError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A stored line is not a row this build reads. Carries the line number so it can be fixed, not guessed. */
export interface ReviewerRegisterCorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
}

/** Another session holds the register's write lock — contention, not corruption. */
export interface ReviewerRegisterBusyError {
  readonly code: "REGISTER_BUSY";
  readonly message: string;
}

/** Every way reading or appending to the reviewer register can fail. */
export type ReviewerRegisterError =
  ReviewerRegisterUnreadableError | ReviewerRegisterCorruptRowError | ReviewerRegisterBusyError;

/** The factory the real code and its tests both build failures through. */
export const ReviewerRegisterErrors = {
  busy: ({ why }: { why: string }): ReviewerRegisterBusyError => ({
    code: "REGISTER_BUSY",
    message: `the reviewer register is locked by another session: ${why}`,
  }),
  corruptRow: ({ lineNumber, why }: { lineNumber: number; why: string }): ReviewerRegisterCorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message: `reviewer register line ${String(lineNumber)} is not a row this build can read: ${why}`,
  }),
  unreadable: ({ cause, path }: { cause: string; path: string }): ReviewerRegisterUnreadableError => ({
    code: "REGISTER_UNREADABLE",
    message: `the reviewer register at ${path} could not be read: ${cause}`,
    path,
  }),
} as const;

const nonBlank = z.string().refine((value) => value.trim().length > 0, { message: "must not be blank" });
const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "not an instant" });
/** A Slack member id or user group — what an ask can name. */
const slackId = z.string().regex(/^[UWS][A-Z0-9]+$/, { message: "not a Slack id" });
/** A Slack PERSON — what a pick can name. A group is never a reviewer. */
const memberId = z.string().regex(/^[UW][A-Z0-9]+$/, { message: "not a Slack member id" });

const commonShape = {
  number: z.number().int().positive(),
  prKey: nonBlank,
  repoSlug: nonBlank,
  schema: z.literal(1),
};

const rowSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...commonShape,
      atIso: instant,
      authorLogin: z.string(),
      channel: z.string(),
      codeOwnerTeams: z.array(nonBlank).readonly(),
      isDirectMessage: z.boolean(),
      kind: z.literal("asked"),
      messageKey: nonBlank,
      names: z.record(slackId, nonBlank).readonly(),
      permalink: nonBlank,
      recipients: z.array(slackId).min(1).readonly(),
      recordedAtIso: instant,
    })
    .strict(),
  z
    .object({
      ...commonShape,
      atIso: instant,
      bySession: nonBlank,
      feedback: nonBlank.optional(),
      kind: z.literal("pick"),
      reviewer: memberId,
      verdict: z.enum(["approve", "decline"]),
    })
    .strict()
    .refine((row) => row.verdict === "approve" || row.feedback !== undefined, {
      message: "a decline carries the feedback that says why",
    }),
  z
    .object({
      ...commonShape,
      atIso: instant,
      bySession: nonBlank,
      channel: nonBlank,
      isDirectMessage: z.boolean(),
      kind: z.literal("read"),
      messageKey: nonBlank,
      permalink: nonBlank,
      quote: nonBlank,
      readAtIso: instant,
      recipients: z.array(slackId).readonly(),
      verdict: z.enum(["ask", "non-ask"]),
      why: nonBlank.optional(),
    })
    .strict()
    .refine((row) => row.verdict === "non-ask" || row.recipients.length > 0, {
      message: "an ask names at least one recipient",
    })
    .refine((row) => row.verdict === "ask" || (row.recipients.length === 0 && row.why !== undefined), {
      message: "a non-ask names nobody and carries the why",
    })
    .refine((row) => row.prKey === `${row.repoSlug}#${String(row.number)}`, {
      message: "prKey is the repository and number the row names",
    }),
]);

/**
 * Validate one value as a register row — what every writer and the reader both go through, so a row the
 * reader would refuse is never written.
 *
 * @param value the candidate row
 * @param lineNumber where it sits in the file, for the error; 0 for a row not yet written
 * @returns the row, or a corrupt-row failure naming the first broken field
 */
export function validateReviewerRow({
  value,
  lineNumber,
}: {
  value: unknown;
  lineNumber: number;
}): Result<ReviewerRow, ReviewerRegisterError> {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    let why = "it does not match either row kind";
    if (first !== undefined && first.path.length > 0) {
      why = `${first.path.join(".")}: ${first.message}`;
    } else if (first !== undefined) {
      why = first.message;
    }
    return err(ReviewerRegisterErrors.corruptRow({ lineNumber, why }));
  }
  const row = parsed.data;
  if (row.kind === "asked") {
    return ok(row);
  }
  if (row.kind === "read") {
    const { why, ...fields } = row;
    if (why === undefined) {
      return ok(fields);
    }
    return ok({ ...fields, why });
  }
  const { feedback, ...rest } = row;
  if (feedback === undefined) {
    return ok(rest);
  }
  return ok({ ...rest, feedback });
}

/**
 * Parse one stored line.
 *
 * @param line the raw JSON line
 * @param lineNumber its 1-based position
 * @returns the row, or the failure naming the line
 */
export function parseReviewerLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<ReviewerRow, ReviewerRegisterError> {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "a reviewer register row", text: line });
  } catch {
    return err(ReviewerRegisterErrors.corruptRow({ lineNumber, why: "it is not JSON" }));
  }
  return validateReviewerRow({ lineNumber, value });
}

/**
 * The `@org/team` tokens among a row's code owners — a team, never a person.
 *
 * @param blockedOn the landing row's `@`-prefixed code owners
 * @returns the team tokens, in order
 */
export function codeOwnerTeamsOf({ blockedOn }: { blockedOn: readonly string[] }): readonly string[] {
  return blockedOn.filter((token) => token.includes("/"));
}

/**
 * Every ask one landing read carries, as `asked` rows — before the dedupe, which needs the file.
 *
 * @param rows the landing rows of one read
 * @param recordedAtIso when the read was recorded
 * @param people the names the same document resolved, by Slack id
 * @returns one row per ask per pull request
 */
export function askedRowsOf({
  rows,
  recordedAtIso,
  people,
}: {
  rows: readonly LandingRow[];
  recordedAtIso: string;
  people: Readonly<Record<string, { readonly name: string }>>;
}): readonly ReviewerAskedRow[] {
  const namesOf = ({ ids }: { ids: readonly string[] }): Readonly<Record<string, string>> => {
    const names: Record<string, string> = {};
    for (const id of ids) {
      const person = people[id];
      if (person !== undefined) {
        names[id] = person.name;
      }
    }
    return names;
  };
  return rows.flatMap((row) =>
    row.askTrail.map((ask): ReviewerAskedRow => ({
      atIso: ask.atIso,
      authorLogin: row.authorLogin,
      channel: ask.channel,
      codeOwnerTeams: codeOwnerTeamsOf({ blockedOn: row.blockedOn }),
      isDirectMessage: ask.isDirectMessage,
      kind: "asked",
      messageKey: ask.messageKey,
      names: namesOf({ ids: ask.recipients }),
      number: row.number,
      permalink: ask.permalink,
      prKey: `${row.repoSlug}#${String(row.number)}`,
      recipients: ask.recipients,
      recordedAtIso,
      repoSlug: row.repoSlug,
      schema: 1,
    })),
  );
}

/**
 * The key one ask is deduplicated on: the same message about the same pull request is one ask, however many
 * readings saw it.
 *
 * @returns `prKey|messageKey`
 */
function askKey({ row }: { row: ReviewerAskedRow }): string {
  return `${row.prKey}|${row.messageKey}`;
}

/**
 * The newest reading of each message on each pull request, keyed `prKey` then `messageKey`. A later
 * `readAtIso` supersedes an earlier one, and on a tie the later line wins, because a re-read is a correction.
 *
 * @param rows every row the register holds, in written order
 * @returns the readings the landing honours
 */
export function readingsByPr({
  rows,
}: {
  rows: readonly ReviewerRow[];
}): ReadonlyMap<string, ReadonlyMap<string, ReviewerReadRow>> {
  const byPr = new Map<string, Map<string, ReviewerReadRow>>();
  for (const row of rows) {
    if (row.kind !== "read") {
      continue;
    }
    let messages = byPr.get(row.prKey);
    if (messages === undefined) {
      messages = new Map();
      byPr.set(row.prKey, messages);
    }
    const held = messages.get(row.messageKey);
    if (held === undefined || Date.parse(row.readAtIso) >= Date.parse(held.readAtIso)) {
      messages.set(row.messageKey, row);
    }
  }
  return byPr;
}

/**
 * The rows still to write: every pick and every reading, and every ask the register does not already hold — including a
 * repeat within `candidates` itself.
 *
 * @param held what the register holds now
 * @param candidates what a writer offers
 * @returns the rows to append, in the order offered
 */
export function rowsToAppend({
  held,
  candidates,
}: {
  held: readonly ReviewerRow[];
  candidates: readonly ReviewerRow[];
}): readonly ReviewerRow[] {
  const seen = new Set(held.flatMap((row) => (row.kind === "asked" ? [askKey({ row })] : [])));
  const out: ReviewerRow[] = [];
  for (const row of candidates) {
    if (row.kind === "asked") {
      const key = askKey({ row });
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    out.push(row);
  }
  return out;
}
