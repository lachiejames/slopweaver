/*
 * How the Linear browser channel projects a settings walk holding every page outcome: only the reached pages
 * become entities, the walk grades deferred, and each redirected, failed, never-attempted and unphotographed
 * route raises its gap. The pages only this walk reads live here; the reached ones come from the harness.
 */
import { describe, expect, it } from "vitest";

import { projectBrowserChannel } from "../../../../../atlas/linear/projectBrowser.js";
import type { LinearPageObservation } from "../../../../../atlas/linear/walk.js";

import {
  ART_LABELS_A,
  ART_LABELS_B,
  ART_WORKFLOW,
  ART_WORKSPACE,
  AT,
  art,
  BASE,
  browserGap,
  CAPTURE_INCOMPLETE_GAP,
  EXPECTED_OPERATION_ENTITIES,
  EXPECTED_OPERATION_GAPS,
  EXPECTED_PAGE_ENTITIES,
  NO_COVERAGE,
  P_LABELS,
  P_WORKFLOW,
  P_WORKSPACE,
  ranReading,
  walkCell,
} from "./harness.js";

const ART_BILLING = art({ byteLength: 202, name: "billing-redirect", sha: "2" });
const ART_EMOJI = art({ byteLength: 606, name: "emoji-error", sha: "6" });

const P_BILLING: LinearPageObservation = {
  area: "workspace",
  artifacts: [ART_BILLING],
  captureComplete: true,
  finalUrl: `${BASE}/inbox`,
  graphqlCallCount: 1,
  observedAt: "2026-10-12T01:00:02.000Z",
  outcome: "redirected",
  pageScope: "workspace",
  providerId: "/settings/billing",
  requestedUrl: `${BASE}/settings/billing`,
  statusCode: 302,
  title: "Inbox",
};

const P_SECURITY: LinearPageObservation = {
  area: "workspace",
  artifacts: [],
  captureComplete: true,
  finalUrl: null,
  graphqlCallCount: 0,
  observedAt: null,
  outcome: "failed",
  pageScope: "workspace",
  providerId: "/settings/security",
  requestedUrl: `${BASE}/settings/security`,
  statusCode: null,
  title: null,
};

const P_SLA: LinearPageObservation = {
  area: "team",
  artifacts: [],
  captureComplete: false,
  finalUrl: null,
  graphqlCallCount: 0,
  observedAt: null,
  outcome: "not-attempted",
  pageScope: "ENG",
  providerId: "/settings/teams/ENG/sla",
  requestedUrl: `${BASE}/settings/teams/ENG/sla`,
  statusCode: null,
  title: null,
};

const P_IMPORT: LinearPageObservation = {
  area: "workspace",
  artifacts: [],
  captureComplete: true,
  finalUrl: `${BASE}/settings/import`,
  graphqlCallCount: 3,
  observedAt: "2026-10-12T01:00:06.000Z",
  outcome: "unphotographed",
  pageScope: "workspace",
  providerId: "/settings/import",
  requestedUrl: `${BASE}/settings/import?from=walk`,
  statusCode: 201,
  title: "Import",
};

const P_API: LinearPageObservation = {
  area: "workspace",
  artifacts: [],
  captureComplete: false,
  finalUrl: null,
  graphqlCallCount: 5,
  observedAt: "2026-10-12T01:00:07.000Z",
  outcome: "redirected",
  pageScope: "workspace",
  providerId: "/settings/api",
  requestedUrl: `${BASE}/settings/api`,
  statusCode: 301,
  title: "API",
};

const P_TRIAGE: LinearPageObservation = {
  area: "team",
  artifacts: [],
  captureComplete: true,
  finalUrl: null,
  graphqlCallCount: 0,
  observedAt: null,
  outcome: "not-attempted",
  pageScope: "OPS",
  providerId: "/settings/teams/OPS/triage",
  requestedUrl: `${BASE}/settings/teams/OPS/triage`,
  statusCode: null,
  title: null,
};

const P_EMOJI: LinearPageObservation = {
  area: "workspace",
  artifacts: [ART_EMOJI],
  captureComplete: false,
  finalUrl: `${BASE}/settings/emoji-error`,
  graphqlCallCount: 7,
  observedAt: "2026-10-12T01:00:10.000Z",
  outcome: "failed",
  pageScope: "workspace",
  providerId: "/settings/emoji",
  requestedUrl: `${BASE}/settings/emoji`,
  statusCode: 500,
  title: "Error",
};

