/**
 * The door to TypeScript's PROJECT library — reading a `tsconfig.json` into the files it compiles, and resolving a
 * module specifier exactly as the compiler would under that config. One of the four files the
 * `typescript-import-seam` gate lets name the `typescript` package (`./tsSyntax.ts` explains why there is a door).
 *
 * Both run on TypeScript 7's Go server (`API.parseConfigFile`, `API.createModuleResolver`), through a client this file
 * starts on first use and registers with `./tsLifecycle.ts` at that moment — never at import.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { API, type Diagnostic, ModuleKind } from "typescript/sync";
import { err, ok, type Result } from "./result.js";
import { parseTsconfigText } from "./tsconfigText.js";
import { lazyTypeScriptClient } from "./tsLifecycle.js";
import type { LentAnswer } from "./tsSyntax.js";

/** The two ways NodeNext resolves a load: `import` (static or dynamic) and `require`. */
export type ResolutionMode = "import" | "require";

/** Resolves a specifier written in one file to the file the compiler would load, under one config. */
export interface TsModuleResolver {
  /** The absolute path the compiler loads, or `undefined` when it resolves to nothing. */
  readonly resolve: (args: { specifier: string; fromFile: string; mode: ResolutionMode }) => string | undefined;
}

/** The compiler reported the config unreadable or invalid; `diagnostics` is its own text, one entry each. */
export interface TsConfigDiagnosticsError {
  readonly code: "TS_CONFIG_DIAGNOSTICS";
  readonly message: string;
  readonly configFileName: string;
  readonly diagnostics: readonly string[];
}

/** The config reads, but carries no `compilerOptions` to resolve under. */
export interface TsConfigNoCompilerOptionsError {
  readonly code: "TS_CONFIG_NO_COMPILER_OPTIONS";
  readonly message: string;
  readonly configFileName: string;
}

/** Why a `tsconfig.json` could not be read into what a caller here needs. */
export type TsProjectError = TsConfigDiagnosticsError | TsConfigNoCompilerOptionsError;

/** The {@link TsProjectError} factories. */
export const TsProjectErrors = {
  diagnostics: ({
    configFileName,
    diagnostics,
  }: {
    configFileName: string;
    diagnostics: readonly string[];
  }): TsConfigDiagnosticsError => ({
    code: "TS_CONFIG_DIAGNOSTICS",
    configFileName,
    diagnostics,
    message: `${configFileName}: ${diagnostics.join("; ")}`,
  }),
  noCompilerOptions: ({ configFileName }: { configFileName: string }): TsConfigNoCompilerOptionsError => ({
    code: "TS_CONFIG_NO_COMPILER_OPTIONS",
    configFileName,
    message: `${configFileName} declares no compilerOptions, so nothing can be resolved as the compiler does`,
  }),
} as const;

/**
 * Two diagnostics converting a bare `compilerOptions` object always carries, because the object handed over names no
 * inputs on purpose: TS18002 (an empty `files` list) and TS18003 (no inputs found). Neither is about an option.
 */
const INPUT_LIST_DIAGNOSTICS: ReadonlySet<number> = new Set([18_002, 18_003]);

/** The project client, started on first use; a use after `closeTypeScript()` starts a fresh one. */
const projectClient = lazyTypeScriptClient({ open: () => new API({ cwd: process.cwd() }) });

/** The compiler's own text for a diagnostic, its chained messages after it, one per line. */
function diagnosticText({ diagnostic }: { diagnostic: Diagnostic }): string {
  const lines = [diagnostic.text];
  if (diagnostic.messageChain !== undefined) {
    for (const link of diagnostic.messageChain) {
      lines.push(diagnosticText({ diagnostic: link }));
    }
  }
  return lines.join("\n");
}

/** A thrown value's own text. */
function thrownText({ thrown }: { thrown: unknown }): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Read a config file's TEXT as the compiler reads a `tsconfig.json`: JSON with comments and trailing commas, its
 * values lexed as JavaScript literals, so `0x10`, `.5`, `1_000` and `"\x41"` read as TypeScript reads them. A text
 * the compiler would report any diagnostic for is refused whole. No TypeScript runs here — `./tsconfigText.ts` reads
 * the dialect, pinned input for input against TypeScript 6's `parseConfigFileTextToJson`.
 *
 * @param configFileName names the text in a diagnostic
 * @param text the file's contents
 * @returns the parsed value, or the first reason the text is not a config
 */
export function readConfigText({
  configFileName,
  text,
}: {
  configFileName: string;
  text: string;
}): Result<unknown, TsProjectError> {
  return parseTsconfigText({ text }).mapErr((error) =>
    TsProjectErrors.diagnostics({ configFileName, diagnostics: [error.message] }),
  );
}

/**
 * Every file a `tsconfig.json` puts into its program — its `files`, `include` and `exclude` applied, `extends`
 * followed — as absolute paths in the compiler's own order. Only an UNREADABLE config is refused; a diagnostic the
 * compiler recovers from (no inputs found, an unknown option) leaves the file list it computed.
 *
 * @param configFileName the config's path
 * @returns the file names, or the compiler's reason the config could not be read
 */
