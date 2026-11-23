import { afterEach, describe, expect, it } from "vitest";
import { SlackReadErrors } from "../../../../../../cli/commands/slack/readErrors.js";
import { runSlackWrite, type SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { DUPLICATE_SEND_OVERRIDE } from "../../../../../../outbound/slack/duplicateGate.js";
import { existingWallRun, type ThreadReplyIdentity } from "../../../../../../outbound/slack/wallGate.js";
import { grantSessionEnv } from "../../../../../hatchGrantFixture.js";
import { argv, freshHome, harness, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me — the wall gate counts only what THIS drip posts", () => {
  function replyArgv({ home }: { home: string }): readonly string[] {
    return ["--as", "me", "--channel", "C1", "--form", "-", "--home", home, "--thread-ts", "1699.0001"];
  }

  // The real wiring answers this dep through `existingWallRun`, so the fake does too rather than returning
  // a hand-picked number. A fixed `{ length: 4 }` fake would let this file assert an as-me outcome the
  // production path can no longer produce — the lane's standing run is 0 by construction under the
  // current rule, and a shell test asserting otherwise would be green and false.
  function wallRunOver({ replies }: { replies: readonly ThreadReplyIdentity[] }): SlackWriteDeps["wallRun"] {
    return async ({ actor }) => ok(existingWallRun({ actor, replies, threadTs: "1699.0001" }));
  }

  /** Four replies the owner typed, standing at the tail of the thread — the shape that used to refuse them. */
  const ownerReplies: readonly ThreadReplyIdentity[] = [
    { ours: false, permalink: "p0", ts: "1699.0001" },
    { ours: false, permalink: "ptheirs", ts: "1699.0002" },
    ...Array.from({ length: 4 }, (_, index) => ({
      ours: true,
      permalink: `phis${String(index + 1)}`,
      ts: `1699.001${String(index + 1)}`,
    })),
  ];

  it("SENDS over four of the owner's own earlier replies — they are the owner's hand, not a run we built", async () => {
    const h = harness({ wallRun: wallRunOver({ replies: ownerReplies }) });

    const code = await runSlackWrite({ argv: replyArgv({ home: freshHome() }), deps: h.deps, verb: "reply" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(2);
  });

  it("REFUSES a six-message drip over those same replies, sending nothing", async () => {
    const h = harness({
      stdin: JSON.stringify({
        kind: "drip",
        messages: Array.from({ length: 6 }, (_, index) => ({
          runs: [{ text: `Line ${String(index + 1)}.`, type: "text" }],
        })),
      }),
      wallRun: wallRunOver({ replies: ownerReplies }),
    });

    const code = await runSlackWrite({ argv: replyArgv({ home: freshHome() }), deps: h.deps, verb: "reply" });

    // That it refuses at SIX rather than at eight — the owner's four replies plus these six — is the projected
    // count asserted exactly in `unit/outbound/slack/wallGate.test.ts`; here the claim is only that the
    // send was stopped and nothing went out.
    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("tells the wall gate this lane sends as the owner — the actor is the whole of the fix", async () => {
    const actors: string[] = [];
    const h = harness({
      wallRun: async ({ actor }) => {
        actors.push(actor);
        return ok({ length: 0 });
      },
    });

    const code = await runSlackWrite({ argv: replyArgv({ home: freshHome() }), deps: h.deps, verb: "reply" });

    expect(code).toBe(EXIT_OK);
    expect(actors).toEqual(["me"]);
  });

  it("still REFUSES a six-message drip when the thread read FAILS — this lane never fails open", async () => {
    // The bot lane cannot decide without the read, so a failed read there is a pass. This lane already
    // holds the only number that matters, so failing open would hand a caller an unlimited drip whenever
    // Slack hiccups — or whenever the thread is longer than the 200-page walk `fetchCompleteSlackThread`
    // will do.
    const h = harness({
      stdin: JSON.stringify({
        kind: "drip",
        messages: Array.from({ length: 6 }, (_, index) => ({
          runs: [{ text: `Line ${String(index + 1)}.`, type: "text" }],
        })),
      }),
      wallRun: async () =>
        err(SlackReadErrors.wallThreadUnread({ channel: "C1", reason: "thread walk hit its page ceiling" })),
    });

    const code = await runSlackWrite({ argv: replyArgv({ home: freshHome() }), deps: h.deps, verb: "reply" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("SENDS past the limit under a live wall grant", async () => {
    const home = freshHome();
    const h = harness({ grants: { hatchIds: ["wall"], home }, wallRun: async () => ok({ length: 9 }) });

    const code = await runSlackWrite({
      argv: replyArgv({ home }),
      deps: h.deps,
      verb: "reply",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(2);
  });

  it("still REFUSES past the limit with only the retired wall variable set", async () => {
    const home = freshHome();
    const h = harness({
      extraEnv: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_WALL: "1" },
      wallRun: async () => ok({ length: 9 }),
    });

    const code = await runSlackWrite({ argv: replyArgv({ home }), deps: h.deps, verb: "reply" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });
});

describe("runSlackWrite --as me — the door decides ONCE for the whole sequence", () => {
  it("warns on a fully-repeated drip and sends NOTHING", async () => {
    const home = freshHome();
    await runSlackWrite({ argv: argv({ home }), deps: harness().deps, verb: "post" });

    const repeat = harness();
    const code = await runSlackWrite({ argv: argv({ home }), deps: repeat.deps, verb: "post" });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(repeat.sends).toEqual([]);
  });

  it("does NOT warn when the drip is a RESUME rather than a repeat", async () => {
    const home = freshHome();
    await runSlackWrite({
      argv: argv({ home }),
      deps: harness({ failOn: "Docs to follow tomorrow." }).deps,
      verb: "post",
    });

    const resumed = harness();
    const code = await runSlackWrite({
      argv: argv({ extra: ["--resend-unconfirmed"], home }),
      deps: resumed.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(resumed.sends.length).toBe(1);
  });

  it("actually REPEATS the drip when the operator overrides the duplicate warn", async () => {
    const home = freshHome();
    await runSlackWrite({ argv: argv({ home }), deps: harness().deps, verb: "post" });

    const deliberate = harness({ override: DUPLICATE_SEND_OVERRIDE });
    const code = await runSlackWrite({ argv: argv({ home }), deps: deliberate.deps, verb: "post" });

    // "Post it again, I mean it" must post again — skipping every message as already-sent would be the
    // exact opposite of what the override asks for.
    expect(code).toBe(EXIT_OK);
    expect(deliberate.sends.map((send) => send.payload.text)).toEqual([
      "Shipped the compaction pass.",
      "Docs to follow tomorrow.",
    ]);
  });
});

describe("runSlackWrite --as me — a public top-level post is ONE card", () => {
  const ONE_CARD = JSON.stringify({
    kind: "one-card",
    lines: [
      { runs: [{ text: "Shipped the compaction pass.", type: "text" }] },
      { runs: [{ text: "Docs to follow tomorrow.", type: "text" }] },
    ],
  });

  it("REFUSES a two-message top-level drip into a PUBLIC channel, sending nothing", async () => {
    const h = harness({ conversationSurface: async () => "public-channel" as const });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("FAILS CLOSED when Slack could not say what the channel is", async () => {
    const h = harness({ conversationSurface: async () => undefined });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("refuses under --dry-run too, so a composer sees it before removing the flag", async () => {
    const h = harness({ conversationSurface: async () => "public-channel" as const });

    const code = await runSlackWrite({
      argv: argv({ extra: ["--dry-run"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
  });

  it("SENDS the same words as ONE card — the shape the refusal names is actually reachable", async () => {
    const h = harness({ conversationSurface: async () => "public-channel" as const, stdin: ONE_CARD });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
    expect(h.sends[0]!.payload.text).toBe("Shipped the compaction pass.\n\nDocs to follow tomorrow.");
  });

  it("SENDS the drip into a PRIVATE channel, which the ruling leaves on today's rules", async () => {
    const h = harness({ conversationSurface: async () => "private-channel" as const });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(2);
  });

  it("SENDS the public drip under a live public-drip grant", async () => {
    const home = freshHome();
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      grants: { hatchIds: ["public-drip"], home },
    });

    const code = await runSlackWrite({ argv: argv({ home }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(2);
  });

  it("still REFUSES the public drip with only the retired public-drip variable set", async () => {
    const home = freshHome();
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      extraEnv: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_PUBLIC_DRIP: "1" },
    });

    const code = await runSlackWrite({ argv: argv({ home }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("never ASKS about the surface for a one-message post, so the compliant shape pays for no call", async () => {
    const asked: string[] = [];
    const h = harness({
      conversationSurface: async ({ channel }) => {
        asked.push(channel);
        return "public-channel" as const;
      },
      stdin: JSON.stringify({ kind: "drip", messages: [{ runs: [{ text: "One line.", type: "text" }] }] }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([]);
  });
});
