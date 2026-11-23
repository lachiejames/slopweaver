import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { slackLifecycleErrorLines } from "../../../../../../cli/commands/slack/lifecycleErrors.js";
import { resolveDraftRelease } from "../../../../../../cli/commands/slack/releaseRun.js";
import { ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import type { ParkedSlackDraft } from "../../../../../../outbound/slack/draftRegister.js";
import { storeAnnotatedShot } from "../../../../../annotatedShotFixture.js";
import { heldRow, logOf, releaseOf, verifiedOf } from "./fixtures.js";

describe("resolveDraftRelease — a stamped as-me channel finding re-reads that the bot still cannot post", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "release-stamped-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * The stamped row, carrying a real annotated screenshot in `home`: it declares no kind, so it is held as a finding and
   * carries the proof one owes, and as a first message in a channel it carries that receipt too.
   */
  function stampedIn({ home: at }: { home: string }): ParkedSlackDraft {
    const shot = storeAnnotatedShot({ home: at });
    return {
      ...heldRow({ media: [shot], text: "12 users could not check out <https://grafana.example.com/d/pool|pool>" }),
      botCannotPost: "not-in-channel",
      channel: "G0SYNPRIVATE",
      impact: "12 users could not check out",
      why: "hunt finding, blast radius 12",
    };
  }

  /** A release of the stamped row where the conversation now reads as `surface` and the bot as `membership`. */
  async function releaseWith({
    membership,
    surface,
  }: {
    membership: "member" | "not-member" | "unknown";
    surface: "private-channel" | "public-channel";
  }): Promise<{ asked: string[]; resolved: Awaited<ReturnType<typeof resolveDraftRelease>> }> {
    const asked: string[] = [];
    const stamped = stampedIn({ home });
    const resolved = await resolveDraftRelease({
      deps: {
        botMembership: async ({ channel, token }) => {
          asked.push(`${channel} ${token}`);
          return membership;
        },
        botToken: () => "xoxb-bot",
        conversationGroupDm: async () => undefined,
        conversationSurface: async () => surface,
        doorEnv: () => ({}),
        readDraftLog: () => logOf({ row: stamped }),
        readDraftMedia: ({ media }) => ok(media.map((record) => verifiedOf({ record }))),
      },
      options: { ...releaseOf({ approve: stamped.digest }), home },
      token: "xoxp-test",
    });
    return { asked, resolved };
  }

  it("releases it while the bot is still not in the private channel, asking under the bot token", async () => {
    const { asked, resolved } = await releaseWith({ membership: "not-member", surface: "private-channel" });
    expect(unwrap(resolved).drip.channel).toBe("G0SYNPRIVATE");
    expect(asked).toEqual(["G0SYNPRIVATE xoxb-bot"]);
  });

  it("refuses it once the bot has been invited since the owner approved, naming the re-record", async () => {
    const { resolved } = await releaseWith({ membership: "member", surface: "private-channel" });
    const lines = slackLifecycleErrorLines({ error: unwrapErr(resolved) });
    expect(unwrapErr(resolved).code).toBe("DRAFT_FINDING_IDENTITY");
    expect(lines.some((line) => line.includes("the bot is in G0SYNPRIVATE"))).toBe(true);
    expect(lines.at(-1)).toContain("--supersedes sd-1a2b3c4d");
  });

  it("refuses it once the channel reads public, without asking the bot's membership", async () => {
    const { asked, resolved } = await releaseWith({ membership: "not-member", surface: "public-channel" });
    expect(unwrapErr(resolved).code).toBe("DRAFT_FINDING_IDENTITY");
    expect(asked).toEqual([]);
  });

  it("refuses it when the membership read cannot say", async () => {
    const { resolved } = await releaseWith({ membership: "unknown", surface: "private-channel" });
    expect(unwrapErr(resolved).code).toBe("DRAFT_FINDING_IDENTITY");
  });
});
