/**
 * The loader's two database-free halves: projecting records a caller already holds, keeping a bounded
 * number of refusal examples, and resolving both exclusion lists from an explicit home.
 *
 * Neither reaches Postgres. The writers beside them (`ingestRecords`, `newIngestCache`) do, and are not
 * exercised here; the bronze-file pass has its own test beside its own module.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { StoreErrors } from "../../../store/errors.js";
import { INGEST_BATCH_ROWS, loadExclusionLists, projectAll } from "../../../store/ingest.js";

/** A Slack message record the projection stores, varied only where a test says so. */
const record = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "slack/c-random",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "c-random:1000000000.000001",
  text: "hello",
  tsIso: "2026-09-05T11:59:13.000Z",
  url: "https://example.slack.com/archives/c-random/p1000000000000001",
  ...over,
});

/** A record naming no container, which the projection refuses. */
const unplaced = ({ sourceId }: { sourceId: string }): CorpusRecord => record({ container: "", sourceId });

const NO_CONTAINER = "it names no container, and every row belongs to a place";

describe("projectAll", () => {
  it("projects the storable records in order and keeps the refusal it met", () => {
    const taken = projectAll({
      records: [
        record({ sourceId: "c-random:1000000000.000001" }),
        unplaced({ sourceId: "c-random:1000000000.000002" }),
        record({ sourceId: "c-random:1000000000.000003" }),
      ],
    });

    expect(taken.projected.map((row) => row.content.sourceId)).toEqual([
      "c-random:1000000000.000001",
      "c-random:1000000000.000003",
    ]);
    expect(taken.refusals).toEqual([
      StoreErrors.rowRefused({ reason: NO_CONTAINER, source: "slack", sourceId: "c-random:1000000000.000002" }),
    ]);
    expect(taken.refusals[0]!.code).toBe("ROW_REFUSED");
    expect(taken.refusals[0]!.message).toBe(`slack record c-random:1000000000.000002 is not storable: ${NO_CONTAINER}`);
  });

  it("retains the first 200 of 203 refusals and still projects every storable record after them", () => {
    const refused = Array.from({ length: 203 }, (_, at) => unplaced({ sourceId: `bad-${String(at)}` }));
    const taken = projectAll({
      records: [...refused, record({ sourceId: "c-random:1000000000.000009" })],
    });

    expect(taken.refusals.length).toBe(200);
    expect(taken.refusals.map((refusal) => refusal.sourceId)).toEqual(
      Array.from({ length: 200 }, (_, at) => `bad-${String(at)}`),
    );
    expect(taken.projected.map((row) => row.content.sourceId)).toEqual(["c-random:1000000000.000009"]);
  });

  it("projects nothing and refuses nothing from no records", () => {
    expect(projectAll({ records: [] })).toEqual({ projected: [], refusals: [] });
  });
});

describe("INGEST_BATCH_ROWS", () => {
  it("writes 500 rows per statement", () => {
    expect(INGEST_BATCH_ROWS).toBe(500);
  });
});

describe("loadExclusionLists", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ingest-lists-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads both lists from the home it is given", () => {
    writeFileSync(join(home, "sync-author-denylist.txt"), "B0ALERTS\nU0NOISE\n");
    writeFileSync(join(home, "identity-exclusion.txt"), "Ops  Rota\n");

    const lists = unwrap(loadExclusionLists({ home, lane: "ingest" }));

    expect(lists.denylist).toEqual({
      ids: new Set(["b0alerts", "u0noise"]),
      path: join(home, "sync-author-denylist.txt"),
      scoped: [],
    });
    expect(lists.identities).toEqual({ names: new Set(["ops rota"]), path: join(home, "identity-exclusion.txt") });
  });

  it("resolves two empty lists for a home holding neither file", () => {
    const lists = unwrap(loadExclusionLists({ home, lane: "write" }));

    expect(lists.denylist.ids.size).toBe(0);
    expect(lists.denylist.scoped).toEqual([]);
    expect(lists.identities.names.size).toBe(0);
    expect(lists.dataClassRules.map((rule) => rule.id)).toEqual([
      "default:owner-captured-speech",
      "default:private-lane",
    ]);
  });

  it("refuses a malformed data-class rules file as STORE_QUERY_FAILED naming the lane's rules", () => {
    mkdirSync(join(home, "judgement"));
    writeFileSync(join(home, "judgement", "data-class-rules.json"), "{ not json");

    const error = unwrapErr(loadExclusionLists({ home, lane: "ingest" }));

    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toContain("store ingest data-class rules failed: data-class rules at ");
  });

  it("refuses a malformed denylist as STORE_QUERY_FAILED naming the lane's denylist", () => {
    const path = join(home, "sync-author-denylist.txt");
    writeFileSync(path, "U0NOISE @\n");

    const error = unwrapErr(loadExclusionLists({ home, lane: "write" }));

    const reason = `${path}: "U0NOISE @" is not <id> @ <channel> — both sides must be non-empty`;
    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toBe(`store write denylist failed: ${reason}`);
    expect(error).toEqual(StoreErrors.queryFailed({ cause: reason, what: "store write denylist" }));
  });

  it("refuses an unreadable identity list as STORE_QUERY_FAILED naming the lane's identity exclusion", () => {
    mkdirSync(join(home, "identity-exclusion.txt"));

    const error = unwrapErr(loadExclusionLists({ home, lane: "ingest" }));

    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toContain("store ingest identity exclusion failed: identity exclusion list at ");
  });
});
