/**
 * The gate binding `docs/recurring-failure-register.md` to the test lanes, both ways.
 *
 * Two halves in the house shape. The first exercises every rule on inline inputs and proves each one can
 * FIRE — a gate whose green has never been falsified is the
 * `verification-run-in-a-shape-whose-green-means-nothing` class. The second reads the REAL register, the
 * REAL fixtures and the REAL lint plan and asserts zero findings, which is what makes the gate self-proving
 * on the day it lands rather than the day somebody next runs `yarn lint`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readBindingInputs } from "../../../devLint/registerBindings.js";
import {
  type BindingInputs,
  checkRegisterBindings,
  type FixtureUnderReview,
  isCollectedTest,
  LANE_ROOTS,
  testNamesClass,
  unreadableFixtures,
} from "../../../devLint/registerBindingsCore.js";
import { parseRegisterDoc } from "../../../reflect/registerDoc.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** The three vitest lanes, as their config filenames spell them. */
const LANES: readonly string[] = ["unit", "integration", "subprocess"];

/** One live class, one refuted class, and a bindings table whose one row the cases below fill in. */
const TEMPLATE = [
  "## Survivors — the live build candidates",
  "",
  "| n   | class          | what it refuses | seam   |",
  "| --- | -------------- | --------------- | ------ |",
  "| 9   | `a-live-class` | it refuses X    | `a.ts` |",
  "",
  "## Refuted — 36 classes. Do not re-propose these.",
  "",
  "| class          | why it was refuted |",
  "| -------------- | ------------------ |",
  "| `a-dead-class` | REFUTED — gated    |",
  "",
  "## Bindings",
  "",
  "| class   | binds | strength |",
  "| ------- | ----- | -------- |",
  "| {CLASS} | {BINDS} | {STRENGTH} |",
].join("\n");

/**
 * The register with its one bindings row filled in.
 *
 * A builder rather than a chain of `.replace` calls at each case, because a case that edits the binds cell
 * by find-and-replace also has to keep the strength cell in step — and forgetting one produces a SECOND
 * finding that masks the one the case is about. That happened while writing this file, eight times.
 *
 * @param binds the binds cell, exactly as the document would carry it
 * @param strength the strength cell
 * @param className the class the row is about
 * @returns the register text
 */
function register({
  binds,
  strength,
  className = "`a-live-class`",
}: {
  binds: string;
  strength: string;
  className?: string;
}): string {
  return TEMPLATE.replace("{CLASS}", className).replace("{BINDS}", binds).replace("{STRENGTH}", strength);
}

/** A manifest good enough for the real `parseFixtureManifest`, carrying one declared class. */
const MANIFEST = {
  ask: { askedBy: "U1", channel: "C1", messageTs: "1.1", threadTs: "1.1" },
  excluded: [],
  files: ["home/live/slack/asks.jsonl"],
  frozenAtIso: "2026-08-28T09:00:00.000Z",
  incident: "the sweep abandoned a live worker",
  regresses: ["a-live-class"],
  replayNowIso: "2026-08-28T01:01:00.000Z",
  reviewRounds: 1,
  schemaVersion: 1,
  slug: "an-incident",
  syntheticIdCount: 1,
  withheldEventKinds: [],
} as const;

/** The fixture a `fixture:` case binds against, claiming the class back and replayed by a test. */
const FIXTURE: FixtureUnderReview = { manifest: { ...MANIFEST }, replayed: true, slug: "an-incident" };

/** Inputs for a tree whose one class is bound to a gate — the baseline every case breaks in one place. */
function inputsFor(over: Partial<BindingInputs> = {}): BindingInputs {
  return {
    declaredGates: new Set(["a-gate"]),
    doc: parseRegisterDoc({ text: register({ binds: "`gate:a-gate`", strength: "narrows" }) }),
    fixtures: [],
    plannedGates: new Set(["a-gate"]),
    testTexts: new Map(),
    workingTreeFiles: new Set(["src/__tests__/unit/a.test.ts"]),
    ...over,
  };
}

/** Every finding's check name, which is what each case below asserts on. */
function checksOf({ inputs }: { inputs: BindingInputs }): readonly string[] {
  return checkRegisterBindings({ inputs }).map((one) => one.check);
}

