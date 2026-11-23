import { describe, expect, it } from "vitest";

import { instantProblem } from "../../../cli/commands/supervisor/intakeFlags.js";

describe("instantProblem", () => {
  it("passes an absent flag and an instant", () => {
    expect(instantProblem({ name: "since", value: undefined })).toBe(undefined);
    expect(instantProblem({ name: "since", value: "2026-09-22T12:11:57Z" })).toBe(undefined);
  });

  it("names the flag and the value that is not an instant", () => {
    expect(instantProblem({ name: "now", value: "yesterday-ish" })).toBe("--now yesterday-ish is not an instant");
  });
});
