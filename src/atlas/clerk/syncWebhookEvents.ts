/**
 * The `webhook-event` kind's next file and the standing gap it carries — split out of `sync.ts`, which
 * publishes it beside the `operation` kind.
 */
import { err, ok, type Result } from "#lib/result.js";

import { succeededClerkCoverageCell } from "./coverage.js";
import { openClerkGap, reconcileClerkGaps } from "./gaps.js";
import { mergeClerkChannel } from "./merge.js";
import { CLERK_WEBHOOK_EVENT_KIND, type ClerkAtlasGap, type ClerkAtlasKindFile } from "./model.js";
import { projectClerkWebhookEvents } from "./projection.js";
import type { ClerkWebhookEventRow } from "./specRead.js";
import { CLERK_SPEC_SURFACE } from "./surfaceFill.js";

/**
 * The `webhook-event` kind's next file.
 *
 * @returns the next kind file, or the reason its channels or gaps could not be merged
 */
export function webhookEventKindFile({
  rows,
  stored,
  at,
}: {
  rows: readonly ClerkWebhookEventRow[];
  stored: ClerkAtlasKindFile;
  at: string;
}): Result<ClerkAtlasKindFile> {
  const merged = mergeClerkChannel({
    at,
    channel: "compiled",
    observed: projectClerkWebhookEvents({ at, rows }),
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = reconcileClerkGaps({
    at,
    observed: [webhookCredentialGap({ at })],
    rechecks: [],
    runFailed: false,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  const kept = stored.coverage.filter((cell) => cell.surface !== CLERK_SPEC_SURFACE);
  return ok({
    ...stored,
    coverage: [
      ...kept,
      succeededClerkCoverageCell({
        artifacts: [],
        at,
        channel: "compiled",
        reason: `${String(rows.length)} webhook event(s) compiled from the pinned webhooks document — every event Clerk can send, with the payload field names each carries`,
        role: "authoritative",
        scope: "webhook-event-catalogue",
        state: "synced",
        surface: CLERK_SPEC_SURFACE,
      }),
    ],
    entities: [...merged.value],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/**
 * The standing gap the webhook catalogue carries: what Clerk can send is not what this instance subscribes to.
 *
 * Open on every successful run and correct: nothing this verb does can close it, and a catalogue that
 * reported itself complete would be claiming to know which endpoints are configured when it has never asked.
 *
 * @param at this run's ISO timestamp
 * @returns the gap
 */
function webhookCredentialGap({ at }: { at: string }): ClerkAtlasGap {
  return openClerkGap({
    at,
    condition: "clerk-credential-absent",
    fields: [],
    kind: CLERK_WEBHOOK_EVENT_KIND,
    reason:
      "the catalogue says what Clerk CAN send; nothing has asked this instance which webhook endpoints " +
      "are actually configured, because no credential exists to ask with. The dashboard's own webhooks " +
      "page is the browser-side answer and is declared in the page inventory",
    scope: CLERK_WEBHOOK_EVENT_KIND,
    surfaces: ["api"],
  });
}
