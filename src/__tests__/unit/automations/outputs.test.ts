/**
 * `automationOutputs` — what a card says each firing produced, joined only by keys the producer wrote.
 *
 * Pure: the posting and finding lookups are plain fake functions over literals.
 */
import { describe, expect, it } from "vitest";

import type { FiringView } from "../../../automations/card.js";
import {
  automationOutputs,
  type FindingLookup,
  type PostingLookup,
  RECENT_OUTPUTS,
  recipeActor,
} from "../../../automations/outputs.js";

const firing = (over: Partial<FiringView> = {}): FiringView => ({
  attempt: 1,
  detail: null,
  exitCode: 0,
  outcome: "succeeded",
  reason: null,
  runStartedAtIso: null,
  settledAtIso: "2026-10-03T00:20:00.000Z",
  slotIso: "2026-10-03T00:00:00.000Z",
  startedAtIso: "2026-10-03T00:00:01.000Z",
  ...over,
});

const none = (): PostingLookup => ({ kind: "none" });
const noFinding = (): FindingLookup => ({ kind: "none" });

describe("automationOutputs", () => {
  it("shows a recorded posting and the finding a failed firing filed, each beside its own firing", () => {
    const posted = firing({ slotIso: "2026-10-03T04:00:00.000Z" });
    const failed = firing({ outcome: "failed", slotIso: "2026-10-03T00:00:00.000Z" });
    const outputs = automationOutputs({
      findingFor: ({ firing: one }) =>
        one.outcome === "failed"
          ? {
              finding: { settlement: null, slug: "recipe-failure-x", status: "planned", summary: "exit 1" },
              kind: "found",
            }
          : { kind: "none" },
      firings: [posted, failed],
      kind: "investigate",
      notes: [],
      postingFor: ({ slotIso }) =>
        slotIso === posted.slotIso
          ? {
              kind: "found",
              posting: {
                channel: "C1",
                postedAtIso: "2026-10-03T04:05:00.000Z",
                recipeId: "r",
                slotIso,
                ts: "1789.0001",
              },
            }
          : { kind: "none" },
      readings: [],
      storeGap: null,
    });

    expect(outputs.firings).toEqual([
      {
        finding: null,
        findingNote: null,
        posting: { channel: "C1", postedAtIso: "2026-10-03T04:05:00.000Z", ts: "1789.0001" },
        postingNote: null,
        postingUnreadable: null,
        slotIso: "2026-10-03T04:00:00.000Z",
      },
      {
        finding: { settlement: null, slug: "recipe-failure-x", status: "planned", summary: "exit 1" },
        findingNote: null,
        posting: null,
        // Never "it did not post": a run killed between its post and the record leaves exactly this state.
        postingNote: "no posting recorded — it may not have posted, or it stopped before the record was written",
        postingUnreadable: null,
        slotIso: "2026-10-03T00:00:00.000Z",
      },
    ]);
  });

  it("names why a posting is absent when the ledger read and holds none, and keeps a record that would not read apart", () => {
    const notesFor = ({ kind, lookup }: { kind: string; lookup: PostingLookup }): (string | null)[] => {
      const output = automationOutputs({
        findingFor: noFinding,
        firings: [firing()],
        kind,
        notes: [],
        postingFor: () => lookup,
        readings: [],
        storeGap: null,
      }).firings[0]!;
      return [output.postingNote, output.postingUnreadable];
    };

    expect([
      notesFor({ kind: "digest", lookup: { kind: "none" } }),
      notesFor({ kind: "investigate", lookup: { kind: "none" } }),
      notesFor({ kind: "investigate", lookup: { kind: "unreadable", why: "bad json" } }),
    ]).toEqual([
      [null, null],
      ["no posting recorded — it fired before postings were recorded, or the record could not be written", null],
      [null, "bad json"],
    ]);
  });

  it("says once, on the card, that a kind records no per-firing posting", () => {
    const noteOf = ({ kind }: { kind: string }): string | null =>
      automationOutputs({
        findingFor: noFinding,
        firings: [],
        kind,
        notes: [],
        postingFor: none,
        readings: [],
        storeGap: null,
      }).postingsNote;

    expect([
      noteOf({ kind: "digest" }),
      noteOf({ kind: "investigate" }),
      noteOf({ kind: "alert-summary" }),
      noteOf({ kind: "datadog-alert-digest" }),
    ]).toEqual([
      "a row of kind digest records no per-firing posting this page can join to a firing — what it wrote shows in its readings, notes and run detail",
      null,
      null,
      null,
    ]);
  });

  it("says a finding that would not read, rather than none", () => {
    const outputs = automationOutputs({
      findingFor: () => ({ kind: "unreadable", why: "frontmatter does not parse" }),
      firings: [firing({ outcome: "dead" })],
      kind: "investigate",
      notes: [],
      postingFor: none,
      readings: [],
      storeGap: null,
    });

    expect([outputs.firings[0]!.finding, outputs.firings[0]!.findingNote]).toEqual([
      null,
      "frontmatter does not parse",
    ]);
  });

  it("keeps the newest readings and notes, newest first, no more than a card carries, and says why a store would not read", () => {
    const readings = Array.from({ length: RECENT_OUTPUTS + 2 }, (_, index) => ({
      atIso: `2026-10-0${String(index + 1)}T00:00:00.000Z`,
      bytes: index,
      file: `r${String(index)}.json`,
      producer: "atlas",
    }));
    const outputs = automationOutputs({
      findingFor: noFinding,
      firings: [],
      kind: "verb-run",
      notes: [
        { atIso: "2026-10-01T00:00:00.000Z", url: null, what: "older" },
        { atIso: "2026-10-02T00:00:00.000Z", url: "https://x", what: "newer" },
      ],
      postingFor: none,
      readings,
      storeGap: "the reading index will not read — no card shows the readings its row took",
    });

    expect(outputs.readings.map((reading) => reading.file)).toEqual([
      "r6.json",
      "r5.json",
      "r4.json",
      "r3.json",
      "r2.json",
    ]);
    expect(outputs.notes.map((note) => note.what)).toEqual(["newer", "older"]);
    expect(outputs.storeGap).toBe("the reading index will not read — no card shows the readings its row took");
  });
});

describe("recipeActor", () => {
  it("is the by value a firing stamps on what it leaves", () => {
    expect(recipeActor({ recipeId: "organisation-hunt-daily" })).toBe("recipe:organisation-hunt-daily");
  });
});
