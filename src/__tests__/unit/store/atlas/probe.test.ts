import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  ATLAS_CELL_LIMIT,
  type AtlasProbeCell,
  type AtlasProbeRow,
  atlasCellLine,
  atlasCellsStatement,
  atlasHoldingLine,
  atlasHoldingsStatement,
  atlasPlatformNamesStatement,
  atlasTotalStatement,
  foldPlatforms,
  widestCell,
} from "../../../../store/atlas/probe.js";

/** One cell, overridden per case. */
function cell(over: Partial<AtlasProbeCell> = {}): AtlasProbeCell {
  return {
    byDetail: 0,
    byName: 4,
    entities: 4,
    kind: "user",
    lastAttemptOutcome: "ok",
    lastSuccessAtIso: "2026-09-20T01:02:03.000Z",
    platform: "jumpcloud",
    ...over,
  };
}

/** One row, overridden per case. */
function row(over: Partial<AtlasProbeRow> = {}): AtlasProbeRow {
  return { cells: [], elapsedMs: 12, platformNames: [], subject: "airtable", ...over };
}

/**
 * Render a statement the way the driver would.
 *
 * `PgDialect` is drizzle's own pure renderer — it holds no connection and reaches nothing — so this is a
 * unit test of the SQL rather than an integration test that happens not to connect. Same shape as
 * `../probeSql.test.ts`, deliberately: these two files test the two probes that answer one question.
 */
const dialect = new PgDialect();
const render = ({
  statement,
}: {
  statement: ReturnType<typeof atlasTotalStatement>;
}): { sql: string; params: unknown[] } => {
  const query = dialect.sqlToQuery(statement);
  return { params: [...query.params], sql: query.sql.replaceAll(/\s+/gu, " ").trim() };
};

describe("atlasCellsStatement", () => {
  it("counts the union of the two rungs rather than their sum", () => {
    const { sql } = render({ statement: atlasCellsStatement({ limit: 5, platform: null, term: "sync" }) });
    expect(sql).toContain("count(distinct merged.entity_id)::bigint as entities");
  });

  it("reads BOTH rungs — the entity's own handle and the channel's detail payload", () => {
    const { sql } = render({ statement: atlasCellsStatement({ limit: 5, platform: null, term: "sync" }) });
    expect(sql).toContain("from atlas_entity where (provider_id ilike $1 or kind ilike $2)");
    expect(sql).toContain("from atlas_entity_channel where detail::text ilike $3");
  });

  it("never asks the entity predicate about the PLATFORM name — that is the 19,038-row phantom cell", () => {
    const { sql } = render({ statement: atlasCellsStatement({ limit: 5, platform: null, term: "password" }) });
    expect(sql).not.toContain("or platform ilike");
  });

  it("renders no platform predicate at all when the whole estate is probed", () => {
    const { sql, params } = render({ statement: atlasCellsStatement({ limit: 5, platform: null, term: "sync" }) });
    expect(sql).not.toContain("and platform =");
    expect(params).toEqual(["%sync%", "%sync%", "%sync%", 5]);
  });

  it("restricts BOTH rungs when the caller names a platform, and binds it as a parameter", () => {
    const { sql, params } = render({
      statement: atlasCellsStatement({ limit: 5, platform: "jumpcloud", term: "sync" }),
    });
    expect(sql.split("and platform = $").length - 1).toBe(2);
    expect(sql).not.toContain("jumpcloud");
    expect(params).toEqual(["%sync%", "%sync%", "jumpcloud", "%sync%", "jumpcloud", 5]);
  });

  it("escapes a keyword's own LIKE metacharacters rather than letting them widen the probe", () => {
    const { params } = render({ statement: atlasCellsStatement({ limit: 5, platform: null, term: "100%_off" }) });
    expect(params[0]).toBe("%100\\%\\_off%");
  });

  it("caps the cells at what the caller asked for, as a bound parameter", () => {
    const { sql, params } = render({ statement: atlasCellsStatement({ limit: 7, platform: null, term: "sync" }) });
    expect(sql).toContain("limit $4");
    expect(params[3]).toBe(7);
  });
});

describe("atlasPlatformNamesStatement", () => {
  it("matches containment in BOTH directions, so `password` reaches `onepassword` and back", () => {
    const { sql, params } = render({ statement: atlasPlatformNamesStatement({ term: "password" }) });
    expect(sql).toContain("where platform ilike $1 or $2 ilike '%' || platform || '%'");
    expect(params).toEqual(["%password%", "password"]);
  });
});

describe("atlasTotalStatement", () => {
  it("counts atlas_entity, which is what tells a zero apart from a never-imported store", () => {
    const { sql, params } = render({ statement: atlasTotalStatement() });
    expect(sql).toBe("select count(*)::bigint as rows from atlas_entity");
    expect(params).toEqual([]);
  });
});

describe("widestCell", () => {
  it("answers nothing for a keyword no atlas row carried", () => {
    expect(widestCell({ row: row() })).toBe(null);
  });

  it("takes the first cell, because the statement already ordered them widest-first", () => {
    const wide = cell({ entities: 900, kind: "application" });
    const narrow = cell({ entities: 2, kind: "group" });
    expect(widestCell({ row: row({ cells: [wide, narrow] }) })!.kind).toBe("application");
  });
});

