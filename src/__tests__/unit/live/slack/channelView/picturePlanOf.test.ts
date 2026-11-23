/*
 * Which preview the live channel window fetches for a file, and why every other file is drawn as a card. It was
 * split out when the channel-window suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";
import { picturePlanOf } from "../../../../../live/slack/channelView.js";

describe("picturePlanOf", () => {
  const base = { id: "F0ONE", isExternal: false, mimetype: "image/png", name: "graph.png" } as const;

  it("fetches the 480 preview when Slack gives one", () => {
    expect(
      picturePlanOf({
        file: { ...base, thumb360Url: "https://files.slack.com/360", thumb480Url: "https://files.slack.com/480" },
      }),
    ).toEqual({
      kind: "fetch",
      url: "https://files.slack.com/480",
      variant: "thumb-480",
    });
  });

  it("falls to the 360 preview when there is no 480", () => {
    expect(picturePlanOf({ file: { ...base, thumb360Url: "https://files.slack.com/360" } })).toEqual({
      kind: "fetch",
      url: "https://files.slack.com/360",
      variant: "thumb-360",
    });
  });

  it("says why each other file is a card", () => {
    const thumb = { thumb480Url: "https://files.slack.com/480" };
    expect(picturePlanOf({ file: { ...base, ...thumb, mode: "tombstone" } })).toEqual({
      kind: "card",
      reason: "deleted",
    });
    expect(picturePlanOf({ file: { ...base, ...thumb, isExternal: true } })).toEqual({
      kind: "card",
      reason: "external",
    });
    expect(picturePlanOf({ file: { ...base, ...thumb, fileAccess: "check_file_info" } })).toEqual({
      kind: "card",
      reason: "no-access",
    });
    expect(picturePlanOf({ file: { ...base, ...thumb, mimetype: "application/pdf" } })).toEqual({
      kind: "card",
      reason: "not-a-picture",
    });
    expect(picturePlanOf({ file: { id: "F0TWO", isExternal: false } })).toEqual({
      kind: "card",
      reason: "not-a-picture",
    });
    expect(picturePlanOf({ file: base })).toEqual({ kind: "card", reason: "no-preview" });
  });

  it("fetches a file whose access is plainly visible", () => {
    expect(
      picturePlanOf({ file: { ...base, fileAccess: "visible", thumb480Url: "https://files.slack.com/480" } }).kind,
    ).toBe("fetch");
  });
});
