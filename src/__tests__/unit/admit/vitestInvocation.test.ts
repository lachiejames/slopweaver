/**
 * The whole-test-lane half of the seat gate: which `vitest` runs are one of CI's test lanes, and which
 * are the files a seat touched. Every refused row is a shape a seat typed, trimmed;
 * every allowed row is either one too, or the false refusal a first draft made on real seat traffic.
 */
import { describe, expect, it } from "vitest";

import { vitestLane } from "../../../admit/vitestInvocation.js";
import { optionValueWords, VITEST_BOOLEAN_OPTIONS } from "../../../admit/vitestOptions.js";
import { classifyWholeTreeCheck } from "../../../admit/wholeTreeCheck.js";

/**
 * Vitest's own argv parser, the oracle for {@link VITEST_BOOLEAN_OPTIONS}. `vitest/node` is named through a
 * variable so TypeScript does not resolve it: statically imported, it loads vite's declarations into the
 * `named-object-params` gate's whole-repo Program for nothing that gate reads — MEASURED: 4463 MiB
 * live heap against 4440 without it, on a 4456 MiB budget (`yarn tsx --expose-gc --max-old-space-size=8192
 * src/devLint/namedObjectParams.entry.ts`).
 */
const VITEST_NODE: string = "vitest/node";
const { parseCLI } = (await import(VITEST_NODE)) as {
  parseCLI: (argv: readonly string[]) => { readonly filter: readonly string[] };
};

/** A seat's working directory: a Slopweaver worktree. */
const SEAT = "/Users/someone/dev/personal/slopweaver/.claude/worktrees.noindex/some-seat";

/** What the whole gate said about one command run from {@link SEAT}, as the refusal would name it. */
function what({ command, cwd = SEAT }: { command: string; cwd?: string }): string {
  const judged = classifyWholeTreeCheck({ command, cwd });
  return judged.kind === "whole-tree" ? judged.what : "allowed";
}

