import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import {
  type GithubReviewDraftDeps,
  REVIEW_DRAFT_LOCK_KEY,
} from "../../../../../cli/commands/github/reviewDraftDeps.js";
import { runReviewDraftPost } from "../../../../../cli/commands/github/reviewDraftPost.js";
import { runReviewDraftRecord } from "../../../../../cli/commands/github/reviewDraftRecord.js";
import { runGithubReviewDraft } from "../../../../../cli/commands/github/reviewDraftRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { PullRequestDiffFile } from "../../../../../corpus/github/write.js";
import type { ExistingReview, PostedReview, ReviewTarget } from "../../../../../corpus/github/writeReviewDraft.js";
import { err, ok } from "../../../../../lib/result.js";
import { type ReviewDraftEvent, reviewDraftEventLine } from "../../../../../outbound/github/reviewDraft.js";
import type { GithubReviewDraftApi } from "../../../../../outbound/github/reviewDraftApi.js";
import { ReviewDraftErrors } from "../../../../../outbound/github/reviewDraftErrors.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const PREFIX = ["node", "slopweaver", "github", "review-draft"];
const HEAD = "d5e7b95cb463f00d54be6f14430afc6648deb99b";
const VIEWER = 1;
const AUTHOR = 2;
const REVIEW_URL = "https://github.com/o/r/pull/7#pullrequestreview-99";

const PATCH = ["@@ -1,3 +1,4 @@", " one", " two", "+three", " four"].join("\n");

const OPEN_TARGET: ReviewTarget = {
  authorId: AUTHOR,
  authorLogin: "colleague",
  headSha: HEAD,
  merged: false,
  state: "open",
  title: "A colleague's change",
  url: "https://github.com/o/r/pull/7",
};

const FORM = JSON.stringify({
  body: "I think this is close; one thing inline.",
  comments: [{ body: "maybe guard the empty case here", line: 3, path: "src/a.ts" }],
  deeperReview: "the staging suites were not run",
  verdict: "COMMENT",
});

/** What the fake GitHub was asked to do. */
interface Calls {
  created: unknown[];
}

/** A world the verb runs in: a fake GitHub, an in-memory register, and captured output. */
interface World {
  readonly deps: GithubReviewDraftDeps;
  readonly calls: Calls;
  readonly events: ReviewDraftEvent[];
  readonly out: string[];
  readonly diagnostic: string[];
}

/** The review the fake GitHub reports for a post. */
const POSTED: PostedReview = { commitId: HEAD, reviewId: 99, state: "COMMENTED", url: REVIEW_URL };

