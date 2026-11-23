/**
 * `slopweaver atlas trelica sync [--json] [--home <dir>]` — publish both API surfaces: the vendor's own
 * published documents, and the first-party calls made with the owner's signed-in session.
 *
 * The compile, the projection, the coverage and the gap judgement are the domain's and every one of them is
 * pure over an injected seam, so all of them are settled by unit tests. What is here is the effects:
 * resolving the tenant, reading the owner's Chrome's cookies, and driving the HTTP boundary — each one a field of
 * {@link TrelicaAtlasSyncDeps}, so the ordering and the exit codes are settled by unit tests too.
 *
 * ## No URL and no tenant label is ever printed
 *
 * A tenant address carries the organisation's own name. Both the human report and `--json` name the call
 * ID, the document and the counts, never an address — so redirecting this verb's output into a file cannot
 * put a private identifier somewhere it does not belong.
 */
import { createTrelicaClient } from "../../../atlas/trelica/client.js";
import { runTrelicaFirstPartyCalls } from "../../../atlas/trelica/firstPartyRun.js";
import { trelicaDocumentFetcher, trelicaHttp, trelicaPageFetcher } from "../../../atlas/trelica/http.js";
import { compileTrelicaPublishedSurface } from "../../../atlas/trelica/publishedSpec.js";
import { resolveTrelicaSession } from "../../../atlas/trelica/session.js";
import { trelicaAtlasPaths } from "../../../atlas/trelica/store.js";
import { publishTrelicaApiSurfaces, type TrelicaSyncOutcome } from "../../../atlas/trelica/sync.js";
import { resolveTrelicaTenantOrigin } from "../../../atlas/trelica/tenant.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { noteSignInWall } from "../../../browser/signInWalls.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import { parseTrelicaVerbOptions, TRELICA_SYNC_USAGE, TRELICA_VERB_INDEX } from "./core.js";

/**
 * The effects a sync reaches, so every branch can be driven without the keychain, the network, the clock,
 * the filesystem or stdout. Each effectful field is the production function's own type, so the production
 * wrapper passes the real function straight through.
 */
export interface TrelicaAtlasSyncDeps {
  /** Resolve this installation's tenant origin under a home. */
  readonly resolveTenant: typeof resolveTrelicaTenantOrigin;
  /** Assemble the signed-in session from the owner's Chrome's cookie jar and one rendered page. */
  readonly resolveSession: typeof resolveTrelicaSession;
  /** The door the recorded work profile is read through: the store in production, a memory port in a test. */
  readonly profiles: RecordedProfilePort;
  /** Record a signed-out browser, so a scheduled resync can card it. */
  readonly noteSignInWall: typeof noteSignInWall;
  /** Compile the vendor's published documents into the declared surface. */
  readonly compileSurface: typeof compileTrelicaPublishedSurface;
  /** This run's ISO instant, read once the published surface has been compiled. */
  readonly now: () => string;
  /** Make every admitted first-party call. */
  readonly runFirstParty: typeof runTrelicaFirstPartyCalls;
  /** Publish both API surfaces into the generation on disk. */
  readonly publish: typeof publishTrelicaApiSurfaces;
  /** Where the verb's data output goes. */
  readonly out: (args: { line: string }) => void;
  /** Where a refusal's or a failure's diagnostic goes. */
  readonly error: (args: { msg: string }) => void;
}

/** Print each line of a refusal or a failure as its own diagnostic. */
function reportLines({ lines, error }: { lines: readonly string[]; error: TrelicaAtlasSyncDeps["error"] }): void {
  lines.forEach((line) => {
    error({ msg: line });
  });
}

