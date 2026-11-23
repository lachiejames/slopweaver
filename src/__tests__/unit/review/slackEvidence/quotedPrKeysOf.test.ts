import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../../corpus/types.js";
import { quotedPrKeysOf } from "../../../../review/slackEvidenceRecord.js";
import { LINKING, slackRecord } from "./harness.js";

describe("quotedPrKeysOf", () => {
  const PERMALINK = "https://x.slack.com/archives/C1/p1";
  const unfurl = ({ url, text, isMessage = true }: { url: string; text: string; isMessage?: boolean }) => ({
    fallback: text,
    from_url: url,
    is_msg_unfurl: isMessage,
    original_url: url,
    text,
  });
  const withAttachments = ({ attachments }: { attachments: readonly unknown[] }): CorpusRecord => ({
    ...slackRecord({ sourceId: "C1:5.0", text: `pls review this <${PERMALINK}>` }),
    raw: { attachments, text: `pls review this <${PERMALINK}>` },
  });

  it("reads the pull requests a quoted message links, from Slack's own unfurl of a permalink the owner wrote", () => {
    const record = withAttachments({ attachments: [unfurl({ text: LINKING, url: PERMALINK })] });
    expect(quotedPrKeysOf({ authoredText: `pls review this <${PERMALINK}>`, record })).toEqual(["o/r#1"]);
  });

  it("ignores a link preview that is not a quoted message, and an unfurl of a URL the owner did not write", () => {
    const record = withAttachments({
      attachments: [
        unfurl({ isMessage: false, text: LINKING, url: PERMALINK }),
        unfurl({ text: LINKING, url: "https://x.slack.com/archives/C1/p999" }),
      ],
    });
    expect(quotedPrKeysOf({ authoredText: `pls review this <${PERMALINK}>`, record })).toEqual([]);
  });
});