describe("checkRegisterBindings on a well-formed tree", () => {
  it("finds nothing when the live class has a row and its gate resolves", () => {
    expect(checkRegisterBindings({ inputs: inputsFor() })).toEqual([]);
  });

  it("finds nothing when the class is honestly declared unbound", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "none", strength: "none" }) });
    expect(checkRegisterBindings({ inputs: inputsFor({ doc }) })).toEqual([]);
  });

  it("finds nothing when a fixture binds the class and claims it back", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "`fixture:an-incident`", strength: "witnesses" }) });
    expect(checkRegisterBindings({ inputs: inputsFor({ doc, fixtures: [FIXTURE] }) })).toEqual([]);
  });
});

describe("checkRegisterBindings register-to-lane", () => {
  it("refuses a live class with no bindings row at all, because silence is the defect", () => {
    const doc = parseRegisterDoc({ text: TEMPLATE.split("## Bindings")[0]! });
    const findings = checkRegisterBindings({ inputs: inputsFor({ doc }) });
    expect(findings.map((one) => one.check)).toEqual(["unbound-row-missing"]);
    expect(findings[0]!.subject).toBe("a-live-class");
  });

  it("refuses a row naming a class no section carries, which is a rename landed on one side", () => {
    const doc = parseRegisterDoc({
      text: register({ binds: "none", className: "`a-renamed-class`", strength: "none" }),
    });
    expect(checksOf({ inputs: inputsFor({ doc }) })).toEqual(["unbound-row-missing", "unknown-class"]);
  });

  it("refuses a row binding a class the adversarial pass already killed", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "none", className: "`a-dead-class`", strength: "none" }) });
    expect(checksOf({ inputs: inputsFor({ doc }) })).toContain("refuted-class-bound");
  });

  it("refuses a Survivor row claiming its mechanism already closes it", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "`gate:a-gate`", strength: "closes" }) });
    expect(checksOf({ inputs: inputsFor({ doc }) })).toEqual(["survivor-already-closed"]);
  });

  it("accepts the same row claiming only to narrow the class, which most real mechanisms do", () => {
    expect(checksOf({ inputs: inputsFor() })).toEqual([]);
  });

  it("refuses a gate the lint plan never runs", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "`gate:not-planned`", strength: "narrows" }) });
    expect(checksOf({ inputs: inputsFor({ doc }) })).toEqual(["gate-not-planned"]);
  });

  it("refuses a planned gate that carries no refusal declaration", () => {
    expect(checksOf({ inputs: inputsFor({ declaredGates: new Set<string>() }) })).toEqual(["gate-not-declared"]);
  });

  it("refuses a test path that is not tracked", () => {
    const doc = parseRegisterDoc({
      text: register({ binds: "`test:src/__tests__/unit/gone.test.ts`", strength: "witnesses" }),
    });
    expect(checksOf({ inputs: inputsFor({ doc }) })).toEqual(["test-missing"]);
  });

  it("refuses a tracked test no vitest lane collects, which is silently never run", () => {
    const doc = parseRegisterDoc({
      text: register({ binds: "`test:src/live/beside.test.ts`", strength: "witnesses" }),
    });
    const inputs = inputsFor({ doc, workingTreeFiles: new Set(["src/live/beside.test.ts"]) });
    expect(checksOf({ inputs })).toEqual(["test-uncollected"]);
  });

  it("refuses a collected test that never names the class it is said to bind", () => {
    const doc = parseRegisterDoc({
      text: register({ binds: "`test:src/__tests__/unit/a.test.ts`", strength: "witnesses" }),
    });
    const inputs = inputsFor({ doc, testTexts: new Map([["src/__tests__/unit/a.test.ts", "describe('x')"]]) });
    expect(checksOf({ inputs })).toEqual(["test-silent"]);
  });

  it("accepts a collected test carrying the register-class marker", () => {
    const doc = parseRegisterDoc({
      text: register({ binds: "`test:src/__tests__/unit/a.test.ts`", strength: "witnesses" }),
    });
    const text = "// register-class: a-live-class\ndescribe('x')";
    expect(
      checkRegisterBindings({
        inputs: inputsFor({ doc, testTexts: new Map([["src/__tests__/unit/a.test.ts", text]]) }),
      }),
    ).toEqual([]);
  });

  it("refuses a fixture slug with no directory", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "`fixture:an-incident`", strength: "witnesses" }) });
    expect(checksOf({ inputs: inputsFor({ doc }) })).toEqual(["fixture-missing"]);
  });

  it("refuses a fixture no replay test materialises, since a fixture nothing replays is dead weight", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "`fixture:an-incident`", strength: "witnesses" }) });
    const fixtures = [{ ...FIXTURE, replayed: false }];
    expect(checksOf({ inputs: inputsFor({ doc, fixtures }) })).toEqual(["fixture-unreplayed"]);
  });

  it("refuses a fixture that does not claim the class back", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "`fixture:an-incident`", strength: "witnesses" }) });
    const fixtures = [{ ...FIXTURE, manifest: { ...MANIFEST, regresses: [] } }];
    expect(checksOf({ inputs: inputsFor({ doc, fixtures }) })).toEqual(["fixture-unclaimed"]);
  });

  it("raises no rule FINDING about a fixture whose manifest could not be parsed, having nothing to compare", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "`fixture:an-incident`", strength: "witnesses" }) });
    const fixtures = [{ manifest: undefined, replayed: true, slug: "an-incident" }];
    expect(checkRegisterBindings({ inputs: inputsFor({ doc, fixtures }) })).toEqual([]);
  });

  it("REPORTS that unreadable manifest as an unseen input, so the run can never be called clean", () => {
    // The adversarial review's counterexample, and the reason this pair of cases exists. Deleting the
    // `regresses` key from a committed fixture makes the manifest fail its own schema; every remaining check
    // on that target then has nothing to compare, so the gate used to print `clean` and exit 0 while a
    // bindings row still declared the fixture. An input the gate could not read is a FACT it must report.
    const doc = parseRegisterDoc({ text: register({ binds: "`fixture:an-incident`", strength: "witnesses" }) });
    const fixtures = [{ manifest: undefined, replayed: true, slug: "an-incident" }];
    expect(unreadableFixtures({ inputs: inputsFor({ doc, fixtures }) })).toEqual(["an-incident"]);
  });

  it("reports no unseen input when every manifest parsed, so the witness above can tell the two apart", () => {
    expect(unreadableFixtures({ inputs: inputsFor({ fixtures: [FIXTURE] }) })).toEqual([]);
  });

  it("forwards a malformed bindings row as a finding rather than dropping it", () => {
    const doc = parseRegisterDoc({ text: register({ binds: "none", strength: "mostly" }) });
    expect(checksOf({ inputs: inputsFor({ doc }) })).toContain("malformed-row");
  });
});

