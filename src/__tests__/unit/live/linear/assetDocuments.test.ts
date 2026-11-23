/**
 * Opening the files a Linear payload addresses — the four outcomes, and the rule that none of them ends
 * the read.
 *
 * Driven over the committed PDF fixtures through the real `openLinearAssets`, with the byte seam supplied
 * as a plain fake function (`testing.md` bans a mock; a seam passed in is not one).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { err, ok } from "../../../../lib/result.js";
import { openLinearAssets } from "../../../../live/linear/assetDocuments.js";
import type { FetchLinearAsset } from "../../../../live/linear/assetFetch.js";
import { LINEAR_ASSET_ORIGIN } from "../../../../live/linear/assetPlan.js";
import { LinearLiveErrors } from "../../../../live/linear/errors.js";

const ASSET = `${LINEAR_ASSET_ORIGIN}ff0ccd01-2ff2-41e6-bddd-260893868cd6/08e948bd-5618-48c8-b002-edf08fee6715/e076fbde-5eae-4e73-89f9-01e151e75a19`;

/** The one-page fixture with a real text layer. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/text-sample.pdf");

/** The two-page fixture drawn without a font, so it has no text layer at all. */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/scanned-sample.pdf");

/** A byte seam that always serves one committed fixture. */
function serving({ fixture }: { fixture: string }): FetchLinearAsset {
  return () => Promise.resolve(ok(new Uint8Array(readFileSync(fixture))));
}

/** A byte seam that always serves these exact bytes. */
function servingBytes({ bytes }: { bytes: Uint8Array }): FetchLinearAsset {
  return () => Promise.resolve(ok(bytes));
}

const ONE_ASSET = { description: `the report: [x](${ASSET})` };

describe("openLinearAssets — the four outcomes", () => {
  it("carries a document's words and its page count", async () => {
    const opened = await openLinearAssets({
      data: ONE_ASSET,
      fetchAsset: serving({ fixture: TEXT_SAMPLE }),
      token: "lin_api_test",
    });
    expect(opened.attachments).toEqual([
      {
        bytes: 600,
        outcome: "read",
        pdf: { glyphless: false, pages: 1, pagesRead: 1, text: "personnel and contractors" },
        url: ASSET,
      },
    ]);
    expect(opened.residue).toEqual([]);
  });

  it("says a scanned document has no text layer rather than reporting an empty one", async () => {
    const opened = await openLinearAssets({
      data: ONE_ASSET,
      fetchAsset: serving({ fixture: SCANNED_SAMPLE }),
      token: "lin_api_test",
    });
    expect(opened.attachments[0]!).toEqual({
      bytes: 588,
      outcome: "read",
      pdf: { glyphless: true, pages: 2, pagesRead: 2, text: undefined },
      url: ASSET,
    });
  });

  it("reports a file that is not a PDF as a fact, not a failure", async () => {
    const opened = await openLinearAssets({
      data: ONE_ASSET,
      fetchAsset: servingBytes({ bytes: new TextEncoder().encode("a screen recording, not a document") }),
      token: "lin_api_test",
    });
    expect(opened.attachments).toEqual([{ bytes: 34, outcome: "not-a-document", url: ASSET }]);
    expect(opened.residue).toEqual([]);
  });

  it("keeps the byte count when bytes arrive and will not parse, and names the reason", async () => {
    const opened = await openLinearAssets({
      data: ONE_ASSET,
      fetchAsset: servingBytes({ bytes: new TextEncoder().encode("%PDF-1.4\nnot actually a pdf body\n") }),
      token: "lin_api_test",
    });
    expect(opened.attachments[0]!.outcome).toBe("unreadable");
    expect(opened.attachments[0]!).toMatchObject({ bytes: 33, url: ASSET });
    expect(opened.residue[0]!).toContain("bytes retrieved, text not");
  });

  it("names an asset that never arrived, and does not end the read", async () => {
    const opened = await openLinearAssets({
      data: ONE_ASSET,
      fetchAsset: () => Promise.resolve(err(LinearLiveErrors.assetUnreachable({ reason: "HTTP 401", url: ASSET }))),
      token: "lin_api_test",
    });
    expect(opened.attachments).toEqual([{ outcome: "unfetched", reason: `${ASSET}: HTTP 401`, url: ASSET }]);
    expect(opened.residue[0]!).toContain("not fetched");
  });

  it("opens nothing, and says nothing, for a payload that addresses no file", async () => {
    const opened = await openLinearAssets({
      data: { identifier: "SUP-1" },
      fetchAsset: serving({ fixture: TEXT_SAMPLE }),
      token: "lin_api_test",
    });
    expect(opened.attachments).toEqual([]);
    expect(opened.residue).toEqual([]);
  });
});
