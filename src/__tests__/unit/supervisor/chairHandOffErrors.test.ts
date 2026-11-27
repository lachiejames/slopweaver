/** The chair hand-off's error factories: each builds its own code and the message a caller displays. */
import { describe, expect, it } from "vitest";

import { ChairHandOffErrors } from "../../../supervisor/chairHandOffErrors.js";

describe("ChairHandOffErrors", () => {
  it("io names the path and an Error's own message", () => {
    const cause = new Error("EACCES: permission denied");
    expect(ChairHandOffErrors.io({ cause, path: "/h/j.jsonl" })).toEqual({
      cause,
      code: "HAND_OFF_IO",
      message: "/h/j.jsonl: EACCES: permission denied",
      path: "/h/j.jsonl",
    });
  });

  it("io stringifies a cause that is not an Error", () => {
    expect(ChairHandOffErrors.io({ cause: "gone", path: "/n.md" }).message).toBe("/n.md: gone");
  });

  it("lockHeld names what holds the journal's lock", () => {
    expect(ChairHandOffErrors.lockHeld({ detail: "pid 42" })).toEqual({
      code: "LOCK_HELD",
      message: "another writer holds the hand-off journal's lock: pid 42",
    });
  });

  it("malformed names the line and why, and says not to skip it", () => {
    expect(ChairHandOffErrors.malformed({ line: 3, path: "/j.jsonl", why: "not JSON" })).toEqual({
      code: "JOURNAL_MALFORMED",
      line: 3,
      message:
        "/j.jsonl line 3 is not a chair hand-off event (not JSON); repair or remove that line by hand — a skipped step could seat a second successor",
      path: "/j.jsonl",
    });
  });

  it("noteRefused carries its reason as the message", () => {
    expect(ChairHandOffErrors.noteRefused({ why: "too late" })).toEqual({ code: "NOTE_REFUSED", message: "too late" });
  });
});
