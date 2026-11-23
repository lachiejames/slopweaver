/**
 * Measuring the ALWAYS-ON documentation set — the bytes every agent session pays for before it reads a line
 * of code.
 *
 * ## What this is, and the one thing it deliberately is not
 *
 * It is a tape measure. It counts lines and bytes and reports what is over budget. It never edits a file, and
 * nothing downstream of it edits a file either.
 *
 * That is the whole design constraint. A "keep AGENTS.md under 200 lines" lint has one obvious way to go
 * green — delete paragraphs until the number drops — and a doc that satisfies its own gate by losing content
 * is worse than an oversized one, because the loss is silent and the gate reports success. So the budget is
 * split from the preservation guarantee: this module answers "how big is it", and the moved-headings check
 * answers "did anything vanish". Neither can satisfy the other, which is the point. Cutting to make this
 * module pass while the headings check still passes means the content genuinely moved somewhere linked.
 *
 * ## What counts as always-on
 *
 * Claude Code loads, at launch: the project `AGENTS.md` (read natively — this repository has no `CLAUDE.md`,
 * see {@link alwaysOnEntry}), everything it `@`-imports, and every
 * `.claude/rules/*.md` that carries no `paths:` frontmatter. A rule WITH `paths:` loads only when Claude
 * touches a matching file, so it is not always-on — UNLESS something `@`-imports it, because an import
 * expands unconditionally and overrides the importee's own scoping. `@` imports buy nothing back, so an
 * import is an organisation win and a zero-token win, and {@link alwaysOnPaths} walks them transitively:
 * the set is DISCOVERED from the entry document rather than listed, so no caller can assemble a set that
 * leaves an imported file uncounted.
 *
 * `README.md` is named in backticks in `AGENTS.md`, not imported, so it costs zero and is out of scope.
 *
 * ## Why bytes as well as lines
 *
 * Two different hosts, two different limits. Claude Code's is advisory (a 200-line target; the hard ceiling is
 * 4 MiB and irrelevant here). Codex's is not: it truncates the assembled `AGENTS.md` block MID-WORD at
 * `project_doc_max_bytes`, 32,768 by default, and says nothing. That is a hard external cap on one file rather
 * than a ratchet anyone may raise, so it is expressed here as its own constant.
 */

import { basename, dirname, join, normalize } from "node:path/posix";

/**
 * Codex truncates the assembled `AGENTS.md` block MID-WORD at `project_doc_max_bytes` and reports nothing.
 * 32,768 is the default, and this is the one figure here that is not a ratchet: it belongs to another tool,
 * so no commit in this repository may raise it. Measured with `codex debug prompt-input`
 * (codex-cli 0.145.0), which lost the last 35 lines of a 35,446-byte `AGENTS.md` — the whole PR format.
 *
 * Not exported: {@link docBudgetsFor} is the shared surface both the real-repository test and the merge-time
 * re-measurement call, so the ratchet itself never needs to leave this file.
 */
const CODEX_PROJECT_DOC_MAX_BYTES = 32_768;

/** Anthropic's published target for a single always-loaded instructions file (S1/S3/S6). */
const CLAUDE_MD_LINE_TARGET = 200;

/** A skill body stays in context across turns once loaded, so every line recurs. 500 is the published cap. */
const SKILL_BODY_LINE_CAP = 500;

