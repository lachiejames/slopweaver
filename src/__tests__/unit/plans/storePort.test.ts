/**
 * {@link storePlanRegisterPort}'s orchestration over hand-built seams — every branch the store-backed register
 * takes, with no database and no filesystem: the row outranking the file, the one-time import and its race,
 * the derived picture that inserts nothing, compare-and-set misses, a refused connection or query, the
 * connection closed on every path, and a repair that does not bump the revision.
 *
 * The seams are plain objects of functions (`.claude/rules/testing.md`: a seam, not a mock). What only
 * Postgres can decide — the CAS predicate, the CHECKs, the `jsonb` round trip — is the opt-in
 * `integration/planRegisterStore.test.ts`; the real file edge is `store.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type PlanRegisterError,
  PlanRegisterErrors,
  type RegisterStoreUnavailableError,
  type SeatPassesNotClearedError,
} from "../../../plans/errors.js";
import { derivePlanRegister, parsePlanRegister } from "../../../plans/register.js";
import {
  type PlanRegisterRows,
  type PlanRegisterStoreSeams,
  type StoredPlanRegister,
  storePlanRegisterPort,
} from "../../../plans/storePort.js";
import type { PlanMutation, PlanRegisterDocument, PlanRegisterSnapshot } from "../../../plans/types.js";

const HOME = "/fixture/home";
const NOW = "2026-10-31T09:00:00.000Z";

/** The register the store holds in most cases: two Codex destinations. */
const STORED: PlanRegisterDocument = {
  rows: [
    { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
    { alias: "codex-two", provider: "codex", storeDir: "/stores/codex-two" },
  ],
  version: 1,
};

/** A DIFFERENT register a legacy `plans.json` holds, so "which one won" is visible in the answer. */
const LEGACY: PlanRegisterDocument = {
  rows: [{ alias: "codex-legacy", provider: "codex", storeDir: "/stores/codex-legacy" }],
  version: 1,
};

/** A change every case that writes can apply to {@link STORED}. */
const PAUSE_TWO: PlanMutation = {
  alias: "codex-two",
  kind: "pause",
  paused: { reason: "billing lapsed", sinceIso: NOW },
  provider: "codex",
};

const OUTAGE = PlanRegisterErrors.registerStoreUnavailable({
  doing: "read the plan register",
  reason: "connection reset (a fixture outage)",
});

/** What one fake store saw: the calls in order, each projection written, and how often it was closed. */
interface Recorded {
  readonly calls: string[];
  readonly projections: { committedRevision: number; document: PlanRegisterDocument }[];
  closed: number;
  row: StoredPlanRegister | undefined;
}

/** Overrides a case gives the fake: a row operation, the legacy answer, or a refused connection. */
interface FakeOptions {
  readonly clear?: Result<undefined, SeatPassesNotClearedError>;
  readonly connect?: Result<undefined, RegisterStoreUnavailableError>;
  readonly initial?: StoredPlanRegister;
  readonly legacy?: Result<PlanRegisterSnapshot, PlanRegisterError>;
  readonly rows?: (recorded: Recorded) => Partial<PlanRegisterRows>;
}

/**
 * Seams over one in-memory row, recording every call, with a case's overrides layered on top.
 *
 * @returns the seams and the record they write into
 */
function fakeSeams({ clear = ok(undefined), connect = ok(undefined), initial, legacy, rows }: FakeOptions): {
  recorded: Recorded;
  seams: PlanRegisterStoreSeams;
} {
  const recorded: Recorded = { calls: [], closed: 0, projections: [], row: initial };
  const base: PlanRegisterRows = {
    close: () => {
      recorded.closed += 1;
      return Promise.resolve();
    },
    insert: ({ document }) => {
      recorded.calls.push("insert");
      if (recorded.row !== undefined) {
        return Promise.resolve(ok(undefined));
      }
      recorded.row = { document, revision: 1 };
      return Promise.resolve(ok(recorded.row));
    },
    read: () => {
      recorded.calls.push("read");
      return Promise.resolve(ok(recorded.row));
    },
    update: ({ document, expectedRevision }) => {
      recorded.calls.push(`update@${String(expectedRevision)}`);
      if (recorded.row?.revision !== expectedRevision) {
        return Promise.resolve(ok(undefined));
      }
      recorded.row = { document, revision: expectedRevision + 1 };
      return Promise.resolve(ok(recorded.row));
    },
  };
  const seams: PlanRegisterStoreSeams = {
    clearSeatPasses: () => {
      recorded.calls.push("clear");
      return clear;
    },
    connect: () => {
      recorded.calls.push("connect");
      if (connect.isErr()) {
        return Promise.resolve(err(connect.error));
      }
      return Promise.resolve(ok({ ...base, ...rows?.(recorded) }));
    },
    diagnose: ({ snapshot }) => snapshot,
    readImportFile: () => {
      recorded.calls.push("legacy");
      if (legacy === undefined) {
        return legacyAbsent();
      }
      return legacy;
    },
    writeProjections: ({ committedRevision, document }) => {
      recorded.projections.push({ committedRevision, document });
      return ok(undefined);
    },
  };
  return { recorded, seams };
}

/**
 * The legacy answer of a home with no `plans.json` and no Claude file: the derived ambient picture.
 *
 * @returns the derived snapshot
 */
function legacyAbsent(): Result<PlanRegisterSnapshot, PlanRegisterError> {
  return derivePlanRegister({ claudeRows: [] });
}

/**
 * A legacy `plans.json` that decoded as a registered, not-yet-stored snapshot.
 *
 * @returns the snapshot
 */
function legacyRegistered(): Result<PlanRegisterSnapshot, PlanRegisterError> {
  return parsePlanRegister({ value: LEGACY });
}

const REQUEST = { home: HOME };

/** The aliases a snapshot carries, in order. */
const aliasesOf = ({ snapshot }: { snapshot: PlanRegisterSnapshot }): readonly string[] =>
  snapshot.plans.map((plan) => plan.alias);

/** The revision a conflict pinned; `-1` on any other variant so an assertion cannot pass on the wrong one. */
const pinnedRevisionOf = ({ error }: { error: PlanRegisterError }): number =>
  error.code === "REGISTER_REVISION_CONFLICT" ? error.expectedRevision : -1;

describe("reading the store-backed register", () => {
  it("answers the stored row and never consults the legacy file once a row exists", async () => {
    const { recorded, seams } = fakeSeams({ initial: { document: STORED, revision: 4 }, legacy: legacyRegistered() });

    const snapshot = unwrap(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(aliasesOf({ snapshot })).toStrictEqual(["codex-one", "codex-two"]);
    expect(snapshot.revision).toBe(4);
    expect(snapshot.source).toBe("registered");
    expect(recorded.calls).toStrictEqual(["connect", "read"]);
  });

  it("imports a valid legacy plans.json ONCE at revision 1, and reads the row thereafter", async () => {
    const { recorded, seams } = fakeSeams({ legacy: legacyRegistered() });
    const port = storePlanRegisterPort({ seams });

    const first = unwrap(await port.read(REQUEST));
    const second = unwrap(await port.read(REQUEST));

    expect(aliasesOf({ snapshot: first })).toStrictEqual(["codex-legacy"]);
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(1);
    expect(recorded.calls).toStrictEqual(["connect", "read", "legacy", "insert", "connect", "read"]);
  });

  it("answers the derived picture with no revision, and inserts NOTHING, when there is no plans.json", async () => {
    const { recorded, seams } = fakeSeams({});

    const snapshot = unwrap(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(snapshot.source).toBe("derived");
    expect(snapshot.revision).toBe(null);
    expect(recorded.row).toBe(undefined);
    expect(recorded.calls).toStrictEqual(["connect", "read", "legacy"]);
  });

  it("refuses a present plans.json that will not decode, rather than deriving around it", async () => {
    const invalid = err(PlanRegisterErrors.registerInvalid({ problems: ["the plan register is not JSON"] }));
    const { recorded, seams } = fakeSeams({ legacy: invalid });

    const error = unwrapErr(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(error.code).toBe("REGISTER_INVALID");
    expect(recorded.calls).toStrictEqual(["connect", "read", "legacy"]);
  });

  it("lets a concurrent importer's row win when this import's insert loses the race", async () => {
    const { recorded, seams } = fakeSeams({
      legacy: legacyRegistered(),
      rows: (state) => ({
        insert: () => {
          state.calls.push("insert-lost");
          state.row = { document: STORED, revision: 1 };
          return Promise.resolve(ok(undefined));
        },
      }),
    });

    const snapshot = unwrap(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(aliasesOf({ snapshot })).toStrictEqual(["codex-one", "codex-two"]);
    expect(recorded.calls).toStrictEqual(["connect", "read", "legacy", "insert-lost", "read"]);
  });

  it("decodes a stored row rather than trusting it, refusing one that is not a register", async () => {
    const { seams } = fakeSeams({ initial: { document: { rows: "not a list", version: 1 }, revision: 2 } });

    const error = unwrapErr(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(error.code).toBe("REGISTER_INVALID");
  });

  it("refuses a connection the store will not open, without consulting the file", async () => {
    const { recorded, seams } = fakeSeams({ connect: err(OUTAGE), legacy: legacyRegistered() });

    const error = unwrapErr(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(recorded.calls).toStrictEqual(["connect"]);
    expect(recorded.closed).toBe(0);
  });

  it("refuses a failed query and still closes the connection", async () => {
    const { recorded, seams } = fakeSeams({
      legacy: legacyRegistered(),
      rows: () => ({ read: () => Promise.resolve(err(OUTAGE)) }),
    });

    const error = unwrapErr(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(recorded.calls).toStrictEqual(["connect"]);
    expect(recorded.closed).toBe(1);
  });

  it("closes the connection exactly once after a successful read", async () => {
    const { recorded, seams } = fakeSeams({ initial: { document: STORED, revision: 1 } });

    unwrap(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(recorded.closed).toBe(1);
  });

  it("refuses as REGISTER_STORE_UNAVAILABLE when a row operation rejects, and still closes the connection", async () => {
    const { recorded, seams } = fakeSeams({
      rows: () => ({ read: () => Promise.reject(new Error("socket torn down mid-query")) }),
    });

    const error = unwrapErr(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not finish the operation");
    expect(error.message).toContain("socket torn down mid-query");
    expect(recorded.closed).toBe(1);
  });

  it("refuses as REGISTER_STORE_UNAVAILABLE when opening the connection rejects", async () => {
    const { seams } = fakeSeams({});
    const rejecting: PlanRegisterStoreSeams = { ...seams, connect: () => Promise.reject(new Error("socket refused")) };

    const error = unwrapErr(await storePlanRegisterPort({ seams: rejecting }).read(REQUEST));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not be opened");
    expect(error.message).toContain("socket refused");
  });

  it("refuses as REGISTER_STORE_UNAVAILABLE when closing the connection rejects after a read", async () => {
    const { seams } = fakeSeams({
      initial: { document: STORED, revision: 1 },
      rows: () => ({ close: () => Promise.reject(new Error("socket hung on close")) }),
    });

    const error = unwrapErr(await storePlanRegisterPort({ seams }).read(REQUEST));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not close its connection");
    expect(error.message).toContain("socket hung on close");
  });
});

describe("writing the store-backed register", () => {
  it("compare-and-sets against the revision it read, and projects the COMMITTED row", async () => {
    const { recorded, seams } = fakeSeams({ initial: { document: STORED, revision: 2 } });

    const published = unwrap(
      await storePlanRegisterPort({ seams }).write({ ...REQUEST, mutation: PAUSE_TWO, nowIso: NOW }),
    );

    expect(published.revision).toBe(3);
    expect(recorded.calls).toStrictEqual(["connect", "read", "clear", "update@2"]);
    expect(recorded.projections.map((projection) => projection.committedRevision)).toStrictEqual([3]);
    expect(recorded.projections[0]!.document).toStrictEqual(recorded.row!.document);
    expect(recorded.closed).toBe(1);
  });

  it("refuses the change, committing nothing, when the seats' cached passes cannot be cleared first", async () => {
    const { recorded, seams } = fakeSeams({
      clear: err(PlanRegisterErrors.seatPassesNotCleared({ cause: "EACCES", path: "/h/live/seat-pass" })),
      initial: { document: STORED, revision: 2 },
    });

    const error = unwrapErr(
      await storePlanRegisterPort({ seams }).write({ ...REQUEST, mutation: PAUSE_TWO, nowIso: NOW }),
    );

    expect(error.code).toBe("SEAT_PASSES_NOT_CLEARED");
    expect(recorded.calls).toStrictEqual(["connect", "read", "clear"]);
    expect(recorded.row!.revision).toBe(2);
    expect(recorded.projections).toStrictEqual([]);
  });

  it("refuses a write judged at an older revision than it reads, before clearing or committing anything", async () => {
    const { recorded, seams } = fakeSeams({ initial: { document: STORED, revision: 2 } });

    const error = unwrapErr(
      await storePlanRegisterPort({ seams }).write({
        ...REQUEST,
        judgedAtRevision: 1,
        mutation: PAUSE_TWO,
        nowIso: NOW,
      }),
    );

    expect(error.code).toBe("REGISTER_REVISION_CONFLICT");
    expect(pinnedRevisionOf({ error })).toBe(1);
    expect(recorded.calls).toStrictEqual(["connect", "read"]);
    expect(recorded.row!.revision).toBe(2);
    expect(recorded.projections).toStrictEqual([]);
  });

  it("commits a write judged at the very revision it reads", async () => {
    const { recorded, seams } = fakeSeams({ initial: { document: STORED, revision: 2 } });

    const published = unwrap(
      await storePlanRegisterPort({ seams }).write({
        ...REQUEST,
        judgedAtRevision: 2,
        mutation: PAUSE_TWO,
        nowIso: NOW,
      }),
    );

    expect(published.revision).toBe(3);
    expect(recorded.calls).toStrictEqual(["connect", "read", "clear", "update@2"]);
  });

  it("refuses a CAS miss as REGISTER_REVISION_CONFLICT, writes no projection, and does not retry", async () => {
    const { recorded, seams } = fakeSeams({
      initial: { document: STORED, revision: 2 },
      rows: (state) => ({
        update: ({ expectedRevision }) => {
          state.calls.push(`update@${String(expectedRevision)}-missed`);
          return Promise.resolve(ok(undefined));
        },
      }),
    });

    const error = unwrapErr(
      await storePlanRegisterPort({ seams }).write({ ...REQUEST, mutation: PAUSE_TWO, nowIso: NOW }),
    );

    expect(error.code).toBe("REGISTER_REVISION_CONFLICT");
    expect(pinnedRevisionOf({ error })).toBe(2);
    expect(recorded.calls).toStrictEqual(["connect", "read", "clear", "update@2-missed"]);
    expect(recorded.projections).toStrictEqual([]);
  });

  it("adopts by inserting, and refuses an adoption whose insert another writer beat, pinned to no row", async () => {
    const { recorded, seams } = fakeSeams({
      rows: (state) => ({
        insert: () => {
          state.calls.push("insert-lost");
          return Promise.resolve(ok(undefined));
        },
      }),
    });

    const error = unwrapErr(
      await storePlanRegisterPort({ seams }).write({ ...REQUEST, mutation: { kind: "adopt" }, nowIso: NOW }),
    );

    expect(error.code).toBe("REGISTER_REVISION_CONFLICT");
    expect(pinnedRevisionOf({ error })).toBe(0);
    expect(recorded.projections).toStrictEqual([]);
  });

  it("adopts the derived picture into a fresh row at revision 1", async () => {
    const { recorded, seams } = fakeSeams({});

    const published = unwrap(
      await storePlanRegisterPort({ seams }).write({ ...REQUEST, mutation: { kind: "adopt" }, nowIso: NOW }),
    );

    expect(published.revision).toBe(1);
    expect(published.source).toBe("registered");
    expect(recorded.calls).toStrictEqual(["connect", "read", "legacy", "clear", "insert"]);
    expect(recorded.projections.map((projection) => projection.committedRevision)).toStrictEqual([1]);
  });

  it("repairs the projections from the row as it stands, with no update and no new revision", async () => {
    const { recorded, seams } = fakeSeams({ initial: { document: STORED, revision: 3 } });

    const repaired = unwrap(
      await storePlanRegisterPort({ seams }).write({
        ...REQUEST,
        mutation: { kind: "repair-projection" },
        nowIso: NOW,
      }),
    );

    expect(repaired.revision).toBe(3);
    expect(recorded.calls).toStrictEqual(["connect", "read"]);
    expect(recorded.projections).toStrictEqual([{ committedRevision: 3, document: STORED }]);
  });

  it("refuses a write while the store is unreachable, and changes nothing", async () => {
    const { recorded, seams } = fakeSeams({ connect: err(OUTAGE), initial: { document: STORED, revision: 2 } });

    const error = unwrapErr(
      await storePlanRegisterPort({ seams }).write({ ...REQUEST, mutation: PAUSE_TWO, nowIso: NOW }),
    );

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(recorded.row!.revision).toBe(2);
    expect(recorded.projections).toStrictEqual([]);
  });
});
