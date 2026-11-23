/**
 * `slopweaver atlas <platform> restore` — the effectful shell.
 *
 * Resolves the platform's own directories through `../../../atlas/platformPaths.ts` — the same lookup `atlas doctor` and
 * `atlas freshness` already use — so this verb needs no second name table and no platform module. That is
 * what lets ONE dispatch answer for all 36 registered platforms, including the one with no reset module of
 * its own.
 *
 * Data to STDOUT, diagnostics to STDERR, so `--json` stays pristine for `… | jq`.
 */
import { type AtlasArchivePaths, listAtlasArchives, restoreAtlasArchive } from "../../../atlas/kit/archive.js";
import { atlasGenerationErrorLines } from "../../../atlas/kit/generationErrors.js";
import { type AtlasPlatformDirectories, atlasPathsFor } from "../../../atlas/platformPaths.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type AtlasCommandError, AtlasCommandErrors, atlasCommandErrorLines } from "./errors.js";
import {
  type AtlasRestoreRequest,
  atlasRestoreDoneLines,
  atlasRestoreListLines,
  atlasRestoreRequest,
  atlasRestoreUsage,
} from "./restoreCore.js";

/** The argv index the platform sits at — past the runtime, the script and the `atlas` noun. */
const PLATFORM_ARG_INDEX = 3;

/** Where the flag tail starts: past the runtime, the script, the noun, the platform and the verb. */
const VERB_ARG_OFFSET = 5;

/**
 * The injected edges, so the shell is testable with plain fakes.
 *
 * @internal
 */
export interface AtlasRestoreDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to the process's own streams
 * @internal
 */
