/**
 * How a Canva operation is named, grouped, paged and summarised.
 *
 * The synopsis rule is the one worth the most care here. Twenty-five of the pinned description's fifty-nine
 * operations OPEN with an MDX block, so the obvious "take the first line" rule answers `<Warning>` for a
 * third of the registry — these tests pin the rule that actually holds instead.
 */
import { describe, expect, it } from "vitest";

import {
  CANVA_OPERATION_KINDS,
  canvaFlattenProse,
  canvaKindForScope,
  canvaKindForTag,
  canvaNamesTheUi,
  canvaPagingFor,
  canvaProviderId,
  canvaSynopsisFor,
} from "../../../../atlas/canva/surfaceNaming.js";

describe("canvaKindForTag", () => {
  it("kebab-cases the vendor's own underscore tags", () => {
    expect(canvaKindForTag({ tag: "brand_template" })).toBe("brand-template");
    expect(canvaKindForTag({ tag: "design_import" })).toBe("design-import");
  });

  it("passes a tag that needs no change straight through", () => {
    expect(canvaKindForTag({ tag: "folder" })).toBe("folder");
  });

  it("throws on a tag no kind covers, so a new product area fails the generator", () => {
    expect(() => canvaKindForTag({ tag: "brands" })).toThrow('declares tag "brands", which no kind covers');
  });

  it("declares sixteen kinds, one per tag the vendor's operations actually carry", () => {
    expect(CANVA_OPERATION_KINDS.length).toBe(16);
  });
});

describe("canvaKindForScope", () => {
  it("files a scope under the resource its own prefix names", () => {
    expect(canvaKindForScope({ scope: "folder:permission:write" })).toBe("folder");
    expect(canvaKindForScope({ scope: "brandtemplate:content:read" })).toBe("brand-template");
  });

  it("files the four OpenID Connect scopes under user, the kind whose operations they gate", () => {
    expect(canvaKindForScope({ scope: "openid" })).toBe("user");
    expect(canvaKindForScope({ scope: "profile" })).toBe("user");
    expect(canvaKindForScope({ scope: "email" })).toBe("user");
    expect(canvaKindForScope({ scope: "profile:read" })).toBe("user");
  });

  it("throws on a prefix no kind governs", () => {
    expect(() => canvaKindForScope({ scope: "print:read" })).toThrow('no kind governs scope "print:read"');
  });
});

describe("canvaProviderId", () => {
  it("keys on method and path, leaving out the one constant server", () => {
    expect(canvaProviderId({ method: "GET", path: "/v1/designs/{designId}" })).toBe("GET /v1/designs/{designId}");
  });
});

describe("canvaPagingFor", () => {
  it("needs both halves of the vendor's continuation pair", () => {
    expect(canvaPagingFor({ queryParams: ["continuation"], responseFields: ["continuation", "items"] })).toBe(
      "continuation",
    );
  });

  it("is none when only the query parameter is declared", () => {
    expect(canvaPagingFor({ queryParams: ["continuation"], responseFields: ["items"] })).toBe("none");
  });

  it("is none when only the response field is declared", () => {
    expect(canvaPagingFor({ queryParams: [], responseFields: ["continuation"] })).toBe("none");
  });

  it("is none for a single-shot read", () => {
    expect(canvaPagingFor({ queryParams: ["limit"], responseFields: ["design"] })).toBe("none");
  });
});

describe("canvaFlattenProse", () => {
  it("keeps a markdown link's words and drops its URL", () => {
    expect(canvaFlattenProse({ prose: "a member of a [Canva Enterprise](https://x/) organization." })).toBe(
      "a member of a Canva Enterprise organization.",
    );
  });

  it("collapses the newlines the vendor wraps its prose at", () => {
    expect(canvaFlattenProse({ prose: "one\ntwo\n\n  three  " })).toBe("one two three");
  });
});

describe("canvaSynopsisFor", () => {
  it("takes the first paragraph AFTER the blocks, not the first line", () => {
    const description =
      "<Warning>\n\nThis API is currently provided as a preview.\n\n</Warning>\n\n<Availability>\nEnterprise only.\n</Availability>\n\nGets the aggregated analytics for a design.\n\nThe response includes totals.";
    expect(canvaSynopsisFor({ description, name: "getDesignAnalytics" })).toBe(
      "Gets the aggregated analytics for a design.",
    );
  });

  it("flattens a link inside the paragraph it keeps", () => {
    const description = "Lists designs in a user's [projects](https://www.canva.com/help/).";
    expect(canvaSynopsisFor({ description, name: "listDesigns" })).toBe("Lists designs in a user's projects.");
  });

  it("throws rather than publishing an empty synopsis", () => {
    expect(() => canvaSynopsisFor({ description: "<Note>\nonly a note\n</Note>", name: "someOperation" })).toThrow(
      "someOperation declares no prose outside its MDX blocks",
    );
  });
});

describe("canvaNamesTheUi", () => {
  it("is true when the vendor's own description names the Canva UI", () => {
    expect(canvaNamesTheUi({ description: "you must use the Canva UI to move the item." })).toBe(true);
  });

  it("is false otherwise", () => {
    expect(canvaNamesTheUi({ description: "Moves an item to another folder." })).toBe(false);
  });
});
