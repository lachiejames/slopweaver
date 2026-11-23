/**
 * The readability probe on one resolved token: history first, because that is the question; the workspace URL
 * second, because only the row's link needs it — so each failure is reported as what it is.
 */
import { describe, expect, it } from "vitest";

import { probeChannelWith } from "../../../../../cli/commands/incident/deps.js";
import { detectExit } from "../../../../../cli/commands/incident/detect.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";

const NOW_MS = Date.parse("2026-10-04T05:00:00.000Z");

/** A seam answering history and auth.test as told, recording the order it was asked in. */
function seam({ history, url }: { history: "ok" | "throws"; url: string | undefined }): {
  api: Pick<SlackApi, "history" | "workspaceUrl">;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    api: {
      history: async ({ channel, latest, pageSize }) => {
        calls.push(`history ${channel} latest=${latest} pageSize=${String(pageSize)}`);
        if (history === "throws") {
          throw new Error("not_in_channel");
        }
        return { messages: [] };
      },
      workspaceUrl: async () => {
        calls.push("auth.test");
        return url;
      },
    },
    calls,
  };
}

describe("probeChannelWith", () => {
  it("reads one message of history, then names the workspace", async () => {
    const { api, calls } = seam({ history: "ok", url: "https://acme.slack.com/" });

    const probe = await probeChannelWith({ api, channelId: "C0LIVE", nowMs: NOW_MS, principal: "user" });

    expect(probe).toEqual({ principal: "user", readable: true, workspaceUrl: "https://acme.slack.com/" });
    expect(calls).toEqual(["history C0LIVE latest=1791090000 pageSize=1", "auth.test"]);
  });

  it("calls a channel the token cannot read unreadable, and never asks for the workspace", async () => {
    const { api, calls } = seam({ history: "throws", url: "https://acme.slack.com/" });

    const probe = await probeChannelWith({ api, channelId: "C0LIVE", nowMs: NOW_MS, principal: "bot" });

    expect(probe).toEqual({ readable: false, why: "not readable by the bot token: not_in_channel" });
    expect(calls).toEqual(["history C0LIVE latest=1791090000 pageSize=1"]);
  });

  it("says a readable channel was readable when only the workspace URL is missing", async () => {
    const { api } = seam({ history: "ok", url: undefined });

    const probe = await probeChannelWith({ api, channelId: "C0LIVE", nowMs: NOW_MS, principal: "user" });

    expect(probe).toEqual({
      readable: false,
      why: "readable by the user token, but auth.test named no workspace URL to link the row from",
    });
  });
});

describe("detectExit", () => {
  it("is ok with channels, expected-empty with none, and an error when the store yielded nothing but warnings", () => {
    expect(detectExit({ judged: 2, rows: 40, warnings: 1 })).toBe(EXIT_OK);
    expect(detectExit({ judged: 0, rows: 40, warnings: 0 })).toBe(EXIT_EXPECTED_EMPTY);
    expect(detectExit({ judged: 0, rows: 0, warnings: 0 })).toBe(EXIT_EXPECTED_EMPTY);
    expect(detectExit({ judged: 0, rows: 0, warnings: 1 })).toBe(EXIT_ERROR);
  });
});
