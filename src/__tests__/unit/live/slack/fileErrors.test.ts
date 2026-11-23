import { describe, expect, it } from "vitest";

import { SlackFileReadErrors, SlackFileReferenceErrors } from "../../../../live/slack/fileErrors.js";

describe("SlackFileReferenceErrors", () => {
  it("builds FILE_REFERENCE_EMPTY", () => {
    expect(SlackFileReferenceErrors.empty()).toEqual({
      code: "FILE_REFERENCE_EMPTY",
      message: "a Slack file id or file link is required",
    });
  });

  it("builds FILE_REFERENCE_UNPARSEABLE quoting the text and the expected shapes", () => {
    expect(SlackFileReferenceErrors.notAReference({ text: "hello there" })).toEqual({
      code: "FILE_REFERENCE_UNPARSEABLE",
      message: "not a Slack file id or link: hello there (expected F… or a https://…slack.com/… URL)",
      text: "hello there",
    });
  });

  it("builds FILE_REFERENCE_NOT_HTTPS naming the protocol it got", () => {
    expect(SlackFileReferenceErrors.notHttps({ protocol: "http:" })).toEqual({
      code: "FILE_REFERENCE_NOT_HTTPS",
      message: "a Slack file link must be https, got http:",
      protocol: "http:",
    });
  });

  it("builds FILE_REFERENCE_NOT_SLACK_HOST naming the host", () => {
    expect(SlackFileReferenceErrors.notSlackHost({ hostname: "example.com" })).toEqual({
      code: "FILE_REFERENCE_NOT_SLACK_HOST",
      hostname: "example.com",
      message: "example.com is not a Slack host",
    });
  });

  it("builds FILE_REFERENCE_IS_MESSAGE_PERMALINK pointing at read-thread", () => {
    const url = "https://acme.slack.com/archives/C0123/p1700000000000100";
    expect(SlackFileReferenceErrors.isMessagePermalink({ url })).toEqual({
      code: "FILE_REFERENCE_IS_MESSAGE_PERMALINK",
      message:
        "https://acme.slack.com/archives/C0123/p1700000000000100 is a Slack MESSAGE permalink, not a file — read it with `slopweaver slack read-thread`",
      url,
    });
  });

  it("builds FILE_REFERENCE_NO_FILE_ID naming the path searched", () => {
    expect(SlackFileReferenceErrors.noFileId({ pathname: "/team/U0123" })).toEqual({
      code: "FILE_REFERENCE_NO_FILE_ID",
      message: "no Slack file id (F…) anywhere in the path /team/U0123",
      pathname: "/team/U0123",
    });
  });
});

describe("SlackFileReadErrors", () => {
  it("builds FILE_READ_UNUSABLE carrying the reason", () => {
    expect(SlackFileReadErrors.unusableFile({ reason: "no id" })).toEqual({
      code: "FILE_READ_UNUSABLE",
      message: "files.info returned no usable file: no id",
      reason: "no id",
    });
  });

  it("builds FILE_READ_LOOKUP_FAILED rendering an Error cause by its message and keeping the cause", () => {
    const cause = new Error("file_not_found");
    expect(SlackFileReadErrors.lookupFailed({ cause, fileId: "F0ABC" })).toEqual({
      cause,
      code: "FILE_READ_LOOKUP_FAILED",
      fileId: "F0ABC",
      message: "files.info on F0ABC failed: file_not_found",
    });
  });

  it("builds FILE_READ_NO_BODY_URL", () => {
    expect(SlackFileReadErrors.noBodyUrl({ fileId: "F0ABC" })).toEqual({
      code: "FILE_READ_NO_BODY_URL",
      fileId: "F0ABC",
      message: "Slack returned F0ABC with no url_private_download — there are no bytes to read",
    });
  });

  it("builds FILE_READ_NOT_TEXT naming an explicit filetype, and calls an absent one binary", () => {
    expect(SlackFileReadErrors.notText({ fileId: "F0ABC", filetype: "pdf" })).toEqual({
      code: "FILE_READ_NOT_TEXT",
      fileId: "F0ABC",
      filetype: "pdf",
      message:
        "F0ABC is a pdf file, which this verb renders no body for. `slopweaver slack read-thread` downloads attachment bytes from the message that carries them",
    });
    expect(SlackFileReadErrors.notText({ fileId: "F0ABC", filetype: undefined })).toEqual({
      code: "FILE_READ_NOT_TEXT",
      fileId: "F0ABC",
      filetype: undefined,
      message:
        "F0ABC is a binary file, which this verb renders no body for. `slopweaver slack read-thread` downloads attachment bytes from the message that carries them",
    });
  });
});
