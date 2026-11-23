/**
 * The pure core of the register-bindings gate: every rule, over already-read inputs. The effectful shell that
 * reads those inputs off disk and renders the verdict is `./registerBindings.ts`, whose header carries the
 * gate's rationale.
 */

import { join } from "node:path";

import type { FixtureManifest } from "../live/turn/freeze/fixture.js";
import {
  type BindingRow,
  liveClasses,
  REGISTER_RELATIVE_PATH,
  type RegisterClass,
  type RegisterDoc,
} from "../reflect/registerDoc.js";

/** Where the committed replay fixtures live, repo-relative. */
export const FIXTURE_ROOT = join("src", "__tests__", "fixtures", "replay");

/** Where the replay tests that materialise them live, repo-relative. */
export const REPLAY_LANE_ROOT = join("src", "__tests__", "subprocess", "replay");

/**
 * Every root a vitest lane collects from — FIVE, because the unit lane has three.
 *
 * A `*.test.ts` outside all of them is SILENTLY never collected — `.claude/rules/testing.md` records that
 * the only symptom is a test count that did not move — so a binding naming one is a binding to nothing.
 * `site/__tests__/unit/` is the unit lane's second root: `site/` is a separate Yarn project and a file under
 * `src/` may not import one outside it (TS6059, the CI `compile` job), so a console module is tested from
 * beside itself, and `desktop/__tests__/unit/` is the same shape for the desktop shell. Kept in step with
 * `config/vitest/*.ts` by `registerBindings.test.ts`, which asserts this list against the configs rather than
 * trusting two lists to agree.
 */
export const LANE_ROOTS: readonly string[] = ["unit", "integration", "subprocess"]
  .map((lane) => `src/__tests__/${lane}/`)
  .concat("site/__tests__/unit/", "desktop/__tests__/unit/");

/** The marker line a test carries to declare the class it binds, when its prose does not name it. */
const CLASS_MARKER = "// register-class:";

/** One thing wrong with the join between the register and the lanes. */
export interface BindingFinding {
  /** The finding name, as the report prints it. */
  readonly check: string;
  /** What it is about — a class name, a fixture slug, a path. */
  readonly subject: string;
  /** What is wrong and what a fix looks like, in one sentence. */
  readonly message: string;
}

/** One committed replay fixture, as the gate found it on disk. */
export interface FixtureUnderReview {
  readonly slug: string;
  /** The parsed manifest, or `undefined` when the file was missing or would not parse. */
  readonly manifest: FixtureManifest | undefined;
  /** Whether any file under the replay lane names this slug. */
  readonly replayed: boolean;
}

/** Everything {@link checkRegisterBindings} needs, already read. */
export interface BindingInputs {
  readonly doc: RegisterDoc;
  /** Every gate name the lint plan will actually spawn. */
  readonly plannedGates: ReadonlySet<string>;
  /** Every gate name carrying at least one refusal declaration. */
  readonly declaredGates: ReadonlySet<string>;
  /** Every repo-relative path in the working tree — committed or not, minus what git ignores. */
  readonly workingTreeFiles: ReadonlySet<string>;
  /** The text of every test file a binding names, keyed by repo-relative path. */
  readonly testTexts: ReadonlyMap<string, string>;
  readonly fixtures: readonly FixtureUnderReview[];
}

/**
 * Whether a path is collected by one of the three vitest lanes.
 *
 * @param path the repo-relative path
 * @returns true when a lane's `include` glob would select it
 */
export function isCollectedTest({ path }: { path: string }): boolean {
  if (!path.endsWith(".test.ts")) {
    return false;
  }
  return LANE_ROOTS.some((root) => path.startsWith(root));
}

/**
 * Whether a test file declares the class a bindings row says it holds.
 *
 * Satisfied two ways on purpose. A test that already discusses its class in prose needs nothing added, and
 * one that does not carries a {@link CLASS_MARKER} line. The marker exempts nothing — it IS the join token,
 * and `grep -rn "register-class:" src/__tests__/` reads the relation from the test's own side.
 *
 * ## The substring hazard, measured rather than assumed
 *
 * This is `includes`, so a test naming a LONGER class that contains a shorter one would satisfy the shorter
 * one's check. That is a property of the NAMES rather than of this function, and it is pinned as one:
 * `registerBindings.test.ts` § "no class name is a substring of another" compares every ordered pair the
 * real register declares and fails if a future class is ever named as a prefix of an existing one. The
 * direction of the failure would be a false PASS, never a false refusal, which is why it is worth pinning
 * rather than leaving to be noticed.
 *
 * @param text the test file's contents
 * @param className the class the row claims it binds
 * @returns true when the file names the class
 */
