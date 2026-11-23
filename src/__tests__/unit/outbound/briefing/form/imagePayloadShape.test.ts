/** The exact payload shape an image block's `data:` URI must carry after its header, edge by edge. */
import { describe, expect, it } from "vitest";

import type { BriefingBlock } from "../../../../../outbound/briefing/types.js";
import { withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

/** The refusal an image's `data` meets when it is not the shape. */
const NOT_THE_SHAPE =
  "reactNow.teamFacing.0.detail.blocks.0.data: an image's `data` must be a `data:image/(png|jpeg|gif|webp);base64,…` " +
  "URI. Write `path` instead and let `briefing render` embed the file, or fix the encoding.";

/** Every refusal the form raises for one image block carrying exactly this `data`. */
function refusalsFor({ data }: { data: string }): readonly string[] {
  const blocks: readonly BriefingBlock[] = [{ alt: "a screenshot", data, kind: "image" }];
  return refusals({ form: withCard({ over: { detail: { blocks, summary: "the screenshots" } } }) });
}

describe("an image block's base64 payload", () => {
  it.each([
    ["unpadded", "data:image/png;base64,QUJD"],
    ["one `=` of padding", "data:image/jpeg;base64,QUI="],
    ["two `=` of padding", "data:image/gif;base64,QQ=="],
    ["`+` and `/` from the alphabet", "data:image/webp;base64,+/+/"],
  ])("admits a payload %s", (_label, data) => {
    expect(refusalsFor({ data })).toEqual([]);
  });

  it.each([
    ["with nothing after the header", "data:image/png;base64,"],
    ["that is padding alone", "data:image/png;base64,=="],
    ["with three `=` of padding", "data:image/png;base64,QQ==="],
    ["with a `=` before its end", "data:image/png;base64,QQ=QQ"],
    ["with a non-ASCII character", "data:image/png;base64,QUJé"],
    ["with a trailing newline", "data:image/png;base64,QUJD\n"],
    ["under a type the page cannot embed", "data:image/svg+xml;base64,QUJD"],
  ])("refuses a payload %s", (_label, data) => {
    expect(refusalsFor({ data })).toEqual([NOT_THE_SHAPE]);
  });
});
