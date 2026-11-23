/**
 * THE OWNER'S list, projected out of `slopweaver session-start --json` into the briefing form's own section.
 *
 * The owner wants one place to look, and the answer is ONE VIEW over the existing registers rather than one
 * merged register. `session-start` is the OWNER'S action queue across the team surfaces; the handover board is the FLEET's queue. Merging the two registers would conflate
 * two actors' queues, so the briefing carries a projection of the first and stays the page that shows the
 * second — and a projection only stays honest while nothing composes it.
 *
 * ## `background` opens the row's fold rather than sitting above it
 *
 * `../sessionStart/item.ts` makes `background` MANDATORY — what the thing IS, for a reader
 * holding no context — because the first four fields all describe STATE or ACTION and a row could satisfy
 * every check and still be unanswerable. The terminal list prints it inline; a terminal has no fold. This
 * page does, and rule 7 caps what a reader cannot avoid, so two or three sentences per row would spend the
 * whole page's above-the-fold budget on ten of them. So it opens the fold, first block, one click away.
 *
 * Whether it belongs ABOVE the fold on THIS surface is not settled here, and pretending otherwise would be
 * the drift the one-index ruling is about: the session-start run's own recorded question asks exactly that,
 * A against B, and the owner has answered it for the terminal and not yet for the page. It is read as
 * optional for the same reason — a document written before that field existed still projects.
 *
 * ## So this file maps, and never writes
 *
 * Every field of a row comes from the verb. The one thing that is not a straight copy is the headline, and
 * even that is `../sessionStart/render.ts`'s own `headline` rather than a second shortening rule — the
 * terminal list and this page cut a row's first line at the same place, at a word boundary, never with an
 * ellipsis, and the whole recorded question goes in the row's fold either way — in the shape it was recorded
 * in, each prose line its own paragraph and its `- ` and `1. ` lines real lists (`recordedTextBlocks`).
 * The terminal has no list to give it, so it keeps printing the question as one line.
 *
 * ## Bare references resolve against the ROW, and the page finishes the job
 *
 * A recorded question carries `owner/repo#<number>` (which resolves on its own), a bare `#<number>` (which needs to know
 * which repository) or a `SUP-123` (which needs a workspace). This builds each row's context out of that row's
 * own permalink, so an explicit reference and a pull-request row's own repository both link here. What is
 * left is judged exactly as every other cell on the page is: `./bareRef.ts` reads the whole
 * rendered page's links as one context and refuses a reference that still cannot resolve against them. That
 * split is deliberate — a projection cannot know what else the sweep will put on the page, and guessing a
 * repository would produce a link to the wrong pull request, which is worse than a refusal naming the row.
 *
 * A row's `repo` is deliberately never rendered and only read when it is an `owner/repo` slug: the board leg
 * fills it with the local checkout PATH of the doc's repository, and a path under a home directory is exactly
 * what the hygiene gate exists to keep off an outbound surface.
 *
 * Pure — no I/O, no clock. The caller reads the document; this only ever sees it as parsed JSON.
 *
 * ## Why it sits here rather than beside the form it fills
 *
 * Same reason `./images.ts` does: both prepare form INPUT before `../outbound/briefing/schema.ts` ever sees
 * it, and neither is an outbound payload. That distinction is load-bearing — the `outbound-form-strict` gate
 * requires every schema under `src/outbound/` to refuse a key nobody declared, and this one deliberately
 * reads a SLICE of a document that carries much more (leg counts, movements, limits). A strict form here
 * would refuse the verb's own real output, and a later version widening that output would break the page.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import type { Organisation } from "../organisation/core.js";
import type {
  BriefingBlock,
  BriefingContent,
  BriefingFold,
  BriefingInline,
  BriefingYourList,
  BriefingYourRow,
} from "../outbound/briefing/types.js";
import { type BareRefContext, type RepoRef, resolveBareRef, scanBareRefs } from "../outbound/linkify/bareRefs.js";
import { isLocalPageUrl } from "../pages/url.js";
import { headline as shortHeadline } from "../sessionStart/render.js";
import { repoSlugFor } from "../sessionStart/staleRefs.js";
import { type BriefingError, BriefingErrors } from "./errors.js";

/**
 * The slice of `session-start --json` this projection reads.
 *
 * Deliberately a slice rather than the whole document: the verb reports leg counts, movements and limits this
 * page does not show, and a schema that demanded them would refuse a document a later version widened. What
 * IS demanded is every field a row needs to be actionable, which is the same four `../../sessionStart/item.ts`
 * makes mandatory plus the ranking's own explanation.
 */
