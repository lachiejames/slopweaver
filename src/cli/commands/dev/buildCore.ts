/**
 * The pure half of `slopweaver dev build`: the flag spec, the esbuild argv, the manifest the built tree
 * needs beside it, and the rendering.
 *
 * ## Two emitters, and which proof each one carries
 *
 * `yarn build` is `tsc -p tsconfig.json` under a declared ceiling, run by CI's `compile` job, and it proves
 * the tree COMPILES — TS6059, TS5055, TS5056 and the emit itself, none of which `yarn typecheck` computes,
 * because TypeScript only reaches them when emit is enabled. It does NOT prove the result RUNS.
 *
 * This verb carries that second proof, and it is the one the built CLI rests on: it emits the whole `src`
 * tree transpile-only with esbuild, writes the manifest `bin/slopweaver`'s staleness guard reads, and then
 * SMOKE-RUNS the emitted entrypoint. MEASURED on this tree: 4,158 files in 3.8 s, against
 * 60.04 s for the tsc emit — which is why this is the one a `post-merge` hook can run and that one is not.
 * Reproduce both: `yarn dev build --json` and `yarn build`.
 *
 * They write different directories ON PURPOSE. tsc owns `dist/` (its `outDir`); this owns `DEFAULT_OUT` (`../../../builtCli/layout.ts`).
 * Two emitters interleaving in one directory is a race with no upside.
 *
 * `erasableSyntaxOnly: true` in `tsconfig.json` is what makes a type-stripping emitter safe here: no enum,
 * no parameter property and no namespace can reach the source, so there is no construct esbuild would have
 * to resolve types to emit correctly.
 */
import { BUILT_ENTRYPOINT, DEFAULT_OUT } from "../../../builtCli/layout.js";
import { SOURCE_ROOT } from "../../../builtCli/sourceScan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type DevBuildOwnerVerdict, ownerEmitted } from "./buildOwner.js";

export const DEV_BUILD_USAGE =
  "usage: slopweaver dev build [--out <dir>] [--json]\n" +
  "  Emit the CLI to JavaScript with esbuild, then PROVE the emitted entrypoint runs.\n" +
  `  --out <dir>  where to emit — relative to the repository root, or absolute (default ${DEFAULT_OUT})\n` +
  "  --json       emit one machine-readable document instead of the report\n" +
  "  It fails closed: a failed emit, a missing entrypoint and a smoke run that does not exit 0 are each a\n" +
  "  non-zero exit. `yarn build` is the OTHER emitter — tsc, into `dist`, proving the tree compiles.";