/** Whole lanes a seat ran, each with how the refusal names it. */
const REFUSED: readonly (readonly [string, string])[] = [
  ["yarn vitest run --config config/vitest/unit.ts 2>&1 | tail -8", "vitest (a whole test lane, no file named)"],
  [
    "NODE_OPTIONS=--max-old-space-size=8192 yarn vitest run --config config/vitest/unit.ts 2>&1 | grep FAIL",
    "vitest (a whole test lane, no file named)",
  ],
  [
    "yarn vitest run --config config/vitest/unit.ts --coverage.enabled=false",
    "vitest (a whole test lane, no file named)",
  ],
  [
    "/usr/bin/time -p yarn vitest run --config config/vitest/unit.ts --reporter=json --outputFile=/tmp/x.json",
    "vitest (a whole test lane, no file named)",
  ],
  [
    "node_modules/.bin/vitest run --config config/vitest/unit.ts --shard=1/2",
    "vitest (a whole test lane, no file named)",
  ],
  ["yarn vitest run --config config/vitest/integration.ts", "vitest (a whole test lane, no file named)"],
  ["npx vitest run -t 'names its failure'", "vitest (a whole test lane, no file named)"],
  // The word `xargs` feeds nothing unless it is the wrapper that reaches the program.
  ["npx vitest run -t xargs", "vitest (a whole test lane, no file named)"],
  // An option's value, or a later word, is never the subcommand.
  ["yarn vitest run --config config/vitest/unit.ts -t related", "vitest (a whole test lane, no file named)"],
  ["yarn vitest run --config config/vitest/unit.ts -t list", "vitest (a whole test lane, no file named)"],
  ["yarn vitest run -- --changed", "vitest (a whole test lane, no file named)"],
  // A filter inside what every path of the lane holds selects all of it.
  ["yarn vitest run --config config/vitest/unit.ts __tests__/unit", "vitest over __tests__/unit (a whole test lane)"],
  ["yarn test:unit unit", "yarn test:unit over unit (a whole test lane)"],
  ["yarn test:unit test", "yarn test:unit over test (a whole test lane)"],
  ["npx vitest run --config config/vitest/unit.ts .test.ts", "vitest over .test.ts (a whole test lane)"],
  ["yarn test:subprocess __tests__/subprocess/", "yarn test:subprocess over __tests__/subprocess/ (a whole test lane)"],
  // An absolute lane root is the lane from any directory.
  ["yarn vitest run --root . --config config/vitest/unit.ts", "vitest over . (a whole test lane)"],
  [`cd config && yarn vitest run --root ${SEAT} --config vitest/unit.ts`, `vitest over ${SEAT} (a whole test lane)`],
  [
    `cd config && yarn vitest run --root .. --config vitest/unit.ts ${SEAT}/src/__tests__/unit`,
    `vitest over ${SEAT}/src/__tests__/unit (a whole test lane)`,
  ],
  [
    `cd src/__tests__/unit/admit && yarn vitest run --root ${SEAT} --config ${SEAT}/config/vitest/unit.ts ${SEAT}/src/__tests__/unit`,
    `vitest over ${SEAT}/src/__tests__/unit (a whole test lane)`,
  ],
  // `.` is a substring of every test path, so it is the lane from any directory.
  [
    "cd src/__tests__/unit/admit && npx vitest run --config ../../../../config/vitest/unit.ts .",
    "vitest over . (a whole test lane)",
  ],
  ["git diff --name-only | xargs echo && yarn test:unit", "yarn test:unit (a whole test lane, no file named)"],
  [
    "NODE_OPTIONS=--max-old-space-size=8192 yarn test:unit 2>&1 | tail -12",
    "yarn test:unit (a whole test lane, no file named)",
  ],
  ["yarn test:subprocess", "yarn test:subprocess (a whole test lane, no file named)"],
  ["npm run test:integration", "yarn test:integration (a whole test lane, no file named)"],
  // vitest's parser hands every word after `--` to options["--"], never to the filters.
  [
    "yarn vitest run --config config/vitest/unit.ts -- src/__tests__/unit/admit/vitestInvocation.test.ts",
    "vitest (a whole test lane, no file named)",
  ],
  ["yarn test:unit -- --", "yarn test:unit (a whole test lane, no file named)"],
  // A filter that climbs out of its directory is read as climbing to the checkout's root.
  ["cd config && yarn vitest run --root .. --config vitest/unit.ts", "vitest over .. (a whole test lane)"],
  [
    "yarn vitest run --dir src/__tests__/unit --config config/vitest/unit.ts",
    "vitest over src/__tests__/unit (a whole test lane)",
  ],
  [
    "yarn vitest run --root . --config config/vitest/unit.ts src/__tests__/unit",
    "vitest over src/__tests__/unit (a whole test lane)",
  ],
  [
    "cd site && yarn vitest run --config ../config/vitest/unit.ts ../src/__tests__/unit/",
    "vitest over ../src/__tests__/unit/ (a whole test lane)",
  ],
  [
    "yarn vitest run --config config/vitest/unit.ts ./src/admit/../__tests__/unit",
    "vitest over ./src/admit/../__tests__/unit (a whole test lane)",
  ],
  [
    "yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/",
    "vitest over src/__tests__/unit/ (a whole test lane)",
  ],
  [
    "yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/cli src/__tests__/subprocess",
    "vitest over src/__tests__/subprocess (a whole test lane)",
  ],
  [
    `yarn vitest run --config config/vitest/unit.ts ${SEAT}/src/__tests__/unit`,
    `vitest over ${SEAT}/src/__tests__/unit (a whole test lane)`,
  ],
  ["yarn vitest run --config config/vitest/unit.ts ./src/", "vitest over ./src/ (a whole test lane)"],
  [
    "git status && yarn lint:local && yarn vitest run --config config/vitest/unit.ts",
    "vitest (a whole test lane, no file named)",
  ],
  ["bash -c 'yarn vitest run --config config/vitest/unit.ts'", "vitest (a whole test lane, no file named)"],
  // Vitest's own launcher, run by node, never reached the lane judgement.
  [
    "node node_modules/vitest/vitest.mjs run --config config/vitest/unit.ts",
    "vitest (a whole test lane, no file named)",
  ],
  ["node ./node_modules/.bin/vitest run src/__tests__/unit", "vitest over src/__tests__/unit (a whole test lane)"],
  // An option's separate value read as a filter made the lane look narrowed.
  [
    "yarn vitest run --config config/vitest/unit.ts --coverage.provider v8",
    "vitest (a whole test lane, no file named)",
  ],
  ["yarn vitest run --config config/vitest/unit.ts --pool forks", "vitest (a whole test lane, no file named)"],
  // A no-test switch handed `false`, and a boolean's spaced `false` read as a filter.
  ["yarn vitest run --config config/vitest/unit.ts --standalone=false", "vitest (a whole test lane, no file named)"],
  ["yarn vitest run --config config/vitest/unit.ts --clearCache false", "vitest (a whole test lane, no file named)"],
  [
    "yarn vitest run --config config/vitest/unit.ts --coverage.enabled false",
    "vitest (a whole test lane, no file named)",
  ],
];

