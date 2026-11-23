/**
 * The `events-api` channel: the audit walk, and nothing else. There is no introspect preflight, so what the
 * token may read is learned only from whether the walk itself is refused.
 *
 * Split from `sync.ts` alongside `syncAdminChannel.ts`. This half is structurally incapable of returning an
 * item's contents - the Events API has no endpoint that does - which is why it needs no decision from the
 * owner and can run on its own when no `op` session exists.
 */
import { err, ok, type Result } from "../../lib/result.js";

import type { OnepasswordEventsClient } from "./eventsClient.js";
import { openOnepasswordGap } from "./gaps.js";
import type { OnepasswordGap, OnepasswordKindFile } from "./model.js";
import { projectOnepasswordEvent } from "./projection.js";
import {
  failedAttempt,
  foldOnepasswordKind,
  kindResult,
  type OnepasswordProgress,
  type OnepasswordSyncKindOutcome,
  progressLineFor,
  projectionGaps,
  projectOnepasswordRows,
  succeededAttempt,
} from "./syncCore.js";

/**
 * A refused audit walk, recorded as an incomplete `event` kind rather than as a run failure.
 *
 * An HTTP 403 is separated from every other refusal because it means one specific, fixable thing: the token
 * was minted without the audit-events scope. Any other refusal is a transport problem.
 *
 * @param reason the walk's own error text, kept verbatim so the gap says what the provider said
 * @returns the `event` kind marked incomplete, or why even the empty fold refused
 */
function foldRefusedWalk({
  at,
  reason,
  stored,
}: {
  at: string;
  reason: string;
  stored: OnepasswordKindFile;
}): Result<OnepasswordSyncKindOutcome & { file: OnepasswordKindFile }> {
  const fold = foldOnepasswordKind({
    at,
    attempts: [
      failedAttempt({
        at,
        channel: "events-api",
        condition: reason.includes("HTTP 403") ? "events-scope-refused" : "detail-unreadable",
        kind: "event",
        reason,
        scope: "events-audit",
        stored,
        surface: "events-audit",
      }),
    ],
    channel: "events-api",
    extraGaps: [],
    observed: [],
    stored,
  });
  if (fold.isErr()) {
    return err(fold.error);
  }
  return ok({ ...kindResult({ fold: fold.value, kind: "event" }), complete: false });
}

/** Why a page-bound walk leaves the `event` kind incomplete — its gap's reason and the kind's alike. */
const EVENTS_TRUNCATED_REASON = "the audit walk stopped at its page bound with more events still available";

/**
 * The gaps one audit walk earned: its projection refusals, plus the page-bound gap when the walk was cut
 * short.
 *
 * A truncated walk read every event it FETCHED, so nothing about the fold is wrong — what is missing is
 * events the walk never asked for, and only a gap can say so.
 *
 * @param reasons the projection's refusals
 * @param truncated whether the walk stopped at its page bound with more available
 * @returns the gaps to carry onto the `event` kind
 */
function eventWalkGaps({
  at,
  reasons,
  truncated,
}: {
  at: string;
  reasons: readonly string[];
  truncated: boolean;
}): readonly OnepasswordGap[] {
  return [
    ...projectionGaps({ at, kind: "event", reasons, scope: "events-audit" }),
    ...(truncated
      ? [
          openOnepasswordGap({
            at,
            channel: "events-api",
            condition: "events-pagination-incomplete",
            kind: "event",
            reason: EVENTS_TRUNCATED_REASON,
            scope: "events-audit",
          }),
        ]
      : []),
  ];
}

/**
 * The events half: one audit walk through `client.listAuditEvents`, with no introspect call before it.
 *
 * @param since the ISO instant the audit walk starts from
 * @returns the `event` kind's result, incomplete when the walk was refused or hit its page bound
 */
export async function syncEvents({
  client,
  onProgress,
  stored,
  since,
  at,
}: {
  client: OnepasswordEventsClient;
  onProgress: OnepasswordProgress;
  stored: OnepasswordKindFile;
  since: string;
  at: string;
}): Promise<Result<OnepasswordSyncKindOutcome & { file: OnepasswordKindFile }>> {
  onProgress({ line: `event: pulling audit events since ${since}…` });
  const walked = await client.listAuditEvents({ since });
  if (walked.isErr()) {
    return foldRefusedWalk({ at, reason: walked.error.join("; "), stored });
  }
  const attempt = succeededAttempt({
    at,
    channel: "events-api",
    rows: walked.value.items,
    scope: "events-audit",
    surface: "events-audit",
  });
  const projected = projectOnepasswordRows({
    project: ({ raw }) => projectOnepasswordEvent({ at, raw }),
    rows: walked.value.items,
  });
  const extraGaps = eventWalkGaps({ at, reasons: projected.reasons, truncated: walked.value.truncated });
  const fold = foldOnepasswordKind({
    at,
    attempts: [attempt],
    channel: "events-api",
    extraGaps,
    observed: projected.entities,
    stored,
  });
  if (fold.isErr()) {
    return err(fold.error);
  }
  const result = kindResult({ fold: fold.value, kind: "event" });
  onProgress({ line: progressLineFor({ result }) });
  // A truncated walk read every event it fetched, so the fold is complete on its own terms; the kind is
  // not, because there are more events the atlas has not seen — and it says so, or the kind is incomplete
  // with no stated reason.
  if (!walked.value.truncated) {
    return ok(result);
  }
  return ok({ ...result, complete: false, reasons: [...result.reasons, EVENTS_TRUNCATED_REASON] });
}
