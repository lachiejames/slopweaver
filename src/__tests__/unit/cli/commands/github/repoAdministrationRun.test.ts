/**
 * `github repo`'s rename, transfer and archive over a plain fake administration API typed against the SDK
 * adapter. No real repository is touched: the send path is proven here and nowhere else, by design — each write
 * is irreversible. Every case asserts what was SENT, because a preview that sends is the defect that matters.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { runRepoAdministration } from "../../../../../cli/commands/github/repoAdministrationRun.js";
import type { GithubRepoAdministrationArgs } from "../../../../../cli/commands/github/repoCore.js";
import { githubRepoErrorFactories } from "../../../../../cli/commands/github/repoErrors.js";
import {
  type GithubRepoAdministrationAction,
  githubRepoWriteDigest,
  planRepoAdministration,
} from "../../../../../cli/commands/github/repoPlan.js";
import type { GithubRepoTransferWait } from "../../../../../cli/commands/github/repoReadBack.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import type {
  GithubRepoAdministrationApi,
  RepoAdministrationState,
} from "../../../../../outbound/github/repoAdministration.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const WIDGETS: RepoAdministrationState = {
  archived: false,
  fullName: "acme/widgets",
  htmlUrl: "https://github.com/acme/widgets",
  id: 4242,
  name: "widgets",
  ownerLogin: "acme",
};

/** An HTTP failure the fake API answers, shaped as `safeProviderCall` produces one. */
function httpError({ status }: { status: number }): IngestError {
  return { kind: "http", message: `HTTP ${String(status)}`, operation: "github.repos.get", provider: "github", status };
}

/** One answer the fake read gives, in order. */
type ReadAnswer = RepoAdministrationState | IngestError;

/** A plain fake API: reads answer from a queue, and every write is recorded as `<kind> <detail>`. */
function fakeApi({
  reads,
  sent,
  readAddresses,
}: {
  reads: ReadAnswer[];
  sent: string[];
  readAddresses: string[];
}): GithubRepoAdministrationApi {
  return {
    archive: ({ owner, repo }) => {
      sent.push(`archive ${owner}/${repo}`);
      return okAsync(undefined);
    },
    read: ({ owner, repo }) => {
      readAddresses.push(`${owner}/${repo}`);
      const next = reads.shift()!;
      return "kind" in next ? errAsync(next) : okAsync(next);
    },
    rename: ({ owner, repo, newName }) => {
      sent.push(`rename ${owner}/${repo} ${newName}`);
      return okAsync(undefined);
    },
    transfer: ({ owner, repo, newOwner }) => {
      sent.push(`transfer ${owner}/${repo} ${newOwner}`);
      return okAsync(undefined);
    },
  };
}

/** A transfer wait that never sleeps, recording each sleep it was asked for. */
function instantWait({ attempts, slept }: { attempts: number; slept: number[] }): GithubRepoTransferWait {
  return {
    attempts,
    intervalMs: 2000,
    sleep: async ({ ms }) => {
      slept.push(ms);
    },
  };
}

/** The digest a preview over `current` prints for `action`, as an operator would copy it. */
function digestFor({
  action,
  current,
}: {
  action: GithubRepoAdministrationAction;
  current: RepoAdministrationState;
}): string {
  return githubRepoWriteDigest({
    plan: planRepoAdministration({ action, current, source: { owner: "acme", repo: "widgets" } }),
  });
}

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** Run one administration invocation, collecting everything it printed, sent and read. */
async function run({
  action,
  approve,
  reads,
  ledger = memoryDoorLedger().port,
  attempts = 3,
  json = false,
}: {
  action: GithubRepoAdministrationAction;
  approve?: string;
  reads: ReadAnswer[];
  ledger?: DoorLedgerPort;
  attempts?: number;
  json?: boolean;
}): Promise<{
  code: number;
  out: string[];
  diagnostic: string[];
  sent: string[];
  readAddresses: string[];
  slept: number[];
}> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-admin-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostic: string[] = [];
  const sent: string[] = [];
  const readAddresses: string[] = [];
  const slept: number[] = [];
  const args: GithubRepoAdministrationArgs = { action, approve, home, json, owner: "acme", repo: "widgets" };
  const code = await runRepoAdministration({
    args,
    seams: {
      api: fakeApi({ readAddresses, reads, sent }),
      home,
      ledger,
      out: (line) => out.push(line),
      wait: instantWait({ attempts, slept }),
      writeDiagnostic: (line) => diagnostic.push(line),
    },
  });
  return { code, diagnostic, out, readAddresses, sent, slept };
}

