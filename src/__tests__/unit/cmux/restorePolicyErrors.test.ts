/** The restore-policy domain's typed errors: each code, and the hand line every shape refusal names. */
import { describe, expect, it } from "vitest";

import { RestorePolicyErrors } from "../../../cmux/restorePolicyErrors.js";

describe("RestorePolicyErrors", () => {
  it("tells the owner the one line to add by hand when the shape is refused, keeping the scanner's reason apart", () => {
    const error = RestorePolicyErrors.shapeRefused({ reason: "duplicate key terminal" });
    expect(error.code).toBe("CONFIG_SHAPE_REFUSED");
    expect(error.reason).toBe("duplicate key terminal");
    expect(error.message).toBe(
      'duplicate key terminal — not edited; add "autoResumeAgentSessions": false inside the top-level "terminal" object by hand',
    );
  });

  it("names the path and the template to create when there is no config", () => {
    const error = RestorePolicyErrors.absent({ path: "/cfg/cmux.json" });
    expect(error.code).toBe("CONFIG_ABSENT");
    expect(error.path).toBe("/cfg/cmux.json");
    expect(error.message).toBe(
      'no cmux config at /cfg/cmux.json: create it holding {"terminal": {"autoResumeAgentSessions": false}}, ' +
        "or launch cmux once so it writes its own template, then run this again",
    );
  });

  it("counts the hard links and refuses a symlink by path", () => {
    expect(RestorePolicyErrors.hardLinked({ links: 2, path: "/cfg/cmux.json" }).message).toBe(
      '/cfg/cmux.json has 2 hard links, and an atomic replace would cut the others loose: add "autoResumeAgentSessions": false inside "terminal" by hand',
    );
    expect(RestorePolicyErrors.symlink({ path: "/cfg/cmux.json" }).code).toBe("CONFIG_SYMLINK");
  });

  it("carries the detail of an unverified edit, an unreadable file and a failed write", () => {
    expect(RestorePolicyErrors.editUnverified({ detail: "read back on" }).message).toBe(
      'the planned edit did not verify (read back on): add "autoResumeAgentSessions": false inside "terminal" by hand',
    );
    expect(RestorePolicyErrors.unreadable({ detail: "EACCES", path: "/cfg/cmux.json" }).message).toBe(
      "could not read /cfg/cmux.json: EACCES",
    );
    expect(RestorePolicyErrors.writeFailed({ detail: "ENOSPC", path: "/cfg/cmux.json" }).code).toBe(
      "CONFIG_WRITE_FAILED",
    );
  });
});
