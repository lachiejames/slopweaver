/*
 * The gaps the Linear browser channel raises for what it observed but declined to attribute: one for captured
 * requests carrying no readable document, one for response keys no captured document explains, and none when
 * the walk left nothing unattributed. Every gap lands on `operation` and never on another kind.
 */
import { describe, expect, it } from "vitest";

import { foldObservationGaps } from "../../../../../atlas/linear/browserObservationGaps.js";
import type { LinearAtlasGap, LinearAtlasKind } from "../../../../../atlas/linear/model.js";
import { byKind, type LinearBrowserReading } from "../../../../../atlas/linear/projectionKit.js";
import type { LinearPageObservation } from "../../../../../atlas/linear/walk.js";

import { AT, browserGap, EXPECTED_OPERATION_GAPS, ranReading } from "./harness.js";

const NO_PAGES: readonly LinearPageObservation[] = [];

describe("foldObservationGaps", () => {
  it("raises the unresolved-request gap and then the unexplained-key gap, both on operation", () => {
    const gaps = byKind<LinearAtlasGap[]>({ make: (): LinearAtlasGap[] => [] });
    foldObservationGaps({ at: AT, gaps, reading: ranReading({ limited: false, pages: NO_PAGES }) });
    const expected: Record<LinearAtlasKind, LinearAtlasGap[]> = {
      operation: EXPECTED_OPERATION_GAPS,
      page: [],
      setting: [],
      type: [],
    };
    expect(gaps).toEqual(expected);
  });

  it("raises no gap when every request was readable and every key explained", () => {
    const gaps = byKind<LinearAtlasGap[]>({ make: (): LinearAtlasGap[] => [] });
    const reading: LinearBrowserReading = {
      limited: false,
      observations: { graphqlResponses: 4, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
      pages: NO_PAGES,
      unavailableBecause: null,
    };
    foldObservationGaps({ at: AT, gaps, reading });
    const expected: Record<LinearAtlasKind, LinearAtlasGap[]> = { operation: [], page: [], setting: [], type: [] };
    expect(gaps).toEqual(expected);
  });

  it("raises only the unexplained-key gap when every request carried a readable document", () => {
    const gaps = byKind<LinearAtlasGap[]>({ make: (): LinearAtlasGap[] => [] });
    const reading: LinearBrowserReading = {
      limited: false,
      observations: { graphqlResponses: 2, observations: [], unexplainedKeys: ["strayKey"], unresolvedRequests: 0 },
      pages: NO_PAGES,
      unavailableBecause: null,
    };
    foldObservationGaps({ at: AT, gaps, reading });
    const expected: Record<LinearAtlasKind, LinearAtlasGap[]> = {
      operation: [
        browserGap({
          condition: "browser-response-key-unexplained",
          fields: ["strayKey"],
          kind: "operation",
          reason:
            "these response keys appeared under `data` and no captured document explains them, so they were not attributed to any schema root field",
          scope: "settings-walk",
        }),
      ],
      page: [],
      setting: [],
      type: [],
    };
    expect(gaps).toEqual(expected);
  });
});
