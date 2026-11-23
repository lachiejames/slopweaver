/**
 * `slopweaver atlas google-admin walk [--observation <path>] [--json] [--home <dir>]` — the browser half.
 *
 * With no `--observation` it prints the BRIEF and opens nothing. That is `docs/browser-route.md`'s own
 * (and `docs/browser-route/proof-and-capture-verbs.md`'s)
 * shape: no process this repository starts may launch a browser, so the visible session carries the walk
 * out in the owner's real Chrome and this verb judges what it hands back. With an observation it publishes
 * a generation whose `page` kind carries what the walk saw.
 *
 * ## The brief says what the walker must judge, because a status code cannot
 *
 * The Admin console is a single-page application. Every route answers 200 with the same shell, so
 * `reached` is a judgement the walker makes by reading what rendered — the Notion walk's "twenty-one
 * reached pages that were all one not-found shell" is the failure this avoids. It is also why the brief
 * asks for the page TITLE: a title is what separates a rendered page from a shell that never resolved.
 */
import { readFileSync } from "node:fs";

import {
  type GoogleAdminWalkObservation,
  googleAdminWalkObservationSchema,
  normaliseConsoleRoute,
} from "../../../../atlas/googleAdmin/consoleRoute.js";
import { syncGoogleAdminAtlas } from "../../../../atlas/googleAdmin/sync.js";
import { logger } from "../../../../lib/logger.js";
import { err, ok, type Result } from "../../../../lib/result.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";
import { GoogleAdminErrors, type GoogleAdminObservationError } from "./errors.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `google-admin` platform. */
const GOOGLE_ADMIN_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const GOOGLE_ADMIN_WALK_USAGE =
  "usage: slopweaver atlas google-admin walk [--observation <path>] [--json] [--home <dir>]";

/**
 * The brief the visible session carries out in the owner's own Chrome.
 *
 * Exported so a test reads the same text the verb prints, rather than a paraphrase of it.
 *
 * @returns the brief, ending without a trailing newline
 * @internal
 */
export function googleAdminWalkBrief(): string {
  return [
    "GOOGLE ADMIN CONSOLE WALK — carry this out in the owner's own Chrome, then re-run with --observation",
    "",
    "Start at https://admin.google.com/ac/home. If it answers a password challenge, STOP and say so: that is",
    "Google's step-up reauthentication and it is the owner's to clear, never yours to type.",
    "",
    "For each page you open, record four things:",
    "  route        the /ac/... path you asked for",
    "  settledRoute where the browser actually ended up, which is how a redirect becomes visible",
    "  title        document.title as rendered",
    "  reached      YOUR judgement that console chrome rendered, not an HTTP status",
    "",
    "The console is a single-page application and every route answers 200 with the same shell, so a status",
    "code proves nothing. Judge each page by what it rendered.",
    "",
    "Also collect observedRoutes: every /ac/... path the pages you opened LINK to. That is the walk's own",
    "denominator, because Google publishes no route inventory for this console.",
    "",
    "NORMALISE every route before writing it down. One page here renders a link per person in the directory,",
    "so a verbatim route list would put the staff list in the atlas. Replace any segment that is an opaque",
    "identifier with {id} — `consoleRoute.ts` carries the rule and the seven families the first walk found.",
    "",
    "Click nothing that writes. This atlas only ever reads.",
    "",
    "Write the result as JSON — { walkedAtIso, pages: [...], observedRoutes: [...] } — and pass its path to",
    "slopweaver atlas google-admin walk --observation <path>",
  ].join("\n");
}

/**
 * Read, validate and re-normalise a walk observation.
 *
 * Normalising HERE as well as in the brief is deliberate. The brief asks a session to do it and this
 * refuses to trust that it did, because the cost of one un-normalised route is a person's identifier
 * written to disk. Normalising twice costs nothing — {@link normaliseConsoleRoute} is idempotent.
 *
 * @param path where the observation document lives
 * @returns the validated, normalised observation, or why it cannot be used
 */
function readObservation({ path }: { path: string }): Result<GoogleAdminWalkObservation, GoogleAdminObservationError> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    return err(
      GoogleAdminErrors.observationUnreadable({ cause: cause instanceof Error ? cause.message : "unknown", path }),
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err(GoogleAdminErrors.observationNotJson({ path }));
  }
  const parsed = googleAdminWalkObservationSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      GoogleAdminErrors.observationInvalid({
        // A failed zod parse always carries at least one issue, so the first is there to read.
        detail: parsed.error.issues[0]!.message,
        path,
      }),
    );
  }
  return ok({
    observedRoutes: [
      ...new Set(parsed.data.observedRoutes.map((route) => normaliseConsoleRoute({ path: route }))),
    ].toSorted(),
    pages: parsed.data.pages.map((page) => ({
      ...page,
      route: normaliseConsoleRoute({ path: page.route }),
      settledRoute: normaliseConsoleRoute({ path: page.settledRoute }),
    })),
    walkedAtIso: parsed.data.walkedAtIso,
  });
}

/**
 * Publish one observation and report what it carried.
 *
 * @param observation the validated walk
 * @param home where to publish
 * @param json whether the caller asked for JSON
 * @returns the process exit code
 */
function publishWalk({
  observation,
  home,
  json,
}: {
  observation: GoogleAdminWalkObservation;
  home: string;
  json: boolean;
}): number {
  const report = syncGoogleAdminAtlas({ at: new Date().toISOString(), home, observation });
  if (report.isErr()) {
    logger.error({ msg: report.error.message });
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: JSON.stringify(report.value, null, 2) });
    return EXIT_OK;
  }
  const opened = observation.pages.filter((page) => page.reached).length;
  logger.out({
    line: `google-admin atlas walk — published ${observation.observedRoutes.length} console route(s), ${opened} of them opened and judged loaded`,
  });
  logger.out({
    line: "the admin-console surface is `deferred`, never `synced` — Google publishes no route inventory, so the page list is a floor, and this browser route returns images to the model rather than files, so no page carries a screenshot",
  });
  return EXIT_OK;
}

/**
 * Run the `atlas google-admin walk` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runGoogleAdminWalk(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: GOOGLE_ADMIN_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: GOOGLE_ADMIN_WALK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "observation"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: GOOGLE_ADMIN_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const path = values["observation"];
  if (path === undefined) {
    logger.out({ line: googleAdminWalkBrief() });
    return EXIT_OK;
  }
  const observation = readObservation({ path });
  if (observation.isErr()) {
    logger.error({ msg: observation.error.message });
    return EXIT_ERROR;
  }
  return publishWalk({
    home: resolveHome({ named: values["home"] }),
    json: flags.has("json"),
    observation: observation.value,
  });
}

export const googleAdminWalkCommand = defineCommand({ run: runGoogleAdminWalk });