/** Print what the sync published. */
function report({
  asJson,
  outcome,
  out,
}: {
  asJson: boolean;
  outcome: TrelicaSyncOutcome;
  out: TrelicaAtlasSyncDeps["out"];
}): void {
  if (asJson) {
    out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  out({
    line:
      `trelica api surfaces — ${String(outcome.publishedOperations)} published operation(s) from ` +
      `${String(outcome.publishedDocumentsRead)} document(s) (${String(outcome.publishedDocumentsUnreadable)} unreadable), ` +
      `${String(outcome.apps)} application(s), ${String(outcome.roles)} role(s), ` +
      `${String(outcome.aiUsage)} AI-usage row(s), ${String(outcome.aiAlerts)} AI alert(s), ` +
      `${String(outcome.openGaps)} open gap(s)`,
  });
  const kinds = Object.entries(outcome.entities).map(([kind, count]) => `${kind} ${String(count)}`);
  const { read, reused, unread } = outcome.runSteps;
  out({
    line:
      `  entities — ${kinds.length === 0 ? "none read whole" : kinds.join(", ")}; run steps ${String(read)} read, ` +
      `${String(reused)} reused unchanged, ${String(unread)} unread`,
  });
}

/**
 * Run the Trelica API-surface sync over injected effects.
 *
 * The page fetcher, the document fetcher, the HTTP client and the atlas paths are built here rather than
 * injected: each is a pure constructor of a closure or a path set, and only the deps it is handed to ever
 * reach the network or the disk.
 *
 * @param argv the whole process argv
 * @param deps the tenant, session, compile, clock, first-party, publish and output effects
 * @returns `EXIT_OK` for help or a published sync, `EXIT_USAGE` for a refused tail, `EXIT_ERROR` otherwise
 */
export async function runTrelicaAtlasSync({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: TrelicaAtlasSyncDeps;
}): Promise<number> {
  const rest = verbTail({ argv, at: TRELICA_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: TRELICA_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseTrelicaVerbOptions({ rest });
  if (options.isErr()) {
    reportLines({ error: deps.error, lines: [...options.error, TRELICA_SYNC_USAGE] });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const tenantOrigin = deps.resolveTenant({ home });
  if (tenantOrigin.isErr()) {
    reportLines({ error: deps.error, lines: tenantOrigin.error });
    return EXIT_ERROR;
  }
  const session = await deps.resolveSession({
    fetchPage: trelicaPageFetcher({ tenantOrigin: tenantOrigin.value }),
    home,
    profiles: deps.profiles,
    tenantOrigin: tenantOrigin.value,
  });
  if (session.isErr()) {
    if (session.error.code === "SESSION_LOST") {
      // The one failure here the owner clears themselves: a scheduled resync records it, and the monitor cards it.
      deps.noteSignInWall({ origin: session.error.origin });
    }
    deps.error({ msg: session.error.message });
    return EXIT_ERROR;
  }
  const surface = await deps.compileSurface({
    fetchDocument: trelicaDocumentFetcher({ cookie: session.value.cookie, tenantOrigin: tenantOrigin.value }),
  });
  const at = deps.now();
  const paths = trelicaAtlasPaths({ home });
  const run = await deps.runFirstParty({
    at,
    client: createTrelicaClient({ http: trelicaHttp(), session: session.value, tenantOrigin: tenantOrigin.value }),
    paths,
  });
  const published = deps.publish({ at, paths, run, surface });
  if (published.isErr()) {
    reportLines({ error: deps.error, lines: published.error });
    return EXIT_ERROR;
  }
  report({ asJson, out: deps.out, outcome: published.value });
  return EXIT_OK;
}

/**
 * Run the Trelica API-surface sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function trelicaAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  return runTrelicaAtlasSync({
    argv,
    deps: {
      compileSurface: compileTrelicaPublishedSurface,
      error: ({ msg }) => {
        logger.error({ msg });
      },
      noteSignInWall,
      now: () => new Date().toISOString(),
      out: ({ line }) => {
        logger.out({ line });
      },
      profiles: recordedProfilePort(),
      publish: publishTrelicaApiSurfaces,
      resolveSession: resolveTrelicaSession,
      resolveTenant: resolveTrelicaTenantOrigin,
      runFirstParty: runTrelicaFirstPartyCalls,
    },
  });
}