/** Targeted runs, and runs that run no lane at all. */
const ALLOWED: readonly string[] = [
  "yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/admit/wholeTreeCheck.test.ts 2>&1 | tail -20",
  "yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/cli/helpTruth.test.ts src/__tests__/unit/x.test.ts",
  "yarn test:unit github/merge --coverage.enabled=false",
  // Yarn and npm drop a leading `--` before the script sees it.
  "yarn test:unit -- src/__tests__/unit/admit/vitestInvocation.test.ts",
  // Only the first positional word is vitest's subcommand; a later one is a name filter.
  "yarn vitest run --config config/vitest/unit.ts run",
  "yarn vitest --config config/vitest/unit.ts run watch",
  "yarn test:unit run",
  "yarn test:unit list",
  // A scope names a directory, resolved against the run's own.
  "cd src/__tests__/unit/admit && yarn vitest run --root . --config ../../../../config/vitest/unit.ts",
  "cd src && yarn vitest run --dir __tests__/unit/admit --config ../config/vitest/unit.ts",
  `cd config && yarn vitest run --root .. --config vitest/unit.ts ${SEAT}/src/__tests__/unit/admit`,
  "cd site && yarn vitest run --config ../config/vitest/unit.ts ../src/__tests__/unit/admit",
  "cd config && yarn vitest run --root .. --config vitest/unit.ts src/__tests__/unit/admit",
  // A name another lane's paths share still narrows this one.
  "yarn test:unit process",
  "yarn test:subprocess unit",
  "yarn vitest run --config config/vitest/integration.ts unit",
  // The run's own directory named absolutely is that directory, not the lane.
  `cd src/__tests__/unit/admit && yarn vitest run --root ${SEAT} --config ${SEAT}/config/vitest/unit.ts ${SEAT}/src/__tests__/unit/admit`,
  // A scope narrows alongside the filters, never beside them.
  "yarn vitest run --root . --config config/vitest/unit.ts src/__tests__/unit/admit/vitestInvocation.test.ts",
  "yarn vitest run --dir src/__tests__/unit/admit --config config/vitest/unit.ts",
  "npm run test:unit -- src/__tests__/unit/admit/vitestInvocation.test.ts",
  "yarn test:unit src/__tests__/unit/admit/vitestInvocation.test.ts -- --reporter=verbose",
  "yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/handover/ src/__tests__/unit/admit",
  "yarn vitest run --config config/vitest/unit.ts $(git diff --name-only origin/main -- '*.test.ts')",
  // The site's and the desktop shell's own suites are their projects' runs, not the lane.
  "yarn vitest run --config config/vitest/unit.ts site/__tests__/unit/",
  "yarn vitest run --config config/vitest/unit.ts desktop/__tests__/unit/",
  // False refusals a first draft made on the week of seat traffic.
  "git diff --name-only | grep -v subprocess | xargs yarn vitest run --config config/vitest/unit.ts 2>&1 | grep Tests",
  "yarn vitest run --config config/vitest/unit.ts --merge-reports --coverage > merge.log 2>&1",
  "node_modules/.bin/vitest run --config config/vitest/unit.ts --merge-reports=/tmp/r --reporter=json",
  "yarn vitest run --root ./tmp-probe --reporter verbose 2>&1 | head -20",
  "node_modules/.bin/vitest list --config config/vitest/unit.ts --filesOnly",
  "yarn vitest --help",
  "yarn vitest --standalone",
  "printf '%s\\0' src/__tests__/unit/admit/vitestInvocation.test.ts | xargs -0 yarn test:unit",
  "yarn vitest --standalone=true",
  "yarn vitest run --config config/vitest/unit.ts --coverage.enabled false src/__tests__/unit/admit/vitestInvocation.test.ts",
  "yarn vitest run --config config/vitest/unit.ts --no-coverage src/__tests__/unit/admit/vitestInvocation.test.ts",
  "yarn vitest run --config config/vitest/unit.ts --passWithNoTests src/__tests__/unit/admit/vitestInvocation.test.ts",
  "yarn vitest --clearCache",
  "yarn vitest run --clear-cache",
  "yarn vitest --list-tags=json",
  "node_modules/.bin/vitest run --config config/vitest/unit.ts --mergeReports",
  "vitest related src/admit/wholeTreeCheck.ts --run",
  "echo yarn vitest run --config config/vitest/unit.ts",
  "pgrep -fl vitest",
  "node node_modules/vitest/vitest.mjs run --config config/vitest/unit.ts src/__tests__/unit/admit/vitestInvocation.test.ts",
  "git diff --name-only | xargs node node_modules/vitest/vitest.mjs run --config config/vitest/unit.ts",
  "SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 yarn vitest run --config config/vitest/unit.ts",
];

