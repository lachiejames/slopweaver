/**
 * Whether every row an import would write has what it needs, live or written — the closure the knowledge register
 * refuses a merge without, checked at plan time so a plan never reads ready over a write the register would refuse.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { unmetDependencies } from "../../../../store/transfer/closure.js";
import { liveRetained } from "../../../../store/transfer/liveRetained.js";
import type { StoreExportPartKind } from "../../../../store/transfer/parts.js";
import type { RetainedEntry } from "../../../../store/transfer/retained.js";
import { CONTENTS, MEMORY_LINE, RECALL_LINE } from "./fixtures.js";

type Parts = readonly (readonly [StoreExportPartKind, readonly RetainedEntry[]])[];

/** The knowledge parts of an export holding these memory and recall lines. */
function knowledge({ memoryLines, recallLines }: { memoryLines: string[]; recallLines: string[] }): Parts {
  const parts = unwrap(liveRetained({ contents: { ...CONTENTS, memoryLines, recallLines } }));
  return [
    ["memories", parts.get("memories")!],
    ["memory-recalls", parts.get("memory-recalls")!],
  ];
}

/** The fixture memory with these fields changed. */
function memoryLine({ over }: { over: Record<string, unknown> }): string {
  return JSON.stringify({ ...(JSON.parse(MEMORY_LINE) as Record<string, unknown>), ...over });
}

const NOTHING = knowledge({ memoryLines: [], recallLines: [] });

const RECALL_NEEDS = "recording bbbbbbbb-0000-4000-8000-000000000001 of claim l-0000000000000001";

describe("unmetDependencies", () => {
  it("meets a recall whose recording the same import writes", () => {
    const written = knowledge({ memoryLines: [MEMORY_LINE], recallLines: [RECALL_LINE] });

    expect(unmetDependencies({ live: NOTHING, written })).toEqual([]);
  });

  it("meets a recall whose recording the live store already holds", () => {
    const live = knowledge({ memoryLines: [MEMORY_LINE], recallLines: [] });
    const written = knowledge({ memoryLines: [], recallLines: [RECALL_LINE] });

    expect(unmetDependencies({ live, written })).toEqual([]);
  });

  it("names a recall whose recording neither side holds, as the recording it needs", () => {
    const written = knowledge({ memoryLines: [], recallLines: [RECALL_LINE] });

    expect(unmetDependencies({ live: NOTHING, written })).toEqual([
      { key: "cccccccc-0000-4000-8000-000000000001", needs: RECALL_NEEDS, part: "memory-recalls" },
    ]);
  });

  it("names a recall whose recording is held under another claim than the one it names", () => {
    const live = knowledge({ memoryLines: [memoryLine({ over: { id: "l-0000000000000009" } })], recallLines: [] });
    const written = knowledge({ memoryLines: [], recallLines: [RECALL_LINE] });

    expect(unmetDependencies({ live, written }).map((one) => one.needs)).toEqual([RECALL_NEEDS]);
  });

  it("compares a need by its fields, never its sentence, so ids that read alike when joined never meet", () => {
    const recording = memoryLine({
      over: {
        id: "l-0000000000000009",
        recordingId: "bbbbbbbb-0000-4000-8000-000000000001 of claim l-0000000000000001",
      },
    });
    const recall = JSON.stringify({
      ...(JSON.parse(RECALL_LINE) as Record<string, unknown>),
      memoryId: "l-0000000000000001 of claim l-0000000000000009",
    });
    const written = knowledge({ memoryLines: [recording], recallLines: [recall] });

    expect(unmetDependencies({ live: NOTHING, written })).toEqual([
      {
        key: "cccccccc-0000-4000-8000-000000000001",
        needs: "recording bbbbbbbb-0000-4000-8000-000000000001 of claim l-0000000000000001 of claim l-0000000000000009",
        part: "memory-recalls",
      },
    ]);
  });

  it("meets a supersedes naming a claim recorded under the same kind", () => {
    const live = knowledge({ memoryLines: [memoryLine({ over: { id: "l-0000000000000009" } })], recallLines: [] });
    const superseding = memoryLine({
      over: { recordingId: "bbbbbbbb-0000-4000-8000-000000000002", supersedes: "l-0000000000000009" },
    });
    const written = knowledge({ memoryLines: [superseding], recallLines: [] });

    expect(unmetDependencies({ live, written })).toEqual([]);
  });

  it("names a supersedes whose claim is recorded only under another kind", () => {
    const live = knowledge({
      memoryLines: [memoryLine({ over: { id: "p-0000000000000009", kind: "preference", surface: null, tier: null } })],
      recallLines: [],
    });
    const superseding = memoryLine({
      over: { recordingId: "bbbbbbbb-0000-4000-8000-000000000002", supersedes: "p-0000000000000009" },
    });
    const written = knowledge({ memoryLines: [superseding], recallLines: [] });

    expect(unmetDependencies({ live, written })).toEqual([
      {
        key: "bbbbbbbb-0000-4000-8000-000000000002",
        needs: "claim p-0000000000000009 recorded as a lesson, and as nothing else",
        part: "memories",
      },
    ]);
  });

  it("names a supersedes whose claim is recorded under its kind and another, since the writer reads only the latest", () => {
    const live = knowledge({
      memoryLines: [
        memoryLine({ over: { id: "l-0000000000000009" } }),
        memoryLine({
          over: {
            id: "l-0000000000000009",
            kind: "preference",
            recordingId: "bbbbbbbb-0000-4000-8000-000000000003",
            surface: null,
            tier: null,
          },
        }),
      ],
      recallLines: [],
    });
    const superseding = memoryLine({
      over: { recordingId: "bbbbbbbb-0000-4000-8000-000000000002", supersedes: "l-0000000000000009" },
    });
    const written = knowledge({ memoryLines: [superseding], recallLines: [] });

    expect(unmetDependencies({ live, written }).map((one) => one.needs)).toEqual([
      "claim l-0000000000000009 recorded as a lesson, and as nothing else",
    ]);
  });

  it("never meets a self-supersede, even against a row claiming to provide it", () => {
    const claimed = { claimId: "l-self", link: "another-claim" } as const;
    const live = [["memories", [{ fingerprint: "f1", key: "provider", provides: [claimed], summary: "" }]]] as const;
    const written = [
      ["memories", [{ fingerprint: "f2", key: "self-recording", requires: [claimed], summary: "" }]],
    ] as const;

    expect(unmetDependencies({ live, written })).toEqual([
      { key: "self-recording", needs: "a claim other than l-self itself to supersede", part: "memories" },
    ]);
  });

  it("names a memory superseding its own claim even where another recording of it is held, as the register refuses", () => {
    const live = knowledge({ memoryLines: [MEMORY_LINE], recallLines: [] });
    const selfSuperseding = memoryLine({
      over: { recordingId: "bbbbbbbb-0000-4000-8000-000000000002", supersedes: "l-0000000000000001" },
    });
    const written = knowledge({ memoryLines: [selfSuperseding], recallLines: [] });

    expect(unmetDependencies({ live, written })).toEqual([
      {
        key: "bbbbbbbb-0000-4000-8000-000000000002",
        needs: "a claim other than l-0000000000000001 itself to supersede",
        part: "memories",
      },
    ]);
  });
});
