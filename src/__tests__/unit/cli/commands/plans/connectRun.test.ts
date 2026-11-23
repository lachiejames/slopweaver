/**
 * The Connect verbs' command lines, driven through the real run functions: a provider other than claude or codex and a
 * malformed `--id` are usage refusals, a Claude connect is refused as unsupported before any home is read, and a home
 * with no sign-in started lists cleanly. The effects behind them are `connectDeps.test.ts`'s.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  plansConnectCancelCommand,
  plansConnectCommand,
  plansConnectionsCommand,
  plansConnectWorkerCommand,
  workerExitCode,
} from "../../../../../cli/commands/plans/connectRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { ConnectionPhase, PlanConnection } from "../../../../../plans/connection.js";

/** One stored attempt in the given phase. */
const attemptIn = ({ phase }: { phase: ConnectionPhase }): PlanConnection => ({
  alias: "codex-1",
  deadlineAtIso: "2026-11-08T02:00:00.000Z",
  host: "codex",
  id: "0123abcd4567ef89",
  phase,
  startedAtIso: "2026-11-08T01:50:00.000Z",
  storeDir: "/h/codex-accounts/codex-1",
  updatedAtIso: "2026-11-08T01:51:00.000Z",
});

/** The argv prefix the router hands a `plans` verb: node, the binary, the noun and the verb. */
const argvOf = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "plans",
  verb,
  ...rest,
];

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh, empty home this file removes. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-connect-run-"));
  homes.push(home);
  return home;
}

describe("plans connect", () => {
  it("refuses a provider that is neither claude nor codex as a usage error", async () => {
    const home = freshHome();
    const code = await plansConnectCommand(argvOf({ rest: ["--provider", "gemini", "--home", home], verb: "connect" }));

    expect(code).toBe(EXIT_USAGE);
    expect(readdirSync(home)).toStrictEqual([]);
  });

  it("refuses a Claude connect as unsupported without writing into the home", async () => {
    const home = freshHome();
    const code = await plansConnectCommand(
      argvOf({ rest: ["--provider", "claude", "--json", "--home", home], verb: "connect" }),
    );

    expect(code).toBe(EXIT_ERROR);
    expect(readdirSync(home)).toStrictEqual([]);
  });
});

describe("plans connect-cancel and connect-worker", () => {
  it("refuses an --id that is not a sign-in attempt id", async () => {
    const home = freshHome();

    expect(
      await plansConnectCancelCommand(argvOf({ rest: ["--id", "NOT AN ID", "--home", home], verb: "connect-cancel" })),
    ).toBe(EXIT_USAGE);
    expect(
      await plansConnectWorkerCommand(argvOf({ rest: ["--id", "x", "--home", home], verb: "connect-worker" })),
    ).toBe(EXIT_USAGE);
  });
});

describe("plans connections", () => {
  it("lists a home where no sign-in was ever started as success", async () => {
    const home = freshHome();

    expect(await plansConnectionsCommand(argvOf({ rest: ["--json", "--home", home], verb: "connections" }))).toBe(
      EXIT_OK,
    );
  });
});

describe("workerExitCode", () => {
  it("fails a worker whose attempt ended failed, even though the record was written", () => {
    expect(workerExitCode({ connection: { ...attemptIn({ phase: "failed" }), failure: "CLI_MISSING" } })).toBe(
      EXIT_ERROR,
    );
  });

  it("succeeds for a connected attempt and for one the owner cancelled", () => {
    expect(workerExitCode({ connection: attemptIn({ phase: "connected" }) })).toBe(EXIT_OK);
    expect(workerExitCode({ connection: attemptIn({ phase: "cancelled" }) })).toBe(EXIT_OK);
  });
});
