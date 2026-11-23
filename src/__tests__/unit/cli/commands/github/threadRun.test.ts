import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type GithubThreadDeps, runGithubThread } from "../../../../../cli/commands/github/threadRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type {
  GithubThreadApi,
  ReviewThreadComments,
  ReviewThreadDetail,
} from "../../../../../outbound/github/threads.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { expectedHoldRefusal, withProfileHold } from "../../../../profileHoldFixture.js";

const PREFIX = ["node", "slopweaver", "github", "thread"];
const ADDRESS = ["--repo", "o/r", "--number", "7"];
const COMMENT_URL = "https://github.com/o/r/pull/7#discussion_r1";

const OPEN_THREAD: ReviewThreadDetail = {
  author: "coderabbitai",
  body: "Pin js-yaml to\n  3.15.2 / 4.3.2.",
  id: "PRRT_1",
  isResolved: false,
  line: 152,
  path: "yarn.lock",
};

const REVIEWER_OPENED: ReviewThreadComments = {
  comments: [{ author: "quinn", createdAt: "2026-09-28T03:00:00Z", url: "https://github.com/o/r/pull/7#r1" }],
  viewer: "octocat",
};

const ALREADY_ANSWERED: ReviewThreadComments = {
  comments: [
    ...REVIEWER_OPENED.comments,
    { author: "octocat", createdAt: "2026-09-28T05:31:00Z", url: "https://github.com/o/r/pull/7#r2" },
  ],
  viewer: "octocat",
};

