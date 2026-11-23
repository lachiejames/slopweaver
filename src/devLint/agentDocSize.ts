/**
 * The markdown size cap — every tracked markdown file at or under its cap in raw lines
 * ({@link MAX_AGENT_DOC_LINES} for an agent-facing doc, {@link MAX_TRACKED_MARKDOWN_LINES} for every other),
 * with a ratchet that refuses a new offender or an existing one growing.
 *
 * ## Two caps, and why "agent-facing" is where they divide
 *
 * Every agent-facing markdown file is at most about 200 lines, and extra context is imported from or linked to
 * another doc rather than inlined. Progressive disclosure holds everywhere, for token efficiency and agent performance — EVERY tracked `.md` is at most 300
 * lines, its detail moved into linked child pages. One mechanism satisfies both: a short parent keeping the
 * rule, the decision or the topic index, and children loaded on demand (`skills/<verb>/reference/<topic>.md`,
 * `docs/<topic>/<child>.md`). A file over its cap is a file whose detail has not been moved out yet, never a
 * file that needs deleting, and `doc-links` ({@link "./docLinks.js"}) keeps what moved reachable.
 *
 * The tighter cap is what a host loads as INSTRUCTIONS without anyone asking for it: `AGENTS.md`,
 * `CLAUDE.md`, `.claude/rules/**` and the whole of `skills/**` (a `SKILL.md` body and every `reference/` file
 * it links, because a reference is read cold by an agent that has already spent its budget on the body).
 * Everything else — `docs/**`, the readmes, a fixture — is opened on demand and carries the looser one.
 *
 * ## Counts RAW lines — the opposite call to `file-size-ratchet`, and deliberately
 *
 * {@link "./fileSizeRatchet.js"} counts CODE lines because a dense file header costs a reader nothing and a
 * raw-line cap would pay agents to delete the best thing in the file. Markdown inverts that argument
 * exactly: prose IS the payload, so there is no line a cap can price at zero. A blank line and a heading
 * both occupy the context window the ruling is about. Raw lines are also what `wc -l` reports, so a refusal
 * is verifiable in one command with no tool of ours in the loop.
 *
 * ## The baseline is temporary, and its ABSENCE is the strict end state
 *
 * `.baselines/agent-doc-size-baseline.json` names the offenders a descent is still working through, so the
 * gate lands green on the day it is written and refuses regrowth from there. A missing baseline file is read
 * as an EMPTY one rather than an error: once the descent is finished the file is deleted and the gate is a
 * plain cap, and deleting it can only ever make the gate stricter.
 *
 * Pure cores ({@link agentDocLineCount}, {@link isAgentFacingDoc}, {@link docOffendersOf},
 * {@link docRegressionsOf}, {@link parseAgentDocBaseline}) are unit-tested; the thin
 * {@link runAgentDocSize} edge reads the working tree, the baseline and prints.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { type DevLintInputError, DevLintInputErrors } from "./errors.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/** The agent-facing cap, in raw lines. The owner's "about 200", spelled as the one number a gate can check. */
export const MAX_AGENT_DOC_LINES = 200;

/** The cap on every other tracked markdown file, in raw lines. */
export const MAX_TRACKED_MARKDOWN_LINES = 300;

/** The committed floor, repo-relative. Absent means "no offender tolerated". */
const AGENT_DOC_BASELINE_FILE = ".baselines/agent-doc-size-baseline.json";

/** Exact-path agent-facing docs: loaded as project instructions by every session. */
const INSTRUCTION_FILES: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md"]);

/** Agent-facing trees. Everything markdown beneath one of these is in scope. */
const INSTRUCTION_TREES: readonly string[] = [".claude/rules/", "skills/"];

/**
 * Whether a path is an agent-facing markdown doc. Pure — this is where the two caps divide, kept as one
 * readable predicate so the policy is visible at the gate rather than in a config file.
 *
 * @param path the repo-relative path
 * @returns true when the tighter agent-facing cap applies to it
 */
export function isAgentFacingDoc({ path }: { path: string }): boolean {
  if (!path.endsWith(".md")) {
    return false;
  }
  if (INSTRUCTION_FILES.has(path)) {
    return true;
  }
  return INSTRUCTION_TREES.some((tree) => path.startsWith(tree));
}