/**
 * The ratchets, re-measured after the agent-doc size cap took every always-on file to 200 lines or fewer and
 * moved each skill's procedure into its bundled `reference/`.
 *
 * LOWER these as content moves out. Raising one is the owner's call, not an author's, and the message
 * `budgetOverruns` prints says so — the way past this gate is to move a paragraph somewhere linked, which is
 * exactly what the moved-headings check then proves you did.
 *
 * Raised ONCE, on the owner's ruling rather than an author's judgement: the journalled-grant brief is a
 * PATH-UNSCOPED `.claude/rules/` file, loaded as instructions, so that no session can fail to have read it.
 * That is a new always-on cost the owner asked for, 82 lines and 4,991 bytes of it, and the budgets follow the
 * file rather than the file being trimmed to fit a ceiling it predates. Re-measure with
 * `wc -lc AGENTS.md .claude/rules/*.md` after any move out.
 *
 * **The set-wide figures are a correction rather than a raise.** Both callers once
 * assembled the set as the literal list `["CLAUDE.md", "AGENTS.md", ...unscoped]` and never followed
 * `AGENTS.md`'s own `@` imports, so the three code-standards rules it expands into every session (then path-scoped)
 * were counted by nobody: 422 lines and 31,848 bytes measured against 995 and 72,109 actually received.
 * {@link alwaysOnPaths} now discovers the set, so these two numbers went UP because the subject got bigger,
 * not because a ceiling was relaxed — and a line added to `typescript-patterns.md`, `testing.md` or
 * `error-handling.md` stops being free. Re-measure with
 * `wc -lc AGENTS.md .claude/rules/typescript-patterns.md .claude/rules/testing.md
 * .claude/rules/error-handling.md .claude/rules/cross-session-messages.md .claude/rules/journalled-grants.md`.
 *
 * **The byte figure to fear is NOT this one.** Codex expands no `@` import, so what it receives is
 * `AGENTS.md` alone — 15,040 bytes — and that file has its own budget against
 * {@link CODEX_PROJECT_DOC_MAX_BYTES}, the one cap here that belongs to another tool. The set-wide byte
 * ratchet below names NO documented target at all, because there is no published byte figure a Claude
 * session's whole context is supposed to meet — a ratchet is exactly what it is.
 *
 * Shared by the real-repository test (`alwaysOnDocsBudget.test.ts`) and the merge-time re-measurement
 * (`../outbound/github/docsBudgetSweep.ts`) via {@link docBudgetsFor}, so the two ceilings can never drift
 * apart.
 */
const ALWAYS_ON_LINE_BUDGET = 969;
const ALWAYS_ON_BYTE_BUDGET = 71_170;

/** How far under its budget a measurement may sit before the budget itself must be lowered. */
export const LINE_SLACK = 25;
export const BYTE_SLACK = 2_500;

/**
 * The rules that load into EVERY session because they carry no `paths:`.
 *
 * Listed rather than counted, and checked both ways: an unscoped rule missing from this list is a new
 * unconditional cost nobody decided to pay, and a name here that has since been scoped is a stale entry. The
 * list can shrink, never grow silently.
 *
 * `cross-session-messages.md` is here on purpose — it governs every inbound message from another session, not
 * a file type, so there is no path that could scope it. `journalled-grants.md` is here for the sharper
 * version of the same reason: the failure it closes is a session refusing a mechanism it has never heard of,
 * so a scoping that could leave a session without it would BE the defect.
 *
 * The three code-standards rules are here because `AGENTS.md` already `@`-imports them into every session,
 * so a `paths:` on them bought nothing and cost a SECOND copy: Claude Code re-attaches a scoped rule as nested
 * memory whenever a session reads a matching file, import or no import, while an unscoped rule that is also
 * imported loads once. MEASURED over one week: each of the three re-attached about 446 times
 * across the fleet's main transcripts, 36.6 MB of duplicate context. Repro: count the `"nested_memory"`
 * attachment records by `attachment.path` across that week's transcripts under `~/.claude/projects`.
 */
export const UNSCOPED_RULES: readonly string[] = [
  ".claude/rules/cross-session-messages.md",
  ".claude/rules/error-handling.md",
  ".claude/rules/journalled-grants.md",
  ".claude/rules/testing.md",
  ".claude/rules/typescript-patterns.md",
];

/** A file split into its YAML frontmatter lines and the body beneath them. */
export interface SplitDoc {
  /** The lines BETWEEN the `---` fences, empty when the file has no frontmatter. */
  readonly frontMatter: readonly string[];
  /** Everything after the closing fence — the whole file when there is no frontmatter. */
  readonly body: string;
}

/** The size of one document, in the two units the two hosts each care about. */
export interface DocSize {
  readonly lines: number;
  readonly bytes: number;
}

/** One measured thing, the ceiling it must stay under, and the published figure it is heading for. */
export interface DocBudget {
  /** What is being measured, as it should read in a failure message. */
  readonly label: string;
  readonly measured: number;
  /** The ratchet: today's agreed ceiling. Lower it as content moves; raising it is the owner's call. */
  readonly budget: number;
  /**
   * The documented figure this is working towards — context in the message, never itself enforced. ABSENT
   * where no published figure applies: the always-on set's BYTE total is a pure repo ratchet, and naming
   * Codex's 32,768 cap there would present an external limit the set has never had to meet (Codex expands
   * no `@` import, so what it receives is `AGENTS.md` alone, which carries that cap as its own budget).
   */
  readonly target?: number;
  /** `lines` or `bytes`, for the message. */
  readonly unit: string;
}

