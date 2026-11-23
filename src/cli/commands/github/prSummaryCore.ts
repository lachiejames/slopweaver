/**
 * Pure half of `slopweaver github pr summary`: one pull request read down to what a queue card says about it —
 * its number, title, head branch and state, and its OWN Problem, Risk and Blast radius cells.
 *
 * A card links its pull request and carries the pull request's own text, never boilerplate absence sentences
 * in its problem and stakes rows. A C3 description's cells come out of `parsePrBody`, the reverse of the renderer
 * every Slopweaver description is written by: Problem is its explainer, Risk the top risk item's level and check,
 * Blast radius that item's worst case. A description in the retired reading order is read by the frozen
 * `legacy/parse.ts`, and one in the older table shape by the CI gate's own `tableCell`, so merged history still
 * draws. Any other description, or one whose three cells are not all there, is a `declined` form carrying the
 * reason — the card REFUSES on it rather than drawing a guess.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../../lib/result.js";
import { levelOf, topRiskOf } from "../../../outbound/github/derive.js";
import { parseReadingOrderBody } from "../../../outbound/github/legacy/parse.js";
import { parsePrBody } from "../../../outbound/github/parse.js";
import type { Content } from "../../../outbound/github/types.js";
import { tableCell } from "../../../prformat/checkCore.js";
import { REQUIRED_LEAD_LABELS } from "../../../prformat/leadRows.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

/** Every flag this verb accepts, named ONCE so the spec and the advertised list cannot disagree. */
const FLAG_STEMS: readonly string[] = ["home"];

/** The parse spec, built from the one stem list. */
const PR_SUMMARY_FLAGS: FlagSpec = { boolean: ["json"], string: FLAG_STEMS };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_PR_SUMMARY_FLAG_NAMES: readonly string[] = [...FLAG_STEMS, "json"].map((name) => `--${name}`);

/** The resolved request: one pull-request address, and how to print it. */
export interface GithubPrSummaryArgs {
  readonly url: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse `github pr summary <url> [--json] [--home <dir>]` before touching the network.
 *
 * @param rest argv after `github pr summary`
 * @returns the address and output mode, or every usage problem
 */
export function parseGithubPrSummaryArgs({ rest }: { rest: readonly string[] }): Result<GithubPrSummaryArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PR_SUMMARY_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  if (positionals.length !== 1) {
    return err([`exactly one pull-request address is required; got ${String(positionals.length)}`]);
  }
  const home = values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    url: positionals[0]!,
  });
}

/** Where a pull request stands, in the four words a card needs — GitHub's `OPEN` splits on the draft flag. */
type PrLifecycle = "open" | "draft" | "merged" | "closed";

/** The three cells a card draws, flattened to text with every link's address kept. */
interface PrSummaryCells {
  readonly problem: string;
  readonly risk: string;
  readonly blastRadius: string;
}

/** The description's cells, or why a card cannot draw them. */
type PrSummaryForm =
  ({ readonly kind: "parsed" } & PrSummaryCells) | { readonly kind: "declined"; readonly reason: string };

/** One pull request as a queue card reads it. */
export interface GithubPrSummary {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly headRefName: string;
  /**
   * Whether the head branch lives in ANOTHER repository — a fork. A branch NAME proves nothing across repositories,
   * so a caller matching a pull request to a branch of its own keeps only one whose head is not cross-repository.
   */
  readonly crossRepository: boolean;
  readonly state: PrLifecycle;
  /** When it merged, or `null` when it has not. `null` rather than absent, so the JSON always names the key. */
  readonly mergedAt: string | null;
  /** The provider read's own instant — the moment these fields were true. */
  readonly readAtIso: string;
  readonly form: PrSummaryForm;
}

