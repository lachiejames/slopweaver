/**
 * The plan register's file edge — the legacy read the one-time import consults, the two projections every
 * commit regenerates, and the divergence a hand edit leaves — driven over a real throwaway home through the
 * real store-backed port, with an in-memory row standing in for `plan_register`
 * (`src/__tests__/planRegisterFixture.ts`).
 *
 * Every case here writes under an explicit `home` built with `mkdtempSync` and removed in `afterEach`, never
 * the ambient `$SLOPWEAVER_HOME` (`.claude/rules/testing.md`). A genuine filesystem round-trip is what these
 * properties ARE — that only `ENOENT` reads as absent, and that a projection can fail after a commit — so a
 * fake filesystem would test the fake.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { PlanRegisterError } from "../../../plans/errors.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import {
  clearSeatPassesBeforeCommit,
  readPlanRegisterFile,
  writePlanRegisterProjections,
} from "../../../plans/store.js";
import type { PlanMutation, PlanRegisterDocument } from "../../../plans/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type MemoryPlanRegisterStore,
  memoryPlanRegisterPort,
  memoryPlanRegisterStore,
} from "../../planRegisterFixture.js";

const NOW = "2026-09-22T11:00:00Z";

/** The usage limit a newly added row carries: the whole of its weekly window. */
const WHOLE_WEEK = { allowance: { kind: "weekly-window" }, usageLimitPercent: 100 } as const;

/**
 * Claude rows in the shape the legacy accounts file has always carried, the first one pinned.
 */
const LEGACY_ROWS: readonly Readonly<Record<string, unknown>>[] = [
  { alias: "plan-one", pinned: true, storeDir: "/store/plan-one" },
  { alias: "plan-two", pinned: null, storeDir: "/store/plan-two" },
  { alias: "plan-three", pinned: null, storeDir: "/store/plan-three" },
];

/** The same rows as the projection regenerates them: no `provider` key, order and every field preserved. */
const PROJECTED_ROWS: readonly Readonly<Record<string, unknown>>[] = LEGACY_ROWS;

/**
 * The problem list off a REGISTER_INVALID error, so no assertion carries a conditional. The caller asserts
 * the code first; this narrows outside the `expect`.
 */
const invalidProblems = ({ error }: { error: PlanRegisterError }): readonly string[] =>
  error.code === "REGISTER_INVALID" ? error.problems : ["NOT INVALID — this error carries no problem list"];

/**
 * The committed revision a partial-publication failure names. `-1` on any other variant, so a test asserting a
 * real revision cannot pass by reaching the wrong branch.
 */
const committedRevisionOf = ({ error }: { error: PlanRegisterError }): number =>
  error.code === "PROJECTION_WRITE_FAILED" ? error.committedRevision : -1;

/** The projection paths a partial-publication failure names; empty on any other variant. */
const failedPathsOf = ({ error }: { error: PlanRegisterError }): readonly string[] =>
  error.code === "PROJECTION_WRITE_FAILED" ? error.paths : [];

