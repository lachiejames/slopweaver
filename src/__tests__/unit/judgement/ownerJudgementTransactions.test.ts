/**
 * What one owner-judgement transaction decides, apart from its SQL: the order a snapshot reads in, how a memory
 * event plans then applies, and which failure a throw becomes. The statements themselves are proven by the
 * opt-in `integration/ownerJudgementStore.test.ts`; here each is a plain function recording that it ran.
 */
import { describe, expect, it } from "vitest";

import { OwnerDirectiveErrors } from "../../../judgement/ownerDirective.errors.js";
import type { OwnerJudgementTransition, StoredOwnerJudgement } from "../../../judgement/ownerJudgementRecords.js";
import {
  guardedRead,
  guardedWrite,
  isActiveVersionRace,
  planThenApply,
  snapshotOver,
} from "../../../judgement/ownerJudgementTransactions.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const STORED: StoredOwnerJudgement = {
  corrections: [],
  directives: [
    {
      directiveId: "acme-response-policy",
      origin: "legacy-file",
      rowId: "row-1",
      sourceContentHash: `sha256:${"a".repeat(64)}`,
      sourceFile: "acme-response-policy.md",
      sourceModified: null,
      state: "active",
      text: "answer acme tickets from the runbook first",
    },
  ],
};

const TRANSITION: OwnerJudgementTransition = {
  activateCorrections: [],
  activateDirectives: [],
  retireCorrections: [],
  retireDirectives: ["acme-response-policy"],
};

describe("snapshotOver", () => {
  it("reads the active rows before the marker, and answers the rows when the marker's count matches", async () => {
    const calls: string[] = [];

    const read = await snapshotOver({
      readActive: async () => {
        calls.push("active");
        return STORED;
      },
      readMarker: async () => {
        calls.push("marker");
        return { observedRows: 1, records: 1, tableHasRows: true };
      },
    });

    expect(unwrap(read)).toEqual(STORED);
    expect(calls).toEqual(["active", "marker"]);
  });

  it("refuses a snapshot whose marker is gone, rather than answering its rows", async () => {
    const read = await snapshotOver({ readActive: async () => STORED, readMarker: async () => undefined });

    expect(unwrapErr(read).message).toBe(
      "the store could not read the owner-judgement import marker inside the reading snapshot for owner directives: the marker the import wrote is gone",
    );
  });

  it("refuses a snapshot whose counted rows fell below the marker, naming both counts", async () => {
    const read = await snapshotOver({
      readActive: async () => STORED,
      readMarker: async () => ({ observedRows: 1, records: 2, tableHasRows: true }),
    });

    expect(unwrapErr(read).code).toBe("OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT");
    expect(unwrapErr(read).message).toContain("records 2 imported instruction(s)");
  });
});

describe("planThenApply", () => {
  it("applies the planned transition once and answers the plan's outcome", async () => {
    const applied: OwnerJudgementTransition[] = [];

    const outcome = await planThenApply({
      apply: async ({ transition }) => {
        applied.push(transition);
      },
      plan: ({ stored }) =>
        ok({ answer: { directiveCount: stored.directives.length - 1, kind: "written" }, transition: TRANSITION }),
      read: async () => ok(STORED),
    });

    expect(unwrap(outcome)).toEqual({ directiveCount: 0, kind: "written" });
    expect(applied).toEqual([TRANSITION]);
  });

  it("applies nothing when the snapshot read refuses, and never plans", async () => {
    const applied: OwnerJudgementTransition[] = [];
    let planned = 0;

    const outcome = await planThenApply({
      apply: async ({ transition }) => {
        applied.push(transition);
      },
      plan: () => {
        planned += 1;
        return ok({ answer: { directiveCount: 0, kind: "written" }, transition: TRANSITION });
      },
      read: async () => err(OwnerDirectiveErrors.storeUnavailable({ doing: "read", reason: "acme-db is down" })),
    });

    expect(unwrapErr(outcome).message).toBe("the store could not read for owner directives: acme-db is down");
    expect(planned).toBe(0);
    expect(applied).toEqual([]);
  });

  it("applies nothing when the plan refuses", async () => {
    const applied: OwnerJudgementTransition[] = [];

    const outcome = await planThenApply({
      apply: async ({ transition }) => {
        applied.push(transition);
      },
      plan: () => err(OwnerDirectiveErrors.writeConflict({ reason: "planned against a moved row" })),
      read: async () => ok(STORED),
    });

    expect(unwrapErr(outcome).code).toBe("OWNER_DIRECTIVE_WRITE_CONFLICT");
    expect(applied).toEqual([]);
  });
});

