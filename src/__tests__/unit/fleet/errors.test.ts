/**
 * The fleet domain's error factory: each variant carries its own code, the fields a caller branches on, and a
 * message a verb can print as it is.
 */
import { describe, expect, it } from "vitest";

import { FleetErrors } from "../../../fleet/errors.js";

describe("FleetErrors", () => {
  it("names the file and the rewrite command when a configuration is invalid", () => {
    const error = FleetErrors.configInvalid({ path: "/h/fleet/config.json", why: "not an object" });
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toBe(
      "/h/fleet/config.json is not a valid fleet configuration (not an object) — fix it or rewrite it with `slopweaver fleet configure --capacity <n>`",
    );
  });

  it("carries the path and an Error's own message for an I/O failure", () => {
    const error = FleetErrors.io({ cause: new Error("EACCES"), path: "/h/fleet/resume.jsonl" });
    expect(error).toEqual({
      code: "IO_FAILED",
      message: "/h/fleet/resume.jsonl: EACCES",
      path: "/h/fleet/resume.jsonl",
    });
  });

  it("stringifies a thrown non-Error for an I/O failure", () => {
    const error = FleetErrors.io({ cause: "disk full", path: "/h/x" });
    expect(error.message).toBe("/h/x: disk full");
  });

  it("names the pid holding the lock", () => {
    const error = FleetErrors.lockHeld({ detail: "held by pid 4242" });
    expect(error).toEqual({
      code: "LOCK_HELD",
      detail: "held by pid 4242",
      message:
        "the recovery lock was not free, so this pass touched nothing — its progress is on the sessions page (held by pid 4242)",
    });
  });

  it("prefixes a refused reorientation with the verb that was refused", () => {
    const error = FleetErrors.reorientationRefused({ why: "not the awaited chair" });
    expect(error).toEqual({
      code: "REORIENTATION_REFUSED",
      message: "supervisor reoriented: not the awaited chair",
    });
  });
});
