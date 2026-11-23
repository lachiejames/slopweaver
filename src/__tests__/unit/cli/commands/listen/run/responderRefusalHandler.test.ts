import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../../admit/doorLedgerPort.js";
import {
  type ResponderRefusalDeps,
  responderRefusalHandler,
} from "../../../../../../cli/commands/listen/responderRefusal.js";
import type { Mention } from "../../../../../../live/listen/mention.js";
import type { ResponderRefusalHandler } from "../../../../../../live/listen/socket.js";
import type { ResponderWhitelist } from "../../../../../../live/listen/whitelist.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../../doorLedgerFixture.js";
import { expectedHoldRefusal } from "../../../../../profileHoldFixture.js";
import { ADMITS_U0HUMAN } from "./harness.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * `responderRefusalHandler` — the live two-door refusal shell. Correlated ledger lines are the property
 * that matters most here: one refusal must produce exactly one audit `hold` and one send `pass`/`hold`,
 * sharing a `runId`, never a single ledger line and never two unrelated ones.
 */
describe("responderRefusalHandler", () => {
  const MENTION: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "status?",
    threadTs: "1785114000.000100",
    userId: "U_STRANGER",
  };

  /** A `ResponderRefusalDeps` fixture over a fresh temp home, with a recording (never-posting) `postReply`. */
  function fixture({
    doorLedger,
    postReplyThrows = false,
    responderWhitelist = ADMITS_U0HUMAN,
    sendGates = [],
  }: {
    doorLedger?: DoorLedgerPort;
    postReplyThrows?: boolean;
    responderWhitelist?: ResponderWhitelist;
    sendGates?: ResponderRefusalDeps["sendGates"];
  } = {}): {
    readonly door: MemoryDoorLedger;
    readonly home: string;
    readonly lines: string[];
    readonly posts: Parameters<ResponderRefusalDeps["postReply"]>[0][];
    readonly handler: ResponderRefusalHandler;
  } {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-refusal-"));
    fixtureDirs.push(home);
    const lines: string[] = [];
    const posts: Parameters<ResponderRefusalDeps["postReply"]>[0][] = [];
    const door = memoryDoorLedger();
    let ledger: DoorLedgerPort = door.port;
    if (doorLedger !== undefined) {
      ledger = doorLedger;
    }
    const deps: ResponderRefusalDeps = {
      doorLedger: ledger,
      home,
      log: ({ line }) => {
        lines.push(line);
      },
      ownerUserId: () => "U0OWNER",
      postReply: async (args) => {
        posts.push(args);
        if (postReplyThrows) {
          throw new Error("chat.postMessage: not_in_channel");
        }
        return { channel: args.channel, ts: "1785114400.000200" };
      },
      responderWhitelist: () => responderWhitelist,
      sendGates,
    };
    return { door, handler: responderRefusalHandler({ deps }), home, lines, posts };
  }

  it("posts exactly one fixed reply, threaded, unfurls disabled", async () => {
    const { handler, posts } = fixture();

    await handler({
      mention: MENTION,
      why: "`U_STRANGER` is not on the responder whitelist (2 configured identities)",
    });

    expect(posts.length).toBe(1);
    expect(posts[0]).toEqual({
      channel: "C_BOT",
      payload: {
        form: "plain",
        text: "hey! <@U0OWNER> hasn't made a general ruling on this yet, bringing them in to approve this one.",
        unfurl_links: false,
        unfurl_media: false,
      },
      threadTs: "1785114000.000100",
    });
  });

  it("names nobody, never a stale hardcoded owner claim, when the live whitelist is closed", async () => {
    const { handler, posts } = fixture({ responderWhitelist: { identities: [], kind: "list" } });

    await handler({
      mention: MENTION,
      why: "the responder whitelist is empty — refusing every identity",
    });

    expect(posts[0]!.payload).toMatchObject({
      text: expect.stringContaining("isn't answering anyone right now"),
    });
  });

  it("never includes the refusal reason in the posted text", async () => {
    const { handler, posts } = fixture();

    await handler({
      mention: MENTION,
      why: "`U_STRANGER` is not on the responder whitelist (2 configured identities)",
    });

    expect(posts[0]!.payload).toMatchObject({ text: expect.not.stringContaining("configured identities") });
  });

  it("records exactly two correlated door-ledger lines: an audit hold, then a send pass", async () => {
    const { door, handler } = fixture();

    await handler({ mention: MENTION, why: "closed list" });

    const entries = door.records();
    expect(entries.length).toBe(2);
    expect(entries[0]!["runId"]).toBe(entries[1]!["runId"]);
    expect(entries[0]!["status"]).toBe("hold");
    expect(entries[1]!["status"]).toBe("pass");
  });

  it("still posts the reply when a hold gate blocks the send, producing two hold lines and no post", async () => {
    const block = { code: "test.block", correction: "n/a", severity: "hold" as const, summary: "blocked for test" };
    const { door, handler, lines, posts } = fixture({ sendGates: [() => [block]] });

    await handler({ mention: MENTION, why: "closed list" });

    expect(posts.length).toBe(0);
    const entries = door.records();
    expect(entries.length).toBe(2);
    expect(entries[0]!["status"]).toBe("hold");
    expect(entries[1]!["status"]).toBe("hold");
    const refusal = expectedHoldRefusal({
      command: "posting the responder-refusal reply",
      decision: { findings: [block], overridden: [], status: "hold" },
    });
    expect(lines).toEqual(refusal);
  });

  it("still records both door decisions when the Slack post itself throws, and logs the failure loudly", async () => {
    const { door, handler, lines } = fixture({ postReplyThrows: true });

    await handler({ mention: MENTION, why: "closed list" });

    const entries = door.records();
    expect(entries.length).toBe(2);
    expect(entries[1]!["status"]).toBe("pass");
    expect(lines.some((line) => line.includes("posting the responder-refusal reply threw"))).toBe(true);
  });

  it("posts nothing, and says the record could not be written, when the door ledger is down", async () => {
    const { handler, lines, posts } = fixture({ doorLedger: unreachableDoorLedger() });

    await handler({ mention: MENTION, why: "closed list" });

    expect(posts.length).toBe(0);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("could not record the responder-refusal audit hold");
    expect(lines[1]).toContain("posting the responder-refusal reply not performed:");
  });
});
