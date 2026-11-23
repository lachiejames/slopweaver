/**
 * An import's plan against the live store: every row classified, every question its rulings require, stable
 * ids and a digest that moves with the live side. Pure, bar one round trip through a throwaway export.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { importRecordsOf } from "../../../../judgement/ownerJudgementRecords.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { StandingAsk } from "../../../../profile/standingAsks.js";
import {
  type SteerMeasurementEnvelopeV2,
  steerMeasurementEnvelopeOfV1Line,
} from "../../../../profile/steerMeasurementTransfer.js";
import { type StoreExportContents, writeStoreExport } from "../../../../store/transfer/bundlePublish.js";
import { contentDigest, readExportBundle } from "../../../../store/transfer/bundleRead.js";
import { type ImportPlan, planImport } from "../../../../store/transfer/compare.js";
import { liveRetained } from "../../../../store/transfer/liveRetained.js";
import type { StoreExportPartKind } from "../../../../store/transfer/parts.js";
import {
  type RetainedEntry,
  retainedEntry,
  standingAskEntries,
  steerMeasurementEntry,
} from "../../../../store/transfer/retained.js";

import { ownerJudgementFake } from "../../../ownerJudgementFixture.js";
import { CONTENTS, DIRECTIVES, MEMORY_LINE, STANDING_ASK_LINES, STEER_LINE } from "./fixtures.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

const ALL_PARTS: readonly StoreExportPartKind[] = [
  "memories",
  "memory-recalls",
  "owner-profile",
  "owner-voice",
  "owner-directives",
  "standing-asks",
  "steer-verdicts",
];

/** Every part empty, with the named parts' entries set. */
function sides({
  set,
}: {
  set: Partial<Record<StoreExportPartKind, readonly RetainedEntry[]>>;
}): ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]> {
  return new Map(ALL_PARTS.map((kind) => [kind, kind in set ? set[kind]! : []]));
}

/** One entry whose content is a single word. */
function entry({ key, content }: { key: string; content: string }): RetainedEntry {
  return retainedEntry({ content, key, summary: `${key} says ${content}` });
}

/** One standing ask under a fixed quote. */
function ask({ id, covers }: { id: string; covers: readonly string[] }): StandingAsk {
  return {
    covers,
    id,
    quote: {
      anchor: "talk:a0000017-0000-4000-8000-000000000019",
      atIso: "2026-10-04T00:55:00.000Z",
      cut: "none",
      where: "console-voice",
      words: "chuck anything worth a look on the board",
    },
    recordedAtIso: "2026-10-05T00:00:00.000Z",
  };
}

