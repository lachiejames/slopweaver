/**
 * The single-spelling production query sweep — catches a skill or doc telling a session to run a
 * `slopweaver datadog` command scoped to ONE of production's two env spellings.
 *
 * ## The defect this exists for
 *
 * This organisation's Datadog has two live spellings of production: every backend emits `env:production`,
 * and NZ's three browser apps emit `env:prod` (the gotchas page records it). A query on either
 * alone silently drops the other half, as a smaller healthy-looking number rather than an error. The daily
 * organisation hunt's telemetry lens said `env:production status:error`, and so missed 316 NZ error spans
 * over 14 days: `slopweaver datadog apm 'env:prod status:error' --from 14d --by service`.
 *
 * Nothing in the code was wrong — `src/datadog/prodEnvFilter.ts` has rendered both spellings since it was
 * written. The wrong query lived in a skill reference, which a session reads as instructions and nothing
 * checked. So the guard reads the docs.
 *
 * ## What counts
 *
 * An inline code span, or one line of a code block, that runs `slopweaver datadog` (behind an env prefix or a
 * prompt too) and names `env:prod` or `env:production` without naming the other. A dated measurement quoting
 * the exact command it was measured with is a legitimate single-spelling span — rewriting it would falsify the
 * recorded number — and the caller holds those as an exact allowlist, never a pattern a future instruction
 * could also match.
 *
 * The doc is RENDERED (CommonMark plus GFM, the way GitHub draws it) and the drawn `<code>` elements read,
 * never the source scanned: a hand-written reader here chased CommonMark one construct at a time — a fence
 * closed without a blank line, a shorter run inside a longer fence, a multi-backtick span, a list-indented
 * fence, a line-start triple-backtick span — across five review rounds, the turn
 * `src/devLint/docLinksRead.ts` took before it.
 *
 * ## What it closes, and what it does not
 *
 * It is a HEURISTIC over the shell a doc writes: commands chained by `;`, `&&`, `||` or `|`, with single
 * quotes, double quotes and backslash escapes kept intact so a separator inside a quoted query never splits
 * it. It does not unescape or expand: a spelling hidden behind a backslash inside the word
 * (`env:pro\duction`), a variable, command substitution or a heredoc is read as written and missed. Each of
 * those has to be constructed on purpose, and no file under `skills/` or `docs/` writes one; a review of the
 * diff is what catches a deliberate one. Closing them would take a real shell parser, which a docs guard has
 * not earned.
 *
 * Pure: the caller reads the files.
 */

import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { parse } from "parse5";
import { childrenOf, isElement, type Node } from "../prformat/drawnNodes.js";

/** One single-spelling production query a doc tells a session to run. */
export interface ProdEnvQueryHit {
  readonly path: string;
  /** The command exactly as the span reads, its line endings drawn as spaces. */
  readonly command: string;
  /** The text of the block the span sits in, or the code-block line itself — what a dated measurement is told by. */
  readonly context: string;
}

/** One `slopweaver datadog` code span and whether it scopes on both production spellings. */
export interface DatadogCommandSpan {
  readonly command: string;
  /** The text of the block the span sits in, or the code-block line itself. */
  readonly context: string;
  /** Every production spelling the span names, in first-seen order. */
  readonly spellings: readonly string[];
}

/** The two spellings production goes by in this organisation's telemetry. */
const PROD_SPELLINGS: ReadonlySet<string> = new Set(["prod", "production"]);

/**
 * One shell token: a single-quoted string, a double-quoted one honouring backslash escapes, an escaped
 * character, a separator, or a run of anything else. Each quote's close is optional so an unterminated one
 * runs to the end of the text rather than leaving characters unmatched.
 */
const SHELL_TOKEN = /'[^']*'?|"(?:\\[\s\S]|[^"\\])*"?|\\[\s\S]?|&&|\|\||[;|]|[^'"\\;|&]+|&/g;

/** The shell operators that end one command and start the next. */
const SHELL_SEPARATORS: ReadonlySet<string> = new Set([";", "|", "&&", "||"]);

/** One `env:` clause: a bare value (`env:prod-uk`) or a parenthesised OR list (`env:(prod OR production)`). */
const ENV_CLAUSE = /\benv:(\([^)]*\)|[\w.-]+)/g;

