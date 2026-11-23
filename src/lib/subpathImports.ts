/*
 * Node subpath imports — the `imports` field in `package.json`, and the one place anything that READS an
 * import specifier learns what `#lib/…` means.
 *
 * ## Why the mechanism is `imports` and not tsconfig `paths`
 *
 * Both decouple a specifier from the importer's depth. Only one of them resolves where this CLI actually
 * runs. Measured on tsc 6.0.3, tsx, vitest 4.1.11 and node 24.11.1 against a throwaway package
 * declaring both `"#lib/*": "./src/lib/*"` and `paths: {"@/*": ["./src/*"]}`:
 *
 *   tsc --noEmit                                     `#lib/*` resolves   `@/*` resolves
 *   tsx, cwd = package root                          resolves            resolves
 *   tsx, absolute entry path, cwd = elsewhere        resolves            ERR_MODULE_NOT_FOUND
 *   vitest, no resolver plugin                       resolves            fails to resolve
 *
 * The third row is the whole decision. `bin/slopweaver` runs tsx on `"$DIR/src/cli/index.ts" "$@"`
 * — an ABSOLUTE entry path run from wherever the caller happens to be standing, which is the launcher's
 * entire reason for existing (it carries a warning block about being invoked from another worktree). tsx
 * discovers a tsconfig from the CWD, not from the entry file, so under `paths` every alias in the CLI would
 * die for any caller not standing in the repo root. The fourth row costs `vite-tsconfig-paths` in all four
 * vitest configs. `imports` costs nothing in either, because Node itself resolves it.
 *
 * Two smaller findings from the same probe, recorded so nobody re-derives them: `baseUrl` is now a hard tsc
 * error here (TS5101, "stops functioning in TypeScript 7.0"), and nothing in this repo runs `dist/` — `yarn
 * build` is a compile check that `worktree create` skips unless asked (`src/worktree/provision.ts`).
 * Reproduce the matrix by declaring both mechanisms in a scratch package and running the four rows.
 *
 * ## The one thing this DOES cost, stated rather than left to be found
 *
 * The mapping names `./src/lib/*`, so `dist/` output is no longer independently runnable — a compiled
 * `dist/a/b.js` importing `#lib/result.js` resolves to `src/lib/result.js`, which is a `.ts` file Node
 * cannot load. Before this, the emitted tree was self-consistent. It is accepted rather than fixed because
 * nothing runs `dist/` and `yarn build` still compiles clean, which is the whole use that artifact has here.
 * An `imports` ARRAY (`["./src/lib/*", "./dist/lib/*"]`) was measured and does NOT close it: Node falls
 * through an array on an unsupported CONDITION, never on a missing file, so the first entry wins and errors.
 * The shape that would work is a custom condition (`{ "development": "./src/lib/*", "default":
 * "./dist/lib/*" }`) plus `--conditions development` in `bin/slopweaver` and all four vitest lanes — real
 * added surface for an artifact no verb loads. Do that when something actually runs `dist/`, not before.
 *
 * ## Why this constant exists rather than each reader hard-coding `#lib/`
 *
 * A gate that walks import specifiers and does not know a prefix does not fail — it silently stops
 * following those edges, which is the weaken-the-gate move by omission. `homeSafety.ts` was exactly that
 * shape: it returned early on any specifier not starting with `.`, so introducing a root would have
 * narrowed it with no signal at all. One list, one resolver, and `subpathImports.test.ts` fails when this
 * list and `package.json`'s own `imports` field disagree — so adding the next root cannot narrow a reader
 * by forgetting one.
 *
 * ## What this deliberately does NOT do yet
 *
 * It converts nothing. The roughly 3,000 relative specifiers reaching `src/lib` and the `subpath-imports`
 * gate that would refuse a new one are both follow-up work, in that order, and the ordering is the point:
 * a gate landing BEFORE the conversion would need a baseline naming nearly every file in the repository,
 * which is not a gate. The conversion itself was measured and then withdrawn from the landing that
 * introduced this file — a 2,151-file import rewrite collides with almost any pull request that adds any
 * import anywhere, and against a fleet landing roughly every eight minutes it never reached a mergeable
 * state across four rebases and five clean gate laps. Convert in lap-sized batches by directory instead.
 */

/** One subpath-import root: the specifier prefix, and the repo-relative directory it names. */
interface SubpathImportRoot {
  readonly prefix: string;
  readonly target: string;
}

/**
 * Every subpath-import root this package declares, mirroring `package.json`'s `imports` field.
 *
 * Kept in step with that field by `src/__tests__/unit/lib/subpathImports.test.ts`, which reads the real
 * manifest — this is a mirror, never a second source of truth.
 */
export const SUBPATH_IMPORT_ROOTS: readonly SubpathImportRoot[] = [{ prefix: "#lib/", target: "src/lib/" }];

/**
 * Resolve a subpath-import specifier to the repo-relative path it names.
 *
 * @param specifier the specifier as written (`#lib/result.js`)
 * @returns the repo-relative path (`src/lib/result.js`), or `undefined` when no declared root matches
 */
export function resolveSubpathImport({ specifier }: { specifier: string }): string | undefined {
  for (const { prefix, target } of SUBPATH_IMPORT_ROOTS) {
    if (specifier.startsWith(prefix)) {
      return `${target}${specifier.slice(prefix.length)}`;
    }
  }
  return undefined;
}

/**
 * Whether a specifier is one this package resolves itself — a relative path, or a declared subpath import.
 *
 * @param specifier the specifier as written
 * @returns true for an in-repo specifier, false for a bare package name
 */
export function isInternalSpecifier({ specifier }: { specifier: string }): boolean {
  return specifier.startsWith(".") || resolveSubpathImport({ specifier }) !== undefined;
}
