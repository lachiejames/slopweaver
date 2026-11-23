import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type GithubCommentDeps, runGithubComment } from "../../../../../cli/commands/github/commentRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubCommentApi, WrittenComment } from "../../../../../outbound/github/comments.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const PREFIX = ["node", "slopweaver", "github", "comment"];
const CREATE_ADDRESS = ["--repo", "o/r", "--number", "7"];
const EDIT_ADDRESS = ["--repo", "o/r", "--comment-id", "9"];
const FORM = '{"summary":[{"kind":"text","text":"please re-review this pull request"}]}';
const WRITTEN: WrittenComment = {
  body: "please re-review this pull request",
  htmlUrl: "https://github.com/o/r/pull/7#issuecomment-1",
  id: 1,
};

/** A plain fake recording every create/edit call it is asked to make. */
function commentApi({ calls, written }: { calls: unknown[]; written: WrittenComment }): GithubCommentApi {
  return {
    create: (args) => {
      calls.push({ kind: "create", ...args });
      return ResultAsync.fromSafePromise(Promise.resolve(written));
    },
    edit: (args) => {
      calls.push({ kind: "edit", ...args });
      return ResultAsync.fromSafePromise(Promise.resolve(written));
    },
    read: () => ResultAsync.fromSafePromise(Promise.resolve(written)),
  };
}

function depsFor({
  door = memoryDoorLedger().port,
  home,
  calls,
  written,
  out,
  diagnostic,
  stdin = "",
}: {
  door?: DoorLedgerPort;
  home: string;
  calls: unknown[];
  written: WrittenComment;
  out: string[];
  diagnostic: string[];
  stdin?: string;
}): GithubCommentDeps {
  return {
    doorLedger: door,
    env: () => undefined,
    home: () => home,
    makeApi: () => commentApi({ calls, written }),
    out: (line) => out.push(line),
    readStdin: () => Promise.resolve(stdin),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

describe("runGithubComment", () => {
  it("posts a new comment through the door and confirms it by read-back", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-comment-create-"));
    const code = await runGithubComment({
      argv: [...PREFIX, "create", ...CREATE_ADDRESS, "--form", FORM],
      deps: depsFor({ calls, diagnostic, home, out, written: WRITTEN }),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { body: "please re-review this pull request", kind: "create", number: 7, owner: "o", repo: "r" },
    ]);
    expect(out).toEqual([`posted  1  ${WRITTEN.htmlUrl}`]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("edits an existing comment by id", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-comment-edit-"));
    const code = await runGithubComment({
      argv: [...PREFIX, "edit", ...EDIT_ADDRESS, "--form", FORM],
      deps: depsFor({ calls, diagnostic, home, out, written: WRITTEN }),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { body: "please re-review this pull request", commentId: 9, kind: "edit", owner: "o", repo: "r" },
    ]);
    expect(out).toEqual([`edited  1  ${WRITTEN.htmlUrl}`]);
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a `-` form from stdin", async () => {
    const calls: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-comment-stdin-"));
    const code = await runGithubComment({
      argv: [...PREFIX, "create", ...CREATE_ADDRESS, "--form", "-"],
      deps: depsFor({ calls, diagnostic: [], home, out: [], stdin: FORM, written: WRITTEN }),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { body: "please re-review this pull request", kind: "create", number: 7, owner: "o", repo: "r" },
    ]);
    rmSync(home, { force: true, recursive: true });
  });

  it("dry-runs and sends nothing", async () => {
    const out: string[] = [];
    const calls: unknown[] = [];
    const code = await runGithubComment({
      argv: [...PREFIX, "create", ...CREATE_ADDRESS, "--form", FORM, "--dry-run"],
      deps: depsFor({ calls, diagnostic: [], home: "/unused", out, written: WRITTEN }),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out[0]).toBe("would create: o/r#7");
    expect(out).toContain("please re-review this pull request");
  });

  it("reports a provider failure rather than claiming the comment was posted", async () => {
    const diagnostic: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-comment-fail-"));
    const deps: GithubCommentDeps = {
      ...depsFor({ calls: [], diagnostic, home, out: [], written: WRITTEN }),
      makeApi: () => ({
        create: () => errAsync({ kind: "http", message: "GitHub said no", operation: "x" }),
        edit: () => errAsync({ kind: "http", message: "GitHub said no", operation: "x" }),
        read: () => ResultAsync.fromSafePromise(Promise.resolve(WRITTEN)),
      }),
    };
    const code = await runGithubComment({
      argv: [...PREFIX, "create", ...CREATE_ADDRESS, "--form", FORM],
      deps,
    });

    expect(code).toBe(1);
    expect(diagnostic).toEqual(["GitHub said no"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("posts nothing when the door cannot record the comment", async () => {
    const diagnostic: string[] = [];
    const calls: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-comment-down-"));
    const code = await runGithubComment({
      argv: [...PREFIX, "create", ...CREATE_ADDRESS, "--form", FORM],
      deps: depsFor({ calls, diagnostic, door: unreachableDoorLedger(), home, out: [], written: WRITTEN }),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
    rmSync(home, { force: true, recursive: true });
  });

  it("reports a usage error for a missing --repo without touching the network", async () => {
    const diagnostic: string[] = [];
    const calls: unknown[] = [];
    const code = await runGithubComment({
      argv: [...PREFIX, "create", "--number", "7", "--form", FORM],
      deps: depsFor({ calls, diagnostic, home: "/unused", out: [], written: WRITTEN }),
    });

    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(diagnostic[0]).toBe("--repo owner/name is required");
  });

  it("refuses an unrecognised sub-verb without touching the network", async () => {
    const diagnostic: string[] = [];
    const calls: unknown[] = [];
    const code = await runGithubComment({
      argv: ["node", "slopweaver", "github", "comment", "delete", ...CREATE_ADDRESS],
      deps: depsFor({ calls, diagnostic, home: "/unused", out: [], written: WRITTEN }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(calls).toEqual([]);
    expect(diagnostic[0]).toBe("usage: slopweaver github comment <create|edit> [...]");
  });

  it("refuses an invalid form before resolving a credential", async () => {
    const diagnostic: string[] = [];
    const calls: unknown[] = [];
    const code = await runGithubComment({
      argv: [...PREFIX, "create", ...CREATE_ADDRESS, "--form", "{}"],
      deps: depsFor({ calls, diagnostic, home: "/unused", out: [], written: WRITTEN }),
    });

    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(diagnostic.length).toBeGreaterThan(0);
  });
});