function world({
  target = OPEN_TARGET,
  files = [{ patch: PATCH, path: "src/a.ts" }],
  appendFailsAfter,
  readBack = POSTED,
  door = memoryDoorLedger(),
}: {
  door?: MemoryDoorLedger;
  target?: ReviewTarget;
  files?: readonly PullRequestDiffFile[];
  /** Fail every append once this many have landed. */
  appendFailsAfter?: number;
  readBack?: PostedReview;
}): World {
  const calls: Calls = { created: [] };
  const events: ReviewDraftEvent[] = [];
  const out: string[] = [];
  const diagnostic: string[] = [];
  const onGitHub: ExistingReview[] = [];
  const api: GithubReviewDraftApi = {
    createReview: (input) => {
      calls.created.push(input);
      onGitHub.push({ ...POSTED, authorId: VIEWER, body: input.body, commitId: input.commitId });
      return okAsync(POSTED);
    },
    diffFiles: () => okAsync(files),
    readReview: () => okAsync(readBack),
    reviews: () => okAsync(onGitHub),
    target: () => okAsync(target),
    viewerId: () => okAsync(VIEWER),
  };
  let ids = 0;
  const deps: GithubReviewDraftDeps = {
    appendEvent: ({ event }) => {
      if (appendFailsAfter !== undefined && events.length >= appendFailsAfter) {
        return err(ReviewDraftErrors.writeFailed({ cause: new Error("disk full"), path: "register" }));
      }
      events.push(event);
      return ok(true);
    },
    consoleBase: () => "http://localhost:3000",
    doorEnv: () => ({}),
    doorLedger: door.port,
    exactVoiceRules: () => ok([{ kind: "word", value: "delve" }]),
    makeApi: () => api,
    mintId: () => {
      ids += 1;
      return `rd-${String(ids).padStart(8, "0")}`;
    },
    nowIso: () => "2026-09-28T10:00:00.000Z",
    out: (line) => out.push(line),
    readLog: () => ok(events.map((event) => reviewDraftEventLine({ event }))),
    readStdin: () => Promise.resolve(FORM),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
  return { calls, deps, diagnostic, events, out };
}

async function run({ w, args, home }: { w: World; args: readonly string[]; home: string }): Promise<number> {
  return runGithubReviewDraft({ argv: [...PREFIX, ...args], defaultHome: home, deps: w.deps });
}

const RECORD = ["record", "--repo", "o/r", "--number", "7", "--form", FORM, "--why", "a colleague's pull request"];

/** Record one draft and return its id and digest, as the card would hand them out. */
async function recorded({ w, home }: { w: World; home: string }): Promise<{ id: string; digest: string }> {
  expect(await run({ args: [...RECORD, "--json"], home, w })).toBe(EXIT_OK);
  const printed = JSON.parse(w.out.at(-1)!) as { id: string; digest: string };
  return { digest: printed.digest, id: printed.id };
}

describe("github review-draft", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "review-draft-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("records a review with the hunk under each comment and a console link, sending nothing to GitHub", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });

    expect(w.calls.created).toEqual([]);
    expect(w.events).toHaveLength(1);
    const [event] = w.events;
    expect(event?.kind).toBe("parked");
    if (event?.kind !== "parked") {
      return;
    }
    expect(event.draft.comments[0]?.hunk.map((line) => line.text)).toEqual(["@@ -1,3 +1,4 @@", "one", "two", "three"]);
    expect(event.draft.author).toBe("colleague");
    expect(event.draft.deeperReview).toBe("the staging suites were not run");
    expect(JSON.parse(w.out.at(-1)!)).toEqual({
      consoleUrl: `http://localhost:3000/queue?open=review%3A${id}`,
      digest,
      id,
      post: { command: `slopweaver github review-draft post ${id} --approve ${digest}` },
    });
  });

  it("refuses to park a review of the owner's own pull request", async () => {
    const w = world({ target: { ...OPEN_TARGET, authorId: VIEWER } });

    expect(await run({ args: RECORD, home, w })).toBe(EXIT_ERROR);
    expect(w.events).toEqual([]);
    expect(w.diagnostic.join("\n")).toContain("the token's own pull request");
  });

  it("refuses to park a comment GitHub could not anchor, naming it", async () => {
    const w = world({ files: [{ patch: PATCH, path: "src/other.ts" }] });

    expect(await run({ args: RECORD, home, w })).toBe(EXIT_USAGE);
    expect(w.events).toEqual([]);
    expect(w.diagnostic.join("\n")).toContain("src/a.ts:3: the pull request does not change src/a.ts");
  });

  it("refuses a comment that breaks the owner's exact voice rules, before reading GitHub", async () => {
    const w = world({});
    const form = JSON.stringify({
      body: "fine",
      comments: [{ body: "let us delve into this", line: 3, path: "src/a.ts" }],
      verdict: "COMMENT",
    });

    expect(await run({ args: [...RECORD.slice(0, 5), "--form", form, "--why", "x"], home, w })).toBe(EXIT_USAGE);
    expect(w.events).toEqual([]);
    expect(w.diagnostic.join("\n")).toContain("comments[0].body");
  });

  it("HOLDS a post with no approval, posting nothing and naming the command the owner's yes becomes", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });

    expect(await run({ args: ["post", id], home, w })).toBe(EXIT_ERROR);
    expect(w.calls.created).toEqual([]);
    expect(w.events.map((event) => event.kind)).toEqual(["parked"]);
    expect(w.diagnostic.join("\n")).toContain(`--approve ${digest}`);
  });

  it("HOLDS a post whose approval names different content", async () => {
    const w = world({});
    const { id } = await recorded({ home, w });

    expect(await run({ args: ["post", id, "--approve", "0".repeat(32)], home, w })).toBe(EXIT_ERROR);
    expect(w.calls.created).toEqual([]);
  });

  it("refuses a post once the head has moved, even with the right approval", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const moved = world({ target: { ...OPEN_TARGET, headSha: "e".repeat(40) } });
    moved.events.push(...w.events);

    expect(await run({ args: ["post", id, "--approve", digest], home, w: moved })).toBe(EXIT_ERROR);
    expect(moved.calls.created).toEqual([]);
    expect(moved.diagnostic.join("\n")).toContain("head moved");
  });

  it("refuses a post whose recorded content was edited after the card showed it", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const [event] = w.events;
    if (event?.kind !== "parked") {
      throw new Error("expected a parked event");
    }
    w.events[0] = { ...event, draft: { ...event.draft, body: "edited under the owner" } };

    expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_ERROR);
    expect(w.calls.created).toEqual([]);
  });

  it("posts once on the exact approval, pinned to the approved head, and records it spent", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });

    expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_OK);
    expect(w.calls.created).toHaveLength(1);
    expect(w.calls.created[0]).toMatchObject({ commitId: HEAD, event: "COMMENT", number: 7, owner: "o", repo: "r" });
    expect(w.events.map((event) => event.kind)).toEqual(["parked", "posted"]);
    expect(w.out.at(-1)).toContain(REVIEW_URL);

    expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_EXPECTED_EMPTY);
    expect(w.calls.created).toHaveLength(1);
  });

  it("sends once when two posts of one row overlap: the second meets the register's lock", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const post = (): Promise<number> => run({ args: ["post", id, "--approve", digest], home, w });

    const codes = await Promise.all([post(), post()]);

    expect(codes.toSorted((left, right) => left - right)).toEqual(
      [EXIT_OK, EXIT_ERROR].toSorted((left, right) => left - right),
    );
    expect(w.calls.created).toHaveLength(1);
    expect(w.diagnostic.join("\n")).toContain("Another review-draft write is running");
  });

  it("refuses a post while any register line is unreadable, since it may be this row already posted", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const deps: GithubReviewDraftDeps = {
      ...w.deps,
      readLog: () => ok([...w.events.map((event) => reviewDraftEventLine({ event })), '{"kind":"posted"']),
    };

    expect(
      await runGithubReviewDraft({ argv: [...PREFIX, "post", id, "--approve", digest], defaultHome: home, deps }),
    ).toBe(EXIT_ERROR);
    expect(w.calls.created).toEqual([]);
    expect(w.diagnostic.join("\n")).toContain("may record");
  });

  it("refuses to park under an id the register already holds", async () => {
    const w = world({});
    const { id } = await recorded({ home, w });
    const deps: GithubReviewDraftDeps = { ...w.deps, mintId: () => id };

    expect(await runGithubReviewDraft({ argv: [...PREFIX, ...RECORD], defaultHome: home, deps })).toBe(EXIT_ERROR);
    expect(w.events).toHaveLength(1);
    expect(w.diagnostic.join("\n")).toContain(`the minted id ${id} is already in the register`);
  });

  it("says loudly, and exits non-zero, when the review posted but could not be recorded spent", async () => {
    const w = world({ appendFailsAfter: 1 });
    const { id, digest } = await recorded({ home, w });

    expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_ERROR);
    expect(w.calls.created).toHaveLength(1);
    expect(w.diagnostic.join("\n")).toContain(`POSTED ${REVIEW_URL}`);
    expect(w.diagnostic.join("\n")).toContain(`review-draft drop ${id}`);

    expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_ERROR);
    expect(w.calls.created).toHaveLength(1);
    expect(w.diagnostic.join("\n")).toContain(`already posted this review as ${REVIEW_URL}`);
  });

  it("refuses a second send when GitHub saved the review but its answer was lost", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const api = w.deps.makeApi({ home, token: "token" });
    const lossy: GithubReviewDraftDeps = {
      ...w.deps,
      makeApi: () => ({
        ...api,
        createReview: (input) =>
          api
            .createReview(input)
            .andThen(() => errAsync({ kind: "network" as const, message: "socket hang up", operation: "x" })),
      }),
    };

    expect(
      await runGithubReviewDraft({
        argv: [...PREFIX, "post", id, "--approve", digest],
        defaultHome: home,
        deps: lossy,
      }),
    ).toBe(EXIT_ERROR);
    expect(w.events.map((event) => event.kind)).toEqual(["parked"]);
    expect(w.diagnostic.join("\n")).toContain("it may still have saved it");

    expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_ERROR);
    expect(w.calls.created).toHaveLength(1);
    expect(w.diagnostic.join("\n")).toContain(`review-draft drop ${id} --note "posted as ${REVIEW_URL}"`);
  });

  it("never takes the register's lock from a live post, however long it has held it", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const stalled = acquireOperationLock({ home, key: REVIEW_DRAFT_LOCK_KEY, nowIso: "2026-09-27T10:00:00.000Z" });
    if (stalled.isErr()) {
      throw new Error(stalled.error);
    }
    try {
      expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_ERROR);
    } finally {
      stalled.value.release();
    }
    expect(w.calls.created).toEqual([]);
    expect(w.diagnostic.join("\n")).toContain("Another review-draft write is running");
  });

  it("fails when GitHub reads the review back as something other than what was approved", async () => {
    const w = world({ readBack: { commitId: HEAD, reviewId: 99, state: "APPROVED", url: REVIEW_URL } });
    const { id, digest } = await recorded({ home, w });

    expect(await run({ args: ["post", id, "--approve", digest], home, w })).toBe(EXIT_ERROR);
    expect(w.events.map((event) => event.kind)).toEqual(["parked", "posted"]);
    expect(w.diagnostic.join("\n")).toContain("expected COMMENTED");
  });

  it("keeps the draft held when GitHub refuses the post", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const refusing = world({});
    refusing.events.push(...w.events);
    const api = refusing.deps.makeApi({ home, token: "token" });
    const deps: GithubReviewDraftDeps = {
      ...refusing.deps,
      makeApi: () => ({
        ...api,
        createReview: () => errAsync({ kind: "http", message: "Unprocessable Entity", operation: "x" }),
      }),
    };

    expect(
      await runGithubReviewDraft({ argv: [...PREFIX, "post", id, "--approve", digest], defaultHome: home, deps }),
    ).toBe(EXIT_ERROR);
    expect(refusing.events.map((event) => event.kind)).toEqual(["parked"]);
  });

  it("posts nothing, and says the decision was not recorded, when the door ledger's store is down", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });
    const down = world({});
    down.events.push(...w.events);
    const deps: GithubReviewDraftDeps = { ...down.deps, doorLedger: unreachableDoorLedger() };

    expect(
      await runGithubReviewDraft({ argv: [...PREFIX, "post", id, "--approve", digest], defaultHome: home, deps }),
    ).toBe(EXIT_ERROR);
    expect(down.calls.created).toEqual([]);
    expect(down.diagnostic.join("\n")).toContain("slopweaver github review-draft post not performed:");
    expect(down.events.map((event) => event.kind)).toEqual(["parked"]);
  });

  it("records through the record module alone, with no GitHub token refusing before anything is read", async () => {
    const w = world({});
    const options = {
      formSource: FORM,
      home,
      json: false,
      mode: "record" as const,
      number: 7,
      owner: "o",
      repo: "r",
      why: "w",
    };

    expect(await runReviewDraftRecord({ deps: { ...w.deps, token: () => undefined }, options })).toBe(EXIT_ERROR);
    expect(w.events).toEqual([]);
    expect(await runReviewDraftRecord({ deps: w.deps, options })).toBe(EXIT_OK);
    expect(w.out.at(-1)).toContain("on the owner's word: slopweaver github review-draft post rd-00000001 --approve ");
  });

  it("re-checks everything on a dry run and posts nothing", async () => {
    const w = world({});
    const { id, digest } = await recorded({ home, w });

    const code = await runReviewDraftPost({
      deps: w.deps,
      options: { approve: digest, dryRun: true, home, id, json: false, mode: "post" },
    });

    expect(code).toBe(EXIT_OK);
    expect(w.calls.created).toEqual([]);
    expect(w.out.at(-1)).toBe("would post COMMENT on o/r#7 with 1 comment(s)");
  });

  it("drops a held draft with a note and lists nothing waiting afterwards", async () => {
    const w = world({});
    const { id } = await recorded({ home, w });

    expect(await run({ args: ["drop", id, "--note", "the owner said no"], home, w })).toBe(EXIT_OK);
    expect(await run({ args: ["list"], home, w })).toBe(EXIT_OK);
    expect(w.out.at(-1)).toBe("no review drafts waiting on the owner");
  });
});
