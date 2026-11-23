/**
 * The `protect` usage leaf: each line names its own verb and the flags that verb's parser accepts.
 */
import { describe, expect, it } from "vitest";

import {
  PROTECT_ADD_USAGE,
  PROTECT_CHECK_USAGE,
  PROTECT_LIST_USAGE,
  PROTECT_REMOVE_USAGE,
} from "../../../../../cli/commands/protect/protectUsage.js";

describe("protect usage", () => {
  it("spells add with both modes and a required reason", () => {
    expect(PROTECT_ADD_USAGE).toBe(
      'usage: slopweaver protect add <path> --mode read-only|no-access --why "<the owner\'s reason>" [--home <dir>]',
    );
  });

  it("spells remove, list and check with only the flags each one reads", () => {
    expect(PROTECT_REMOVE_USAGE).toBe("usage: slopweaver protect remove <path> [--home <dir>]");
    expect(PROTECT_LIST_USAGE).toBe("usage: slopweaver protect list [--json] [--home <dir>]");
    expect(PROTECT_CHECK_USAGE).toBe("usage: slopweaver protect check <path> [--write] [--home <dir>]");
  });
});