export function tsConfigFileNames({
  configFileName,
}: {
  configFileName: string;
}): Result<readonly string[], TsProjectError> {
  try {
    return ok(projectClient().parseConfigFile(configFileName).fileNames);
  } catch (thrown: unknown) {
    return err(TsProjectErrors.diagnostics({ configFileName, diagnostics: [thrownText({ thrown })] }));
  }
}

/**
 * Lend `use` a resolver for one config's own `compilerOptions` (`extends` not followed), relative option paths read
 * against `currentDirectory`, and answer what `use` answers.
 *
 * SCOPED, because the resolver is a handle on the Go server, released when `use` returns: resolve inside `use`,
 * answer plain paths, never keep the resolver. The resolver remembers each answer for its life, so it is a snapshot of
 * the files as each lookup first found them: change files inside `use` and a repeated lookup misses the change
 * (`memoisedTsModuleResolver`).
 *
 * @param configFileName the config whose `compilerOptions` decide resolution
 * @param currentDirectory the directory relative option paths are read against
 * @param use resolves what it needs and answers plain data; it must not keep the resolver
 * @returns what `use` returned, or why the config's options could not be read
 */
export function withTsModuleResolver<R>({
  configFileName,
  currentDirectory,
  use,
}: {
  configFileName: string;
  currentDirectory: string;
  use: (resolver: TsModuleResolver) => LentAnswer<R, TsModuleResolver>;
}): Result<LentAnswer<R, TsModuleResolver>, TsProjectError> {
  let text: string;
  try {
    text = readFileSync(configFileName, "utf8");
  } catch (thrown: unknown) {
    return err(TsProjectErrors.diagnostics({ configFileName, diagnostics: [thrownText({ thrown })] }));
  }
  const read = readConfigText({ configFileName, text });
  if (read.isErr()) {
    return err(read.error);
  }
  const config = read.value;
  if (typeof config !== "object" || config === null || !("compilerOptions" in config)) {
    return err(TsProjectErrors.noCompilerOptions({ configFileName }));
  }
  const api = projectClient();
  // The raw options converted as the compiler converts them: enum names to their values, relative paths resolved.
  const converted = api.parseJsonConfigFileContent(
    { compilerOptions: config.compilerOptions, files: [] },
    { configDirectory: currentDirectory },
  );
  const problems = converted.errors.filter((diagnostic) => !INPUT_LIST_DIAGNOSTICS.has(diagnostic.code));
  if (problems.length > 0) {
    const diagnostics = problems.map((diagnostic) => diagnosticText({ diagnostic }));
    return err(TsProjectErrors.diagnostics({ configFileName, diagnostics }));
  }
  const handle = api.createModuleResolver(converted.options);
  try {
    const resolver = memoisedTsModuleResolver({
      resolve: ({ containingDirectory, mode, specifier }) => {
        const kind = mode === "import" ? ModuleKind.ESNext : ModuleKind.CommonJS;
        return handle.resolveModuleName(specifier, containingDirectory, kind).resolvedModule?.resolvedFileName;
      },
    });
    return ok(use(resolver));
  } finally {
    handle.dispose();
  }
}

/**
 * A resolver that asks `resolve` once per mode, containing directory and specifier, for the resolver's own life — the
 * whole of what the server is sent — so it answers from a SNAPSHOT of the files as each lookup first found them. The
 * server alone does not: it re-reads, so a file written mid-use is found by its next ask but not by this memo's. A
 * caller that changes files takes a fresh resolver. Each ask is one SYNCHRONOUS round trip to the Go server, which
 * load punishes: MEASURED, resolving every production file's local imports in both modes made 97,988 trips for 19,177
 * distinct directory-and-specifier pairs, and on one loaded seat, back to back, took 20.8s without this memo and 14.0s
 * with it; without it, a 60s bound timed `prLeadSeams/producers.test.ts` out under load. Repro: `yarn vitest run
 * --config config/vitest/unit.ts src/__tests__/unit/outbound/slack/prLeadSeams/producers.test.ts --reporter=verbose
 * -t "every local import"`.
 *
 * @param resolve the server's lookup, by directory: `fromFile`'s own name is never part of an answer
 * @returns the resolver, with misses remembered as well as hits
 * @internal exported for its unit test; callers take a resolver from `withTsModuleResolver`
 */
export function memoisedTsModuleResolver({
  resolve,
}: {
  resolve: (args: { containingDirectory: string; mode: ResolutionMode; specifier: string }) => string | undefined;
}): TsModuleResolver {
  const answers = new Map<string, string | undefined>();
  return {
    resolve: ({ specifier, fromFile, mode }) => {
      const containingDirectory = dirname(fromFile);
      // A tuple's JSON, never a delimiter join: a specifier is any string, so a separator inside one could weld two
      // distinct lookups into one key.
      const key = JSON.stringify([mode, containingDirectory, specifier]);
      if (answers.has(key)) {
        return answers.get(key);
      }
      const answer = resolve({ containingDirectory, mode, specifier });
      answers.set(key, answer);
      return answer;
    },
  };
}
