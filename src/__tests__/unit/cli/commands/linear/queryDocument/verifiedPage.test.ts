/*
 * The text rendering of a verified Linear query page: every facet, the watermark, the unreadable floor, each
 * row's verdict and drift, and the tally.
 */
import { describe, expect, it } from "vitest";

import {
  type LinearQueryDocument,
  renderLinearQueryText,
} from "../../../../../../cli/commands/linear/queryDocument.js";

import { renderedHit } from "./harness.js";

describe("renderLinearQueryText", () => {
  it("renders a verified page: every facet, the watermark, the unreadable floor, each row's verdict and drift, and the tally", () => {
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
        renderedHit({
          assignee: "ben",
          identifier: "ABC-202",
          kind: "issue",
          labels: [],
          project: "Security",
          state: "In Progress",
          title: "Rotate webhook secret",
          url: "https://linear.example/abc-202",
        }),
        renderedHit({
          assignee: "fay",
          identifier: "GHI-505",
          kind: "issue",
          labels: ["docs"],
          project: "Docs",
          state: "Done",
          title: "Document runbook",
          url: "https://linear.example/ghi-505",
        }),
        renderedHit({
          assignee: "ana",
          identifier: "ABC-101",
          kind: "issue",
          labels: ["bug", "infra"],
          project: "Reliability",
          state: "Todo",
          title: "Pool exhaustion on staging",
          url: "https://linear.example/abc-101",
        }),
        renderedHit({
          assignee: "eve",
          identifier: "DEF-404",
          kind: "issue",
          labels: [],
          project: "Quality",
          state: "Canceled",
          title: "Flaky login test",
          url: "https://linear.example/def-404",
        }),
        renderedHit({
          assignee: "dev",
          identifier: "DEF-303",
          kind: "issue",
          labels: ["chore"],
          project: "Cleanup",
          state: "Backlog",
          title: "Retire legacy cron",
          url: "https://linear.example/def-303",
        }),
        renderedHit({
          assignee: "kim",
          identifier: "MNO-707",
          kind: "issue",
          labels: [],
          project: "Platform",
          state: "Triage",
          title: "Queue backpressure",
          url: "https://linear.example/mno-707",
        }),
        // Bare on every facet, so `(unassigned)` is never conjoined with a present state, project or label; and
        // a reason with NO drifts, so the reason line is never read off drifts being present.
        renderedHit({
          assignee: undefined,
          identifier: "PQR-808",
          kind: "issue",
          labels: [],
          project: undefined,
          state: undefined,
          title: "Orphaned webhook",
          url: "https://linear.example/pqr-808",
        }),
      ],
      matched: 37,
      newestLocalIso: "2026-10-11T08:09:10.000Z",
      readAtIso: "2026-10-12T09:10:11.000Z",
      rowsScanned: 912,
      source: "linear",
      unreadable: ["/bronze-alpha/linear/a.jsonl", "/bronze-bravo/linear/b.jsonl"],
      verification: {
        requests: 7,
        verifications: [
          { drifts: [], identifier: "XYZ-900", status: "confirmed" },
          {
            drifts: [{ field: "title", live: "Flaky login spec", local: "Flaky login test" }],
            identifier: "DEF-404",
            reason: "issue lookup timed out",
            status: "unverified",
          },
          {
            drifts: [
              { field: "state", live: "Shipped", local: "In Progress" },
              { field: "assignee", live: "cara", local: "ben" },
            ],
            identifier: "ABC-202",
            status: "changed",
          },
          { drifts: [], identifier: "XYZ-901", status: "gone" },
          { drifts: [], identifier: "ABC-101", status: "confirmed" },
          { drifts: [{ field: "archived", live: "yes", local: "no" }], identifier: "ABC-101", status: "gone" },
          { drifts: [], identifier: "XYZ-902", reason: "rate limited", status: "unverified" },
          { drifts: [{ field: "archived", live: "true", local: "false" }], identifier: "DEF-303", status: "gone" },
          { drifts: [], identifier: "PQR-808", reason: "workspace unreachable", status: "unverified" },
          // Unverified with NO reason: the reason line and the unverified tally read `reason`/`status`, not each other.
          { drifts: [], identifier: "MNO-707", status: "unverified" },
        ],
        verifiedAtIso: "2026-10-12T05:06:07.000Z",
      },
    };
    expect(renderLinearQueryText({ document })).toBe(
      [
        "linear query: kind=issue assignee=owner-papa state=state-sierra state-type=started team=team-tango " +
          "project=project-uniform cycle=41 priority=2 labels=label-victor+label-whiskey " +
          "updated-since=2026-09-01T00:00:00.000Z text=needle-xray",
        "local: 37 match(es) over 912 bronze row(s); newest local record 2026-10-11T08:09:10.000Z",
        "UNREADABLE (the match count is a floor, not a total): /bronze-alpha/linear/a.jsonl, /bronze-bravo/linear/b.jsonl",
        "",
        "  ABC-202  [changed]  Rotate webhook secret",
        "      In Progress · ben · Security",
        "      https://linear.example/abc-202",
        "      state: In Progress → Shipped",
        "      assignee: ben → cara",
        "  GHI-505  [unchecked]  Document runbook",
        "      Done · fay · Docs · docs",
        "      https://linear.example/ghi-505",
        "  ABC-101  [confirmed]  Pool exhaustion on staging",
        "      Todo · ana · Reliability · bug,infra",
        "      https://linear.example/abc-101",
        "  DEF-404  [unverified]  Flaky login test",
        "      Canceled · eve · Quality",
        "      https://linear.example/def-404",
        "      title: Flaky login test → Flaky login spec",
        "      unverified: issue lookup timed out",
        "  DEF-303  [gone]  Retire legacy cron",
        "      Backlog · dev · Cleanup · chore",
        "      https://linear.example/def-303",
        "      archived: false → true",
        "  MNO-707  [unverified]  Queue backpressure",
        "      Triage · kim · Platform",
        "      https://linear.example/mno-707",
        "  PQR-808  [unverified]  Orphaned webhook",
        "      (no state) · (unassigned) · (no project)",
        "      https://linear.example/pqr-808",
        "      unverified: workspace unreachable",
        "",
        "verified 10 citation(s) in 7 request(s) at 2026-10-12T05:06:07.000Z — " +
          "2 confirmed, 1 changed, 3 gone, 4 unverified",
      ].join("\n"),
    );
  });
});