describe("foldPlatforms — one entry per PLATFORM, never one per cell", () => {
  it("answers nothing for a row with no cells", () => {
    expect(foldPlatforms({ row: row() })).toEqual([]);
  });

  it("sums a platform's entities and counts its kinds, keeping its widest cell", () => {
    const folded = foldPlatforms({
      row: row({
        cells: [
          cell({ entities: 90, kind: "application", platform: "jumpcloud" }),
          cell({ entities: 7, kind: "group", platform: "jumpcloud" }),
        ],
      }),
    });
    expect(folded.length).toBe(1);
    expect(folded[0]!.platform).toBe("jumpcloud");
    expect(folded[0]!.entities).toBe(97);
    expect(folded[0]!.kinds).toBe(2);
    expect(folded[0]!.widest.kind).toBe("application");
  });

  it("orders platforms by their own total, densest first", () => {
    const folded = foldPlatforms({
      row: row({
        cells: [
          cell({ entities: 500, platform: "jumpcloud" }),
          cell({ entities: 9, platform: "github" }),
          cell({ entities: 40, platform: "vanta" }),
        ],
      }),
    });
    expect(folded.map((each) => each.platform)).toEqual(["jumpcloud", "vanta", "github"]);
  });

  it("breaks a tie on the platform name, so two runs of one probe order identically", () => {
    const folded = foldPlatforms({
      row: row({ cells: [cell({ entities: 3, platform: "vanta" }), cell({ entities: 3, platform: "github" })] }),
    });
    expect(folded.map((each) => each.platform)).toEqual(["github", "vanta"]);
  });
});

describe("atlasCellLine", () => {
  it("prints the split, so a reader can tell a handle match from a detail-payload one", () => {
    const line = atlasCellLine({ cell: cell({ byDetail: 11, byName: 3, entities: 13 }) });
    expect(line).toContain("jumpcloud/user");
    expect(line).toContain("name 3 · detail 11");
    expect(line).toContain("synced 2026-09-20T01:02:03.000Z");
  });

  it("says NEVER SYNCED rather than printing nothing, because silence reads as fresh", () => {
    expect(atlasCellLine({ cell: cell({ lastSuccessAtIso: null }) })).toContain("never synced");
  });

  it("names a failed latest attempt beside the successful sync it is older than", () => {
    const line = atlasCellLine({ cell: cell({ lastAttemptOutcome: "auth-failed" }) });
    expect(line).toContain("[last attempt auth-failed]");
  });

  it("stays quiet about an attempt that succeeded", () => {
    expect(atlasCellLine({ cell: cell({ lastAttemptOutcome: "ok" }) })).not.toContain("last attempt");
  });
});

describe("ATLAS_CELL_LIMIT", () => {
  it("is one number, big enough that a 35-platform estate is not truncated at a handful", () => {
    expect(ATLAS_CELL_LIMIT).toBe(40);
  });
});

describe("atlasHoldingsStatement — the keyword-less SCOPE statement", () => {
  it("groups both tables SEPARATELY, because joining before grouping multiplies the entity count", () => {
    const { sql, params } = render({ statement: atlasHoldingsStatement({ platform: null }) });
    expect(params).toEqual([]);
    expect(sql).toContain("from atlas_entity");
    expect(sql).toContain("group by platform");
    expect(sql).toContain("max(last_success_at) as last_success_at");
    expect(sql).toContain("left join synced on synced.platform = held.platform");
  });

  it("counts distinct kinds rather than status rows, and orders widest first", () => {
    const { sql } = render({ statement: atlasHoldingsStatement({ platform: null }) });
    expect(sql).toContain("count(distinct kind)::bigint as kinds");
    expect(sql).toContain("order by held.entities desc, held.platform");
  });

  // The r1 counterexample: this statement took no argument at all, so `atlas probe --platform vanta`
  // printed a header naming one atlas above one line for every platform in the estate.
  it("narrows BOTH grouped tables when a platform is named, so the body matches the header", () => {
    const { sql, params } = render({ statement: atlasHoldingsStatement({ platform: "vanta" }) });
    expect(params).toEqual(["vanta", "vanta"]);
    expect(sql.split("and platform = $").length - 1).toBe(2);
    expect(sql).not.toContain("vanta");
  });
});

describe("atlasHoldingLine", () => {
  it("prints the platform, its rows, its kinds and when it last synced", () => {
    const line = atlasHoldingLine({
      holding: { entities: 523_521, kinds: 9, lastSuccessAtIso: "2026-09-20T01:02:03.000Z", platform: "jumpcloud" },
    });
    expect(line).toContain("jumpcloud");
    expect(line).toContain("523521 row(s) in");
    expect(line).toContain("9 kind(s)");
    expect(line).toContain("synced 2026-09-20T01:02:03.000Z");
  });

  it("says never synced rather than leaving the instant blank", () => {
    const line = atlasHoldingLine({
      holding: { entities: 0, kinds: 0, lastSuccessAtIso: null, platform: "canva" },
    });
    expect(line).toContain("never synced");
  });
});