export function testNamesClass({ text, className }: { text: string; className: string }): boolean {
  return text.includes(className);
}

/**
 * Check every `gate:` target on one row.
 *
 * @param row the bindings row
 * @param inputs the already-read inputs
 * @returns one finding per gate that does not resolve
 */
function gateFindings({ row, inputs }: { row: BindingRow; inputs: BindingInputs }): readonly BindingFinding[] {
  return row.targets
    .filter((target) => target.kind === "gate")
    .flatMap((target) => {
      if (!inputs.plannedGates.has(target.value)) {
        return [
          {
            check: "gate-not-planned",
            message: `names gate \`${target.value}\`, which \`lintChecks\` never runs — a gate nothing spawns refuses nothing`,
            subject: row.className,
          },
        ];
      }
      if (!inputs.declaredGates.has(target.value)) {
        return [
          {
            check: "gate-not-declared",
            message: `names gate \`${target.value}\`, which carries no refusal declaration, so it cannot say what a fix looks like`,
            subject: row.className,
          },
        ];
      }
      return [];
    });
}

/**
 * Check every `test:` target on one row.
 *
 * @param row the bindings row
 * @param inputs the already-read inputs
 * @returns one finding per test that does not resolve, is never collected, or does not name the class
 */
function testFindings({ row, inputs }: { row: BindingRow; inputs: BindingInputs }): readonly BindingFinding[] {
  return row.targets
    .filter((target) => target.kind === "test")
    .flatMap((target) => {
      if (!inputs.workingTreeFiles.has(target.value)) {
        return [
          {
            check: "test-missing",
            message: `names \`${target.value}\`, which is not a file in the working tree`,
            subject: row.className,
          },
        ];
      }
      if (!isCollectedTest({ path: target.value })) {
        return [
          {
            check: "test-uncollected",
            message: `names \`${target.value}\`, which no vitest lane collects, so it is silently never run`,
            subject: row.className,
          },
        ];
      }
      const text = inputs.testTexts.get(target.value);
      if (text === undefined) {
        return [];
      }
      if (testNamesClass({ className: row.className, text })) {
        return [];
      }
      return [
        {
          check: "test-silent",
          message: `names \`${target.value}\`, which never names the class — add \`${CLASS_MARKER} ${row.className}\` to it`,
          subject: row.className,
        },
      ];
    });
}

/**
 * Check every `fixture:` target on one row.
 *
 * @param row the bindings row
 * @param inputs the already-read inputs
 * @returns one finding per fixture that is absent, misnamed, or does not claim the class back
 */
function fixtureFindings({ row, inputs }: { row: BindingRow; inputs: BindingInputs }): readonly BindingFinding[] {
  return row.targets
    .filter((target) => target.kind === "fixture")
    .flatMap((target) => {
      const found = inputs.fixtures.find((one) => one.slug === target.value);
      if (found === undefined) {
        return [
          {
            check: "fixture-missing",
            message: `names fixture \`${target.value}\`, which is not a directory under ${FIXTURE_ROOT}`,
            subject: row.className,
          },
        ];
      }
      if (found.manifest === undefined) {
        return [];
      }
      if (!found.replayed) {
        return [
          {
            check: "fixture-unreplayed",
            message: `names fixture \`${target.value}\`, which no test under ${REPLAY_LANE_ROOT} materialises`,
            subject: row.className,
          },
        ];
      }
      if (!found.manifest.regresses.includes(row.className)) {
        return [
          {
            check: "fixture-unclaimed",
            message: `names fixture \`${target.value}\`, whose manifest does not carry this class in \`regresses\``,
            subject: row.className,
          },
        ];
      }
      return [];
    });
}

/**
 * Check one bindings row: that it names a real class, that a Survivor does not claim closure, and that every
 * target resolves.
 *
 * @param row the bindings row
 * @param inputs the already-read inputs
 * @returns every finding about that row
 */
function rowFindings({ row, inputs }: { row: BindingRow; inputs: BindingInputs }): readonly BindingFinding[] {
  const declared = inputs.doc.classes.find((one) => one.name === row.className);
  if (declared === undefined) {
    return [
      {
        check: "unknown-class",
        message: `has a bindings row but no section of the register carries it — a rename landed on one side only`,
        subject: row.className,
      },
    ];
  }
  if (declared.section === "refuted") {
    return [
      {
        check: "refuted-class-bound",
        message: `is bound while sitting in the Refuted section — the register says the class is dead`,
        subject: row.className,
      },
    ];
  }
  const closed =
    declared.section === "survivors" && row.strength === "closes"
      ? [
          {
            check: "survivor-already-closed",
            message: `claims \`closes\` while still listed as a build candidate — this file's own rule is to move a class out of Survivors once its mechanism lands, naming it`,
            subject: row.className,
          },
        ]
      : [];
  return [
    ...closed,
    ...gateFindings({ inputs, row }),
    ...testFindings({ inputs, row }),
    ...fixtureFindings({ inputs, row }),
  ];
}

