/*
 * `--harness` and `--delivery`: cmux unless the caller names the app, never a guessed harness; and one way only to
 * say when a message lands.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { parseDeliveryFlag } from "../../../sessionHarness/delivery.js";
import { isAppHandle, parseHarnessFlag } from "../../../sessionHarness/harnessChoice.js";

describe("parseHarnessFlag", () => {
  it("is cmux when none is named, and the harness named otherwise", () => {
    expect(unwrap(parseHarnessFlag({ value: undefined }))).toBe("cmux");
    expect(unwrap(parseHarnessFlag({ value: "app" }))).toBe("app");
  });

  it("refuses an unknown harness rather than falling back", () => {
    expect(unwrapErr(parseHarnessFlag({ value: "tmux" }))).toBe('--harness must be one of cmux, app, not "tmux"');
  });
});

describe("isAppHandle", () => {
  it("tells an app handle from a cmux ref", () => {
    expect(isAppHandle({ handle: "app:0b5e" })).toBe(true);
    expect(isAppHandle({ handle: "workspace:3" })).toBe(false);
  });
});

describe("parseDeliveryFlag", () => {
  it("follows --interrupt when --delivery is absent", () => {
    expect(unwrap(parseDeliveryFlag({ interrupt: true, value: undefined }))).toBe("now");
    expect(unwrap(parseDeliveryFlag({ interrupt: false, value: undefined }))).toBe("turn");
  });

  it("takes the delivery named", () => {
    expect(unwrap(parseDeliveryFlag({ interrupt: false, value: "later" }))).toBe("later");
  });

  it("refuses both flags at once, and an unknown delivery", () => {
    expect(unwrapErr(parseDeliveryFlag({ interrupt: true, value: "later" }))).toBe(
      "--interrupt and --delivery both say when the message lands: pass one (--interrupt is --delivery now)",
    );
    expect(unwrapErr(parseDeliveryFlag({ interrupt: false, value: "soon" }))).toBe(
      '--delivery must be one of now, turn, later, not "soon"',
    );
  });
});
