/**
 * `slopweaver atlas <platform> coverage` — the effectful shell.
 *
 * Thin by design, and identical in shape to `readRun.ts` next door: resolve a platform through the
 * registry, narrow, print. **No network call** — coverage is what a sync already recorded about itself, and
 * a report that re-probed the provider would be measuring something else.
 *
 * Data to STDOUT, diagnostics to STDERR, so `--json` stays pristine for `… | jq`.
 *
 * It exits {@link EXIT_EXPECTED_EMPTY} when the coverage gate refuses — the standing
 * rule, spelled out in `coverageCore.ts`'s header. That is a legitimate non-success STATUS rather than a
 * fault: the verb ran its whole pipeline and is reporting that this atlas is missing coverage.
 */

import { AtlasReadErrors } from "../../../atlas/kit/read.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  ATLAS_COVERAGE_USAGE,
  atlasCoverageJson,
  coverageGateRefuses,
  narrowCoverage,
  parseAtlasCoverageArgs,
  refusedCoverage,
  renderAtlasCoverage,
} from "./coverageCore.js";
import { resolvePlatformSnapshot } from "./platformResolve.js";

/** The argv index the platform sits at — past the runtime, the script and the `atlas` noun. */
const PLATFORM_ARG_INDEX = 3;

/** Where the flag tail starts: past the runtime, the script, the noun, the platform and the verb. */
const VERB_ARG_OFFSET = 5;

/** The injected edges, so the shell is testable with plain fakes and no filesystem. */
export interface AtlasCoverageDeps {
  readonly platforms: typeof atlasPlatforms;
  readonly find: typeof findAtlasPlatform;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to the process's own streams
 * @internal
 */
export function productionAtlasCoverageDeps(): AtlasCoverageDeps {
  return {
    find: findAtlasPlatform,
    platforms: atlasPlatforms,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Run the verb.
 *
 * @param deps the injected edges
 * @param platform the atlas being reported on, bound from argv rather than parsed as a flag
 * @param rest the argv tail after `atlas <platform> coverage`
 * @returns the process exit code
 */
export async function runAtlasCoverage({
  deps,
  platform,
  rest,
}: {
  deps: AtlasCoverageDeps;
  platform: string | undefined;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ATLAS_COVERAGE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAtlasCoverageArgs({ rest });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.writeDiagnostic(line);
    }
    deps.writeDiagnostic(ATLAS_COVERAGE_USAGE);
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
  const all = snapshot.kinds;
  const known = all.map((view) => view.kind);
  if (options.kind !== undefined && !known.includes(options.kind)) {
    deps.writeDiagnostic(
      AtlasReadErrors.kindUnknown({ kind: options.kind, known, platform: snapshot.generation.platform }).message,
    );
    return EXIT_USAGE;
  }
  const kinds = all
    .filter((view) => options.kind === undefined || view.kind === options.kind)
    .map((view) =>
      narrowCoverage({ openOnly: options.openOnly, state: options.state, surface: options.surface, view }),
    );

  // The gate reads the whole atlas, never `kinds` — a filter selects what prints, never the exit code.
  const gated = coverageGateRefuses({ refusal: refusedCoverage({ snapshot }) });
  if (options.json) {
    deps.writeOut(JSON.stringify(atlasCoverageJson({ kinds, snapshot })));
    return gated ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  for (const line of renderAtlasCoverage({ kinds, snapshot })) {
    deps.writeOut(line);
  }
  return gated ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const atlasCoverageCommand = defineCommand({
  run: (argv) =>
    runAtlasCoverage({
      deps: productionAtlasCoverageDeps(),
      platform: argv[PLATFORM_ARG_INDEX],
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
