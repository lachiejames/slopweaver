import { describe, expect, it } from "vitest";

import { previewAddress } from "../../../../../cli/commands/notion/previewAddress.js";

const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";

describe("previewAddress", () => {
  it("names the resolved id over the address as typed", () => {
    expect(previewAddress({ resolved: PAGE, typed: "https://www.notion.so/x" })).toBe(PAGE);
  });

  it("names the address as typed when it did not resolve", () => {
    expect(previewAddress({ resolved: undefined, typed: "https://www.notion.so/x" })).toBe("https://www.notion.so/x");
  });

  it("says unresolved when there is neither", () => {
    expect(previewAddress({ resolved: undefined, typed: undefined })).toBe("(unresolved)");
  });

  it("keeps an empty typed address rather than calling it unresolved", () => {
    expect(previewAddress({ resolved: undefined, typed: "" })).toBe("");
  });
});
