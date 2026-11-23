import { describe, expect, it } from "vitest";

import {
  CHILD_DEADLINE_ENV,
  ChildDeadlineErrors,
  childDeadlineEnv,
  readChildDeadline,
} from "../../../lib/childDeadline.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("the deadline a parent hands its child", () => {
  it("round-trips the instant a parent sets", () => {
    expect(unwrap(readChildDeadline({ env: childDeadlineEnv({ deadlineAtMs: 1_790_000_016_000 }) }))).toBe(
      1_790_000_016_000,
    );
  });

  it("reads none when no parent set one", () => {
    expect(unwrap(readChildDeadline({ env: {} }))).toBe(null);
  });

  it("refuses a value that is not a whole epoch-millisecond instant", () => {
    expect(unwrapErr(readChildDeadline({ env: { [CHILD_DEADLINE_ENV]: "soon" } }))).toEqual(
      ChildDeadlineErrors.malformed({ raw: "soon" }),
    );
    expect(unwrapErr(readChildDeadline({ env: { [CHILD_DEADLINE_ENV]: "" } })).code).toBe("MALFORMED_CHILD_DEADLINE");
    expect(unwrapErr(readChildDeadline({ env: { [CHILD_DEADLINE_ENV]: "1.5e12" } })).message).toBe(
      `${CHILD_DEADLINE_ENV} is not an epoch-millisecond instant: "1.5e12"`,
    );
  });
});
