/**
 * The resilience-residue gate — a ratchet that fails the build if any hand-rolled retry / backoff /
 * rate-limiter is REINTRODUCED after the PR3.5 librafication (D21). Resilience must come from the
 * maintained libraries behind `src/lib/resilience.ts` (p-retry, p-limit, p-throttle) or, for GitHub,
 * octokit's own retry/throttle plugins — never from a bespoke loop.
 *
 * Mirrors the hygiene gate's shape: a PURE {@link scanResilienceContent} (unit-tested with inline
 * fixtures, so this file never scans itself) + an effectful {@link runResilienceResidue} edge that walks
 * the TypeScript sources. The scanner's OWN files are excluded — they necessarily name the very
 * patterns they forbid (the same reason the hygiene denylist lives outside its scanner).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** One residue hit: where it is + which forbidden pattern it matched. */
export interface ResidueHit {
  readonly path: string;
  readonly line: number;
  readonly label: string;
  readonly excerpt: string;
}

interface ResiduePattern {
  readonly label: string;
  readonly re: RegExp;
}

/**
 * The forbidden shapes. Each names a bespoke-resilience reintroduction; the library seams (`p-retry`,
 * `p-limit`, `p-throttle`, `retryTransient`, `createRateScheduler`) and octokit's `@octokit/plugin-retry`
 * do NOT match any of these, so they stay allowed.
 */
const PATTERNS: readonly ResiduePattern[] = [
  // The deleted hand-rolled rate limiter, by its old class name.
  { label: "hand-rolled-rate-limiter", re: /\bRateBucket\b/ },
  // An import of either deleted module (`lib/retry` / `lib/rateBucket`).
  { label: "deleted-resilience-module", re: /lib\/(?:retry|rateBucket)(?:\.js)?/ },
  // A bespoke `retry` function declaration (octokit's is a named IMPORT — `import { retry }` — not a decl).
  { label: "bespoke-retry-decl", re: /\b(?:async\s+)?function retry\b|\bconst retry\s*=/ },
  // Token-bucket wording — the signature of a hand-rolled pacing primitive.
  { label: "token-bucket", re: /token[ -]bucket/i },
];

/**
 * Pure: every forbidden-pattern hit in one file's content, with line numbers. Never throws — a test
 * feeds it inline fixtures so the gate stays falsifiable without touching the filesystem.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each residue hit (empty when clean)
 */
export function scanResilienceContent({ path, content }: { path: string; content: string }): readonly ResidueHit[] {
  const hits: ResidueHit[] = [];
  content.split("\n").forEach((line, index) => {
    for (const { label, re } of PATTERNS) {
      const match = re.exec(line);
      if (match !== null) {
        hits.push({ excerpt: match[0], label, line: index + 1, path });
      }
    }
  });
  return hits;
}

/**
 * This gate's declared scan predicate: any `.ts` file under `src/`, `eval/` or `hooks/`, tests included, not
 * this gate's own source (its text necessarily contains the forbidden words it looks for).
 */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "resilienceResidue" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it; this gate's own sources are excluded, because their text
 *   contains the very patterns they look for
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every in-scope source, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code (0 clean, 1 residue found or not a git checkout)
 */
export function runResilienceResidue(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("resilience-residue: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<ResidueHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanResilienceContent({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "resilience-residue",
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
    process.stdout.write(`resilience-residue: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: [${hit.label}] ${hit.excerpt}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "resilience-residue" }),
      detail: `${String(hits.length)} hand-rolled-resilience hit(s)`,
    })}\n`,
  );
  return 1;
}
