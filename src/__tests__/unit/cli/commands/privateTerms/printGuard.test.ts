/**
 * The print edge every private-terms verb holds: a line any term matches leaves as the withheld stand-in, each
 * of a joined line's own lines judged alone, and a line no term matches leaves unchanged. Every term is synthetic.
 */
import { describe, expect, it } from "vitest";

import { homesNamedInArgv, linePrintedUnderTerms } from "../../../../../cli/commands/privateTerms/printGuard.js";
import {
  PRIVATE_TERMS_HEADER_V2,
  parsePrivateTerms,
  WITHHELD_REFUSAL_LINE,
} from "../../../../../hygiene/privateTerms.js";
import { unwrap } from "../../../../../lib/result.js";

const TERMS = unwrap(
  parsePrivateTerms({
    text: `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000a\tperson\ti\tzephyrine\ta synthetic name\t\trelay:acme-row\n`,
  }),
);

describe("linePrintedUnderTerms", () => {
  it("passes a line no term matches through unchanged", () => {
    expect(linePrintedUnderTerms({ line: "landed: add pt-00000000000a", terms: TERMS })).toBe(
      "landed: add pt-00000000000a",
    );
  });

  it("withholds a line carrying a term, a path included", () => {
    expect(linePrintedUnderTerms({ line: "packet p-1: /tmp/Zephyrine-home/x", terms: TERMS })).toBe(
      WITHHELD_REFUSAL_LINE,
    );
  });

  it("judges each line of a joined line alone, keeping the clean ones", () => {
    expect(linePrintedUnderTerms({ line: "usage: one\n  --home /tmp/zephyrine\n  --json", terms: TERMS })).toBe(
      `usage: one\n${WITHHELD_REFUSAL_LINE}\n  --json`,
    );
  });

  it("passes everything through under an empty list", () => {
    expect(linePrintedUnderTerms({ line: "/tmp/zephyrine", terms: [] })).toBe("/tmp/zephyrine");
  });
});

describe("homesNamedInArgv", () => {
  it("names the ambient home first, then each --home in either spelling", () => {
    expect(
      homesNamedInArgv({
        ambient: "/tmp/ambient",
        argv: ["node", "slopweaver", "private-terms", "list", "--home", "/tmp/a", "--home=/tmp/b"],
      }),
    ).toStrictEqual(["/tmp/ambient", "/tmp/a", "/tmp/b"]);
  });

  it("names only the ambient home when argv names none, or a trailing --home carries no value", () => {
    expect(homesNamedInArgv({ ambient: "/tmp/ambient", argv: ["--json", "--home"] })).toStrictEqual(["/tmp/ambient"]);
  });
});