const sessionStartDocument = z.object({
  // Optional: a document written before the run took a `--deadline` carries none, and is a whole list.
  cutShort: z.array(z.string().min(1)).optional(),
  // The page states the list's age from it, so a value a clock cannot read is refused here rather than at the form.
  nowIso: z
    .string()
    .min(1)
    .max(40)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "must be an ISO-8601 timestamp a clock can parse, as in `2026-09-25T10:49:08Z`",
    }),
  ranking: z.object({
    ranked: z.array(
      z.object({
        item: z.object({
          background: z.string().min(1).optional(),
          // Passed through as read: `../outbound/briefing/yourListSchema.ts` is the strict check on its shape.
          codeOwnerSlice: z
            .object({
              additions: z.number(),
              deletions: z.number(),
              omittedPaths: z.number(),
              ownedFiles: z.number(),
              shownPaths: z.array(z.string()),
              totalFiles: z.number(),
            })
            .optional(),
          doneWhen: z.string().min(1),
          nativeId: z.string().min(1),
          repo: z.string().min(1).optional(),
          source: z.string().min(1),
          title: z.string().min(1).optional(),
          whenIso: z.string().min(1),
          where: z.string().min(1),
          who: z.string().min(1),
        }),
        score: z.number(),
        trace: z.object({ verdict: z.string().min(1) }),
        why: z.string().min(1),
      }),
    ),
  }),
});

/** An `owner/repo` slug, which is the only shape of `repo` this projection will read. */
const REPO_SLUG = /^(?<owner>[A-Za-z0-9][A-Za-z0-9._-]*)\/(?<repo>[A-Za-z0-9][A-Za-z0-9._-]*)$/;

/** A GitHub permalink, for the repository a pull-request row's own bare `#<number>` belongs to. */
const GITHUB_PERMALINK = /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)\//;

/** A Linear permalink, for the workspace and team key a `SUP-123` in the same row belongs to. */
const LINEAR_PERMALINK = /^https:\/\/linear\.app\/(?<slug>[^/]+)\/issue\/(?<key>[A-Z]{2,6})-\d{1,6}/;

/** The verdict the ranking gives a row whose action is to close something rather than to do it. */
const PROPOSE_CLOSE = "propose-close";

/**
 * What one row's own references resolve against: its repository, and its Linear workspace when it has one.
 *
 * @internal — the per-row context {@link linkifyRowText} uses; no caller outside this module names it.
 * @param where the row's permalink or command
 * @param repoSlug the `owner/repo` the row's own `repo` field names, already resolved by `repoSlugFor` against the
 *   organisation — absent when the row names none, or names a checkout no organisation repository matches
 * @returns the context this row's bare references resolve against
 */
export function rowRefContext({ where, repoSlug }: { where: string; repoSlug: string | undefined }): BareRefContext {
  const repos: RepoRef[] = [];
  const slug = repoSlug === undefined ? null : REPO_SLUG.exec(repoSlug);
  if (slug?.groups?.["owner"] !== undefined && slug.groups["repo"] !== undefined) {
    repos.push({ owner: slug.groups["owner"], repo: slug.groups["repo"] });
  }
  const permalink = GITHUB_PERMALINK.exec(where);
  if (permalink?.groups?.["owner"] !== undefined && permalink.groups["repo"] !== undefined) {
    repos.push({ owner: permalink.groups["owner"], repo: permalink.groups["repo"] });
  }
  const linear = LINEAR_PERMALINK.exec(where);
  const slugName = linear?.groups?.["slug"];
  const teamKey = linear?.groups?.["key"];
  return {
    linearTeamKeys: teamKey === undefined ? [] : [teamKey],
    ...(slugName === undefined ? {} : { linearWorkspaceSlug: slugName }),
    repos,
  };
}

