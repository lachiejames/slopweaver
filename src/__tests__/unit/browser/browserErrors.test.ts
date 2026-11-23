/**
 * The browser directory's typed failures print exactly what the `readonly string[]` they replaced printed: every
 * untrusted evidence field, and a refusal with the line saying what to do next, one line each — and the message
 * otherwise.
 */
import { describe, expect, it } from "vitest";
import { BrowserErrors, browserErrorLines } from "../../../browser/browserErrors.js";

describe("browserErrorLines", () => {
  it("gives every untrusted evidence field its own line", () => {
    const reasons = ["before.polls is not a finite number", "geometry is not an object"];
    const error = BrowserErrors.evidenceRefused({ reasons });
    expect(browserErrorLines({ error })).toEqual(reasons);
    expect(error.message).toBe("before.polls is not a finite number; geometry is not an object");
  });

  it("keeps an unreadable token's reason first and who writes it after it", () => {
    expect(
      browserErrorLines({ error: BrowserErrors.extensionTokenUnreadable({ detail: "ENOENT", path: "/h/token" }) }),
    ).toEqual([
      "could not read the Playwright extension token at /h/token: ENOENT",
      "the browser walk needs it; it is written once, by the owner, from the extension's own connect dialog",
    ]);
  });

  it("keeps a held relay's refusal first and when to retry after it", () => {
    expect(
      browserErrorLines({ error: BrowserErrors.relayHeld({ detail: "held by pid 9", platform: "linear" }) }),
    ).toEqual([
      "another browser walk is driving the owner's Chrome, so the linear walk may not start: held by pid 9",
      "the relay's shared context is one tab — run this walk again once the other one has finished",
    ]);
  });

  it("gives a single-message variant its message", () => {
    expect(browserErrorLines({ error: BrowserErrors.extensionTokenEmpty({ path: "/h/token" }) })).toEqual([
      "the Playwright extension token is empty: /h/token",
    ]);
  });
});

describe("BrowserErrors", () => {
  it("names the field and its size when a rectangle has no area", () => {
    const error = BrowserErrors.evidenceRectEmpty({ at: "before.chart", height: 0, key: "rect", width: 10 });
    expect(error.code).toBe("EVIDENCE_FIELD_INVALID");
    expect(error.at).toBe("before.chart.rect");
    expect(error.message).toBe("before.chart.rect has no area (10x0)");
  });

  it("names the bare origin a path-carrying declaration should have been", () => {
    const error = BrowserErrors.relayOriginNotBare({ bareOrigin: "https://a.example", origin: "https://a.example/x" });
    expect(error.code).toBe("RELAY_ORIGIN_INVALID");
    expect(error.message).toBe(
      '"https://a.example/x" is not a bare origin — a relay lease binds to an origin such as "https://a.example", never to a path',
    );
  });
});
