/*
 * A reason another module wrote never reads `.;`, `.,` or `.:` before the clause that follows it.
 */
import { describe, expect, it } from "vitest";

import { clauseAfter } from "../../lib/clauseJoin";

describe("clauseAfter", () => {
  it("joins a reason with no closing punctuation by the joint it is given", () => {
    expect(clauseAfter({ clause: "only the draft is drawn", joint: ";", reason: "the slack read timed out" })).toBe(
      "the slack read timed out; only the draft is drawn",
    );
    expect(clauseAfter({ clause: "so logins show instead", joint: ",", reason: "the people read timed out" })).toBe(
      "the people read timed out, so logins show instead",
    );
    expect(clauseAfter({ clause: "a change may be hidden", joint: ":", reason: "exit 1" })).toBe(
      "exit 1: a change may be hidden",
    );
  });

  it("starts a new sentence after a reason that already ends one, whatever the joint", () => {
    expect(clauseAfter({ clause: "only the draft is drawn", joint: ";", reason: "so it has to be inside one." })).toBe(
      "so it has to be inside one. Only the draft is drawn",
    );
    expect(
      clauseAfter({ clause: "the plan may still have a session open", joint: ",", reason: "is it running? " }),
    ).toBe("is it running? The plan may still have a session open");
    expect(clauseAfter({ clause: "a change may be hidden", joint: ":", reason: "it stopped!" })).toBe(
      "it stopped! A change may be hidden",
    );
  });
});
