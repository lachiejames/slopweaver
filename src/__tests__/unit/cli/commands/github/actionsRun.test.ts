/**
 * `github actions`'s shell over plain fakes: a read writes nothing, a preview writes nothing, an already-off
 * repository sends nothing, and a performed switch-off is judged by a separate read-back whatever GitHub answered.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import {
  type GithubActionsDeps,
  githubActionsCommand,
  runGithubActions,
} from "../../../../../cli/commands/github/actionsRun.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import type { GithubRepoActionsApi, RepoActionsState } from "../../../../../outbound/github/repoActions.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const ARGV_PREFIX = ["node", "slopweaver", "github", "actions"] as const;

const ON: RepoActionsState = { allowedActions: "all", enabled: true };
const OFF: RepoActionsState = { allowedActions: "all", enabled: false };
const SERVER: IngestError = {
  kind: "http",
  message: "Server Error",
  operation: "github.actions.setGithubActionsPermissionsRepository",
  provider: "github",
  status: 500,
};
const FORBIDDEN: IngestError = {
  kind: "http",
  message: "Resource not accessible by integration",
  operation: "github.actions.getGithubActionsPermissionsRepository",
  provider: "github",
  status: 403,
};

/** A fake whose reads answer in order and whose switch-off answers once, recording every call. */
function fakeApi({
  calls,
  reads,
  write,
}: {
  calls: string[];
  reads: (RepoActionsState | IngestError)[];
  write: IngestError | undefined;
}): GithubRepoActionsApi {
  return {
    disable: () => {
      calls.push("disable");
      return write === undefined ? okAsync(undefined) : errAsync(write);
    },
    read: () => {
      calls.push("read");
      const next = reads.shift()!;
      return "kind" in next ? errAsync(next) : okAsync(next);
    },
  };
}

interface Harness {
  readonly deps: GithubActionsDeps;
  readonly out: string[];
  readonly diagnostic: string[];
  readonly homes: string[];
}

function harness({
  api,
  home,
  door = memoryDoorLedger().port,
}: {
  api: GithubRepoActionsApi;
  home: string;
  door?: DoorLedgerPort;
}): Harness {
  const out: string[] = [];
  const diagnostic: string[] = [];
  const homes: string[] = [];
  return {
    deps: {
      doorLedger: door,
      home: () => home,
      makeApi: () => api,
      out: (line) => out.push(line),
      token: ({ home: used }) => {
        homes.push(used);
        return "token";
      },
      writeDiagnostic: (line) => diagnostic.push(line),
    },
    diagnostic,
    homes,
    out,
  };
}

