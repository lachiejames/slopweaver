/**
 * The pull-request snapshot's three failures. Invalid names the path and why; unreadable and unwritable keep
 * their cause, rendering an Error's message or `String(cause)` for anything else.
 */
import { describe, expect, it } from "vitest";

import { PrStateErrors } from "../../../../outbound/github/prStateErrors.js";

const PATH = "/home/github/pr-state/acme__widgets.json";

describe("PrStateErrors.invalid", () => {
  it("is STATE_INVALID, naming the path and the reason", () => {
    const error = PrStateErrors.invalid({ path: PATH, why: "row 3 names no head branch" });

    expect(error.code).toBe("STATE_INVALID");
    expect(error.path).toBe(PATH);
    expect(error.message).toBe(
      "the pull-request snapshot at /home/github/pr-state/acme__widgets.json is not usable: row 3 names no head branch",
    );
  });
});

describe("PrStateErrors.unreadable", () => {
  it("is STATE_UNREADABLE, taking an Error's message and keeping the Error as its cause", () => {
    const cause = new Error("EACCES: permission denied");
    const error = PrStateErrors.unreadable({ cause, path: PATH });

    expect(error.code).toBe("STATE_UNREADABLE");
    expect(error.path).toBe(PATH);
    expect(error.message).toBe(
      "could not read the pull-request snapshot at /home/github/pr-state/acme__widgets.json: EACCES: permission denied",
    );
    expect(error.cause).toBe(cause);
  });

  it("is STATE_UNREADABLE, stringifying a cause that is not an Error", () => {
    const error = PrStateErrors.unreadable({ cause: 42, path: PATH });

    expect(error.code).toBe("STATE_UNREADABLE");
    expect(error.message).toBe(
      "could not read the pull-request snapshot at /home/github/pr-state/acme__widgets.json: 42",
    );
    expect(error.cause).toBe(42);
  });
});

describe("PrStateErrors.unwritable", () => {
  it("is STATE_UNWRITABLE, taking an Error's message and keeping the Error as its cause", () => {
    const cause = new Error("ENOSPC: no space left on device");
    const error = PrStateErrors.unwritable({ cause, path: PATH });

    expect(error.code).toBe("STATE_UNWRITABLE");
    expect(error.path).toBe(PATH);
    expect(error.message).toBe(
      "could not write the pull-request snapshot at /home/github/pr-state/acme__widgets.json: ENOSPC: no space left on device",
    );
    expect(error.cause).toBe(cause);
  });

  it("is STATE_UNWRITABLE, stringifying a cause that is not an Error", () => {
    const error = PrStateErrors.unwritable({ cause: "disk gone", path: PATH });

    expect(error.code).toBe("STATE_UNWRITABLE");
    expect(error.message).toBe(
      "could not write the pull-request snapshot at /home/github/pr-state/acme__widgets.json: disk gone",
    );
    expect(error.cause).toBe("disk gone");
  });
});
