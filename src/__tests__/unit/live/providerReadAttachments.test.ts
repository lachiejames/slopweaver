/**
 * The attachment block in a provider read's DEFAULT output.
 *
 * These exist because of the defect they hold down rather than for coverage. A field added to
 * `ProviderReadDocument` and not to `renderProviderReadText` is bytes fetched whose words never reach the
 * reader — `--json` would carry them and the human path would not, which is the worse half of the two to
 * get wrong. That is the Slack defect restated one layer up, so every arm is asserted on the rendered
 * text, not on the document.
 */
import { describe, expect, it } from "vitest";

import {
  type ProviderReadAttachment,
  type ProviderReadDocument,
  renderProviderReadText,
} from "../../../live/providerRead.js";
import { GLYPHLESS_LINE } from "../../../pdf/limits.js";

const URL = "https://uploads.linear.app/a/b/c";

/** One rendered document carrying exactly these attachments. */
function rendered({ attachments }: { attachments: readonly ProviderReadAttachment[] | undefined }): string {
  const document: ProviderReadDocument = {
    ...(attachments === undefined ? {} : { attachments }),
    coverage: { detail: "one named object", kind: "bounded", residue: [] },
    data: { identifier: "SUP-1" },
    readAtIso: "2026-09-22T02:00:00.000Z",
    source: "linear",
    target: { address: "SUP-1", identity: "SUP-1", kind: "issue" },
  };
  return renderProviderReadText({ document });
}

describe("renderProviderReadText — the attachment block", () => {
  it("prints a document's words, which is the whole reason the bytes were fetched", () => {
    const text = rendered({
      attachments: [
        { bytes: 600, outcome: "read", pdf: { glyphless: false, pages: 3, pagesRead: 3, text: "the body" }, url: URL },
      ],
    });
    expect(text).toContain("attachments: 1");
    expect(text).toContain("3/3 page(s) read");
    expect(text).toContain("the body");
  });

  it("says a page cap bit, by printing both numbers rather than one", () => {
    const text = rendered({
      attachments: [
        { bytes: 600, outcome: "read", pdf: { glyphless: false, pages: 120, pagesRead: 50, text: "x" }, url: URL },
      ],
    });
    expect(text).toContain("50/120 page(s) read");
  });

  it("prints the glyphless line for a scan instead of an empty body", () => {
    const text = rendered({
      attachments: [
        { bytes: 900, outcome: "read", pdf: { glyphless: true, pages: 2, pagesRead: 2, text: undefined }, url: URL },
      ],
    });
    expect(text).toContain(GLYPHLESS_LINE);
  });

  it("reports a file that is not a PDF without calling it a failure", () => {
    const text = rendered({ attachments: [{ bytes: 4096, outcome: "not-a-document", url: URL }] });
    expect(text).toContain("4096 bytes, not a PDF");
  });

  it("says the bytes arrived when only the text did not", () => {
    const text = rendered({
      attachments: [{ bytes: 33, outcome: "unreadable", reason: "no pdf trailer", url: URL }],
    });
    expect(text).toContain("33 bytes retrieved, text not: no pdf trailer");
  });

  it("names an asset that never arrived", () => {
    const text = rendered({ attachments: [{ outcome: "unfetched", reason: "HTTP 401", url: URL }] });
    expect(text).toContain("not fetched: HTTP 401");
  });

  it("tells 'nobody asked' apart from 'asked, and there were none'", () => {
    expect(rendered({ attachments: undefined })).not.toContain("attachments:");
    expect(rendered({ attachments: [] })).toContain("attachments: none addressed by this payload");
  });

  it("still prints the payload under the block, so the block never displaces the read", () => {
    const text = rendered({ attachments: [{ outcome: "unfetched", reason: "HTTP 401", url: URL }] });
    expect(text).toContain('"identifier": "SUP-1"');
  });
});
