/**
 * `MonitorErrors`: each factory's literal code, its discriminating field, and its exact message, with the
 * length/cap interpolation and punctuation-bearing paths and details carried through verbatim.
 */
import { describe, expect, it } from "vitest";

import { MonitorErrors } from "../../../monitor/errors.js";

describe("MonitorErrors", () => {
  it("sourceShape is SOURCE_SHAPE and names the monitor and what it did not understand", () => {
    expect(MonitorErrors.sourceShape({ detail: "expected an array, got {}", monitorId: "recipe-stopped" })).toEqual({
      code: "SOURCE_SHAPE",
      message: "monitor recipe-stopped read its source but did not understand it: expected an array, got {}",
      monitorId: "recipe-stopped",
    });
  });

  it("scriptUnsafe is SCRIPT_UNSAFE and quotes the value it refused", () => {
    expect(MonitorErrors.scriptUnsafe({ value: "a'b; rm" })).toEqual({
      code: "SCRIPT_UNSAFE",
      message:
        "the value a'b; rm cannot be quoted into the notification filter script — refusing to emit a script " +
        "whose behaviour depends on how a shell parses it",
      value: "a'b; rm",
    });
  });

  it("cardTooLong is CARD_TOO_LONG and interpolates the length and the cap", () => {
    expect(MonitorErrors.cardTooLong({ cap: 120, field: "title", length: 187 })).toEqual({
      code: "CARD_TOO_LONG",
      field: "title",
      message:
        "a monitor card's title is 187 characters against a cap of 120 — the register refuses rather than " +
        "truncating, because a line that stops mid-sentence is the failure rule 7 names",
    });
  });

  it("filterUnwritable is FILTER_UNWRITABLE and names the path and the detail", () => {
    expect(
      MonitorErrors.filterUnwritable({
        detail: "EACCES: permission denied, open '/x/filter.sh'",
        path: "/Users/o/.config/cmux (filters)/filter.sh",
      }),
    ).toEqual({
      code: "FILTER_UNWRITABLE",
      message:
        "the cmux notification filter could not be written to /Users/o/.config/cmux (filters)/filter.sh: " +
        "EACCES: permission denied, open '/x/filter.sh'",
      path: "/Users/o/.config/cmux (filters)/filter.sh",
    });
  });
});
