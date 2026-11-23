/**
 * The form's picture schema driven directly: the display width is optional, a whole number, and bounded at
 * both ends, and the url is https on one line. `schema.test.ts` covers the same rules through a whole form.
 */
import { describe, expect, it } from "vitest";
import { HTTPS, imageSchema } from "../../../../outbound/github/schemaImage.js";

/** An image at the given width, on a user-attachments url. */
const image = ({ width }: { width?: number }): Record<string, unknown> => ({
  alt: "the badge row",
  kind: "image",
  url: "https://github.com/user-attachments/assets/abc-1",
  ...(width === undefined ? {} : { width }),
});

describe("imageSchema", () => {
  it.each([64, 600, 2048])("accepts a width of %i pixels", (width) => {
    expect(imageSchema.safeParse(image({ width })).success).toBe(true);
  });

  it("accepts an image with no width", () => {
    expect(imageSchema.safeParse(image({})).success).toBe(true);
  });

  it.each([
    [63, "an image width is at least 64 pixels"],
    [2049, "an image width is at most 2048 pixels"],
    [600.5, "an image width is a whole number of pixels"],
  ])("refuses a width of %d, saying %s", (width, message) => {
    expect(imageSchema.safeParse(image({ width })).error!.issues.map((issue) => issue.message)).toStrictEqual([
      message,
    ]);
  });
});

describe("HTTPS", () => {
  it("refuses a plaintext http url", () => {
    expect(HTTPS.safeParse("http://example.com").error!.issues.map((issue) => issue.message)).toStrictEqual([
      "must be an https URL",
    ]);
  });
});
