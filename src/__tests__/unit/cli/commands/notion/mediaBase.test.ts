import { describe, expect, it } from "vitest";
import { mediaBaseOf } from "../../../../../cli/commands/notion/mediaBase.js";
import { parseNotionPageArgs } from "../../../../../cli/commands/notion/pageCore.js";
import { unwrap } from "../../../../../lib/result.js";

const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";

describe("mediaBaseOf", () => {
  it("resolves from the body file's own directory", () => {
    const args = unwrap(parseNotionPageArgs({ argv: ["update", "--page", PAGE, "--body", "docs/pages/p.md"] }));

    expect(mediaBaseOf({ args })).toBe("docs/pages");
  });

  it("takes --media-base over the body's directory", () => {
    const args = unwrap(
      parseNotionPageArgs({ argv: ["update", "--page", PAGE, "--body", "docs/p.md", "--media-base", "/shots"] }),
    );

    expect(mediaBaseOf({ args })).toBe("/shots");
  });

  it("resolves a body piped on stdin from the working directory", () => {
    const args = unwrap(parseNotionPageArgs({ argv: ["update", "--page", PAGE, "--body", "-"] }));

    expect(mediaBaseOf({ args })).toBe(process.cwd());
  });
});
