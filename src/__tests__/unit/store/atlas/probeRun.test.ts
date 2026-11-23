import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { type AtlasProbeExecute, runAtlasProbe } from "../../../../store/atlas/probeRun.js";

/**
 * A store that answers three statements in the order one keyword asks them.
 *
 * A plain function passed in, never a mock: `testing.md` names this the seam to reach for, and
 * `AtlasProbeExecute` exists so this file can supply one without casting a drizzle database into being.
 */
function fakeStore({
  total,
  cells,
  names,
}: {
  total: number;
  cells: readonly Record<string, unknown>[];
  names: readonly Record<string, unknown>[];
}): AtlasProbeExecute {
  const answers: Record<string, unknown>[][] = [[{ rows: total }], [...cells], [...names]];
  let asked = -1;
  return async () => {
    asked += 1;
    const answer = answers[asked];
    if (answer === undefined) {
      return [];
    }
    return answer;
  };
}

/** One cell row as the driver hands it back — every count a string, the way postgres returns a bigint. */
function cellRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    byDetail: "0",
    byName: "6",
    entities: "6",
    kind: "user",
    lastAttemptOutcome: "ok",
    lastSuccessAt: "2026-09-20T01:02:03.000Z",
    platform: "jumpcloud",
    ...over,
  };
}

/**
 * The holdings shape the SCOPE statement returns, counts as strings the way postgres returns a bigint.
 *
 * Every field is a named parameter rather than a spread over a `Partial`, unlike {@link cellRow} beside
 * it: `atlas-manifest-clock` reads an object that spreads its own parameter and rewrites `kinds` as a
 * module stamping a manifest clock of its own, and a driver-row fixture is not that. Naming the fields is
 * cheaper than arguing with the gate, and it is what a reader wants from four of them anyway.
 */
function holdingRow({
  entities = "523521",
  kindCount = "9",
  lastSuccessAt = "2026-09-20T01:02:03.000Z",
  platform = "jumpcloud",
}: {
  entities?: string;
  kindCount?: string;
  lastSuccessAt?: string | null;
  platform?: string;
} = {}): Record<string, unknown> {
  return { entities, kinds: kindCount, lastSuccessAt, platform };
}

describe("runAtlasProbe with NO keyword — the SCOPE read", () => {
  it("reads what each platform holds and asks for no keyword cells at all", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({
          cells: [holdingRow(), holdingRow({ entities: "17", kindCount: "2", platform: "braze" })],
          names: [],
          total: 695_759,
        }),
        plan: { cells: 40, platform: null, terms: [] },
      }),
    );
    expect(report.rows).toEqual([]);
    expect(report.holdings.length).toBe(2);
    expect(report.holdings[0]!.platform).toBe("jumpcloud");
    expect(report.holdings[0]!.entities).toBe(523_521);
    expect(report.holdings[0]!.kinds).toBe(9);
    expect(report.holdings[0]!.lastSuccessAtIso).toBe("2026-09-20T01:02:03.000Z");
    expect(report.holdings[1]!.platform).toBe("braze");
  });

  it("carries a never-synced platform as nothing rather than inventing an instant", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [holdingRow({ lastSuccessAt: null })], names: [], total: 1 }),
        plan: { cells: 40, platform: null, terms: [] },
      }),
    );
    expect(report.holdings[0]!.lastSuccessAtIso).toBe(null);
  });

  // The r1 counterexample: `--platform vanta` narrowed the header and nothing else, so the scope read
  // printed one atlas's name above every platform in the estate.
  it("threads --platform into the grouped statement, so the body matches the header it will be printed under", async () => {
    const dialect = new PgDialect();
    const asked: unknown[][] = [];
    const capture: AtlasProbeExecute = async (statement) => {
      asked.push([...dialect.sqlToQuery(statement).params]);
      return [];
    };
    await runAtlasProbe({ execute: capture, plan: { cells: 40, platform: "vanta", terms: [] } });
    expect(asked.length).toBe(2);
    expect(asked[0]).toEqual([]);
    expect(asked[1]).toEqual(["vanta", "vanta"]);
  });

  it("still reports the estate total, so an empty store is legible rather than ambiguous", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [], names: [], total: 0 }),
        plan: { cells: 40, platform: null, terms: [] },
      }),
    );
    expect(report.atlasEntities).toBe(0);
    expect(report.holdings).toEqual([]);
  });
});