/**
 * Split a markdown file into its frontmatter lines and its body.
 *
 * Line-wise rather than by regex on purpose: a lazy `[\s\S]*?` between two fences is the exact shape the
 * ReDoS gate exists to reject, and scanning for the closing fence needs no backtracking at all.
 *
 * A file whose first line is not `---`, or whose fence is never closed, has NO frontmatter — its whole text is
 * body. Treating an unclosed fence as frontmatter would swallow the document.
 *
 * @param content the file's full text
 * @returns the frontmatter lines and the body text
 */
export function splitFrontMatter({ content }: { content: string }): SplitDoc {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    return { body: content, frontMatter: [] };
  }
  const close = lines.indexOf("---", 1);
  if (close === -1) {
    return { body: content, frontMatter: [] };
  }
  return { body: lines.slice(close + 1).join("\n"), frontMatter: lines.slice(1, close) };
}

/**
 * Whether a rule file is scoped to paths, and so is NOT loaded into every session.
 *
 * The test is the presence of a top-level `paths:` key in the frontmatter, which is what Claude Code keys on.
 * An indented `paths:` is a nested key belonging to something else and does not scope the rule — the same
 * class of mistake as a `Triggers:` line indented under a description, which read fine and did nothing.
 *
 * @param content the rule file's full text
 * @returns true when the rule loads only for matching files
 */
export function isPathScoped({ content }: { content: string }): boolean {
  return splitFrontMatter({ content }).frontMatter.some((line) => /^paths\s*:/.test(line));
}

/**
 * Measure one document the way `wc -l` and `wc -c` do, so a number here can be checked from a shell.
 *
 * @param content the file's full text
 * @returns its line and byte counts
 */
export function measureDoc({ content }: { content: string }): DocSize {
  const bytes = Buffer.byteLength(content, "utf8");
  if (content.length === 0) {
    return { bytes, lines: 0 };
  }
  const trailingNewline = content.endsWith("\n") ? 1 : 0;
  return { bytes, lines: content.split("\n").length - trailingNewline };
}

/**
 * Add up the sizes of every always-on document.
 *
 * @param sizes each in-scope document's measurement
 * @returns the summed lines and bytes
 */
export function totalSize({ sizes }: { sizes: readonly DocSize[] }): DocSize {
  return sizes.reduce<DocSize>(
    (running, size) => ({ bytes: running.bytes + size.bytes, lines: running.lines + size.lines }),
    { bytes: 0, lines: 0 },
  );
}

/**
 * Every budget the measurement has blown, phrased so the failure itself carries the numbers.
 *
 * A gate that fails with `expected false to be true` sends the reader back to the source to find out what it
 * measured. Each string here states the measurement, the ceiling, the overshoot and the published target, so
 * the assertion output IS the report.
 *
 * @param budgets each measured figure with its ceiling and target
 * @returns one line per overrun, in the order given; empty when everything fits
 */
export function budgetOverruns({ budgets }: { budgets: readonly DocBudget[] }): readonly string[] {
  return budgets
    .filter((entry) => entry.measured > entry.budget)
    .map(
      (entry) =>
        `${entry.label}: ${entry.measured} ${entry.unit} — ${entry.measured - entry.budget} over its ` +
        `budget of ${entry.budget}${entry.target === undefined ? "" : ` (documented target ${entry.target})`}. ` +
        `Move content out to a linked doc or a skill; do not raise the budget.`,
    );
}

/**
 * Every budget that has drifted far enough BELOW its measurement to have stopped ratcheting.
 *
 * Without this a budget only ever has to be set once. Content moves out, the number falls, and the ceiling
 * stays where it was — so the gate silently re-permits every line that just left. Requiring the ceiling to
 * follow the measurement down is what keeps a win from being spent again.
 *
 * The slack is generous by design: an ordinary edit that adds a sentence must not force a ratchet commit.
 *
 * @param budgets each measured figure with its ceiling and target
 * @param slack how far under its budget a measurement may sit before the budget must be lowered
 * @returns one line per stale budget, in the order given; empty when every ceiling is tight
 */
