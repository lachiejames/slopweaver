/**
 * Walking a card's inline runs — and the region the mention collector used to miss.
 *
 * The `index` case is the whole reason this file exists: `resolveMention` THROWS on a person no map
 * resolves, so a mention above the fold that was never collected is not a dropped ping — it is a render
 * that dies mid-send, in a thread where somebody asked a question.
 */
import { describe, expect, it } from "vitest";

import {
  addressedGroupsOfCard,
  allRunsOf,
  asMeSequences,
  mapAsMeSequences,
  mentionedPeopleOfCard,
  runSequencesOf,
} from "../../../../outbound/artifact/runs.js";
import type { DetailBlock } from "../../../../outbound/artifact/types.js";

describe("runSequencesOf", () => {
  it("yields a paragraph's own runs", () => {
    const block: DetailBlock = { runs: [{ text: "one", type: "text" }], type: "paragraph" };

    expect(runSequencesOf({ block })).toEqual([[{ text: "one", type: "text" }]]);
  });

  it("yields every table cell, flattened row by row", () => {
    const block: DetailBlock = {
      columns: ["a", "b"],
      rows: [
        [[{ text: "1", type: "text" }], [{ text: "2", type: "text" }]],
        [[{ text: "3", type: "text" }], [{ text: "4", type: "text" }]],
      ],
      type: "table",
    };

    expect(runSequencesOf({ block }).map((runs) => runs[0]!)).toEqual([
      { text: "1", type: "text" },
      { text: "2", type: "text" },
      { text: "3", type: "text" },
      { text: "4", type: "text" },
    ]);
  });
});

describe("allRunsOf", () => {
  it("flattens across sub-blocks in document order", () => {
    const detail: readonly DetailBlock[] = [
      { runs: [{ text: "a", type: "text" }], type: "paragraph" },
      { items: [[{ text: "b", type: "text" }], [{ text: "c", type: "text" }]], type: "bullets" },
    ];

    expect(allRunsOf({ detail })).toEqual([
      { text: "a", type: "text" },
      { text: "b", type: "text" },
      { text: "c", type: "text" },
    ]);
  });
});

describe("addressedGroupsOfCard", () => {
  it("collects groups from the index AND the detail, index first, each once", () => {
    expect(
      addressedGroupsOfCard({
        detail: [
          { runs: [{ handle: "doctors", type: "group" }], type: "paragraph" },
          { runs: [{ handle: "engineers", type: "group" }], type: "paragraph" },
        ],
        index: [[{ handle: "engineers", type: "group" }]],
      }),
    ).toEqual(["engineers", "doctors"]);
  });

  it("collects nothing from a card that addresses only people", () => {
    expect(
      addressedGroupsOfCard({
        detail: [{ runs: [{ person: "ada", type: "mention" }], type: "paragraph" }],
        index: [],
      }),
    ).toEqual([]);
  });
});

describe("mentionedPeopleOfCard", () => {
  it("collects a mention that sits ONLY in the above-the-fold index", () => {
    const people = mentionedPeopleOfCard({
      detail: [{ runs: [{ text: "yes, it retried", type: "text" }], type: "paragraph" }],
      index: [
        [
          { person: "@asker", type: "mention" },
          { text: " — here is the answer", type: "text" },
        ],
      ],
    });

    expect(people).toEqual(["@asker"]);
  });

  it("reads the index BEFORE the body, and reports each person once", () => {
    const people = mentionedPeopleOfCard({
      detail: [
        { runs: [{ person: "b", type: "mention" }], type: "paragraph" },
        { runs: [{ person: "a", type: "mention" }], type: "paragraph" },
      ],
      index: [[{ person: "a", type: "mention" }]],
    });

    expect(people).toEqual(["a", "b"]);
  });

  it("reaches a mention inside a table cell", () => {
    const people = mentionedPeopleOfCard({
      detail: [
        {
          columns: ["who"],
          rows: [[[{ person: "@owner", type: "mention" }]]],
          type: "table",
        },
      ],
      index: [],
    });

    expect(people).toEqual(["@owner"]);
  });

  it("is empty for a card that mentions nobody", () => {
    expect(
      mentionedPeopleOfCard({
        detail: [{ runs: [{ text: "nothing to ping", type: "text" }], type: "paragraph" }],
        index: [[{ label: "the run", type: "link", url: "https://example.test/run" }]],
      }),
    ).toEqual([]);
  });

  it("is empty for a card with no content at all", () => {
    expect(mentionedPeopleOfCard({ detail: [], index: [] })).toEqual([]);
  });
});

describe("asMeSequences", () => {
  it("walks a drip's messages, tagged with the field and position each came from", () => {
    const walked = asMeSequences({
      artifact: {
        kind: "drip",
        messages: [{ runs: [{ text: "a", type: "text" }] }, { runs: [{ text: "b", type: "text" }] }],
      },
    });

    expect(walked.map((entry) => entry.field)).toEqual(["messages", "messages"]);
    expect(walked.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it("walks a one-card's lines", () => {
    const walked = asMeSequences({
      artifact: { kind: "one-card", lines: [{ runs: [{ text: "a", type: "text" }] }] },
    });

    expect(walked).toEqual([{ field: "lines", index: 0, runs: [{ text: "a", type: "text" }] }]);
  });

  it("walks a one-list in render order: lead, then every bullet, then every trailing line", () => {
    const walked = asMeSequences({
      artifact: {
        bullets: [[{ text: "b1", type: "text" }], [{ text: "b2", type: "text" }]],
        kind: "one-list",
        lead: [{ text: "lead", type: "text" }],
        trailing: [[{ text: "t1", type: "text" }]],
      },
    });

    expect(walked.map((entry) => entry.field)).toEqual(["lead", "bullets", "bullets", "trailing"]);
    expect(walked.map((entry) => entry.index)).toEqual([0, 0, 1, 0]);
  });

  it("answers no sequences for the plain escape hatch, which has no typed runs at all", () => {
    expect(asMeSequences({ artifact: { kind: "plain", text: "raw bytes" } })).toEqual([]);
  });
});

describe("mapAsMeSequences", () => {
  it("rewrites every field of a one-list and keeps its shape", () => {
    const mapped = mapAsMeSequences({
      artifact: {
        bullets: [[{ text: "b", type: "text" }]],
        kind: "one-list",
        lead: [{ text: "l", type: "text" }],
        trailing: [[{ text: "t", type: "text" }]],
      },
      map: (runs) => runs.map((run) => (run.type === "text" ? { ...run, text: run.text.toUpperCase() } : run)),
    });

    expect(mapped).toEqual({
      bullets: [[{ text: "B", type: "text" }]],
      kind: "one-list",
      lead: [{ text: "L", type: "text" }],
      trailing: [[{ text: "T", type: "text" }]],
    });
  });

  it("rebuilds a one-card's `{ runs }` wrappers rather than flattening them", () => {
    const mapped = mapAsMeSequences({
      artifact: { kind: "one-card", lines: [{ runs: [{ text: "a", type: "text" }] }] },
      map: () => [{ text: "z", type: "text" }],
    });

    expect(mapped).toEqual({ kind: "one-card", lines: [{ runs: [{ text: "z", type: "text" }] }] });
  });

  it("returns the plain escape hatch untouched, because its bytes are a different operation", () => {
    const artifact = { kind: "plain" as const, text: "raw bytes" };

    expect(mapAsMeSequences({ artifact, map: () => [] })).toEqual(artifact);
  });
});
