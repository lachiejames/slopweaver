/**
 * `listen recover --scheduled`'s cycle — admitting a scanned survivor: captured through the shared UX, refused
 * through the door when not whitelisted, the whitelist read at admission. A real temp home, plain fake Slack API +
 * write transport, an injected clock; never a real network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";
import {
  BASE_OPTIONS,
  BOT,
  CLOSED_WHITELIST,
  fakeTransport,
  listOnlyC1,
  OPEN_WHITELIST,
} from "../scheduledRecoverFakes.js";

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("captures an admitted survivor through the shared UX: reaction, checklist, status", async () => {
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => ({ messages: [{ text: `<@${BOT}> help`, ts: "1786400000.000100", user: "U_ASKER" }] }),
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [{ ts: "1786400000.000100", user: "U_ASKER" }] }),
    };
    const calls: string[] = [];

    const code = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls }) });

    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["addReaction", "postTurn", "setAssistantStatus"]);
  });

  it("refuses a non-whitelisted survivor through the door instead of capturing it", async () => {
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => ({ messages: [{ text: `<@${BOT}> help`, ts: "1786400000.000100", user: "U_ASKER" }] }),
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [{ ts: "1786400000.000100", user: "U_ASKER" }] }),
    };
    const calls: string[] = [];

    await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      responderWhitelist: () => CLOSED_WHITELIST,
      transport: fakeTransport({ calls }),
    });

    expect(calls).toEqual(["postDripMessage"]);
  });

  it("reads the whitelist at admission, once per admitted survivor, rather than taking a snapshot", async () => {
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => ({ messages: [{ text: `<@${BOT}> help`, ts: "1786400000.000100", user: "U_ASKER" }] }),
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [{ ts: "1786400000.000100", user: "U_ASKER" }] }),
    };
    const calls: string[] = [];
    const reads: string[] = [];

    await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      responderWhitelist: () => {
        reads.push(`read after ${calls.length} transport call(s)`);
        return OPEN_WHITELIST;
      },
      transport: fakeTransport({ calls }),
    });

    expect(reads).toEqual(["read after 0 transport call(s)"]);
  });
});