export function staleBudgets({ budgets, slack }: { budgets: readonly DocBudget[]; slack: number }): readonly string[] {
  return budgets
    .filter((entry) => entry.budget - entry.measured > slack)
    .map(
      (entry) =>
        `${entry.label}: ${entry.measured} ${entry.unit} against a budget of ${entry.budget} — ` +
        `${entry.budget - entry.measured} of slack, more than the ${slack} allowed. Lower the budget to ` +
        `${entry.measured} so the saving cannot be spent again.`,
    );
}

/** A fence line: the character it is built from, its run length, and whether it carries an info string. */
interface FenceLine {
  readonly char: string;
  readonly length: number;
  /** True when nothing follows the run — CommonMark allows an info string on an OPENING fence only. */
  readonly bare: boolean;
}

/**
 * The fence a line opens or could close, or `undefined` when the line is not a fence line at all.
 *
 * @param line the raw line
 * @returns the fence character, its run length, and whether the line is bare
 */
function fenceOf({ line }: { line: string }): FenceLine | undefined {
  const trimmed = line.trim();
  const run = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
  if (run === undefined) {
    return undefined;
  }
  return { bare: trimmed.length === run.length, char: run.slice(0, 1), length: run.length };
}

/**
 * Whether `fence` closes `open`. CommonMark's rule, and it is not pedantry here: a four-backtick fence
 * demonstrating a three-backtick one is exactly how this repository documents its own `@` import mechanism,
 * and a naive toggle would read the inner fence as a close and the example inside it as a real import.
 *
 * @param open the fence currently held open
 * @param fence the candidate closing fence
 * @returns true when the candidate is the same character and at least as long
 */
function closesFence({ open, fence }: { open: FenceLine; fence: FenceLine }): boolean {
  return fence.bare && fence.char === open.char && fence.length >= open.length;
}

/**
 * One line with every backtick-delimited code span blanked out.
 *
 * Delimiter runs are matched BY LENGTH, per CommonMark: `` `@param x.md` `` and ``` `` @param x.md `` ```
 * are both code spans, and blanking each backtick independently would leave the second one's contents
 * exposed as prose. A run with no equal-length partner later on the line opens nothing and is left alone.
 *
 * **Known limit, stated rather than left to be rediscovered: a code span spanning a NEWLINE is not seen.**
 * This works line by line, so ``Example: `` / ``@x.md`` / ``` ` ``` reads the middle line as prose. Four
 * Codex review rounds walked this lexer down to that case and it appears nowhere in this repository's canon;
 * the direction it errs is the safe one, because an over-count FAILS the budget loudly and names the path,
 * where the undercount this whole change fixes reported clean for months. Close it by lexing the whole
 * document rather than each line, if a real one ever appears.
 *
 * @param line the raw line
 * @returns the line with each code span replaced by a single space
 */