const FLAGS: FlagSpec = { boolean: ["json"], string: ["out"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_BUILD_FLAG_NAMES: readonly string[] = ((): readonly string[] => {
  const { boolean: booleans = [], string: strings = [] } = FLAGS;
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
})();

/** The verb the smoke run dispatches to prove the emitted graph resolves. */
export const SMOKE_VERB = "catalog";

/**
 * Why an emit outside the checkout is refused rather than attempted.
 *
 * The emitted tree is transpile-only, so every bare specifier in it — `neverthrow`, `zod`, `yaml` — is
 * still resolved by node walking UP from the file that imports it. Inside the checkout that walk reaches
 * `<root>/node_modules`; from `/tmp` it reaches nothing, and the entrypoint dies on
 * `Cannot find package 'neverthrow'`. Measured: `dev build --out "$(mktemp -d)"` emitted 4,166
 * files that could not run. A build whose output cannot run is worse than no build, so this is a refusal at
 * the flag rather than a failure four seconds later.
 *
 * @param outDir the resolved output directory, absolute
 * @param root the repository root, absolute
 * @returns the error to print, or undefined when the directory is inside the checkout
 */
export function outsideRoot({ outDir, root }: { outDir: string; root: string }): string | undefined {
  if (outDir === root || outDir.startsWith(`${root}/`)) {
    return undefined;
  }
  return (
    `--out ${outDir} is outside ${root}, and an emitted tree there cannot run: its bare imports resolve by ` +
    "walking up to a `node_modules` that only exists inside the checkout"
  );
}

/** What one `dev build` run produced, and whether its output was proved to run. */
export interface BuildReport {
  /** How esbuild's run under the compiler owner ended (`./buildOwner.ts`). */
  readonly owner: DevBuildOwnerVerdict;
  /** The output directory, absolute. */
  readonly outDir: string;
  /** How many `.js` files the emit wrote. */
  readonly emitted: number;
  /** How long the emit itself took, the lease wait included. */
  readonly emitMs: number;
  /**
   * The smoke run's exit code — 0 when the emitted entrypoint ran — or `null` when it was never run, because
   * esbuild did not emit. A smoke run over whatever an earlier build left on disk would prove that tree, not this one.
   */
  readonly smokeExit: number | null;
  /** The smoke run's first line of output, kept so a failure names itself rather than only its code. */
  readonly smokeLine: string;
}

/**
 * The parsed flag tail, or the usage errors it earned.
 *
 * @returns the output directory the run should emit into and whether to report as JSON
 */
export function parseDevBuildArgs({ rest }: { rest: readonly string[] }): Result<{ out: string; json: boolean }> {
  const parsed = parseFlags({ args: rest, spec: FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  // No `--out` shape check here: `parseFlags` declares it a STRING flag, so it has already answered
  // `--out requires a value` for a bare `--out` and rejected a switch-style `--out=`. A second message
  // for a state that cannot arrive is an unreachable arm that reads like a handled case.
  const out = values["out"];
  return ok({ json: values["json"] === true, out: typeof out === "string" ? out : DEFAULT_OUT });
}

/**
 * The esbuild argv that emits one source tree, given the files to emit.
 *
 * Transpile-only and per-file (no bundling): the tree ships as ES modules whose specifiers already carry
 * `.js`, so preserving the module structure means the emitted graph resolves exactly as the source one does,
 * and a dynamic `import()` in a lazy verb manifest still names a real file.
 *
 * @param files every source file to emit, absolute
 * @returns the argv after the `esbuild` binary itself
 */
export function esbuildArgsFor({ files, outDir }: { files: readonly string[]; outDir: string }): readonly string[] {
  return [
    ...files,
    `--outbase=${SOURCE_ROOT}`,
    `--outdir=${outDir}`,
    "--format=esm",
    "--platform=node",
    "--target=node22",
    "--sourcemap",
    "--log-level=error",
  ];
}

/**
 * The `package.json` the emitted tree needs beside it.
 *
 * The one thing that does NOT survive a move from `src/` to `dist/` untouched is the subpath-import map:
 * the repository's own `"#lib/*": "./src/lib/*"` resolves, from inside `dist/`, to `dist/src/lib/*`, which
 * does not exist. Every `#lib/…` specifier in the emitted tree then fails at run time with
 * `ERR_MODULE_NOT_FOUND` — measured, on the first emitted tree built here. Re-rooting the map is the whole
 * fix, and it belongs in the build rather than in a hand-maintained file nobody would think to update.
 *
 * `scripts` is dropped deliberately: they name `tsx src/...` paths that do not exist in the emitted tree,
 * so keeping them would let `yarn <script>` run from `dist/` and fail confusingly.
 *
 * @param manifest the repository's own parsed `package.json`
 * @returns the manifest to write into the output directory
 */
export function builtManifest({ manifest }: { manifest: Record<string, unknown> }): Record<string, unknown> {
  const { scripts: _scripts, ...rest } = manifest;
  return { ...rest, imports: { "#lib/*": "./lib/*" } };
}

/**
 * Whether a build is fit to ship — the emit wrote files AND the emitted entrypoint ran.
 *
 * Both halves are load-bearing. An emit that writes nothing and exits 0 is exactly what a heap death looked
 * like here, and an emit that writes 4,148 files whose entrypoint cannot resolve its own imports is exactly
 * what the first working emit did.
 *
 * @returns true when the run may be reported as a success
 */
export function buildIsFit({ report }: { report: BuildReport }): boolean {
  return ownerEmitted({ verdict: report.owner }) && report.emitted > 0 && report.smokeExit === 0;
}

/** The one line saying how esbuild's run under the owner ended. */
function ownerLine({ owner }: { owner: DevBuildOwnerVerdict }): string {
  if (owner.kind === "built") {
    return `dev build: esbuild ran under the machine's compile lease (${owner.lockMode}), no wait`;
  }
  if (owner.kind === "waited-out") {
    return `dev build: esbuild ran under the machine's compile lease (${owner.lockMode}) after waiting ${String(owner.waitedSeconds)}s for it`;
  }
  return `dev build: esbuild did not emit (${owner.kind})`;
}

/**
 * The human report for one build.
 *
 * @returns one line per fact, in the order a reader needs them, the verdict last
 */
export function renderBuild({ report }: { report: BuildReport }): readonly string[] {
  const verdict = buildIsFit({ report }) ? "PASS" : "FAIL";
  const smoke =
    report.smokeExit === null
      ? `dev build: smoke run of ${BUILT_ENTRYPOINT} not performed — nothing new was emitted to prove`
      : `dev build: smoke run of ${BUILT_ENTRYPOINT} exited ${String(report.smokeExit)} — ${report.smokeLine}`;
  return [
    `dev build: ${String(report.emitted)} file(s) emitted to ${report.outDir} in ${String(report.emitMs)}ms`,
    ownerLine({ owner: report.owner }),
    smoke,
    `dev build: ${verdict}`,
  ];
}
