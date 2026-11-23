import { describe, expect, it } from "vitest";
import { channelMentionText, resolveSpecialRef, userMentionText } from "../../../../corpus/slack/refLabels.js";

describe("userMentionText", () => {
  it("renders the name it was given", () => {
    expect(userMentionText({ name: "Ada" })).toBe("Ada");
  });

  it("renders the generic `user` when nothing names the user", () => {
    expect(userMentionText({ name: undefined })).toBe("user");
  });

  it("keeps an empty name rather than replacing it", () => {
    expect(userMentionText({ name: "" })).toBe("");
  });
});

describe("channelMentionText", () => {
  it("renders the name it was given", () => {
    expect(channelMentionText({ name: "releases" })).toBe("releases");
  });

  it("renders the generic `channel` when nothing names the channel", () => {
    expect(channelMentionText({ name: undefined })).toBe("channel");
  });

  it("keeps an empty name rather than replacing it", () => {
    expect(channelMentionText({ name: "" })).toBe("");
  });
});

describe("resolveSpecialRef", () => {
  it("renders a broadcast as itself", () => {
    expect(resolveSpecialRef({ label: undefined, ref: "!here", usergroupHandles: undefined })).toBe("@here");
  });

  it("names a bare usergroup from the corpus's handle map", () => {
    expect(
      resolveSpecialRef({ label: undefined, ref: "!subteam^S0GROUP", usergroupHandles: { S0GROUP: "platform" } }),
    ).toBe("@platform");
  });

  it("renders a bare usergroup the map has never seen as the generic @group", () => {
    expect(resolveSpecialRef({ label: undefined, ref: "!subteam^S0GROUP", usergroupHandles: {} })).toBe("@group");
    expect(resolveSpecialRef({ label: undefined, ref: "!subteam^S0GROUP", usergroupHandles: undefined })).toBe(
      "@group",
    );
  });

  it("uses a label as sent, adding one `@` only when it has none", () => {
    expect(resolveSpecialRef({ label: "@platform", ref: "!subteam^S0GROUP", usergroupHandles: undefined })).toBe(
      "@platform",
    );
    expect(resolveSpecialRef({ label: "platform", ref: "!subteam^S0GROUP", usergroupHandles: undefined })).toBe(
      "@platform",
    );
  });
});