describe("checkRegisterBindings lane-to-register", () => {
  it("refuses a fixture declaring a class the register does not carry at all", () => {
    const fixtures = [{ ...FIXTURE, manifest: { ...MANIFEST, regresses: ["invented-class"] } }];
    expect(checksOf({ inputs: inputsFor({ fixtures }) })).toEqual(["fixture-class-unknown"]);
  });

  it("refuses a fixture declaring a REFUTED class, separately, because the fix differs entirely", () => {
    const fixtures = [{ ...FIXTURE, manifest: { ...MANIFEST, regresses: ["a-dead-class"] } }];
    expect(checksOf({ inputs: inputsFor({ fixtures }) })).toEqual(["fixture-claims-refuted-class"]);
  });

  it("refuses a fixture whose class does not name it back, so the join cannot have only one end", () => {
    expect(checksOf({ inputs: inputsFor({ fixtures: [FIXTURE] }) })).toEqual(["fixture-unbound"]);
  });

  it("accepts a fixture that declares no class, since most frozen turns are not an instance of one", () => {
    const fixtures = [{ ...FIXTURE, manifest: { ...MANIFEST, regresses: [] } }];
    expect(checkRegisterBindings({ inputs: inputsFor({ fixtures }) })).toEqual([]);
  });
});

describe("isCollectedTest", () => {
  it("accepts a unit-lane path", () => {
    expect(isCollectedTest({ path: "src/__tests__/unit/a.test.ts" })).toBe(true);
  });

  it("rejects a test file sitting beside its source, which no lane glob selects", () => {
    expect(isCollectedTest({ path: "src/reflect/registerDoc.test.ts" })).toBe(false);
  });

  it("rejects a non-test file under a lane", () => {
    expect(isCollectedTest({ path: "src/__tests__/unit/helper.ts" })).toBe(false);
  });
});

