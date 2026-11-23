/**
 * The operation-LABEL gate (PR5.2.1b) — the fourth rate-limit ratchet, and the one that makes a silent
 * 75-second hang impossible to reintroduce.
 *
 * `endpointClassFor` falls back to the provider's TIGHTEST class when a label is absent from
 * {@link ../lib/rateLimits.OPERATION_ENDPOINT_CLASS}. For Slack that fallback is `tier1`, whose derated rate
 * is 0.01333/s — `createRateScheduler` turns that into a **75,000ms interval**. So an unmapped Slack label
 * is not a mild mis-classification: the first time its class is ever paced, that call path becomes one
 * request every 75 seconds, which presents as a network stall rather than as a configuration mistake.
 *
 * Today only `slack:chat-post` and `slack:tier3` are paced, so the trap is armed but not sprung. That is
 * precisely why it needs a gate rather than a comment — the change that springs it (widening
 * `PACED_CLASSES`) is one line, in a different file, and would look completely safe in review.
 *
 * Two rules, both structural:
 *
 *  1. Every `operation:` label passed to a `safe*Call` must have an EXACT entry in the registry map.
 *  2. A label must be a static string literal. A template literal (`` `slack.auth.test.write.${lane}` ``)
 *     cannot be checked against a map by any static gate, so it is refused outright rather than waved
 *     through — the one that used to exist is now two literals.
 *
 * It also polices the two escape hatches, because a hatch nobody counts spreads: `blockWait: false` is legal
 * only in {@link BLOCK_WAIT_EXEMPT}, and `paced: false` only in {@link PACING_EXEMPT}.
 *
 * Mirrors the other gates: a PURE {@link scanOperationLabels} over file content (unit-tested with inline
 * fixtures, so this file never scans itself) plus an effectful entry that walks the sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATION_ENDPOINT_CLASS } from "../lib/rateLimits.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/**
 * The files permitted to skip the shared 429 block.
 *
 * One entry, and it should stay that way. A `connect --check` preflight is the only call in the program
 * whose whole value is answering fast about a token BEFORE anything trusts it; everything else is ingest,
 * and ingest queueing behind a rate limit is the entire point of having a shared block.
 */
export const BLOCK_WAIT_EXEMPT: ReadonlySet<string> = new Set(["src/connect/probes.ts"]);

/**
 * The files permitted to opt OUT of the endpoint-class throttle.
 *
 * Only the two Slack READ seams. Their class (`tier3`) is shared with the write lane that IS paced, and the
 * same operation label is used by both lanes, so nothing coarser than a per-call-site flag can express
 * "pace the writes, leave the crawl alone". Any third file appearing here means someone is quietly
 * unthrottling a lane, which is exactly the drift this gate exists to make visible.
 */
export const PACING_EXEMPT: ReadonlySet<string> = new Set([
  "src/corpus/slack/api.ts",
  "src/corpus/slack/structures.ts",
]);

/** One label finding. */
export interface LabelHit {
  readonly path: string;
  readonly line: number;
  readonly reason: "unmapped-label" | "dynamic-label" | "unsanctioned-block-skip" | "unsanctioned-pacing-skip";
  readonly excerpt: string;
}

/** A `safe*Call` opener, so a bare `operation:` on some unrelated object is not scanned. */
const SAFE_CALL = /\bsafe(?:ApiCall|ProviderCall)\s*\(\s*\{/;

/** A static-literal operation label. */
const STATIC_LABEL = /^\s*operation:\s*"([^"]+)"\s*,\s*$/;

