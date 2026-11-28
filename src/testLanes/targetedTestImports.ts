/**
 * The effectful half of `dev targeted-tests`' selection: list the unit test files present in a checkout, and resolve
 * each one's own module specifiers to the repo-relative files the compiler would load — only the specifiers that
 * could name a changed file ({@link changedModuleStems}), or that match an alias whose spelling need not carry the
 * target's stem ({@link stemChangingAliases}), so a diff touching three files resolves a few dozen specifiers rather
 * than every import in the unit lane.
 *
 * Resolution is the compiler's own (`withTsModuleResolver`), under each test's project config: the root
 * `tsconfig.json` for `src/` and `desktop/` tests, `site/tsconfig.json` for `site/` tests (its `@/*` paths), so a
 * `.js` specifier naming a `.ts` file and a `#lib/…` subpath import both resolve as they compile.
 *
 * The residue, stated rather than discovered: a DELETED file resolves to nothing at HEAD, so its importers are not
 * selected by import; its mirrored directory still is, and the lap's typecheck reports the dangling import.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { gitNulFields } from "../devLint/gitAtCommit.js";
import { err, ok, type Result } from "../lib/result.js";
import { readConfigText, withTsModuleResolver } from "../lib/tsProject.js";
import { moduleSpecifiers } from "../lib/tsSyntax.js";
import {
  changedModuleStems,
  isUnitTestPath,
  type ModuleAlias,
  moduleAliasesOf,
  type StemChangingAlias,
  specifierMatchesAlias,
  specifierMayName,
  stemChangingAliases,
  tsconfigExtends,
  UNIT_TEST_ROOTS,
} from "./targetedTests.js";

/** Why the inventory could not be read — each a state, never a verdict on the code under test. */
export type TargetedInventoryError =
  | { readonly code: "TEST_LIST_UNREADABLE"; readonly message: string }
  | { readonly code: "TEST_FILE_UNREADABLE"; readonly message: string; readonly path: string }
  | { readonly code: "ALIAS_CONFIG_UNREADABLE"; readonly message: string; readonly config: string }
  | { readonly code: "RESOLVER_UNAVAILABLE"; readonly message: string; readonly config: string };

/** The {@link TargetedInventoryError} factories. */
const TargetedInventoryErrors = {
  aliasConfigUnreadable: ({ config, detail }: { config: string; detail: string }): TargetedInventoryError => ({
    code: "ALIAS_CONFIG_UNREADABLE",
    config,
    message: `dev targeted-tests: cannot read the aliases ${config} declares (${detail}), so an aliased import is unknown`,
  }),
  resolverUnavailable: ({ config, detail }: { config: string; detail: string }): TargetedInventoryError => ({
    code: "RESOLVER_UNAVAILABLE",
    config,
    message: `dev targeted-tests: cannot resolve imports under ${config} (${detail})`,
  }),
  testFileUnreadable: ({ path, detail }: { path: string; detail: string }): TargetedInventoryError => ({
    code: "TEST_FILE_UNREADABLE",
    message: `dev targeted-tests: cannot read ${path} (${detail}), so its imports are unknown`,
    path,
  }),
  testListUnreadable: (): TargetedInventoryError => ({
    code: "TEST_LIST_UNREADABLE",
    message: "dev targeted-tests: `git ls-files` over the unit roots failed, so no test inventory exists",
  }),
} as const;

/** The configs whose aliases a unit test's specifier may go through, each with the field it declares them in. */
const ALIAS_CONFIGS: readonly { readonly config: string; readonly kind: "tsconfig" | "package" }[] = [
  { config: "tsconfig.json", kind: "tsconfig" },
  { config: "site/tsconfig.json", kind: "tsconfig" },
  { config: "desktop/tsconfig.json", kind: "tsconfig" },
  { config: "package.json", kind: "package" },
  { config: "site/package.json", kind: "package" },
  { config: "desktop/package.json", kind: "package" },
];

