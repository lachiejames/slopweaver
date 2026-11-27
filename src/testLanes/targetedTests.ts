/**
 * The pure half of `slopweaver dev targeted-tests`: which unit test files a branch's own diff reaches, which nested
 * project's `tsc` it owes, and the commands that run them — once, before a local lap is spent on a red a
 * sub-minute run would have caught first.
 *
 * MEASURED, the finding this answers: one lap went red at its fourth unit shard on `cli/helpTruth.test.ts` about
 * twelve minutes in, after typecheck and three shards passed, while the targeted set at the next head ran 106
 * files and 1,618 tests green in 26 seconds. Another went red about 25 minutes in on `next build` over a site
 * unit test that `site/node_modules/.bin/tsc --noEmit -p site` reports in two seconds.
 *
 * Four rules select a test, each recorded as a reason so the printed list says why every file is there:
 *
 * - `changed-test` — a unit test file the diff itself changed;
 * - `direct-import` — a unit test whose own module specifiers resolve to a changed file (one hop, never
 *   transitive: a transitive graph is a second whole-tree walk, and a central module would select most of the
 *   lane);
 * - `mirrored-directory` — every unit test under the directory mirroring a changed source's (`src/X/y.ts` →
 *   `src/__tests__/unit/X/`), which catches a composed-registry count asserted in a test that never imports
 *   the file that grew; a file directly under a project root mirrors nothing, since its mirror is the lane;
 * - `registry-sweep` — a FIXED set run whatever the diff: the sweeps that judge the whole command, doc and naming
 *   surface, where a new verb or flag fails a test that imports nothing the diff touched.
 *
 * What it leaves out it NAMES on every run ({@link TARGETED_TESTS_NOT_COVERED}), because a green from this
 * narrower bar is otherwise read as the lap's.
 */
import { dirname, extname } from "node:path";
import { err, ok, type Result } from "../lib/result.js";

/** The three unit-lane roots `config/vitest/unit.ts` collects from, each with its trailing slash. */
export const UNIT_TEST_ROOTS: readonly string[] = [
  "src/__tests__/unit/",
  "site/__tests__/unit/",
  "desktop/__tests__/unit/",
];

/** The projects whose source the unit tests mirror: each project's root directory, its unit root beneath it. */
const MIRRORED_PROJECTS: readonly { readonly root: string; readonly unitRoot: string }[] = [
  { root: "src/", unitRoot: "src/__tests__/unit/" },
  { root: "site/", unitRoot: "site/__tests__/unit/" },
  { root: "desktop/", unitRoot: "desktop/__tests__/unit/" },
];

/** The registry-sweep directories, every unit test under each run whatever the diff. */
const REGISTRY_SWEEP_DIRECTORIES: readonly string[] = ["src/__tests__/unit/canon/", "src/__tests__/unit/docs/"];

/**
 * The registry-sweep files, run whatever the diff. Each judges a whole surface — the verb catalogue, the printed
 * commands, the manifest barrel, the naming vocabulary, the skill load gate — so a branch adding a verb or flag
 * goes red here without any of them importing what it changed.
 */
export const REGISTRY_SWEEP_FILES: readonly string[] = [
  "src/__tests__/unit/admit/skillLoadGate.test.ts",
  "src/__tests__/unit/cli/catalogHealth.test.ts",
  "src/__tests__/unit/cli/commands/catalog/run.test.ts",
  "src/__tests__/unit/cli/helpTruth.test.ts",
  "src/__tests__/unit/cli/manifestBarrelClosure.test.ts",
  "src/__tests__/unit/cli/manifests/manifestFamilies.test.ts",
  "src/__tests__/unit/cli/printedCommandsResolve.test.ts",
  "src/__tests__/unit/devLint/namingDoctrine.test.ts",
  "src/__tests__/unit/devLint/namingVocabulary.test.ts",
  "src/__tests__/unit/handover/manifestBarrel.test.ts",
  "src/__tests__/unit/handover/manifestVerbs.test.ts",
];