/**
 * One piece of a row's recorded text as briefing runs, with every reference this row can resolve promoted to
 * a link.
 *
 * Byte-identical to a single text run when the text carries no reference at all, which is what keeps an
 * ordinary row's headline exactly the words the terminal list prints.
 *
 * @param text the row's own recorded words
 * @param context what this row knows about where its references point
 * @returns the runs, in order
 */
export function linkifyRowText({ text, context }: { text: string; context: BareRefContext }): BriefingContent {
  const runs: BriefingInline[] = [];
  let cursor = 0;
  const keep = ({ end }: { end: number }): void => {
    const slice = text.slice(cursor, end);
    if (slice.length > 0) {
      runs.push({ kind: "text", text: slice });
    }
  };
  for (const span of scanBareRefs({ context, text })) {
    const resolved = resolveBareRef({ context, span });
    if (resolved === undefined) {
      continue;
    }
    keep({ end: span.start });
    runs.push({ kind: "link", text: resolved.label, url: resolved.url });
    cursor = span.end;
  }
  keep({ end: text.length });
  return runs.length === 0 ? [{ kind: "text", text }] : runs;
}

/** The one-word reply vocabulary a row is answered with, spelled as the lock-in verb takes it. */
const LOCK_IN_REPLIES = "do | hand-off | defer | skip | note";

/** The row's whole recorded question, whitespace-collapsed the way the headline reads it. */
function collapsed({ text }: { text: string }): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A dash item, `- step` or `* step`, as `handover ask` records one. */
const DASH_ITEM = /^\s*[-*]\s+(?<item>\S.*)$/;

/** A numbered item, `1. step` or `1) step`. A date or `1 task` carries no stop after the number, so stays prose. */
const NUMBERED_ITEM = /^\s*(?<number>\d{1,2})[.)]\s+(?<item>\S.*)$/;

/**
 * Every Unicode line terminator, the set `../handover/askExamples.ts` already spells: `collapsed`'s `\s`
 * would otherwise turn one into a space and weld the two lines either side of it. CRLF is matched first so it stays ONE break, since a blank line closes an open list. Spelled
 * by property class so the source carries no raw separator.
 */
const LINE_BREAK = /\r\n|[\n\v\f\r\x85\p{Zl}\p{Zp}]/u;

/** A run of list lines still open while the recorded question is read. */
interface OpenList {
  readonly ordered: boolean;
  readonly items: BriefingContent[];
}

/**
 * One line of a recorded question, read as a list item of either kind, or undefined for prose.
 *
 * A numbered line is an item only where an `<ol>` would print the very number it was recorded with: `1` opens
 * a list and each next one continues it. Any other (`42.`, a skipped `3.`, a repeated `1.`) stays a verbatim
 * paragraph, because a renumbered step says something its author never wrote.
 */
function listItem({
  line,
  open,
}: {
  line: string;
  open: OpenList | undefined;
}): { ordered: boolean; item: string } | undefined {
  const numbered = NUMBERED_ITEM.exec(line)?.groups;
  if (numbered?.["item"] !== undefined) {
    const next = open?.ordered === true ? open.items.length + 1 : 1;
    // The digits as recorded, so `01.` (which an `<ol>` prints as `1.`) stays prose too.
    return numbered["number"] === String(next) ? { item: numbered["item"], ordered: true } : undefined;
  }
  const dash = DASH_ITEM.exec(line)?.groups?.["item"];
  return dash === undefined ? undefined : { item: dash, ordered: false };
}

