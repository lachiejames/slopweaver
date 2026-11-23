import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { writePushRootBinding } from "../../../../../admit/pushRootStore.js";
import { runGithubRepo } from "../../../../../cli/commands/github/repoRun.js";
import { SET_PUBLIC_CONSEQUENCES } from "../../../../../cli/commands/github/repoVisibilityRun.js";
import { writeFreshCutRecord, writeFreshCutVerification } from "../../../../../freshCut/store.js";
import { unwrap } from "../../../../../lib/result.js";
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

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-visibility-"));
  homes.push(home);
  return home;
}

/** Run one `github repo` invocation over a world. */
async function run({
  rest,
  lifecycle,
  door = memoryDoorLedger().port,
  home = freshHome(),
}: {
  rest: readonly string[];
  lifecycle: LifecycleWorld;
  door?: DoorLedgerPort;
  home?: string;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
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

const RECORD_ID = "0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const ROOT = "a".repeat(40);

/** A home binding `acme/widget` to {@link ROOT}, with its cut recorded unless `recorded` is false. */
function recutHome({ recorded = true }: { recorded?: boolean } = {}): string {
  const home = freshHome();
  unwrap(
    writePushRootBinding({
      binding: { recordedAtIso: "2026-11-23T10:05:00.000Z", repository: "acme/widget", rootSha: ROOT },
      home,
    }),
  );
  if (recorded) {
    unwrap(
      writeFreshCutRecord({
        home,
        record: {
          destination: "/cut/acme-widget",
          login: "acme",
          producedAtIso: "2026-11-23T10:00:00.000Z",
          recordId: RECORD_ID,
          rootSha: ROOT,
          schemaVersion: 1,
          source: "/checkout/acme-widget",
          sourceCommitterDate: "1763892000 +0000",
          sourceSha: "d".repeat(40),
          treeSha: "b".repeat(40),
        },
      }),
    );
  }
  return home;
}

/** Write one verification of the cut, as `fresh-cut verify` would. */
function verified({ home, status, at }: { home: string; status: "clear" | "refused"; at: string }): void {
  unwrap(
    writeFreshCutVerification({
      home,
      verification: {
        destinationTreeSha: "b".repeat(40),
        exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
        filesScanned: 3,
        // A real verify refuses exactly when something is left found.
        findings: status === "refused" ? [{ kind: "hygiene", label: "token", line: 1, path: "a.ts" }] : [],
        recordId: RECORD_ID,
        reviewedAccepted: 0,
        reviewedResidueSha256: "e".repeat(64),
        schemaVersion: 2,
        sourceTreeSha: "b".repeat(40),
        status,
        verifiedAtIso: at,
      },
    }),
  );
}

describe("github repo --set-public on a re-cut repository", () => {
  it("previews it once the latest verification of its cut reads clear", async () => {
    const home = recutHome();
    verified({ at: "2026-11-23T11:00:00.000Z", home, status: "refused" });
    verified({ at: "2026-11-23T12:00:00.000Z", home, status: "clear" });
    const result = await run({ home, lifecycle: world(), rest: REST });

    expect(result.code).toBe(0);
    expect(result.out[0]).toBe("preview: make acme/widget (id 101, private) public");
  });

  it("refuses it while the latest verification of its cut refused", async () => {
    const home = recutHome();
    verified({ at: "2026-11-23T11:00:00.000Z", home, status: "clear" });
    verified({ at: "2026-11-23T12:00:00.000Z", home, status: "refused" });
    const lifecycle = world();
    const result = await run({ home, lifecycle, rest: REST });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(result.diagnostic).toEqual([
      `acme/widget stays private: the latest fresh-cut verify of cut ${RECORD_ID} (2026-11-23T12:00:00.000Z) ` +
        "refused. A re-cut repository goes public only once the latest fresh-cut verify of its cut reads clear",
    ]);
  });

  it("refuses at the send when a refused verification lands while the door admits the approved write", async () => {
    const home = recutHome();
    verified({ at: "2026-11-23T12:00:00.000Z", home, status: "clear" });
    const lifecycle = world();
    const approve = (
      JSON.parse((await run({ home, lifecycle, rest: [...REST, "--json"] })).out[0]!) as { digest: string }
    ).digest;
    const memory = memoryDoorLedger();
    const door: DoorLedgerPort = {
      ...memory.port,
      appendDecision: (request) => {
        verified({ at: "2026-11-23T13:00:00.000Z", home, status: "refused" });
        return memory.port.appendDecision(request);
      },
    };
    const result = await run({ door, home, lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(lifecycle.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain(
      `the latest fresh-cut verify of cut ${RECORD_ID} (2026-11-23T13:00:00.000Z) refused`,
    );
  });

  it("refuses it when its cut was never verified", async () => {
    const result = await run({ home: recutHome(), lifecycle: world(), rest: REST });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain(`its cut ${RECORD_ID} has never been verified`);
  });

  it("refuses it when no cut record carries its bound root", async () => {
    const result = await run({ home: recutHome({ recorded: false }), lifecycle: world(), rest: REST });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("no fresh-cut record carries that root");
  });
});

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
