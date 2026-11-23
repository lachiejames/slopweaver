/**
 * The gate that keeps every verb's DATA output on the one stdout channel that cannot be truncated.
 *
 * ## The criterion
 *
 * A `process.stdout.write` in a non-test `.ts` under `src/cli/` fails. That tree is the verb
 * surface — the only place a `--json` document is handed to a caller's pipe — so the criterion needs no
 * allowlist and has no exemption marker: `logger.out` is the channel, and a verb has no second reason to
 * reach the descriptor itself.
 *
 * ## Why a gate rather than a per-verb fix
 *
 * `process.stdout.write` is ASYNCHRONOUS when stdout is a pipe: it fills the 64 KiB pipe buffer, queues the
 * rest, and a process that exits before the queue drains loses it — silently, with exit code 0. `main.ts`'s
 * `runCliProcess` ends with `process.exit`, so every verb writing that way was exposed. It now drains both
 * streams first (`src/lib/drainStdio.ts`), which rescues a module a verb CALLS from outside this tree; this
 * gate still holds the verb surface to `logger.out`, because a drain that waits on a paused reader is the
 * backstop and a synchronous write that never queued is the channel.
 *
 * MEASURED, and reproducible in one command:
 *
 * ```bash
 * node -e 'process.stdout.write(JSON.stringify({blob:"x".repeat(300000)})+"\n");process.exit(0)' | wc -c
 * #  65536   — a 300,012-byte document, cut off mid-string; `jq` reports `Unfinished string at EOF`
 * ```
 *
 * The first real run of `atlas cloudflare read --kind access-application --json` cut off the same way. A
 * truncated document that still parses as far as it goes is the worst failure available here, because a
 * consumer reads it as a COMPLETE answer.
 *
 * HOW MUCH is lost is the kernel's business and not a constant: the command above loses 65,536 bytes on this
 * developer machine and 146,176 on the larger runner. Only the SHAPE is portable — the survivor is a strict,
 * non-empty prefix — which is why the subprocess test asserts that rather than a number.
 *
 * `logger.out` already solves this — `src/lib/logger.ts`'s `writeAllSync` loops a blocking `writeSync` over
 * partial writes and waits out `EAGAIN` — and the same 300,012-byte document emits intact through it. So the
 * fix was never a flush: it was routing the 24 runners that had grown their own
 * `out: (line) => process.stdout.write(...)` dependency seam onto the channel that was already correct. A
 * per-verb flush seam fixes the verb that noticed; this fixes the class, and stops the twenty-fifth seam.
 *
 * Mixing the two channels in one process is its own defect the routing removes: a synchronous `writeSync`
 * on the descriptor jumps ahead of anything `process.stdout.write` has queued, so interleaved output can
 * come back REORDERED.
 *
 * ## The one blind spot, named rather than discovered
 *
 * `src/lib/progress.ts` writes short progress lines straight to stdout and is outside this tree. That is
 * deliberate: its module header declares a HARD non-blocking constraint (a long `refresh` must never stall
 * on a paused reader), which `logger.out`'s blocking loop would break. Its lines are a few hundred bytes,
 * far below the pipe buffer, so the truncation class does not reach it — but a verb that ever grows a large
 * progress payload would be invisible here.
 *
 * Pure {@link scanStdoutDataChannel} + an effectful {@link runStdoutDataChannel} edge, matching the other
 * gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { gateSelfFiles, repoRoot, type ScanScope, isScannablePath as scopeIsScannablePath } from "./scanScope.js";

/** Any direct reach for the stdout stream or its descriptor from a verb. */
const DIRECT_STDOUT = /process\.stdout\.write/;

/**
 * One offending line.
 *
 * @internal — {@link scanStdoutDataChannel}'s own return shape; {@link runStdoutDataChannel} prints it.
 */
export interface StdoutDataChannelHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * The shared scan mechanics this gate sits on; narrowed to `src/cli/` by {@link isScannablePath}.
 */
const SCOPE: ScanScope = {
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "stdoutDataChannel" }),
  trees: ["src/"],
};

/**
 * Whether a repo-relative path is in scope: a non-test `.ts` under the verb surface.
 *
 * The `src/cli/` narrowing is spelled here rather than in {@link SCOPE} because `ScanTree` names whole
 * top-level trees, and this gate's policy is one subtree of one of them — the same reason `control-bytes`
 * and `no-headless` keep bespoke predicates.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return path.startsWith("src/cli/") && scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * Find every direct stdout write in one verb source.
 *
 * @param path the repo-relative path, for reporting
 * @param content the file's text
 * @returns the offending lines
 */
export function scanStdoutDataChannel({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly StdoutDataChannelHit[] {
  return content
    .split("\n")
    .map((text, index) => ({ line: index + 1, path, text: text.trim() }))
    .filter((hit) => DIRECT_STDOUT.test(hit.text));
}

/**
 * IO edge: scan every verb source, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runStdoutDataChannel(): number {
  let root: string;
  let paths: readonly string[];
  try {
    root = repoRoot();
    paths = workingTreeFilesOf({ root }).filter((path) => isScannablePath({ path }));
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("stdout-data-channel: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<StdoutDataChannelHit>({
    paths,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanStdoutDataChannel({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "stdout-data-channel",
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
    process.stdout.write(`stdout-data-channel: clean (${String(readCount)} verb source(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}  ${hit.text}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "stdout-data-channel" }),
      detail: `${String(hits.length)} direct stdout write(s) on the verb surface`,
    })}\n`,
  );
  return 1;
}
