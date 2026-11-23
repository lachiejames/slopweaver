/**
 * The runtime-dependencies gate: every package the plugin's CLI reaches at run time is declared in
 * `dependencies`, never only in `devDependencies`.
 *
 * WHY IT EXISTS. `scripts/plugin-install-deps.sh` installs a plugin user's tree with `yarn workspaces focus
 * --production`, which leaves every devDependency out. So a CLI module importing a package declared only as a
 * devDependency passes every lane here — a checkout's own `yarn install` is the full tree — and throws
 * `ERR_MODULE_NOT_FOUND` on the user's machine, on first use. `tsx` and `typescript` were exactly that until
 * the install went runtime-only: the launcher execs one on every call, and the CLI's own source imports the
 * other.
 *
 * THE CRITERION. esbuild bundles `src/cli/index.ts` and `hooks/pretooluse.ts` in memory with every package
 * external, and its metafile lists each external import the bundle reached, static or literal-dynamic. Each one
 * that is not a Node builtin names a package, which must be in `dependencies`. Beside that,
 * {@link RUNTIME_TOOLS} names the packages the CLI reaches by a route a metafile cannot see — a spawned
 * binary, a `createRequire` load, a package script — and each of those must be in `dependencies` too.
 *
 * ITS BLIND SPOT, named: a package loaded by a COMPUTED name, or by a new `createRequire` alias, a new spawned
 * binary, is invisible to the metafile, and only joins this gate when it joins {@link RUNTIME_TOOLS}.
 */
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";

import { build, type Plugin } from "esbuild";
import { z } from "zod";

import { safeJsonParse } from "../lib/safeJson.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/** One external import the bundle reached: the importing module and the specifier as written. */
export interface RuntimeImport {
  readonly from: string;
  readonly specifier: string;
}

/** The two dependency maps of `package.json` this gate reads. */
export interface RuntimeDependencyManifest {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

/** One package the runtime reaches that `dependencies` does not declare. */
export interface RuntimeDependencyFinding {
  /** The first module (sorted) importing it, or the launch site of a runtime tool. */
  readonly from: string;
  readonly packageName: string;
  readonly reason: "dev-dependency" | "unlisted-package";
}

/**
 * Packages the CLI reaches without an import a metafile records, each with where it is reached.
 */
export const RUNTIME_TOOLS: ReadonlyMap<string, string> = new Map([
  ["drizzle-kit", "src/store/generate.ts spawns node_modules/.bin/drizzle-kit for `store push`"],
  ["esbuild", "scripts/pretooluse.sh and `dev build` spawn node_modules/.bin/esbuild"],
  ["supabase", "package.json's `store:start|status|stop` run node_modules/supabase/dist/supabase.js"],
  ["tsx", "bin/slopweaver execs node_modules/.bin/tsx on every source-mode call"],
  ["typescript", "src/lib/tsLazy.ts loads it through createRequire"],
]);

/** The root manifest's two maps, both required: a manifest missing either is a fact to report, not an empty map. */
const MANIFEST_SCHEMA = z.object({
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

/** The modules a plugin user's process starts from. */
const RUNTIME_ENTRIES = ["src/cli/index.ts", "hooks/pretooluse.ts"] as const;

/**
 * The package a bare import specifier names: `@scope/name` for a scoped one, the first segment otherwise.
 *
 * @param specifier the import specifier as written
 * @returns the package name, or `undefined` for a relative path, a subpath-import alias or a Node builtin
 */
export function packageNameOf({ specifier }: { specifier: string }): string | undefined {
  const notAPackage = specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#");
  if (notAPackage || isBuiltin(specifier)) {
    return undefined;
  }
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length < 2 ? undefined : `${segments[0]!}/${segments[1]!}`;
  }
  return segments[0];
}

/**
 * Every package the runtime reaches that `dependencies` does not declare, one finding per package, sorted.
 *
 * @param imports the external imports the bundle reached
 * @param manifest the root `package.json`'s dependency maps
 * @param runtimeTools packages reached without an import, each with its launch site
 * @returns the findings, sorted by package name; empty when the manifest is right
 */
export function runtimeDependencyFindings({
  imports,
  manifest,
  runtimeTools,
}: {
  imports: readonly RuntimeImport[];
  manifest: RuntimeDependencyManifest;
  runtimeTools: ReadonlyMap<string, string>;
}): readonly RuntimeDependencyFinding[] {
  const firstSite = new Map<string, string>();
  for (const { from, specifier } of [...imports].toSorted((a, b) => a.from.localeCompare(b.from))) {
    const name = packageNameOf({ specifier });
    if (name !== undefined && !firstSite.has(name)) {
      firstSite.set(name, from);
    }
  }
  for (const [name, site] of runtimeTools) {
    if (!firstSite.has(name)) {
      firstSite.set(name, site);
    }
  }
  const findings: RuntimeDependencyFinding[] = [];
  for (const [packageName, from] of firstSite) {
    if (Object.hasOwn(manifest.dependencies, packageName)) {
      continue;
    }
    const reason = Object.hasOwn(manifest.devDependencies, packageName) ? "dev-dependency" : "unlisted-package";
    findings.push({ from, packageName, reason });
  }
  return findings.toSorted((a, b) => a.packageName.localeCompare(b.packageName));
}

/**
 * Resolves `#lib/<name>.js` to `src/lib/<name>.ts`, so the bundle walks through the subpath alias instead of
 * stopping at it as an external — `package.json`'s `imports` names `.js`, and the file on disk is `.ts`.
 */
function libAliasPlugin({ root }: { root: string }): Plugin {
  return {
    name: "lib-alias",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^#lib\// }, (args) => ({
        path: join(root, "src", "lib", args.path.slice("#lib/".length).replace(/\.js$/u, ".ts")),
      }));
    },
  };
}

