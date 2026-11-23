/**
 * `slopweaver atlas inngest walk [--limit <n>] [--json] [--home <dir>]` — fill the atlas's BROWSER surface
 * by visiting every route the published generation declares, in the owner's own Chrome.
 *
 * The walk, the classification, the reduction and the gap judgement are the domain's, and each is written
 * against the transport SEAM, so all of them are settled by unit tests over a fake. What is here is the
 * effects: the consent token the owner provisioned, the pinned profile, the transport that attaches to the owner's
 * browser, and the writer that proves each screenshot landed.
 *
 * ## What makes this read-only is construction, not the door guard
 *
 * `src/admit/browserSurface.ts` matches `mcp__claude-in-chrome__*` tool calls, so it does not see this path
 * at all. What holds the property is the snippet in `browser/playwrightCli.ts`: a fixed constant that only
 * ever calls `goto`, `waitForTimeout`, `$$eval` for hrefs, `screenshot`, `bringToFront`, `title` and
 * `url` — every one a read, save the tab activation a wedged capture needs (`playwrightCli.ts`). Nothing here clicks — and
 * `browserPages.ts` refuses every route whose visit would itself be an act.
 *
 * ## The denominator comes from the SYNC, so the sync must have run
 *
 * A walk with no generation has no route table to walk, and inventing one would make the browser surface
 * assert a navigation surface the application never declared. So this refuses with the sync's own command
 * rather than walking a guess.
 */
import {
  INNGEST_APP_ORIGIN,
  type InngestBrowserPage,
  inngestWalkablePages,
} from "../../../atlas/inngest/browserPages.js";
import { type InngestBrowserSurfaceOutcome, publishInngestBrowserWalk } from "../../../atlas/inngest/browserSurface.js";
import { walkInngestDashboard } from "../../../atlas/inngest/browserWalk.js";
import { INNGEST_PAGE_KIND, type InngestAtlasKindFile } from "../../../atlas/inngest/model.js";
import { inngestAtlasPaths, inngestPageArtifactPath, readInngestKindFile } from "../../../atlas/inngest/store.js";
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, `atlas` and the `inngest` platform. */
const INNGEST_VERB_INDEX = 4;

/** The origin the dashboard's own client calls, admitted so the walk can observe those calls at all. */
const INNGEST_API_ORIGIN = "https://api.inngest.com";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const INNGEST_WALK_USAGE = "usage: slopweaver atlas inngest walk [--limit <n>] [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseWalkOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean; limit: number | undefined }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "limit"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const raw = parsed.value.values["limit"];
  if (raw !== undefined && !/^[1-9][0-9]*$/.test(raw)) {
    return err([`--limit must be a positive whole number, not "${raw}"`]);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    limit: raw === undefined ? undefined : Number(raw),
  });
}

/**
 * Attach the transport, walk the declared pages and publish what came back.
 *
 * @param pages the routes this run may visit
 * @param home the resolved state home
 * @param quiet whether to discard the per-page progress lines, so `--json` stays pristine
 * @param profiles the door the recorded work profile is read through
 * @returns what was published, or every reason nothing was
 */
async function walkAndPublish({
  pages,
  home,
  quiet,
  profiles,
}: {
  pages: readonly InngestBrowserPage[];
  home: string;
  quiet: boolean;
  profiles: RecordedProfilePort;
}): Promise<Result<InngestBrowserSurfaceOutcome>> {
  const paths = inngestAtlasPaths({ home });
  const transport = await attachWalkTransport({
    directory: paths.directory,
    home,
    origins: [INNGEST_APP_ORIGIN, INNGEST_API_ORIGIN],
    platform: "inngest",
    profiles,
  });
  if (transport.isErr()) {
    return err(transport.error);
  }
  const walked = await walkInngestDashboard({
    artifactPathFor: ({ sha256 }) => inngestPageArtifactPath({ sha256 }),
    pages,
    transport: transport.value,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
    ...(quiet
      ? {}
      : {
          progress: ({ line }: { line: string }) => {
            logger.out({ line });
          },
        }),
  });
  await transport.value.release();
  if (walked.isErr()) {
    return err(walked.error);
  }
  return publishInngestBrowserWalk({ at: new Date().toISOString(), home, pages, walk: walked.value });
}

/** The walkable pages a published page file declares — none when the page kind was never published. */
function walkablePagesOf({ file }: { file: InngestAtlasKindFile | null }): readonly InngestBrowserPage[] {
  if (file === null) {
    return [];
  }
  return inngestWalkablePages({ entities: file.entities });
}

/**
 * Read the routes a walk may visit out of the published generation.
 *
 * @param home the resolved state home
 * @param limit how many routes to visit, or `undefined` for every admissible one
 * @returns the pages to walk, or every reason there are none
 */
function declaredPages({
  home,
  limit,
}: {
  home: string;
  limit: number | undefined;
}): Result<readonly InngestBrowserPage[]> {
  const stored = readInngestKindFile({ kind: INNGEST_PAGE_KIND, paths: inngestAtlasPaths({ home }) });
  if (stored.isErr()) {
    return err(stored.error);
  }
  const declared = walkablePagesOf({ file: stored.value });
  if (declared.length === 0) {
    return err([
      "no Inngest route is declared, so there is nothing to walk — run: slopweaver atlas inngest sync, which " +
        "reads the application's own route table and needs no credential",
    ]);
  }
  return ok(limit === undefined ? declared : declared.slice(0, limit));
}

/** Print every reason this verb will not run, and pick the exit code that says which kind it was. */
function refuse({ problems, usage }: { problems: readonly string[]; usage: boolean }): number {
  problems.forEach((line) => {
    logger.error({ msg: line });
  });
  if (usage) {
    logger.error({ msg: INNGEST_WALK_USAGE });
  }
  return usage ? EXIT_USAGE : EXIT_ERROR;
}

/**
 * Run the Inngest dashboard walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function inngestAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: INNGEST_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: INNGEST_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    return refuse({ problems: options.error, usage: true });
  }
  const { home, json: asJson, limit } = options.value;
  const pages = declaredPages({ home, limit });
  if (pages.isErr()) {
    pages.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const profiles = recordedProfilePort();
  const published = await walkAndPublish({ home, pages: pages.value, profiles, quiet: asJson });
  if (published.isErr()) {
    return refuse({ problems: published.error, usage: false });
  }
  if (asJson) {
    logger.out({ line: JSON.stringify(published.value, null, 1) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `inngest dashboard — ${String(published.value.reachedCount)} of ` +
      `${String(published.value.declaredCount)} declared route(s) reached, ` +
      `${String(published.value.photographedCount)} photographed, ` +
      `${String(published.value.graphqlOperationCount)} GraphQL operation(s) observed, ` +
      `${String(published.value.openGaps)} open gap(s)`,
  });
  return EXIT_OK;
}