describe("planImport", () => {
  it("counts each row new, identical or conflicting, and asks an append-only part's conflict as an alignment, both sides shown", () => {
    const plan = unwrap(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({
          set: {
            memories: [
              entry({ content: "a", key: "m-1" }),
              entry({ content: "b", key: "m-2" }),
              entry({ content: "c", key: "m-3" }),
            ],
          },
        }),
        live: sides({ set: { memories: [entry({ content: "a", key: "m-1" }), entry({ content: "x", key: "m-2" })] } }),
      }),
    );
    expect(plan.parts[0]).toEqual({
      conflicting: 1,
      identical: 1,
      kind: "memories",
      new: 1,
      role: "record",
      status: "compared",
    });
    expect(
      plan.questions.map(({ kind, key, imported, live, actions }) => ({ actions, imported, key, kind, live })),
    ).toEqual([
      {
        actions: ["keep-current"],
        imported: `m-2 says b [content ${entry({ content: "b", key: "m-2" }).fingerprint.slice(7, 19)}]`,
        key: "m-2",
        kind: "alignment",
        live: `m-2 says x [content ${entry({ content: "x", key: "m-2" }).fingerprint.slice(7, 19)}]`,
      },
    ]);
  });

  it("asks a conflict in each part whose live row an answer may replace, and an alignment in each append-only one", () => {
    const differing = { imported: [entry({ content: "b", key: "k" })], live: [entry({ content: "x", key: "k" })] };
    const parts: readonly StoreExportPartKind[] = [
      "memories",
      "memory-recalls",
      "owner-profile",
      "owner-voice",
      "steer-verdicts",
    ];
    const kinds = parts.map((part) => {
      const plan = unwrap(
        planImport({
          contentDigest: "sha256:export",
          imported: sides({ set: { [part]: differing.imported } }),
          live: sides({ set: { [part]: differing.live } }),
        }),
      );
      return [part, plan.questions.map((question) => [question.kind, question.actions])];
    });
    expect(kinds).toEqual([
      ["memories", [["alignment", ["keep-current"]]]],
      ["memory-recalls", [["alignment", ["keep-current"]]]],
      ["owner-profile", [["conflict", ["keep-current", "take-imported"]]]],
      ["owner-voice", [["conflict", ["keep-current", "take-imported"]]]],
      ["steer-verdicts", [["alignment", ["keep-current"]]]],
    ]);
  });

  it("shows a control or format character in a summary as a replacement, never as itself", () => {
    const shown = retainedEntry({ content: "a", key: "directive:d-1", summary: "X\u001b[2K\u001b[1GSAME‮end" });
    expect(shown.summary).toBe("X�[2K�[1GSAME�end");
  });

  it("asks to activate every new instruction, and nothing about one the store already holds identically", () => {
    const plan = unwrap(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({
          set: {
            "owner-directives": [entry({ content: "a", key: "directive:d-1" })],
            "standing-asks": standingAskEntries({
              asks: [ask({ covers: ["findings"], id: "ask-1" }), ask({ covers: ["bot-replies"], id: "ask-2" })],
            }),
          },
        }),
        live: sides({
          set: { "standing-asks": standingAskEntries({ asks: [ask({ covers: ["bot-replies"], id: "ask-2" })] }) },
        }),
      }),
    );
    expect(plan.questions.map(({ kind, part, key, live, actions }) => ({ actions, key, kind, live, part }))).toEqual([
      {
        actions: ["activate", "leave-inactive"],
        key: "directive:d-1",
        kind: "activation",
        live: null,
        part: "owner-directives",
      },
      { actions: ["activate", "leave-inactive"], key: "ask-1", kind: "activation", live: null, part: "standing-asks" },
    ]);
  });

  it("asks nothing about a new record or a new measurement", () => {
    const plan = unwrap(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({
          set: {
            memories: [entry({ content: "a", key: "m-1" })],
            "steer-verdicts": [entry({ content: "b", key: "t k" })],
          },
        }),
        live: sides({ set: {} }),
      }),
    );
    expect(plan.questions).toEqual([]);
  });

  it("tags both sides of a conflict with their content, so two summaries cut to the same line still differ", () => {
    const long = "a".repeat(99);
    const imported = retainedEntry({ content: "imported", key: "directive:d-1", summary: `${long} imported` });
    const current = retainedEntry({ content: "current", key: "directive:d-1", summary: `${long} current` });
    const plan = unwrap(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({ set: { "owner-directives": [imported] } }),
        live: sides({ set: { "owner-directives": [current] } }),
      }),
    );
    const question = plan.questions[0]!;
    expect(question.imported).toBe(`${long}… [content ${imported.fingerprint.slice(7, 19)}]`);
    expect(question.live).toBe(`${long}… [content ${current.fingerprint.slice(7, 19)}]`);
    expect(question.imported).not.toBe(question.live);
  });

  it("lengthens both content tags past a shared fingerprint prefix, so the two lines still differ", () => {
    const shared = "sha256:fee80a50d5b2";
    const imported: RetainedEntry = { fingerprint: `${shared}70aaaa`, key: "directive:d-1", summary: "same" };
    const current: RetainedEntry = { fingerprint: `${shared}57bbbb`, key: "directive:d-1", summary: "same" };
    const plan = unwrap(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({ set: { "owner-directives": [imported] } }),
        live: sides({ set: { "owner-directives": [current] } }),
      }),
    );
    expect([plan.questions[0]!.imported, plan.questions[0]!.live]).toEqual([
      "same [content fee80a50d5b27]",
      "same [content fee80a50d5b25]",
    ]);
  });

  it("reports a part the export does not hold as unavailable, never as empty", () => {
    const imported = new Map([["memories", [entry({ content: "a", key: "m-1" })]]] as const);
    const plan = unwrap(planImport({ contentDigest: "sha256:export", imported, live: sides({ set: {} }) }));
    expect(plan.parts.map((part) => [part.kind, part.status])).toEqual([
      ["memories", "compared"],
      ["memory-recalls", "unavailable"],
      ["owner-profile", "unavailable"],
      ["owner-voice", "unavailable"],
      ["owner-directives", "unavailable"],
      ["standing-asks", "unavailable"],
      ["steer-verdicts", "unavailable"],
    ]);
  });

  it("gives the same question the same id and the plan the same digest on a re-run, and moves both with the live row", () => {
    const imported = sides({ set: { memories: [entry({ content: "b", key: "m-2" })] } });
    const run = ({ live }: { live: string }) =>
      unwrap(
        planImport({
          contentDigest: "sha256:export",
          imported,
          live: sides({ set: { memories: [entry({ content: live, key: "m-2" })] } }),
        }),
      );
    const first = run({ live: "x" });
    expect(run({ live: "x" }).questions[0]!.id).toBe(first.questions[0]!.id);
    expect(run({ live: "x" }).digest).toBe(first.digest);
    expect(first.questions[0]!.id).toMatch(/^import-q-[0-9a-f]{16}$/u);
    expect(run({ live: "y" }).questions[0]!.id).not.toBe(first.questions[0]!.id);
    expect(run({ live: "y" }).digest).not.toBe(first.digest);
  });

  it("gives two exports that conflict alike over one row two different question ids", () => {
    const imported = sides({ set: { "owner-directives": [entry({ content: "b", key: "directive:d-1" })] } });
    const live = sides({ set: { "owner-directives": [entry({ content: "x", key: "directive:d-1" })] } });
    const first = unwrap(planImport({ contentDigest: "sha256:export-one", imported, live }));
    const second = unwrap(planImport({ contentDigest: "sha256:export-two", imported, live }));
    expect(first.questions[0]!.key).toBe(second.questions[0]!.key);
    expect(first.questions[0]!.id).not.toBe(second.questions[0]!.id);
  });

  it("reads each field of an entry once, so fields that change between reads plan exactly as their first read", () => {
    const reads = { fingerprint: 0, key: 0, summary: 0 };
    const next = ({ field, values }: { field: keyof typeof reads; values: readonly string[] }): string => {
      const value = values[reads[field]]!;
      reads[field] += 1;
      return value;
    };
    const shifting: RetainedEntry = {
      get fingerprint(): string {
        return next({ field: "fingerprint", values: ["sha256:b", "sha256:c", "sha256:d"] });
      },
      get key(): string {
        return next({ field: "key", values: ["m-1", "m-2", "m-3"] });
      },
      get summary(): string {
        return next({ field: "summary", values: ["imported", "second", "third"] });
      },
    };
    const fixed: RetainedEntry = { fingerprint: "sha256:b", key: "m-1", summary: "imported" };
    const live = sides({ set: { memories: [{ fingerprint: "sha256:a", key: "m-1", summary: "live" }] } });
    const plan = ({ rows }: { rows: readonly RetainedEntry[] }) =>
      planImport({ contentDigest: "sha256:export", imported: sides({ set: { memories: rows } }), live });
    expect(unwrap(plan({ rows: [shifting] }))).toEqual(unwrap(plan({ rows: [fixed] })));
    expect(reads).toEqual({ fingerprint: 1, key: 1, summary: 1 });
  });

  it("refuses a duplicate key under the key an entry first reads as", () => {
    let reads = 0;
    const shifting: RetainedEntry = {
      fingerprint: "sha256:b",
      get key(): string {
        reads += 1;
        return reads === 1 ? "m-1" : "m-other";
      },
      summary: "imported",
    };
    const fixed: RetainedEntry = { fingerprint: "sha256:a", key: "m-1", summary: "first" };
    const refused = unwrapErr(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({ set: { memories: [fixed, shifting] } }),
        live: sides({ set: {} }),
      }),
    );
    expect(refused.message).toBe("memories: the export holds two rows keyed m-1, so neither can be compared");
  });

  it("refuses a side that holds one key twice, naming the side", () => {
    const refused = unwrapErr(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({ set: {} }),
        live: sides({ set: { memories: [entry({ content: "a", key: "m-1" }), entry({ content: "b", key: "m-1" })] } }),
      }),
    );
    expect(refused.code).toBe("DUPLICATE_KEY");
    expect(refused.message).toBe("memories: the live store holds two rows keyed m-1, so neither can be compared");
  });
});

