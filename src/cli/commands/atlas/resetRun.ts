/**
 * `slopweaver atlas <platform> reset` — ONE effectful shell for every atlas that declares a reset.
 *
 * The platform is bound from argv, exactly as `./restoreRun.ts` binds it, and what to do with it is read
 * from the registration's `readReset`. Before this, each of 33 platforms carried a `<p>Atlas/resetRun.ts`
 * whose whole body was the same four lines with three names swapped, plus a usage constant that was the same
 * sentence with the platform name swapped — so the verb existed 33 times and differed nowhere a reader could
 * act on. The parsing, the `--confirm archive` guard, both output shapes and the exit codes were already
 * shared in `./resetRunCore.ts`; this file is what finally shares the wiring too.
 *
 * `reset` is a CONDITIONAL kit verb, which is the one thing that makes it unlike `read` or `render`: a
 * registration with no `readReset` does not answer it at all, and `atlasKitVerbsFor` is what decides. So the
 * unknown-platform and no-reset paths below are reachable only through a direct call, never through
 * `platformRun.ts`'s dispatch — they exist so a direct caller gets a sentence rather than a thrown `!`.
 */
import type { AtlasPlatformRegistration } from "../../../atlas/kit/registration.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { atlasResetUsage, runAtlasReset } from "./resetRunCore.js";

/** The argv index the platform sits at — past the runtime, the script and the `atlas` noun. */
const PLATFORM_ARG_INDEX = 3;

/** What binding a platform to its reset reads, so the dispatch can be driven without the real registry. */
export interface AtlasResetCommandDeps {
  /** Every platform this build registers, in registry order. */
  readonly platforms: () => readonly string[];
  /** One platform's registration — only its `readReset` is read — or `null` when none carries that name. */
  readonly find: (args: { platform: string }) => Pick<AtlasPlatformRegistration, "readReset"> | null;
  /** The shared reset verb the bound platform is handed to. */
  readonly runReset: typeof runAtlasReset;
  /** Where a refusal's diagnostic goes. */
  readonly error: (args: { msg: string }) => void;
}

/**
 * Bind the platform argv names to its registration's reset and hand both to the shared reset verb.
 *
 * @param argv the whole process argv, the platform at index 3
 * @param deps the registry reads, the shared verb and the diagnostic sink
 * @returns `EXIT_USAGE` for an unknown platform or one with no reset, else the shared verb's own code
 */
export async function runAtlasResetCommand({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: AtlasResetCommandDeps;
}): Promise<number> {
  const platform = argv[PLATFORM_ARG_INDEX];
  if (platform === undefined || !deps.platforms().includes(platform)) {
    deps.error({ msg: `slopweaver atlas reset: unknown platform "${String(platform)}"` });
    deps.error({ msg: `every platform this build has: ${deps.platforms().join(", ")}` });
    return EXIT_USAGE;
  }
  const registration = deps.find({ platform });
  if (registration?.readReset === undefined) {
    deps.error({ msg: `slopweaver atlas ${platform} has no verb "reset"` });
    return EXIT_USAGE;
  }
  const reset = await registration.readReset();
  return deps.runReset({ argv, platform, reset, usage: atlasResetUsage({ platform }) });
}

/**
 * Run one `atlas <platform> reset` invocation, whichever platform it named.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function atlasResetCommand(argv: readonly string[]): Promise<number> {
  return runAtlasResetCommand({
    argv,
    deps: {
      error: ({ msg }) => {
        logger.error({ msg });
      },
      find: findAtlasPlatform,
      platforms: atlasPlatforms,
      runReset: runAtlasReset,
    },
  });
}
