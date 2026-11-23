/**
 * `slopweaver slack saved` — the effectful shell for reading their own Slack Later list.
 *
 * Every decision is in `./savedCore.ts`. This file resolves the state home and the workspace roots, borrows
 * the atlas kit's attach (`atlas/kit/walkTransport.ts`: consent token, profile pin and the machine-wide relay
 * lease, resolved once in the tree), makes ONE visit to the declared `/later` page with no screenshot, hands
 * the capture to the core, and releases the tab in a `finally`.
 *
 * ## What reaches their browser
 *
 * The transport's closed navigate-and-observe call set and nothing else: no click, no typed text, no caller
 * script, no request replay, and `photograph: false`, so no picture of a message-bearing page is ever taken
 * (`atlas/slackApi/surfacePages.ts` refuses one for `/later`). Response bodies are read in memory and never
 * written anywhere. What touches disk is the relay kit's own machine state, shared with every relay verb —
 * the Chrome pin it rewrites under the state home and the relay lease it holds there until `release()` — plus
 * this file's throwaway scratch directory. None of it carries a byte of the list.
 *
 * ## The lease names two origins
 *
 * The client page (`https://app.slack.com`) and the origin the client's `/api/` calls land on — on a grid the
 * ENTERPRISE host, not the team one (`slackClientApiOriginFromStructures` carries the measurement).
 * `browser/playwrightCli.ts` drops any response off the lease, so the wrong second origin turns a read into
 * a silence.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import {
  slackClientApiOriginFromStructures,
  slackClientRootsFromStructures,
} from "../../../atlas/slackApi/clientRoots.js";
import { SLACK_LATER_SURFACE_PAGE, surfacePageUrl } from "../../../atlas/slackApi/surfacePages.js";
import type { BrowserPageTransport, BrowserTransportError } from "../../../browser/pageTransport.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { readStructureRows } from "../../../corpus/structures/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import {
  parseSlackSavedArgs,
  renderSlackSavedReport,
  type SlackSavedOptions,
  type SlackSavedOutcome,
  type SlackSavedReport,
  savedReportFromCapture,
} from "./savedCore.js";
import { SLACK_CLIENT_ORIGIN } from "./shotCore.js";
import { SLACK_SAVED_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * The platform name this verb takes the relay lease under, printed by a walk refused while it holds the tab.
 *
 * @internal
 */
export const SLACK_SAVED_LEASE_PLATFORM = "slack saved";

/**
 * Which named state a transport failure is.
 *
 * @param error the typed transport failure
 * @returns the outcome the report carries
 */
function outcomeOf({ error }: { error: BrowserTransportError }): SlackSavedOutcome {
  if (error.code === "SESSION_LOST") {
    return "session-lost";
  }
  if (error.code === "NAVIGATION_FAILED") {
    return "navigation-failed";
  }
  if (error.code === "OFF_LEASE_ORIGIN") {
    return "off-lease-origin";
  }
  return "relay-unavailable";
}

/**
 * A report for a read that never reached a capture: nothing observed, the reason named.
 *
 * @param outcome the named state the read stopped in
 * @param because what stopped it, and what to do about it
 * @param requestedUrl the page it would have opened
 * @returns the report
 */
function failed({
  outcome,
  because,
  requestedUrl,
}: {
  outcome: SlackSavedOutcome;
  because: string;
  requestedUrl: string;
}): SlackSavedReport {
  return {
    because,
    callsObserved: 0,
    counts: null,
    finalUrl: null,
    firstLoadTruncated: false,
    items: [],
    kind: "slack-saved",
    nextCursorPresent: false,
    outcome,
    requestedUrl,
    responseAccounting: null,
    responseOrigins: [],
    schemaVersion: 1,
  };
}

/**
 * Read their Later list once through the relay.
 *
 * @param options the validated invocation
 * @param home the state home the structure rows, consent token, profile pin and relay lease live under
 * @param profiles the door the recorded work profile is read through
 * @returns the report to print
 */