/** The drawn blocks whose text is a span's context: the paragraph, list item, cell or heading it sits in. */
const CONTEXT_BLOCKS = new Set(["p", "li", "td", "th", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Every letter drawn under one node, in order.
 *
 * @param node the rendered node to read
 * @returns its text, entities already decoded by the parser
 */
function textOf({ node }: { node: Node }): string {
  if (node.nodeName === "#text" && "value" in node) {
    return node.value;
  }
  return childrenOf({ node })
    .map((child) => textOf({ node: child }))
    .join("");
}

/**
 * Walk the rendered doc, collecting each inline `<code>` with its block's text, and each line of a `<pre>`'s code.
 *
 * @param node the node to walk
 * @param context the text of the nearest enclosing block, carried down to the spans under it
 * @param into where candidates are appended, in document order
 */
function collectCode({
  node,
  context,
  into,
}: {
  node: Node;
  context: string;
  into: { text: string; context: string }[];
}): void {
  if (isElement(node) && node.tagName === "pre") {
    for (const line of textOf({ node }).split("\n")) {
      into.push({ context: line.trim(), text: line });
    }
    return;
  }
  if (isElement(node) && node.tagName === "code") {
    // A wrapped span draws its line ending as a space but keeps the continuation's indentation: collapse both.
    into.push({ context, text: textOf({ node }).replaceAll(/\s+/g, " ") });
    return;
  }
  let inner = context;
  if (isElement(node) && CONTEXT_BLOCKS.has(node.tagName)) {
    inner = textOf({ node }).replaceAll(/\s+/g, " ").trim();
  }
  for (const child of childrenOf({ node })) {
    collectCode({ context: inner, into, node: child });
  }
}

/**
 * Every candidate command in one doc: each inline code span and each code-block line, as GitHub draws them.
 *
 * @param content the doc's text
 * @returns the candidates with their block text or line, in the order the doc writes them
 */
function candidateCommands({ content }: { content: string }): readonly { text: string; context: string }[] {
  const html = micromark(content, {
    allowDangerousHtml: true,
    extensions: [gfm(), { disable: { null: ["strikethrough"] } }],
    htmlExtensions: [gfmHtml()],
  });
  const candidates: { text: string; context: string }[] = [];
  collectCode({ context: "", into: candidates, node: parse(html, { scriptingEnabled: false }) });
  return candidates;
}

/**
 * One code span or line split into the shell commands it chains with `;`, `&&`, `||` or `|`, outside quotes —
 * so `a 'env:prod'; b 'env:production'` is two single-spelling commands, never one naming both.
 *
 * @param text one code span's text or code-block line
 * @returns each command, trimmed, in order
 */
function shellCommands({ text }: { text: string }): readonly string[] {
  const commands: string[] = [];
  let current = "";
  for (const [token] of text.matchAll(SHELL_TOKEN)) {
    if (SHELL_SEPARATORS.has(token)) {
      commands.push(current.trim());
      current = "";
      continue;
    }
    current += token;
  }
  commands.push(current.trim());
  return commands.filter((command) => command !== "");
}

/**
 * Every env value one command's `env:` clauses name, each OR list split into its members.
 *
 * `(env:prod OR env:production)` — the metrics tag-scope form — is two bare clauses and reads as both
 * values; `env:(prod OR production)` is one parenthesised clause and reads the same.
 *
 * @param command one code span's text
 * @returns the values, in the order the command names them
 */
function envValues({ command }: { command: string }): readonly string[] {
  const values: string[] = [];
  for (const clause of command.matchAll(ENV_CLAUSE)) {
    const raw = clause[1]!; // the one capture group ENV_CLAUSE declares
    const members = raw.startsWith("(") ? raw.slice(1, -1).split(/\s+OR\s+/) : [raw];
    for (const member of members) {
      values.push(member.trim().replace(/^env:/, ""));
    }
  }
  return values;
}

/**
 * Every `slopweaver datadog` code span in one doc that names a production spelling, with the spellings it
 * names.
 *
 * @param content the doc's text
 * @returns the spans, in the order the doc writes them
 */
export function datadogProdCommandSpans({ content }: { content: string }): readonly DatadogCommandSpan[] {
  // Rendering is the expensive step, and a code span's text is its source text (no entity or escape is
  // decoded inside code), so a doc whose source never says `datadog` and `env:` cannot hold a hit.
  if (!content.includes("datadog") || !content.includes("env:")) {
    return [];
  }
  const spans: DatadogCommandSpan[] = [];
  const commands = candidateCommands({ content }).flatMap(({ text, context }) =>
    shellCommands({ text }).map((command) => ({ command, context })),
  );
  for (const { command, context } of commands) {
    // Anywhere, not only at the start: `DD_SITE=… slopweaver datadog …` and `$ slopweaver datadog …` run it too.
    if (!/\bslopweaver\s+datadog\s/.test(command)) {
      continue;
    }
    const spellings: string[] = [];
    for (const value of envValues({ command })) {
      if (PROD_SPELLINGS.has(value) && !spellings.includes(value)) {
        spellings.push(value);
      }
    }
    if (spellings.length > 0) {
      spans.push({ command, context, spellings });
    }
  }
  return spans;
}

/**
 * Every span in one doc that scopes on one production spelling without the other.
 *
 * @param path the doc's repo-relative path, carried onto each hit
 * @param content the doc's text
 * @returns the hits, in the order the doc writes them
 */
export function singleSpellingProdQueries({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly ProdEnvQueryHit[] {
  return datadogProdCommandSpans({ content })
    .filter((span) => span.spellings.length === 1)
    .map((span) => ({ command: span.command, context: span.context, path }));
}
