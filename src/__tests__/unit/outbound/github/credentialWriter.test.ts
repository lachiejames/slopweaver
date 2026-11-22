/**
 * The description door's writer filter: every line reaching the real sink is forwarded as given, bar one carrying a
 * credential shape, which arrives as the withheld line. The door's production writers are built through it, so this
 * is the one place the filter itself is proven; the per-exit tests compose it the way production does.
 */
import { describe, expect, it } from "vitest";

import { withholdingCredentialWriter } from "../../../../outbound/github/descriptionWords.js";

/** A synthetic credential shape, built at runtime so no token-shaped literal sits in this file. */
const TOKEN = `ghp_${"a".repeat(30)}`;

/** The line a credential-shaped line is forwarded as. */
const WITHHELD =
  "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
  "the secret scan names, and the refusal prints in full";

/** A writer over a captured list, and the list. */
function captured(): { lines: string[]; write: (args: { line: string }) => void } {
  const lines: string[] = [];
  return { lines, write: withholdingCredentialWriter({ write: ({ line }) => lines.push(line) }) };
}

describe("withholdingCredentialWriter", () => {
  it("forwards a line carrying no credential shape unchanged", () => {
    const { lines, write } = captured();
    write({ line: "refused: --pr is required" });
    expect(lines).toStrictEqual(["refused: --pr is required"]);
  });

  it("forwards the withheld line in place of one quoting a credential shape", () => {
    const { lines, write } = captured();
    const line = `refused: head ${TOKEN} is not a branch`;
    expect(line).toContain(TOKEN);
    write({ line });
    expect(lines).toStrictEqual([WITHHELD]);
  });

  it("withholds a multi-line write whole when any of its lines carries a credential shape", () => {
    const { lines, write } = captured();
    write({ line: `dry run finding:\nthe body quotes ${TOKEN}\nand more` });
    expect(lines).toStrictEqual([WITHHELD]);
  });

  it("forwards an empty line as an empty line", () => {
    const { lines, write } = captured();
    write({ line: "" });
    expect(lines).toStrictEqual([""]);
  });

  it("filters each write on its own, keeping order", () => {
    const { lines, write } = captured();
    write({ line: "first" });
    write({ line: TOKEN });
    write({ line: "third" });
    expect(lines).toStrictEqual(["first", WITHHELD, "third"]);
  });
});
