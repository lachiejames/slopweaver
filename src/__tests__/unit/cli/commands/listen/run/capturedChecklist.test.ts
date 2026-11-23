import { describe, expect, it } from "vitest";

import { type CapturedChecklistDeps, withCapturedChecklist } from "../../../../../../cli/commands/listen/run.js";
import { err, ok } from "../../../../../../lib/result.js";
import type { Mention, MentionHandler } from "../../../../../../live/listen/mention.js";

/**
 * The capture-time checklist + native status wrapper — the fix for the two-minute silence the owner
 * measured between the `:eyes:` reaction and the working message appearing. Both effects must survive
 * failing without ever stopping the mention from reaching the next handler in the chain — that is the
 * property every "still calls the handler" case below exists to protect against a later, blocking edit.
 */
describe("withCapturedChecklist", () => {
  const MENTION: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };

  const POSTED = { channel: "C_BOT", ts: "1785114398.000900" };

  /** One call to `postChecklist`, recorded whole so a test can inspect the exact frame it was given. */
  interface PostChecklistCall {
    readonly steps: Parameters<CapturedChecklistDeps["postChecklist"]>[0]["steps"];
    readonly task: string;
  }

  /** A recording fixture: every call, in order, plus the checklist frames and mentions the handler saw. */
  function fixture({
    postChecklistThrows = false,
    setStatusThrows = false,
    setStatusRefusal,
  }: {
    postChecklistThrows?: boolean;
    setStatusThrows?: boolean;
    setStatusRefusal?: string;
  } = {}): {
    readonly calls: string[];
    readonly lines: string[];
    readonly posts: PostChecklistCall[];
    readonly handledMentions: Mention[];
    readonly wrapped: MentionHandler;
  } {
    const calls: string[] = [];
    const lines: string[] = [];
    const posts: PostChecklistCall[] = [];
    const handledMentions: Mention[] = [];
    const deps: CapturedChecklistDeps = {
      log: ({ line }) => {
        lines.push(line);
      },
      mintTurnId: () => "turn-1",
      postChecklist: async ({ steps, task }) => {
        calls.push("checklist");
        posts.push({ steps, task });
        if (postChecklistThrows) {
          throw new Error("chat.postMessage: not_in_channel");
        }
        return POSTED;
      },
      setStatus: async () => {
        calls.push("status");
        if (setStatusThrows) {
          throw new Error("ECONNRESET");
        }
        return setStatusRefusal === undefined ? ok(undefined) : err(setStatusRefusal);
      },
    };
    const handler: MentionHandler = async (mention) => {
      calls.push("handled");
      handledMentions.push(mention);
    };
    return {
      calls,
      handledMentions,
      lines,
      posts,
      wrapped: withCapturedChecklist({ deps, handler }),
    };
  }

  it("posts the checklist and sets the status BEFORE the mention reaches the wrapped handler", async () => {
    const { calls, wrapped } = fixture();
    await wrapped(MENTION);

    expect(calls).toEqual(["checklist", "status", "handled"]);
  });

  it("hands the handler the exact turn id and working ts the checklist post returned", async () => {
    const { handledMentions, wrapped } = fixture();
    await wrapped(MENTION);

    expect(handledMentions[0]!.started).toEqual({ turnId: "turn-1", workingTs: POSTED.ts });
  });

  it("posts a checklist with step 0 already done — the question genuinely has been read", async () => {
    const { posts, wrapped } = fixture();
    await wrapped(MENTION);

    expect(posts[0]!.steps[0]).toEqual({
      detail: '"what are my open PRs?"',
      id: "question",
      state: "done",
      title: "Read the question",
    });
  });

  it("posts a NEUTRAL, route-agnostic placeholder — never corpus language routing has not decided yet", async () => {
    const { posts, wrapped } = fixture();
    await wrapped(MENTION);

    // Routing has not run at capture — this module cannot know whether the turn will touch the corpus at
    // all — so the pending step must not claim corpus-specific work. `beginTurn` (`../../../../live/turn/
    // run.ts`) corrects this to the real route's steps the moment it knows them.
    expect(posts[0]!.steps).toHaveLength(2);
    expect(posts[0]!.steps[1]).toEqual({ id: "route", state: "running", title: "Work out how to answer" });
  });

  it("mints the turn id and hands the handler a mention carrying `started`", async () => {
    const { handledMentions, wrapped } = fixture();
    await wrapped(MENTION);

    expect(handledMentions[0]!.started).toEqual({ turnId: "turn-1", workingTs: "1785114398.000900" });
  });

  it("labels the task from the question, the same as an ordinary turn", async () => {
    const { posts, wrapped } = fixture();
    await wrapped(MENTION);

    expect(posts[0]!.task).toBe("answering: what are my open PRs?");
  });

  it("still calls the handler when the checklist post THROWS, and the mention carries no `started`", async () => {
    const { calls, handledMentions, lines, wrapped } = fixture({ postChecklistThrows: true });
    await wrapped(MENTION);

    expect(calls).toEqual(["checklist", "status", "handled"]);
    expect(handledMentions[0]!.started).toBe(undefined);
    expect(lines).toEqual([
      "could not post the capture-time checklist — continuing without it: chat.postMessage: not_in_channel",
    ]);
  });

  it("still calls the handler when the status call THROWS — a transport fault is not a Slack refusal", async () => {
    const { calls, handledMentions, lines, wrapped } = fixture({ setStatusThrows: true });
    await wrapped(MENTION);

    expect(calls).toEqual(["checklist", "status", "handled"]);
    expect(handledMentions[0]!.started).toEqual({ turnId: "turn-1", workingTs: "1785114398.000900" });
    expect(lines).toEqual(["could not set the native status indicator — continuing without it: ECONNRESET"]);
  });

  it("still calls the handler when the status call is REFUSED, rather than treating it as fatal", async () => {
    const { calls, lines, wrapped } = fixture({
      setStatusRefusal: "assistant.threads.setStatus refused: missing_scope",
    });
    await wrapped(MENTION);

    expect(calls).toEqual(["checklist", "status", "handled"]);
    expect(lines).toEqual([
      "could not set the native status indicator — continuing without it: assistant.threads.setStatus refused: missing_scope",
    ]);
  });
});
