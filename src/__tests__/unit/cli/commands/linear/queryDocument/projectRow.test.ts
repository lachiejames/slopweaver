/*
 * The text rendering of a project row: its lead and labels, never its own project-name facet, beside an issue
 * row laid out by its own kind.
 */
import { describe, expect, it } from "vitest";

import {
  type LinearQueryDocument,
  renderLinearQueryText,
} from "../../../../../../cli/commands/linear/queryDocument.js";

import { renderedHit } from "./harness.js";

describe("renderLinearQueryText", () => {
  it("renders a project row with its lead and labels, never echoing its own project-name facet", () => {
    const document: LinearQueryDocument = {
      filter: { kind: "project", team: "team-yankee" },
      hits: [
        renderedHit({
          assignee: "gus",
          identifier: "9f1c2d3e-0000-4000-8000-00000000aaaa",
          kind: "project",
          labels: ["q4", "finance"],
          project: "project-facet-zulu",
          state: "Paused",
          title: "Payments revamp",
          url: "https://linear.example/project/payments",
        }),
        // An issue between two projects, so a row's layout is never read off its first or last neighbour's kind.
        renderedHit({
          assignee: undefined,
          identifier: "OPS-61",
          kind: "issue",
          labels: [],
          project: "project-facet-cedar",
          state: "Todo",
          title: "Rotate keys",
          url: "https://linear.example/ops-61",
        }),
        renderedHit({
          assignee: undefined,
          // Ticket-shaped on purpose: a row's kind is its own field, never inferred from what its id looks like.
          identifier: "SRCH-48",
          kind: "project",
          labels: [],
          project: "project-facet-amber",
          state: "Planned",
          title: "Search rewrite",
          url: "https://linear.example/project/search",
        }),
      ],
      matched: 3,
      // No watermark on a page that HAS hits and nothing unreadable, so neither the floor line nor the empty-page
      // ending is read off a missing watermark.
      newestLocalIso: undefined,
      readAtIso: "2026-10-01T00:00:00.000Z",
      rowsScanned: 64,
      source: "linear",
      unreadable: [],
    };
    expect(renderLinearQueryText({ document })).toBe(
      [
        "linear query: kind=project team=team-yankee",
        "local: 3 match(es) over 64 bronze row(s); newest local record (none)",
        "",
        "  9f1c2d3e-0000-4000-8000-00000000aaaa  [unchecked]  Payments revamp",
        "      Paused · gus · q4,finance",
        "      https://linear.example/project/payments",
        "  OPS-61  [unchecked]  Rotate keys",
        "      Todo · (unassigned) · project-facet-cedar",
        "      https://linear.example/ops-61",
        "  SRCH-48  [unchecked]  Search rewrite",
        "      Planned · (no lead)",
        "      https://linear.example/project/search",
        "",
        "citations UNVERIFIED — --no-verify was passed",
      ].join("\n"),
    );
  });
});