const P_TEMPLATES: LinearPageObservation = {
  area: "workspace",
  artifacts: [],
  captureComplete: false,
  finalUrl: `${BASE}/settings/templates/all`,
  graphqlCallCount: 8,
  observedAt: "2026-10-12T01:00:11.000Z",
  outcome: "unphotographed",
  pageScope: "workspace",
  providerId: "/settings/templates",
  requestedUrl: `${BASE}/settings/templates`,
  statusCode: 206,
  title: "Templates",
};

const ALL_PAGES = [
  P_WORKSPACE,
  P_BILLING,
  P_LABELS,
  P_SECURITY,
  P_SLA,
  P_IMPORT,
  P_API,
  P_TRIAGE,
  P_WORKFLOW,
  P_EMOJI,
  P_TEMPLATES,
];

describe("projectBrowserChannel — a walk with every outcome", () => {
  const projection = projectBrowserChannel({
    at: AT,
    plannedCount: 11,
    previous: NO_COVERAGE,
    reading: ranReading({ limited: false, pages: ALL_PAGES }),
  });

  it("projects only the reached pages, each from its own row, with null title, time and address at the boundary", () => {
    expect(projection.entities.page).toEqual(EXPECTED_PAGE_ENTITIES);
  });

  it("projects every observed operation, and nothing onto setting or type", () => {
    expect(projection.entities.operation).toEqual(EXPECTED_OPERATION_ENTITIES);
    expect(projection.entities.setting).toEqual([]);
    expect(projection.entities.type).toEqual([]);
  });

  it("grades the walk deferred, holding only the reached pages' screenshots on the page cell", () => {
    const reason = "3 of 11 planned settings page(s) reached, 23 GraphQL response(s) observed";
    expect(projection.coverage.operation).toEqual([walkCell({ artifacts: [], reason, state: "deferred" })]);
    expect(projection.coverage.page).toEqual([
      walkCell({ artifacts: [ART_WORKSPACE, ART_LABELS_A, ART_LABELS_B, ART_WORKFLOW], reason, state: "deferred" }),
    ]);
    expect(projection.coverage.setting).toEqual([]);
    expect(projection.coverage.type).toEqual([]);
  });

  it("raises a gap per redirected and failed route, then the shortfall and unphotographed summaries", () => {
    expect(projection.gaps.page).toEqual([
      browserGap({
        condition: "settings-page-unreachable",
        fields: [],
        kind: "page",
        reason: `this route answered by moving the browser to ${BASE}/inbox, so it was not reached`,
        scope: "/settings/billing",
      }),
      browserGap({
        condition: "settings-page-unreachable",
        fields: [],
        kind: "page",
        reason: "this route answered by moving the browser to somewhere else, so it was not reached",
        scope: "/settings/api",
      }),
      browserGap({
        condition: "settings-page-unreachable",
        fields: [],
        kind: "page",
        reason: "the browser could not open this route at all",
        scope: "/settings/security",
      }),
      browserGap({
        condition: "settings-page-unreachable",
        fields: [],
        kind: "page",
        reason: "the browser could not open this route at all",
        scope: "/settings/emoji",
      }),
      browserGap({
        condition: "settings-walk-incomplete",
        fields: ["/settings/teams/ENG/sla", "/settings/teams/OPS/triage"],
        kind: "page",
        reason: "the walk stopped partway and 2 route(s) were never attempted",
        scope: "settings-walk",
      }),
      CAPTURE_INCOMPLETE_GAP,
      browserGap({
        condition: "settings-page-unphotographed",
        fields: ["/settings/import", "/settings/templates"],
        kind: "page",
        reason:
          "2 page(s) opened but could not be photographed, and a page without its held screenshot is not evidence anybody can look at",
        scope: "settings-walk",
      }),
    ]);
  });

  it("raises the two unattributed-observation gaps on operation, and none on setting or type", () => {
    expect(projection.gaps.operation).toEqual(EXPECTED_OPERATION_GAPS);
    expect(projection.gaps.setting).toEqual([]);
    expect(projection.gaps.type).toEqual([]);
  });
});