/**
 * Check one fixture's own `regresses` claims — the lane-to-register direction.
 *
 * @param fixture the fixture under review
 * @param inputs the already-read inputs
 * @returns every finding about that fixture's declared classes
 */
function fixtureClaimFindings({
  fixture,
  inputs,
}: {
  fixture: FixtureUnderReview;
  inputs: BindingInputs;
}): readonly BindingFinding[] {
  const manifest = fixture.manifest;
  if (manifest === undefined) {
    return [];
  }
  return manifest.regresses.flatMap((className) => {
    const declared = inputs.doc.classes.find((one) => one.name === className);
    if (declared === undefined) {
      return [
        {
          check: "fixture-class-unknown",
          message: `declares \`${className}\`, which ${REGISTER_RELATIVE_PATH} does not carry in any section`,
          subject: fixture.slug,
        },
      ];
    }
    if (declared.section === "refuted") {
      return [
        {
          check: "fixture-claims-refuted-class",
          message: `declares \`${className}\`, a class the adversarial pass REFUTED — a live fixture and a dead class contradict each other`,
          subject: fixture.slug,
        },
      ];
    }
    const row = inputs.doc.bindings.find((one) => one.className === className);
    const named = row?.targets.some((t) => t.kind === "fixture" && t.value === fixture.slug) === true;
    if (named) {
      return [];
    }
    return [
      {
        check: "fixture-unbound",
        message: `declares \`${className}\`, whose bindings row does not name this fixture back — the join has one end`,
        subject: fixture.slug,
      },
    ];
  });
}

/**
 * Every live class with no row in the `## Bindings` table.
 *
 * Silence is the defect this closes. A class that binds nothing says `none`, out loud and in the table; a
 * class with no row at all is one nobody has answered the question for.
 *
 * @param live the live classes
 * @param doc the parsed register
 * @returns one finding per unanswered class
 */
function missingRowFindings({
  live,
  doc,
}: {
  live: readonly RegisterClass[];
  doc: RegisterDoc;
}): readonly BindingFinding[] {
  const rows = new Set(doc.bindings.map((one) => one.className));
  return live
    .filter((one) => !rows.has(one.name))
    .map((one) => ({
      check: "unbound-row-missing",
      message: `has no \`## Bindings\` row — add one, with \`none\`/\`none\` when nothing binds it yet`,
      subject: one.name,
    }));
}

/**
 * Every fixture whose manifest the gate could not read — an input it never judged, not a rule it caught.
 *
 * This exists because the first version of this gate had no notion of it and an adversarial review broke the
 * gate's whole property with one edit. `fixtureFindings` returns early on an unreadable manifest (correctly —
 * it has nothing to compare), so deleting `regresses` from a committed fixture left BOTH halves of that
 * fixture's join unchecked while the gate printed `clean` and exited 0, with a bindings row still declaring
 * it. A verdict given over an input the gate could not read is exactly what `./refusal/render.ts`'s `unseen`
 * parameter is for, and the hand-edit that reaches it is one the register's own prose sanctions.
 *
 * @param inputs the already-read inputs
 * @returns the slugs whose `fixture.json` is missing or will not parse, in the order found
 */
export function unreadableFixtures({ inputs }: { inputs: BindingInputs }): readonly string[] {
  return inputs.fixtures.filter((one) => one.manifest === undefined).map((one) => one.slug);
}

/**
 * Every rule, over already-read inputs. Pure.
 *
 * @param inputs the register, the gate registries, the working-tree files, the bound tests' text and the fixtures
 * @returns every finding, register-side rules first and then the fixtures' own claims
 */
export function checkRegisterBindings({ inputs }: { inputs: BindingInputs }): readonly BindingFinding[] {
  const live = liveClasses({ doc: inputs.doc });
  const malformed = inputs.doc.problems.map((problem) => ({
    check: "malformed-row",
    message: problem.message,
    subject: problem.path,
  }));
  return [
    ...malformed,
    ...missingRowFindings({ doc: inputs.doc, live }),
    ...inputs.doc.bindings.flatMap((row) => rowFindings({ inputs, row })),
    ...inputs.fixtures.flatMap((fixture) => fixtureClaimFindings({ fixture, inputs })),
  ];
}
