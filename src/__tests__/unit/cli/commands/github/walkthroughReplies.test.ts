/**
 * The walkthrough step's reply guard helpers: every reopen that went through is recorded as surfaced, one that
 * did not is named with the exact command that reopens it, and an unanswered reply is printed with its answer.
 */
import { describe, expect, it } from "vitest";

import {
  answerLines,
  releaseUntaken,
  reopenClause,
  type StepRun,
  threadArgv,
} from "../../../../../cli/commands/github/walkthroughReplies.js";
import type { WalkthroughAct } from "../../../../../outbound/github/walkthroughLedger.js";
import { walkthroughDeps, walkthroughThread } from "../../../../walkthroughFake.js";

/** A run over `acme/widget#9` whose reopen fails for `failing`, and whose register writes land in `memory`. */
function runWith({
  failing,
  memory,
  registerFails,
}: {
  failing: readonly string[];
  memory: WalkthroughAct[];
  registerFails?: string;
}): StepRun {
  const deps = walkthroughDeps({
    memory,
    read: undefined,
    writes: { ledger: [], resolved: [] },
    ...(registerFails === undefined ? {} : { registerFails }),
  });
  return {
    deps: {
      ...deps,
      reopenThread: ({ rest }) => Promise.resolve(failing.includes(rest[rest.indexOf("--thread") + 1]!) ? 1 : 0),
    },
    home: "/h",
    target: { headOid: "cafe1234", number: 9, owner: "acme", repo: "widget", url: "https://example.invalid/pr/9" },
    verb: "github enqueue",
    write: () => undefined,
  };
}

describe("reopenClause", () => {
  it("records each reopened thread as surfaced at the reply it reopened over, and names the one that would not", async () => {
    const memory: WalkthroughAct[] = [];

    const clause = await reopenClause({
      run: runWith({ failing: ["PRRT_b"], memory }),
      threads: [
        walkthroughThread({ id: "PRRT_a", lastCommentAtIso: "2026-09-28T04:30:00.000Z" }),
        walkthroughThread({ id: "PRRT_b" }),
      ],
    });

    expect(memory).toEqual([
      { kind: "surfaced", replyAtIso: "2026-09-28T04:30:00.000Z", replyCount: 1, threadId: "PRRT_a" },
    ]);
    expect(clause).toBe(
      "1 could not be reopened, and the next landing reopens them first: " +
        "`slopweaver github thread reopen --repo acme/widget --number 9 --thread PRRT_b --home /h`",
    );
  });

  /** A printed recovery must run as printed, in the landing's own home. */
  it("quotes a home whose path would split on the shell in the command for a reopen that would not go", async () => {
    const clause = await reopenClause({
      run: { ...runWith({ failing: ["PRRT_b"], memory: [] }), home: "/Users/owner/state home's" },
      threads: [walkthroughThread({ id: "PRRT_b" })],
    });

    expect(clause).toBe(
      "1 could not be reopened, and the next landing reopens them first: " +
        "`slopweaver github thread reopen --repo acme/widget --number 9 --thread PRRT_b --home '/Users/owner/state home'\\''s'`",
    );
  });

  it("says when the register could not record a reopen that went through", async () => {
    const clause = await reopenClause({
      run: runWith({ failing: [], memory: [], registerFails: "disk full" }),
      threads: [walkthroughThread({ id: "PRRT_a" })],
    });

    expect(clause).toBe(
      "reopened, so the reply reads open again (the register could not record the reopen: disk full)",
    );
  });
});

/** A `resolving` row for a resolve that never took is false memory of the owner's later one. */
describe("releaseUntaken", () => {
  const threads = [
    walkthroughThread({ id: "PRRT_open" }),
    walkthroughThread({ id: "PRRT_took", isResolved: true, resolvedByLogin: "owner-login" }),
  ];

  it("releases only the threads the read shows still open, keeping a missing or resolved one remembered", () => {
    const memory: WalkthroughAct[] = [];

    const clause = releaseUntaken({
      run: runWith({ failing: [], memory }),
      threadIds: ["PRRT_open", "PRRT_took", "PRRT_missing"],
      threads,
    });

    expect(memory).toEqual([{ kind: "released", threadId: "PRRT_open" }]);
    expect(clause).toBe("");
  });

  it("releases nothing when the read failed, since the resolve may have taken", () => {
    const memory: WalkthroughAct[] = [];

    const clause = releaseUntaken({
      run: runWith({ failing: [], memory }),
      threadIds: ["PRRT_open"],
      threads: undefined,
    });

    expect(memory).toEqual([]);
    expect(clause).toBe("");
  });

  it("says when the register could not record the release", () => {
    const clause = releaseUntaken({
      run: runWith({ failing: [], memory: [], registerFails: "disk full" }),
      threadIds: ["PRRT_open"],
      threads,
    });

    expect(clause).toBe(" (the register could not record which resolves did not take: disk full)");
  });
});

/** The refusal must itself show the reply it refuses on, and answer it in the landing's home. */
describe("answerLines", () => {
  it("quotes every line of the colleague's reply beneath where it sits, then the answer in the landing's home", () => {
    const lines = answerLines({
      run: runWith({ failing: [], memory: [] }),
      thread: walkthroughThread({
        id: "PRRT_a",
        lastCommentBody: "why this order?\nthe old one was fine\n",
        lastCommentLogin: "teammate",
        line: 40,
        path: "src/x.ts",
      }),
    });

    expect(lines).toEqual([
      "  PRRT_a on src/x.ts:40, teammate replied:",
      "    > why this order?",
      "    > the old one was fine",
      "    answer: `slopweaver github thread reply --repo acme/widget --number 9 --thread PRRT_a --home /h --body - --resolve`",
    ]);
  });

  it("quotes a home with a space in the answer, so it runs in the landing's own home as printed", () => {
    const lines = answerLines({
      run: { ...runWith({ failing: [], memory: [] }), home: "/Users/owner/state home" },
      thread: walkthroughThread({ id: "PRRT_a", lastCommentBody: "ok?", lastCommentLogin: "teammate" }),
    });

    expect(lines.at(-1)).toBe(
      "    answer: `slopweaver github thread reply --repo acme/widget --number 9 --thread PRRT_a " +
        "--home '/Users/owner/state home' --body - --resolve`",
    );
  });

  it("names a file-level thread by its path alone, and says so when the read carried no text", () => {
    const lines = answerLines({
      run: runWith({ failing: [], memory: [] }),
      thread: walkthroughThread({
        id: "PRRT_b",
        lastCommentBody: "",
        lastCommentLogin: "teammate",
        line: 0,
        path: "README.md",
      }),
    });

    expect(lines.slice(0, 2)).toEqual([
      "  PRRT_b on README.md, teammate replied:",
      "    (this read carried no text for it)",
    ]);
  });
});

describe("threadArgv", () => {
  it("addresses one thread on the target, in the run's home", () => {
    expect(threadArgv({ run: runWith({ failing: [], memory: [] }), threadId: "PRRT_a" })).toEqual([
      "--repo",
      "acme/widget",
      "--number",
      "9",
      "--thread",
      "PRRT_a",
      "--home",
      "/h",
    ]);
  });
});
