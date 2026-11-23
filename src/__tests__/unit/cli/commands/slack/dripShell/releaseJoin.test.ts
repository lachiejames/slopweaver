import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutonomyLedgerPort } from "../../../../../../autonomy/port.js";
import { runSlackWrite, type SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { ChannelAccess } from "../../../../../../outbound/slack/channelJoin.js";
import type { ParkedSlackDraft } from "../../../../../../outbound/slack/draftRegister.js";
import {
  heldAutonomyRecords,
  memoryAutonomyLedgerPort,
  unavailableAutonomyLedgerPort,
} from "../../../../../autonomyLedgerFixture.js";
import { argv, freshHome, harness, removeFixtureDirs } from "./harness.js";
import { homeWithShot, logOf, ONE_CARD, parkedRow, postedPayload, releaseArgv } from "./release.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me --draft --approve — a public channel the owner is not in is joined, then posted to", () => {
  const APPROVAL = { anchor: "talk:e64310b5", atIso: "2026-10-12T01:42:18.833Z", heard: "yeah, just send it" };
  const OUTSIDE_PUBLIC = { isMember: false, name: "ask-product-help", surface: "public-channel" } as const;
  // Every row here is a top-level message into channel C1, so each test releases from a home that holds its picture.
  let shot: ReturnType<typeof homeWithShot>;
  beforeEach(() => {
    shot = homeWithShot();
  });

  async function approvedRow(): Promise<ParkedSlackDraft> {
    return {
      ...parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) }),
      approval: APPROVAL,
    };
  }

  it("joins once, posts the approved bytes, and records the join as its own act (sd-fbbe54a2)", async () => {
    const row = await approvedRow();
    const { home } = shot;
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends.length).toBe(1);
    expect(h.draftEvents.map((event) => [event.kind, event.id])).toEqual([["released", row.id]]);
    expect(h.out).toContain(
      "joined #ask-product-help as them: they were not a member, and their approved message posts there next",
    );
    expect(
      (await heldAutonomyRecords({ port: h.autonomy })).map((record) =>
        "kind" in record ? [record.actionId, record.kind, record.subject] : [],
      ),
    ).toEqual([[`slack-join-c1-for-${row.id}`, "slack-join-public-channel", "https://fixture.slack.com/archives/C1"]]);
  });

  it("hands the join and the release's conversation open the verb's --home, never the ambient one", async () => {
    const row = await approvedRow();
    const { home } = shot;
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });
    const written: string[] = [];
    const joinChannel: SlackWriteDeps["joinChannel"] = async (args) => {
      written.push(`join:${args.home}`);
      return h.deps.joinChannel(args);
    };
    const readReleaseConversation: SlackWriteDeps["readReleaseConversation"] = async (args) => {
      written.push(`read:${args.home}`);
      return h.deps.readReleaseConversation(args);
    };

    await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: { ...h.deps, joinChannel, readReleaseConversation },
      verb: "post",
    });

    expect(written).toEqual([`read:${home}`, `join:${home}`]);
  });

  it("refuses the join on a row carrying no yes of the owner's: nothing joined, sent, held or recorded", async () => {
    const row = parkedRow({ form: ONE_CARD, media: shot.media, payload: await postedPayload({ form: ONE_CARD }) });
    const { home } = shot;
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual([]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
    expect(await heldAutonomyRecords({ port: h.autonomy })).toEqual([]);
  });

  it("refuses a PRIVATE channel the owner is not in with the reason, and holds the owner's yes slack-refused", async () => {
    const row = await approvedRow();
    const h = harness({
      channelAccess: { isMember: false, name: "secret-room", surface: "private-channel" },
      draftLog: logOf({ row }),
    });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual([]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents.map((event) => [event.kind, "reason" in event ? event.reason : ""])).toEqual([
      ["held", "slack-refused"],
    ]);
    const whys = h.draftEvents.map((event) => ("why" in event ? event.why : ""));
    expect(whys[0]).toContain("#secret-room, which is a private channel");
  });

  it("holds the owner's yes slack-refused when Slack refuses the join itself, and sends nothing", async () => {
    const row = await approvedRow();
    const { home } = shot;
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }), joinRefusal: "is_archived" });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents.map((event) => [event.kind, "reason" in event ? event.reason : ""])).toEqual([
      ["held", "slack-refused"],
    ]);
    expect(await heldAutonomyRecords({ port: h.autonomy })).toEqual([]);
  });

  it("joins nothing when the owner is already a member", async () => {
    const row = await approvedRow();
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.joins).toEqual([]);
    expect(h.sends.length).toBe(1);
  });

  it("previews the join on a dry run and takes it nowhere", async () => {
    const row = await approvedRow();
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, extra: ["--dry-run"], home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.joins).toEqual([]);
    expect(h.sends).toEqual([]);
    expect(h.out).toContain(
      "would join #ask-product-help as them first: they are not a member, and the row carries their yes",
    );
  });

  it("joins nothing when a gate refuses the release first — drift is checked before any join", async () => {
    const payload = await postedPayload({ form: ONE_CARD });
    const drifted = parkedRow({
      form: ONE_CARD,
      media: shot.media,
      payload: { ...payload, text: "Five groups, one question." },
    });
    const row = { ...drifted, approval: APPROVAL };
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual([]);
    expect(h.sends).toEqual([]);
  });

  it("joins nothing when the owner's yes is withdrawn while the release runs — the row is re-read, never the resolved copy", async () => {
    const row = await approvedRow();
    const withdrawn = {
      id: row.id,
      kind: "held" as const,
      reason: "not-owner-yes" as const,
      tsIso: "2026-10-12T02:00:00.000Z",
      why: "they meant the other draft",
    };
    const h = harness({ draftLog: logOf({ row }) });
    // The hold lands during the membership read: every register read after it folds the approval away.
    let landed = false;
    const channelAccess: SlackWriteDeps["channelAccess"] = async () => {
      landed = true;
      return OUTSIDE_PUBLIC;
    };
    const readDraftLog = () => logOf({ later: landed ? [withdrawn] : [], row });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: { ...h.deps, channelAccess, readDraftLog },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual([]);
    expect(h.sends).toEqual([]);
  });

  it("holds nothing over the owner's hold when their yes is withdrawn during the read of a PRIVATE channel", async () => {
    const row = await approvedRow();
    const withdrawn = {
      id: row.id,
      kind: "held" as const,
      reason: "not-owner-yes" as const,
      tsIso: "2026-10-12T02:00:00.000Z",
      why: "they meant the other draft",
    };
    const h = harness({ draftLog: logOf({ row }) });
    // The private refusal is decided before the owner's yes is asked about, so only a re-read keeps it from holding the row.
    let landed = false;
    const channelAccess: SlackWriteDeps["channelAccess"] = async () => {
      landed = true;
      return { isMember: false, name: "secret-room", surface: "private-channel" } satisfies ChannelAccess;
    };
    const readDraftLog = () => logOf({ later: landed ? [withdrawn] : [], row });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: { ...h.deps, channelAccess, readDraftLog },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual([]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("sends no join when the owner's yes is withdrawn while the join waits to dispatch, and holds nothing over the owner's hold", async () => {
    const row = await approvedRow();
    const withdrawn = {
      id: row.id,
      kind: "held" as const,
      reason: "not-owner-yes" as const,
      tsIso: "2026-10-12T02:00:00.000Z",
      why: "they meant the other draft",
    };
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });
    // The hold lands after the release's own re-read, while the join sits behind a rate-limit wait.
    let landed = false;
    const readDraftLog = () => logOf({ later: landed ? [withdrawn] : [], row });
    const joinChannel: SlackWriteDeps["joinChannel"] = async (args) => {
      landed = true;
      return h.deps.joinChannel(args);
    };

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: { ...h.deps, joinChannel, readDraftLog },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual([]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("holds nothing over the owner's hold when their yes is withdrawn while a join Slack then refuses is in flight", async () => {
    const row = await approvedRow();
    const withdrawn = {
      id: row.id,
      kind: "held" as const,
      reason: "not-owner-yes" as const,
      tsIso: "2026-10-12T02:00:00.000Z",
      why: "they meant the other draft",
    };
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }), joinRefusal: "is_archived" });
    // The hold lands after the dispatch, while Slack is answering the join with a refusal.
    let landed = false;
    const readDraftLog = () => logOf({ later: landed ? [withdrawn] : [], row });
    const joinChannel: SlackWriteDeps["joinChannel"] = async (args) => {
      const confirm = (): boolean => {
        const wanted = args.confirm();
        landed = true;
        return wanted;
      };
      return h.deps.joinChannel({ ...args, confirm });
    };

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: { ...h.deps, joinChannel, readDraftLog },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("holds nothing when the register cannot be read after Slack refuses the join", async () => {
    const row = await approvedRow();
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }), joinRefusal: "is_archived" });
    // Every register read after the dispatch throws, so the refusal path cannot see whether the owner's yes still stands.
    let dispatched = false;
    const readDraftLog = () => {
      if (dispatched) {
        throw new Error("EIO: the register would not read");
      }
      return logOf({ row });
    };
    const joinChannel: SlackWriteDeps["joinChannel"] = async (args) => {
      const confirm = (): boolean => {
        const wanted = args.confirm();
        dispatched = true;
        return wanted;
      };
      return h.deps.joinChannel({ ...args, confirm });
    };

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: { ...h.deps, joinChannel, readDraftLog },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("holds nothing when a throw after the join meets a register that cannot be read", async () => {
    const row = await approvedRow();
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });
    const readDraftLog = () => {
      if (h.joins.length > 0) {
        throw new Error("EIO: the register would not read");
      }
      return logOf({ row });
    };
    const out: SlackWriteDeps["out"] = (line) => {
      if (line.startsWith("joined ")) {
        throw new Error("EPIPE: stdout closed");
      }
      h.deps.out(line);
    };

    await expect(
      runSlackWrite({
        argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
        deps: { ...h.deps, out, readDraftLog },
        verb: "post",
      }),
    ).rejects.toThrow("EPIPE: stdout closed");
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("still holds a throw after the join while the owner's yes stands on a register that reads", async () => {
    const row = await approvedRow();
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });
    const out: SlackWriteDeps["out"] = (line) => {
      if (line.startsWith("joined ")) {
        throw new Error("EPIPE: stdout closed");
      }
      h.deps.out(line);
    };

    await expect(
      runSlackWrite({
        argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
        deps: { ...h.deps, out },
        verb: "post",
      }),
    ).rejects.toThrow("EPIPE: stdout closed");
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents.map((event) => event.kind)).toEqual(["held"]);
  });

  it("joins nothing and adds no hold of its own when the membership read fails, so the post goes on as before", async () => {
    const row = await approvedRow();
    const h = harness({ draftLog: logOf({ row }) });
    const channelAccess: SlackWriteDeps["channelAccess"] = async () => {
      throw new Error("conversations.info: network down");
    };

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
      deps: { ...h.deps, channelAccess },
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.joins).toEqual([]);
    expect(h.sends.length).toBe(1);
    expect(h.draftEvents.map((event) => event.kind)).toEqual(["released"]);
  });

  it("still posts when the identity read for the ledger row fails after the join", async () => {
    const row = await approvedRow();
    const { home } = shot;
    const h = harness({ channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });
    let whoAmICalls = 0;
    const whoAmI: SlackWriteDeps["whoAmI"] = async (args) => {
      whoAmICalls += 1;
      // The release's own gates read identity first; the ledger row's read is the one after the join.
      if (h.joins.length > 0) {
        throw new Error("auth.test: network down");
      }
      return h.deps.whoAmI(args);
    };

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: { ...h.deps, whoAmI },
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends.length).toBe(1);
    expect(whoAmICalls).toBeGreaterThan(0);
    expect(await heldAutonomyRecords({ port: h.autonomy })).toEqual([]);
  });

  it("still posts when the ledger append itself fails after the join", async () => {
    const row = await approvedRow();
    const { home } = shot;
    // Once Slack has joined, the autonomy ledger's store cannot be reached, so the append is refused. Reads still
    // answer from the in-memory ledger, so the empty read-back below proves nothing was recorded rather than
    // reading an outage as an empty ledger.
    const refusedAppends: string[] = [];
    const memory = memoryAutonomyLedgerPort();
    const outage = unavailableAutonomyLedgerPort();
    const autonomy: AutonomyLedgerPort = {
      appendRecord: async (request) => {
        refusedAppends.push(request.home);
        return outage.appendRecord(request);
      },
      readRecords: memory.readRecords,
    };
    const h = harness({ autonomy, channelAccess: OUTSIDE_PUBLIC, draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(refusedAppends).toEqual([home]);
    expect(h.joins).toEqual(["C1"]);
    expect(h.sends.length).toBe(1);
    expect(code).toBe(EXIT_OK);
    expect(await heldAutonomyRecords({ port: autonomy })).toEqual([]);
  });

  it("never joins on a fresh --as me send, which carries no approved row", async () => {
    const h = harness({ channelAccess: OUTSIDE_PUBLIC });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.joins).toEqual([]);
    expect(h.sends.map((send) => send.payload.text)).toEqual([
      "Shipped the compaction pass.",
      "Docs to follow tomorrow.",
    ]);
  });
});
