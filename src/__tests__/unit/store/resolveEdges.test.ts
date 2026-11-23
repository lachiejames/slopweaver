/**
 * The edge pass over a scripted statement runner: what it reads, what it writes back, how the resolution
 * loop stops, and which phase a failure is named for.
 *
 * Every statement is rendered by drizzle's own pure `PgDialect` and classified by its text, so a test reads
 * the exact sequence of statements the pass sent and the exact values it bound — with no Postgres.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { StoreErrors } from "../../../store/errors.js";
import { type ResolveEdgesExecute, resolveEdgesVia } from "../../../store/resolveEdges.js";

const dialect = new PgDialect();

/** Which of the pass's four statements one rendered query is. */
type Phase = "read" | "write" | "resolve" | "count";

/** One statement as the runner saw it: its phase and the values it bound. */
interface SentStatement {
  readonly phase: Phase;
  readonly params: readonly unknown[];
}

/**
 * The phase a rendered statement belongs to, read off its own text.
 *
 * @returns the phase
 */
function phaseOf({ text }: { text: string }): Phase {
  if (text.includes("update content set parent_source_id")) {
    return "write";
  }
  if (text.includes("with candidate as")) {
    return "resolve";
  }
  if (text.includes("count(*) filter")) {
    return "count";
  }
  return "read";
}

/**
 * A runner answering each phase from its own queue, in order, and recording every statement it was sent.
 *
 * @returns the runner
 */
function scriptedRunner({
  sent,
  pages,
  resolutions,
  counts,
  failOn,
}: {
  sent: SentStatement[];
  pages: Record<string, unknown>[][];
  resolutions: Record<string, unknown>[][];
  counts: Record<string, unknown>[];
  failOn?: Phase;
}): ResolveEdgesExecute {
  const runStatement: ResolveEdgesExecute = async ({ statement }) => {
    const query = dialect.sqlToQuery(statement);
    const phase = phaseOf({ text: query.sql });
    sent.push({ params: [...query.params], phase });
    if (phase === failOn) {
      throw new Error("connection reset by peer");
    }
    if (phase === "read") {
      return pages.shift()!;
    }
    if (phase === "resolve") {
      return resolutions.shift()!;
    }
    return phase === "count" ? counts : [];
  };
  return runStatement;
}

/** One stored row as the backfill read selects it. */
const row = ({
  id,
  source,
  sourceId,
  parentComment = null,
  stored = null,
}: {
  id: string;
  source: string;
  sourceId: string;
  parentComment?: string | null;
  stored?: string | null;
}): Record<string, unknown> => ({ id, parentComment, source, sourceId, stored });

/**
 * A page holding a Slack reply with no key, a nested Linear comment whose stored key is the bare issue, a
 * Slack reply whose key is already right, and a GitHub pull request no rule gives a parent.
 */
const MIXED_PAGE = [
  row({ id: "00000000-0000-0000-0000-000000000001", source: "slack", sourceId: "C1:1.1:reply:1.2" }),
  row({
    id: "00000000-0000-0000-0000-000000000002",
    parentComment: "c1",
    source: "linear",
    sourceId: "ENG-1:comment:c2",
    stored: "ENG-1",
  }),
  row({ id: "00000000-0000-0000-0000-000000000003", source: "slack", sourceId: "C1:1.1:reply:1.3", stored: "C1:1.1" }),
  row({ id: "00000000-0000-0000-0000-000000000004", source: "github", sourceId: "acme/widgets#7" }),
];

