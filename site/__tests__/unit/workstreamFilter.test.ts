import { describe, expect, it } from "vitest";

import {
  ALL,
  AT_RISK,
  filterFacets,
  heroNumbers,
  inContext,
  matchesFilter,
  NO_INITIATIVE,
  NOT_STATED,
  readFilter,
  readOpen,
  withFilter,
  withOpen,
} from "../../lib/workstreamFilter";
import { readWorkstreamTiles, type WorkstreamsView } from "../../lib/workstreamTiles";

import { abandoned, outcome } from "./workstreamOutcomeFixture";
import { closing, documentWith, linked, local } from "./workstreamTilesFixture";

/** The fixture document, read the way the page reads it. */
function viewOf(): WorkstreamsView {
  return readWorkstreamTiles({ payload: documentWith({ workstreams: [outcome, linked, local, closing] }) })!;
}

describe("inContext", () => {
  it("shows Acme's workstreams under work and hides the Slopweaver one, counting it", () => {
    const { shown, hidden } = inContext({ context: "work", workstreams: viewOf().workstreams });
    expect(shown.map((one) => one.id)).toEqual(["logs-scrub", "iso", "old"]);
    expect(hidden).toBe(1);
  });

  it("shows only the Slopweaver workstream under the Slopweaver context", () => {
    const { shown, hidden } = inContext({ context: "slopweaver", workstreams: viewOf().workstreams });
    expect(shown.map((one) => one.id)).toEqual(["tool"]);
    expect(hidden).toBe(3);
  });
});

describe("readFilter and withFilter", () => {
  it("reads every key, an absent or empty one as all", () => {
    expect(readFilter({ search: "?context=work&state=at-risk&tag=&priority=urgent" })).toEqual({
      initiative: null,
      priority: "urgent",
      state: "at-risk",
      tag: null,
    });
    expect(readFilter({ search: "" })).toEqual(ALL);
  });

  it("sets one key and keeps the context", () => {
    expect(withFilter({ key: "state", search: "?context=slopweaver", value: "chase" })).toBe(
      "?context=slopweaver&state=chase",
    );
  });

  it("drops a key set back to all, and leaves nothing when nothing is left", () => {
    expect(withFilter({ key: "state", search: "?context=work&state=chase", value: null })).toBe("?context=work");
    expect(withFilter({ key: "state", search: "?state=chase", value: null })).toBe("");
  });
});

describe("readOpen and withOpen", () => {
  it("reads the open workstream, an absent or empty one as none", () => {
    expect(readOpen({ search: "?context=work&open=logs-scrub" })).toBe("logs-scrub");
    expect(readOpen({ search: "?open=" })).toBe(null);
    expect(readOpen({ search: "" })).toBe(null);
  });

  it("opens a card keeping every filter and the context, and closes it the same way", () => {
    const opened = withOpen({ open: "iso", search: "?context=work&state=at-risk&tag=audit" });
    expect(opened).toBe("?context=work&state=at-risk&tag=audit&open=iso");
    expect(withOpen({ open: null, search: opened })).toBe("?context=work&state=at-risk&tag=audit");
    expect(withOpen({ open: null, search: "?open=iso" })).toBe("");
  });
});

describe("matchesFilter", () => {
  const [logs, iso, , old] = viewOf().workstreams;

  it("takes every at-risk lane under at-risk, and one lane by its id", () => {
    const atRisk = { ...ALL, state: AT_RISK };
    expect([logs, iso, old].map((one) => matchesFilter({ filter: atRisk, one }))).toEqual([true, true, false]);
    expect([logs, iso].map((one) => matchesFilter({ filter: { ...ALL, state: "your-call" }, one }))).toEqual([
      false,
      true,
    ]);
  });

  it("matches a stated priority by level and an unstated one as not stated", () => {
    expect(matchesFilter({ filter: { ...ALL, priority: "urgent" }, one: logs })).toBe(true);
    expect(matchesFilter({ filter: { ...ALL, priority: NOT_STATED }, one: iso })).toBe(true);
    expect(matchesFilter({ filter: { ...ALL, priority: NOT_STATED }, one: logs })).toBe(false);
  });

  it("never matches a chosen value on a kind that carries no such field", () => {
    expect(matchesFilter({ filter: { ...ALL, priority: NOT_STATED }, one: old })).toBe(false);
    expect(matchesFilter({ filter: { ...ALL, initiative: NO_INITIATIVE }, one: old })).toBe(false);
    expect(matchesFilter({ filter: ALL, one: old })).toBe(true);
  });

  it("matches an initiative by id, none for a workstream under none, and a tag", () => {
    expect(matchesFilter({ filter: { ...ALL, initiative: "security" }, one: logs })).toBe(true);
    expect(matchesFilter({ filter: { ...ALL, initiative: NO_INITIATIVE }, one: iso })).toBe(true);
    expect(matchesFilter({ filter: { ...ALL, tag: "audit" }, one: iso })).toBe(true);
    expect(matchesFilter({ filter: { ...ALL, tag: "audit" }, one: logs })).toBe(false);
  });
});

