/**
 * The desktop shell's unit tests are inside the typecheck CI runs.
 *
 * `desktop/__tests__/unit/**` is collected by the root unit lane (`config/vitest/unit.ts`) but compiled by no
 * tsconfig: the root `tsconfig.json` once excluded the whole `desktop` directory, and `desktop/tsconfig.json`
 * includes only `src/**` (its CI job installs Electron's types, not Vitest's). Six real strict-mode errors sat
 * in those files unseen. The witness asks the TypeScript API what the
 * root project, the one `yarn typecheck` and CI's `typecheck` job read, actually contains, rather than
 * grepping the config's text for a spelling.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import { tsConfigFileNames } from "#lib/tsProject.js";

/** The repository root, four levels above this file. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** The directory holding the desktop shell's unit tests, relative to the repository root. */
const DESKTOP_TESTS = join("desktop", "__tests__", "unit");

/**
 * Every desktop unit test on disk, as a sorted absolute path.
 *
 * @param root the repository root
 * @returns the `*.test.ts` files directly under the desktop unit-test directory
 */
function desktopTestsOnDisk({ root }: { root: string }): readonly string[] {
  return readdirSync(join(root, DESKTOP_TESTS))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => join(root, DESKTOP_TESTS, name))
    .toSorted();
}

/**
 * Every desktop unit test the root `tsconfig.json` resolves into its program, as a sorted absolute path.
 *
 * @param root the repository root
 * @returns the root project's files that are direct `*.test.ts` children of the desktop unit-test directory
 */
function desktopTestsInRootProject({ root }: { root: string }): readonly string[] {
  const fileNames = unwrap(tsConfigFileNames({ configFileName: join(root, "tsconfig.json") }));
  const directory = join(root, DESKTOP_TESTS);
  return fileNames.filter((file) => dirname(file) === directory && file.endsWith(".test.ts")).toSorted();
}

describe("the root typecheck project", () => {
  it("contains every desktop unit test, so none can carry a type error CI never sees", () => {
    const onDisk = desktopTestsOnDisk({ root: REPO_ROOT });
    expect(onDisk.length).toBeGreaterThan(0);
    expect(desktopTestsInRootProject({ root: REPO_ROOT })).toEqual(onDisk);
  });
});
