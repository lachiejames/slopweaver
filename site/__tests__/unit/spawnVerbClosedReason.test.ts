/*
 * How a console child that closed without succeeding is named. A signal death once read "exited null" when a console rebuild killed
 * `talk offer` mid-composition, which told nobody that it was killed, or by what.
 */
import { describe, expect, it } from "vitest";

import { closedReason } from "../../lib/spawnVerb";

const TITLE = "slopweaver talk offer --voice <voice> --json";

describe("closedReason", () => {
  it("names the signal that killed the child, never a null exit code", () => {
    expect(closedReason({ code: null, err: "", signal: "SIGTERM", title: TITLE })).toBe(
      `${TITLE} was killed by SIGTERM before it answered`,
    );
  });

  it("names the exit code of a child that exited on its own, with its last three stderr lines", () => {
    expect(closedReason({ code: 1, err: "one\ntwo\nthree\nfour\n", signal: null, title: TITLE })).toBe(
      `${TITLE} exited 1: two · three · four`,
    );
  });

  it("says so when the platform reported neither a code nor a signal", () => {
    expect(closedReason({ code: null, err: "", signal: null, title: TITLE })).toBe(
      `${TITLE} ended with neither an exit code nor a signal`,
    );
  });
});