describe("runAtlasProbe", () => {
  it("leaves holdings EMPTY on a keyword probe, so the keyword path never pays for the grouped count", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [cellRow()], names: [], total: 695_759 }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    expect(report.holdings).toEqual([]);
  });

  it("counts the estate once and each keyword's cells beside it", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [cellRow()], names: [], total: 695_759 }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    expect(report.atlasEntities).toBe(695_759);
    expect(report.rows.length).toBe(1);
    expect(report.rows[0]!.subject).toBe("airtable");
    expect(report.rows[0]!.cells[0]!.entities).toBe(6);
    expect(report.rows[0]!.cells[0]!.platform).toBe("jumpcloud");
  });

  it("reports the platform it was narrowed to, and null for the whole estate", async () => {
    const wide = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [], names: [], total: 4 }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    const narrow = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [], names: [], total: 4 }),
        plan: { cells: 40, platform: "vanta", terms: ["airtable"] },
      }),
    );
    expect(wide.platform).toBe(null);
    expect(narrow.platform).toBe("vanta");
  });

  it("answers zero entities rather than throwing when the total statement returns no row", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: async () => [],
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    expect(report.atlasEntities).toBe(0);
    expect(report.rows[0]!.cells).toEqual([]);
  });

  it("carries a platform-name match separately from the cells it counted", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [], names: [{ platform: "airtable" }], total: 12 }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    expect(report.rows[0]!.platformNames).toEqual(["airtable"]);
  });

  it("reads an instant the driver hands back as a STRING", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [cellRow()], names: [], total: 12 }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    expect(report.rows[0]!.cells[0]!.lastSuccessAtIso).toBe("2026-09-20T01:02:03.000Z");
  });

  it("reads the same instant when the driver hands back a Date, so staleness never silently reads null", async () => {
    const report = unwrap(
      await runAtlasProbe({
        execute: fakeStore({
          cells: [cellRow({ lastSuccessAt: new Date("2026-09-20T01:02:03.000Z") })],
          names: [],
          total: 12,
        }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    expect(report.rows[0]!.cells[0]!.lastSuccessAtIso).toBe("2026-09-20T01:02:03.000Z");
  });

  it("answers null for a kind that has never synced, and for an unparseable instant", async () => {
    const never = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [cellRow({ lastSuccessAt: null })], names: [], total: 12 }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    const junk = unwrap(
      await runAtlasProbe({
        execute: fakeStore({ cells: [cellRow({ lastSuccessAt: "not a time" })], names: [], total: 12 }),
        plan: { cells: 40, platform: null, terms: ["airtable"] },
      }),
    );
    expect(never.rows[0]!.cells[0]!.lastSuccessAtIso).toBe(null);
    expect(junk.rows[0]!.cells[0]!.lastSuccessAtIso).toBe(null);
  });

  it("wraps a driver throw in the store's own typed error rather than letting it escape", async () => {
    const failed = await runAtlasProbe({
      execute: async () => {
        throw new Error('relation "atlas_entity" does not exist');
      },
      plan: { cells: 40, platform: null, terms: ["airtable"] },
    });
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().code).toBe("STORE_QUERY_FAILED");
    expect(failed._unsafeUnwrapErr().message).toContain("atlas probe");
  });

  it("probes every keyword it was given, in the order it was given them", async () => {
    const asked: string[] = [];
    const report = unwrap(
      await runAtlasProbe({
        execute: async (statement) => {
          asked.push(statement.queryChunks.length > 0 ? "asked" : "empty");
          return [];
        },
        plan: { cells: 40, platform: null, terms: ["airtable", "sync"] },
      }),
    );
    expect(report.rows.map((row) => row.subject)).toEqual(["airtable", "sync"]);
    // One total statement, then two per keyword.
    expect(asked.length).toBe(5);
  });
});
