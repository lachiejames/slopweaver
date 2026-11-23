import { describe, expect, it } from "vitest";

import { SpendErrors } from "../../../spend/errors.js";

describe("SpendErrors", () => {
  it("tells a home that has imported nothing how to import, rather than listing an empty set", () => {
    const error = SpendErrors.cardNotFound({ held: [], last4: "0042" });
    expect(error.code).toBe("CARD_NOT_FOUND");
    expect(error.message).toBe(
      "no card ending 0042 — no card has been imported yet — `slopweaver spend import <path> --as-of <date>`",
    );
  });

  it("names the cards that were imported when the asked-for one was not", () => {
    const error = SpendErrors.cardNotFound({ held: ["airwallex-0042", "airwallex-0043"], last4: "9999" });
    expect(error.message).toBe("no card ending 9999 — imported: airwallex-0042, airwallex-0043");
  });

  it("names the line a malformed export is about, by number", () => {
    const error = SpendErrors.exportLineMalformed({ line: "Card", lineNumber: 4, text: 'Card: "A"' });
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toBe('line 4: the Card line is not in the shape the card page prints: Card: "A"');
  });
});
