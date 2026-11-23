/**
 * The gaps the Linear browser channel raises for what it observed but declined to attribute: a captured
 * request with no readable document, and a response key no captured document explains. PURE — it fills the
 * gap accumulator it is handed and touches nothing else.
 */
import { openGap } from "../kit/gaps.js";

import type { LinearAtlasGap, LinearAtlasKind } from "./model.js";
import { gap, type LinearBrowserReading } from "./projectionKit.js";

/**
 * Fold the two things the browser channel declined to attribute: a request carrying no readable document,
 * and a response key no document explains.
 *
 * Both are refusals to guess rather than failures, and each is stored so a reader can see the size of what
 * was left unattributed instead of inferring it from a smaller-than-expected operation list.
 *
 * @param at this run's ISO timestamp
 * @param gaps the accumulator to fill
 * @param reading what the walk saw
 */
export function foldObservationGaps({
  at,
  gaps,
  reading,
}: {
  at: string;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
  reading: LinearBrowserReading;
}): void {
  if (reading.observations.unresolvedRequests > 0) {
    gaps.operation.push(
      gap({
        built: openGap({
          at,
          condition: "request-shape-unresolved",
          fields: [],
          kind: "operation",
          reason: `${String(reading.observations.unresolvedRequests)} captured GraphQL request(s) carried no readable document — a persisted query sends only a hash — so nothing was attributed from them rather than a root field being guessed`,
          scope: "settings-walk",
          surfaces: ["browser"],
        }),
        kind: "operation",
      }),
    );
  }
  if (reading.observations.unexplainedKeys.length > 0) {
    gaps.operation.push(
      gap({
        built: openGap({
          at,
          condition: "browser-response-key-unexplained",
          fields: [...reading.observations.unexplainedKeys],
          kind: "operation",
          reason:
            "these response keys appeared under `data` and no captured document explains them, so they were not attributed to any schema root field",
          scope: "settings-walk",
          surfaces: ["browser"],
        }),
        kind: "operation",
      }),
    );
  }
}
