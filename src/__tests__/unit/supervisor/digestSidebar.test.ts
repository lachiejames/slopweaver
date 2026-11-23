/**
 * The `sidebar:` block `tick open` prints, read directly: every source the freshness report raises prints worst first with
 * its own numbers, a quiet source is counted and never called current unless it is, and a missing reading, list
 * or field says UNKNOWN.
 */
import { describe, expect, it } from "vitest";

import type { DigestInputs, DigestReading } from "../../../supervisor/digestRead.js";
import { sidebarLines } from "../../../supervisor/digestSidebar.js";

/** Digest inputs over the given readings. */
const inputsOf = ({ readings }: { readings: ReadonlyMap<string, DigestReading> }): DigestInputs => ({
  openPagesAgeMinutes: undefined,
  priorHolds: { kind: "none" },
  readings,
  recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
  runAgeMinutes: undefined,
});

/** A source row carrying every field `automation freshness` always writes, with the given ones over it. */
const rowOf = (over: Record<string, unknown>): Record<string, unknown> => ({
  behindMs: 0,
  label: "GitHub",
  problems: [],
  source: "github",
  state: "current",
  ...over,
});

describe("sidebarLines", () => {
  it("prints every source the freshness report raises, worst first, with the age since its last verified sync", () => {
    const value = {
      issues: ["roster: slack has no recipe"],
      observedAtIso: "2026-10-13T01:00:00.000Z",
      sources: [
        rowOf({ behindMs: 600_000, label: "Linear", source: "linear", state: "late" }),
        rowOf({ behindMs: 60_000 }),
        rowOf({
          behindMs: 43_200_000,
          label: "Notion",
          problems: ["resync-corpus-notion exited 1"],
          source: "notion",
          state: "failing",
        }),
        rowOf({ behindMs: null, label: "Gmail", source: "gmail", state: "never-synced" }),
        rowOf({ label: "Slack", source: "slack", state: "unverified" }),
      ],
    };
    const inputs = inputsOf({ readings: new Map([["freshness", { kind: "json", value }]]) });

    expect(sidebarLines({ inputs })).toEqual([
      "sidebar: Notion FAILING, 12.0h since its last verified sync (resync-corpus-notion exited 1), " +
        "Gmail NEVER-SYNCED, no verified sync age, Linear late, 10.0m since its last verified sync",
      "sidebar issue: roster: slack has no recipe",
    ]);
  });

  it("counts an unverified source apart from a current one, never calling it current", () => {
    const quiet = { issues: [], sources: [rowOf({}), rowOf({ label: "Slack", source: "slack", state: "unverified" })] };

    expect(
      sidebarLines({ inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value: quiet }]]) }) }),
    ).toEqual(["sidebar: nothing raised — 1 current, 1 unverified"]);
  });

  it("raises a source in a state this build does not know, with none or not a string, last and UNKNOWN", () => {
    const value = {
      issues: [],
      sources: [
        rowOf({}),
        rowOf({ label: "Fathom", source: "fathom", state: "constructor" }),
        rowOf({ label: "Linear", source: "linear", state: undefined }),
        rowOf({ label: "Gmail", source: "gmail", state: 123 }),
        rowOf({ behindMs: 60_000, label: "Slack", source: "slack", state: "late" }),
      ],
    };

    expect(sidebarLines({ inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value }]]) }) })).toEqual(
      [
        "sidebar: Slack late, 1.0m since its last verified sync, " +
          "Fathom UNKNOWN, in a state this build cannot judge: constructor, " +
          "Linear UNKNOWN, in a state this build cannot judge: (no state), " +
          "Gmail UNKNOWN, in a state this build cannot judge: (no state)",
      ],
    );
  });

  it("raises a row that will not read as a freshness row, or lacks a field the report writes, never counting it current", () => {
    const value = {
      issues: [],
      sources: [
        rowOf({ label: undefined, source: 123 }),
        rowOf({ behindMs: undefined }),
        rowOf({ label: "Linear", problems: "none", source: "linear" }),
        rowOf({ label: undefined, source: "slack" }),
        rowOf({ label: "Notion", problems: undefined, source: "notion" }),
        rowOf({ label: "Bogus", source: "not-a-provider" }),
        rowOf({ behindMs: -60_000, label: "Gmail", source: "gmail" }),
      ],
    };
    const nonFinite = {
      issues: [],
      sources: [
        rowOf({ behindMs: Infinity, label: "Calendar", source: "calendar" }),
        rowOf({ label: "Fathom", problems: [""], source: "fathom" }),
      ],
    };

    expect(
      sidebarLines({ inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value: nonFinite }]]) }) }),
    ).toEqual([
      "sidebar: Calendar UNKNOWN, its row will not read as a freshness row, " +
        "Fathom UNKNOWN, its row will not read as a freshness row",
    ]);

    expect(sidebarLines({ inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value }]]) }) })).toEqual(
      [
        "sidebar: (no source) UNKNOWN, its row will not read as a freshness row, " +
          "GitHub UNKNOWN, its row will not read as a freshness row, " +
          "Linear UNKNOWN, its row will not read as a freshness row, " +
          "slack UNKNOWN, its row will not read as a freshness row, " +
          "Notion UNKNOWN, its row will not read as a freshness row, " +
          "Bogus UNKNOWN, its row will not read as a freshness row, " +
          "Gmail UNKNOWN, its row will not read as a freshness row",
      ],
    );
  });

  it("raises a source the report carries twice, never counting either copy current", () => {
    const value = { issues: [], sources: [rowOf({}), rowOf({}), rowOf({ label: "Slack", source: "slack" })] };

    expect(sidebarLines({ inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value }]]) }) })).toEqual(
      [
        "sidebar: GitHub UNKNOWN, the report carries more than one row for it, " +
          "GitHub UNKNOWN, the report carries more than one row for it",
      ],
    );
  });

  it("says nothing is raised when every source is current, and UNKNOWN when the report is missing or empty", () => {
    const current = { issues: [], sources: [rowOf({})] };

    expect([
      sidebarLines({ inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value: current }]]) }) }),
      sidebarLines({
        inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value: { sources: [] } }]]) }),
      }),
      sidebarLines({ inputs: inputsOf({ readings: new Map() }) }),
      sidebarLines({
        inputs: inputsOf({ readings: new Map([["freshness", { kind: "json", value: { sources: current.sources } }]]) }),
      }),
      // the report types each issue as a string, so a number or an empty one is no reading of one.
      sidebarLines({
        inputs: inputsOf({
          readings: new Map([
            ["freshness", { kind: "json", value: { issues: [7, "", "x"], sources: current.sources } }],
          ]),
        }),
      }),
    ]).toEqual([
      ["sidebar: nothing raised — 1 current, 0 unverified"],
      ["sidebar: UNKNOWN — the freshness report named no source"],
      ["sidebar: UNKNOWN — freshness: not captured this tick"],
      [
        "sidebar: nothing raised — 1 current, 0 unverified",
        "sidebar issue: UNKNOWN — the freshness report carries no issues list",
      ],
      [
        "sidebar: nothing raised — 1 current, 0 unverified",
        "sidebar issue: UNKNOWN — the freshness report carries an issue that is not text",
        "sidebar issue: UNKNOWN — the freshness report carries an issue that is not text",
        "sidebar issue: x",
      ],
    ]);
  });
});