describe("vitest whole-lane runs", () => {
  it("has cases to judge", () => {
    expect(REFUSED.length).toBeGreaterThan(0);
    expect(ALLOWED.length).toBeGreaterThan(0);
  });

  it.each(REFUSED)("refuses %s", (command, expected) => {
    expect(what({ command })).toBe(expected);
  });

  it.each(ALLOWED)("allows %s", (command) => {
    expect(what({ command })).toBe("allowed");
  });

  it("leaves another repository's package suite to that repository", () => {
    const acmeAdmin = "/Users/someone/dev/acme-admin/.claude/worktrees.noindex/a-seat/packages/resolvers";
    expect(what({ command: "npx vitest run --project unit", cwd: acmeAdmin })).toBe("allowed");
    expect(what({ command: `cd ${acmeAdmin} && yarn vitest run --project integration` })).toBe("allowed");
  });

  it("reads the checkout root off --config in any worktree layout", () => {
    const other = "/Users/someone/dev/slopweaver/worktrees/seat";
    expect(what({ command: "yarn vitest run --root . --config config/vitest/unit.ts", cwd: other })).toBe(
      "vitest over . (a whole test lane)",
    );
    expect(what({ command: "yarn vitest run --root=. --config=config/vitest/unit.ts", cwd: other })).toBe(
      "vitest over . (a whole test lane)",
    );
    const below = `${other}/src/__tests__/unit/admit`;
    expect(what({ command: "yarn vitest run --root . --config ../../../../config/vitest/unit.ts", cwd: below })).toBe(
      "allowed",
    );
  });

  it("resolves a lane script's scope at the checkout root, where Yarn runs it", () => {
    expect(what({ command: "cd src/__tests__/unit/admit && yarn test:unit --root ." })).toBe(
      "yarn test:unit over . (a whole test lane)",
    );
    expect(what({ command: "cd config && yarn test:unit --dir src/__tests__/unit/admit" })).toBe("allowed");
  });

  it("roots a checkout at its LAST slopweaver component", () => {
    const nested = "/Users/slopweaver/projects/slopweaver";
    expect(what({ command: `yarn test:unit --root ${nested}`, cwd: nested })).toBe(
      `yarn test:unit over ${nested} (a whole test lane)`,
    );
    expect(what({ command: `cd src/__tests__/unit/admit && yarn test:unit --root ${nested}`, cwd: nested })).toBe(
      `yarn test:unit over ${nested} (a whole test lane)`,
    );
    expect(what({ command: `yarn test:unit --root ${nested}/src/__tests__/unit/admit`, cwd: nested })).toBe("allowed");
  });

  it("judges a run by the directory a cd leaves it in", () => {
    expect(what({ command: `cd ${SEAT} && yarn vitest run --config config/vitest/unit.ts`, cwd: "/tmp" })).toBe(
      "vitest (a whole test lane, no file named)",
    );
  });
});

