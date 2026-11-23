/*
 * `redactWindow`: a token the window opens or closes inside is masked whole, what sits outside the window stays
 * out, and a secret-named value is masked though its key sits before the window.
 */
import { describe, expect, it } from "vitest";

import { redactWindow } from "../../../../talk/fileRedaction.js";
import { GITHUB } from "./harness.js";

describe("redactWindow", () => {
  it("masks a token the window opens inside, though the window holds none of its prefix", () => {
    const context = `gh ${GITHUB} tail\n`;
    const start = context.indexOf(GITHUB) + 10;
    const masked = redactWindow({ context, denylist: [], source: false, end: context.length, start });
    expect(masked.text).toBe("[redacted:github-token] tail\n");
    expect(masked.redactions).toEqual([{ count: 1, label: "github-token" }]);
  });

  it("masks a token the window closes inside, and keeps what sits outside the window out", () => {
    const context = `head ${GITHUB} after`;
    const masked = redactWindow({ context, denylist: [], source: false, end: context.indexOf(GITHUB) + 6, start: 5 });
    expect(masked.text).toBe("[redacted:github-token]");
  });

  it("masks a secret-named value whose key sits before the window", () => {
    const context = "DB_PASS=correcthorse\n";
    expect(redactWindow({ context, denylist: [], source: false, end: context.length, start: 10 }).text).toBe(
      "[redacted:secret-env]\n",
    );
  });
});