/** The fields of the read's pull-request node this verb uses; everything else is ignored. */
const PULL_NODE = z.object({
  __typename: z.literal("PullRequest"),
  body: z.string().nullable(),
  headRefName: z.string(),
  isCrossRepository: z.boolean(),
  isDraft: z.boolean(),
  merged: z.boolean(),
  mergedAt: z.string().nullable(),
  number: z.number().int().positive(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  title: z.string(),
  url: z.string(),
});

/**
 * One cell's runs as the text a card draws: markup dropped, `code` kept in backticks, and a link as its words
 * with its address beside them, so the console's own chips can still open it.
 *
 * @returns the text, trimmed
 */
export function flattenContent({ content }: { content: Content }): string {
  const parts = content.map((run) => {
    if (run.kind === "code") {
      return `\`${run.text}\``;
    }
    if (run.kind === "link") {
      if (run.text === run.url) {
        return run.url;
      }
      return `${run.text} (${run.url})`;
    }
    return run.text;
  });
  return parts.join("").replace(/\s+/gu, " ").trim();
}

/**
 * The lifecycle word for a pull request, from GitHub's state and flags.
 *
 * @returns the word
 */
function lifecycleOf({ node }: { node: z.infer<typeof PULL_NODE> }): PrLifecycle {
  if (node.merged || node.state === "MERGED") {
    return "merged";
  }
  if (node.state === "CLOSED") {
    return "closed";
  }
  if (node.isDraft) {
    return "draft";
  }
  return "open";
}

/** The character references the retired renderer escaped, decoded back to the characters a reader saw. */
const CELL_ENTITIES: Readonly<Record<string, string>> = {
  "&#39;": "'",
  "&#96;": "`",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};

/** A link as the card draws it: its words, then its address — once, when the words ARE the address. */
function linkText({ text, url }: { text: string; url: string }): string {
  return text === url ? url : `${text} (${url})`;
}

/**
 * A tag, from a `<` to the next `>`: a `<` inside it is swallowed with it, so `<script <>>` goes whole. An
 * innermost-only `<[^<>]+>` was tried and left that one standing, and changed `p99 < 200ms <br>` too.
 */
const TAG = /<[^>]+>/gu;

/**
 * `html` with every tag replaced, repeated until nothing changes. One pass already leaves no `<…>` run, so the
 * loop never changes the output; it is the fixed point CodeQL's multi-character sanitisation rule asks to see.
 */
function stripTags({ html, replacement }: { html: string; replacement: string }): string {
  let before = html;
  let after = html.replace(TAG, replacement);
  while (after !== before) {
    before = after;
    after = after.replace(TAG, replacement);
  }
  return after;
}

/**
 * One retired table cell's raw HTML or Markdown as the text a card draws, by the same rules as
 * {@link flattenContent}: markup dropped, `code` kept in backticks, a link as its words with its address.
 *
 * @returns the text, trimmed
 */
export function flattenTableCell({ cell }: { cell: string }): string {
  const linked = cell
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/giu, (_whole, url: string, words: string) =>
      linkText({ text: stripTags({ html: words, replacement: "" }), url }),
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (_whole, words: string, url: string) => linkText({ text: words, url }))
    .replace(/<code>([\s\S]*?)<\/code>/giu, "`$1`");
  const text = stripTags({ html: linked, replacement: " " })
    .replace(/\*\*/gu, "")
    .replace(/&(?:#39|#96|amp|gt|lt|quot);/gu, (entity) => CELL_ENTITIES[entity]!);
  return text
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,;:!?)])/gu, "$1")
    .trim();
}

/** The three cells as text, or the reason the description has none to give. */
type CellsRead =
  { readonly kind: "cells"; readonly cells: PrSummaryCells } | { readonly kind: "declined"; readonly reason: string };

/**
 * The three cells of a retired table-shaped description, read exactly where the CI gate reads them.
 *
 * @returns the cells, each empty when its row is missing
 */
function tableCells({ body }: { body: string }): PrSummaryCells {
  const read = ({ label }: { label: string }): string => {
    const cell = tableCell({ body, label });
    return cell === null ? "" : flattenTableCell({ cell });
  };
  return {
    blastRadius: read({ label: REQUIRED_LEAD_LABELS[1]! }),
    problem: read({ label: "Problem" }),
    risk: read({ label: REQUIRED_LEAD_LABELS[0]! }),
  };
}

/**
 * The three cells of a C3 description: Problem is its explainer, Risk the level and check of its top risk item,
 * Blast radius that item's worst case. A C3 body publishes only the top item, through its risk badge's hover.
 *
 * @returns the cells, or undefined when the body is not C3
 */
