/**
 * The API surface, ACQUIRED: the two live reads that fill the `api` channel, and nothing else.
 *
 * ## One transport, never a second client
 *
 * Every request here goes through the caller-supplied {@link LinearRequest}, which production resolves to
 * `corpus/linear/transport.ts` — the one Linear read transport, behind the shared 429 door, the request-rate
 * gate and the server-reported budget pacer. Building a client here would put a second unpaced caller on
 * one per-user quota, which is the exact defect that transport's header records having already been fixed
 * once. A test injects a plain fake instead, so every path below is provable with no network.
 *
 * ## A refused surface is a RECORDING, never a thrown run
 *
 * A configuration read can be refused by the reading account's own entitlements — measured, to an account
 * without them `webhooks` answers _"You must be a workspace admin to interact with webhooks"_ and
 * `oauthApplications` answers _"Invalid scope: `oauth:create` required"_. Those are the visibility boundary
 * being visible, which is what an atlas is for, so each is captured as an outcome and the run continues.
 * A sync that aborted on the first refusal would publish nothing and report the workspace unreadable, which
 * is false.
 *
 * ## Paging is followed to the end, and the bound is a finding
 *
 * `settingSurfaces.ts` explains why: a single page came back exactly full on a live workspace, and a
 * full page is indistinguishable from a complete read. So every connection is followed through its own
 * cursor until `hasNextPage` is false, up to {@link SETTINGS_MAX_PAGES}, and hitting that bound is recorded
 * rather than silently truncating.
 */
import type { LinearRequest } from "../../corpus/linear/transport.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { LinearAtlasError } from "./errors.js";
import { type LinearOperationRecord, type LinearTypeRecord, operationRecords, typeRecords } from "./introspection.js";
import { readSchema } from "./schemaRead.js";
import { LINEAR_SETTING_SURFACES, type LinearSettingSurface, SETTINGS_MAX_PAGES } from "./settingSurfaces.js";
import { type LinearSettingRecord, projectSettingSurface, settingsPageCursor } from "./settings.js";

/** What one configuration surface's read came to. */
interface LinearSettingSurfaceOutcome {
  readonly group: string;
  readonly records: readonly LinearSettingRecord[];
  /** Why this surface holds nothing, when it was refused. `null` when it was read. */
  readonly refusedBecause: string | null;
  /** Whether the paging bound stopped the read before the provider said there was no more. */
  readonly pageBoundReached: boolean;
  /** How many pages were actually read. */
  readonly pagesRead: number;
}

/** Everything the API channel saw in one run. */
export interface LinearApiSurfaceReading {
  readonly operations: readonly LinearOperationRecord[];
  readonly types: readonly LinearTypeRecord[];
  readonly settings: readonly LinearSettingSurfaceOutcome[];
  /** How many introspection batches the schema read took, so the measured cost stays reproducible. */
  readonly introspectionBatches: number;
  /** The schema census this reading is of, so a later generation can say whether the schema moved. */
  readonly schemaFingerprint: string;
  /** The workspace this reading belongs to, when the organisation read succeeded. */
  readonly workspaceId: string | null;
}

/** Read one configuration surface for one scope, following its own cursor to the end. */
async function readSettingScope({
  request,
  surface,
  teamId,
  teamKey,
}: {
  request: LinearRequest;
  surface: LinearSettingSurface;
  teamId: string | null;
  teamKey: string | null;
}): Promise<{
  records: readonly LinearSettingRecord[];
  refusedBecause: string | null;
  pageBoundReached: boolean;
  pagesRead: number;
}> {
  const records: LinearSettingRecord[] = [];
  const base = teamId === null ? {} : { teamId };
  let cursor: string | null = null;
  let pagesRead = 0;
  while (pagesRead < SETTINGS_MAX_PAGES) {
    let data: unknown;
    try {
      data = await request({
        query: surface.document,
        variables: cursor === null ? base : { ...base, after: cursor },
      });
    } catch (cause: unknown) {
      return { pageBoundReached: false, pagesRead, records, refusedBecause: errorMessage({ error: cause }) };
    }
    pagesRead += 1;
    records.push(...projectSettingSurface({ data, surface, teamKey }));
    const page = settingsPageCursor({ data, surface });
    if (!page.hasNextPage) {
      return { pageBoundReached: false, pagesRead, records, refusedBecause: null };
    }
    cursor = page.endCursor;
  }
  return { pageBoundReached: true, pagesRead, records, refusedBecause: null };
}

