/*
 * The text rendering of an issue row missing exactly one context facet: each absent facet prints its own
 * placeholder while the other two still render.
 */
import { describe, expect, it } from "vitest";

import {
  type LinearQueryDocument,
  renderLinearQueryText,
} from "../../../../../../cli/commands/linear/queryDocument.js";
import type { LinearQueryHit } from "../../../../../../corpus/linear/query.js";

import { renderedHit } from "./harness.js";

describe("renderLinearQueryText", () => {
  describe("an issue row missing exactly one context facet", () => {
    /**
     * One issue hit wrapped in a document whose own values are fixed and distinct from every hit's — the filter
     * kind included, so a row rendered off the page's kind rather than its own hit's prints a project's facets.
     */
    function singleHitDocument({ hit }: { hit: LinearQueryHit }): LinearQueryDocument {
      return {
        filter: { assignee: "owner-cobalt", kind: "project" },
        hits: [hit],
        matched: 1,
        newestLocalIso: "2026-09-15T06:07:08.000Z",
        readAtIso: "2026-09-16T00:00:00.000Z",
        rowsScanned: 3,
        source: "linear",
        unreadable: [],
        verifySkipped: "no-token",
      };
    }

    /** The lines every document from {@link singleHitDocument} opens with. */
    const HEADER = [
      "linear query: kind=project assignee=owner-cobalt",
      "local: 1 match(es) over 3 bronze row(s); newest local record 2026-09-15T06:07:08.000Z",
      "",
    ];

    /** The no-token footer every document from {@link singleHitDocument} closes with. */
    const FOOTER = [
      "",
      "citations UNVERIFIED — no Linear token configured; run `slopweaver connect linear` to check them live",
    ];

    it("prints `(unassigned)` for an issue with no assignee, keeping its state and project", () => {
      const hit = renderedHit({
        assignee: undefined,
        identifier: "ONB-11",
        kind: "issue",
        labels: ["ux"],
        project: "Onboarding",
        state: "Triage",
        title: "Welcome flow copy",
        url: "https://linear.example/onb-11",
      });
      expect(renderLinearQueryText({ document: singleHitDocument({ hit }) })).toBe(
        [
          ...HEADER,
          "  ONB-11  [unchecked]  Welcome flow copy",
          "      Triage · (unassigned) · Onboarding · ux",
          "      https://linear.example/onb-11",
          ...FOOTER,
        ].join("\n"),
      );
    });

    it("prints `(no state)` for an issue with no state, keeping its assignee and project", () => {
      const hit = renderedHit({
        assignee: "hal",
        identifier: "BIL-22",
        kind: "issue",
        // Labelled while stateless, so the labels facet is never read off a present state.
        labels: ["money"],
        project: "Billing",
        state: undefined,
        title: "Invoice rounding",
        url: "https://linear.example/bil-22",
      });
      expect(renderLinearQueryText({ document: singleHitDocument({ hit }) })).toBe(
        [
          ...HEADER,
          "  BIL-22  [unchecked]  Invoice rounding",
          "      (no state) · hal · Billing · money",
          "      https://linear.example/bil-22",
          ...FOOTER,
        ].join("\n"),
      );
    });

    it("prints `(no project)` for an issue with no project, keeping its state and assignee", () => {
      const hit = renderedHit({
        assignee: "ivy",
        identifier: "API-33",
        kind: "issue",
        labels: ["perf", "api"],
        project: undefined,
        state: "Started",
        title: "Cache warmup",
        url: "https://linear.example/api-33",
      });
      expect(renderLinearQueryText({ document: singleHitDocument({ hit }) })).toBe(
        [
          ...HEADER,
          "  API-33  [unchecked]  Cache warmup",
          "      Started · ivy · (no project) · perf,api",
          "      https://linear.example/api-33",
          ...FOOTER,
        ].join("\n"),
      );
    });
  });
});
