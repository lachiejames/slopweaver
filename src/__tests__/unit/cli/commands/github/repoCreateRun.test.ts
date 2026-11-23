import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { runGithubRepo } from "../../../../../cli/commands/github/repoRun.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
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

/** A world where the token belongs to `acme`, `acme-labs` is an organisation, and `bystander` a person. */
function world(over: Partial<LifecycleWorld> = {}): LifecycleWorld {
  return {
    accounts: new Map([
      ["acme-labs", { id: 20, login: "acme-labs", type: "Organization" }],
      ["bystander", { id: 30, login: "bystander", type: "User" }],
    ]),
    me: { id: 10, login: "acme", type: "User" },
    nextId: 555,
    repos: new Map(),
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
  const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-create-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostic: string[] = [];
  const code = await runGithubRepo({ deps: approvedRepoDeps({ diagnostic, door, home, lifecycle, out }), rest });
  return { code, diagnostic, out };
}

/** The digest a `--json` preview prints for one invocation. */
async function previewDigest({
  rest,
  lifecycle,
}: {
  rest: readonly string[];
  lifecycle: LifecycleWorld;
}): Promise<string> {
  const preview = await run({ lifecycle, rest: [...rest, "--json"] });
  return (JSON.parse(preview.out[0]!) as { digest: string }).digest;
}

describe("github repo --create preview", () => {
  it("previews a private repository on the token's own account and sends nothing", async () => {
    const lifecycle = world();
    const result = await run({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });

    expect(result.code).toBe(0);
    expect(lifecycle.sent).toEqual([]);
    expect(result.out[0]).toBe(
      "preview: create acme/widget as a private repository owned by the token's own account acme",
    );
    expect(result.out[1]).toMatch(/^ {2}digest ghrepo-[0-9a-f]{16}$/);
    expect(result.out[2]).toMatch(
      /^ {2}apply: {2}slopweaver github repo --repo acme\/widget --create --approve ghrepo-/,
    );
  });

  it("names what a public create accepts, and binds the owner and the request in the JSON view", async () => {
    const lifecycle = world();
    const result = await run({ lifecycle, rest: ["--repo", "acme-labs/widget", "--create", "--public", "--json"] });
    const view = JSON.parse(result.out[0]!) as Record<string, unknown>;

    expect(result.code).toBe(0);
    expect(view["owner"]).toEqual({ id: 20, kind: "organization", login: "acme-labs" });
    expect(view["request"]).toEqual({ name: "widget", private: false });
    expect(view["precondition"]).toEqual({ repository: "absent", status: 404 });
    expect(view["consequences"]).toEqual(["the new repository is readable by anyone from the moment it exists"]);
    expect(view["sent"]).toBe(false);
  });

  it("refuses an address that already holds a repository", async () => {
    const lifecycle = world({ repos: new Map([["acme/widget", lifecycleState()]]) });
    const result = await run({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("acme/widget already holds a repository (id 101)");
  });

  it("refuses a personal account that is not the token's own", async () => {
    const lifecycle = world();
    const result = await run({ lifecycle, rest: ["--repo", "bystander/widget", "--create"] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain(
      "bystander is neither the token's own account (acme) nor an organisation",
    );
  });
});

describe("github repo --create apply", () => {
  it("creates once on the preview's digest and confirms the id and privacy by read-back", async () => {
    const lifecycle = world();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });
    const result = await run({
      door: door.port,
      lifecycle,
      rest: ["--repo", "acme/widget", "--create", "--approve", approve],
    });

    expect(result.code).toBe(0);
    expect(lifecycle.sent).toEqual(["create acme/widget private=true"]);
    expect(result.out).toEqual(["confirmed: created acme/widget (id 555, private)  https://github.com/acme/widget"]);
    expect(door.records().length).toBe(1);
  });

  it("creates in an organisation through the organisation's own endpoint", async () => {
    const lifecycle = world();
    const rest = ["--repo", "acme-labs/widget", "--create", "--public"];
    const approve = await previewDigest({ lifecycle, rest });
    const result = await run({ lifecycle, rest: [...rest, "--approve", approve] });

    expect(result.code).toBe(0);
    expect(lifecycle.sent).toEqual(["create acme-labs/widget private=false"]);
  });

  it("holds a digest for a different request at the door, so a private approval never creates a public one", async () => {
    const lifecycle = world();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });
    const result = await run({
      door: door.port,
      lifecycle,
      rest: ["--repo", "acme/widget", "--create", "--public", "--approve", approve],
    });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(door.text()).toContain("github.repo-write-unapproved");
  });

  it("refuses an approval whose address was taken after the preview, sending nothing", async () => {
    const lifecycle = world();
    const approve = await previewDigest({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });
    lifecycle.repos.set("acme/widget", lifecycleState({ id: 999 }));
    const result = await run({ lifecycle, rest: ["--repo", "acme/widget", "--create", "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("already holds a repository (id 999)");
  });

  it("reports a create GitHub refused, once, and never retries it", async () => {
    const lifecycle = world();
    const approve = await previewDigest({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });
    lifecycle.refuse = { error: githubHttpError({ status: 422 }), write: "create" };
    const result = await run({ lifecycle, rest: ["--repo", "acme/widget", "--create", "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual(["create acme/widget private=true"]);
    expect(result.diagnostic.join("\n")).toContain("create acme/widget");
  });

  it("reports an accepted create the read-back cannot find as unconfirmed", async () => {
    const lifecycle = world({ createLeavesNothing: true });
    const approve = await previewDigest({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });
    const result = await run({ lifecycle, rest: ["--repo", "acme/widget", "--create", "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual(["create acme/widget private=true"]);
    expect(result.diagnostic.join("\n")).toContain(
      "GitHub accepted creating acme/widget (id 555) but the read-back does not show that repository",
    );
  });

  it("never confirms a public create that reads back as internal", async () => {
    const lifecycle = world({ createVisibility: "internal" });
    const rest = ["--repo", "acme-labs/widget", "--create", "--public"];
    const approve = await previewDigest({ lifecycle, rest });
    const result = await run({ lifecycle, rest: [...rest, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual(["create acme-labs/widget private=false"]);
    expect(result.diagnostic.join("\n")).toContain(
      "GitHub accepted creating acme-labs/widget (id 555) but the read-back does not show that repository",
    );
  });

  it("carries a failed read-back's operation and status into the unconfirmed report", async () => {
    const lifecycle = world({
      readAfterWrite: errAsync({ ...githubHttpError({ status: 503 }), operation: "github.repos.get" }),
    });
    const approve = await previewDigest({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });
    const result = await run({ lifecycle, rest: ["--repo", "acme/widget", "--create", "--approve", approve] });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("GitHub said: read-back: github github.repos.get HTTP 503");
  });

  it("sends nothing when the door cannot record the write", async () => {
    const lifecycle = world();
    const approve = await previewDigest({ lifecycle, rest: ["--repo", "acme/widget", "--create"] });
    const result = await run({
      door: unreachableDoorLedger(),
      lifecycle,
      rest: ["--repo", "acme/widget", "--create", "--approve", approve],
    });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("not performed:");
  });
});
