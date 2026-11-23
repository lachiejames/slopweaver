import { describe, expect, it } from "vitest";

import { releaseJoinActionId, releaseJoinRow } from "../../../../cli/commands/slack/releaseJoin.js";
import { unwrap } from "../../../../lib/result.js";
import {
  type ChannelAccess,
  ChannelJoinErrors,
  channelJoinDecision,
  channelLabel,
} from "../../../../outbound/slack/channelJoin.js";
import type { ParkedSlackDraft } from "../../../../outbound/slack/draftRegister.js";

const OUTSIDE_PUBLIC: ChannelAccess = { isMember: false, name: "ask-product-help", surface: "public-channel" };

function decide({ access, approved = true }: { access: ChannelAccess; approved?: boolean }): unknown {
  return channelJoinDecision({ access, approved, channel: "C0SYN000013", draftId: "sd-fbbe54a2" });
}

describe("channelJoinDecision", () => {
  it("joins a public channel the owner is not in when the row carries their yes", () => {
    expect(decide({ access: OUTSIDE_PUBLIC })).toEqual({ kind: "join", name: "ask-product-help" });
  });

  it("joins nothing when the owner is already a member", () => {
    expect(decide({ access: { ...OUTSIDE_PUBLIC, isMember: true } })).toEqual({ kind: "no-join" });
  });

  it("joins nothing on a membership the read did not answer, rather than acting on a guess", () => {
    expect(decide({ access: { ...OUTSIDE_PUBLIC, isMember: undefined } })).toEqual({ kind: "no-join" });
  });

  it("never joins a direct message", () => {
    expect(decide({ access: { isMember: false, name: undefined, surface: "direct-message" } })).toEqual({
      kind: "no-join",
    });
  });

  it("refuses a private channel with the reason, even with the owner's yes", () => {
    expect(decide({ access: { ...OUTSIDE_PUBLIC, name: "secret", surface: "private-channel" } })).toEqual({
      error: ChannelJoinErrors.privateChannel({ channel: "C0SYN000013", label: "#secret" }),
      kind: "refuse",
    });
  });

  it("refuses a channel whose kind did not read, naming it by id when no name came back", () => {
    expect(decide({ access: { isMember: false, name: undefined, surface: undefined } })).toEqual({
      error: ChannelJoinErrors.surfaceUnknown({ channel: "C0SYN000013", label: "C0SYN000013" }),
      kind: "refuse",
    });
  });

  it("refuses a row with no yes from the owner, naming the approve command", () => {
    const decision = decide({ access: OUTSIDE_PUBLIC, approved: false });
    expect(decision).toEqual({
      error: ChannelJoinErrors.notApproved({
        channel: "C0SYN000013",
        draftId: "sd-fbbe54a2",
        label: "#ask-product-help",
      }),
      kind: "refuse",
    });
    expect(ChannelJoinErrors.notApproved({ channel: "C1", draftId: "sd-1", label: "#x" }).message).toContain(
      "slopweaver slack draft approve sd-1 --anchor",
    );
  });
});

describe("channelLabel", () => {
  it("prefers the name, else the id", () => {
    expect(channelLabel({ channel: "C1", name: "dev" })).toBe("#dev");
    expect(channelLabel({ channel: "C1", name: undefined })).toBe("C1");
  });
});

describe("releaseJoinRow", () => {
  const draft: Pick<ParkedSlackDraft, "approval" | "id"> = {
    approval: { anchor: "talk:e64310b5", atIso: "2026-10-12T01:42:18.833Z", heard: "just send it" },
    id: "sd-fbbe54a2",
  };

  it("builds a row the ledger accepts, its subject a link to the channel and its why naming the owner's yes", () => {
    const row = unwrap(
      releaseJoinRow({
        bySession: "session-a",
        channel: "C0SYN000013",
        draft,
        label: "#ask-product-help",
        nowIso: "2026-10-12T08:00:00.000Z",
        workspaceUrl: "https://acme.slack.com",
      }),
    );
    expect(row.actionId).toBe("slack-join-c0syn000013-for-sd-fbbe54a2");
    expect(row.kind).toBe("slack-join-public-channel");
    expect(row.subject).toBe("https://acme.slack.com/archives/C0SYN000013");
    expect(row.why).toContain("talk:e64310b5");
  });

  it("keys one id per channel and row, so a re-run appends nothing new", () => {
    expect(releaseJoinActionId({ channel: "C0ABC", draftId: "sd-1" })).toBe(
      releaseJoinActionId({ channel: "C0ABC", draftId: "sd-1" }),
    );
    expect(releaseJoinActionId({ channel: "C0ABC", draftId: "sd-2" })).not.toBe(
      releaseJoinActionId({ channel: "C0ABC", draftId: "sd-1" }),
    );
  });
});
