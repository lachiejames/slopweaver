import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { startCodexConnect } from "../../../plans/connectCodex.js";
import type { CodexConnectDeps } from "../../../plans/connectCodexRecord.js";
import { removeOwnStore } from "../../../plans/connectCodexStore.js";
import { runCodexConnectWorker } from "../../../plans/connectCodexWorker.js";
import { writePlanConnection } from "../../../plans/connectionStore.js";
import { row, snapshotOf } from "../cli/commands/plans/plansRunFixtures.js";

import { ATTEMPT_ID, adopted, emptyJournal, fakeDeps, OTHER_STORE } from "./connectCodexFixtures.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connect-codex-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("removeOwnStore", () => {
  const retiredOf = ({ storeDir }: { storeDir: string }): string => `${storeDir}.retired-${ATTEMPT_ID}`;
  const heldIn = ({ storeDir }: { storeDir: string }): string => join(retiredOf({ storeDir }), "store");

  it("moves a store carrying this attempt's reservation into a holding directory, then removes that directory", async () => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const reservations = new Map([[ownStore, ATTEMPT_ID]]);
    const deps = fakeDeps({ journal, register: adopted, reservations, signIn: () => ({ kind: "ran", lines: [] }) });
    unwrap(await removeOwnStore({ alias: "codex-1", deps, home, id: ATTEMPT_ID, storeDir: ownStore }));
    expect([journal.moved, journal.removed]).toEqual([
      [`${ownStore} -> ${heldIn({ storeDir: ownStore })}`],
      [retiredOf({ storeDir: ownStore })],
    ]);
  });

  it("keeps a store whose reservation is another attempt's, moving and removing nothing", async () => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const reservations = new Map([[ownStore, "fedcba9876543210"]]);
    const deps = fakeDeps({ journal, register: adopted, reservations, signIn: () => ({ kind: "ran", lines: [] }) });
    const kept = await removeOwnStore({ alias: "codex-1", deps, home, id: ATTEMPT_ID, storeDir: ownStore });
    expect([unwrapErr(kept).code, journal.moved, journal.removed]).toEqual(["RESERVATION_NOT_OURS", [], []]);
  });

  it("refuses a path that is not the store a Connect reserves for the alias, even carrying the reservation", async () => {
    const journal = emptyJournal();
    const reservations = new Map([[OTHER_STORE, ATTEMPT_ID]]);
    const deps = fakeDeps({ journal, register: adopted, reservations, signIn: () => ({ kind: "ran", lines: [] }) });
    const kept = await removeOwnStore({ alias: "codex-1", deps, home, id: ATTEMPT_ID, storeDir: OTHER_STORE });
    expect([unwrapErr(kept).code, journal.moved, journal.removed]).toEqual(["NOT_CONNECTS_STORE", [], []]);
  });

  it("leaves a store a plan came to name while it was moved aside in the holding directory, moving it nowhere else", async () => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const reservations = new Map([[ownStore, ATTEMPT_ID]]);
    const claimed = snapshotOf({ plans: [row({ alias: "manual", provider: "codex", storeDir: ownStore })] });
    const deps = fakeDeps({
      journal,
      register: adopted,
      registerAfterMove: claimed,
      reservations,
      signIn: () => ({ kind: "ran", lines: [] }),
    });
    const kept = await removeOwnStore({ alias: "codex-1", deps, home, id: ATTEMPT_ID, storeDir: ownStore });
    // A rename back would replace the empty directory that plan's own `plans add` made at the original path.
    expect([
      unwrapErr(kept).message,
      journal.moved,
      journal.removed,
      reservations.get(heldIn({ storeDir: ownStore })),
    ]).toEqual([
      `the plan manual now uses it, so it was not removed; it stands at ${heldIn({ storeDir: ownStore })}`,
      [`${ownStore} -> ${heldIn({ storeDir: ownStore })}`],
      [],
      ATTEMPT_ID,
    ]);
  });

  it.each([
    ["the store's own path", ({ storeDir }: { storeDir: string }): string => storeDir],
    ["a directory inside the store", ({ storeDir }: { storeDir: string }): string => join(storeDir, "nested")],
    ["the holding directory itself", ({ storeDir }: { storeDir: string }): string => retiredOf({ storeDir })],
    ["the path the store was moved to", ({ storeDir }: { storeDir: string }): string => heldIn({ storeDir })],
    [
      "a directory inside the moved store",
      ({ storeDir }: { storeDir: string }): string => join(heldIn({ storeDir }), "x"),
    ],
  ])("keeps the store, removing nothing, when a plan names %s", async (_case, named) => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const reservations = new Map([[ownStore, ATTEMPT_ID]]);
    const claimed = snapshotOf({
      plans: [row({ alias: "manual", provider: "codex", storeDir: named({ storeDir: ownStore }) })],
    });
    const deps = fakeDeps({
      journal,
      register: adopted,
      registerAfterMove: claimed,
      reservations,
      signIn: () => ({ kind: "ran", lines: [] }),
    });
    const kept = await removeOwnStore({ alias: "codex-1", deps, home, id: ATTEMPT_ID, storeDir: ownStore });
    expect([unwrapErr(kept).code, journal.moved.length, journal.removed]).toEqual(["PLAN_HOLDS_STORE", 1, []]);
  });
});

