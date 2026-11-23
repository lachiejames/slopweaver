/*
 * The `--json` rendering of a Linear query document: the whole document as two-space JSON, byte for byte.
 */
import { describe, expect, it } from "vitest";

import {
  type LinearQueryDocument,
  renderLinearQueryJson,
} from "../../../../../../cli/commands/linear/queryDocument.js";

describe("renderLinearQueryJson", () => {
  it("renders the whole document — every hit, facet, count and verdict — as two-space JSON", () => {
    const document: LinearQueryDocument = {
      filter: {
        assignee: "owner-papa",
        cycle: 41,
        kind: "issue",
        labels: ["label-victor", "label-whiskey"],
        priority: 2,
        project: "project-uniform",
        state: "state-sierra",
        stateType: "started",
        team: "team-tango",
        text: "needle-xray",
        updatedSinceIso: "2026-09-01T00:00:00.000Z",
      },
      hits: [
        {
          assignee: "ana",
          cycleNumber: 7,
          identifier: "ABC-101",
          kind: "issue",
          labels: ["bug", "infra"],
          priority: 1,
          project: "Reliability",
          projectId: "proj-id-one",
          state: "Todo",
          stateType: "unstarted",
          team: "ABC",
          title: "Pool exhaustion on staging",
          tsIso: "2026-10-10T01:00:00.000Z",
          url: "https://linear.example/abc-101",
        },
        {
          assignee: undefined,
          cycleNumber: undefined,
          identifier: "DEF-202",
          kind: "issue",
          labels: [],
          priority: 4,
          project: "Security",
          projectId: undefined,
          state: "Backlog",
          stateType: "backlog",
          team: "DEF",
          title: "Rotate webhook secret",
          tsIso: "2026-10-09T02:00:00.000Z",
          url: "https://linear.example/def-202",
        },
      ],
      matched: 37,
      newestLocalIso: "2026-10-11T08:09:10.000Z",
      readAtIso: "2026-10-12T09:10:11.000Z",
      rowsScanned: 912,
      source: "linear",
      unreadable: ["/bronze-alpha/linear/a.jsonl", "/bronze-bravo/linear/b.jsonl"],
      verification: {
        requests: 3,
        verifications: [
          { drifts: [], identifier: "ABC-101", status: "confirmed" },
          { drifts: [{ field: "state", live: "Done", local: "Backlog" }], identifier: "DEF-202", status: "changed" },
        ],
        verifiedAtIso: "2026-10-12T05:06:07.000Z",
      },
    };
    expect(renderLinearQueryJson({ document })).toBe(JSON.stringify(document, undefined, 2));
  });

  it("pins the indentation, key order and dropped undefined of a small document byte for byte", () => {
    const document: LinearQueryDocument = {
      source: "linear",
      filter: { kind: "project" },
      readAtIso: "2026-10-12T09:10:11.000Z",
      matched: 0,
      rowsScanned: 5,
      newestLocalIso: undefined,
      hits: [],
      verifySkipped: "no-hits",
      unreadable: [],
    };
    expect(renderLinearQueryJson({ document })).toBe(
      [
        "{",
        '  "source": "linear",',
        '  "filter": {',
        '    "kind": "project"',
        "  },",
        '  "readAtIso": "2026-10-12T09:10:11.000Z",',
        '  "matched": 0,',
        '  "rowsScanned": 5,',
        '  "hits": [],',
        '  "verifySkipped": "no-hits",',
        '  "unreadable": []',
        "}",
      ].join("\n"),
    );
  });
});