/**
 * A recorded question as the blocks it was written in: each prose line its own `para`, and each run of `- `
 * or `1. ` lines a real list.
 *
 * `handover ask` records a question with its line breaks, and one whitespace-collapsed paragraph welded its
 * numbered steps into "1. x 2. y 3. z" — which `./pageBudget.ts`'s packed-enumeration rule then refused for
 * the WHOLE page, folded or not, so the supervisor's tick could not publish until the ask was settled. The
 * writer and the check agree on one shape: a list.
 *
 * No two recorded lines are ever joined, because a join is a weld: "Do 1. alpha" and "Then 2. beta" are one
 * number each, and one paragraph holding both is the shape the rule refuses. So every block carries exactly
 * the numbers its own source line did, and a blank line or a prose line closes an open list.
 *
 * @param text the row's own recorded words, line breaks intact
 * @param context what this row knows about where its references point
 * @returns the blocks, in order; none for blank text
 */
export function recordedTextBlocks({ text, context }: { text: string; context: BareRefContext }): BriefingBlock[] {
  const blocks: BriefingBlock[] = [];
  let list: OpenList | undefined;
  for (const line of text.split(LINE_BREAK)) {
    const item = listItem({ line, open: list });
    if (item === undefined) {
      list = undefined;
      if (line.trim().length > 0) {
        blocks.push({ content: linkifyRowText({ context, text: collapsed({ text: line }) }), kind: "para" });
      }
    } else {
      if (list?.ordered !== item.ordered) {
        list = { items: [], ordered: item.ordered };
        blocks.push({ items: list.items, kind: "list", ordered: list.ordered });
      }
      list.items.push(linkifyRowText({ context, text: collapsed({ text: item.item }) }));
    }
  }
  return blocks;
}

/**
 * One row's fold: who asked, where it lives, the whole recorded question when the headline shortened it, and
 * the command that records the owner's one-word answer.
 *
 * The affordance is a `code` run carrying the real invocation rather than prose describing it, because the
 * point of putting the owner's list on this page is that they can answer a row without leaving it — and a
 * command they have to reconstruct from a sentence is one they will not run.
 */
function rowFold({
  who,
  whenIso,
  why,
  score,
  where,
  link,
  identity,
  full,
  short,
  background,
  context,
}: {
  who: string;
  whenIso: string;
  why: string;
  score: number;
  where: string;
  link: boolean;
  identity: string;
  full: string;
  short: string;
  background: string | undefined;
  context: BareRefContext;
}): BriefingFold {
  const whereRun: BriefingInline = link ? { kind: "link", text: where, url: where } : { kind: "code", text: where };
  const command = `slopweaver session-start lock-in --item ${identity} --against ${whenIso} --reply <${LOCK_IN_REPLIES}> --proposed "…"`;
  return {
    blocks: [
      ...(background === undefined
        ? []
        : [{ content: linkifyRowText({ context, text: background }), kind: "para" as const }]),
      {
        content: [{ kind: "text", text: `${who} · last moved ${whenIso} · ${why} (score ${String(score)})` }],
        kind: "para",
      },
      { content: [{ kind: "text", text: "where: " }, whereRun], kind: "para" },
      ...(short === collapsed({ text: full }) ? [] : recordedTextBlocks({ context, text: full })),
      {
        content: [
          { kind: "text", text: "answer it with " },
          { kind: "code", text: command },
        ],
        kind: "para",
      },
    ],
    summary: "who asked, where it lives, and how to answer it",
  };
}

/**
 * Whether a row's `where` is a link the page may follow, rather than a command it must show as code.
 *
 * A local page counts (`../pages/url.ts`). That is where a page the owner has to react to lives, so a test
 * for `http` alone would render the one address the fleet produces as inert text the owner has to select and
 * copy — the exact complaint linkification exists to prevent, reintroduced through a predicate nobody thought
 * of as being about links.
 */
