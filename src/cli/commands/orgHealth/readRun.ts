/**
 * `slopweaver org-health read` — read the organisation's incident channel whole and write the snapshot the
 * `org-health` monitor reads (`../../../orgHealth/read.ts`).
 *
 * The one live read in the lane, run by the supervisor's tick just before `monitor check --only org-health --fire`,
 * so the monitor pass itself stays local. The channel is the profile's
 * `orgHealth.incidentChannelId`; the token is the Slack read token every other read verb resolves. Neither being
 * there still writes a snapshot — `unmeasurable`, naming what is missing — and exits non-zero.
 *
 * The snapshot and the sightings are store rows (`../../../orgHealth/port.ts`), so a store that cannot be reached, or
 * a newer read that moved the generation, is reported as exactly that: neither claims the snapshot now reads
 * unmeasurable, since with the first nothing is known written and with the second the newer read's outcome stands.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { type OrgHealthError, OrgHealthErrors } from "../../../orgHealth/errors.js";
import { type OrgHealthPort, orgHealthPort } from "../../../orgHealth/port.js";
import { type IncidentReadApi, runIncidentRead } from "../../../orgHealth/read.js";
import { type TakeReadLock, takeReadLock } from "../../../orgHealth/readLock.js";
import { readProfile } from "../../../profileStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { orgHealthReadOptions, readLines } from "./core.js";
import { ORG_HEALTH_READ_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own arguments: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The seams `org-health read` performs its effects through. */
export interface OrgHealthReadDeps {
  readonly userToken: (args: { home: string }) => string | undefined;
  readonly botToken: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { token: string }) => IncidentReadApi;
  /** The store the marker, the sightings and the outcome go through. */
  readonly orgHealthPort: OrgHealthPort;
  /** The one read lock, in the home's runtime directory. */
  readonly takeLock: TakeReadLock;
  readonly nowMs: () => number;
  /** A monotonic clock, in ms, the read's deadline is measured by, so a wall clock stepped backward cannot extend it. */
  readonly elapsedMs: () => number;
  /** Resolves once the given ms have passed: the timer the read's deadline races each Slack call on. */
  readonly wait: (ms: number) => Promise<void>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The channel to read and the api to read it with, or what is missing.
 *
 * @param home the Slopweaver home holding the profile and the tokens
 * @param deps the token and api seams
 * @returns the source, or why there is none
 */
function incidentSource({
  home,
  deps,
}: {
  home: string;
  deps: OrgHealthReadDeps;
}): Result<{ readonly api: IncidentReadApi; readonly channelId: string }, OrgHealthError> {
  const path = stateHomePaths({ home }).profileJson;
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return err(OrgHealthErrors.fileMalformed({ detail: profile.error.detail, path }));
  }
  const channelId = profile.value?.orgHealth.incidentChannelId;
  if (channelId === undefined) {
    return err(OrgHealthErrors.configAbsent({ path }));
  }
  const chosen = resolveSlackReadToken({ botToken: deps.botToken({ home }), userToken: deps.userToken({ home }) });
  if (chosen.token === undefined) {
    return err(
      OrgHealthErrors.slackReadFailed({
        channelId,
        detail: "no Slack token configured; run `slopweaver connect slack`",
      }),
    );
  }
  return ok({ api: deps.makeApi({ token: chosen.token }), channelId });
}

/** The instant the read is judged at: the `--now` it was given, else the machine clock. */
function readInstant({ named, deps }: { named: number | undefined; deps: OrgHealthReadDeps }): number {
  if (named !== undefined) {
    return named;
  }
  return deps.nowMs();
}

/** The failures after which this read wrote no unmeasurable snapshot: the store, the generation and the lock. */
const NOTHING_WRITTEN: ReadonlySet<OrgHealthError["code"]> = new Set([
  "READ_LOCK_UNAVAILABLE",
  "REVISION_CONFLICT",
  "STORED_INVALID",
  "STORE_UNAVAILABLE",
]);

/** The line a failed read prints, claiming the snapshot now reads unmeasurable only where this read wrote it. */
function failureLine({ error }: { error: OrgHealthError }): string {
  if (NOTHING_WRITTEN.has(error.code)) {
    return error.message;
  }
  return `the snapshot now reads unmeasurable — ${error.message}`;
}

/**
 * Run `org-health read` against injected seams.
 *
 * @param rest the argv tail after `org-health read`
 * @param deps the tokens, the api factory, the clock and the two sinks
 * @returns the process exit code
 */
export async function runOrgHealthRead({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OrgHealthReadDeps;
}): Promise<number> {
  const options = orgHealthReadOptions({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, ORG_HEALTH_READ_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: options.value.home });
  const nowMs = readInstant({ deps, named: options.value.nowMs });
  const read = await runIncidentRead({
    clock: deps.nowMs,
    elapsed: deps.elapsedMs,
    home,
    nowMs,
    port: deps.orgHealthPort,
    source: incidentSource({ deps, home }),
    takeLock: deps.takeLock,
    wait: deps.wait,
  });
  if (read.isErr() && read.error.code === "READ_UNDER_WAY") {
    deps.writeDiagnostic(`org-health read: ${read.error.message}`);
    return EXIT_DEFERRED;
  }
  if (read.isErr()) {
    deps.writeDiagnostic(`org-health read: ${failureLine({ error: read.error })}`);
    return EXIT_ERROR;
  }
  for (const line of readLines({ json: options.value.json, read: read.value })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * The production seams: the configured Slack read tokens, the one Slack read client, the machine clock, and the two
 * output channels.
 *
 * @returns the dependencies `org-health read` runs on
 */
export function productionOrgHealthReadDeps(): OrgHealthReadDeps {
  return {
    botToken: ({ home }) => slackBotToken({ home }),
    elapsedMs: () => performance.now(),
    makeApi: ({ token }) => makeSlackApi({ token }),
    nowMs: () => Date.now(),
    orgHealthPort: orgHealthPort(),
    takeLock: takeReadLock,
    userToken: ({ home }) => slackUserToken({ home }),
    // Unref'd, so a read that finished never waits out a timer it no longer needs.
    wait: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms).unref();
      }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver org-health read`. */
export const orgHealthReadCommand = defineCommand({
  run: (argv) => runOrgHealthRead({ deps: productionOrgHealthReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
