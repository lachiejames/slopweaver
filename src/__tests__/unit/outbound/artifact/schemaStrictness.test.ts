import { describe, expect, it } from "vitest";

import { dripArtifactSchema, plainArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";

/**
 * Every outbound form REFUSES an unknown key.
 *
 * This is a CLASS test, not a per-field one. A plain `z.object` drops unrecognised keys, so a typo'd field name
 * validates clean, renders clean, posts clean, and does nothing — which is how `mentions:` instead of `ping:`
 * shipped a poll with no ping and no error anywhere. Every form in the outbound path shared that hole, so the
 * fix and this test cover the whole family rather than the one instance that got caught.
 */
const VALID_UPDATE = {
  citations: [],
  detail: [{ runs: [{ text: "A paragraph.", type: "text" }], type: "paragraph" }],
  kind: "update",
  media: [],
  tldr: "A shipped thing.",
};

describe("outbound form strictness", () => {
  it("the update form accepts its valid shape", () => {
    expect(updateArtifactSchema.safeParse(VALID_UPDATE).success).toBe(true);
  });

  it("the update form REFUSES an unknown top-level key", () => {
    expect(updateArtifactSchema.safeParse({ ...VALID_UPDATE, mentions: [] }).success).toBe(false);
  });

  it("the update form REFUSES an unknown key inside a detail block", () => {
    const withTypo = {
      ...VALID_UPDATE,
      detail: [{ runs: [{ bold: true, text: "x", type: "text" }], style: "loud", type: "paragraph" }],
    };

    expect(updateArtifactSchema.safeParse(withTypo).success).toBe(false);
  });

  it("the update form REFUSES an unknown key inside an inline run", () => {
    const withTypo = {
      ...VALID_UPDATE,
      detail: [{ runs: [{ emphasis: true, text: "x", type: "text" }], type: "paragraph" }],
    };

    expect(updateArtifactSchema.safeParse(withTypo).success).toBe(false);
  });

  it("the update form REFUSES an unknown key inside a citation", () => {
    const withTypo = {
      ...VALID_UPDATE,
      citations: [{ id: "c1", label: "[1]", source: "nope", url: "https://example.com" }],
    };

    expect(updateArtifactSchema.safeParse(withTypo).success).toBe(false);
  });

  it("the drip form REFUSES an unknown key", () => {
    const schema = dripArtifactSchema({ maxMessages: 5, messageVisibleMax: 200 });
    const valid = { kind: "drip", messages: [{ runs: [{ text: "hi", type: "text" }] }] };

    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, tone: "casual" }).success).toBe(false);
  });

  it("the plain form REFUSES an unknown key", () => {
    const schema = plainArtifactSchema({ maxChars: 40_000 });

    expect(schema.safeParse({ kind: "plain", text: "hi" }).success).toBe(true);
    expect(schema.safeParse({ kind: "plain", text: "hi", unfurl: false }).success).toBe(false);
  });
});