/** A plain fake recording every answer it is asked to send, and every thread it is asked to read. */
function threadApi({
  threads,
  sent,
  thread = REVIEWER_OPENED,
  reads = [],
}: {
  threads: readonly ReviewThreadDetail[];
  sent: unknown[];
  thread?: ReviewThreadComments;
  reads?: string[];
}): GithubThreadApi {
  return {
    answer: ({ threadId, body, resolve }) => {
      sent.push({ body, resolve, threadId });
      return ResultAsync.fromSafePromise(
        Promise.resolve({ commentUrl: body === undefined ? undefined : COMMENT_URL, isResolved: resolve || undefined }),
      );
    },
    comments: ({ threadId }) => {
      reads.push(threadId);
      return ResultAsync.fromSafePromise(Promise.resolve(thread));
    },
    list: () => ResultAsync.fromSafePromise(Promise.resolve(threads)),
    pullRequestId: () => ResultAsync.fromSafePromise(Promise.resolve("PR_1")),
    reopen: ({ threadId }) => {
      sent.push({ reopen: threadId });
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
  };
}

function depsFor({
  door = memoryDoorLedger().port,
  home,
  threads,
  sent,
  out,
  diagnostic,
  stdin = "",
  thread = REVIEWER_OPENED,
  reads = [],
  hatchOpen = false,
}: {
  door?: DoorLedgerPort;
  home: string;
  threads: readonly ReviewThreadDetail[];
  sent: unknown[];
  out: string[];
  diagnostic: string[];
  stdin?: string;
  thread?: ReviewThreadComments;
  reads?: string[];
  hatchOpen?: boolean;
}): GithubThreadDeps {
  return {
    doorLedger: door,
    home: () => home,
    makeApi: () => threadApi({ reads, sent, thread, threads }),
    out: (line) => out.push(line),
    readStdin: () => Promise.resolve(stdin),
    repeatHatchOpen: () => hatchOpen,
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

describe("runGithubThread", () => {
  it("lists each thread as one scannable line, with the id the other sub-verbs address", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "list", ...ADDRESS],
      deps: depsFor({ diagnostic, home: "/unused", out, sent, threads: [OPEN_THREAD] }),
    });

    expect(code).toBe(0);
    expect(sent).toEqual([]);
    expect(out).toEqual(["OPEN  PRRT_1  yarn.lock:152  @coderabbitai  Pin js-yaml to 3.15.2 / 4.3.2."]);
    expect(diagnostic).toEqual([]);
  });

  it("lists only unresolved threads with --open, each followed by its whole opening comment with --full", async () => {
    const out: string[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "list", ...ADDRESS, "--open", "--full"],
      deps: depsFor({
        diagnostic: [],
        home: "/unused",
        out,
        sent: [],
        threads: [OPEN_THREAD, { ...OPEN_THREAD, id: "PRRT_2", isResolved: true }],
      }),
    });

    expect(code).toBe(0);
    expect(out).toEqual([
      "OPEN  PRRT_1  yarn.lock:152  @coderabbitai  Pin js-yaml to 3.15.2 / 4.3.2.",
      "    Pin js-yaml to",
      "      3.15.2 / 4.3.2.",
    ]);
  });

  it("says --open found nothing, rather than that the pull request has no threads", async () => {
    const out: string[] = [];
    await runGithubThread({
      argv: [...PREFIX, "list", ...ADDRESS, "--open"],
      deps: depsFor({
        diagnostic: [],
        home: "/unused",
        out,
        sent: [],
        threads: [{ ...OPEN_THREAD, isResolved: true }],
      }),
    });

    expect(out).toEqual(["no unresolved review threads on #7"]);
  });

  it("says so plainly when a pull request has no review threads", async () => {
    const out: string[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "list", ...ADDRESS],
      deps: depsFor({ diagnostic: [], home: "/unused", out, sent: [], threads: [] }),
    });

    expect(code).toBe(0);
    expect(out).toEqual(["no review threads on #7"]);
  });

  it("sends the reply and the resolution as one answer, through the door", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-reply-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "the age gate forbids it", "--resolve"],
      deps: depsFor({ diagnostic, home, out, sent, threads: [OPEN_THREAD] }),
    });

    expect(code).toBe(0);
    expect(sent).toEqual([{ body: "the age gate forbids it", resolve: true, threadId: "PRRT_1" }]);
    expect(out).toEqual([`answered and resolved  PRRT_1  ${COMMENT_URL}`]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a `-` body from stdin", async () => {
    const out: string[] = [];
    const sent: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-stdin-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "-"],
      deps: depsFor({ diagnostic: [], home, out, sent, stdin: "  piped body\n", threads: [OPEN_THREAD] }),
    });

    expect(code).toBe(0);
    expect(sent).toEqual([{ body: "piped body", resolve: false, threadId: "PRRT_1" }]);
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a `-` body when stdin is empty rather than posting a blank reply", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-empty-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "-"],
      deps: depsFor({ diagnostic, home, out: [], sent, stdin: "   \n", threads: [OPEN_THREAD] }),
    });

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(diagnostic).toEqual(["--body - was given but stdin was empty"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("dry-runs an answer and sends nothing", async () => {
    const out: string[] = [];
    const sent: unknown[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "x", "--resolve", "--dry-run"],
      deps: depsFor({ diagnostic: [], home: "/unused", out, sent, threads: [OPEN_THREAD] }),
    });

    expect(code).toBe(0);
    expect(sent).toEqual([]);
    expect(out).toEqual(["would reply and resolve  PRRT_1"]);
  });

  it("reports a provider failure rather than claiming the thread was answered", async () => {
    const diagnostic: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-fail-"));
    const deps: GithubThreadDeps = {
      ...depsFor({ diagnostic, home, out: [], sent: [], threads: [OPEN_THREAD] }),
      makeApi: () => ({
        answer: () => errAsync({ kind: "http", message: "GitHub said no", operation: "x" }),
        comments: () => ResultAsync.fromSafePromise(Promise.resolve(REVIEWER_OPENED)),
        list: () => ResultAsync.fromSafePromise(Promise.resolve([OPEN_THREAD])),
        pullRequestId: () => ResultAsync.fromSafePromise(Promise.resolve("PR_1")),
        reopen: () => errAsync({ kind: "http", message: "GitHub said no", operation: "x" }),
      }),
    };
    const code = await runGithubThread({
      argv: [...PREFIX, "resolve", ...ADDRESS, "--thread", "PRRT_1"],
      deps,
    });

    expect(code).toBe(1);
    expect(diagnostic).toEqual(["GitHub said no"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("prints the door's whole refusal — finding, correction, way through — never the bare verdict", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-held-"));
    const { decision, result } = await withProfileHold({
      home,
      run: () =>
        runGithubThread({
          argv: [...PREFIX, "resolve", ...ADDRESS, "--thread", "PRRT_1"],
          deps: depsFor({ diagnostic, home, out: [], sent, threads: [OPEN_THREAD] }),
        }),
    });

    expect(result).toBe(1);
    expect(sent).toEqual([]);
    expect(decision.findings.map((finding) => finding.code)).toEqual(["PROFILE_NOT_LOADED"]);
    expect(diagnostic).toEqual(expectedHoldRefusal({ command: "slopweaver github thread resolve", decision }));
    rmSync(home, { force: true, recursive: true });
  });

  it("sends nothing when the door cannot record the resolution", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-down-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "resolve", ...ADDRESS, "--thread", "PRRT_1"],
      deps: depsFor({
        diagnostic,
        door: unreachableDoorLedger(),
        home,
        out: [],
        sent,
        threads: [OPEN_THREAD],
      }),
    });

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
    rmSync(home, { force: true, recursive: true });
  });

  it("reopens one resolved thread through the door, sending no answer", async () => {
    const out: string[] = [];
    const sent: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-reopen-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "reopen", ...ADDRESS, "--thread", "PRRT_1"],
      deps: depsFor({ diagnostic: [], home, out, sent, threads: [{ ...OPEN_THREAD, isResolved: true }] }),
    });

    expect(code).toBe(0);
    expect(sent).toEqual([{ reopen: "PRRT_1" }]);
    expect(out).toEqual(["reopened  PRRT_1"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a body or --resolve on reopen without touching the network", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "reopen", ...ADDRESS, "--thread", "PRRT_1", "--body", "x", "--resolve"],
      deps: depsFor({ diagnostic, home: "/unused", out: [], sent, threads: [] }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(sent).toEqual([]);
    expect(diagnostic.slice(0, 2)).toEqual(["--body is not a `reopen` flag", "--resolve is not a `reopen` flag"]);
  });

  it("reports a usage error for a missing --thread without touching the network", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "resolve", ...ADDRESS],
      deps: depsFor({ diagnostic, home: "/unused", out: [], sent, threads: [] }),
    });

    expect(code).toBe(2);
    expect(sent).toEqual([]);
    expect(diagnostic[0]).toBe("--thread <id> is required");
  });

  it("refuses an unrecognised sub-verb without touching the network", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "delete", ...ADDRESS],
      deps: depsFor({ diagnostic, home: "/unused", out: [], sent, threads: [] }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(sent).toEqual([]);
    expect(diagnostic[0]).toBe("usage: slopweaver github thread <list|reply|resolve|reopen> [...]");
  });

  it("reads the thread before replying, and refuses when this identity already answered since the reviewer", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const reads: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-repeat-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "reworded again", "--resolve"],
      deps: depsFor({ diagnostic, home, out: [], reads, sent, thread: ALREADY_ANSWERED, threads: [] }),
    });

    expect(code).toBe(1);
    expect(reads).toEqual(["PRRT_1"]);
    expect(sent).toEqual([]);
    expect(diagnostic).toHaveLength(1);
    expect(diagnostic[0]!.split("\n")[0]).toBe(
      "slopweaver github thread reply blocked because this identity already replied in this review thread since " +
        "anybody else last commented, so the next word is the reviewer's — or the thread could not be read to " +
        "check (@octocat already replied in thread PRRT_1 at 2026-09-28T05:31:00Z, and nobody has " +
        "commented since: https://github.com/o/r/pull/7#r2).",
    );
    expect(diagnostic[0]).toContain("slopweaver hatch open repeat-thread-reply --reason");
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a dry-run reply the same way, so a planned repeat says so before anything is sent", async () => {
    const diagnostic: string[] = [];
    const out: string[] = [];
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "x", "--dry-run"],
      deps: depsFor({ diagnostic, home: "/unused", out, sent: [], thread: ALREADY_ANSWERED, threads: [] }),
    });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(diagnostic[0]).toContain("https://github.com/o/r/pull/7#r2");
  });

  it("fails closed when the thread cannot be read, sending nothing", async () => {
    const diagnostic: string[] = [];
    const sent: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-unread-"));
    const base = depsFor({ diagnostic, home, out: [], sent, threads: [] });
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "x"],
      deps: {
        ...base,
        makeApi: () => ({
          ...threadApi({ sent, threads: [] }),
          comments: () => errAsync({ kind: "http", message: "GitHub timed out", operation: "x" }),
        }),
      },
    });

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(diagnostic[0]!.split("\n")[0]).toContain(
      "(thread PRRT_1 could not be read to check for an earlier reply: GitHub timed out).",
    );
    rmSync(home, { force: true, recursive: true });
  });

  it("sends without reading the thread when the repeat-thread-reply hatch is open", async () => {
    const sent: unknown[] = [];
    const reads: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-hatch-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "reply", ...ADDRESS, "--thread", "PRRT_1", "--body", "deliberate"],
      deps: depsFor({
        diagnostic: [],
        hatchOpen: true,
        home,
        out: [],
        reads,
        sent,
        thread: ALREADY_ANSWERED,
        threads: [],
      }),
    });

    expect(code).toBe(0);
    expect(reads).toEqual([]);
    expect(sent).toEqual([{ body: "deliberate", resolve: false, threadId: "PRRT_1" }]);
    rmSync(home, { force: true, recursive: true });
  });

  it("never reads the thread for a bare resolve, which adds no words to it", async () => {
    const sent: unknown[] = [];
    const reads: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-thread-resolve-"));
    const code = await runGithubThread({
      argv: [...PREFIX, "resolve", ...ADDRESS, "--thread", "PRRT_1"],
      deps: depsFor({ diagnostic: [], home, out: [], reads, sent, thread: ALREADY_ANSWERED, threads: [] }),
    });

    expect(code).toBe(0);
    expect(reads).toEqual([]);
    expect(sent).toEqual([{ body: undefined, resolve: true, threadId: "PRRT_1" }]);
    rmSync(home, { force: true, recursive: true });
  });
});
