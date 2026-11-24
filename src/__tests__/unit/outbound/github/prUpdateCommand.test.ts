/* The field-edit `pr update` command a refusal prints for a pull request that already exists. */
import { describe, expect, it } from "vitest";

import { prUpdateCommand } from "../../../../outbound/github/prUpdateCommand.js";

describe("prUpdateCommand", () => {
  it("renders the field edit, read from edit.json on standard input", () => {
    expect(prUpdateCommand({ number: 44, repo: "acme/widget" })).toBe(
      "slopweaver github pr update --repo acme/widget --number 44 --edit - < edit.json",
    );
  });

  it("quotes a repository a shell would read specially, so pasting it runs nothing", () => {
    expect(prUpdateCommand({ number: 7, repo: "acme/w$x;id" })).toBe(
      "slopweaver github pr update --repo 'acme/w$x;id' --number 7 --edit - < edit.json",
    );
  });
});
