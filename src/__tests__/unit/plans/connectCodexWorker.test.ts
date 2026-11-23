import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { readPlanConnections, startCodexConnect } from "../../../plans/connectCodex.js";
import { isoAt } from "../../../plans/connectCodexRecord.js";
import { runCodexConnectWorker } from "../../../plans/connectCodexWorker.js";
import { connectionMarkerPaths, writePlanConnection } from "../../../plans/connectionStore.js";
import { PlanRegisterErrors } from "../../../plans/errors.js";
import { stateHomePaths } from "../../../stateHome.js";
import { row, snapshotOf } from "../cli/commands/plans/plansRunFixtures.js";

import {
  ATTEMPT_ID,
  adopted,
  emptyJournal,
  fakeDeps,
  freshInstall,
  LIVE_PID,
  OTHER_STORE,
  SIGNED_IN,
  START_MS,
} from "./connectCodexFixtures.js";

let home: string;

/** Where a removal moves the attempt's store before deleting it. */
const RETIRED_STORE = ({ home: root }: { home: string }): string =>
  join(root, "codex-accounts", `codex-1.retired-${ATTEMPT_ID}`);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connect-codex-worker-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("runCodexConnectWorker", () => {
  it("adds a new store's row once the sign-in finished, and records the page it opened", async () => {
    const journal = emptyJournal();
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: ({ signInUrlPath }) => {
        writeFileSync(signInUrlPath, "https://auth.openai.com/oauth/authorize\n");
        return { kind: "ran", lines: SIGNED_IN };
      },
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect(done.phase).toBe("connected");
    expect(done.email).toBe("b@example.com");
    expect(done.signInUrl).toBe("https://auth.openai.com/oauth/authorize");
    expect(journal.reserved).toEqual([join(home, "codex-accounts", "codex-1")]);
    expect(journal.mutations).toEqual([
      {
        kind: "add",
        row: {
          alias: "codex-1",
          allowance: { kind: "weekly-window" },
          email: "b@example.com",
          provider: "codex",
          storeDir: join(home, "codex-accounts", "codex-1"),
          usageLimitPercent: 100,
        },
      },
    ]);
    expect(existsSync(connectionMarkerPaths({ home, id: ATTEMPT_ID }).signInUrl)).toBe(false);
  });

  it("adopts a fresh install, then adds the new store's row", async () => {
    const journal = emptyJournal();
    const deps = fakeDeps({ journal, register: freshInstall, signIn: () => ({ kind: "ran", lines: SIGNED_IN }) });
    unwrap(await startCodexConnect({ deps, home }));
    unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect(journal.mutations.map((mutation) => mutation.kind)).toEqual(["adopt", "add"]);
  });

  it("removes the store it made and fails DUPLICATE_ACCOUNT when the account is already connected", async () => {
    const journal = emptyJournal();
    const twin = snapshotOf({
      plans: [row({ alias: "codex-other", email: "b@example.com", provider: "codex", storeDir: OTHER_STORE })],
    });
    const deps = fakeDeps({ journal, register: twin, signIn: () => ({ kind: "ran", lines: SIGNED_IN }) });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect(done.failure).toBe("DUPLICATE_ACCOUNT");
    expect(journal.removed).toEqual([RETIRED_STORE({ home })]);
    expect(journal.mutations).toEqual([]);
  });

  it("fails ACCOUNT_UNKNOWN, registers nothing and removes the store when the sign-in names no account", async () => {
    const journal = emptyJournal();
    const nameless = [...SIGNED_IN.slice(0, 3), 'account\t{"id":3,"result":{"account":{"type":"chatgpt"}}}'];
    const deps = fakeDeps({ journal, register: adopted, signIn: () => ({ kind: "ran", lines: nameless }) });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect([done.phase, done.failure, journal.mutations, journal.removed]).toEqual([
      "failed",
      "ACCOUNT_UNKNOWN",
      [],
      [RETIRED_STORE({ home })],
    ]);
  });

  it("ends CLI_MISSING when there is no Codex CLI to sign in with", async () => {
    const deps = fakeDeps({
      journal: emptyJournal(),
      register: adopted,
      signIn: () => ({ kind: "cli-missing", reason: "the Codex CLI is not at /x" }),
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect(done.phase).toBe("failed");
    expect(done.failure).toBe("CLI_MISSING");
    expect(done.detail).toBe("the Codex CLI is not at /x");
  });

  it("registers nothing and ends INTERRUPTED when its sign-in finishes inside a minute of the deadline", async () => {
    const journal = emptyJournal();
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: () => {
        // A worker suspended until its record's deadline is all but gone: a reader is about to call it interrupted.
        const own = unwrap(readPlanConnections({ home, nowMs: START_MS })).codex!;
        unwrap(writePlanConnection({ connection: { ...own, deadlineAtIso: isoAt({ ms: START_MS + 30_000 }) }, home }));
        return { kind: "ran", lines: SIGNED_IN };
      },
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect([done.phase, done.failure, done.detail, journal.mutations, journal.removed]).toEqual([
      "failed",
      "INTERRUPTED",
      "the attempt reached its deadline before it was registered",
      [],
      [RETIRED_STORE({ home })],
    ]);
  });

  it("removes the store it made when the sign-in is cancelled or fails, and keeps it once connected", async () => {
    const ends = await Promise.all(
      [["!cancelled"], [], SIGNED_IN].map(async (lines) => {
        const scratch = mkdtempSync(join(tmpdir(), "connect-end-"));
        const journal = emptyJournal();
        const deps = fakeDeps({ journal, register: adopted, signIn: () => ({ kind: "ran", lines }) });
        unwrap(await startCodexConnect({ deps, home: scratch }));
        const done = unwrap(await runCodexConnectWorker({ deps, home: scratch, id: ATTEMPT_ID }));
        rmSync(scratch, { force: true, recursive: true });
        return `${done.phase}:${String(journal.removed.length)}`;
      }),
    );
    expect(ends).toEqual(["cancelled:1", "failed:1", "connected:0"]);
  });

  it("reads a write whose row committed and only a projection lagged as connected, keeping the store", async () => {
    const journal = emptyJournal();
    const lagged = PlanRegisterErrors.projectionWriteFailed({
      cause: new Error("disk full"),
      committedRevision: 41,
      paths: ["/x/plans.json"],
    });
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: () => ({ kind: "ran", lines: SIGNED_IN }),
      writeAnswer: lagged,
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect([done.phase, done.detail, journal.removed]).toEqual([
      "connected",
      "the plan is registered, but the generated copy older readers use was not rewritten, so they see the previous " +
        "plans until it is",
      [],
    ]);
    expect(lagged.message).toContain("slopweaver plans validate");
    expect(done.detail).not.toContain("slopweaver");
  });

  it("fails REGISTER_FAILED and removes the store when the write committed nothing", async () => {
    const journal = emptyJournal();
    const conflict = PlanRegisterErrors.registerRevisionConflict({ expectedRevision: 40 });
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: () => ({ kind: "ran", lines: SIGNED_IN }),
      writeAnswer: conflict,
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect([done.failure, journal.removed]).toEqual(["REGISTER_FAILED", [RETIRED_STORE({ home })]]);
  });

  it("keeps the end it reached when the store cannot be removed, naming what was left behind", async () => {
    const deps = fakeDeps({
      journal: emptyJournal(),
      register: adopted,
      removeFails: "permission denied",
      signIn: () => ({ kind: "ran", lines: ["!cancelled"] }),
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    expect([done.phase, done.detail]).toEqual([
      "cancelled",
      `${join(home, "codex-accounts", "codex-1")} was left behind: it was moved to ${RETIRED_STORE({ home })} and could not be removed there: permission denied`,
    ]);
  });

  it("registers nothing and leaves a later attempt's record alone when that attempt replaced its own", async () => {
    const later = "fedcba9876543210";
    const laterStore = join(home, "codex-accounts", "codex-2");
    const journal = emptyJournal();
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: () => {
        const own = unwrap(readPlanConnections({ home, nowMs: START_MS })).codex!;
        unwrap(
          writePlanConnection({ connection: { ...own, id: later, phase: "starting", storeDir: laterStore }, home }),
        );
        return { kind: "ran", lines: SIGNED_IN };
      },
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID });
    const standing = unwrap(readPlanConnections({ home, nowMs: START_MS })).codex!;
    expect([done._unsafeUnwrapErr().code, journal.mutations, journal.removed, standing.id, standing.phase]).toEqual([
      "CONNECTION_SUPERSEDED",
      [],
      [RETIRED_STORE({ home })],
      later,
      "starting",
    ]);
  });

  it("names the signed-in store it could not remove when a later attempt replaced its own", async () => {
    const ownStore = join(home, "codex-accounts", "codex-1");
    const deps = fakeDeps({
      journal: emptyJournal(),
      register: adopted,
      removeFails: "permission denied",
      signIn: () => {
        const own = unwrap(readPlanConnections({ home, nowMs: START_MS })).codex!;
        const replaced = { ...own, id: "fedcba9876543210", phase: "starting" as const };
        unwrap(writePlanConnection({ connection: replaced, home }));
        return { kind: "ran", lines: SIGNED_IN };
      },
    });
    unwrap(await startCodexConnect({ deps, home }));
    const failure = (await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }))._unsafeUnwrapErr();
    expect([failure.code, failure.message]).toEqual([
      "CONNECTION_STORE_LEFT_BEHIND",
      `sign-in attempt ${ATTEMPT_ID} was replaced by a later one, so its record was left alone; ${ownStore} was left behind, and no plan names it: it was moved to ${RETIRED_STORE({ home })} and could not be removed there: permission denied`,
    ]);
  });

  it("registers nothing and removes its store when another live process holds the lock past its wait", async () => {
    const lockPath = join(stateHomePaths({ home }).live.planConnectionsDir, "codex.lock.1");
    const journal = emptyJournal();
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: () => {
        writeFileSync(lockPath, `${String(START_MS + 5000)} ${String(LIVE_PID)} other\n`);
        return { kind: "ran", lines: SIGNED_IN };
      },
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID });
    expect([done._unsafeUnwrapErr().code, journal.mutations, journal.removed]).toEqual([
      "CONNECTION_STARTING",
      [],
      [RETIRED_STORE({ home })],
    ]);
  });

  it("refuses an id that is not the provider's starting attempt", async () => {
    const deps = fakeDeps({ journal: emptyJournal(), register: adopted, signIn: () => ({ kind: "ran", lines: [] }) });
    const result = await runCodexConnectWorker({ deps, home, id: "ffffffffffffffff" });
    expect(result._unsafeUnwrapErr().code).toBe("CONNECTION_NOT_FOUND");
  });
});

describe("a register failure on the worker's record", () => {
  it("ends on the closed wording, never the conflict's own message naming a command", async () => {
    const conflict = PlanRegisterErrors.mutationConflict({
      conflict: "to refresh a cached Codex address, run slopweaver plans sync-accounts",
    });
    const deps = fakeDeps({
      journal: emptyJournal(),
      register: adopted,
      signIn: () => ({ kind: "ran", lines: SIGNED_IN }),
      writeAnswer: conflict,
    });
    unwrap(await startCodexConnect({ deps, home }));
    const done = unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));

    expect([conflict.message.includes("slopweaver plans sync-accounts"), done.failure, done.detail]).toEqual([
      true,
      "REGISTER_FAILED",
      "the plan register refused this plan as it stands, so nothing was registered",
    ]);
  });
});