function c3Cells({ body }: { body: string | undefined }): PrSummaryCells | undefined {
  const parsed = parsePrBody({ body });
  if (parsed.isErr()) {
    return undefined;
  }
  const { explainer, risk } = parsed.value.body;
  const problem = flattenContent({ content: explainer });
  const top = topRiskOf({ items: risk.items });
  if (top.isErr()) {
    return { blastRadius: "", problem, risk: "" };
  }
  const { check, worstKind, worst } = top.value;
  const checked = check.kind === "checked" ? `${check.check}.` : `Not checked: ${check.why}.`;
  const level = levelOf({ worstKind });
  const levelWord = `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
  return { blastRadius: `Worst case ${worst}.`, problem, risk: `${levelWord} risk. ${checked}` };
}

/**
 * The three cells of a description in any shape this card knows: C3, then the retired reading order's own
 * sections, then the retired table's rows. Any other description is declined with the reading-order parser's
 * reason.
 *
 * @returns the cells, or a decline
 */
function cellsOf({ body }: { body: string | undefined }): CellsRead {
  const c3 = c3Cells({ body });
  if (c3 !== undefined) {
    return { cells: c3, kind: "cells" };
  }
  const parsed = parseReadingOrderBody({ body });
  if (parsed.isOk()) {
    const { problem, risk } = parsed.value.body;
    return {
      cells: {
        blastRadius: flattenContent({ content: risk.blastRadius }),
        problem: flattenContent({ content: problem }),
        risk: flattenContent({ content: risk.line }),
      },
      kind: "cells",
    };
  }
  if (parsed.error.code === "RETIRED_SHAPE" && body !== undefined) {
    return { cells: tableCells({ body }), kind: "cells" };
  }
  return { kind: "declined", reason: `its description is not one this card can read: ${parsed.error.message}` };
}

/**
 * The description's three cells, or the reason a card cannot draw them.
 *
 * @returns the parsed cells, or a decline naming what is missing
 */
function formOf({ node }: { node: z.infer<typeof PULL_NODE> }): PrSummaryForm {
  // GitHub answers `null` for an empty description; the parser's word for that is an absent body.
  let body: string | undefined;
  if (node.body !== null) {
    body = node.body;
  }
  const read = cellsOf({ body });
  if (read.kind === "declined") {
    return read;
  }
  const { cells } = read;
  const blank = [
    { label: "Problem", text: cells.problem },
    { label: REQUIRED_LEAD_LABELS[0]!, text: cells.risk },
    { label: REQUIRED_LEAD_LABELS[1]!, text: cells.blastRadius },
  ].filter((cell) => cell.text === "");
  if (blank.length > 0) {
    return {
      kind: "declined",
      reason: `its description has no ${blank.map((cell) => cell.label).join(", ")} to draw`,
    };
  }
  return { kind: "parsed", ...cells };
}

/**
 * Read one `github read` pull-request node down to its summary.
 *
 * @param data the read's `data` — the provider node, raw
 * @param readAtIso the read's own instant
 * @returns the summary, or why the node is not a pull request this verb reads
 */
export function githubPrSummaryOf({ data, readAtIso }: { data: unknown; readAtIso: string }): Result<GithubPrSummary> {
  const node = PULL_NODE.safeParse(data);
  if (!node.success) {
    return err(["the address is not a pull request, or GitHub answered without the fields a summary needs"]);
  }
  return ok({
    crossRepository: node.data.isCrossRepository,
    form: formOf({ node: node.data }),
    headRefName: node.data.headRefName,
    mergedAt: node.data.mergedAt,
    number: node.data.number,
    readAtIso,
    state: lifecycleOf({ node: node.data }),
    title: node.data.title,
    url: node.data.url,
  });
}

/**
 * The summary as the lines a terminal reader wants.
 *
 * @returns the lines
 */
export function renderGithubPrSummaryText({ summary }: { summary: GithubPrSummary }): readonly string[] {
  const lines = [`#${String(summary.number)} ${summary.title}`, `${summary.state} · ${summary.url}`];
  if (summary.form.kind === "declined") {
    return [...lines, `declined: ${summary.form.reason}`];
  }
  return [
    ...lines,
    `problem: ${summary.form.problem}`,
    `risk: ${summary.form.risk}`,
    `blast radius: ${summary.form.blastRadius}`,
  ];
}
