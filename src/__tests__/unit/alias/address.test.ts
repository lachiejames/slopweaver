import { describe, expect, it } from "vitest";

import { aliasAddress, isAliasProvider, parseAliasAddress } from "../../../alias/address.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("aliasAddress", () => {
  it("leads with the owner's identity, then the provider, then the seat", () => {
    const claude = unwrap(aliasAddress({ identity: "ada-owner", label: "one", provider: "claude", zone: "acme.com" }));
    const codex = unwrap(aliasAddress({ identity: "ada-owner", label: "one", provider: "codex", zone: "acme.com" }));
    expect([claude.address, codex.address]).toEqual(["ada-owner-claude-one@acme.com", "ada-owner-codex-one@acme.com"]);
    expect(claude.identity).toBe("ada-owner");
    expect(claude.label).toBe("one");
    expect(claude.zone).toBe("acme.com");
  });

  it("refuses an identity carrying a provider segment, which would leave two places to split", () => {
    const failed = unwrapErr(
      aliasAddress({ identity: "claude-smith", label: "one", provider: "claude", zone: "acme.com" }),
    );
    expect(failed.code).toBe("INVALID_LABEL");
    expect(failed.message).toContain("it carries the provider claude");
  });

  it("refuses a label carrying a provider segment for the same reason", () => {
    const failed = unwrapErr(
      aliasAddress({ identity: "seth-brown", label: "codex-two", provider: "claude", zone: "acme.com" }),
    );
    expect(failed.code).toBe("INVALID_LABEL");
    expect(failed.message).toContain("it carries the provider codex");
  });

  it("refuses the label shapes that would not survive being read back", () => {
    const codes = ["", "-one", "one-", "One", "a@b", "one.two", "x".repeat(33)].map(
      (label) => unwrapErr(aliasAddress({ identity: "ada-owner", label, provider: "claude", zone: "acme.com" })).code,
    );
    expect(codes).toEqual(codes.map(() => "INVALID_LABEL"));
  });

  it("holds the identity to the same shape as the label", () => {
    const codes = ["", "-ada", "ada-", "Ada", "a@b", "a.b", "x".repeat(33)].map(
      (identity) => unwrapErr(aliasAddress({ identity, label: "one", provider: "claude", zone: "acme.com" })).code,
    );
    expect(codes).toEqual(codes.map(() => "INVALID_LABEL"));
  });

  it("refuses a zone that is not a dot-joined name", () => {
    const failed = unwrapErr(
      aliasAddress({ identity: "ada-owner", label: "one", provider: "claude", zone: "https://acme.com" }),
    );
    expect(failed.code).toBe("INVALID_LABEL");
  });
});

describe("parseAliasAddress", () => {
  it("reads a provisioned address back into its parts", () => {
    const parsed = unwrap(parseAliasAddress({ address: "seth-brown-codex-two@acme.com" }));
    expect([parsed.identity, parsed.provider, parsed.label, parsed.zone]).toEqual([
      "seth-brown",
      "codex",
      "two",
      "acme.com",
    ]);
  });

  it("refuses an address naming no provider, and one with no zone at all", () => {
    expect(unwrapErr(parseAliasAddress({ address: "hello@acme.com" })).code).toBe("INVALID_LABEL");
    expect(unwrapErr(parseAliasAddress({ address: "ada-owner-claude-one" })).code).toBe("INVALID_LABEL");
  });

  it("refuses the old bare-sequence shape, whose provider is first and names no owner", () => {
    const failed = unwrapErr(parseAliasAddress({ address: "claude-one@acme.com" }));
    expect(failed.code).toBe("INVALID_LABEL");
    expect(failed.message).toContain("the provider is never first or last");
  });

  it("refuses an address with no seat after the provider", () => {
    const failed = unwrapErr(parseAliasAddress({ address: "ada-owner-claude@acme.com" }));
    expect(failed.message).toContain("the provider is never first or last");
  });

  it("refuses an address naming two providers, because the split would be a guess", () => {
    const failed = unwrapErr(parseAliasAddress({ address: "ada-claude-codex-one@acme.com" }));
    expect(failed.message).toContain("names two of them");
  });

  it("round trips every address it builds", () => {
    const built = unwrap(
      aliasAddress({ identity: "calvin-tate", label: "seat-3", provider: "codex", zone: "acme.co.nz" }),
    );
    expect(unwrap(parseAliasAddress({ address: built.address }))).toEqual(built);
  });

  it("keeps a multi-hyphen identity and a multi-hyphen seat on their own sides of the provider", () => {
    const parsed = unwrap(parseAliasAddress({ address: "sadie-anne-wells-claude-seat-two@acme.com" }));
    expect([parsed.identity, parsed.label]).toEqual(["sadie-anne-wells", "seat-two"]);
  });
});

describe("isAliasProvider", () => {
  it("knows the two asked for and nothing else", () => {
    expect(["claude", "codex", "gemini", ""].map((value) => isAliasProvider(value))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
