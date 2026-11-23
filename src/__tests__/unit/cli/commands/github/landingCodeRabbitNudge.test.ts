/**
 * The argv one stuck-CodeRabbit re-request hands `github comment create` — the whole of what gets posted.
 */

import { describe, expect, it } from "vitest";

import { nudgeArgv } from "../../../../../cli/commands/github/landingCodeRabbitNudge.js";
import { landingRowFake } from "../../../../landingRowFake.js";

const FORM = JSON.stringify({ summary: [{ kind: "text", text: "@coderabbitai review" }] });

describe("nudgeArgv", () => {
  it("posts exactly `@coderabbitai review` on the row's own pull request", () => {
    expect(nudgeArgv({ home: undefined, row: landingRowFake({}) })).toEqual([
      "--repo",
      "acme/widgets",
      "--number",
      "16378",
      "--form",
      FORM,
    ]);
  });

  it("carries the state home through, so the door records the write where the register lives", () => {
    expect(nudgeArgv({ home: "/home/sw", row: landingRowFake({}) }).slice(-2)).toEqual(["--home", "/home/sw"]);
  });
});