function blankCodeSpans({ line }: { line: string }): string {
  const runs = [...line.matchAll(/`+/g)].map((match) => ({ index: match.index, length: match[0].length }));
  const spans: { readonly start: number; readonly end: number }[] = [];
  let open: { readonly index: number; readonly length: number } | undefined;
  for (const run of runs) {
    if (open === undefined) {
      open = run;
      continue;
    }
    if (run.length === open.length) {
      spans.push({ end: run.index + run.length, start: open.index });
      open = undefined;
    }
  }
  let blanked = line;
  for (const span of spans.toReversed()) {
    blanked = `${blanked.slice(0, span.start)} ${blanked.slice(span.end)}`;
  }
  return blanked;
}

/**
 * A document's lines with fenced blocks dropped and inline code spans blanked — what is left is prose, where
 * an `@` reference is an import rather than an example of one.
 *
 * @param content the document's full text
 * @returns one entry per prose line, in order
 */
function proseLinesOf({ content }: { content: string }): readonly string[] {
  const lines: string[] = [];
  let open: FenceLine | undefined;
  for (const line of content.split("\n")) {
    const fence = fenceOf({ line });
    if (open !== undefined) {
      open = fence !== undefined && closesFence({ fence, open }) ? undefined : open;
      continue;
    }
    if (fence !== undefined) {
      open = fence;
      continue;
    }
    lines.push(blankCodeSpans({ line }));
  }
  return lines;
}

/**
 * One `@` specifier as a repo-relative path, or `undefined` when it names nothing this measure can read.
 *
 * @param specifier the text directly after the `@`, trailing sentence punctuation included
 * @param from the importing document's own repo-relative path
 * @returns the normalised repo-relative path, or `undefined` for a handle, or anything outside the checkout
 */
function resolvedImportOf({ specifier, from }: { specifier: string; from: string }): string | undefined {
  const trimmed = specifier.replace(/[.,;:!?)\]]+$/, "");
  if (trimmed.startsWith("~") || trimmed.startsWith("/")) {
    return undefined;
  }
  const resolved = normalize(join(dirname(from), trimmed));
  if (!basename(resolved).includes(".") || resolved.startsWith("..")) {
    return undefined;
  }
  return resolved;
}

/**
 * The repo-relative paths a document `@`-imports, in the order they appear. Pure.
 *
 * **An import is honoured ANYWHERE outside code, not only on its own line.** Claude Code expands a `@path`
 * reference wherever it appears in prose, and reading only whole lines would silently drop one — the exact
 * class of undercount this module exists to end. So the criterion is a `@` at the start of a line or after
 * whitespace (which excludes an email address), followed by a path whose last segment carries a file
 * extension, with trailing sentence punctuation stripped.
 *
 * Three exclusions, each for a measured reason:
 *
 * - **Fenced blocks and inline code spans are skipped.** `AGENTS.md` and the rules document their own
 *   mechanism, so a fenced example or a backticked `@param` is prose ABOUT an import rather than one.
 * - **The last segment must carry an extension.** A bare `@acme-bot` is a handle, not a file; without this
 *   it would be returned, found unreadable, and reported as a dangling import.
 * - **Nothing outside the checkout** (`@~/notes.md`, `@/etc/x.md`, `@../up.md`) — nothing outside the
 *   repository can be measured, and returning one would name a path no reader can open.
 *
 * @param content the importing document's full text
 * @param from the importing document's own repo-relative path, which relative specifiers resolve against
 * @returns each imported document's repo-relative path, in declaration order, duplicates included
 */
export function importedPathsOf({ content, from }: { content: string; from: string }): readonly string[] {
  const imported: string[] = [];
  for (const line of proseLinesOf({ content })) {
    for (const match of line.matchAll(/(?:^|\s)@(\S+)/g)) {
      const specifier = match[1];
      const resolved = specifier === undefined ? undefined : resolvedImportOf({ from, specifier });
      if (resolved !== undefined) {
        imported.push(resolved);
      }
    }
  }
  return imported;
}

/**
 * The project instructions file Claude Code loads first, resolved the way its default does
 * (`claude-md-or-agents-md`, v2.1.277+): a `CLAUDE.md` at the root or inside the `.claude` directory wins,
 * and `AGENTS.md` is read natively only when neither exists. Pure — existence is the caller's injected seam.
 * The second candidate is built with `join` because it is a path probed for, never a document this
 * repository holds, and the `doc-links` gate reads a spelled-out repo-rooted markdown path as a link.
 *
 * Derived rather than named because the merge-time sweep measures whichever repository it merges in, and a
 * `CLAUDE.md` there that does not import `AGENTS.md` means the host never reads `AGENTS.md` at all —
 * {@link alwaysOnPaths} walking from the resolved entry reproduces exactly that. Source:
 * https://code.claude.com/docs/en/memory § AGENTS.md.
 *
 * @param exists whether a repo-relative path is present in the tree being measured
 * @returns the repo-relative entry document to hand {@link alwaysOnPaths}
 */
export function alwaysOnEntry({ exists }: { exists: (args: { path: string }) => boolean }): string {
  for (const path of ["CLAUDE.md", join(".claude", "CLAUDE.md")]) {
    if (exists({ path })) {
      return path;
    }
  }
  return "AGENTS.md";
}

/**
 * Every document a session is handed at launch: the entry, everything it `@`-imports transitively, and the
 * rules that carry no `paths:` frontmatter. Pure — reading is the caller's injected seam.
 *
 * **Following the second hop is the whole point.** Claude Code expands an `@` import unconditionally, so it
 * IGNORES the importee's own `paths:` scoping: a path-scoped rule that `AGENTS.md` imports reaches every
 * session anyway. Assembling this set as a literal list — which both callers once did — left
 * the three imported code-standards rules counted by nobody, and the gate measured a model of the doc set
 * rather than the doc set (995 lines actually received against 422 measured, `docs/doctrine-rationale/always-on.md`
 * § "The always-on set").
 *
 * A path whose content cannot be read is still RETURNED, and simply not descended into. A dangling `@`
 * import is a defect, and a caller that reads off disk should fail on it rather than quietly measure a set
 * with a hole in it.
 *
 * @param entry the document the host loads first, from {@link alwaysOnEntry} — `AGENTS.md` in this repository
 * @param readDoc reads one repo-relative path, returning `undefined` when it is absent or unreadable
 * @param unscopedRules every rule file that carries no `paths:`, so loads unconditionally without an import
 * @returns each always-on path exactly once: the entry, its imports depth-first in declaration order, then
 *   any unscoped rule an import did not already reach
 */
export function alwaysOnPaths({
  entry,
  readDoc,
  unscopedRules,
}: {
  entry: string;
  readDoc: (args: { path: string }) => string | undefined;
  unscopedRules: readonly string[];
}): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const visit = ({ path }: { path: string }): void => {
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    ordered.push(path);
    const content = readDoc({ path });
    if (content === undefined) {
      return;
    }
    for (const next of importedPathsOf({ content, from: path })) {
      visit({ path: next });
    }
  };
  visit({ path: entry });
  for (const rule of unscopedRules) {
    visit({ path: rule });
  }
  return ordered;
}

/** One already-read document: its repo-relative path and its full text. */
export interface ReadDoc {
  readonly path: string;
  readonly content: string;
}

/**
 * Every {@link DocBudget} to check — the always-on total (lines and bytes), `AGENTS.md` against Codex's own
 * hard cap, and each skill body against its recurring-cost cap — from already-read content.
 *
 * Takes content rather than reading it so the same assembly serves two different readers: the real-repository
 * test reads off disk, and `../outbound/github/docsBudgetSweep.js` reads the same paths AS OF THE TREE A
 * SQUASH-MERGE WOULD PRODUCE (`git show <merged-tree>:<path>`) — see that module's header for why the
 * distinction is the whole point. Neither caller may compute its own ceilings; both call this.
 *
 * @param alwaysOn every always-on document (`AGENTS.md`, its imports, every unscoped rule), in the order to sum
 * @param skills every skill's `SKILL.md`, checked individually against its own body cap
 * @returns every budget to hand `budgetOverruns`/`staleBudgets`
 */
export function docBudgetsFor({
  alwaysOn,
  skills,
}: {
  alwaysOn: readonly ReadDoc[];
  skills: readonly ReadDoc[];
}): readonly DocBudget[] {
  const total = totalSize({ sizes: alwaysOn.map((doc) => measureDoc({ content: doc.content })) });
  const budgets: DocBudget[] = [
    {
      budget: ALWAYS_ON_LINE_BUDGET,
      label: `the always-on set (${alwaysOn.map((doc) => doc.path).join(", ")})`,
      measured: total.lines,
      target: CLAUDE_MD_LINE_TARGET,
      unit: "lines",
    },
    {
      budget: ALWAYS_ON_BYTE_BUDGET,
      label: "the always-on set",
      measured: total.bytes,
      unit: "bytes",
    },
  ];
  const agents = alwaysOn.find((doc) => doc.path === "AGENTS.md");
  if (agents !== undefined) {
    budgets.push({
      budget: CODEX_PROJECT_DOC_MAX_BYTES,
      label: "AGENTS.md, against the cap Codex truncates at mid-word",
      measured: measureDoc({ content: agents.content }).bytes,
      target: CODEX_PROJECT_DOC_MAX_BYTES,
      unit: "bytes",
    });
  }
  for (const skill of skills) {
    budgets.push({
      budget: SKILL_BODY_LINE_CAP,
      label: `${skill.path} body`,
      measured: measureDoc({ content: splitFrontMatter({ content: skill.content }).body }).lines,
      target: SKILL_BODY_LINE_CAP,
      unit: "lines",
    });
  }
  return budgets;
}