describe("resolveEdgesVia", () => {
  it("writes only the keys that changed, resolves until a batch resolves 0, then counts", async () => {
    const sent: SentStatement[] = [];
    const runStatement = scriptedRunner({
      counts: [{ dangling: 4, edges: 9 }],
      pages: [MIXED_PAGE, []],
      resolutions: [[{ n: 2 }], [{ n: 1 }], [{ n: 0 }]],
      sent,
    });

    const report = unwrap(await resolveEdgesVia({ batch: 4, runStatement }));

    expect(report).toEqual({ dangling: 4, edgesResolved: 3, keysWritten: 2, rowsScanned: 4, totalEdges: 9 });
    expect(sent).toEqual([
      { params: [4], phase: "read" },
      {
        params: [
          "00000000-0000-0000-0000-000000000001",
          "C1:1.1",
          "00000000-0000-0000-0000-000000000002",
          "ENG-1:comment:c1",
        ],
        phase: "write",
      },
      { params: ["00000000-0000-0000-0000-000000000004", 4], phase: "read" },
      { params: [4], phase: "resolve" },
      { params: [4], phase: "resolve" },
      { params: [4], phase: "resolve" },
      { params: [], phase: "count" },
    ]);
  });

  it("sends no write for a page whose every derived key is already stored or absent", async () => {
    const sent: SentStatement[] = [];
    const settled = [MIXED_PAGE[2]!, MIXED_PAGE[3]!];
    const runStatement = scriptedRunner({
      counts: [{ dangling: 0, edges: 1 }],
      pages: [settled, []],
      resolutions: [[{ n: 0 }]],
      sent,
    });

    const report = unwrap(await resolveEdgesVia({ batch: 2, runStatement }));

    expect(report).toEqual({ dangling: 0, edgesResolved: 0, keysWritten: 0, rowsScanned: 2, totalEdges: 1 });
    expect(sent.map((statement) => statement.phase)).toEqual(["read", "read", "resolve", "count"]);
  });

  it("with keysOnly sends no resolution statement and still counts", async () => {
    const sent: SentStatement[] = [];
    const runStatement = scriptedRunner({
      counts: [{ dangling: 5, edges: 6 }],
      pages: [MIXED_PAGE, []],
      resolutions: [[{ n: 9 }]],
      sent,
    });

    const report = unwrap(await resolveEdgesVia({ batch: 4, keysOnly: true, runStatement }));

    expect(report).toEqual({ dangling: 5, edgesResolved: 0, keysWritten: 2, rowsScanned: 4, totalEdges: 6 });
    expect(sent.map((statement) => statement.phase)).toEqual(["read", "write", "read", "count"]);
  });

  it("binds the default batch of 1000 when the caller names none", async () => {
    const sent: SentStatement[] = [];
    const runStatement = scriptedRunner({
      counts: [{ dangling: 0, edges: 0 }],
      pages: [[]],
      resolutions: [[{ n: 0 }]],
      sent,
    });

    unwrap(await resolveEdgesVia({ runStatement }));

    expect(sent).toEqual([
      { params: [1000], phase: "read" },
      { params: [1000], phase: "resolve" },
      { params: [], phase: "count" },
    ]);
  });

  it("reads a resolution or count value that is not a number as zero, ending the loop there", async () => {
    const sent: SentStatement[] = [];
    const runStatement = scriptedRunner({
      counts: [{ dangling: "3", edges: "8" }],
      pages: [[]],
      resolutions: [[{ n: "2" }], [{ n: 1 }]],
      sent,
    });

    const report = unwrap(await resolveEdgesVia({ batch: 1, runStatement }));

    expect(report).toEqual({ dangling: 0, edgesResolved: 0, keysWritten: 0, rowsScanned: 0, totalEdges: 0 });
    expect(sent.map((statement) => statement.phase)).toEqual(["read", "resolve", "count"]);
  });

  it.each([
    { phase: "read", what: "store edges (backfill keys)" },
    { phase: "write", what: "store edges (backfill keys)" },
    { phase: "resolve", what: "store edges (resolve)" },
    { phase: "count", what: "store edges (count)" },
  ] as const)("a $phase statement that throws is STORE_QUERY_FAILED naming $what", async ({ phase, what }) => {
    const sent: SentStatement[] = [];
    const runStatement = scriptedRunner({
      counts: [{ dangling: 0, edges: 0 }],
      failOn: phase,
      pages: [MIXED_PAGE, []],
      resolutions: [[{ n: 0 }]],
      sent,
    });

    const error = unwrapErr(await resolveEdgesVia({ batch: 4, runStatement }));

    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toBe(`${what} failed: connection reset by peer`);
    expect(error).toEqual(StoreErrors.queryFailed({ cause: new Error("connection reset by peer"), what }));
    expect(sent.at(-1)!.phase).toBe(phase);
  });

  it("stops at the failed statement, sending nothing after it", async () => {
    const sent: SentStatement[] = [];
    const runStatement = scriptedRunner({
      counts: [{ dangling: 0, edges: 0 }],
      failOn: "resolve",
      pages: [[]],
      resolutions: [[{ n: 0 }]],
      sent,
    });

    expect(unwrapErr(await resolveEdgesVia({ batch: 4, runStatement })).code).toBe("STORE_QUERY_FAILED");
    expect(sent.map((statement) => statement.phase)).toEqual(["read", "resolve"]);
  });
});