describe("runCodexConnectWorker's store ownership", () => {
  it("neither signs into nor removes a store its record names outside the one a Connect reserves", async () => {
    const journal = emptyJournal();
    const signIns: string[] = [];
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: ({ signInUrlPath }) => {
        signIns.push(signInUrlPath);
        return { kind: "cli-missing", reason: "no CLI" };
      },
    });
    const started = unwrap(await startCodexConnect({ deps, home }));
    unwrap(writePlanConnection({ connection: { ...started, storeDir: OTHER_STORE }, home }));
    const failure = (await runCodexConnectWorker({ deps, home, id: started.id }))._unsafeUnwrapErr();
    expect([failure.code, signIns, journal.removed]).toEqual(["CONNECTION_STORE_FOREIGN", [], []]);
  });

  it("neither signs into nor removes a store at the reserved path that this attempt did not create", async () => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const reservations = new Map<string, string>();
    const signIns: string[] = [];
    const deps = fakeDeps({
      journal,
      register: adopted,
      reservations,
      signIn: ({ signInUrlPath }) => {
        signIns.push(signInUrlPath);
        return { kind: "ran", lines: ["!cancelled"] };
      },
    });
    const started = unwrap(await startCodexConnect({ deps, home }));
    // A directory that was standing there carries no reservation: the record alone names it.
    reservations.delete(ownStore);
    const failure = (await runCodexConnectWorker({ deps, home, id: started.id }))._unsafeUnwrapErr();
    expect([failure.code, failure.message, signIns, journal.removed]).toEqual([
      "CONNECTION_STORE_FOREIGN",
      `the sign-in attempt names ${ownStore}, which this attempt did not reserve, so it was neither signed into nor removed`,
      [],
      [],
    ]);
  });

  it("leaves its store alone when another attempt's reservation replaced its own before the removal", async () => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const reservations = new Map<string, string>();
    const deps = fakeDeps({
      journal,
      register: adopted,
      reservations,
      signIn: () => {
        reservations.set(ownStore, "fedcba9876543210");
        return { kind: "ran", lines: ["!cancelled"] };
      },
    });
    const started = unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: started.id }));
    expect([done.phase, done.detail, journal.removed]).toEqual([
      "cancelled",
      `${ownStore} was left behind: it does not carry this attempt's reservation, so it was not removed`,
      [],
    ]);
  });

  it("leaves its store alone when a row came to name it after the start check, saying which plan holds it", async () => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const claimed = snapshotOf({ plans: [row({ alias: "manual", provider: "codex", storeDir: ownStore })] });
    const reads = { count: 0 };
    const base = fakeDeps({ journal, register: adopted, signIn: () => ({ kind: "ran", lines: ["!cancelled"] }) });
    const deps: CodexConnectDeps = {
      ...base,
      // The start and the worker's start check read the register before the hand `plans add`; every later read after.
      readRegister: async () => {
        reads.count += 1;
        return ok(reads.count <= 2 ? adopted : claimed);
      },
    };
    const started = unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: started.id }));
    // The store stays in its holding directory, named in the detail; nothing was removed.
    const heldAt = join(`${ownStore}.retired-${ATTEMPT_ID}`, "store");
    expect([done.phase, done.detail, journal.removed, journal.moved]).toEqual([
      "cancelled",
      `${ownStore} was left behind: the plan manual now uses it, so it was not removed; it stands at ${heldAt}`,
      [],
      [`${ownStore} -> ${heldAt}`],
    ]);
  });

  it("neither signs into nor removes a reserved-looking store a register row already names", async () => {
    const journal = emptyJournal();
    const ownStore = join(home, "codex-accounts", "codex-1");
    const deps = fakeDeps({ journal, register: adopted, signIn: () => ({ kind: "cli-missing", reason: "no CLI" }) });
    const started = unwrap(await startCodexConnect({ deps, home }));
    const claimed = snapshotOf({ plans: [row({ alias: "legacy", provider: "codex", storeDir: `${ownStore}/` })] });
    const worker: CodexConnectDeps = { ...deps, readRegister: async () => ok(claimed) };
    const failure = (await runCodexConnectWorker({ deps: worker, home, id: started.id }))._unsafeUnwrapErr();
    expect([failure.code, failure.message, journal.removed]).toEqual([
      "CONNECTION_STORE_FOREIGN",
      `the sign-in attempt names ${ownStore}, which the plan legacy already uses, so it was neither signed into nor removed`,
      [],
    ]);
  });
});