/** A template-literal operation label — refused: no static gate can resolve it against the map. */
const DYNAMIC_LABEL = /^\s*operation:\s*`/;

/** The preflight escape hatch. */
const BLOCK_SKIP = /^\s*blockWait:\s*false\s*,\s*$/;

/** The read-lane throttle escape hatch. */
const PACING_SKIP = /^\s*paced:\s*false\s*,\s*$/;

/**
 * Pure: every label violation in one file's content.
 *
 * A label is only checked when a `safe*Call` opener is in effect, tracked by brace depth from the opener —
 * that keeps an `operation:` belonging to some other object (a retry policy, a log line) out of scope.
 *
 * @param path the file's repo-relative path
 * @param content the file's text
 * @param mapped the operation labels the registry knows (injected, so the test is not a copy of the map)
 * @returns each hit (empty when clean)
 */
export function scanOperationLabels({
  path,
  content,
  mapped,
}: {
  path: string;
  content: string;
  mapped: ReadonlySet<string>;
}): readonly LabelHit[] {
  const hits: LabelHit[] = [];
  const lines = content.split("\n");
  let openAt = -1;
  lines.forEach((line, index) => {
    if (SAFE_CALL.test(line)) {
      openAt = index;
    }
    // A `safe*Call` argument object is short by construction (one raw call plus its labels), so a fixed
    // lookahead is enough and avoids a brace-matching parser that string/comment noise could fool.
    const inCall = openAt >= 0 && index - openAt <= 24;
    if (!inCall) {
      return;
    }
    if (DYNAMIC_LABEL.test(line)) {
      hits.push({ excerpt: line.trim(), line: index + 1, path, reason: "dynamic-label" });
      return;
    }
    const stat = STATIC_LABEL.exec(line);
    if (stat !== null && !mapped.has(stat[1]!)) {
      hits.push({ excerpt: stat[1]!, line: index + 1, path, reason: "unmapped-label" });
    }
    if (BLOCK_SKIP.test(line) && !BLOCK_WAIT_EXEMPT.has(path)) {
      hits.push({ excerpt: line.trim(), line: index + 1, path, reason: "unsanctioned-block-skip" });
    }
    if (PACING_SKIP.test(line) && !PACING_EXEMPT.has(path)) {
      hits.push({ excerpt: line.trim(), line: index + 1, path, reason: "unsanctioned-pacing-skip" });
    }
  });
  return hits;
}

/**
 * The operator-facing explanation for one hit.
 *
 * @param hit the finding
 * @returns the line to print
 */
export function labelMessage({ hit }: { hit: LabelHit }): string {
  switch (hit.reason) {
    case "unmapped-label":
      return (
        `${hit.path}:${String(hit.line)}: operation "${hit.excerpt}" is absent from OPERATION_ENDPOINT_CLASS ` +
        "(src/lib/rateLimits.ts). It would fall back to the provider's TIGHTEST class — for Slack that is " +
        "tier1, a 75-SECOND interval once that class is paced. Add an explicit entry"
      );
    case "dynamic-label":
      return (
        `${hit.path}:${String(hit.line)}: the operation label is a template literal, which no static gate can ` +
        "check against OPERATION_ENDPOINT_CLASS. Use one static string literal per branch instead"
      );
    case "unsanctioned-block-skip":
      return (
        `${hit.path}:${String(hit.line)}: \`blockWait: false\` skips the shared 429 block, but this file is not ` +
        "in BLOCK_WAIT_EXEMPT. That exemption exists for the connect preflight alone — ingest must queue"
      );
    case "unsanctioned-pacing-skip":
      return (
        `${hit.path}:${String(hit.line)}: \`paced: false\` opts out of the endpoint-class throttle, but this file ` +
        "is not in PACING_EXEMPT. Only the Slack READ seams may, because their tier is shared with the paced " +
        "write lane"
      );
  }
}

/**
 * This gate's declared scan predicate: a non-test `.ts` file under `src/`, `eval/` or `hooks/`, not this
 * gate's own source (its text necessarily names the forbidden shapes it looks for).
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  selfFiles: gateSelfFiles({ stem: "operationLabels" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it; tests and this gate's own sources are excluded, because their
 *   text contains the very patterns they look for
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every in-scope source, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code
 */
export function runOperationLabels(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("operation-labels: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const mapped = new Set(Object.keys(OPERATION_ENDPOINT_CLASS));
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<LabelHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanOperationLabels({ content, mapped, path }),
  });
  const complete = reportScanIntegrity({
    label: "operation-labels",
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
    process.stdout.write(`operation-labels: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${labelMessage({ hit })}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "operation-labels" }),
      detail: `${String(hits.length)} label problem(s)`,
    })}\n`,
  );
  return 1;
}
