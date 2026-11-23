/**
 * The `web-data` sync: read every inventory call with the owner's own session, and publish what it means.
 *
 * ## What is here and what deliberately is not
 *
 * The judgement — what a 403 means, what a family measured to, which gaps a pass raises — is `webData.ts`
 * and is pure. What is here is the loop that fetches, the merge onto what the store already holds, and the
 * publish. That split is what lets the interesting behaviour be settled by unit tests over fixtures rather
 * than by luck against a live tenant.
 *
 * ## It refuses to publish a half-generation
 *
 * A run whose overview call failed publishes NOTHING, the same rule the JumpCloud atlas follows: a
 * generation missing the organisation and the workspace is not a smaller atlas, it is one that will be read
 * as though those things do not exist. A call that failed for a reason a later run could clear leaves the
 * previous generation exactly where it was, and the coverage cell carries the prior success so a failure
 * stops being current without erasing what was known.
 *
 * ## The scope is remembered, so a later sync needs no flags
 *
 * The first run is told which organisation and workspace to read. Every later one reads the pairs back out
 * of the stored `workspace` entities — which is also why the roster finding matters: Nx Cloud's own
 * organisation list can be empty for an account that reads a workspace perfectly well, so discovery alone
 * would forget the scope the day after it was given.
 */

import { absentAsEmpty, absentAsNull } from "#lib/absent.js";
import type { RecordedProfilePort } from "../../browser/recordedProfile.js";
import { loadDenylist } from "../../hygiene/scan.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasCoverageCell } from "../kit/coverage.js";
import { type NxCloudTransport, performNxCloudCall } from "./client.js";
import { decodeResourceJson, decodeSingleFetch } from "./dataRoute.js";
import { type NxCloudAtlasError, NxCloudAtlasErrors } from "./errors.js";
import { NX_CLOUD_CALLS, NX_CLOUD_ORIGIN } from "./inventory.js";
import { NX_CLOUD_ATLAS_KINDS, type NxCloudAtlasKind } from "./model.js";
import { publishNxCloudChannel } from "./publish.js";
import { readNxCloudSession } from "./session.js";
import { type NxCloudAtlasPaths, readNxCloudAtlas, withNxCloudPublishLock } from "./store.js";
import {
  buildNxCloudWebData,
  NX_CLOUD_WEB_DATA_SURFACE,
  type NxCloudCallOutcome,
  type NxCloudScope,
} from "./webData.js";

/**
 * What a sync needs that is not a pure function of its inputs.
 *
 * @internal
 */
export interface NxCloudSyncDeps {
  readonly transport: NxCloudTransport;
  readonly nowIso: () => string;
  /** The origin to address; omitted takes Nx Cloud's own. Present so a test can point at a fixture server. */
  readonly origin?: string;
  /** The door the recorded work profile, whose jar holds the session, is read through. */
  readonly profiles: RecordedProfilePort;
}

/** What one sync did. */
export interface NxCloudSyncOutcome {
  readonly scope: NxCloudScope;
  /** How many entities each kind holds after the merge. */
  readonly entityCounts: Readonly<Record<NxCloudAtlasKind, number>>;
  /** Every gap open after this run. */
  readonly openGapCount: number;
  /** The files written, in publish order. */
  readonly written: readonly string[];
  /** Which cookie names the session carried — never a value. */
  readonly cookieNames: readonly string[];
}

/**
 * Read every inventory call once, decoding each by its own content type.
 *
 * @param scope the organisation and workspace to read
 * @param cookieHeader the owner's own session header
 * @param deps the transport and clock
 * @returns one outcome per call, in inventory order
 */
export async function readNxCloudCalls({
  scope,
  cookieHeader,
  deps,
}: {
  scope: NxCloudScope;
  cookieHeader: string;
  deps: NxCloudSyncDeps;
}): Promise<readonly NxCloudCallOutcome[]> {
  const outcomes: NxCloudCallOutcome[] = [];
  for (const call of NX_CLOUD_CALLS) {
    const performed = await performNxCloudCall({
      callId: call.id,
      cookieHeader,
      orgId: scope.orgId,
      ...(deps.origin === undefined ? {} : { origin: deps.origin }),
      transport: deps.transport,
      workspaceId: scope.workspaceId,
    });
    if (performed.isErr()) {
      outcomes.push({ callId: call.id, decoded: null, failure: performed.error, response: null, url: "" });
      continue;
    }
    const response = performed.value;
    const decoded = await decodeNxCloudBody({ callId: call.id, response });
    outcomes.push({
      callId: call.id,
      decoded: decoded.isOk() ? decoded.value : null,
      failure: decoded.isErr() ? decoded.error : null,
      response,
      url: response.url,
    });
  }
  return outcomes;
}

/**
 * Decode one response by its own content type.
 *
 * A non-2xx body is not decoded at all: Nx Cloud answers a 403 with the client's own error shell, and
 * reading that as a loader payload is how a refusal turns into a confident empty record.
 *
 * @param response what came back
 * @param callId the call, so a failure names which surface could not be read
 * @returns the decoded payload, or why it could not be read
 */