describe("vitestLane", () => {
  it("reads --config's value as the option's, never as a filter", () => {
    expect(vitestLane({ args: ["run", "--config", "config/vitest/unit.ts"], cwd: SEAT, label: "vitest" })).toBe(
      "vitest (a whole test lane, no file named)",
    );
  });

  it("reads --dir and --root as narrowing filters, in either spelling", () => {
    expect(vitestLane({ args: ["run", "--dir", "src/__tests__/unit/admit"], cwd: SEAT, label: "vitest" })).toBe(
      undefined,
    );
    expect(vitestLane({ args: ["run", "--root=src"], cwd: SEAT, label: "vitest" })).toBe(
      "vitest over src (a whole test lane)",
    );
  });

  it("names the lane root as written, relative to the run's directory", () => {
    expect(vitestLane({ args: ["run", SEAT], cwd: SEAT, label: "vitest" })).toBe(
      `vitest over ${SEAT} (a whole test lane)`,
    );
    expect(vitestLane({ args: ["run", "."], cwd: undefined, label: "vitest" })).toBe(
      "vitest over . (a whole test lane)",
    );
  });
});

/** The filters vitest's own parser finds after one option word and a probe word. */
function parsedFilters({ option }: { option: string }): readonly string[] {
  return parseCLI(["vitest", "run", option, "probe"]).filter;
}

describe("VITEST_BOOLEAN_OPTIONS", () => {
  const listed = [...VITEST_BOOLEAN_OPTIONS].filter((name) => !["h", "help", "v", "version"].includes(name));

  it("has options to judge", () => {
    expect(listed.length).toBeGreaterThan(0);
  });

  it.each(listed)("the installed vitest reads --%s as taking no value", (name) => {
    const option = name.length === 1 ? `-${name}` : `--${name}`;
    expect(parsedFilters({ option })).toEqual(["probe"]);
    expect(optionValueWords({ next: "probe", word: option })).toBe(0);
  });

  it.each(["--coverage.provider", "--pool", "--reporter", "-t", "--an-option-vitest-never-declared"])(
    "agrees with the installed vitest that %s takes the next word",
    (option) => {
      expect(parsedFilters({ option })).toEqual([]);
      expect(optionValueWords({ next: "probe", word: option })).toBe(1);
    },
  );

  it("agrees that a boolean takes a spaced true or false, and nothing else", () => {
    expect(parseCLI(["vitest", "run", "--coverage.enabled", "false", "probe"]).filter).toEqual(["probe"]);
    expect(optionValueWords({ next: "false", word: "--coverage.enabled" })).toBe(1);
    expect(optionValueWords({ next: "probe", word: "--coverage.enabled" })).toBe(0);
  });

  it("agrees that a --no- negation and an attached value take nothing", () => {
    expect(parsedFilters({ option: "--no-coverage" })).toEqual(["probe"]);
    expect(optionValueWords({ next: "probe", word: "--no-coverage" })).toBe(0);
    expect(parsedFilters({ option: "--pool=forks" })).toEqual(["probe"]);
    expect(optionValueWords({ next: "probe", word: "--pool=forks" })).toBe(0);
  });
});
