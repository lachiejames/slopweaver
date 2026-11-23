import { describe, expect, it } from "vitest";
import { blockFileRefId, slackFileRefId, slackFileUrls } from "../../../../live/slack/fileUrls.js";

describe("slackFileRefId", () => {
  it("reads the id, else the id inside a private file URL", () => {
    expect([
      slackFileRefId({ ref: { id: "F0BYID" } }),
      slackFileRefId({ ref: { url: "https://files.slack.com/files-pri/T012-F0BYURL/graph.png" } }),
    ]).toEqual(["F0BYID", "F0BYURL"]);
  });

  it("keeps a URL with no recognisable id as the URL, so the lookup refuses it out loud", () => {
    expect(slackFileRefId({ ref: { url: "https://example.com/graph.png" } })).toBe("https://example.com/graph.png");
  });

  it("names nothing for an object with neither", () => {
    expect(slackFileRefId({ ref: { alt: "x" } })).toBe(undefined);
  });
});

describe("blockFileRefId", () => {
  it("reads an image block's slack_file and a rich-text file element", () => {
    expect([
      blockFileRefId({ node: { slack_file: { id: "F0IMG" }, type: "image" } }),
      blockFileRefId({ node: { file_id: "F0RICH", type: "file" } }),
    ]).toEqual(["F0IMG", "F0RICH"]);
  });

  it("names nothing for a node that references no file", () => {
    expect([
      blockFileRefId({ node: { text: "hi", type: "text" } }),
      blockFileRefId({ node: { file_id: "F0NOTFILE", type: "section" } }),
      blockFileRefId({ node: { type: "file" } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("slackFileUrls", () => {
  it("keeps the explicit download URL and both previews", () => {
    expect(
      slackFileUrls({
        raw: {
          thumb_360: "https://files.slack.com/360",
          thumb_480: "https://files.slack.com/480",
          url_private: "https://files.slack.com/in-place",
          url_private_download: "https://files.slack.com/download",
        },
      }),
    ).toEqual({
      thumb360Url: "https://files.slack.com/360",
      thumb480Url: "https://files.slack.com/480",
      urlPrivateDownload: "https://files.slack.com/download",
    });
  });

  it("falls to the in-place URL when Slack gives no download form", () => {
    expect(slackFileUrls({ raw: { url_private: "https://files.slack.com/in-place" } })).toEqual({
      urlPrivateDownload: "https://files.slack.com/in-place",
    });
  });

  it("carries no key for a URL Slack did not give, or gave empty", () => {
    expect(slackFileUrls({ raw: { thumb_480: "", url_private_download: 7 } })).toEqual({});
  });
});