/** What this verb deliberately does not cover, printed on every run. */
export const TARGETED_TESTS_NOT_COVERED: readonly string[] = [
  "the root typecheck (`tsconfig.json`) — vitest does not typecheck, so a tsc error is the lap's typecheck lane",
  "every lint gate, whole-tree oxlint included — `slopweaver dev lint --lane seat` is the seat's",
  "the subprocess, integration and desktop end-to-end lanes",
  "coverage and the coverage ratchet, including a new `src/` directory's floor row",
  "`next build` and the desktop build, beyond each project's own `tsc --noEmit`",
  "a test reaching a changed file only through another module (transitive imports)",
];

/** Why a test was selected. */
type TargetedTestReason = "changed-test" | "direct-import" | "mirrored-directory" | "registry-sweep";

/** One selected test file and every rule that selected it. */
interface SelectedTargetedTest {
  readonly path: string;
  readonly reasons: readonly TargetedTestReason[];
}

/** A nested project whose own `tsc --noEmit` this diff owes. */
export type TargetedProject = "site" | "desktop";

/** What the diff selected: the test files, and the nested projects to typecheck. */
export interface TargetedTestSelection {
  readonly tests: readonly SelectedTargetedTest[];
  readonly projects: readonly TargetedProject[];
}

/** A registry-sweep file or directory this checkout no longer has, so the fixed set would shrink silently. */
export interface MissingSweepTargetError {
  readonly code: "MISSING_SWEEP_TARGET";
  readonly message: string;
  readonly target: string;
}

/** The {@link MissingSweepTargetError} factory. */
export const TargetedTestsErrors = {
  missingSweepTarget: ({ target }: { target: string }): MissingSweepTargetError => ({
    code: "MISSING_SWEEP_TARGET",
    message:
      `dev targeted-tests: the registry sweep names ${target}, which holds no unit test in this checkout — ` +
      "a renamed sweep must be renamed in `src/testLanes/targetedTests.ts` too, never dropped",
    target,
  }),
} as const;

const REASON_ORDER: readonly TargetedTestReason[] = [
  "changed-test",
  "direct-import",
  "mirrored-directory",
  "registry-sweep",
];

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx", ".mts", ".cts"]);

/**
 * Whether a path is a unit-lane test file: a `*.test.ts` under one of {@link UNIT_TEST_ROOTS}.
 *
 * @param path a repo-relative path
 * @returns true when the unit lane collects it
 */
export function isUnitTestPath({ path }: { path: string }): boolean {
  return path.endsWith(".test.ts") && UNIT_TEST_ROOTS.some((root) => path.startsWith(root));
}

/**
 * The unit directory mirroring a changed source file's, with its trailing slash, or `undefined` for a file that
 * mirrors none: not TypeScript, outside the three projects, or directly under a project root. A non-test file
 * inside a unit root (a shared fixture or table) mirrors its own directory.
 *
 * @param path a repo-relative path of a changed non-test file
 * @returns the directory whose unit tests it selects
 */
export function mirroredUnitDirectory({ path }: { path: string }): string | undefined {
  if (!SOURCE_EXTENSIONS.has(extname(path))) {
    return undefined;
  }
  const directory = `${dirname(path)}/`;
  if (UNIT_TEST_ROOTS.some((root) => directory.startsWith(root))) {
    return UNIT_TEST_ROOTS.includes(directory) ? undefined : directory;
  }
  const project = MIRRORED_PROJECTS.find(({ root }) => directory.startsWith(root));
  if (project === undefined || directory === project.root || directory.startsWith(`${project.root}__tests__/`)) {
    return undefined;
  }
  return `${project.unitRoot}${directory.slice(project.root.length)}`;
}

/**
 * The nested projects a diff owes a `tsc --noEmit` for: `site` for any path under `site/`, whose own tsconfig
 * holds its tests too, and `desktop` for a path under `desktop/src/`, the only tree `desktop/tsconfig.json`
 * includes (the root typecheck covers the desktop unit tests).
 *
 * @param changedPaths every path the diff changed
 * @returns the projects, in a fixed order
 */
