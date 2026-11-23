/**
 * `slopweaver atlas freshness` — the effectful shell of the rolling window.
 *
 * Thin by design: the judgement is `atlas/kit/freshnessWindow.ts`'s and the rendering is
 * {@link ./freshnessCore}'s. What lives here is the gather — for each registered atlas, its own declared
 * window, its published generation's derived clock, and its most recent bounded live read.
 *
 * ## It is CHEAP, and that is a requirement rather than a nicety
 *
 * `refresh --if-stale`'s tick over a current corpus costs one file read per source and exits, which is what
 * makes it safe to run on a schedule. This sweep holds itself to the same bar: **one manifest read and one
 * live-read stamp per atlas**, never a `readSnapshot`. Reading every entity of every atlas — which is what
 * `atlas doctor` deliberately does, because its question is whether the records read back — would make the
 * rolling window cost more than the thing it is watching. Only the top-level `updatedAt` is taken off the
 * manifest, so a 169 MiB kind file is never opened.
 *
 * No network call is made and no credential is presented. The verb says which atlases are behind; the
 * commands it names are what bring them current, and a scheduled row is what runs those.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { AtlasDescriptor } from "../../../atlas/kit/contract.js";
import {
  type AtlasFreshnessSubject,
  atlasFreshnessWindowMs,
  atlasFreshnessWindowProblem,
  judgeAtlasEstate,
} from "../../../atlas/kit/freshnessWindow.js";
import { generationClock } from "../../../atlas/kit/generationClock.js";
import { readAtlasLiveRead } from "../../../atlas/kit/liveReadStamp.js";
import { atlasPathsFor } from "../../../atlas/platformPaths.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  ATLAS_FRESHNESS_USAGE,
  type AtlasFreshnessReport,
  atlasFreshnessJson,
  parseAtlasFreshnessArgs,
  renderAtlasFreshness,
} from "./freshnessCore.js";

/** Where the flag tail starts: past the runtime, the script, the `atlas` noun and the `freshness` verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable with plain fakes. */
export interface AtlasFreshnessDeps {
  readonly platforms: typeof atlasPlatforms;
  readonly find: typeof findAtlasPlatform;
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to the process's own streams
 * @internal
 */
export function productionAtlasFreshnessDeps(): AtlasFreshnessDeps {
  return {
    find: findAtlasPlatform,
    now: () => new Date().toISOString(),
    platforms: atlasPlatforms,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** What one atlas contributed, and anything wrong with its own declaration. */
interface GatheredAtlas {
  readonly subject: AtlasFreshnessSubject;
  readonly problem: string | null;
}

/**
 * Gather one atlas's clocks and policy.
 *
 * @param deps the injected edges
 * @param platform the atlas to gather
 * @param home the state home to read from, when the caller passed one
 * @param windowMsOverride a window to apply instead of this atlas's own, when the caller passed one
 * @returns its subject and any problem with its declared window, or `null` when this build has no such atlas
 */
async function gatherAtlas({
  deps,
  platform,
  home,
  windowMsOverride,
}: {
  deps: AtlasFreshnessDeps;
  platform: string;
  home: string | undefined;
  windowMsOverride: number | undefined;
}): Promise<GatheredAtlas | null> {
  const registration = deps.find({ platform });
  if (registration === null) {
    return null;
  }
  const descriptor = await registration.readDescriptor();
  const paths = atlasPathsFor({ home, platform });
  const liveReadAt = liveReadStampOf({ paths });
  return {
    problem: atlasFreshnessWindowProblem({ descriptor }),
    subject: {
      liveReadAt,
      liveReadCommand: unsetFieldAsNull({ key: "liveReadCommand", record: descriptor }),
      platform,
      resyncCommand: descriptor.resyncCommand,
      updatedAt: paths === null ? null : generationClock({ manifestPath: paths.manifest }),
      windowMs: judgedWindowMs({ descriptor, windowMsOverride }),
    },
  };
}

/**
 * The window one atlas is judged against: the caller's `--window`, which is applied to every atlas alike, or
 * the window this atlas declares for itself when the caller passed none.
 *
 * @param descriptor the atlas's own declaration, read for its window
 * @param windowMsOverride the caller's `--window`, in milliseconds, when one was passed
 * @returns the window in milliseconds
 */
function judgedWindowMs({
  descriptor,
  windowMsOverride,
}: {
  descriptor: AtlasDescriptor;
  windowMsOverride: number | undefined;
}): number {
  if (windowMsOverride === undefined) {
    return atlasFreshnessWindowMs({ descriptor });
  }
  return windowMsOverride;
}

/**
 * When this atlas's last bounded live read reached its provider.
 *
 * An unreadable stamp is treated as no stamp, for the same reason the manifest clock is: the ladder's job
 * is to say what is behind, and a corrupt companion file must not stop it saying so. The stamp's own
 * refusal is still available to anyone who reads it directly.
 *
 * @param paths this atlas's resolved directories, or `null` when no resolver names it
 * @returns the live read's instant, or `null` when there is none to read
 */
function liveReadStampOf({ paths }: { paths: { readonly root: string } | null }): string | null {
  if (paths === null) {
    return null;
  }
  const stamp = readAtlasLiveRead({ atlasDir: paths.root });
  if (stamp.isErr() || stamp.value === null) {
    return null;
  }
  return stamp.value.atIso;
}

/**
 * Judge every selected atlas against its window.
 *
 * @param deps the injected edges
 * @param platforms the atlases to judge, in the order to judge them
 * @param home the state home to read from, when the caller passed one
 * @param windowMsOverride a window to apply to every atlas, when the caller passed one
 * @returns the whole report, ready to render
 */
export async function sweepAtlasFreshness({
  deps,
  platforms,
  home,
  windowMsOverride,
}: {
  deps: AtlasFreshnessDeps;
  platforms: readonly string[];
  home: string | undefined;
  windowMsOverride: number | undefined;
}): Promise<AtlasFreshnessReport> {
  const gathered: GatheredAtlas[] = [];
  for (const platform of platforms) {
    const one = await gatherAtlas({ deps, home, platform, windowMsOverride });
    if (one !== null) {
      gathered.push(one);
    }
  }
  const nowIso = deps.now();
  return {
    nowIso,
    problems: gathered.flatMap((one) => (one.problem === null ? [] : [one.problem])),
    verdicts: judgeAtlasEstate({ nowIso, subjects: gathered.map((one) => one.subject) }),
  };
}

/**
 * Run the verb.
 *
 * The exit code is the half a scheduled row acts on: non-zero when any judged atlas is behind, so a tick
 * can branch without parsing prose. It is NOT a failure of the verb — the sweep did exactly what it was
 * asked — which is why the report still prints in full on the way out.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runAtlasFreshness({
  argv,
  deps = productionAtlasFreshnessDeps(),
}: {
  argv: readonly string[];
  deps?: AtlasFreshnessDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ATLAS_FRESHNESS_USAGE);
    return EXIT_OK;
  }
  const options = parseAtlasFreshnessArgs({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(ATLAS_FRESHNESS_USAGE);
    return EXIT_USAGE;
  }

  const known = deps.platforms();
  const named = options.value.platform;
  if (named !== undefined && !known.includes(named)) {
    deps.writeDiagnostic(`no atlas for platform ${named} — this build has: ${known.join(", ")}`);
    return EXIT_USAGE;
  }

  const report = await sweepAtlasFreshness({
    deps,
    home: options.value.home,
    platforms: named === undefined ? known : [named],
    windowMsOverride: options.value.windowMsOverride,
  });

  if (options.value.json) {
    deps.writeOut(JSON.stringify(atlasFreshnessJson({ report }), null, 2));
  } else {
    renderAtlasFreshness({ behindOnly: options.value.behindOnly, report }).forEach((line) => {
      deps.writeOut(line);
    });
  }

  return report.verdicts.some((verdict) => verdict.behind) ? EXIT_ERROR : EXIT_OK;
}

export const atlasFreshnessCommand = defineCommand({
  run: (argv) => runAtlasFreshness({ argv }),
});
