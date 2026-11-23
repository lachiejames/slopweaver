/**
 * The gate that binds the recurring-failure register (`docs/recurring-failure-register.md` and the pages
 * `../reflect/registerPages.ts` lists) to the test lanes, in BOTH directions.
 *
 * ## The defect this exists for, measured
 *
 * The register holds the failure classes this system has repeated often enough to deserve a gate.
 * `src/__tests__/subprocess/replay/**` and its frozen fixtures are the lane where a failed turn becomes a
 * test instead of a memory. MEASURED by two independent lenses that agreed: **of the register's
 * live class names, ZERO appeared anywhere under `src/__tests__/`, and of the 13 replay fixture slugs, ZERO
 * appeared in the register.** The two registers were wholly disjoint by name, both ways.
 *
 * The mechanism underneath that was a reader's scope. `../reflect/crossRef.ts`'s `readRegisterCoverage` was
 * the only program in the tree that read the register at all, and it reads the REFUTED section — so the live
 * half was read by nobody, and drifted. Three Survivor rows sat in the build-candidate tables with the work
 * already shipped: `dependabot-alert-cited-as-a-pull-request-url` (closed by `ALERT_CONTEXT` in
 * `src/outbound/linkify/bareRefs.ts`), `test-fixture-mints-a-temp-dir-with-no-cleanup` (closed by the
 * temp-root sandbox) and `errors-swallowed-into-empty-defaults` (half-closed by `no-silent-fallback`).
 *
 * The register is subject to its own class 10, `feedback-closed-without-locking-in-the-class`, which refuses
 * work that lands "with no regression probe binding the behaviour and no row registered for the class". This
 * gate is that rule applied to the register itself.
 *
 * ## Filename matching cannot substitute for a declared link, and that was measured too
 *
 * The natural shortcut — "the seam is `linkify/bareRefs.ts`, so `bareRefs.test.ts` binds the class" — is
 * wrong here and was caught by mutation. Breaking the alert-context regex, exactly the defect
 * `dependabot-alert-cited-as-a-pull-request-url` describes, left `bareRefs.test.ts` 58 of 58 green; the file
 * that caught it is `bareRefsAlertNumbers.test.ts`. So the link is DECLARED at both ends: a row in the
 * register's `## Bindings` table, and either the class name or a `// register-class: <name>` marker in the
 * test itself.
 *
 * ## What it proves — exactly this, and no more
 *
 * Every declared link RESOLVES: a named gate is in the lint plan and carries a refusal declaration, a named
 * test exists AND collected by a lane AND names its class, a named fixture exists, parses, and claims
 * the class back. Every live class has a row, and every row names a class some section carries.
 *
 * It does NOT prove a bound test would go red if the class regressed, and nothing static can. A `gate:`
 * target inherits the same limit `gateRegistration.ts` states about itself: the gate is real, declared and
 * run — not that its criterion covers this class. Saying so here is deliberate, because a gate whose green
 * implies more than it checked is the `verification-run-in-a-shape-whose-green-means-nothing` class.
 *
 * ## Why an empty inventory is INCOMPLETE rather than clean
 *
 * If the register's headings are renamed, the section walk finds no live classes, the completeness check
 * finds nothing missing, and a naive gate reports clean forever. So a zero-length live inventory is routed
 * through `gateOutcome` as `unseen`: the gate never saw its subject, and four lines claiming a rule caught
 * something would be the FACT-dressed-as-refusal defect `./refusal/render.ts` documents.
 *
 * Pure core / effectful shell: {@link checkRegisterBindings} takes already-read inputs, so every rule is
 * testable without a filesystem; {@link runRegisterBindings} is the thin edge that reads them.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { type FixtureManifest, parseFixtureManifest } from "../live/turn/freeze/fixture.js";
import { liveClasses, REGISTER_RELATIVE_PATH } from "../reflect/registerDoc.js";
import { loadRegister } from "../reflect/registerPages.js";
import { createFsReader } from "../reflect/substrate.js";
import { lintChecks } from "./devLint.js";
import { DECLARED_LINT_GATES, type LintGateRefusalId, lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import {
  type BindingFinding,
  type BindingInputs,
  checkRegisterBindings,
  FIXTURE_ROOT,
  type FixtureUnderReview,
  REPLAY_LANE_ROOT,
  unreadableFixtures,
} from "./registerBindingsCore.js";

/**
 * Read every committed replay fixture, and whether the lane names it.
 *
 * @param root the repository root
 * @returns one record per fixture directory, in slug order
 */
function readFixtures({ root }: { root: string }): readonly FixtureUnderReview[] {
  const dir = join(root, FIXTURE_ROOT);
  if (!existsSync(dir)) {
    return [];
  }
  const laneText = replayLaneText({ root });
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
    .map((slug) => ({
      manifest: readManifest({ path: join(dir, slug, "fixture.json") }),
      replayed: laneText.includes(slug),
      slug,
    }));
}

