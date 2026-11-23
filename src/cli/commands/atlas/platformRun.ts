/**
 * The effectful shell behind `slopweaver atlas <platform> <verb>` — ONE dispatcher for every platform.
 *
 * The platform is bound from argv rather than parsed as a flag — see `./platformVerb.ts` for why the
 * ordering is what it is — and everything else is read from the platform's registration: the kit verbs go
 * to the kit's run modules, a platform's own verb goes to the command its row loads, and a verb the
 * row does not declare is a usage error naming it. There is no per-platform file and no if-chain over verb
 * names anywhere: 31 such files and 88 such branches stood here before the registry carried the rows, and
 * at the owner's stated direction of about a hundred atlases they would have become roughly 300.
 *
 * Every module is imported at the point of dispatch, not at the top: each verb pulls in its own core, and a
 * platform that was asked for one should not pay to load the others. It also keeps this module's own flag
 * surface empty, which is the truth — the flags belong to the verb that parses them, and the help/flag
 * ratchet reads the import graph to decide who owns what.
 */
import { type AtlasPlatformRegistration, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { type CommandRun, defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { atlasPlatformDispatch, atlasPlatformUsage } from "./platformVerb.js";

/** Where a usage block goes, injected so the dispatch is testable without touching a process stream. */
export interface AtlasPlatformDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real streams.
 *
 * @returns the production dependencies
 */
export function productionAtlasPlatformDeps(): AtlasPlatformDeps {
  return {
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** The kit verb run modules, one thunk each, so a kit verb loads exactly its own core. */
const KIT_VERB_COMMANDS: Readonly<Record<string, () => Promise<CommandRun>>> = {
  coverage: async () => (await import("./coverageRun.js")).atlasCoverageCommand,
  read: async () => (await import("./readRun.js")).atlasReadCommand,
  render: async () => (await import("./renderRun.js")).atlasRenderCommand,
  reset: async () => (await import("./resetRun.js")).atlasResetCommand,
  restore: async () => (await import("./restoreRun.js")).atlasRestoreCommand,
};

/**
 * Dispatch one platform's invocation to the verb it named, or explain what the platform answers.
 *
 * @param argv the whole process argv
 * @param deps where usage output goes
 * @param registration the platform's row, resolved by the caller so a fake can stand in for a test
 * @returns the process exit code
 */
export async function runAtlasPlatform({
  argv,
  deps,
  registration,
}: {
  argv: readonly string[];
  deps: AtlasPlatformDeps;
  registration: AtlasPlatformRegistration;
}): Promise<number> {
  const dispatch = atlasPlatformDispatch({ argv, registration });
  switch (dispatch.kind) {
    case "kit": {
      const command = await KIT_VERB_COMMANDS[dispatch.verb]!();
      return command(argv);
    }
    case "own": {
      const command = await dispatch.verb.load();
      return command(argv);
    }
    case "fallback": {
      const command = await registration.fallback!();
      return command(argv);
    }
    case "help": {
      deps.writeOut(atlasPlatformUsage({ registration }));
      return EXIT_OK;
    }
    case "needs-verb": {
      deps.writeDiagnostic(`slopweaver atlas ${registration.platform} needs a verb`);
      deps.writeDiagnostic(atlasPlatformUsage({ registration }));
      return EXIT_USAGE;
    }
    case "unknown-verb": {
      deps.writeDiagnostic(`slopweaver atlas ${registration.platform} has no verb "${dispatch.given}"`);
      deps.writeDiagnostic(atlasPlatformUsage({ registration }));
      return EXIT_USAGE;
    }
    default: {
      const exhaustive: never = dispatch;
      return exhaustive;
    }
  }
}

/**
 * The command a registered platform's manifest row loads.
 *
 * The platform is resolved through the registry at RUN time rather than captured at build time, so a
 * manifest row built from the registry and the dispatcher that serves it cannot disagree about which row
 * a platform name means. A name the registry does not know is unreachable here — the manifest only builds
 * rows for names it read from the same list — so the throw is a programming error, never a user-facing one.
 *
 * @param platform the platform this command answers for
 * @returns the verb implementation
 */
export function atlasPlatformCommand({ platform }: { platform: string }): CommandRun {
  return defineCommand({
    run: (argv) => {
      const registration = findAtlasPlatform({ platform });
      if (registration === null) {
        throw new Error(`atlas platform "${platform}" has a manifest row but no registry row`);
      }
      return runAtlasPlatform({ argv, deps: productionAtlasPlatformDeps(), registration });
    },
  });
}