/** Every unit test present, and the resolved imports of those that may import a changed file. */
export interface TargetedTestInventory {
  readonly testFiles: readonly string[];
  readonly importsByTest: ReadonlyMap<string, readonly string[]>;
}

/** One test file and the specifiers in it worth handing the resolver. */
interface TestCandidates {
  readonly path: string;
  readonly specifiers: readonly string[];
}

/** A thrown value's own text. */
function thrownText({ thrown }: { thrown: unknown }): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Every unit test file present in the checkout: the tracked ones still on disk, and any untracked one the diff
 * added, so a test written before it was staged still runs.
 *
 * @param root the repository root
 * @param changedPaths every path the diff changed
 * @returns the repo-relative paths, sorted, or why git could not list them
 */
function presentUnitTests({
  root,
  changedPaths,
}: {
  root: string;
  changedPaths: readonly string[];
}): Result<readonly string[], TargetedInventoryError> {
  const tracked = gitNulFields({ args: ["ls-files", "-z", "--", ...UNIT_TEST_ROOTS], root });
  if (tracked === undefined) {
    return err(TargetedInventoryErrors.testListUnreadable());
  }
  const candidates = new Set([...tracked, ...changedPaths].filter((path) => isUnitTestPath({ path })));
  return ok([...candidates].filter((path) => existsSync(join(root, path))).toSorted());
}

/**
 * Every alias the checkout's configs declare, from {@link ALIAS_CONFIGS}; a config absent from this checkout
 * declares none, while one present that does not parse, or a tsconfig inheriting through `extends`, is refused
 * rather than read as declaring none.
 *
 * @param root the repository root
 * @returns the aliases, or the first config that could not be read
 */
function readModuleAliases({ root }: { root: string }): Result<readonly ModuleAlias[], TargetedInventoryError> {
  const aliases: ModuleAlias[] = [];
  for (const { config, kind } of ALIAS_CONFIGS) {
    const fileName = join(root, config);
    if (!existsSync(fileName)) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(fileName, "utf8");
    } catch (thrown: unknown) {
      return err(TargetedInventoryErrors.aliasConfigUnreadable({ config, detail: thrownText({ thrown }) }));
    }
    const parsed = readConfigText({ configFileName: fileName, text });
    if (parsed.isErr()) {
      return err(TargetedInventoryErrors.aliasConfigUnreadable({ config, detail: parsed.error.message }));
    }
    if (kind === "tsconfig" && tsconfigExtends({ value: parsed.value })) {
      return err(
        TargetedInventoryErrors.aliasConfigUnreadable({
          config,
          detail: "it declares `extends`, which this reader does not follow, so an inherited alias is unknown",
        }),
      );
    }
    for (const alias of moduleAliasesOf({ kind, value: parsed.value })) {
      aliases.push(alias);
    }
  }
  return ok(aliases);
}

/**
 * The specifiers in one test's text worth resolving: each whose last segment names a changed stem, or which matches
 * a stem-changing alias. A text naming no stem and no alias prefix is never parsed.
 *
 * @param path the test's repo-relative path, naming it to the parser
 * @param text the test's contents
 * @param stems what {@link changedModuleStems} returned
 * @param aliases what {@link stemChangingAliases} returned
 * @returns the specifiers, possibly none
 */
export function candidateSpecifiers({
  path,
  text,
  stems,
  aliases,
}: {
  path: string;
  text: string;
  stems: ReadonlySet<string>;
  aliases: readonly StemChangingAlias[];
}): readonly string[] {
  if (stems.size === 0) {
    return [];
  }
  const mayReach =
    [...stems].some((stem) => text.includes(stem)) || aliases.some(({ prefix }) => text.includes(prefix));
  if (!mayReach) {
    return [];
  }
  return moduleSpecifiers({ fileName: path, text }).filter(
    (specifier) => specifierMayName({ specifier, stems }) || specifierMatchesAlias({ aliases, specifier }),
  );
}

