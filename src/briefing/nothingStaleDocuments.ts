/**
 * The narrow views the "Nothing stale" section validates its stored documents through — the landing read,
 * the cycle report and the board's findings — and nothing wider.
 *
 * Each schema validates every field the classification consumes and lets every other producer field pass
 * unread, so a producer can grow a field without breaking this reader, and a field this reader relies on
 * cannot disappear without it saying so. A stored document is never cast to its producer's interface.
 *
 * Pure. Failures stay on the default `Result` (`readonly string[]`): a view's problems are a variable-length
 * list of same-shaped schema issues, which is the error-handling rule's own named exception.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import type {
  CycleBriefingDocument,
  LandingBriefingDocument,
  LandingCensusView,
  LandingRowView,
  SweepBriefingCandidate,
} from "./nothingStaleTypes.js";

/** A landing row's dispatch decision, every arm `../review/landingDispatch.ts` declares. */
const dispatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("act"),
    verdict: z.string().min(1),
    why: z.string(),
  }),
  z.object({ kind: z.enum(["waiting", "outside-the-set", "unread"]), why: z.string() }),
]);

/** One landing row, narrowed to what the section classifies on. */
const landingRowSchema = z.object({
  action: z.string().min(1),
  askTrail: z.array(z.object({ recipients: z.array(z.string()) })),
  blockedOn: z.array(z.string()),
  boardRow: z.union([z.object({ kind: z.literal("row"), slug: z.string().min(1) }), z.object({ kind: z.string() })]),
  dispatch: dispatchSchema,
  headOid: z.string().min(7),
  number: z.number().int().positive(),
  queue: z.object({ kind: z.string().min(1) }),
  repoSlug: z.string().min(1),
  residue: z.array(z.string()),
  title: z.string(),
  url: z.string().min(1),
});

/** The landing read, narrowed. `kind: "read"` refuses the skipped-tick document outright. */
const landingDocumentSchema = z.object({
  kind: z.literal("read"),
  people: z.record(z.string(), z.object({ name: z.string().min(1) })),
  presses: z.array(
    z.object({
      detail: z.string(),
      number: z.number().int().positive(),
      outcome: z.enum(["pressed", "would-press", "failed"]),
      repoSlug: z.string().min(1),
      url: z.string().min(1),
    }),
  ),
  residue: z.array(z.string()),
  rows: z.array(landingRowSchema),
  selection: z.object({
    author: z.string().min(1).optional(),
    includeDrafts: z.boolean(),
    repos: z.array(z.string().min(1)),
  }),
  census: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("read"),
        pullRequests: z.array(
          z.object({ author: z.string().optional(), isDraft: z.boolean(), number: z.number().int().positive() }),
        ),
        repo: z.string().min(1),
        viewer: z.string().min(1),
      }),
      z.object({ kind: z.literal("unread"), repo: z.string().min(1), why: z.string() }),
    ]),
  ),
});

/** The cycle report, narrowed. `proposalsOnly: true` is asserted, because the section relies on it. */
const cycleDocumentSchema = z.object({
  couldNotSee: z.array(z.string()),
  proposals: z.array(
    z.object({
      action: z.enum(["close-with-comment", "trace", "project-update"]),
      draft: z.string().optional(),
      evidence: z.array(z.object({ fact: z.string(), url: z.string().optional() })).min(1),
      headline: z.string().min(1),
      oneWordReplies: z.array(z.string().min(1)).min(1),
      subject: z.string().min(1),
      title: z.string().optional(),
      url: z.string().min(1),
    }),
  ),
  proposalsOnly: z.literal(true),
});

/** One board finding, narrowed. */
const sweepCandidateSchema = z.object({
  act: z.enum(["close", "settle", "none"]),
  slug: z.string().min(1),
  verdict: z.string().min(1),
  witness: z.string(),
});

/**
 * Every schema issue as `path: message`, prefixed so a reader knows which document it was.
 *
 * @param error the failed parse
 * @param prefix what the path is relative to
 * @returns one line per issue
 */
function issueLines({ error, prefix }: { error: z.ZodError; prefix: string }): readonly string[] {
  return error.issues.map((issue) => `${[prefix, ...issue.path.map(String)].join(".")}: ${issue.message}`);
}

/**
 * Validate a stored landing read through the section's narrow view.
 *
 * @param value the parsed `github-landing.json`
 * @returns the view, or one line per schema issue
 */
export function parseLandingBriefingDocument({ value }: { readonly value: unknown }): Result<LandingBriefingDocument> {
  const parsed = landingDocumentSchema.safeParse(value);
  if (!parsed.success) {
    return err(issueLines({ error: parsed.error, prefix: "landing" }));
  }
  const rows = parsed.data.rows.map((row): LandingRowView => ({
    action: row.action,
    blockedOn: row.blockedOn,
    boardRowSlug: "slug" in row.boardRow ? row.boardRow.slug : undefined,
    dispatch: row.dispatch,
    headOid: row.headOid,
    latestAskRecipients: row.askTrail.length === 0 ? [] : row.askTrail[0]!.recipients,
    number: row.number,
    queueKind: row.queue.kind,
    repoSlug: row.repoSlug,
    title: row.title,
    url: row.url,
  }));
  const people = Object.fromEntries(Object.entries(parsed.data.people).map(([id, person]) => [id, person.name]));
  const residue = [...new Set([...parsed.data.residue, ...parsed.data.rows.flatMap((row) => row.residue)])];
  const { selection } = parsed.data;
  const census = parsed.data.census.map((repo): LandingCensusView => {
    if (repo.kind === "unread") {
      return repo;
    }
    const pullRequests = repo.pullRequests.map((pr) => ({ author: pr.author, isDraft: pr.isDraft, number: pr.number }));
    return { kind: "read", pullRequests, repo: repo.repo, viewer: repo.viewer };
  });
  return ok({
    census,
    people,
    presses: parsed.data.presses,
    residue,
    rows,
    selection: { author: selection.author, includeDrafts: selection.includeDrafts, repos: selection.repos },
  });
}

/**
 * Validate a stored cycle report through the section's narrow view.
 *
 * @param value the parsed `cycle-reconcile.json`
 * @returns the view, or one line per schema issue
 */
export function parseCycleBriefingDocument({ value }: { readonly value: unknown }): Result<CycleBriefingDocument> {
  const parsed = cycleDocumentSchema.safeParse(value);
  if (!parsed.success) {
    return err(issueLines({ error: parsed.error, prefix: "cycle" }));
  }
  return ok({ couldNotSee: parsed.data.couldNotSee, proposals: parsed.data.proposals });
}

/**
 * Validate every non-blank line of a stored board document; one bad line refuses the whole document, because
 * a board read with a line missing would report the rest as if they were all of it.
 *
 * @param lines the document's non-blank lines, empty for the producer's zero-byte clean pass
 * @returns every candidate in order, or one line per problem naming its 1-based line
 */
export function parseSweepBriefingDocument({
  lines,
}: {
  readonly lines: readonly string[];
}): Result<readonly SweepBriefingCandidate[]> {
  const problems: string[] = [];
  const candidates: SweepBriefingCandidate[] = [];
  lines.forEach((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error: unknown) {
      const why = error instanceof Error ? error.message : String(error);
      problems.push(`line ${String(index + 1)}: not JSON: ${why}`);
      return;
    }
    const parsed = sweepCandidateSchema.safeParse(value);
    if (!parsed.success) {
      issueLines({ error: parsed.error, prefix: `line ${String(index + 1)}` }).forEach((problem) => {
        problems.push(problem);
      });
      return;
    }
    candidates.push(parsed.data);
  });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(candidates);
}
