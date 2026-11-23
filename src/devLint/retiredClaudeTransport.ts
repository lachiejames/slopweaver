/**
 * The retired-claude-transport gate — refuses a CURRENT config, script or source claim of a `src/llm` path
 * or a live Claude subprocess/transport, the exact defect class code-quality round 2 item 1 found: five
 * sites (a live `door-coverage` allowlist entry keyed on a deleted file, a comparator naming it, and three
 * lane descriptions claiming the integration lane "spawns" or "drives" a real `claude` transport) survived
 * `src/llm/claudeCli.ts` being deleted by the no-headless-model refactor, because nothing checked that
 * prose against the doctrine it was supposed to describe. AGENTS.md rule 2 is a total ban on a Slopweaver
 * process starting a model; a comment that still describes the banned capability as live does not merely
 * misinform, it invites an agent to rebuild what doctrine removed.
 *
 * Two forbidden shapes, one shared exemption:
 *   - **src-llm-path**: the literal path fragment `src/llm`, which has not existed since the refactor above.
 *   - **claude-transport-claim**: `claude` and `transport`/`subprocess` within one line of each other — the
 *     shape every real hit above actually had, so a same-line window is enough without a multi-line parse.
 *
 * A line carrying an explicit historical marker (`removed`, `used to`, `now forbidden`, `historically`,
 * `retired`, …) is exempt from BOTH shapes, because a true statement about the past is not a live claim:
 * `src/__tests__/setup-polly.ts`'s "historically for a local gateway a spawned transport was pointed at"
 * is the model this gate is built to leave alone.
 *
 * Deliberately narrower than a full audit: it does not flag a bare "claude" mention with no nearby
 * transport/subprocess word (`src/codex/client.ts`'s "visible `claude` session `cmux spawn` opens", or
 * `src/cli/manifests/turn.ts`'s "Slack or run a model"), and it does not scan
 * Markdown — `docs/integration-coverage.md`'s frozen coverage measurement is already ratcheted by
 * `staleReferences.test.ts` with its own "frozen point-in-time report" reasoning, and re-litigating that
 * here would just be a second gate disagreeing with the first about the same file. Tests and fixtures are
 * excluded for the same reason `noHeadless.ts` excludes them: a fixture path or an illustrative example
 * value is not a claim about this repository's live architecture.
 *
 * Mirrors the other gates' shape: a PURE {@link scanRetiredClaudeTransport} over one file's content
 * (unit-tested with inline fixtures, so this file never scans itself) plus an effectful
 * {@link runRetiredClaudeTransport} edge that walks the sources.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/**
 * Which forbidden shape a hit matched.
 * @internal
 */
export type RetiredTransportLabel = "src-llm-path" | "claude-transport-claim";

/**
 * One hit: where it is, which shape it matched, and the offending text.
 * @internal
 */
export interface RetiredTransportHit {
  readonly path: string;
  readonly line: number;
  readonly label: RetiredTransportLabel;
  readonly excerpt: string;
}

/** The literal, now-nonexistent path fragment. */
const SRC_LLM_PATTERN = /\bsrc\/llm\b/;

/** `claude` and `transport`/`subprocess` within 60 characters of each other, on one line, either order. */
const CLAUDE_TRANSPORT_PATTERN =
  /\bclaude\b.{0,60}\b(?:transport|subprocess)\b|\b(?:transport|subprocess)\b.{0,60}\bclaude\b/i;

/** A line carrying one of these is describing the PAST, not making a live claim — exempt from both shapes. */
const HISTORICAL_DISCLAIMER =
  /\b(?:removed|no longer exists?|does not exist|now forbidden|used to|historically|retired|was removed)\b/i;

/**
 * Every retired-claude-transport hit in one file's content. Pure — a test feeds it inline fixtures, so the
 * gate stays falsifiable without touching the filesystem.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each hit, in line order (empty when clean)
 */
export function scanRetiredClaudeTransport({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly RetiredTransportHit[] {
  const hits: RetiredTransportHit[] = [];
  content.split("\n").forEach((line, index) => {
    if (HISTORICAL_DISCLAIMER.test(line)) {
      return;
    }
    const srcLlmMatch = SRC_LLM_PATTERN.exec(line);
    if (srcLlmMatch !== null) {
      hits.push({ excerpt: srcLlmMatch[0], label: "src-llm-path", line: index + 1, path });
    }
    const transportMatch = CLAUDE_TRANSPORT_PATTERN.exec(line);
    if (transportMatch !== null) {
      hits.push({ excerpt: transportMatch[0].trim(), label: "claude-transport-claim", line: index + 1, path });
    }
  });
  return hits;
}

/** This gate's own files — excluded from the walk, since its text necessarily names the forbidden shapes. */
const SELF_FILES: ReadonlySet<string> = new Set([
  "retiredClaudeTransport.ts",
  "retiredClaudeTransport.entry.ts",
  "retiredClaudeTransport.test.ts",
]);

/** Where the vitest lane configs live (`config/vitest/base.ts`, `unit.ts`, `integration.ts`, `subprocess.ts`). */
const VITEST_CONFIG_DIR = "config/vitest/";

/**
 * Whether a repo-relative path is in scope: a production `.ts` under `src/`, a `.sh` under `scripts/`, or a
 * vitest lane config under `config/vitest/`. Tests, fixtures and this gate's own files are excluded
 * everywhere — a fixture path or an illustrative example is not a claim about this repository's live
 * architecture.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  if (SELF_FILES.has(basename(path))) {
    return false;
  }
  if (path.endsWith(".test.ts")) {
    return false;
  }
  if (path.includes("/fixtures/") || path.startsWith("fixtures/")) {
    return false;
  }
  if (path.startsWith("src/") && path.endsWith(".ts")) {
    return true;
  }
  if (path.startsWith("scripts/") && path.endsWith(".sh")) {
    return true;
  }
  return path.startsWith(VITEST_CONFIG_DIR) && path.endsWith(".ts");
}

/**
 * IO edge: scan every in-scope file, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code
 */
export function runRetiredClaudeTransport(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRoot();
    files = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("retired-claude-transport: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const scanned = files.filter((path) => isScannablePath({ path }));
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<RetiredTransportHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanRetiredClaudeTransport({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "retired-claude-transport",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(`retired-claude-transport: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: [${hit.label}] ${hit.excerpt}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "retired-claude-transport" }),
      detail: `${String(hits.length)} hit(s)`,
    })}\n`,
  );
  return 1;
}