/**
 * One manifest, parsed through the REAL schema rather than a bespoke reader.
 *
 * @param path the manifest's absolute path
 * @returns the manifest, or `undefined` when it is absent or will not parse
 */
function readManifest({ path }: { path: string }): FixtureManifest | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  const parsed = parseFixtureManifest({ value });
  if (parsed.isErr()) {
    return undefined;
  }
  return parsed.value;
}

/**
 * Every replay test's text, concatenated — enough to answer "does any test name this slug".
 *
 * @param root the repository root
 * @returns the lane's whole text, or an empty string when the lane is absent
 */
function replayLaneText({ root }: { root: string }): string {
  const dir = join(root, REPLAY_LANE_ROOT);
  if (!existsSync(dir)) {
    return "";
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

/**
 * Read everything the rules need off disk.
 *
 * @param root the repository root
 * @returns the inputs, ready for {@link checkRegisterBindings}
 */
export function readBindingInputs({ root }: { root: string }): BindingInputs {
  const { doc } = loadRegister({ parentPath: join(root, REGISTER_RELATIVE_PATH), reader: createFsReader() });
  const listing = new Set(workingTreeFilesOf({ root }));
  const testTexts = new Map<string, string>();
  for (const row of doc.bindings) {
    for (const target of row.targets) {
      const wanted = target.kind === "test" && listing.has(target.value) && !testTexts.has(target.value);
      if (wanted) {
        testTexts.set(target.value, readFileSync(join(root, target.value), "utf8"));
      }
    }
  }
  return {
    declaredGates: new Set(DECLARED_LINT_GATES),
    doc,
    fixtures: readFixtures({ root }),
    plannedGates: new Set(lintChecks({ cwd: root }).map((one) => one.name)),
    testTexts,
    workingTreeFiles: listing,
  };
}

/**
 * Run the gate.
 *
 * @returns the process exit code
 */
export function runRegisterBindings(): number {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const inputs = readBindingInputs({ root });
  const live = liveClasses({ doc: inputs.doc });
  const findings = checkRegisterBindings({ inputs });
  for (const finding of findings) {
    process.stderr.write(`  ${REGISTER_RELATIVE_PATH}  [${finding.check}] ${finding.subject} — ${finding.message}\n`);
  }
  const unreadable = unreadableFixtures({ inputs });
  for (const slug of unreadable) {
    process.stderr.write(
      `  ${FIXTURE_ROOT}/${slug}/fixture.json  is missing or will not parse, so this gate judged NOTHING about ` +
        `that fixture's bindings — re-freeze it, or restore the field a hand edit removed\n`,
    );
  }
  const noClasses = live.length === 0 ? 1 : 0;
  const outcome = gateOutcome({ refused: findings.length, unseen: unreadable.length + noClasses });
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a FACT the gate could not get past. No rule caught anything here: an input
    // was unreadable, or the register's headings moved and its live half yielded nothing, so four lines
    // claiming a criterion fired would describe something that did not happen.
    process.stderr.write(
      `register-bindings: INCOMPLETE — ${String(unreadable.length)} unreadable fixture manifest(s) and ` +
        `${String(live.length)} live class(es) read. An input this gate could not read is a FACT it reports, ` +
        `never a clean run: a verdict over bytes nobody parsed is the thing this gate exists to refuse.\n`,
    );
    return 1;
  }
  if (outcome === "refused") {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: refusalIdFor({ findings }) }),
        detail: `${String(findings.length)} unresolved binding(s) across ${String(live.length)} live class(es)`,
      })}\n`,
    );
    return 1;
  }
  const bound = inputs.doc.bindings.filter((one) => one.targets.length > 0).length;
  process.stdout.write(
    `register-bindings: clean (${String(live.length)} live class(es), ${String(bound)} bound, ` +
      `${String(live.length - bound)} bind nothing)\n`,
  );
  return 0;
}

/**
 * Which of the two declarations to render, chosen by what actually fired.
 *
 * Two rows rather than one because the corrections genuinely differ: a Survivor claiming closure is a
 * BOOKKEEPING move — move the class, or downgrade the claim — while every other finding is a link that does
 * not resolve and is fixed at one of its two ends. Putting the wrong correction in front of a reader is the
 * defect the declarations exist to prevent.
 *
 * @param findings every finding this run produced
 * @returns the refusal id to render
 */
function refusalIdFor({ findings }: { findings: readonly BindingFinding[] }): LintGateRefusalId {
  if (findings.some((one) => one.check === "survivor-already-closed")) {
    return "register-bindings-closed";
  }
  return "register-bindings";
}