export function targetedProjects({ changedPaths }: { changedPaths: readonly string[] }): readonly TargetedProject[] {
  const projects: TargetedProject[] = [];
  if (changedPaths.some((path) => path.startsWith("site/"))) {
    projects.push("site");
  }
  if (changedPaths.some((path) => path.startsWith("desktop/src/"))) {
    projects.push("desktop");
  }
  return projects;
}

/**
 * Select the unit tests a diff reaches by the four rules this module's header names.
 *
 * @param changedPaths every path the diff changed, deleted ones included
 * @param testFiles every unit test file present in the checkout
 * @param importsByTest each test file's own resolved, repo-relative imports — only those naming a changed file
 *   need be present
 * @returns the selection, or the registry-sweep target this checkout no longer holds
 */
export function deriveTargetedTests({
  changedPaths,
  importsByTest,
  testFiles,
}: {
  changedPaths: readonly string[];
  importsByTest: ReadonlyMap<string, readonly string[]>;
  testFiles: readonly string[];
}): Result<TargetedTestSelection, MissingSweepTargetError> {
  const sweep = registrySweepTargets({ testFiles });
  if (sweep.isErr()) {
    return err(sweep.error);
  }
  const reasons = new Map<string, Set<TargetedTestReason>>();
  const picks = [
    ...sweep.value.map((path) => ({ path, reason: "registry-sweep" as const })),
    ...diffReachedTests({ changedPaths, importsByTest, testFiles }),
  ];
  for (const { path, reason } of picks) {
    const held = reasons.get(path);
    if (held === undefined) {
      reasons.set(path, new Set([reason]));
    } else {
      held.add(reason);
    }
  }
  const tests = [...reasons.entries()]
    .map(([path, held]) => ({ path, reasons: REASON_ORDER.filter((reason) => held.has(reason)) }))
    .toSorted((a, b) => (a.path < b.path ? -1 : 1));
  return ok({ projects: targetedProjects({ changedPaths }), tests });
}

/**
 * Every registry-sweep test file, refusing when a named file or a directory's every test is gone, so a renamed
 * sweep is a red rather than a smaller sweep.
 *
 * @param testFiles every unit test file present in the checkout
 * @returns the sweep's files, or the first target this checkout no longer holds
 */
function registrySweepTargets({
  testFiles,
}: {
  testFiles: readonly string[];
}): Result<readonly string[], MissingSweepTargetError> {
  const present = new Set(testFiles);
  const missingFile = REGISTRY_SWEEP_FILES.find((target) => !present.has(target));
  if (missingFile !== undefined) {
    return err(TargetedTestsErrors.missingSweepTarget({ target: missingFile }));
  }
  const held = REGISTRY_SWEEP_DIRECTORIES.map((directory) => ({
    directory,
    files: testFiles.filter((path) => path.startsWith(directory)),
  }));
  const emptyDirectory = held.find(({ files }) => files.length === 0);
  if (emptyDirectory !== undefined) {
    return err(TargetedTestsErrors.missingSweepTarget({ target: emptyDirectory.directory }));
  }
  return ok([...REGISTRY_SWEEP_FILES, ...held.flatMap(({ files }) => files)]);
}

/**
 * The tests the diff itself reaches, one entry per rule that reached each: a changed test still present, a test
 * importing a changed file directly, and every test under a changed source's mirrored directory.
 *
 * @param changedPaths every path the diff changed
 * @param importsByTest each test file's own resolved, repo-relative imports
 * @param testFiles every unit test file present in the checkout
 * @returns the path and reason of each selection, unordered and possibly repeating a path
 */
