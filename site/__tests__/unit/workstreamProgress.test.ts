/*
 * The progress line a Queue card's workstream hover reads: an outcome says the verb's own line against its own
 * milestones, and a closing entry says when it closed beside where it went, so a completion reads as one with a day
 * rather than a bare state sentence.
 */

import { describe, expect, it } from "vitest";

import { workstreamProgress } from "../../lib/cardProperties";
import { readWorkstreamTiles } from "../../lib/workstreamTiles";

import { outcome } from "./workstreamOutcomeFixture";
import { closing, documentWith, linked, local, unrecordedClosing } from "./workstreamTilesFixture";

describe("workstreamProgress, a closing entry", () => {
  it("says the day it closed and where it went, or that the day was never recorded", () => {
    const view = readWorkstreamTiles({ payload: documentWith({ workstreams: [closing, unrecordedClosing] }) })!;
    expect(view.workstreams.map((one) => workstreamProgress({ view: one }))).toEqual([
      "closed 20 Sep · handed over",
      "closed date not recorded · handed over",
    ]);
  });
});

describe("workstreamProgress, every other kind", () => {
  it("says an outcome's progress line, a gauge's reading and a page-only entry's note", () => {
    const view = readWorkstreamTiles({ payload: documentWith({ workstreams: [outcome, linked, local] }) })!;
    expect(view.workstreams.map((one) => workstreamProgress({ view: one }))).toEqual([
      "1 of 3 done, next: First batch merged",
      "81 of 124 Vanta",
      "kept here only",
    ]);
  });
});