/**
 * The cap a tracked path carries. Pure — the gate's whole scope boundary: every markdown file has one.
 *
 * @param path the repo-relative path
 * @returns the raw-line cap, or undefined for a path that is not markdown at all
 */
export function markdownDocLimit({ path }: { path: string }): number | undefined {
  if (!path.endsWith(".md")) {
    return undefined;
  }
  if (isAgentFacingDoc({ path })) {
    return MAX_AGENT_DOC_LINES;
  }
  return MAX_TRACKED_MARKDOWN_LINES;
}

/**
 * Count lines the way `wc -l` does, so a refusal is verifiable with one shell command. Pure.
 *
 * @param content the file's text
 * @returns the number of `\n` characters
 */
export function agentDocLineCount({ content }: { content: string }): number {
  let count = 0;
  for (const ch of content) {
    if (ch === "\n") {
      count += 1;
    }
  }
  return count;
}

/**
 * One measured markdown doc, with the cap its path carries.
 *
 * @internal — the exported pure cores below take and return it; nothing outside this gate names the shape.
 */
export interface AgentDocSize {
  readonly path: string;
  readonly lines: number;
  readonly limit: number;
}

/**
 * Every measured doc over its own cap, sorted by path. Pure.
 *
 * @param sizes every measured markdown doc
 * @returns the offenders, in path order
 */
export function docOffendersOf({ sizes }: { sizes: readonly AgentDocSize[] }): readonly AgentDocSize[] {
  return sizes.filter((size) => size.lines > size.limit).toSorted((a, b) => a.path.localeCompare(b.path));
}

/**
 * The committed floor: every doc currently over the cap, by path and line count.
 *
 * @internal — the baseline file's decoded shape, read and written only here.
 */
export interface AgentDocBaseline {
  readonly offenders: readonly { readonly path: string; readonly lines: number }[];
}

// One floor per path: a duplicate would let whichever entry is read last widen the other one.
const agentDocBaselineSchema = z.object({
  offenders: z
    .array(z.object({ lines: z.number().int().nonnegative(), path: z.string().min(1) }))
    .refine((offenders) => new Set(offenders.map((offender) => offender.path)).size === offenders.length),
});

/**
 * Decode a committed baseline file. Pure.
 *
 * @param text the baseline file text
 * @returns the baseline, or an error string
 */
export function parseAgentDocBaseline({ text }: { text: string }): Result<AgentDocBaseline, DevLintInputError> {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return err(
      DevLintInputErrors.baselineMalformed({ detail: parsed.error.message, label: "agent-doc-size baseline" }),
    );
  }
  const decoded = agentDocBaselineSchema.safeParse(parsed.value);
  if (!decoded.success) {
    return err(
      DevLintInputErrors.baselineShapeInvalid({
        expected: "{ offenders: [{ path, lines }] }, one entry per path",
        label: "agent-doc-size baseline",
      }),
    );
  }
  return ok({ offenders: decoded.data.offenders });
}

/**
 * One offender that is new against the baseline, or grew past its floor.
 *
 * @internal — what this gate prints; no caller outside it needs the shape by name.
 */
export interface AgentDocRegression {
  readonly path: string;
  readonly lines: number;
  readonly limit: number;
  readonly baselineLines: number | undefined;
}

/**
 * Every current offender that is NEW (absent from the baseline) or WORSE (more lines than its floor). Pure —
 * the property the gate enforces.
 *
 * @param current every current offender
 * @param baseline the committed floor
 * @returns each regression, in path order (empty when the ratchet holds)
 */
export function docRegressionsOf({
  current,
  baseline,
}: {
  current: readonly AgentDocSize[];
  baseline: AgentDocBaseline;
}): readonly AgentDocRegression[] {
  const floorByPath = new Map(baseline.offenders.map((o) => [o.path, o.lines]));
  const regressions: AgentDocRegression[] = [];
  for (const size of current) {
    const baselineLines = floorByPath.get(size.path);
    if (baselineLines === undefined || size.lines > baselineLines) {
      regressions.push({ baselineLines, limit: size.limit, lines: size.lines, path: size.path });
    }
  }
  return regressions;
}

/**
 * Every regression that already had a baseline entry and got worse — what `--rebaseline` refuses. Pure.
 *
 * @param regressions the full regression list
 * @returns only the entries that had a floor and grew past it
 */