function diffReachedTests({
  changedPaths,
  importsByTest,
  testFiles,
}: {
  changedPaths: readonly string[];
  importsByTest: ReadonlyMap<string, readonly string[]>;
  testFiles: readonly string[];
}): readonly { readonly path: string; readonly reason: TargetedTestReason }[] {
  const present = new Set(testFiles);
  const changed = new Set(changedPaths);
  const mirrors = changedPaths.flatMap((path) => {
    const mirror = isUnitTestPath({ path }) ? undefined : mirroredUnitDirectory({ path });
    return mirror === undefined ? [] : [mirror];
  });
  return [
    ...changedPaths
      .filter((path) => isUnitTestPath({ path }) && present.has(path))
      .map((path) => ({ path, reason: "changed-test" as const })),
    ...testFiles
      .filter(
        (path) => importsByTest.get(path)?.some((imported) => imported !== path && changed.has(imported)) === true,
      )
      .map((path) => ({ path, reason: "direct-import" as const })),
    ...testFiles
      .filter((path) => mirrors.some((mirror) => path.startsWith(mirror)))
      .map((path) => ({ path, reason: "mirrored-directory" as const })),
  ];
}

/** One command the verb runs, from the repository root. */
export interface TargetedTestStep {
  readonly label: string;
  readonly argv: readonly string[];
}

/**
 * The commands a selection runs, in order: each nested project's `tsc --noEmit` first, because each takes seconds
 * and should not wait behind the tests, then ONE vitest run over every selected file under the unit lane's own
 * config, coverage off (the ratchet is the lap's).
 *
 * @param selection what {@link deriveTargetedTests} selected
 * @returns the steps, each an argv relative to the repository root
 */
export function targetedTestSteps({ selection }: { selection: TargetedTestSelection }): readonly TargetedTestStep[] {
  const projectSteps = selection.projects.map((project): TargetedTestStep => ({
    argv: [`${project}/node_modules/.bin/tsc`, "--noEmit", "--incremental", "false", "-p", `${project}/tsconfig.json`],
    label: `${project} tsc --noEmit`,
  }));
  return [
    ...projectSteps,
    {
      argv: [
        "node_modules/.bin/vitest",
        "run",
        "--config",
        "config/vitest/unit.ts",
        "--coverage=false",
        ...selection.tests.map(({ path }) => path),
      ],
      label: `vitest over ${String(selection.tests.length)} unit test file(s)`,
    },
  ];
}

/**
 * The file names whose appearance in a module specifier could name a changed source file: each changed TypeScript
 * file's stem, and for an `index` file its directory's name, since `./dir` resolves to `dir/index.ts`. A test whose
 * text names none of them cannot import a changed file directly, so its specifiers need no resolving.
 *
 * @param changedPaths every path the diff changed
 * @returns the stems
 */
export function changedModuleStems({ changedPaths }: { changedPaths: readonly string[] }): ReadonlySet<string> {
  const stems = new Set<string>();
  for (const path of changedPaths) {
    const extension = extname(path);
    if (SOURCE_EXTENSIONS.has(extension) && !isUnitTestPath({ path })) {
      const stem = path.slice(path.lastIndexOf("/") + 1, path.length - extension.length);
      stems.add(stem);
      if (stem === "index") {
        const directory = dirname(path);
        stems.add(directory.slice(directory.lastIndexOf("/") + 1));
      }
    }
  }
  return stems;
}

/** One configured alias — a tsconfig `paths` key or a package.json `imports` key — and every target it maps to. */
export interface ModuleAlias {
  readonly pattern: string;
  readonly targets: readonly string[];
}

/**
 * The aliases one parsed config declares: a tsconfig's `compilerOptions.paths`, or a package.json's `imports`, whose
 * value may be a string, an array or a conditions object, every string leaf a target.
 *
 * @param kind which file the value was parsed from
 * @param value the parsed file
 * @returns each alias with every target it may map to; none for a config that declares none
 */
export function moduleAliasesOf({ kind, value }: { kind: "tsconfig" | "package"; value: unknown }): ModuleAlias[] {
  const table =
    kind === "tsconfig"
      ? fieldOf({ key: "paths", value: fieldOf({ key: "compilerOptions", value }) })
      : fieldOf({ key: "imports", value });
  if (!isPlainObject(table)) {
    return [];
  }
  return Object.entries(table).map(([pattern, target]) => ({ pattern, targets: stringLeaves({ value: target }) }));
}

