/**
 * `listen recover --scheduled`'s cycle — incident detection: handed every discovered channel, run before any
 * channel is read, and never able to stop the sweep. A real temp home, plain fake Slack API + write transport, an
 * injected clock; never a real network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";
import { BASE_OPTIONS, fakeTransport, listOnlyC1, NOW_MS } from "../scheduledRecoverFakes.js";

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("hands incident detection EVERY discovered channel — an unjoined one included — even when the scan is partial", async () => {
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => {
        throw new Error("rate limited");
      },
      listChannels: async ({ lane }) =>
        lane === "group-dms"
          ? { channels: [] }
          : {
              channels: [
                { id: "C1", is_member: true },
                { created: 1786600000, id: "C_INC", is_member: false, name: "inc-2026-08-13-checkout-down" },
              ],
            },
      replies: async () => ({ messages: [] }),
    };
    const seen: { ids: string[]; created: (number | undefined)[]; nowMs: number }[] = [];

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      incidents: async ({ channels, nowMs }) => {
        seen.push({
          created: channels.map((channel) => channel.createdEpochSeconds),
          ids: channels.map((channel) => channel.id),
          nowMs,
        });
        return { registered: [], skipped: [] };
      },
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(seen).toEqual([{ created: [undefined, 1786600000], ids: ["C1", "C_INC"], nowMs: NOW_MS }]);
  });

  it("runs incident detection before any channel is read, and a throw inside it does not stop the sweep", async () => {
    const reads: string[] = [];
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async ({ channel }) => {
        reads.push(`history ${channel}`);
        return { messages: [] };
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      incidents: async () => {
        reads.push("incident detection");
        throw new Error("register crashed");
      },
      transport: fakeTransport({ calls: [] }),
    });

    expect(reads).toEqual(["incident detection", "history C1"]);
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });
});