describe("guardedRead", () => {
  it("passes a transaction's own answer through", async () => {
    expect(unwrap(await guardedRead({ run: async () => ok(STORED) }))).toEqual(STORED);
  });

  it("reads a thrown Error as an outage carrying its message", async () => {
    const read = await guardedRead({
      run: async () => {
        throw new Error("connection reset by acme-db");
      },
    });

    expect(unwrapErr(read).message).toBe(
      "the store could not read the active owner directives for owner directives: connection reset by acme-db",
    );
  });

  it("reads a thrown non-Error as an outage of unknown cause", async () => {
    const read = await guardedRead({
      run: async () => {
        throw "acme";
      },
    });

    expect(unwrapErr(read).message).toBe(
      "the store could not read the active owner directives for owner directives: unknown failure",
    );
  });
});

describe("guardedWrite", () => {
  it("passes a transaction's own answer through", async () => {
    const outcome = await guardedWrite({ run: async () => ok({ directiveCount: 1, kind: "written" }) });

    expect(unwrap(outcome)).toEqual({ directiveCount: 1, kind: "written" });
  });

  it("reads a serialization failure as a racing writer, so nothing was written", async () => {
    const outcome = await guardedWrite({
      run: async () => {
        throw Object.assign(new Error("Failed query"), { cause: { code: "40001" } });
      },
    });

    expect(unwrapErr(outcome).message).toBe(
      "another writer changed the same owner directive first, so nothing was written; run the memory write again: Failed query",
    );
  });

  it("reads a unique violation on an active-version index as a racing writer", async () => {
    const outcome = await guardedWrite({
      run: async () => {
        throw Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint_name: "uq_owner_correction_active",
        });
      },
    });

    expect(unwrapErr(outcome).code).toBe("OWNER_DIRECTIVE_WRITE_CONFLICT");
  });

  it("reads any other throw as an outage of the write", async () => {
    const outcome = await guardedWrite({
      run: async () => {
        throw new Error("connection reset by acme-db");
      },
    });

    expect(unwrapErr(outcome).message).toBe(
      "the store could not record a memory's owner directives for owner directives: connection reset by acme-db",
    );
  });
});

describe("isActiveVersionRace", () => {
  it("recognises a unique violation on the directive active-version index, wrapped as drizzle wraps it", () => {
    const driver = { code: "23505", constraint_name: "uq_owner_directive_active" };

    expect(isActiveVersionRace({ cause: { cause: driver, message: "Failed query" } })).toBe(true);
  });

  it("recognises the correction active-version index too", () => {
    expect(isActiveVersionRace({ cause: { code: "23505", constraint_name: "uq_owner_correction_active" } })).toBe(true);
  });

  it("does not read a unique violation on another constraint as a race", () => {
    expect(
      isActiveVersionRace({ cause: { code: "23505", constraint_name: "uq_owner_directive_import_question" } }),
    ).toBe(false);
  });

  it("does not read another error class on the same index as a race", () => {
    expect(isActiveVersionRace({ cause: { code: "23514", constraint_name: "uq_owner_directive_active" } })).toBe(false);
  });

  it("reads a snapshot's serialization failure as a race, however deep the driver wrapped it", () => {
    expect(isActiveVersionRace({ cause: { cause: { code: "40001" }, message: "Failed query" } })).toBe(true);
  });

  it("stops walking after four links, so a race buried deeper is not read as one", () => {
    const buried = { cause: { cause: { cause: { cause: { code: "40001" } } } } };

    expect(isActiveVersionRace({ cause: buried })).toBe(false);
  });

  it("does not read a plain Error as a race", () => {
    expect(isActiveVersionRace({ cause: new Error("connection reset") })).toBe(false);
  });
});