describe("the plan register's file edge, through the store-backed port", () => {
  let home = "";
  let store: MemoryPlanRegisterStore = memoryPlanRegisterStore();
  let port: PlanRegisterPort = memoryPlanRegisterPort({ store });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "plans-store-"));
    store = memoryPlanRegisterStore();
    port = memoryPlanRegisterPort({ store });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Put a legacy Claude accounts file in place, as an unadopted install has. */
  const seedLegacy = ({ rows }: { rows: readonly Readonly<Record<string, unknown>>[] }): void => {
    const path = stateHomePaths({ home }).claudeAccountsJson;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(rows), "utf8");
  };

  /** What the generated Claude projection file currently holds. */
  const projectionOnDisk = (): unknown => JSON.parse(readFileSync(stateHomePaths({ home }).claudeAccountsJson, "utf8"));

  /** What the generated `plans.json` projection currently holds. */
  const plansJsonOnDisk = (): unknown => JSON.parse(readFileSync(stateHomePaths({ home }).plansJson, "utf8"));

  const read = () => port.read({ home });
  const write = ({ mutation }: { mutation: PlanMutation }) => port.write({ home, mutation, nowIso: NOW });

  it("derives the picture an install that has adopted nothing already has, with no revision and no row", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    const snapshot = unwrap(await read());
    expect(snapshot.source).toBe("derived");
    expect(snapshot.revision).toBe(null);
    expect(store.rows.size).toBe(0);
    expect(snapshot.plans.map((plan) => `${plan.provider}:${plan.alias}`)).toStrictEqual([
      "claude:plan-one",
      "claude:plan-two",
      "claude:plan-three",
    ]);
    expect(snapshot.diagnostics.map((note) => note.code)).toStrictEqual(["DERIVED_REGISTER"]);
  });

  it("reads a home with neither file as an EMPTY register — a Codex login on the machine is never a plan", async () => {
    const snapshot = unwrap(await read());
    expect(snapshot.source).toBe("derived");
    expect(snapshot.plans).toStrictEqual([]);
  });

  it("reports a leftover ambient codex-quota.json as a cap attributed to no destination", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    const quota = stateHomePaths({ home }).codexQuotaJson;

    const clean = unwrap(await read());
    writeFileSync(quota, JSON.stringify({ kind: "credits-out", observedAtIso: "2026-09-14T05:00:00.000Z" }), "utf8");
    const withLeftover = unwrap(await read());

    // Both halves: the note fires only because the file is there, so its absence above is what makes the
    // presence below evidence rather than a constant.
    expect(clean.diagnostics.map((note) => note.code)).toStrictEqual(["DERIVED_REGISTER"]);
    expect(withLeftover.diagnostics.map((note) => note.code)).toStrictEqual([
      "DERIVED_REGISTER",
      "UNKEYED_QUOTA_UNATTRIBUTED",
    ]);
    expect(withLeftover.diagnostics[1]!.message).toContain(quota);
  });

  it("refuses a register that is present and unreadable, rather than reading it as absent", async () => {
    // A DIRECTORY at the register's path: `readFileSync` raises EISDIR, not ENOENT, so a reader that only
    // asked "did it throw" would seat a session on whatever credential happens to be ambient.
    mkdirSync(stateHomePaths({ home }).plansJson, { recursive: true });
    const error = unwrapErr(await read());
    expect(error.code).toBe("REGISTER_UNREADABLE");
    expect(error.message).toContain("plans.json");
  });

  it("refuses an unreadable LEGACY file the same way, instead of deriving an emptier fleet", async () => {
    mkdirSync(stateHomePaths({ home }).claudeAccountsJson, { recursive: true });
    const error = unwrapErr(await read());
    expect(error.code).toBe("REGISTER_UNREADABLE");
    expect(error.message).toContain("accounts.json");
  });

  it("refuses to import a present register that is not JSON, even beside perfectly valid legacy data", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    writeFileSync(stateHomePaths({ home }).plansJson, "{ not json", "utf8");
    const error = unwrapErr(await read());
    expect(error.code).toBe("REGISTER_INVALID");
    expect(invalidProblems({ error })[0]).toContain("the plan register is not JSON");
    expect(store.rows.size).toBe(0);
  });

  it("refuses to import a register whose rows break a structural rule, legacy data notwithstanding", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    writeFileSync(
      stateHomePaths({ home }).plansJson,
      JSON.stringify({
        rows: [
          { alias: "plan-one", pinned: true, provider: "claude", storeDir: "/store/plan-one" },
          { alias: "plan-two", pinned: true, provider: "claude", storeDir: "/store/plan-two" },
        ],
        version: 1,
      }),
      "utf8",
    );
    const error = unwrapErr(await read());
    expect(error.code).toBe("REGISTER_INVALID");
    expect(invalidProblems({ error }).join(" ")).toContain("claude");
  });

  it("refuses every change but adopt while nothing has been adopted", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    const error = unwrapErr(await write({ mutation: { alias: "plan-one", kind: "resume", provider: "claude" } }));
    expect(error.code).toBe("MUTATION_CONFLICT");
    expect(error.message).toContain("slopweaver plans adopt");
    expect(store.rows.size).toBe(0);
  });

  it("adopts the derived picture into the store at revision 1, then reads it back as the registered source", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    const published = unwrap(await write({ mutation: { kind: "adopt" } }));
    expect(published.source).toBe("registered");
    expect(published.revision).toBe(1);
    const reread = unwrap(await read());
    expect(reread.source).toBe("registered");
    expect(reread.revision).toBe(1);
    expect(reread.diagnostics).toStrictEqual([]);
    // Adopt writes down exactly the signed-in plans: no Codex row joins them, whatever `$CODEX_HOME` holds.
    expect(reread.plans.map((plan) => `${plan.provider}:${plan.alias}`)).toStrictEqual([
      "claude:plan-one",
      "claude:plan-two",
      "claude:plan-three",
    ]);
  });

  it("writes plans.json as the whole committed document, a projection of the row", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    expect(plansJsonOnDisk()).toStrictEqual(store.rows.get(home)!.document);
  });

  it("regenerates the Claude projection with the provider discriminator stripped, so an older parser still reads it", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    expect(projectionOnDisk()).toStrictEqual(PROJECTED_ROWS);
  });

  it("reports a hand-edited Claude projection as divergence and keeps the store row authoritative", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    writeFileSync(stateHomePaths({ home }).claudeAccountsJson, JSON.stringify([LEGACY_ROWS[0]]), "utf8");
    const reread = unwrap(await read());
    expect(reread.diagnostics.map((note) => note.code)).toStrictEqual(["PROJECTION_DIVERGED"]);
    expect(reread.plans.map((plan) => plan.alias)).toStrictEqual(["plan-one", "plan-two", "plan-three"]);
  });

  it("reports a hand-edited plans.json as divergence, and never reads it once a row exists", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    writeFileSync(stateHomePaths({ home }).plansJson, JSON.stringify({ rows: [], version: 1 }), "utf8");
    const reread = unwrap(await read());
    expect(reread.diagnostics.map((note) => note.code)).toStrictEqual(["PROJECTION_DIVERGED"]);
    expect(reread.diagnostics[0]!.message).toContain("plans.json");
    expect(reread.plans.map((plan) => plan.alias)).toStrictEqual(["plan-one", "plan-two", "plan-three"]);
  });

  it("repairs a diverged projection back to what the row implies, without a new revision", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    writeFileSync(stateHomePaths({ home }).claudeAccountsJson, JSON.stringify([]), "utf8");
    const repaired = unwrap(await write({ mutation: { kind: "repair-projection" } }));
    expect(repaired.diagnostics).toStrictEqual([]);
    expect(repaired.revision).toBe(1);
    expect(store.rows.get(home)!.revision).toBe(1);
    expect(projectionOnDisk()).toStrictEqual(PROJECTED_ROWS);
  });

  it("carries a field no version here declares through a pause, rather than dropping it", async () => {
    seedLegacy({
      rows: [
        { alias: "plan-one", futureField: "keep me", pinned: true, storeDir: "/store/plan-one" },
        ...LEGACY_ROWS.slice(1),
      ],
    });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    const paused = unwrap(
      await write({
        mutation: {
          alias: "plan-three",
          kind: "pause",
          paused: { reason: "quota spent until the window rolls", sinceIso: NOW },
          provider: "claude",
        },
      }),
    );
    expect(paused.revision).toBe(2);
    expect(projectionOnDisk()).toStrictEqual([
      { alias: "plan-one", futureField: "keep me", pinned: true, storeDir: "/store/plan-one" },
      { alias: "plan-two", pinned: null, storeDir: "/store/plan-two" },
      {
        alias: "plan-three",
        paused: { reason: "quota spent until the window rolls", sinceIso: NOW },
        pinned: null,
        storeDir: "/store/plan-three",
      },
    ]);
  });

  it("reports a failed projection after the commit as one, naming the committed revision", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    // A DIRECTORY where the projection file belongs: the row commits and the file cannot be replaced.
    const accounts = stateHomePaths({ home }).claudeAccountsJson;
    rmSync(accounts, { force: true });
    mkdirSync(accounts, { recursive: true });
    const error = unwrapErr(
      await write({
        mutation: {
          alias: "plan-two",
          kind: "pause",
          paused: { reason: "the account's billing lapsed", sinceIso: NOW },
          provider: "claude",
        },
      }),
    );
    expect(error.code).toBe("PROJECTION_WRITE_FAILED");
    expect(committedRevisionOf({ error })).toBe(2);
    expect(failedPathsOf({ error })).toStrictEqual([accounts]);
    expect(store.rows.get(home)!.revision).toBe(2);
    expect(error.message).toContain("plans validate --repair-projection");
  });

  it("lets a fresh install add its first Claude plan, then its second, one change at a time", async () => {
    unwrap(await write({ mutation: { kind: "adopt" } }));
    const first = unwrap(
      await write({
        mutation: {
          kind: "add",
          row: { alias: "plan-one", provider: "claude", storeDir: "/store/plan-one", ...WHOLE_WEEK },
        },
      }),
    );
    expect(first.plans.map((plan) => `${plan.provider}:${plan.alias}`)).toStrictEqual(["claude:plan-one"]);
    // The projection carries the limit keys an older parser ignores, so an older seat still reads the file.
    expect(projectionOnDisk()).toStrictEqual([{ alias: "plan-one", storeDir: "/store/plan-one", ...WHOLE_WEEK }]);
    const second = unwrap(
      await write({
        mutation: {
          kind: "add",
          row: { alias: "plan-two", provider: "claude", storeDir: "/store/plan-two", ...WHOLE_WEEK },
        },
      }),
    );
    expect(second.plans.map((plan) => plan.alias)).toStrictEqual(["plan-one", "plan-two"]);
    expect(second.revision).toBe(3);
  });

  it("publishes a pause that leaves one of two registered Claude plans live — one plan is a whole fleet", async () => {
    seedLegacy({ rows: LEGACY_ROWS.slice(1) });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    const paused = { reason: "the subscription lapsed", sinceIso: NOW };
    const published = unwrap(
      await write({ mutation: { alias: "plan-two", kind: "pause", paused, provider: "claude" } }),
    );
    expect(published.revision).toBe(2);
    expect(store.rows.get(home)!.revision).toBe(2);
    expect(projectionOnDisk()).toStrictEqual([
      { alias: "plan-two", paused, pinned: null, storeDir: "/store/plan-two" },
      { alias: "plan-three", pinned: null, storeDir: "/store/plan-three" },
    ]);
  });

  it("refuses a change naming a plan the register does not carry", async () => {
    seedLegacy({ rows: LEGACY_ROWS });
    unwrap(await write({ mutation: { kind: "adopt" } }));
    const error = unwrapErr(await write({ mutation: { alias: "plan-nine", kind: "pin", provider: "claude" } }));
    expect(error.code).toBe("UNKNOWN_DESTINATION");
    expect(error.message).toContain("plan-nine");
  });
});