/**
 * Write one export of these contents into a fresh directory and read back its content digest.
 *
 * @param contents what the export carries
 * @returns the export's content digest
 */
function exportDigest({ contents }: { contents: StoreExportContents }): string {
  const root = mkdtempSync(join(tmpdir(), "sw-compare-golden-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  const out = join(root, "export");
  unwrap(writeStoreExport({ contents, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }));
  return contentDigest({ parts: unwrap(readExportBundle({ dir: out, unmanifested: false })).parts });
}

describe("the owner-directives part once the store is its authority", () => {
  it("exports a legacy file imported into the store with the same content digest the file exported", async () => {
    const legacy = ok({ records: importRecordsOf({ overlay: DIRECTIVES }), state: "present" as const });
    const store = ownerJudgementFake({ legacy });
    const projected = unwrap(await store.port.readActive({ home: "/acme/home" }));

    expect(projected).toEqual(DIRECTIVES);
    expect(exportDigest({ contents: { ...CONTENTS, directives: projected } })).toBe(
      exportDigest({ contents: CONTENTS }),
    );
  });
});

describe("liveRetained against an export of the same contents", () => {
  it("finds every row identical and asks nothing, so a store re-importing its own export changes nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-compare-"));
    cleanups.push(() => {
      rmSync(root, { force: true, recursive: true });
    });
    const out = join(root, "export");
    const contents = { ...CONTENTS, standingAskLines: [STANDING_ASK_LINES[0]] };
    unwrap(writeStoreExport({ contents, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }));
    const read = unwrap(readExportBundle({ dir: out, unmanifested: false }));
    const plan = unwrap(
      planImport({
        contentDigest: contentDigest({ parts: read.parts }),
        imported: read.retained,
        live: unwrap(liveRetained({ contents })),
      }),
    );
    expect(plan.questions).toEqual([]);
    expect(plan.parts.map((part) => (part.status === "compared" ? [part.new, part.conflicting] : null))).toEqual(
      ALL_PARTS.map(() => [0, 0]),
    );
    expect(plan.parts.find((part) => part.kind === "standing-asks")).toEqual({
      conflicting: 0,
      identical: 1,
      kind: "standing-asks",
      new: 0,
      role: "instruction",
      status: "compared",
    });
  });

  it("meets a memory new under its id by the live memory holding its import key, as one alignment", () => {
    const memory = JSON.parse(MEMORY_LINE) as Record<string, unknown>;
    const exported = JSON.stringify({ ...memory, importKey: "acme-import-1" });
    const holder = JSON.stringify({
      ...memory,
      claim: "acme's widget queue drains out of order",
      id: "l-0000000000000002",
      importKey: "acme-import-1",
      recordingId: "bbbbbbbb-0000-4000-8000-000000000002",
    });
    const live = unwrap(liveRetained({ contents: { ...CONTENTS, memoryLines: [holder] } }));
    const imported = unwrap(liveRetained({ contents: { ...CONTENTS, memoryLines: [exported] } }));
    const plan = unwrap(planImport({ contentDigest: "sha256:export", imported, live }));
    const memories = plan.questions.filter((question) => question.part === "memories");

    expect(plan.parts.find((part) => part.kind === "memories")).toMatchObject({ conflicting: 1, new: 0 });
    expect(memories.map((question) => [question.kind, question.key, question.actions])).toEqual([
      ["alignment", "bbbbbbbb-0000-4000-8000-000000000001", ["keep-current"]],
    ]);
    expect(memories[0]!.live).toContain("lesson: acme's widget queue drains out of order [content ");
  });

  it("refuses an export holding two memories under one import key, against an empty store", () => {
    const memory = JSON.parse(MEMORY_LINE) as Record<string, unknown>;
    const first = JSON.stringify({ ...memory, importKey: "acme-import-1" });
    const second = JSON.stringify({
      ...memory,
      importKey: "acme-import-1",
      recordingId: "bbbbbbbb-0000-4000-8000-000000000002",
      seq: 5,
    });
    const imported = unwrap(liveRetained({ contents: { ...CONTENTS, memoryLines: [first, second] } }));
    const live = unwrap(liveRetained({ contents: { ...CONTENTS, memoryLines: [] } }));

    expect(unwrapErr(planImport({ contentDigest: "sha256:export", imported, live }))).toMatchObject({
      code: "DUPLICATE_IMPORT_KEY",
      importKey: "acme-import-1",
      keys: ["bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002"],
      part: "memories",
    });
  });

  it("moves the plan digest with a memory's seq, which its fingerprint leaves out", () => {
    const renumbered = JSON.stringify({ ...(JSON.parse(MEMORY_LINE) as Record<string, unknown>), seq: 5 });
    const live = unwrap(liveRetained({ contents: { ...CONTENTS, memoryLines: [] } }));
    const plan = ({ line }: { line: string }) =>
      unwrap(
        planImport({
          contentDigest: "sha256:export",
          imported: unwrap(liveRetained({ contents: { ...CONTENTS, memoryLines: [line] } })),
          live,
        }),
      );
    const [before, after] = [plan({ line: MEMORY_LINE }), plan({ line: renumbered })];

    expect(after.questions).toEqual(before.questions);
    expect(after.digest).not.toBe(before.digest);
  });

  it("asks to activate the export's standing ask when the live store holds none", () => {
    const live = unwrap(liveRetained({ contents: { ...CONTENTS, standingAskLines: [] } }));
    const imported = unwrap(liveRetained({ contents: { ...CONTENTS, standingAskLines: [STANDING_ASK_LINES[0]] } }));
    const plan = unwrap(planImport({ contentDigest: "sha256:export", imported, live }));
    expect(plan.questions.map((question) => [question.kind, question.key])).toEqual([["activation", "org-intel"]]);
  });

  it("names the live part its own decoder refuses", () => {
    const refused = unwrapErr(liveRetained({ contents: { ...CONTENTS, voiceLines: ["{"] } }));
    expect(refused.code).toBe("SOURCE_UNREADABLE");
    expect(refused.message).toContain("the live owner-voice would not read");
  });
});