describe("testNamesClass", () => {
  it("accepts a file whose own prose already names the class", () => {
    expect(testNamesClass({ className: "a-live-class", text: "// about a-live-class" })).toBe(true);
  });

  it("rejects a file that names a different class", () => {
    expect(testNamesClass({ className: "a-live-class", text: "// about another-class" })).toBe(false);
  });
});

describe("the lane roots, against the vitest configs themselves", () => {
  it("reads each config's own include glob, so a lane that moved its root fails here", () => {
    const declared = LANES.map((lane) => {
      const text = readFileSync(join(REPO_ROOT, "config", "vitest", `${lane}.ts`), "utf8");
      return text.includes(`"src/__tests__/${lane}/**/*.test.ts"`);
    });
    expect(declared).toEqual([true, true, true]);
  });

  it("reads the unit lane's SECOND and THIRD roots too, which a one-root assertion would have passed straight over", () => {
    const text = readFileSync(join(REPO_ROOT, "config", "vitest", "unit.ts"), "utf8");
    expect([
      text.includes(`"site/__tests__/unit/**/*.test.ts"`),
      text.includes(`"desktop/__tests__/unit/**/*.test.ts"`),
    ]).toEqual([true, true]);
  });

  it("names exactly those five roots, rather than a second hand-kept list that agrees only with itself", () => {
    expect([...LANE_ROOTS].toSorted()).toEqual([
      "desktop/__tests__/unit/",
      "site/__tests__/unit/",
      "src/__tests__/integration/",
      "src/__tests__/subprocess/",
      "src/__tests__/unit/",
    ]);
  });
});

describe("the real tree", () => {
  it("has every live register class bound or honestly declared unbound, with every target resolving", () => {
    expect(checkRegisterBindings({ inputs: readBindingInputs({ root: REPO_ROOT }) })).toEqual([]);
  });

  it("read a non-empty inventory, so the assertion above is not green by an empty selection", () => {
    const doc = readBindingInputs({ root: REPO_ROOT }).doc;
    expect(doc.bindings.length > 0).toBe(true);
    expect(doc.classes.length > 0).toBe(true);
  });

  it("found the committed replay fixtures, so the lane-to-register half ran over something", () => {
    expect(readBindingInputs({ root: REPO_ROOT }).fixtures.length > 0).toBe(true);
  });

  it("read every committed fixture manifest, so no real binding went unjudged", () => {
    expect(unreadableFixtures({ inputs: readBindingInputs({ root: REPO_ROOT }) })).toEqual([]);
  });

  it("has no class name that is a substring of another, which is what `testNamesClass` rests on", () => {
    // `testNamesClass` is `text.includes(className)`, so a test naming a LONGER class containing a shorter
    // one would satisfy the shorter one's check and credit the wrong class. That is a property of the NAMES,
    // not of the function, and the failure direction is a false PASS — so it is pinned here rather than left
    // to be noticed. An adversarial review raised it as a latent hazard; this is the pin.
    const names = readBindingInputs({ root: REPO_ROOT }).doc.classes.map((one) => one.name);
    const collisions = names.flatMap((a) => names.filter((b) => b !== a && b.includes(a)).map((b) => `${a} ⊂ ${b}`));
    expect(collisions).toEqual([]);
    expect(names.length > 0).toBe(true);
  });

  it("declares each class exactly once, so the pair check above cannot be satisfied by an empty comparison", () => {
    const names = readBindingInputs({ root: REPO_ROOT }).doc.classes.map((one) => one.name);
    expect(names.length - new Set(names).size).toBe(0);
  });
});
