/**
 * The gate that stops a GATE from being written and then never run.
 *
 * ## The hole this closes
 *
 * A bespoke check in this directory is two files — the logic, and a tiny `*.entry.ts` that invokes it —
 * plus one line registering it in `lintChecks`. Miss that line and the check simply never runs. Measured on
 * this tree before this file existed: adding `src/devLint/orphan.entry.ts` and registering it nowhere left
 * the unit suite green, `knip` silent, ESLint clean, and every other gate passing. Nothing anywhere said so.
 *
 * The since-deleted `CODEBASE_MAP.md` claimed `devLint.test.ts` "pins that exact name sequence, so adding a gate without
 * registering it fails the suite". That was false: the test compares `lintChecks()` against a second
 * hand-maintained list, so an unregistered entry changes neither and both agree. Two lists agreeing with
 * each other is not the same as either agreeing with the filesystem.
 *
 * This is the worst instance of the family: an unrun gate reports nothing at all, forever, and every future
 * ratchet inherits the risk.
 *
 * ## What it proves
 *
 * Three things about wiring, and nothing about correctness:
 *
 * - every `*.entry.ts` in this directory appears in the `lintChecks` plan;
 * - every planned bespoke gate carries a refusal declaration;
 * - every entry runs through `runGateEntry` and exits nowhere else (`./gateEntryLifecycle.ts`), so each gate
 *   closes its TypeScript clients before it exits.
 *
 * It does not prove a check is correct, that its logic is reached, or that the plan runs it successfully.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintChecks } from "./devLint.js";
import { entryLifecycleViolations } from "./gateEntryLifecycle.js";
import { DECLARED_LINT_GATES, lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * Which gate entry points the lint plan never invokes.
 *
 * Compared on the entry-file path as it appears in the plan's args, because that is what the runner
 * actually spawns — matching on the gate's display name would compare two labels rather than the wiring.
 *
 * @param entryPaths every `src/devLint/*.entry.ts`, repo-relative
 * @param plannedArgs every argument string the lint plan will spawn
 * @returns the entry paths absent from the plan, in path order
 */
export function unregisteredEntries({
  entryPaths,
  plannedArgs,
}: {
  entryPaths: readonly string[];
  plannedArgs: readonly string[];
}): readonly string[] {
  const planned = new Set(plannedArgs);
  return entryPaths.filter((path) => !planned.has(path)).toSorted();
}

/**
 * Which bespoke gates in the lint plan carry no refusal declaration.
 *
 * The companion to the entry-to-plan proof below, and it closes the other half of the same hole: that gate
 * proves a written gate is RUN, this one proves a run gate can say what a fix looks like when it refuses.
 * A gate with neither is one that stops the tree with a bare count.
 *
 * Only bespoke gates are compared. The plan also spawns Biome, prettier, oxlint, knip and the external scripts,
 * whose output this repository does not author and must not wrap.
 *
 * @param plannedGates every gate name in the lint plan
 * @param declaredGates every gate name carrying at least one declaration
 * @returns the bespoke gate names with no declaration, in name order
 */
export function undeclaredGates({
  plannedGates,
  declaredGates,
}: {
  plannedGates: readonly string[];
  declaredGates: readonly string[];
}): readonly string[] {
  const declared = new Set(declaredGates);
  return plannedGates.filter((name) => !EXTERNAL_GATES.has(name) && !declared.has(name)).toSorted();
}

/**
 * The plan entries this repository does not author the output of, so a declaration would have nothing to
 * describe. Named rather than pattern-matched: each is a third-party tool or a script with its own voice.
 */
const EXTERNAL_GATES: ReadonlySet<string> = new Set([
  "biome-imports",
  "constraints",
  "corpus-hygiene",
  "coverage-ratchet-summary",
  "door-coverage",
  "hygiene",
  "knip",
  "oxlint",
  "prettier",
  "tsx",
]);

/**
 * Fail when a gate entry point in this directory is not registered in the lint plan.
 *
 * @returns 0 when every entry point is wired into `lintChecks`, else 1
 */
export function runGateRegistration(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("gate-registration: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const entryPaths = listing.filter((path) => path.startsWith("src/devLint/") && path.endsWith(".entry.ts"));
  // Read them, so an entry git reports but absent from disk is a finding rather than a smaller list, and judge
  // each one's lifecycle while it is open.
  const scan = scanTextFiles<string>({
    paths: entryPaths,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ path, content }) => entryLifecycleViolations({ path, text: content }),
  });
  const complete = reportScanIntegrity({
    label: "gate-registration",
    scanned: scan.scanned,
    unreadable: scan.unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  const plannedArgs = lintChecks({ cwd: root }).flatMap((check) => [...check.args]);
  const orphans = unregisteredEntries({ entryPaths, plannedArgs });
  const undeclared = undeclaredGates({
    declaredGates: DECLARED_LINT_GATES,
    plannedGates: lintChecks({ cwd: root }).map((check) => check.name),
  });
  for (const name of undeclared) {
    process.stderr.write(`  ${name}  (in the lint plan, but no refusal declaration says what a fix looks like)\n`);
  }
  for (const path of orphans) {
    process.stderr.write(`  ${path}  (a gate that ${basename(path)} would run, but \`dev lint\` never does)\n`);
  }
  for (const finding of scan.hits) {
    process.stderr.write(`  ${finding}\n`);
  }
  if (orphans.length === 0 && undeclared.length === 0 && scan.hits.length === 0 && complete) {
    process.stdout.write(
      `gate-registration: clean (${String(entryPaths.length)} gate entry point(s) wired through runGateEntry, ${String(DECLARED_LINT_GATES.length)} declared)\n`,
    );
    return 0;
  }
  return reportGateRegistration({ lifecycle: scan.hits, orphans, undeclared });
}

/**
 * Print the refusal for whichever half of this gate fired, and return its exit code.
 *
 * BOTH halves render, and each names its own correction: an unrun gate is fixed by registering it, an
 * undeclared one by writing its refusal copy. An earlier pass guarded the render on `orphans` alone, so the
 * undeclared-only path exited 1 with no shape at all — caught by an adversarial review pass, which is
 * exactly the failure this whole change exists to stop.
 *
 * @param lifecycle entry-lifecycle findings, one line per broken clause
 * @param orphans gate entry points the lint plan never runs
 * @param undeclared planned bespoke gates carrying no refusal declaration
 * @returns 1, the exit code every half gives
 */
function reportGateRegistration({
  lifecycle,
  orphans,
  undeclared,
}: {
  lifecycle: readonly string[];
  orphans: readonly string[];
  undeclared: readonly string[];
}): number {
  if (lifecycle.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "gate-registration-entry-lifecycle" }),
        detail: `${String(lifecycle.length)} gate entry clause(s) broken`,
      })}\n`,
    );
  }
  if (orphans.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "gate-registration" }),
        detail: `${String(orphans.length)} gate(s) exist but are never run`,
      })}\n`,
    );
  }
  if (undeclared.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "gate-registration-declaration" }),
        detail: `${String(undeclared.length)} registered gate(s) declare no refusal`,
      })}\n`,
    );
  }
  return 1;
}