export async function readSlackSaved({
  options,
  home,
  profiles,
}: {
  options: SlackSavedOptions;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<SlackSavedReport> {
  const rows = readStructureRows({ home, source: "slack" }).rows;
  const roots = slackClientRootsFromStructures({ rows });
  if (roots === null) {
    return failed({
      because:
        "no Slack `org` structure row carries a workspace URL, so there is no client route to open — run " +
        "`slopweaver refresh --source slack` first",
      outcome: "navigation-failed",
      requestedUrl: `${SLACK_CLIENT_ORIGIN}/client/<unresolved>${SLACK_LATER_SURFACE_PAGE.path}`,
    });
  }
  const target = surfacePageUrl({ page: SLACK_LATER_SURFACE_PAGE, roots });
  const apiOrigin = slackClientApiOriginFromStructures({ rows });
  if (apiOrigin === null) {
    return failed({
      because:
        "the Slack `org` structure row names no Slack host the client's API calls could land on (a malformed " +
        "enterprise domain, or a URL off slack.com), so nothing is leased — run `slopweaver refresh --source " +
        "slack` and read the row",
      outcome: "navigation-failed",
      requestedUrl: target,
    });
  }
  return visitLaterList({ apiOrigin, home, options, profiles, target, workspaceUrl: roots.workspaceOrigin });
}

/**
 * Lease the relay for the Later page's two origins, visit it once, and always release the lease and the scratch.
 *
 * @param apiOrigin the Slack host the client's API calls land on, leased beside the client origin
 * @param target the Later page's resolved address
 * @param workspaceUrl the workspace origin each saved item's link is built against
 * @returns the report to print
 */
async function visitLaterList({
  apiOrigin,
  home,
  options,
  profiles,
  target,
  workspaceUrl,
}: {
  apiOrigin: string;
  home: string;
  options: SlackSavedOptions;
  profiles: RecordedProfilePort;
  target: string;
  workspaceUrl: string;
}): Promise<SlackSavedReport> {
  const directory = mkdtempSync(join(tmpdir(), "slopweaver-slack-saved-"));
  let transport: BrowserPageTransport | null = null;
  try {
    const attached = await attachWalkTransport({
      directory,
      home,
      origins: [SLACK_CLIENT_ORIGIN, apiOrigin],
      platform: SLACK_SAVED_LEASE_PLATFORM,
      profiles,
    });
    if (attached.isErr()) {
      return failed({ because: attached.error.join("; "), outcome: "relay-unavailable", requestedUrl: target });
    }
    transport = attached.value;
    const visited = await transport.visit({ photograph: false, settleMs: options.settleMs, url: target });
    if (visited.isErr()) {
      return failed({
        because: visited.error.message,
        outcome: outcomeOf({ error: visited.error }),
        requestedUrl: target,
      });
    }
    return savedReportFromCapture({ capture: visited.value, workspaceUrl });
  } finally {
    if (transport !== null) {
      await transport.release();
    }
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * Run `slack saved`.
 *
 * @param rest the verb's own argv tail
 * @returns the process exit code — `0` only for a `read`, an empty list included
 */
export async function runSlackSaved({ rest }: { rest: readonly string[] }): Promise<number> {
  const options = parseSlackSavedArgs({ rest });
  if (options.isErr()) {
    for (const problem of slackArgumentErrorLines({ error: options.error })) {
      logger.warn({ msg: problem });
    }
    logger.warn({ msg: SLACK_SAVED_USAGE });
    return EXIT_USAGE;
  }
  const report = await readSlackSaved({
    home: resolveHome({ named: options.value.home }),
    options: options.value,
    profiles: recordedProfilePort(),
  });
  if (options.value.json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
  } else {
    for (const line of renderSlackSavedReport({ report })) {
      logger.out({ line });
    }
  }
  return report.outcome === "read" ? EXIT_OK : EXIT_ERROR;
}

/** `slopweaver slack saved` — read their own Slack Later list, once, off the call their client makes. */
export const slackSavedCommand = defineCommand({
  run: (argv) => runSlackSaved({ rest: argv.slice(VERB_ARG_OFFSET) }),
});
