import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { isSlackFileId, parseSlackFileReference } from "../../../../live/slack/fileReference.js";

describe("isSlackFileId", () => {
  it("accepts a real file id", () => {
    expect(isSlackFileId({ value: "F0BTACLP1D0" })).toBe(true);
  });

  it("rejects a bare F, which is not long enough to be an id", () => {
    expect(isSlackFileId({ value: "F" })).toBe(false);
  });

  it("rejects a conversation id, which starts with the wrong letter", () => {
    expect(isSlackFileId({ value: "C0BTACLP" })).toBe(false);
  });
});

describe("parseSlackFileReference", () => {
  it("passes a bare file id straight through", () => {
    const parsed = parseSlackFileReference({ reference: "  F0BTACLP1D0  " });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toBe("F0BTACLP1D0");
  });

  it("reads the id out of a /docs/ canvas link — the shape the Files browser copies", () => {
    const parsed = parseSlackFileReference({ reference: "https://example.slack.com/docs/T0SYN1234567/F0BTACLP1D0" });
    expect(unwrap(parsed)).toBe("F0BTACLP1D0");
  });

  it("reads the id out of a /files/ upload link, ignoring the trailing filename", () => {
    const parsed = parseSlackFileReference({
      reference: "https://example.slack.com/files/U0AB12CD/F0BTACLP1D0/diagram.png",
    });
    expect(unwrap(parsed)).toBe("F0BTACLP1D0");
  });

  it("reads the id out of a files-pri host URL, where it is half of one segment", () => {
    const parsed = parseSlackFileReference({
      reference: "https://files.slack.com/files-pri/T0SYN1234567-F0BTACLP1D0/download/canvas",
    });
    expect(unwrap(parsed)).toBe("F0BTACLP1D0");
  });

  it("names a MESSAGE permalink specifically, pointing at the verb that reads one", () => {
    const parsed = parseSlackFileReference({
      reference: "https://example.slack.com/archives/C0123456/p1785114398557099",
    });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("FILE_REFERENCE_IS_MESSAGE_PERMALINK");
    expect(parsed._unsafeUnwrapErr().message).toContain("read-thread");
  });

  it("refuses a Slack URL with no file id anywhere in the path", () => {
    const parsed = parseSlackFileReference({ reference: "https://example.slack.com/home" });
    expect(parsed._unsafeUnwrapErr().code).toBe("FILE_REFERENCE_NO_FILE_ID");
  });

  it("refuses a non-Slack host, which must never receive the token", () => {
    const parsed = parseSlackFileReference({ reference: "https://evil.example.com/files/U1/F0BTACLP1D0" });
    expect(parsed._unsafeUnwrapErr().code).toBe("FILE_REFERENCE_NOT_SLACK_HOST");
  });

  it("refuses a host that merely ENDS with slack.com, which a suffix test would have accepted", () => {
    const parsed = parseSlackFileReference({ reference: "https://evilslack.com/files/U1/F0BTACLP1D0" });
    expect(parsed._unsafeUnwrapErr().code).toBe("FILE_REFERENCE_NOT_SLACK_HOST");
  });

  it("accepts slack.com itself, not only its subdomains", () => {
    const parsed = parseSlackFileReference({ reference: "https://slack.com/files/U1/F0BTACLP1D0/x.png" });
    expect(unwrap(parsed)).toBe("F0BTACLP1D0");
  });

  it("refuses plain http", () => {
    const parsed = parseSlackFileReference({ reference: "http://example.slack.com/docs/T1/F0BTACLP1D0" });
    expect(parsed._unsafeUnwrapErr().code).toBe("FILE_REFERENCE_NOT_HTTPS");
  });

  it("refuses text that is neither an id nor a URL", () => {
    const parsed = parseSlackFileReference({ reference: "the huddle from yesterday" });
    expect(parsed._unsafeUnwrapErr().code).toBe("FILE_REFERENCE_UNPARSEABLE");
  });

  it("refuses an empty reference", () => {
    expect(parseSlackFileReference({ reference: "   " })._unsafeUnwrapErr().code).toBe("FILE_REFERENCE_EMPTY");
  });
});
