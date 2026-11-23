/** Deriving a register slug — the one identity question this domain has to get right. */
import { describe, expect, it } from "vitest";
import type { ProposalAddress } from "../../../../../outbound/proposal/address.js";
import { deriveRegisterSlug } from "../../../../../outbound/proposal/register/identity.js";

const NOTION: ProposalAddress = { id: "00000000-0000-0000-0000-00000000a001", provider: "notion" };

describe("deriveRegisterSlug", () => {
  it("reuses the intake id verbatim when one is given, ignoring title and page id entirely", () => {
    expect(
      deriveRegisterSlug({
        intakeId: "an-intake-abc12",
        address: { id: "0000000000000000000000000000a001", provider: "notion" },
        title: "Something else",
      }),
    ).toBe("an-intake-abc12");
  });

  it("combines a slugified title stem with the compact page id when there is no intake", () => {
    const slug = deriveRegisterSlug({
      intakeId: undefined,
      address: NOTION,
      title: "CI Pressure, Local Checks & Merge Queue",
    });
    expect(slug).toBe("ci-pressure-local-checks-merge-queue-0000000000000000000000000000a001");
  });

  it("falls back to the bare compact page id when there is no title at all", () => {
    expect(deriveRegisterSlug({ intakeId: undefined, address: NOTION, title: undefined })).toBe(
      "0000000000000000000000000000a001",
    );
  });

  it("falls back to the bare compact page id when the title has no alphanumeric characters", () => {
    expect(deriveRegisterSlug({ intakeId: undefined, address: NOTION, title: "!!!" })).toBe(
      "0000000000000000000000000000a001",
    );
  });

  it("stays within the 80-character filename-safe cap even for a very long title", () => {
    const long =
      "This is an extremely long proposal title that keeps going and going and going and would overflow the cap";
    const slug = deriveRegisterSlug({
      intakeId: undefined,
      address: NOTION,
      title: long,
    });
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("0000000000000000000000000000a001")).toBe(true);
  });

  it("two different titles over the same page id always produce the same slug (idempotent on re-sync)", () => {
    const first = deriveRegisterSlug({
      intakeId: undefined,
      address: NOTION,
      title: "Original Title",
    });
    const second = deriveRegisterSlug({
      intakeId: undefined,
      address: NOTION,
      title: "Original Title",
    });
    expect(first).toBe(second);
  });

  it("prefixes a non-Notion id with its provider, so equal ids on two providers never share a slug", () => {
    const linear = deriveRegisterSlug({
      address: { id: "00000000-0000-0000-0000-00000000a001", provider: "linear" },
      intakeId: undefined,
      title: "Same Title",
    });
    expect(linear).toBe("same-title-linear-0000000000000000000000000000a001");
    expect(deriveRegisterSlug({ address: NOTION, intakeId: undefined, title: "Same Title" })).toBe(
      "same-title-0000000000000000000000000000a001",
    );
  });
});