/**
 * Read each present test and keep those with a specifier worth resolving, grouped by the config that resolves it.
 *
 * @param root the repository root
 * @param testFiles every unit test file present
 * @param stems what {@link changedModuleStems} returned
 * @param aliases what {@link stemChangingAliases} returned
 * @returns the candidates under each config, or the first test that could not be read
 */
function groupCandidates({
  root,
  testFiles,
  stems,
  aliases,
}: {
  root: string;
  testFiles: readonly string[];
  stems: ReadonlySet<string>;
  aliases: readonly StemChangingAlias[];
}): Result<ReadonlyMap<string, readonly TestCandidates[]>, TargetedInventoryError> {
  const groups = new Map<string, TestCandidates[]>([
    ["tsconfig.json", []],
    ["site/tsconfig.json", []],
  ]);
  for (const path of testFiles) {
    let text: string;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch (thrown: unknown) {
      return err(TargetedInventoryErrors.testFileUnreadable({ detail: thrownText({ thrown }), path }));
    }
    const specifiers = candidateSpecifiers({ aliases, path, stems, text });
    if (specifiers.length > 0) {
      groups.get(path.startsWith("site/") ? "site/tsconfig.json" : "tsconfig.json")!.push({ path, specifiers });
    }
  }
  return ok(groups);
}

/**
 * Resolve one group of tests' candidate specifiers under one config.
 *
 * @param root the repository root
 * @param config the tsconfig path, repo-relative
 * @param candidates each test path with the specifiers worth resolving
 * @returns each test's resolved repo-relative imports, or why the config could not lend a resolver
 */
function resolveUnder({
  root,
  config,
  candidates,
}: {
  root: string;
  config: string;
  candidates: readonly TestCandidates[];
}): Result<readonly (readonly [string, readonly string[]])[], TargetedInventoryError> {
  if (candidates.length === 0) {
    return ok([]);
  }
  const configFileName = join(root, config);
  const lent = withTsModuleResolver({
    configFileName,
    currentDirectory: dirname(configFileName),
    use: (resolver) =>
      candidates.map(({ path, specifiers }) => {
        const fromFile = join(root, path);
        const resolved = specifiers.flatMap((specifier) => {
          const target = resolver.resolve({ fromFile, mode: "import", specifier });
          return target === undefined ? [] : [relative(root, target)];
        });
        return [path, resolved.filter((target) => !target.startsWith(".."))] as const;
      }),
  });
  if (lent.isErr()) {
    return err(TargetedInventoryErrors.resolverUnavailable({ config, detail: lent.error.message }));
  }
  return ok(lent.value);
}

/**
 * Read the unit test inventory and the imports that could reach a changed file.
 *
 * @param root the repository root
 * @param changedPaths every path the diff changed
 * @returns the inventory, or the first thing that could not be read — never a smaller inventory
 */
export function readTargetedTestInventory({
  root,
  changedPaths,
}: {
  root: string;
  changedPaths: readonly string[];
}): Result<TargetedTestInventory, TargetedInventoryError> {
  const present = presentUnitTests({ changedPaths, root });
  if (present.isErr()) {
    return err(present.error);
  }
  const declared = readModuleAliases({ root });
  if (declared.isErr()) {
    return err(declared.error);
  }
  const aliases = stemChangingAliases({ aliases: declared.value });
  const groups = groupCandidates({
    aliases,
    root,
    stems: changedModuleStems({ changedPaths }),
    testFiles: present.value,
  });
  if (groups.isErr()) {
    return err(groups.error);
  }
  const importsByTest = new Map<string, readonly string[]>();
  for (const [config, candidates] of groups.value) {
    const resolved = resolveUnder({ candidates, config, root });
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    for (const [path, imports] of resolved.value) {
      importsByTest.set(path, imports);
    }
  }
  return ok({ importsByTest, testFiles: present.value });
}