async function decodeNxCloudBody({
  response,
  callId,
}: {
  response: { statusCode: number; contentType: string | null; body: string };
  callId: string;
}): Promise<Result<unknown, NxCloudAtlasError>> {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return ok(null);
  }
  const type = response.contentType;
  if (type?.includes("json") === true) {
    return decodeResourceJson({ call: callId, text: response.body });
  }
  if (type?.includes("x-script") === true || type?.includes("turbo") === true) {
    return decodeSingleFetch({ call: callId, text: response.body });
  }
  return err(
    NxCloudAtlasErrors.payloadUnreadable({
      call: callId,
      detail:
        type === null
          ? "the response carried no content-type at all, so there is nothing to decode it as"
          : `content-type \`${type}\` is neither JSON nor a single-fetch payload`,
    }),
  );
}

/**
 * Read the organisation and workspace pairs the stored generation already holds.
 *
 * @param paths the resolved paths
 * @returns every pair the store knows, oldest entity id first, or why the store could not be read
 */
export function storedNxCloudScopes({ paths }: { paths: NxCloudAtlasPaths }): Result<readonly NxCloudScope[]> {
  const snapshot = readNxCloudAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const workspaces = absentAsEmpty({ value: snapshot.value.files.workspace?.entities });
  return ok(
    workspaces.flatMap((entity): readonly NxCloudScope[] =>
      entity.scope === "" ? [] : [{ orgId: entity.scope, workspaceId: entity.providerId }],
    ),
  );
}

/**
 * Run one `web-data` sync over one scope, and publish it.
 *
 * @param paths the resolved paths
 * @param scope the organisation and workspace to read
 * @param deps the transport and clock
 * @param home the state home the session and the private denylist live under
 * @returns what the sync did, or every reason it published nothing
 */
export async function syncNxCloudWebData({
  paths,
  scope,
  deps,
  home,
}: {
  paths: NxCloudAtlasPaths;
  scope: NxCloudScope;
  deps: NxCloudSyncDeps;
  home: string;
}): Promise<Result<NxCloudSyncOutcome>> {
  const session = await readNxCloudSession({ home, origin: sessionOrigin({ deps }), profiles: deps.profiles });
  if (session.isErr()) {
    return err([session.error.message]);
  }
  const at = deps.nowIso();
  const outcomes = await readNxCloudCalls({ cookieHeader: session.value.header, deps, scope });
  const overview = absentAsNull({ value: outcomes.find((outcome) => outcome.callId === "workspace-overview") });
  if (overview?.response?.statusCode !== 200) {
    return err([
      `the workspace-overview call did not answer 200 for workspace ${scope.workspaceId}, so this run` +
        " publishes nothing — a generation with no organisation and no workspace in it reads as though" +
        " neither exists",
      ...(overview?.failure === null || overview?.failure === undefined ? [] : [overview.failure.message]),
      ...(overview?.response === null || overview?.response === undefined
        ? []
        : [`the call answered HTTP ${String(overview.response.statusCode)}`]),
    ]);
  }
  const denylist = loadDenylist({ home });
  const previousCoverage = storedWebDataCoverage({ paths });
  if (previousCoverage.isErr()) {
    return err(previousCoverage.error);
  }
  const observation = buildNxCloudWebData({ at, outcomes, previousCoverage: previousCoverage.value, scope });
  const published = withNxCloudPublishLock({
    nowIso: at,
    paths,
    publish: () =>
      publishNxCloudChannel({
        at,
        channel: "web-data",
        denylist,
        observation,
        paths,
        surface: NX_CLOUD_WEB_DATA_SURFACE,
      }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    cookieNames: session.value.cookieNames,
    entityCounts: published.value.entityCounts,
    openGapCount: published.value.openGapCount,
    scope,
    written: published.value.written,
  });
}

/** The origin whose session cookies a sync reads: the one a test named for its fixture server, else Nx Cloud's own. */
function sessionOrigin({ deps }: { deps: NxCloudSyncDeps }): string {
  if (deps.origin === undefined) {
    return NX_CLOUD_ORIGIN;
  }
  return deps.origin;
}

/**
 * The `web-data` coverage cell each kind currently holds, so a failure carries its prior success forward.
 *
 * @param paths the resolved paths
 * @returns one cell per kind, `null` where the store holds none, or why the store could not be read
 */
function storedWebDataCoverage({
  paths,
}: {
  paths: NxCloudAtlasPaths;
}): Result<Partial<Record<NxCloudAtlasKind, AtlasCoverageCell | null>>> {
  const snapshot = readNxCloudAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const previous: Partial<Record<NxCloudAtlasKind, AtlasCoverageCell | null>> = {};
  for (const kind of NX_CLOUD_ATLAS_KINDS) {
    const held = absentAsEmpty({ value: snapshot.value.files[kind]?.coverage });
    previous[kind] = absentAsNull({ value: held.find((cell) => cell.surface === NX_CLOUD_WEB_DATA_SURFACE) });
  }
  return ok(previous);
}