export function productionAtlasRestoreDeps(): AtlasRestoreDeps {
  return {
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * One platform's archive paths, from the directories a generic lookup resolves.
 *
 * `AtlasPlatformDirectories` calls the live generation `root` while the store contract calls it `directory`;
 * this is the one place the two names meet, rather than either side being renamed to suit the other.
 *
 * @param directories what `atlasPathsFor` resolved
 * @returns the same tree in the shape `../../../atlas/kit/archive.ts` takes
 */
function archivePathsOf({ directories }: { directories: AtlasPlatformDirectories }): AtlasArchivePaths {
  return {
    directory: directories.root,
    kinds: directories.kinds,
    manifest: directories.manifest,
    superseded: directories.superseded,
  };
}

/** Parse the tail this verb accepts, then decide what it asked for. */
function parseRestore({ rest }: { rest: readonly string[] }): Result<AtlasRestoreRequest, AtlasCommandError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["archive", "confirm", "home"] } });
  if (parsed.isErr()) {
    return err(AtlasCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  return atlasRestoreRequest({ home: slopweaverHome(), parsed: parsed.value });
}

/** List every archived generation this platform holds. */
function runList({
  platform,
  request,
  deps,
}: {
  platform: string;
  request: Extract<AtlasRestoreRequest, { mode: "list" }>;
  deps: AtlasRestoreDeps;
}): number {
  const paths = atlasPathsFor({ home: request.home, platform });
  if (paths === null) {
    deps.writeDiagnostic(`slopweaver atlas ${platform} restore: no atlas directory is declared for ${platform}`);
    return EXIT_ERROR;
  }
  const listed = listAtlasArchives({ paths: archivePathsOf({ directories: paths }) });
  if (listed.isErr()) {
    for (const line of atlasGenerationErrorLines({ error: listed.error })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (request.json) {
    deps.writeOut(safeJsonStringify({ label: "the atlas archive listing", space: 2, value: listed.value }));
    return EXIT_OK;
  }
  for (const line of atlasRestoreListLines({ archives: listed.value, platform })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * Whether this BUILD can actually read the generation currently installed, through the platform's own schema.
 *
 * The precondition that makes the archive's version check mean something. `atlas/kit/archive.ts` compares an
 * archive against the LIVE manifest's declared version, which is only "what this build writes" if this build
 * wrote it — a home is written by whichever build ran LAST. Asking the platform's own reader closes that
 * without a second version table for a generic verb to drift against.
 *
 * It blocks on ONE code and lets every other failure through, which is the whole subtlety. MEASURED by running this verb against a real broken atlas: a generation whose manifest vouches for 10,823
 * entities while the reader can see 4,428 answers `ATLAS_GENERATION_DARK`, and a first cut of this function
 * treated any read failure as blocking — so the verb refused to restore precisely when the live generation
 * was broken, which is the only time anyone runs it. A dark, incoherent or unpublished generation is the
 * REASON to restore. Only `ATLAS_STORE_UNREADABLE` — the build cannot parse what is there, which is what a
 * schema mismatch produces — makes the archive-versus-live comparison meaningless, so only it blocks.
 *
 * @param platform the platform being addressed
 * @param home the state home to read against
 * @returns nothing when this build reads the live generation, or why it cannot
 */
async function refuseUnreadableLive({
  platform,
  home,
}: {
  platform: string;
  home: string;
}): Promise<readonly string[]> {
  const registered = findAtlasPlatform({ platform });
  if (registered == null) {
    return [];
  }
  const snapshot = await registered.readSnapshot({ home });
  if (snapshot.isOk() || snapshot.error.code !== "ATLAS_STORE_UNREADABLE") {
    return [];
  }
  return [
    `this build cannot read the ${platform} generation that is installed now: ${snapshot.error.message}`,
    "nothing was moved — restore compares an archive against what is live, so it cannot judge an archive while this build disagrees with the live generation",
  ];
}

/** Install one archived generation, archiving whatever is live now. */
async function runRestore({
  platform,
  request,
  deps,
  at,
}: {
  platform: string;
  request: Extract<AtlasRestoreRequest, { mode: "restore" }>;
  deps: AtlasRestoreDeps;
  at: string;
}): Promise<number> {
  const paths = atlasPathsFor({ home: request.home, platform });
  if (paths === null) {
    deps.writeDiagnostic(`slopweaver atlas ${platform} restore: no atlas directory is declared for ${platform}`);
    return EXIT_ERROR;
  }
  const unreadable = await refuseUnreadableLive({ home: request.home, platform });
  if (unreadable.length > 0) {
    for (const line of unreadable) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  const restored = restoreAtlasArchive({
    archiveId: request.archiveId,
    at,
    paths: archivePathsOf({ directories: paths }),
  });
  if (restored.isErr()) {
    for (const line of atlasGenerationErrorLines({ error: restored.error })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (request.json) {
    deps.writeOut(
      safeJsonStringify({
        label: "the atlas restore outcome",
        space: 2,
        value: {
          ...restored.value,
          archiveId: request.archiveId,
          undoCommand:
            restored.value.undoArchiveId === null
              ? null
              : `slopweaver atlas ${platform} restore --archive ${restored.value.undoArchiveId} --confirm archive-current`,
        },
      }),
    );
    return EXIT_OK;
  }
  for (const line of atlasRestoreDoneLines({ archiveId: request.archiveId, outcome: restored.value, platform })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * Run one `atlas <platform> restore` invocation.
 *
 * @param argv the whole process argv
 * @param deps where output goes
 * @param at this run's ISO instant, which names the archive a displaced generation goes to
 * @returns the process exit code
 *
 * @internal
 */
export async function runAtlasRestore({
  argv,
  deps,
  at,
}: {
  argv: readonly string[];
  deps: AtlasRestoreDeps;
  at: string;
}): Promise<number> {
  const platform = argv[PLATFORM_ARG_INDEX];
  if (platform === undefined || !atlasPlatforms().includes(platform)) {
    deps.writeDiagnostic(`slopweaver atlas restore: unknown platform "${String(platform)}"`);
    deps.writeDiagnostic(`every platform this build has: ${atlasPlatforms().join(", ")}`);
    return EXIT_USAGE;
  }
  const request = parseRestore({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (request.isErr()) {
    for (const line of atlasCommandErrorLines({ error: request.error })) {
      deps.writeDiagnostic(line);
    }
    deps.writeDiagnostic(atlasRestoreUsage({ platform }));
    return EXIT_USAGE;
  }
  if (request.value.mode === "list") {
    return runList({ deps, platform, request: request.value });
  }
  return runRestore({ at, deps, platform, request: request.value });
}

/**
 * The command `platformRun.ts` dispatches to.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function atlasRestoreCommand(argv: readonly string[]): Promise<number> {
  return runAtlasRestore({ argv, at: new Date().toISOString(), deps: productionAtlasRestoreDeps() });
}