/**
 * Whether a parsed tsconfig inherits from another. Neither {@link moduleAliasesOf} nor the resolver this verb borrows
 * follows `extends`, so an inherited `paths` entry would be invisible: a config that declares one is refused rather
 * than read as declaring only its own aliases.
 *
 * @param value the parsed tsconfig
 * @returns true when it carries an `extends` field of any shape
 */
export function tsconfigExtends({ value }: { value: unknown }): boolean {
  return fieldOf({ key: "extends", value }) !== undefined;
}

/** One field of an object value, or `undefined` for a missing field or a value that is not an object. */
function fieldOf({ key, value }: { key: string; value: unknown }): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

/** Whether a parsed value is a plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every string inside a parsed value, depth first. */
function stringLeaves({ value }: { value: unknown }): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => stringLeaves({ value: item }));
  }
  if (isPlainObject(value)) {
    return Object.values(value).flatMap((item) => stringLeaves({ value: item }));
  }
  return [];
}

/** An alias whose spelling need not carry the stem of the file it resolves to. */
export interface StemChangingAlias {
  /** The text every matching specifier starts with: the pattern itself, or what precedes its `*`. */
  readonly prefix: string;
  /** True for a pattern without `*`, which matches only itself. */
  readonly exact: boolean;
}

/** A target's last segment that substitutes the matched text as the file name, so its stem survives. */
const STEM_PRESERVING_SEGMENT = /^\*(\.[A-Za-z0-9]+)?$/;

/**
 * The aliases the stem prefilter cannot see through: every one but a wildcard whose pattern ends in `*` and whose
 * every target ends in a `*` or `*.<ext>` segment (`#lib/*` → `./src/lib/*`, `@/*` → `./*`), since only that shape
 * keeps the resolved file's stem as the specifier's last segment. `"@/shortcut": ["./lib/foo.ts"]` is not that
 * shape, so a specifier matching it is resolved whatever it spells.
 *
 * @param aliases every alias the checkout's configs declare
 * @returns the aliases whose matching specifiers must always be resolved
 */
export function stemChangingAliases({ aliases }: { aliases: readonly ModuleAlias[] }): readonly StemChangingAlias[] {
  return aliases.flatMap(({ pattern, targets }): StemChangingAlias[] => {
    const star = pattern.indexOf("*");
    const preserving =
      star === pattern.length - 1 &&
      targets.length > 0 &&
      targets.every((target) => STEM_PRESERVING_SEGMENT.test(target.slice(target.lastIndexOf("/") + 1)));
    if (preserving) {
      return [];
    }
    return [{ exact: star < 0, prefix: star < 0 ? pattern : pattern.slice(0, star) }];
  });
}

/**
 * Whether a specifier matches one of the aliases the stem prefilter cannot see through.
 *
 * @param specifier the specifier as written
 * @param aliases what {@link stemChangingAliases} returned
 * @returns true when it must be resolved whatever its last segment spells
 */
export function specifierMatchesAlias({
  specifier,
  aliases,
}: {
  specifier: string;
  aliases: readonly StemChangingAlias[];
}): boolean {
  return aliases.some(({ prefix, exact }) => (exact ? specifier === prefix : specifier.startsWith(prefix)));
}

/**
 * Whether a module specifier's last segment, its extension dropped, is one of `stems` — with
 * {@link specifierMatchesAlias}, the only specifiers worth handing the compiler's resolver.
 *
 * @param specifier the specifier as written (`../lib/result.js`, `#lib/result.js`, `@/lib/queueCard`)
 * @param stems what {@link changedModuleStems} returned
 * @returns true when it may name a changed file
 */
export function specifierMayName({ specifier, stems }: { specifier: string; stems: ReadonlySet<string> }): boolean {
  const last = specifier.slice(specifier.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return stems.has(dot > 0 ? last.slice(0, dot) : last);
}
