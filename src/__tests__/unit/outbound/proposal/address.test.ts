/** A published proposal's provider-tagged address: the strict parser, the Notion constructor, and the label. */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  addressIdentityKey,
  addressLabel,
  notionPageAddress,
  parseProposalAddress,
} from "../../../../outbound/proposal/address.js";
import { proposalDestinationProvider } from "../../../../outbound/proposal/destination.js";

describe("parseProposalAddress", () => {
  it("reads a well-formed address, with or without a URL", () => {
    expect(unwrap(parseProposalAddress({ raw: { id: "doc-1", provider: "linear" } }))).toEqual({
      id: "doc-1",
      provider: "linear",
    });
    expect(unwrap(parseProposalAddress({ raw: { id: "p", provider: "local", url: "file:///p/index.html" } }))).toEqual({
      id: "p",
      provider: "local",
      url: "file:///p/index.html",
    });
  });

  it("refuses an unknown provider, naming the field", () => {
    expect(unwrapErr(parseProposalAddress({ raw: { id: "x", provider: "confluence" } }))[0]).toContain("provider: ");
  });

  it("refuses an empty id, naming the field", () => {
    expect(unwrapErr(parseProposalAddress({ raw: { id: "", provider: "notion" } }))[0]).toContain("id: ");
  });

  it("refuses Unicode whitespace in an id, U+0085 included", () => {
    expect(unwrapErr(parseProposalAddress({ raw: { id: "a\u0085b", provider: "notion" } }))).toEqual([
      "id: must not contain whitespace",
    ]);
  });

  it("refuses an undeclared key rather than dropping it", () => {
    expect(unwrapErr(parseProposalAddress({ raw: { id: "x", pageId: "x", provider: "notion" } })).join("; ")).toContain(
      "pageId",
    );
  });
});

describe("notionPageAddress", () => {
  it("tags a page id and its URL as a Notion address", () => {
    expect(notionPageAddress({ pageId: "page-1", pageUrl: "https://www.notion.so/page1" })).toEqual({
      id: "page-1",
      provider: "notion",
      url: "https://www.notion.so/page1",
    });
  });

  it("carries no url key at all when none was reported", () => {
    expect(Object.keys(notionPageAddress({ pageId: "page-1", pageUrl: undefined })).toSorted()).toEqual([
      "id",
      "provider",
    ]);
  });
});

describe("addressLabel", () => {
  it("prints the URL when there is one", () => {
    expect(addressLabel({ address: { id: "p", provider: "notion", url: "https://www.notion.so/p" } })).toBe(
      "https://www.notion.so/p",
    );
  });

  it("prints provider:id when the destination handed back no URL", () => {
    expect(addressLabel({ address: { id: "doc-1", provider: "linear" } })).toBe("linear:doc-1");
  });
});

describe("addressIdentityKey", () => {
  it("keys both spellings of one Notion page id identically, in either case", () => {
    const dashed = addressIdentityKey({ address: { id: "01234567-89AB-cdef-0123-456789abcdef", provider: "notion" } });
    const compact = addressIdentityKey({ address: { id: "0123456789abcdef0123456789abcdef", provider: "notion" } });
    expect(dashed).toBe("notion:0123456789abcdef0123456789abcdef");
    expect(compact).toBe(dashed);
  });

  it("keys another provider's id as written, so a dash or case difference stays distinct", () => {
    expect(addressIdentityKey({ address: { id: "Doc-1", provider: "linear" } })).toBe("linear:Doc-1");
  });

  it("never keys two providers sharing an id together", () => {
    expect(addressIdentityKey({ address: { id: "abc", provider: "local" } })).not.toBe(
      addressIdentityKey({ address: { id: "abc", provider: "notion" } }),
    );
  });
});

describe("proposalDestinationProvider", () => {
  it("names the provider a notion-page destination publishes onto", () => {
    expect(proposalDestinationProvider({ destination: { kind: "notion-page", parent: "p", schemaVersion: 1 } })).toBe(
      "notion",
    );
  });
});
