/**
 * `slopweaver atlas <platform> read` — the effectful shell.
 *
 * Thin by design: every decision is pure ({@link ../../../atlas/kit/read} and {@link ./readCore}), and this
 * file only resolves a platform through the registry and prints. It makes **no network call** — an atlas is
 * what a sync already stored, and a read that could reach a provider would be a different verb with a
 * different trust story.
 *
 * Data to STDOUT, diagnostics to STDERR, so `--json` stays pristine for `… | jq`.
 */

import { type AtlasReadError, AtlasReadErrors, type AtlasReadSnapshot } from "../../../atlas/kit/read.js";
import { answerAtlasRead } from "../../../atlas/kit/readAnswer.js";
import type { AtlasEntitySelection } from "../../../atlas/kit/selectEntities.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolvePlatformSnapshot } from "./platformResolve.js";
import { ATLAS_READ_USAGE, type AtlasReadOptions, parseAtlasReadArgs } from "./readArgs.js";
import { atlasReadJson, renderAtlasRead } from "./readCore.js";

/** The argv index the platform sits at — past the runtime, the script and the `atlas` noun. */
const PLATFORM_ARG_INDEX = 3;

/** Where the flag tail starts: past the runtime, the script, the noun, the platform and the verb. */
const VERB_ARG_OFFSET = 5;

/** The injected edges, so the shell is testable with plain fakes and no filesystem. */
export interface AtlasReadDeps {
  readonly platforms: typeof atlasPlatforms;
  readonly find: typeof findAtlasPlatform;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /**
   * The current instant, read ONCE per invocation.
   *
   * Injected rather than called inside the kit because the freshness half of the answer boundary is a
   * judgement about time, and a test that cannot fix the clock cannot pin the difference between a
   * historical zero and a never-measured one — which is the whole distinction this verb now makes.
   */
  readonly nowMs: () => number;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to the process's own streams
 * @internal
 */
export function productionAtlasReadDeps(): AtlasReadDeps {
  return {
    find: findAtlasPlatform,
    nowMs: () => Date.now(),
    platforms: atlasPlatforms,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Narrow a snapshot to the requested kinds, refusing a kind this platform does not declare.
 *
 * A refusal rather than an empty result, deliberately: `--kind gateway-policy` against an atlas that has no
 * such kind is almost always a typo or a stale expectation, and returning zero entities would read as "this
 * account has none" — the exact confusion an atlas exists to prevent.
 *
 * @param snapshot the platform's whole atlas
 * @param kinds the kinds asked for; empty means all of them
 * @returns the narrowed kind views, or which kind is unknown
 */
export function narrowToKinds({
  snapshot,
  kinds,
}: {
  snapshot: AtlasReadSnapshot;
  kinds: readonly string[];
}): Result<AtlasReadSnapshot["kinds"], AtlasReadError> {
  if (kinds.length === 0) {
    return ok(snapshot.kinds);
  }
  const known = snapshot.kinds.map((kind) => kind.kind);
  const unknown = kinds.find((kind) => !known.includes(kind));
  if (unknown !== undefined) {
    return err(AtlasReadErrors.kindUnknown({ kind: unknown, known, platform: snapshot.generation.platform }));
  }
  return ok(snapshot.kinds.filter((kind) => kinds.includes(kind.kind)));
}

/**
 * The selection an invocation asks for, with every unset filter left OFF the object entirely.
 *
 * Spread-conditionals rather than `undefined` values because `exactOptionalPropertyTypes` distinguishes the
 * two: an explicit `{ query: undefined }` is a query that was set to nothing, which is not what "the caller
 * did not pass --query" means.
 *
 * @param options the parsed invocation
 * @returns the selection to hand the pure selector
 */
function selectionFrom({ options }: { options: AtlasReadOptions }): AtlasEntitySelection {
  return {
    includeStale: options.includeStale,
    ...(options.after === undefined ? {} : { after: options.after }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.surface === undefined ? {} : { surface: options.surface }),
  };
}

/**
 * The exit code one answer earns.
 *
 * `EXIT_EXPECTED_EMPTY` rather than `EXIT_ERROR` for the unprovable empty: the verb ran its whole pipeline
 * and is reporting a legitimate non-success STATUS, which is exactly what that code is for — so
 * `slopweaver atlas x read || alert` still fires while a reliability harness does not count it as a fault.
 * An unknown surface is a caller mistake caught before anything was judged, so it is `EXIT_USAGE` beside
 * the unknown-kind refusal it mirrors.
 *
 * @param result what the kit answered
 * @param acceptUnproven whether the caller opened the named escape hatch, which makes the refusal an answer
 * @returns the process exit code
 */
function exitCodeFor({
  result,
  acceptUnproven,
}: {
  result: ReturnType<typeof answerAtlasRead>;
  acceptUnproven: boolean;
}): number {
  if (result.isOk()) {
    return EXIT_OK;
  }
  // Exhaustive over the union rather than "everything that is not a surface typo":
  // `--accept-unproven-empty` is a hatch past exactly ONE refusal, and a fallthrough would silently
  // promote a future third arm to exit 0 while both encoders still rendered it as a refusal — this verb's
  // own defect, a zero that reads as an answer, re-entering through the exit code. The `never` default is
  // what makes that a compile error instead (`.claude/rules/error-handling.md` § Consuming a typed error).
  switch (result.error.code) {
    case "ATLAS_READ_EMPTY_UNPROVEN":
      return acceptUnproven ? EXIT_OK : EXIT_EXPECTED_EMPTY;
    case "ATLAS_READ_SURFACE_UNKNOWN":
      return EXIT_USAGE;
    default: {
      const unhandled: never = result.error;
      return unhandled;
    }
  }
}

/**
 * Run the verb.
 *
 * @param deps the injected edges
 * @param platform the atlas being read, bound from argv rather than parsed as a flag
 * @param rest the argv tail after `atlas <platform> read`
 * @returns the process exit code
 */
export async function runAtlasRead({
  deps,
  platform,
  rest,
}: {
  deps: AtlasReadDeps;
  platform: string | undefined;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ATLAS_READ_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAtlasReadArgs({ rest });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.writeDiagnostic(line);
    }
    deps.writeDiagnostic(ATLAS_READ_USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const resolved = await resolvePlatformSnapshot({
    find: deps.find,
    home: options.home,
    platform,
    platforms: deps.platforms,
  });
  if (resolved.isErr()) {
    deps.writeDiagnostic(resolved.error.error.message);
    return resolved.error.exitCode;
  }
  const snapshot = resolved.value;
  const narrowed = narrowToKinds({ kinds: options.kinds, snapshot });
  if (narrowed.isErr()) {
    deps.writeDiagnostic(narrowed.error.message);
    return EXIT_USAGE;
  }
  const answered = answerAtlasRead({
    kinds: narrowed.value,
    nowMs: deps.nowMs(),
    selection: selectionFrom({ options }),
    snapshot,
  });
  const acceptUnproven = options.acceptUnprovenEmpty;

  if (options.json) {
    deps.writeOut(JSON.stringify(atlasReadJson({ acceptUnproven, result: answered })));
    return exitCodeFor({ acceptUnproven, result: answered });
  }
  for (const line of renderAtlasRead({ acceptUnproven, result: answered })) {
    deps.writeOut(line);
  }
  return exitCodeFor({ acceptUnproven, result: answered });
}

export const atlasReadCommand = defineCommand({
  run: (argv) =>
    runAtlasRead({
      deps: productionAtlasReadDeps(),
      platform: argv[PLATFORM_ARG_INDEX],
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
