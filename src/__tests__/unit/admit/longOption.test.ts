/**
 * A long option in every spelling getopt_long accepts: its whole name, any prefix of it, bare or with `=value`.
 */
import { describe, expect, it } from "vitest";

import { longOption } from "../../../admit/longOption.js";

describe("longOption", () => {
  it("matches the whole name and every prefix of it, bare", () => {
    const spellings = ["--expression", "--expr", "--e"];
    expect(spellings.map((word) => longOption({ full: "--expression", word }))).toEqual(spellings.map(() => ({})));
  });

  it("carries the value attached after =, an empty one included", () => {
    expect(longOption({ full: "--expression", word: "--expr=1w out" })).toEqual({ attached: "1w out" });
    expect(longOption({ full: "--output", word: "--out=" })).toEqual({ attached: "" });
  });

  it("refuses another option, a longer word, a short option and the bare terminator", () => {
    const others = ["--file", "--expressions", "-e", "--", "expression"];
    expect(others.map((word) => longOption({ full: "--expression", word }))).toEqual(others.map(() => undefined));
  });
});