describe("filterFacets", () => {
  it("counts each value over the context's workstreams and leaves out what nothing carries", () => {
    const view = viewOf();
    const { shown } = inContext({ context: "work", workstreams: view.workstreams });
    const facets = filterFacets({ filter: ALL, view, workstreams: shown });
    expect(
      facets.map((facet) => [facet.key, facet.options.map((option) => `${option.value}:${String(option.count)}`)]),
    ).toEqual([
      ["state", ["at-risk:2", "your-call:1", "chase:1", "done:1"]],
      ["priority", ["urgent:1", "not-stated:1"]],
      ["initiative", ["security:1", "none:1"]],
      ["tag", ["audit:1", "security:1"]],
    ]);
  });

  it("keeps a chosen value nothing carries, so it can be cleared", () => {
    const view = viewOf();
    const { shown } = inContext({ context: "work", workstreams: view.workstreams });
    const state = filterFacets({ filter: { ...ALL, state: "moving" }, view, workstreams: shown })[0];
    expect(state.options.map((option) => `${option.value}:${String(option.count)}`)).toContain("moving:0");
  });

  it("keeps a chosen value from an old link that nothing offers any more, said as such, so the dropdown names it", () => {
    const view = viewOf();
    const { shown } = inContext({ context: "work", workstreams: view.workstreams });
    const tag = filterFacets({ filter: { ...ALL, tag: "retired-tag" }, view, workstreams: shown })[3];
    expect(tag.options).toEqual([
      { count: 1, label: "audit", value: "audit" },
      { count: 1, label: "security", value: "security" },
      { count: 0, label: "retired-tag (on no workstream)", value: "retired-tag" },
    ]);
  });
});

describe("heroNumbers", () => {
  it("puts at risk first, then one per lane that holds anything, each naming what it counts", () => {
    const view = viewOf();
    const { shown } = inContext({ context: "work", workstreams: view.workstreams });
    expect(heroNumbers({ view, workstreams: shown })).toEqual([
      {
        atRisk: true,
        label: "At risk",
        names: ["Logs scrub", "ISO controls"],
        rule: "your call, chase: the ones that get dropped",
        value: "at-risk",
      },
      {
        atRisk: true,
        label: "Your call",
        names: ["ISO controls"],
        rule: "held on a decision only you can make",
        value: "your-call",
      },
      { atRisk: true, label: "Chase", names: ["Logs scrub"], rule: "held on someone named", value: "chase" },
      { atRisk: false, label: "Done", names: ["Old thing"], rule: "finished or handed over", value: "done" },
    ]);
  });

  it("counts an abandoned workstream under its own number, never under done", () => {
    const view = readWorkstreamTiles({ payload: documentWith({ workstreams: [closing, abandoned] }) })!;
    const { shown } = inContext({ context: "work", workstreams: view.workstreams });
    expect(heroNumbers({ view, workstreams: shown }).map((one) => [one.value, one.names])).toEqual([
      ["at-risk", []],
      ["done", ["Old thing"]],
      ["abandoned", ["One-click PR previews"]],
    ]);
  });

  it("keeps at risk at zero in a context holding nothing at risk", () => {
    const view = viewOf();
    const { shown } = inContext({ context: "slopweaver", workstreams: view.workstreams });
    expect(heroNumbers({ view, workstreams: shown }).map((one) => [one.value, one.names.length])).toEqual([
      ["at-risk", 0],
      ["kept-here", 1],
    ]);
  });
});
