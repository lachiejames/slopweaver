/*
 * A launch spends its browser-door judgment only on the run of the app it was judged against.
 */
import { describe, expect, it } from "vitest";

import { judgedAppRefusal } from "../../src/judgedApp";

describe("judgedAppRefusal", () => {
  it("lets a launch through when its door was judged against this run of the app", () => {
    expect(judgedAppRefusal({ judged: "instance-a", serving: "instance-a" })).toBe(undefined);
  });

  it("refuses a launch judged against another run of the app, naming both", () => {
    expect(judgedAppRefusal({ judged: "instance-a", serving: "instance-b" })).toBe(
      "the browser door was judged against app instance instance-a, but this is instance-b, " +
        "which may run another Codex binary, so the launch is refused; spawn again",
    );
  });
});
