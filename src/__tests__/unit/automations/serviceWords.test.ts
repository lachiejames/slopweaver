/**
 * A service's own error words, lifted out of a failure's text and decoded so they read as the service wrote them.
 */
import { describe, expect, it } from "vitest";

import { saidPlainlyOf } from "../../../automations/saidPlainly.js";
import { serviceWordsOf } from "../../../automations/serviceWords.js";

describe("serviceWordsOf", () => {
  it("decodes every JSON escape in a service's message, so it reads as the service wrote it", () => {
    expect([
      serviceWordsOf({ raw: String.raw`exit 1: {"message":"café unavailable"}` }),
      serviceWordsOf({ raw: String.raw`{"error":"line one\nC:\\path\/to 😀, \"quoted\""}` }),
      serviceWordsOf({ raw: "exit 1: no JSON body here" }),
    ]).toEqual(["café unavailable", 'line one\nC:\\path/to 😀, "quoted"', null]);
  });

  it("is what the card quotes for a failure carrying a JSON body", () => {
    expect(saidPlainlyOf({ raw: String.raw`exit 1: {"message":"café unavailable"}` })).toBe("café unavailable");
  });
});
