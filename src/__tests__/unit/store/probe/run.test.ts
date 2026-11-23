/**
 * Running a probe and a breakdown over a scripted statement runner and a scripted clock.
 *
 * The runner answers each statement in the order it is sent and records the statement rendered by drizzle's
 * own pure `PgDialect`; the expected statements are built by the same `./sql` builders the run calls, so a
 * test compares the exact statements sent, in order, with the exact values bound — and no Postgres.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { StoreErrors } from "../../../../store/errors.js";
import {
  GROUP_FACETS,
  type GroupFacet,
  type ProbeExecute,
  type ProbePlan,
  runGroupsVia,
  runProbeVia,
} from "../../../../store/probe/run.js";
import {
  exactCountsStatement,
  ladderCountsStatement,
  regexCountsStatement,
  shapeIdsStatement,
} from "../../../../store/probe/sql.js";

const dialect = new PgDialect();

/** One rendered statement: the text and the bound values. */
interface Rendered {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Render a statement as the driver would receive it.
 *
 * @returns its text and bound values
 */
function rendered({ statement }: { statement: SQL }): Rendered {
  const query = dialect.sqlToQuery(statement);
  return { params: [...query.params], sql: query.sql };
}

/**
 * A runner answering the n-th statement with the n-th answer, recording each, and throwing where told.
 *
 * @returns the runner
 */
function scriptedRunner({
  sent,
  answers,
  throwAt,
}: {
  sent: Rendered[];
  answers: readonly (readonly Record<string, unknown>[])[];
  throwAt?: number;
}): ProbeExecute {
  const runStatement: ProbeExecute = async ({ statement }) => {
    const index = sent.length;
    sent.push(rendered({ statement }));
    if (index === throwAt) {
      throw new Error("canceling statement due to user request");
    }
    return answers[index]!;
  };
  return runStatement;
}

/**
 * A clock answering each read with the next scripted instant, recording how many reads it served.
 *
 * @returns the clock and the reads it has served
 */
function scriptedClock({ instants }: { instants: readonly number[] }): { nowMs: () => number; reads: number[] } {
  const reads: number[] = [];
  return {
    nowMs: () => {
      const at = instants[reads.length]!;
      reads.push(at);
      return at;
    },
    reads,
  };
}

const TERM_PLAN: ProbePlan = {
  enumerateAtOrBelow: 5,
  ids: 3,
  includeBots: false,
  source: undefined,
  subjects: [{ kind: "term", term: "kube" }],
};

/** Per-source ladder counts: `wild-right` lands exactly on the cap of 5 and `wild-both` one above it. */
const LADDER_ROWS = [
  { alnum: "0", bots: "7", slash: "0", source: "slack", "wild-both": "4", "wild-left": "0", "wild-right": "4" },
  { alnum: "0", bots: "3", slash: "0", source: "linear", "wild-both": "2", "wild-left": "0", "wild-right": "1" },
];

describe("runProbeVia over a keyword", () => {
  it("counts, enumerates only the cells at or below the cap, and times the subject and the probe", async () => {
    const sent: Rendered[] = [];
    const runStatement = scriptedRunner({
      answers: [
        [
          { rows: "1", source: "github" },
          { rows: "2", source: "slack" },
        ],
        LADDER_ROWS,
        [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
        [{ id: "r1" }, { id: "r2" }],
      ],
      sent,
    });
    const clock = scriptedClock({ instants: [1000, 1010, 1045, 1100] });

    const report = unwrap(await runProbeVia({ nowMs: clock.nowMs, plan: TERM_PLAN, runStatement }));

    expect(report).toEqual({
      elapsedMs: 100,
      enumerateAtOrBelow: 5,
      includeBots: false,
      rows: [
        {
          botsHidden: 10,
          cells: [
            {
              bySource: [
                { rows: 2, source: "slack" },
                { rows: 1, source: "github" },
              ],
              ids: ["e1", "e2", "e3"],
              indexed: true,
              rows: 3,
              shape: "exact",
            },
            { bySource: [], ids: [], indexed: true, rows: 0, shape: "wild-left" },
            { bySource: [], ids: [], indexed: true, rows: 0, shape: "slash" },
            { bySource: [], ids: [], indexed: true, rows: 0, shape: "alnum" },
            {
              bySource: [
                { rows: 4, source: "slack" },
                { rows: 1, source: "linear" },
              ],
              ids: ["r1", "r2"],
              indexed: true,
              rows: 5,
              shape: "wild-right",
            },
            {
              bySource: [
                { rows: 4, source: "slack" },
                { rows: 2, source: "linear" },
              ],
              ids: null,
              indexed: true,
              rows: 6,
              shape: "wild-both",
            },
          ],
          elapsedMs: 35,
          kind: "term",
          subject: "kube",
        },
      ],
      source: null,
    });
    expect(clock.reads).toEqual([1000, 1010, 1045, 1100]);
  });

  it("sends the two counts, then one id read per enumerated cell and none for an empty or over-cap cell", async () => {
    const sent: Rendered[] = [];
    const runStatement = scriptedRunner({
      answers: [[{ rows: "3", source: "slack" }], LADDER_ROWS, [{ id: "e1" }], [{ id: "r1" }]],
      sent,
    });
    const clock = scriptedClock({ instants: [0, 0, 0, 0] });

    unwrap(await runProbeVia({ nowMs: clock.nowMs, plan: TERM_PLAN, runStatement }));

    const ids = ({ shape }: { shape: "exact" | "wild-right" }): Rendered =>
      rendered({
        statement: shapeIdsStatement({ includeBots: false, limit: 3, shape, source: undefined, term: "kube" }),
      });
    expect(sent).toEqual([
      rendered({ statement: exactCountsStatement({ includeBots: false, source: undefined, term: "kube" }) }),
      rendered({ statement: ladderCountsStatement({ includeBots: false, source: undefined, term: "kube" }) }),
      ids({ shape: "exact" }),
      ids({ shape: "wild-right" }),
    ]);
  });

  it("reads the clock once at each end of every subject, so two subjects take six reads", async () => {
    const sent: Rendered[] = [];
    const empty: Record<string, unknown>[] = [];
    const runStatement = scriptedRunner({ answers: [empty, empty, empty, empty], sent });
    const clock = scriptedClock({ instants: [0, 10, 13, 20, 27, 40] });
    const plan: ProbePlan = {
      ...TERM_PLAN,
      subjects: [
        { kind: "term", term: "kube" },
        { kind: "term", term: "helm" },
      ],
    };

    const report = unwrap(await runProbeVia({ nowMs: clock.nowMs, plan, runStatement }));

    expect(report.rows.map((row) => row.elapsedMs)).toEqual([3, 7]);
    expect(report.elapsedMs).toBe(40);
    expect(clock.reads.length).toBe(6);
  });
});

describe("runProbeVia over a regex", () => {
  it("counts the pattern as one cell, hides no bots when bots are included, and keeps the source", async () => {
    const sent: Rendered[] = [];
    const runStatement = scriptedRunner({
      answers: [[{ bots: "2", rows: "2", source: "slack" }], [{ id: "x1" }]],
      sent,
    });
    const clock = scriptedClock({ instants: [5, 6, 9, 12] });
    const plan: ProbePlan = {
      enumerateAtOrBelow: 2,
      ids: 10,
      includeBots: true,
      source: "slack",
      subjects: [{ kind: "regex", pattern: "ku+be" }],
    };

    const report = unwrap(await runProbeVia({ nowMs: clock.nowMs, plan, runStatement }));

    expect(report).toEqual({
      elapsedMs: 7,
      enumerateAtOrBelow: 2,
      includeBots: true,
      rows: [
        {
          botsHidden: 0,
          cells: [{ bySource: [{ rows: 2, source: "slack" }], ids: ["x1"], indexed: false, rows: 2, shape: "regex" }],
          elapsedMs: 3,
          kind: "regex",
          subject: "ku+be",
        },
      ],
      source: "slack",
    });
    expect(sent).toEqual([
      rendered({ statement: regexCountsStatement({ includeBots: true, pattern: "ku+be", source: "slack" }) }),
      rendered({
        statement: shapeIdsStatement({ includeBots: true, limit: 10, shape: "regex", source: "slack", term: "ku+be" }),
      }),
    ]);
  });
});

describe("runProbeVia failures", () => {
  it("turns a thrown statement into STORE_QUERY_FAILED naming store probe, sending nothing after it", async () => {
    const sent: Rendered[] = [];
    const runStatement = scriptedRunner({ answers: [[{ rows: "1", source: "slack" }]], sent, throwAt: 1 });
    const clock = scriptedClock({ instants: [0, 0] });

    const error = unwrapErr(await runProbeVia({ nowMs: clock.nowMs, plan: TERM_PLAN, runStatement }));

    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toBe("store probe failed: canceling statement due to user request");
    expect(error).toEqual(
      StoreErrors.queryFailed({ cause: new Error("canceling statement due to user request"), what: "store probe" }),
    );
    expect(sent.length).toBe(2);
  });
});

/** The grouping expression each facet renders, as Postgres receives it. */
const FACET_EXPRESSIONS: Readonly<Record<GroupFacet, string>> = {
  author: "coalesce(person.display_name, content.author_native_id, '(no author)')",
  container: "coalesce(container.native_id, '(no container)')",
  kind: "content.kind::text",
  source: "content.source::text",
};

describe("runGroupsVia", () => {
  it("offers exactly the four facets source, kind, container and author, in that order", () => {
    expect(GROUP_FACETS).toEqual(["source", "kind", "container", "author"]);
  });

  it.each(GROUP_FACETS.map((facet) => ({ facet })))("groups by $facet's own expression", async ({ facet }) => {
    const sent: Rendered[] = [];
    const runStatement = scriptedRunner({ answers: [[]], sent });

    unwrap(await runGroupsVia({ facet, includeBots: false, limit: 7, runStatement, shape: "wild-both", term: "kube" }));

    expect(sent.length).toBe(1);
    expect(sent[0]!.sql).toContain(`select ${FACET_EXPRESSIONS[facet]} as value`);
    expect(sent[0]!.params).toEqual(["%kube%", "%kube%", 7]);
  });

  it("returns every group in the order given, with counts parsed and a null value rendered (none)", async () => {
    const runStatement = scriptedRunner({
      answers: [
        [
          { rows: "90", value: "slack/c-alerts" },
          { rows: "3", value: null },
        ],
      ],
      sent: [],
    });

    const groups = unwrap(
      await runGroupsVia({
        facet: "container",
        includeBots: true,
        limit: 2,
        runStatement,
        shape: "exact",
        term: "kube",
      }),
    );

    expect(groups).toEqual([
      { rows: 90, value: "slack/c-alerts" },
      { rows: 3, value: "(none)" },
    ]);
  });

  it("turns a thrown statement into STORE_QUERY_FAILED naming store groups", async () => {
    const runStatement = scriptedRunner({ answers: [], sent: [], throwAt: 0 });

    const error = unwrapErr(
      await runGroupsVia({ facet: "kind", includeBots: false, limit: 1, runStatement, shape: "exact", term: "kube" }),
    );

    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toBe("store groups failed: canceling statement due to user request");
    expect(error).toEqual(
      StoreErrors.queryFailed({ cause: new Error("canceling statement due to user request"), what: "store groups" }),
    );
  });
});
