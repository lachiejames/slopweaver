/**
 * The gate that keeps a MODULE-anchored repository lookup out of a runtime verb.
 *
 * ## The two families, and why one of them is a bug outside `src/devLint/`
 *
 * `../lib/gitRepo.ts`'s `repoRootOf`/`currentBranchOf` anchor on the CALLER's own file
 * (`import.meta.url`) and answer with GIT. That pairing is exactly right for a gate, which must scan the
 * tree it was loaded from however the operator invoked it, and it is a THROW everywhere else: a marketplace
 * plugin install copies source files into `~/.claude/plugins/data/<plugin>/mirror/…` as a plain directory
 * tree with no `.git` anywhere above them, so `git -C <that module's directory> rev-parse --show-toplevel`
 * fails with `fatal: not a git repository` — deterministically, every call, for the life of that install.
 *
 * A verb has TWO replacements, and picking between them is the part no gate can do:
 *
 * - **`runningCheckoutRoot`/`runningCheckoutBranch`** (`../lib/gitRepo.ts`, `process.cwd()`-anchored) —
 *   where the operator is STANDING. A spawn plan, a branch report, a checkout under review.
 * - **`installedTreeRoot`** (`../lib/pluginRoot.ts`, manifest-walk from the module) — the tree THIS BUILD
 *   lives in. The skills catalogue and the committed register want this one, and `cwd` is as wrong for them
 *   as git is: run the CLI while standing in an unrelated repository and a cwd anchor reads that
 *   repository's `skills/`.
 *
 * ## Why a gate rather than the comment that was already there
 *
 * `../cmux/pluginDir.ts` hit this and its header has documented the whole hazard, in
 * detail, ever since. Five days later the ANSWER path hit the identical thing and destroyed a composed,
 * reviewed, verdict-clean reply to the owner's own work order: `src/live/turn/posterAnswer.ts` built its
 * door gate list with `repoRootOf`, and the ask ended `failed` with
 * `git -C …/mirror/a/src/live/turn rev-parse --show-toplevel, fatal: not a git repository`. Nine more call
 * sites in the same family were standing at the time. A prose warning in one file protects one file.
 *
 * ## What it proves
 *
 * Exactly one thing: no TypeScript outside the gate directories names `repoRootOf` or
 * `currentBranchOf`. It does not prove a verb resolves the RIGHT checkout, only that it cannot resolve one
 * from a directory that may not be a repository at all.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportEmptySelection } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/**
 * The directories whose code is anchored on its own module BY DESIGN — the gates, and the module that
 * defines both families.
 *
 * A gate scans the checkout it was loaded from, so `import.meta.url` is its correct anchor and `cwd` would
 * be the bug. Nothing else in this repository has that property.
 */
const MODULE_ANCHORED_SCOPE: readonly string[] = ["src/devLint/", "src/hygiene/", "src/lib/gitRepo.ts"];

/** The two module-anchored lookups, matched as identifiers so a substring of a longer name never counts. */
const MODULE_ANCHORED_CALL = /\b(?:repoRootOf|currentBranchOf)\b/;

/**
 * Whether one path is this gate's business.
 *
 * Sources are the scope. A `__tests__` file naming either function is TESTING it — `src/lib/gitRepo.ts`'s
 * own round-trip suite has to call both families by name — so the test tree is out, and so are the three
 * paths in {@link MODULE_ANCHORED_SCOPE} where the module anchor is the correct answer.
 *
 * @internal — exported for its own unit tests; the scope decision is the half that fails silently when it
 *   is wrong, so it is asserted directly rather than inferred from a clean whole-repo run.
 * @param path the repo-relative path to test
 * @returns whether the gate should scan it
 */
export function inScope({ path }: { path: string }): boolean {
  if (!path.endsWith(".ts") || path.includes("/__tests__/")) {
    return false;
  }
  return !MODULE_ANCHORED_SCOPE.some((prefix) => path.startsWith(prefix));
}

/**
 * One offending line.
 *
 * @internal — the shape {@link findModuleAnchoredLookups} returns; nothing outside this gate names it.
 */
export interface ModuleAnchoredHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Find every module-anchored repository lookup in one source.
 *
 * @internal — exported for its own unit tests; {@link runRunningCheckoutRoot} is the only production caller.
 * @param path the repo-relative path, for reporting
 * @param content the file's text
 * @returns the offending lines
 */
export function findModuleAnchoredLookups({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly ModuleAnchoredHit[] {
  return content
    .split("\n")
    .map((text, index) => ({ line: index + 1, path, text: text.trim() }))
    .filter((hit) => MODULE_ANCHORED_CALL.test(hit.text));
}

/**
 * Scan every source outside the gate directories, print each hit, and return an exit code.
 *
 * @returns 0 when clean, 1 when a runtime module anchors a repository lookup on itself, or the scan broke
 */
export function runRunningCheckoutRoot(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    files = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("running-checkout-root: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const hits: ModuleAnchoredHit[] = [];
  const unreadable: string[] = [];
  const selected = files.filter((candidate) => inScope({ path: candidate }));
  for (const path of selected) {
    try {
      appendAll({
        from: findModuleAnchoredLookups({ content: readFileSync(join(root, path), "utf8"), path }),
        into: hits,
      });
    } catch {
      // A source this gate could not read is one it did not check, and reporting clean over it is the
      // silent-failure shape `../lib/gitRepo.ts` exists to refuse.
      unreadable.push(path);
    }
  }
  const unseen =
    unreadable.length +
    reportEmptySelection({
      label: "running-checkout-root",
      selected: selected.length,
      write: (text) => {
        process.stderr.write(text);
      },
    });
  return report({ hits, unreadable, unseen });
}

/** Print the outcome. */
function report({
  hits,
  unreadable,
  unseen,
}: {
  hits: readonly ModuleAnchoredHit[];
  unreadable: readonly string[];
  unseen: number;
}): number {
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}  ${hit.text}\n`);
  }
  for (const path of unreadable) {
    process.stderr.write(`  ${path}  (unreadable — not checked)\n`);
  }
  const outcome = gateOutcome({ refused: hits.length, unseen });
  if (outcome === "clean") {
    process.stdout.write("running-checkout-root: clean\n");
    return 0;
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a file that could not be read was not checked, so this reports
    // the gap rather than a policy verdict over it
    process.stderr.write("running-checkout-root: a source could not be read, so this scan is incomplete, not clean.\n");
    return 1;
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "running-checkout-root" }),
      detail: `${String(hits.length)} module-anchored repository lookup(s) outside the gates`,
    })}\n`,
  );
  return 1;
}