export function docWorseningsOf({
  regressions,
}: {
  regressions: readonly AgentDocRegression[];
}): readonly AgentDocRegression[] {
  return regressions.filter((r) => r.baselineLines !== undefined);
}

/** Read the committed floor. A missing file is an EMPTY baseline, never an error — see the file header. */
function loadAgentDocBaseline({ baselinePath }: { baselinePath: string }): Result<AgentDocBaseline, DevLintInputError> {
  let text: string;
  try {
    text = readFileSync(baselinePath, "utf8");
  } catch {
    return ok({ offenders: [] });
  }
  return parseAgentDocBaseline({ text });
}

/** The `--rebaseline` branch: write the current offender set, or refuse an existing offender's regrowth. */
function applyAgentDocRebaseline({
  baselinePath,
  current,
  regressions,
}: {
  baselinePath: string;
  current: readonly AgentDocSize[];
  regressions: readonly AgentDocRegression[];
}): number {
  const worsenings = docWorseningsOf({ regressions });
  if (worsenings.length > 0) {
    for (const r of worsenings) {
      process.stderr.write(`  ${r.path}: ${String(r.baselineLines)} -> ${String(r.lines)} lines\n`);
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "agent-doc-size-rebaseline" }),
        detail: `${String(worsenings.length)} regression(s)`,
      })}\n`,
    );
    return 1;
  }
  const offenders = current.map((size) => ({ lines: size.lines, path: size.path }));
  writeFileSync(baselinePath, `${JSON.stringify({ offenders }, null, 2)}\n`);
  process.stdout.write(`agent-doc-size: baseline tightened to ${String(offenders.length)} offender(s)\n`);
  return 0;
}

/** The compare branch: pass, or print every new/regrown offender against the committed floor. */
function reportAgentDocRegressions({
  current,
  regressions,
}: {
  current: readonly AgentDocSize[];
  regressions: readonly AgentDocRegression[];
}): number {
  if (regressions.length === 0) {
    process.stdout.write(
      `agent-doc-size: clean (${String(current.length)} baselined offender(s); cap ${String(MAX_AGENT_DOC_LINES)} lines agent-facing, ${String(MAX_TRACKED_MARKDOWN_LINES)} every other .md)\n`,
    );
    return 0;
  }
  for (const r of regressions) {
    const floor = r.baselineLines === undefined ? "new offender" : `floor ${String(r.baselineLines)}`;
    process.stderr.write(`  ${r.path}: ${String(r.lines)} lines, cap ${String(r.limit)} (${floor})\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "agent-doc-size" }),
      detail: `${String(regressions.length)} doc(s) over their cap`,
    })}
`,
  );
  return 1;
}

/**
 * IO edge: measure every tracked markdown doc against the committed baseline, or (`--rebaseline`)
 * tighten the baseline to the current offender set.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard
 *   error)
 */
export function runAgentDocSize(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("agent-doc-size: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const baseline = loadAgentDocBaseline({ baselinePath: join(root, AGENT_DOC_BASELINE_FILE) });
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`agent-doc-size: ${baseline.error.message}\n`);
    return 1;
  }
  const scan = scanTextFiles<AgentDocSize>({
    paths: listing.filter((path) => markdownDocLimit({ path }) !== undefined),
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => [{ limit: markdownDocLimit({ path })!, lines: agentDocLineCount({ content }), path }],
  });
  const complete = reportScanIntegrity({
    label: "agent-doc-size",
    scanned: scan.scanned,
    unreadable: scan.unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete) {
    // devlint: not-a-refusal -- `reportScanIntegrity` has already named what went unread, and this returns
    // BEFORE either branch below: a "clean" line over documents nobody read is a lie, and a floor
    // REBASELINED from them is worse — it would bake the unread ones in at whatever the register last said
    return 1;
  }
  const current = docOffendersOf({ sizes: scan.hits });
  const regressions = docRegressionsOf({ baseline: baseline.value, current });
  if (process.argv.includes("--rebaseline")) {
    return applyAgentDocRebaseline({ baselinePath: join(root, AGENT_DOC_BASELINE_FILE), current, regressions });
  }
  return reportAgentDocRegressions({ current, regressions });
}
