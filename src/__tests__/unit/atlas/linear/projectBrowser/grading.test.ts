/*
 * How the Linear browser channel grades a settings walk that reached every page it holds: synced only when the
 * walk was unbounded and reached every planned page, deferred when it was limited or fell short of the plan.
 */
import { describe, expect, it } from "vitest";

import { projectBrowserChannel } from "../../../../../atlas/linear/projectBrowser.js";

import {
  ART_LABELS_A,
  ART_LABELS_B,
  ART_WORKFLOW,
  ART_WORKSPACE,
  AT,
  CAPTURE_INCOMPLETE_GAP,
  EXPECTED_OPERATION_ENTITIES,
  EXPECTED_OPERATION_GAPS,
  EXPECTED_PAGE_ENTITIES,
  NO_COVERAGE,
  REACHED_PAGES,
  ranReading,
  walkCell,
} from "./harness.js";

describe("projectBrowserChannel — grading a walk that reached every page", () => {
  const reason = "3 of 3 planned settings page(s) reached, 23 GraphQL response(s) observed";
  const allArtifacts = [ART_WORKSPACE, ART_LABELS_A, ART_LABELS_B, ART_WORKFLOW];

  it("grades an unbounded walk that reached every planned page synced", () => {
    const projection = projectBrowserChannel({
      at: AT,
      plannedCount: 3,
      previous: NO_COVERAGE,
      reading: ranReading({ limited: false, pages: REACHED_PAGES }),
    });
    expect(projection.entities.page).toEqual(EXPECTED_PAGE_ENTITIES);
    expect(projection.entities.operation).toEqual(EXPECTED_OPERATION_ENTITIES);
    expect(projection.coverage.operation).toEqual([walkCell({ artifacts: [], reason, state: "synced" })]);
    expect(projection.coverage.page).toEqual([walkCell({ artifacts: allArtifacts, reason, state: "synced" })]);
    expect(projection.gaps.page).toEqual([CAPTURE_INCOMPLETE_GAP]);
    expect(projection.gaps.operation).toEqual(EXPECTED_OPERATION_GAPS);
  });

  it("grades a LIMITED walk deferred even when every planned page was reached", () => {
    const projection = projectBrowserChannel({
      at: AT,
      plannedCount: 3,
      previous: NO_COVERAGE,
      reading: ranReading({ limited: true, pages: REACHED_PAGES }),
    });
    expect(projection.coverage.operation).toEqual([walkCell({ artifacts: [], reason, state: "deferred" })]);
    expect(projection.coverage.page).toEqual([walkCell({ artifacts: allArtifacts, reason, state: "deferred" })]);
    expect(projection.entities.page).toEqual(EXPECTED_PAGE_ENTITIES);
  });

  it("grades an unbounded walk deferred when it reached fewer pages than were planned", () => {
    const projection = projectBrowserChannel({
      at: AT,
      plannedCount: 4,
      previous: NO_COVERAGE,
      reading: ranReading({ limited: false, pages: REACHED_PAGES }),
    });
    const shortReason = "3 of 4 planned settings page(s) reached, 23 GraphQL response(s) observed";
    expect(projection.coverage.operation).toEqual([
      walkCell({ artifacts: [], reason: shortReason, state: "deferred" }),
    ]);
    expect(projection.coverage.page).toEqual([
      walkCell({ artifacts: allArtifacts, reason: shortReason, state: "deferred" }),
    ]);
  });
});
