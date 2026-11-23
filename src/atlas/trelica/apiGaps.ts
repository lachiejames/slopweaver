/**
 * The gaps the API-surface sync observes, and the conditions it genuinely rechecks — split out of `sync.ts`,
 * which is the publish shell around them.
 *
 * The two permanent gaps are stated every run because the conditions they name are facts about the platform
 * rather than about one run: the published API wants a client this installation does not hold, and the
 * voluminous families are declared rather than stored row by row.
 */
import type { TrelicaCallResult } from "./client.js";
import type { TrelicaAtlasError } from "./errors.js";
import { openTrelicaGap, type TrelicaGapRecheck } from "./gaps.js";
import type { TrelicaAtlasGap } from "./model.js";
import type { TrelicaPublishedSurface } from "./publishedSpec.js";

/** What answered and what did not, as the gap judgement needs it. */
interface CallOutcomes {
  readonly results: readonly TrelicaCallResult[];
  readonly failures: readonly { readonly callId: string; readonly error: TrelicaAtlasError }[];
}

/**
 * Every gap this sync observed across both API channels.
 *
 * @param surface every published document that parsed, and every one that did not
 * @param run what the first-party calls returned
 * @param at this run's ISO timestamp
 * @returns the gaps, open and stamped
 */
export function trelicaApiObservedGaps({
  surface,
  run,
  at,
}: {
  surface: TrelicaPublishedSurface;
  run: CallOutcomes;
  at: string;
}): readonly TrelicaAtlasGap[] {
  const gaps: TrelicaAtlasGap[] = [
    openTrelicaGap({
      at,
      condition: "published-api-not-callable",
      fields: [],
      kind: "method",
      reason:
        "the published API is mapped in full and cannot be CALLED from here: it authenticates an OAuth2 client this installation does not hold, and answers 403 to the signed-in session cookie every first-party call is authorised by. An API key created in this tenant's own settings would fill it",
      scope: "published-api-credentials",
      surfaces: ["published-api"],
    }),
    openTrelicaGap({
      at,
      condition: "voluminous-family-not-stored",
      fields: [],
      kind: null,
      reason:
        "spend transactions and audit activity are time-series observations rather than configuration somebody authored, so they take the voluminous disposition: the surface is reached and recorded and the trailing-year total per application is held, but a row per record is not stored",
      scope: "spend-transactions-and-audit-activity",
      surfaces: ["first-party-api"],
    }),
  ];
  for (const unreadable of surface.unreadable) {
    gaps.push(
      openTrelicaGap({
        at,
        condition: "published-document-unreadable",
        fields: [],
        kind: "method",
        reason: `the vendor's own client names the ${unreadable.document} API document and this tenant does not serve it: ${unreadable.reason}`,
        scope: `published-document:${unreadable.document}`,
        surfaces: ["published-api"],
      }),
    );
  }
  for (const failure of run.failures) {
    gaps.push(
      openTrelicaGap({
        at,
        condition: "first-party-call-refused",
        fields: [],
        kind: null,
        reason: failure.error.message,
        scope: `first-party-call:${failure.callId}`,
        surfaces: ["first-party-api"],
      }),
    );
  }
  return gaps;
}

/**
 * Every condition this sync genuinely rechecked, and what the recheck found.
 *
 * @param surface every published document that parsed, and every one that did not
 * @param run what the first-party calls returned
 * @returns one recheck per document and per call attempted
 */
export function trelicaApiRechecks({
  surface,
  run,
}: {
  surface: TrelicaPublishedSurface;
  run: CallOutcomes;
}): readonly TrelicaGapRecheck[] {
  const unreadable = new Set(surface.unreadable.map((entry) => entry.document));
  const failed = new Set(run.failures.map((failure) => failure.callId));
  return [
    ...surface.documents.map((document) => ({
      condition: "published-document-unreadable",
      resolved: !unreadable.has(document.document),
      scope: `published-document:${document.document}`,
    })),
    ...[...run.results.map((result) => result.callId), ...failed].map((callId) => ({
      condition: "first-party-call-refused",
      resolved: !failed.has(callId),
      scope: `first-party-call:${callId}`,
    })),
  ];
}
