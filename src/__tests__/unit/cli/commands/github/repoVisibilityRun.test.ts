import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { runGithubRepo } from "../../../../../cli/commands/github/repoRun.js";
import { SET_PUBLIC_CONSEQUENCES } from "../../../../../cli/commands/github/repoVisibilityRun.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  approvedRepoDeps,
  githubHttpError,
  type LifecycleWorld,
  lifecycleState,
} from "../../../../githubRepoWriteFakes.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const REST = ["--repo", "acme/widget", "--set-public"];

/** A world holding one private repository, `acme/widget`. */
function world(over: Partial<LifecycleWorld> = {}): LifecycleWorld {
  return {
    accounts: new Map(),
    me: { id: 10, login: "acme", type: "User" },
    nextId: 1,
    repos: new Map([["acme/widget", lifecycleState()]]),
    sent: [],
    ...over,
  };
}

/** Run one `github repo` invocation over a world. */
async function run({
  rest,
  lifecycle,
  door = memoryDoorLedger().port,
}: {
  rest: readonly string[];
  lifecycle: LifecycleWorld;
  door?: DoorLedgerPort;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-visibility-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostic: string[] = [];
  const code = await runGithubRepo({ deps: approvedRepoDeps({ diagnostic, door, home, lifecycle, out }), rest });
  return { code, diagnostic, out };
}

/** The digest a `--json` preview prints. */
async function previewDigest({ lifecycle }: { lifecycle: LifecycleWorld }): Promise<string> {
  const preview = await run({ lifecycle, rest: [...REST, "--json"] });
  return (JSON.parse(preview.out[0]!) as { digest: string }).digest;
}

describe("github repo --set-public", () => {
  it("previews the change with every consequence an approval accepts, and sends nothing", async () => {
    const lifecycle = world();
    const result = await run({ lifecycle, rest: REST });

    expect(result.code).toBe(0);
    expect(lifecycle.sent).toEqual([]);
    expect(result.out.slice(0, 6)).toEqual([
      "preview: make acme/widget (id 101, private) public",
      ...SET_PUBLIC_CONSEQUENCES.map((line) => `  approving this also accepts: ${line}`),
    ]);
    expect(SET_PUBLIC_CONSEQUENCES.length).toBe(5);
  });

  it("reports an already-public repository as done without previewing a digest", async () => {
    const lifecycle = world({
      repos: new Map([["acme/widget", lifecycleState({ private: false, visibility: "public" })]]),
    });
    const result = await run({ lifecycle, rest: REST });

    expect(result.code).toBe(0);
    expect(result.out).toEqual(["already done: make acme/widget (id 101, public) public"]);
  });

  it("publishes once on the preview's digest and confirms the same id reads back public", async () => {
    const lifecycle = world();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ lifecycle });
    const result = await run({ door: door.port, lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(0);
    expect(lifecycle.sent).toEqual(["set-public acme/widget"]);
    expect(result.out).toEqual(["confirmed: acme/widget is public  https://github.com/acme/widget"]);
    expect(door.records().length).toBe(1);
  });

  it("holds the approval when the repository at the address is no longer the one previewed", async () => {
    const lifecycle = world();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ lifecycle });
    lifecycle.repos.set("acme/widget", lifecycleState({ id: 202 }));
    const result = await run({ door: door.port, lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(door.text()).toContain("github.repo-write-unapproved");
  });

  it("holds the approval when the read answers a different owner or name for the same id", async () => {
    const lifecycle = world();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ lifecycle });
    lifecycle.repos.set("acme/widget", lifecycleState({ name: "other", ownerLogin: "bystander" }));
    const result = await run({ door: door.port, lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(door.text()).toContain("github.repo-write-unapproved");
  });

  it("reports an accepted change the read-back does not show as unconfirmed", async () => {
    const lifecycle = world({ publishIgnored: true });
    const approve = await previewDigest({ lifecycle });
    const result = await run({ lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual(["set-public acme/widget"]);
    expect(result.diagnostic.join("\n")).toContain(
      "GitHub accepted making acme/widget public but the read-back does not show the same repository public",
    );
  });

  it("never confirms a read-back answering the same id at another address", async () => {
    const lifecycle = world();
    const approve = await previewDigest({ lifecycle });
    const moved = lifecycleState({ fullName: "bystander/other", private: false, visibility: "public" });
    lifecycle.readAfterWrite = okAsync(moved);
    const result = await run({ lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("does not show the same repository public at the same address");
  });

  it("carries a failed read-back's operation and status into the unconfirmed report", async () => {
    const lifecycle = world();
    const approve = await previewDigest({ lifecycle });
    lifecycle.readAfterWrite = errAsync({ ...githubHttpError({ status: 503 }), operation: "github.repos.get" });
    const result = await run({ lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("GitHub said: read-back: github github.repos.get HTTP 503");
  });

  it("reports a change GitHub refused, naming it", async () => {
    const lifecycle = world();
    const approve = await previewDigest({ lifecycle });
    lifecycle.refuse = { error: githubHttpError({ status: 403 }), write: "set-public" };
    const result = await run({ lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual(["set-public acme/widget"]);
    expect(result.diagnostic.join("\n")).toContain("make acme/widget public: ");
  });

  it("refuses a repository that cannot be read", async () => {
    const lifecycle = world({ repos: new Map() });
    const result = await run({ lifecycle, rest: REST });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("read acme/widget: ");
  });
});
