/**
 * The `events-api` channel over a plain fake client: what one audit walk folds into the `event` kind, what a
 * refused walk records, and which `since` the walk was asked for.
 */
import { describe, expect, it } from "vitest";

import type { OnepasswordEventsClient } from "../../../../atlas/onepassword/eventsClient.js";
import { emptyOnepasswordKindFile, type OnepasswordKindFile } from "../../../../atlas/onepassword/model.js";
import { projectOnepasswordEvent } from "../../../../atlas/onepassword/projection.js";
import type { OnepasswordProgress } from "../../../../atlas/onepassword/syncCore.js";
import { syncEvents } from "../../../../atlas/onepassword/syncEventsChannel.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-08-29T00:00:00.000Z";
const SINCE = "2026-08-01T00:00:00.000Z";

/** One raw audit event, in the shape the Events API returns. */
const RAW_EVENT = {
  action: "grant",
  actor_type: "user",
  actor_uuid: "ACTORACTORACTORACTORACTORA",
  object_type: "vault",
  object_uuid: "OBJECTOBJECTOBJECTOBJECT01",
  timestamp: "2026-08-02T00:00:00Z",
  uuid: "EVENTEVENTEVENTEVENTEVENTA",
};

/** A client whose walk answers as told, and which records every `since` it was asked for. */
function countingClient({ walk }: { walk: Awaited<ReturnType<OnepasswordEventsClient["listAuditEvents"]>> }): {
  client: OnepasswordEventsClient;
  sinces: string[];
} {
  const sinces: string[] = [];
  const client: OnepasswordEventsClient = {
    listAuditEvents: async ({ since }) => {
      sinces.push(since);
      return walk;
    },
  };
  return { client, sinces };
}

/** A progress sink that keeps every line. */
function recordingProgress(): { onProgress: OnepasswordProgress; lines: string[] } {
  const lines: string[] = [];
  const onProgress: OnepasswordProgress = ({ line }) => {
    lines.push(line);
  };
  return { lines, onProgress };
}

/** A stored `event` file already holding one event from an earlier run. */
function storedWithOneEvent(): { stored: OnepasswordKindFile; held: OnepasswordKindFile["entities"][number] } {
  const held = unwrap(projectOnepasswordEvent({ at: "2026-08-15T00:00:00.000Z", raw: RAW_EVENT }));
  return { held, stored: { ...emptyOnepasswordKindFile({ kind: "event", updatedAt: AT }), entities: [held] } };
}

describe("syncEvents", () => {
  it("folds a truncated walk's event in, opens the pagination gap, and reports the kind incomplete", async () => {
    const { client, sinces } = countingClient({ walk: ok({ items: [RAW_EVENT], truncated: true }) });
    const { onProgress, lines } = recordingProgress();

    const result = unwrap(
      await syncEvents({
        at: AT,
        client,
        onProgress,
        since: SINCE,
        stored: emptyOnepasswordKindFile({ kind: "event", updatedAt: AT }),
      }),
    );

    expect(sinces).toEqual([SINCE]);
    expect({ complete: result.complete, entityCount: result.entityCount, kind: result.kind }).toEqual({
      complete: false,
      entityCount: 1,
      kind: "event",
    });
    // An incomplete kind states why, or a failed sync's closing stderr line has no cause to name.
    expect(result.reasons).toEqual(["the audit walk stopped at its page bound with more events still available"]);
    expect(result.file.entities).toEqual([unwrap(projectOnepasswordEvent({ at: AT, raw: RAW_EVENT }))]);
    expect(
      result.file.gaps.map((gap) => ({
        condition: gap.condition,
        reason: gap.reason,
        scope: gap.scope,
        status: gap.status,
      })),
    ).toEqual([
      {
        condition: "events-pagination-incomplete",
        reason: "the audit walk stopped at its page bound with more events still available",
        scope: "events-audit",
        status: "open",
      },
    ]);
    // The progress line is computed from the fold before truncation is applied, so it reads "synced" here.
    expect(lines).toEqual([`event: pulling audit events since ${SINCE}…`, "event: synced, 1 record(s)"]);
  });

  it("records an HTTP 403 walk as events-scope-refused and keeps the event the store already held", async () => {
    const refusal = "POST /api/v2/auditevents answered HTTP 403";
    const { client } = countingClient({ walk: err([refusal]) });
    const { onProgress, lines } = recordingProgress();
    const { stored, held } = storedWithOneEvent();

    const result = unwrap(await syncEvents({ at: AT, client, onProgress, since: SINCE, stored }));

    expect({ complete: result.complete, entities: result.file.entities, reasons: result.reasons }).toEqual({
      complete: false,
      entities: [held],
      reasons: [refusal],
    });
    expect(result.file.gaps.map((gap) => ({ condition: gap.condition, status: gap.status }))).toEqual([
      { condition: "events-scope-refused", status: "open" },
    ]);
    expect(lines).toEqual([`event: pulling audit events since ${SINCE}…`]);
  });

  it("records a refusal without HTTP 403 as detail-unreadable rather than a scope refusal", async () => {
    const { client } = countingClient({ walk: err(["POST /api/v2/auditevents answered HTTP 500"]) });
    const { onProgress } = recordingProgress();
    const { stored } = storedWithOneEvent();

    const result = unwrap(await syncEvents({ at: AT, client, onProgress, since: SINCE, stored }));

    expect(result.file.gaps.map((gap) => gap.condition)).toEqual(["detail-unreadable"]);
  });
});