describe("runRepoAdministration preview", () => {
  it("reads once, prints the change and its digest, and sends nothing", async () => {
    const action = { kind: "rename", newName: "gadgets" } as const;
    const result = await run({ action, ledger: unreachableDoorLedger(), reads: [WIDGETS] });

    const digest = digestFor({ action, current: WIDGETS });
    expect(result.code).toBe(0);
    expect(result.sent).toEqual([]);
    expect(result.readAddresses).toEqual(["acme/widgets"]);
    expect(result.out).toEqual([
      "preview: rename acme/widgets (id 4242, not archived) -> acme/gadgets",
      `  digest ${digest}`,
      `  apply:  slopweaver github repo --repo acme/widgets --rename-to gadgets --approve ${digest}`,
    ]);
  });

  it("prints the plan view, digest and sent false as JSON", async () => {
    const action = { kind: "archive" } as const;
    const result = await run({ action, json: true, reads: [WIDGETS] });

    expect(JSON.parse(result.out[0]!)).toEqual({
      action: { kind: "archive" },
      current: { archived: false, fullName: "acme/widgets", id: 4242, name: "widgets", ownerLogin: "acme" },
      digest: digestFor({ action, current: WIDGETS }),
      outcome: "preview",
      sent: false,
      source: "acme/widgets",
      target: "acme/widgets",
    });
  });

  it("is an honest no-op for a repository already archived, with or without an approval", async () => {
    const result = await run({
      action: { kind: "archive" },
      approve: "ghrepo-0123456789abcdef",
      reads: [{ ...WIDGETS, archived: true }],
    });

    expect(result.code).toBe(0);
    expect(result.sent).toEqual([]);
    expect(result.out).toEqual(["already done: archive acme/widgets (id 4242, archived)"]);
  });

  it("refuses with the read's own failure when the source address cannot be read", async () => {
    const result = await run({ action: { kind: "archive" }, reads: [httpError({ status: 404 })] });

    expect(result.code).toBe(1);
    expect(result.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("404");
  });
});

describe("runRepoAdministration apply", () => {
  it("renames once on the matching digest and confirms the same repository at the new address", async () => {
    const action = { kind: "rename", newName: "gadgets" } as const;
    const door = memoryDoorLedger();
    const renamed = {
      ...WIDGETS,
      fullName: "acme/gadgets",
      htmlUrl: "https://github.com/acme/gadgets",
      name: "gadgets",
    };
    const result = await run({
      action,
      approve: digestFor({ action, current: WIDGETS }),
      ledger: door.port,
      reads: [WIDGETS, renamed],
    });

    expect(result.code).toBe(0);
    expect(result.sent).toEqual(["rename acme/widgets gadgets"]);
    expect(result.readAddresses).toEqual(["acme/widgets", "acme/gadgets"]);
    expect(result.out).toEqual([
      "confirmed: rename acme/widgets (id 4242, not archived) -> acme/gadgets  https://github.com/acme/gadgets",
    ]);
    expect(door.records().length).toBe(1);
  });

  it("holds a stale digest at the door and sends nothing", async () => {
    const door = memoryDoorLedger();
    const result = await run({
      action: { kind: "archive" },
      approve: "ghrepo-0123456789abcdef",
      ledger: door.port,
      reads: [WIDGETS],
    });

    expect(result.code).toBe(1);
    expect(result.sent).toEqual([]);
    expect(door.text()).toContain("github.repo-write-unapproved");
  });

  it("sends nothing when the door cannot record the write", async () => {
    const action = { kind: "archive" } as const;
    const result = await run({
      action,
      approve: digestFor({ action, current: WIDGETS }),
      ledger: unreachableDoorLedger(),
      reads: [WIDGETS],
    });

    expect(result.code).toBe(1);
    expect(result.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("not performed:");
  });

  it("refuses a rename whose new address answers with a different repository", async () => {
    const action = { kind: "rename", newName: "gadgets" } as const;
    const impostor = { ...WIDGETS, fullName: "acme/gadgets", id: 7, name: "gadgets" };
    const result = await run({ action, approve: digestFor({ action, current: WIDGETS }), reads: [WIDGETS, impostor] });

    expect(result.code).toBe(1);
    expect(result.sent).toEqual(["rename acme/widgets gadgets"]);
    expect(result.diagnostic).toEqual([
      githubRepoErrorFactories.repoRenameUnconfirmed({ source: "acme/widgets", target: "acme/gadgets" }).message,
    ]);
  });

  it("archives once and requires the read-back to say archived", async () => {
    const action = { kind: "archive" } as const;
    const approve = digestFor({ action, current: WIDGETS });

    const confirmed = await run({ action, approve, reads: [WIDGETS, { ...WIDGETS, archived: true }] });
    expect(confirmed.code).toBe(0);
    expect(confirmed.sent).toEqual(["archive acme/widgets"]);

    const unconfirmed = await run({ action, approve, reads: [WIDGETS, WIDGETS] });
    expect(unconfirmed.code).toBe(1);
    expect(unconfirmed.diagnostic).toEqual([
      githubRepoErrorFactories.repoArchiveUnconfirmed({ fullName: "acme/widgets" }).message,
    ]);
  });
});

describe("runRepoAdministration transfer read-back", () => {
  const action = { kind: "transfer", newOwner: "fixture-owner" } as const;
  const landed = {
    ...WIDGETS,
    fullName: "fixture-owner/widgets",
    htmlUrl: "https://github.com/fixture-owner/widgets",
    ownerLogin: "fixture-owner",
  };

  it("polls the destination past a 404 and confirms the same repository there", async () => {
    const result = await run({
      action,
      approve: digestFor({ action, current: WIDGETS }),
      reads: [WIDGETS, httpError({ status: 404 }), landed],
    });

    expect(result.code).toBe(0);
    expect(result.sent).toEqual(["transfer acme/widgets fixture-owner"]);
    expect(result.readAddresses).toEqual(["acme/widgets", "fixture-owner/widgets", "fixture-owner/widgets"]);
    expect(result.slept).toEqual([2000]);
  });

  it("reports an accepted but unconfirmed transfer after the bound, without sending it again", async () => {
    const result = await run({
      action,
      approve: digestFor({ action, current: WIDGETS }),
      attempts: 2,
      reads: [WIDGETS, httpError({ status: 404 }), httpError({ status: 404 })],
    });

    expect(result.code).toBe(1);
    expect(result.sent).toEqual(["transfer acme/widgets fixture-owner"]);
    expect(result.slept).toEqual([2000]);
    expect(result.diagnostic).toEqual([
      githubRepoErrorFactories.repoTransferUnconfirmed({
        attempts: 2,
        source: "acme/widgets",
        target: "fixture-owner/widgets",
      }).message,
    ]);
  });

  it("stops polling on a failure other than not-found", async () => {
    const result = await run({
      action,
      approve: digestFor({ action, current: WIDGETS }),
      reads: [WIDGETS, httpError({ status: 403 })],
    });

    expect(result.code).toBe(1);
    expect(result.readAddresses).toEqual(["acme/widgets", "fixture-owner/widgets"]);
    expect(result.slept).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("403");
  });
});
