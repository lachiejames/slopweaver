import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSlackWrite, type SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { SlackDraftEvent } from "../../../../../../outbound/slack/draftRegister.js";
import { freshHome, harness, removeFixtureDirs } from "./harness.js";
import { homeWithShot, logOf, ONE_CARD, parkedRow, postedPayload, releaseArgv } from "./release.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me --draft --approve — releasing a parked draft", () => {
  // Every row here is a top-level message into channel C1, so each test releases from a home that holds its picture.
  let shot: ReturnType<typeof homeWithShot>;
  beforeEach(() => {
    shot = homeWithShot();
  });

  it("posts exactly the approved bytes once, and marks the row released with the ts Slack returned", async () => {
    const payload = await postedPayload({ form: ONE_CARD });
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload)).toEqual([payload]);
    expect(h.draftEvents.map((event) => [event.kind, event.id, "ts" in event ? event.ts : ""])).toEqual([
      ["released", row.id, "1700000001.000100"],
    ]);
  });

  it("refuses a digest that is not the row's, and sends nothing", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: "0".repeat(32), home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("refuses when the words re-prepare to other bytes than the approved ones — drift is never sent", async () => {
    const payload = await postedPayload({ form: ONE_CARD });
    const row = parkedRow({
      form: ONE_CARD,
      media: shot.media,
      payload: { ...payload, text: "Five groups, one question." },
    });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("refuses a row already released, so the queue card cannot send it twice", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const released: SlackDraftEvent = {
      channel: "C1",
      id: row.id,
      kind: "released",
      ts: "1.1",
      tsIso: "2026-09-23T12:01:00.000Z",
    };
    const h = harness({ draftLog: logOf({ later: [released], row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("refuses a row recorded from stdin before the form was kept, until --form supplies the words", async () => {
    const row = parkedRow({ form: "-", media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const bare = harness({ draftLog: logOf({ row }) });
    const supplied = harness({ draftLog: logOf({ row }), stdin: ONE_CARD });

    const refused = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: bare.deps,
      verb: "post",
    });
    const sent = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, extra: ["--form", "-"], home: shot.home, id: row.id }),
      deps: supplied.deps,
      verb: "post",
    });

    expect(refused).toBe(EXIT_USAGE);
    expect(bare.sends).toEqual([]);
    expect(sent).toBe(EXIT_OK);
    expect(supplied.sends.length).toBe(1);
  });

  it("lets an untagged chase into a DIRECT MESSAGE without the hatch, and still refuses one into a channel", async () => {
    const chase = JSON.stringify({
      kind: "one-card",
      lines: [
        {
          runs: [
            { text: "Bumping the review on the size budget.", type: "text" },
            { label: "the review", type: "link", url: "https://fixture.example/pool" },
          ],
        },
      ],
    });
    const payload = await postedPayload({ form: chase, hatchIds: ["untagged-bump"] });
    const row = parkedRow({ form: chase, media: shot.media, payload });
    const dm = harness({ conversationSurface: async () => "direct-message", draftLog: logOf({ row }) });
    const channel = harness({ draftLog: logOf({ row }) });

    const toDm = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: dm.deps,
      verb: "post",
    });
    const toChannel = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: channel.deps,
      verb: "post",
    });

    expect(toDm).toBe(EXIT_OK);
    expect(dm.sends.length).toBe(1);
    expect(toChannel).toBe(EXIT_USAGE);
    expect(channel.sends).toEqual([]);
  });

  /**
   * Where a row owing a comparison lands. A row carrying a picture owes none (it skips with `has-media`), and a
   * first message in a channel always carries one, so a comparison landing mid-release is only reachable in a DM.
   */
  const DM = "D0PROMPT";

  /** A person's message after the row's recording instant, so the conversation moved. */
  const MOVED = [{ text: "never mind, already fixed it", ts: "1790200000.000100", user: "U0PERSON" }];

  it("refuses a release into a conversation a person moved since the draft read it, holds the row thread-moved, and sends nothing", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }), releaseConversation: MOVED });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });
    const cleared = await runSlackWrite({
      argv: releaseArgv({
        approve: row.digest,
        extra: ["--thread-moved-cleared", "1790200000.000100"],
        home: shot.home,
        id: row.id,
      }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(cleared).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
    expect(h.draftEvents).toEqual([
      expect.objectContaining({ id: row.id, kind: "held", reason: "thread-moved" }),
      expect.objectContaining({ kind: "released", threadMovedClearedTs: ["1790200000.000100"] }),
    ]);
  });

  it("HOLDS a release whose conversation read Slack threw on slack-refused, and lets the throw go on", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({
      conversationSurface: async () => {
        throw new Error("invalid_auth");
      },
      draftLog: logOf({ row }),
    });

    await expect(
      runSlackWrite({
        argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
        deps: h.deps,
        verb: "post",
      }),
    ).rejects.toThrow("invalid_auth");

    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([
      expect.objectContaining({
        id: row.id,
        kind: "held",
        reason: "slack-refused",
        why: "the release stopped on an error before sending: invalid_auth",
      }),
    ]);
  });

  it("sends only the thanks line in place of a message no longer needed, and closes the row on it", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }), releaseConversation: MOVED });

    const code = await runSlackWrite({
      argv: releaseArgv({
        approve: row.digest,
        extra: ["--thanks-instead", "Thanks for the review.", "--thread-moved-cleared", "1790200000.000100"],
        home: shot.home,
        id: row.id,
      }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual(["Thanks for the review."]);
    expect(h.draftEvents).toEqual([
      expect.objectContaining({
        id: row.id,
        kind: "released",
        thanksInstead: "Thanks for the review.",
        threadMovedClearedTs: ["1790200000.000100"],
      }),
    ]);
  });

  it("re-reads before the thanks too, refusing a moved thread whose change set it was not given", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }), releaseConversation: MOVED });

    const code = await runSlackWrite({
      argv: releaseArgv({
        approve: row.digest,
        extra: ["--thanks-instead", "Thanks."],
        home: shot.home,
        id: row.id,
      }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("re-reads the row before either send, refusing one a comparison landed on while its gates ran", async () => {
    const payload = await postedPayload({ form: ONE_CARD });
    const row = { ...parkedRow({ channel: DM, form: ONE_CARD, payload }), comparison: { state: "pending" as const } };
    // B's words are A's under the same identity, so A's digest is the one they mint: the fold refuses any other.
    const candidate = { advisory: [], digest: row.digest, form: ONE_CARD, mentions: [], payload };
    const outcome = { candidate, elapsedMs: 1, requestedModel: "gpt-test", state: "ready" as const };
    const compared = { id: row.id, kind: "compared" as const, outcome, tsIso: "2026-09-23T12:01:00.000Z" };
    // Its first pass found no seat, so A was releasable when the release resolved it; a retry lands mid-gate.
    const capped = { reason: "capped", state: "unavailable" as const };
    const unavailable = { id: row.id, kind: "compared" as const, outcome: capped, tsIso: "2026-09-23T12:00:30.000Z" };
    const refusedOn = async ({ extra }: { extra: readonly string[] }) => {
      const h = harness({ conversationSurface: async () => "direct-message", draftLog: logOf({ row }) });
      // The comparison lands while the live gates run: every register read after the thread re-read sees it.
      let landed = false;
      const readReleaseConversation: SlackWriteDeps["readReleaseConversation"] = async (args) => {
        landed = true;
        return h.deps.readReleaseConversation(args);
      };
      const readDraftLog = () => logOf({ later: landed ? [unavailable, compared] : [unavailable], row });
      const release = releaseArgv({ approve: row.digest, extra, home: freshHome(), id: row.id });
      const deps = { ...h.deps, readDraftLog, readReleaseConversation };
      const code = await runSlackWrite({ argv: release, deps, verb: "post" });
      return { code, sends: h.sends };
    };

    expect(await refusedOn({ extra: [] })).toEqual({ code: EXIT_USAGE, sends: [] });
    expect(await refusedOn({ extra: ["--thanks-instead", "Thanks."] })).toEqual({ code: EXIT_USAGE, sends: [] });
  });

  it("re-reads the row after the send-only gates too, refusing a comparison that landed inside them", async () => {
    const payload = await postedPayload({ form: ONE_CARD });
    const row = { ...parkedRow({ channel: DM, form: ONE_CARD, payload }), comparison: { state: "pending" as const } };
    // B's words are A's under the same identity, so A's digest is the one they mint: the fold refuses any other.
    const candidate = { advisory: [], digest: row.digest, form: ONE_CARD, mentions: [], payload };
    const outcome = { candidate, elapsedMs: 1, requestedModel: "gpt-test", state: "ready" as const };
    const compared = { id: row.id, kind: "compared" as const, outcome, tsIso: "2026-09-23T12:01:00.000Z" };
    const capped = { reason: "capped", state: "unavailable" as const };
    const unavailable = { id: row.id, kind: "compared" as const, outcome: capped, tsIso: "2026-09-23T12:00:30.000Z" };
    // The high-stakes check runs last of all as the send's claim, after the release's own re-read: landing B on that
    // call is landing it inside the send-only gates. A clean run counts the calls, so the test names no position.
    const released = async ({ landOn, extra }: { landOn: number; extra: readonly string[] }) => {
      const h = harness({ conversationSurface: async () => "direct-message", draftLog: logOf({ row }) });
      let calls = 0;
      const highStakes: SlackWriteDeps["highStakes"] = (args) => {
        calls += 1;
        return h.deps.highStakes(args);
      };
      const readDraftLog = () => logOf({ later: calls >= landOn ? [unavailable, compared] : [unavailable], row });
      const release = releaseArgv({ approve: row.digest, extra, home: freshHome(), id: row.id });
      const code = await runSlackWrite({ argv: release, deps: { ...h.deps, highStakes, readDraftLog }, verb: "post" });
      return { calls, code, sends: h.sends.length };
    };

    for (const extra of [[], ["--thanks-instead", "Thanks."]]) {
      const clean = await released({ extra, landOn: Number.POSITIVE_INFINITY });
      expect(clean.sends).toBe(1);
      expect(await released({ extra, landOn: clean.calls })).toEqual({
        calls: clean.calls,
        code: EXIT_USAGE,
        sends: 0,
      });
    }
  });

  it("re-reads the row once more inside the door, refusing a comparison that landed after the gates", async () => {
    const payload = await postedPayload({ form: ONE_CARD });
    const row = { ...parkedRow({ channel: DM, form: ONE_CARD, payload }), comparison: { state: "pending" as const } };
    // B's words are A's under the same identity, so A's digest is the one they mint: the fold refuses any other.
    const candidate = { advisory: [], digest: row.digest, form: ONE_CARD, mentions: [], payload };
    const outcome = { candidate, elapsedMs: 1, requestedModel: "gpt-test", state: "ready" as const };
    const compared = { id: row.id, kind: "compared" as const, outcome, tsIso: "2026-09-23T12:01:00.000Z" };
    const capped = { reason: "capped", state: "unavailable" as const };
    const unavailable = { id: row.id, kind: "compared" as const, outcome: capped, tsIso: "2026-09-23T12:00:30.000Z" };
    // The send's client is built after every gate and the first re-read, and before the door: landing B on that call
    // is landing it in the window only the re-read inside the door covers.
    const released = async ({ landOn }: { landOn: number }) => {
      const h = harness({ conversationSurface: async () => "direct-message", draftLog: logOf({ row }) });
      let calls = 0;
      const makeApi: SlackWriteDeps["makeApi"] = (args) => {
        calls += 1;
        return h.deps.makeApi(args);
      };
      const readDraftLog = () => logOf({ later: calls >= landOn ? [unavailable, compared] : [unavailable], row });
      const release = releaseArgv({ approve: row.digest, extra: [], home: freshHome(), id: row.id });
      const code = await runSlackWrite({ argv: release, deps: { ...h.deps, makeApi, readDraftLog }, verb: "post" });
      return { calls, code, sends: h.sends.length };
    };

    const clean = await released({ landOn: Number.POSITIVE_INFINITY });
    expect(clean.sends).toBe(1);
    expect(await released({ landOn: clean.calls })).toEqual({ calls: clean.calls, code: EXIT_USAGE, sends: 0 });
  });

  it("previews under --dry-run and leaves the row held", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, extra: ["--dry-run"], home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });
});