function isUrl({ where }: { where: string }): boolean {
  return where.startsWith("https://") || where.startsWith("http://") || isLocalPageUrl({ url: where });
}

/**
 * One ranked entry of a session-start document as a row of the owner's list.
 *
 * @param entry the ranked entry, as the document schema parsed it
 * @param rank its 1-based place in the list
 * @param organisation the organisation whose repositories a checkout path is named against
 * @returns the row
 */
function yourRow({
  entry,
  organisation,
  rank,
}: {
  entry: z.infer<typeof sessionStartDocument>["ranking"]["ranked"][number];
  organisation: Organisation;
  rank: number;
}): BriefingYourRow {
  const { item } = entry;
  const context = rowRefContext({ repoSlug: repoSlugFor({ organisation, repoPath: item.repo }), where: item.where });
  const short = shortHeadline({ doneWhen: item.doneWhen });
  const identity = `${item.source}:${item.nativeId}`;
  const link = isUrl({ where: item.where });
  return {
    closing: entry.trace.verdict === PROPOSE_CLOSE,
    detail: rowFold({
      background: item.background,
      context,
      full: item.doneWhen,
      identity,
      link,
      score: entry.score,
      short,
      whenIso: item.whenIso,
      where: item.where,
      who: item.who,
      why: entry.why,
    }),
    headline: linkifyRowText({ context, text: short }),
    identity,
    link,
    rank,
    score: entry.score,
    ...(item.codeOwnerSlice === undefined ? {} : { codeOwnerSlice: item.codeOwnerSlice }),
    ...(item.title === undefined ? {} : { title: item.title }),
    whenIso: item.whenIso,
    where: item.where,
    who: item.who,
    why: entry.why,
  };
}

/** One indented line per schema issue, each naming the path it sits at. */
function issueLines({ error }: { error: z.ZodError }): readonly string[] {
  return error.issues.map((issue) => {
    const where = issue.path.join(".");
    return `  ${where === "" ? "document" : where}: ${issue.message}`;
  });
}

/**
 * Why a parsed value is not a `session-start --json` document this page can read — the same check
 * {@link projectYourList} applies, so a writer can refuse a document the page would refuse, before replacing a good one.
 *
 * @param document the parsed `slopweaver session-start --json` output
 * @returns one line per issue, empty when the document reads
 */
export function sessionStartDocumentIssues({ document }: { document: unknown }): readonly string[] {
  const parsed = sessionStartDocument.safeParse(document);
  if (parsed.success) {
    return [];
  }
  return issueLines({ error: parsed.error });
}

/**
 * Project one `session-start --json` document into the owner's list, showing at most `top` rows.
 *
 * @param document the parsed `slopweaver session-start --json` output
 * @param top the most rows to show; the rest are counted rather than dropped silently
 * @param invocation how the document was produced, stated on the page so a reader can reproduce it
 * @param organisation the organisation, read once by the verb's edge, whose repositories name a row's checkout
 * @returns the section, or one line per reason the document could not be read as a session-start run
 */
export function projectYourList({
  document,
  top,
  invocation,
  organisation,
}: {
  document: unknown;
  top: number;
  invocation: string;
  organisation: Organisation;
}): Result<BriefingYourList, BriefingError> {
  const parsed = sessionStartDocument.safeParse(document);
  if (!parsed.success) {
    return err(BriefingErrors.sessionStartDocumentInvalid({ issues: issueLines({ error: parsed.error }) }));
  }
  const ranked = parsed.data.ranking.ranked;
  const rows = ranked.slice(0, top).map((entry, index) => yourRow({ entry, organisation, rank: index + 1 }));
  const { cutShort } = parsed.data;
  return ok({
    ...(cutShort === undefined || cutShort.length === 0 ? {} : { cutShort }),
    notShown: Math.max(0, ranked.length - rows.length),
    readIso: parsed.data.nowIso,
    rows,
    source: `${invocation}, read at ${parsed.data.nowIso}`,
  });
}