describe("the legacy read and the projection writer, called directly", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "plans-edge-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a present plans.json as a registered snapshot not yet stored, so its revision is null", () => {
    const path = stateHomePaths({ home }).plansJson;
    writeFileSync(
      path,
      JSON.stringify({ rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }], version: 1 }),
      "utf8",
    );
    const snapshot = unwrap(readPlanRegisterFile({ home }));
    expect(snapshot.source).toBe("registered");
    expect(snapshot.revision).toBe(null);
    expect(snapshot.plans.map((plan) => plan.alias)).toStrictEqual(["codex-one"]);
  });

  it("collects EVERY projection that failed, not only the first", () => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.plansJson, { recursive: true });
    mkdirSync(paths.claudeAccountsJson, { recursive: true });
    const document: PlanRegisterDocument = {
      rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }],
      version: 1,
    };
    const error = unwrapErr(writePlanRegisterProjections({ committedRevision: 7, document, home }));
    expect(error.code).toBe("PROJECTION_WRITE_FAILED");
    expect(error.paths).toStrictEqual([paths.plansJson, paths.claudeAccountsJson]);
    expect(error.committedRevision).toBe(7);
  });

  it("clears every cached seat pass even when the projections then fail, so no seat keeps a pass the row revoked", () => {
    const paths = stateHomePaths({ home });
    const marker = join(paths.live.seatPassDir, "71e77a67-7fb6-4cd8-8b77-df5a0b3cf615");
    mkdirSync(paths.live.seatPassDir, { recursive: true });
    writeFileSync(marker, "91903\tTue Oct  6 04:17:25 2026\t-\n");
    mkdirSync(paths.claudeAccountsJson, { recursive: true });
    const document: PlanRegisterDocument = {
      rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }],
      version: 1,
    };
    const error = unwrapErr(writePlanRegisterProjections({ committedRevision: 8, document, home }));
    expect(error.paths).toStrictEqual([paths.claudeAccountsJson]);
    expect(existsSync(paths.live.seatPassDir)).toBe(false);
  });

  it("clears every cached seat pass before a change commits", () => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.live.seatPassDir, { recursive: true });
    writeFileSync(join(paths.live.seatPassDir, "71e77a67-7fb6-4cd8-8b77-df5a0b3cf615"), "91903\tstart\t-\n");
    unwrap(clearSeatPassesBeforeCommit({ home }));
    expect(existsSync(paths.live.seatPassDir)).toBe(false);
  });

  it("refuses, naming the directory, when the passes cannot be cleared, so the change is not committed", () => {
    const paths = stateHomePaths({ home });
    const marker = join(paths.live.seatPassDir, "71e77a67-7fb6-4cd8-8b77-df5a0b3cf615");
    mkdirSync(paths.live.seatPassDir, { recursive: true });
    writeFileSync(marker, "91903\tstart\t-\n");
    chmodSync(paths.live.seatPassDir, 0o500);
    try {
      const error = unwrapErr(clearSeatPassesBeforeCommit({ home }));
      expect(error.code).toBe("SEAT_PASSES_NOT_CLEARED");
      expect(error.path).toBe(paths.live.seatPassDir);
      expect(existsSync(marker)).toBe(true);
    } finally {
      chmodSync(paths.live.seatPassDir, 0o700);
    }
  });
});