/**
 * IO edge: bundle the runtime entries in memory, collect every external import, read `package.json`.
 *
 * @param root the repository root
 * @returns the external imports and the manifest's dependency maps
 */
async function readRuntimeSubject({
  root,
}: {
  root: string;
}): Promise<{ imports: readonly RuntimeImport[]; manifest: RuntimeDependencyManifest }> {
  const result = await build({
    absWorkingDir: root,
    bundle: true,
    entryPoints: [...RUNTIME_ENTRIES],
    format: "esm",
    logLevel: "silent",
    metafile: true,
    outdir: "out",
    packages: "external",
    platform: "node",
    plugins: [libAliasPlugin({ root })],
    splitting: true,
    write: false,
  });
  const imports: RuntimeImport[] = [];
  for (const [from, input] of Object.entries(result.metafile.inputs)) {
    for (const reached of input.imports) {
      if (reached.external === true) {
        imports.push({ from, specifier: reached.path });
      }
    }
  }
  const manifest = MANIFEST_SCHEMA.parse(
    safeJsonParse({ label: "package.json", text: readFileSync(join(root, "package.json"), "utf8") }),
  );
  return { imports, manifest };
}

/**
 * IO edge: run the gate, print each finding, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a finding or the bundle could not be built)
 */
export async function runRuntimeDependencies(): Promise<number> {
  const root = repoRoot();
  let subject: Awaited<ReturnType<typeof readRuntimeSubject>>;
  try {
    subject = await readRuntimeSubject({ root });
  } catch (error) {
    // devlint: not-a-refusal -- the runtime graph or package.json could not be READ, so the gate has no subject
    process.stderr.write(`runtime-dependencies: could not read the runtime graph or package.json: ${String(error)}\n`);
    return 1;
  }
  const findings = runtimeDependencyFindings({ ...subject, runtimeTools: RUNTIME_TOOLS });
  const packages = new Set(subject.imports.map(({ specifier }) => packageNameOf({ specifier })));
  packages.delete(undefined);
  if (findings.length === 0) {
    process.stdout.write(
      `runtime-dependencies: clean (${String(packages.size)} imported package(s) and ${String(RUNTIME_TOOLS.size)} runtime tool(s), all in dependencies)\n`,
    );
    return 0;
  }
  for (const finding of findings) {
    process.stderr.write(`  ${finding.packageName}  ${finding.reason}, reached from ${finding.from}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "runtime-dependencies" }),
      detail: `${String(findings.length)} runtime package(s) not declared in dependencies`,
    })}\n`,
  );
  return 1;
}
