import { describe, expect, it } from "vitest";
import {
  SlackLifecycleErrors,
  slackLifecycleErrorLines,
} from "../../../../../../cli/commands/slack/lifecycleErrors.js";
import { releaseIdentityRefusal } from "../../../../../../cli/commands/slack/releaseRow.js";
import type { ParkedSlackDraft } from "../../../../../../outbound/slack/draftRegister.js";
import { heldRow } from "./fixtures.js";

describe("releaseIdentityRefusal — a finding shared in a channel goes out as the bot", () => {
  const finding: ParkedSlackDraft = { ...heldRow(), channel: "C0SYN000008", why: "hunt finding, blast radius 40" };
  const bot: ParkedSlackDraft = { ...finding, actor: "bot", kind: "finding" };

  it("sends a row under the identity it was recorded as, and refuses the other by name", () => {
    expect([
      releaseIdentityRefusal({ actor: "me", draft: heldRow() }),
      releaseIdentityRefusal({ actor: "bot", draft: bot }),
    ]).toEqual([undefined, undefined]);
    expect(releaseIdentityRefusal({ actor: "me", draft: bot })).toEqual(
      SlackLifecycleErrors.draftActorMismatch({
        command: `slopweaver slack post --as bot --draft sd-1a2b3c4d --approve ${bot.digest}`,
        draftId: "sd-1a2b3c4d",
        recorded: "bot",
      }),
    );
    expect(releaseIdentityRefusal({ actor: "bot", draft: heldRow() })!.code).toBe("DRAFT_ACTOR_MISMATCH");
  });

  it("refuses an as-me top-level finding in a channel, naming the re-record as the bot's post", () => {
    const refusal = releaseIdentityRefusal({ actor: "me", draft: finding })!;
    expect(refusal.code).toBe("DRAFT_FINDING_IDENTITY");
    expect(slackLifecycleErrorLines({ error: refusal })[2]).toBe(
      "Re-record it as the bot's post, which drops this row as it parks: `slopweaver slack draft record --as bot " +
        '--channel C0SYN000008 --form - --why "<…>" --media a,b,c --supersedes sd-1a2b3c4d` with a `finding` form.',
    );
  });

  it("lets an as-me finding through where the bot cannot post: a DM, a thread the owner is in, a recorded reason", () => {
    expect([
      releaseIdentityRefusal({ actor: "me", draft: { ...finding, channel: "D0DM" } }),
      releaseIdentityRefusal({ actor: "me", draft: { ...finding, shape: "thread", threadTs: "1789407961.767649" } }),
      releaseIdentityRefusal({ actor: "me", draft: { ...finding, botCannotPost: "not-in-channel" } }),
      releaseIdentityRefusal({ actor: "me", draft: { ...finding, kind: "message" } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