describe("planImport over steer measurements", () => {
  const RECORDED = "steer-event-aaaaaaaa-0000-4000-8000-000000000001";

  /** One measurement's entry, as a v2 envelope at a place in its part. */
  function measured({ envelope, sequence }: { envelope: SteerMeasurementEnvelopeV2; sequence: number }): RetainedEntry {
    return steerMeasurementEntry({ measurement: { envelope, sequence } });
  }

  /** A recorded measurement's envelope over a line. */
  function recorded({ exactText }: { exactText: string }): SteerMeasurementEnvelopeV2 {
    const envelope = steerMeasurementEnvelopeOfV1Line({ exactText, sourceOrdinal: 1 });
    return { ...envelope, eventId: RECORDED, sourceOrdinal: null };
  }

  const steerPart = ({ plan }: { plan: ImportPlan }): unknown =>
    plan.parts.find((part) => part.kind === "steer-verdicts");

  it("keeps the same verdict written twice as two new measurements, and asks nothing about either", () => {
    const twice = [1, 2].map((sourceOrdinal) =>
      measured({ envelope: steerMeasurementEnvelopeOfV1Line({ exactText: STEER_LINE, sourceOrdinal }), sequence: 1 }),
    );
    const plan = unwrap(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({ set: { "steer-verdicts": twice } }),
        live: sides({ set: {} }),
      }),
    );

    expect(steerPart({ plan })).toEqual({
      conflicting: 0,
      identical: 0,
      kind: "steer-verdicts",
      new: 2,
      role: "measurement",
      status: "compared",
    });
    expect(plan.questions).toEqual([]);
  });

  it("asks one alignment about an event id the live store holds over another line, both summaries shown", () => {
    const imported = measured({ envelope: recorded({ exactText: "not json" }), sequence: 4 });
    const live = measured({ envelope: recorded({ exactText: STEER_LINE }), sequence: 1 });
    const plan = unwrap(
      planImport({
        contentDigest: "sha256:export",
        imported: sides({ set: { "steer-verdicts": [imported] } }),
        live: sides({ set: { "steer-verdicts": [live] } }),
      }),
    );

    expect(plan.questions.map((question) => [question.kind, question.key, question.imported, question.live])).toEqual([
      [
        "alignment",
        RECORDED,
        `unparsed line at sequence 4 [content ${imported.fingerprint.slice(7, 19)}]`,
        `nothing slack:acme/C0FIXTURE/1760000000.000100 [content ${live.fingerprint.slice(7, 19)}]`,
      ],
    ]);
  });

  it("reads an export of the live store's own measurements as identical to it", () => {
    const live = unwrap(liveRetained({ contents: CONTENTS }));
    const plan = unwrap(planImport({ contentDigest: "sha256:export", imported: live, live }));

    expect(steerPart({ plan })).toEqual({
      conflicting: 0,
      identical: 2,
      kind: "steer-verdicts",
      new: 0,
      role: "measurement",
      status: "compared",
    });
  });
});