/**
 * Read one configuration surface across every scope it applies to.
 *
 * A row that fans out per team is read once per team and its outcomes are folded into one: a refusal on any
 * one team refuses the whole group, because a partial team census reported as complete is the exact class
 * of understatement the data-integrity ruling is about.
 */
async function readSettingSurface({
  request,
  surface,
  teams,
}: {
  request: LinearRequest;
  surface: LinearSettingSurface;
  teams: readonly { readonly id: string; readonly key: string }[];
}): Promise<LinearSettingSurfaceOutcome> {
  if (!surface.perTeam) {
    const read = await readSettingScope({ request, surface, teamId: null, teamKey: null });
    return { group: surface.group, ...read };
  }
  if (teams.length === 0) {
    return {
      group: surface.group,
      pageBoundReached: false,
      pagesRead: 0,
      records: [],
      refusedBecause: "this configuration is declared only per team, and no team was read to fan it out over",
    };
  }
  const records: LinearSettingRecord[] = [];
  let pagesRead = 0;
  let pageBoundReached = false;
  for (const team of teams) {
    const read = await readSettingScope({ request, surface, teamId: team.id, teamKey: team.key });
    if (read.refusedBecause !== null) {
      return { group: surface.group, pageBoundReached, pagesRead, records, refusedBecause: read.refusedBecause };
    }
    records.push(...read.records);
    pagesRead += read.pagesRead;
    pageBoundReached = pageBoundReached || read.pageBoundReached;
  }
  return { group: surface.group, pageBoundReached, pagesRead, records, refusedBecause: null };
}

/** The teams a per-team row fans out over, read off the team configuration surface's own answer. */
function teamsFrom({
  settings,
}: {
  settings: readonly LinearSettingSurfaceOutcome[];
}): readonly { readonly id: string; readonly key: string }[] {
  const teams = settings.find((outcome) => outcome.group === "team");
  // Surfaces are read in inventory order, so one read before the team surface sees no teams yet. That is
  // never silent: `readSettingSurface` refuses a per-team surface it has no team to fan out over.
  const records = teams === undefined ? [] : teams.records;
  return records.flatMap((record) => {
    const value = record.detail.value;
    if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["key"] !== "string") {
      return [];
    }
    return [{ id: value["id"], key: value["key"] }];
  });
}

/** The workspace id, read off whatever the organisation surface returned. Never its name. */
function workspaceIdOf({ settings }: { settings: readonly LinearSettingSurfaceOutcome[] }): string | null {
  const organisation = settings.find((outcome) => outcome.group === "organization");
  const value = organisation?.records[0]?.detail.value;
  return isRecord(value) && typeof value["id"] === "string" ? value["id"] : null;
}

/**
 * Fill the API channel: the whole GraphQL schema, then every configuration surface the inventory names.
 *
 * @param request the shared Linear read transport's request seam
 * @returns everything the API channel saw, or the one failure that made a reading impossible
 */
export async function readLinearApiSurface({
  request,
}: {
  request: LinearRequest;
}): Promise<Result<LinearApiSurfaceReading, LinearAtlasError>> {
  const schema = await readSchema({ request });
  if (schema.isErr()) {
    return err(schema.error);
  }
  const settings: LinearSettingSurfaceOutcome[] = [];
  for (const surface of LINEAR_SETTING_SURFACES) {
    settings.push(await readSettingSurface({ request, surface, teams: teamsFrom({ settings }) }));
  }
  return ok({
    introspectionBatches: schema.value.batches,
    schemaFingerprint: schema.value.fingerprint,
    operations: operationRecords({ types: schema.value.types }),
    settings,
    types: typeRecords({ types: schema.value.types }),
    workspaceId: workspaceIdOf({ settings }),
  });
}