describe("runGithubActions", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-actions-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads once and writes nothing on a bare invocation", async () => {
    const calls: string[] = [];
    const door = memoryDoorLedger();
    const h = harness({ api: fakeApi({ calls, reads: [ON], write: undefined }), door: door.port, home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(calls).toEqual(["read"]);
    expect(h.out).toEqual(["read acme/widgets", "  enabled=true allowed-actions=all"]);
    expect(door.records()).toEqual([]);
  });

  it("prints the read as JSON with an absent allowed-actions as null", async () => {
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({ calls, reads: [{ allowedActions: undefined, enabled: true }], write: undefined }),
      home,
    });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--json"] });

    expect(code).toBe(0);
    expect(JSON.parse(h.out.join("\n"))).toStrictEqual({
      outcome: "read",
      repo: "acme/widgets",
      state: { allowedActions: null, enabled: true },
    });
  });

  it("previews the switch-off with no write and no door record", async () => {
    const calls: string[] = [];
    const door = memoryDoorLedger();
    const h = harness({ api: fakeApi({ calls, reads: [ON], write: undefined }), door: door.port, home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable"] });

    expect(code).toBe(0);
    expect(calls).toEqual(["read"]);
    expect(h.out).toEqual([
      "would disable acme/widgets",
      "  before: enabled=true allowed-actions=all",
      "  after:  enabled=false allowed-actions=not reported",
    ]);
    expect(door.records()).toEqual([]);
  });

  it("sends nothing when Actions is already off, even with --apply", async () => {
    const calls: string[] = [];
    const door = memoryDoorLedger();
    const h = harness({ api: fakeApi({ calls, reads: [OFF], write: undefined }), door: door.port, home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable", "--apply"] });

    expect(code).toBe(0);
    expect(calls).toEqual(["read"]);
    expect(h.out[0]).toBe("already off acme/widgets");
    expect(door.records()).toEqual([]);
  });

  it("switches off through the door and confirms by a second read", async () => {
    const calls: string[] = [];
    const door = memoryDoorLedger();
    const h = harness({ api: fakeApi({ calls, reads: [ON, OFF], write: undefined }), door: door.port, home });
    const code = await runGithubActions({
      deps: h.deps,
      rest: ["--repo", "acme/widgets", "--disable", "--apply", "--json"],
    });

    expect(code).toBe(0);
    expect(calls).toEqual(["read", "disable", "read"]);
    expect(JSON.parse(h.out.join("\n"))).toStrictEqual({
      after: { allowedActions: "all", enabled: false },
      before: { allowedActions: "all", enabled: true },
      outcome: "disabled",
      repo: "acme/widgets",
    });
    expect(door.records().length).toBe(1);
    expect(h.diagnostic).toEqual([]);
  });

  it("performs no write when the door cannot record it", async () => {
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({ calls, reads: [ON, OFF], write: undefined }),
      door: unreachableDoorLedger(),
      home,
    });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable", "--apply"] });

    expect(code).toBe(1);
    expect(calls).toEqual(["read"]);
    expect(h.diagnostic.join("\n")).toContain("not performed:");
  });

  it("refuses success when GitHub acknowledged the write but it still reads on", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, reads: [ON, ON], write: undefined }), home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable", "--apply"] });

    expect(code).toBe(1);
    expect(calls).toEqual(["read", "disable", "read"]);
    expect(h.out[0]).toBe("NOT confirmed acme/widgets");
    expect(h.diagnostic.join("\n")).toContain("read-back still says enabled");
  });

  it("still reads back after a failed write, and reports off despite the error when it reads off", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, reads: [ON, OFF], write: SERVER }), home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable", "--apply"] });

    expect(code).toBe(0);
    expect(calls).toEqual(["read", "disable", "read"]);
    expect(h.out[0]).toBe("off despite write error acme/widgets");
    expect(h.diagnostic.join("\n")).toContain("Server Error");
  });

  it("reports unchanged after a failed write that still reads on", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, reads: [ON, ON], write: SERVER }), home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable", "--apply"] });

    expect(code).toBe(1);
    expect(calls).toEqual(["read", "disable", "read"]);
    expect(h.out[0]).toBe("unchanged acme/widgets");
  });

  it("says the state is unknown when the read-back fails", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, reads: [ON, FORBIDDEN], write: undefined }), home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable", "--apply"] });

    expect(code).toBe(1);
    expect(calls).toEqual(["read", "disable", "read"]);
    expect(h.out).toEqual([]);
    expect(h.diagnostic.join("\n")).toContain("UNKNOWN");
  });

  it("opens no door and sends nothing when the first read fails", async () => {
    const calls: string[] = [];
    const door = memoryDoorLedger();
    const h = harness({ api: fakeApi({ calls, reads: [FORBIDDEN], write: undefined }), door: door.port, home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--disable", "--apply"] });

    expect(code).toBe(1);
    expect(calls).toEqual(["read"]);
    expect(door.records()).toEqual([]);
    expect(h.diagnostic.join("\n")).toContain("403");
  });

  it("resolves the token from the --home it was given", async () => {
    const calls: string[] = [];
    const named = mkdtempSync(join(tmpdir(), "slopweaver-actions-named-"));
    const h = harness({ api: fakeApi({ calls, reads: [ON], write: undefined }), home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--home", named] });

    expect(code).toBe(0);
    expect(h.homes).toEqual([named]);
    rmSync(named, { force: true, recursive: true });
  });

  it("refuses bad input before touching any seam", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, reads: [ON], write: undefined }), home });
    const code = await runGithubActions({ deps: h.deps, rest: ["--repo", "acme/widgets", "--apply"] });

    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(h.homes).toEqual([]);
  });

  it("exports a command that refuses a malformed invocation before any I/O", async () => {
    expect(await githubActionsCommand([...ARGV_PREFIX, "--apply"])).toBe(2);
  });
});
