import { describe, expect, it } from "vitest";

import { redactTokensInErrors, withTokensRedacted } from "../../../../atlas/vanta/tokenRedaction.js";
import { err, ok } from "../../../../lib/result.js";

describe("redactTokensInErrors", () => {
  it("scrubs every recorded token, not only the latest, and ignores an empty one", () => {
    expect(
      redactTokensInErrors({
        errors: ["cursor tok-old was refused", "then tok-new too"],
        usedTokens: new Set(["tok-old", "tok-new", ""]),
      }),
    ).toEqual(["cursor [REDACTED] was refused", "then [REDACTED] too"]);
  });
});

describe("withTokensRedacted", () => {
  it("returns a success untouched", () => {
    expect(withTokensRedacted({ result: ok(1), usedTokens: new Set(["tok"]) })._unsafeUnwrap()).toBe(1);
  });

  it("scrubs a failure's reasons", () => {
    expect(withTokensRedacted({ result: err(["saw tok"]), usedTokens: new Set(["tok"]) })._unsafeUnwrapErr()).toEqual([
      "saw [REDACTED]",
    ]);
  });
});
