/**
 * Which Linear-hosted files a payload addresses — the pure discovery half of `linear read --pdf`.
 *
 * The case that carries the most weight is the off-host one: most `Attachment` rows in a real workspace are
 * external links (a GitHub pull request, a Slack thread), and fetching one means presenting this
 * installation's Linear API key to somebody else's host.
 */
import { describe, expect, it } from "vitest";

import { LINEAR_ASSET_ORIGIN, planLinearAssets } from "../../../../live/linear/assetPlan.js";

/** A real asset path shape: three UUIDs, no filename and no extension. */
const ASSET = `${LINEAR_ASSET_ORIGIN}ff0ccd01-2ff2-41e6-bddd-260893868cd6/08e948bd-5618-48c8-b002-edf08fee6715/e076fbde-5eae-4e73-89f9-01e151e75a19`;
const OTHER = `${LINEAR_ASSET_ORIGIN}aa0ccd01-2ff2-41e6-bddd-260893868cd6/18e948bd-5618-48c8-b002-edf08fee6715/f076fbde-5eae-4e73-89f9-01e151e75a19`;

describe("planLinearAssets", () => {
  it("finds an asset linked from an issue description", () => {
    const planned = planLinearAssets({ data: { description: `see [report](${ASSET})` }, max: 10 });
    expect(planned.urls).toEqual([ASSET]);
    expect(planned.found).toBe(1);
  });

  it("strips the markdown link's closing bracket, which is not part of a UUID", () => {
    const planned = planLinearAssets({ data: { body: `[a](${ASSET}).` }, max: 10 });
    expect(planned.urls).toEqual([ASSET]);
  });

  it("reaches an attachment node nested inside a connection", () => {
    const planned = planLinearAssets({ data: { attachments: { nodes: [{ url: ASSET }] } }, max: 10 });
    expect(planned.urls).toEqual([ASSET]);
  });

  it("REFUSES an off-host attachment url, so the credential is never offered to another host", () => {
    const planned = planLinearAssets({
      data: { attachments: { nodes: [{ url: "https://github.com/lachiejames/slopweaver/pull/1102" }] } },
      max: 10,
    });
    expect(planned.urls).toEqual([]);
    expect(planned.found).toBe(0);
  });

  it("counts one asset once however many fields address it", () => {
    const planned = planLinearAssets({
      data: { comments: { nodes: [{ body: ASSET }] }, description: ASSET },
      max: 10,
    });
    expect(planned.urls).toEqual([ASSET]);
    expect(planned.found).toBe(1);
  });

  it("caps what it returns and still reports how many there were", () => {
    const planned = planLinearAssets({ data: { description: `${ASSET} ${OTHER}` }, max: 1 });
    expect(planned.urls).toEqual([ASSET]);
    expect(planned.found).toBe(2);
  });

  it("answers empty for a payload that addresses nothing", () => {
    const planned = planLinearAssets({ data: { identifier: "SUP-1", title: "no files here" }, max: 10 });
    expect(planned.urls).toEqual([]);
    expect(planned.found).toBe(0);
  });

  it("walks a payload of arrays and nulls without tripping over either", () => {
    const planned = planLinearAssets({ data: [null, [{ deep: { deeper: ASSET } }], undefined], max: 10 });
    expect(planned.urls).toEqual([ASSET]);
  });
});
