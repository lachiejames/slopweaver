/*
 * When a registered platform refuses `browser shot`: only a doored one registered refuse-every-write, whose
 * refusal names the door to take the evidence through instead.
 */
import { describe, expect, it } from "vitest";

import { BrowserVerbErrors, browserVerbErrorLines } from "../../../../../../cli/commands/browser/errors.js";
import { shotRefusalFor } from "../../../../../../cli/commands/browser/shotCore.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";

describe("shotRefusalFor", () => {
  it("refuses a doored platform registered refuse-every-write and names its door", () => {
    const problems = unwrapErr(
      shotRefusalFor({
        platform: {
          door: "slopweaver jumpcloud read",
          hosts: ["jumpcloud.example.invalid"],
          policy: "refuse-every-write",
          provider: "JumpCloud",
        },
      }),
    );
    expect(problems).toEqual(
      BrowserVerbErrors.dooredProvider({ door: "slopweaver jumpcloud read", provider: "JumpCloud" }),
    );
    expect(problems.message).toBe(
      "JumpCloud is registered refuse-every-write, so its web client is never photographed — doctrine rule 3; " +
        "take the evidence through it instead: slopweaver jumpcloud read",
    );
    expect(browserVerbErrorLines({ error: problems })).toStrictEqual([
      "JumpCloud is registered refuse-every-write, so its web client is never photographed — doctrine rule 3",
      "take the evidence through it instead: slopweaver jumpcloud read",
    ]);
  });

  it("allows a doorless platform registered refuse-every-write, because it has no door to name", () => {
    expect(
      unwrap(
        shotRefusalFor({
          platform: {
            door: null,
            hosts: ["example.invalid"],
            policy: "refuse-every-write",
            provider: "Example",
          },
        }),
      ),
    ).toBe(null);
  });

  it("allows a doored platform registered read-before-write", () => {
    expect(
      unwrap(
        shotRefusalFor({
          platform: {
            door: "slopweaver example read",
            hosts: ["example.invalid"],
            policy: "read-before-write",
            provider: "Example",
          },
        }),
      ),
    ).toBe(null);
  });
});
