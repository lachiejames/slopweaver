import { describe, expect, it } from "vitest";

import { lapOwnEnv } from "../../../../../cli/commands/github/lapProcess.js";

describe("lapOwnEnv", () => {
  it("keeps the seat's environment less every git variable and every open hatch", () => {
    expect(
      lapOwnEnv({
        env: {
          GIT_DIR: "/elsewhere/.git",
          HOME: "/Users/seat",
          PATH: "/bin",
          SLOPWEAVER_ALLOW_BASH: "1",
          SLOPWEAVER_HOME: "/operator",
        },
      }),
    ).toEqual({ HOME: "/Users/seat", PATH: "/bin", SLOPWEAVER_HOME: "/operator" });
  });
});
