import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyOnepasswordKindFile, initialOnepasswordManifest } from "../../../../../atlas/onepassword/model.js";
import { onepasswordAtlasPaths, publishOnepasswordAtlas } from "../../../../../atlas/onepassword/store.js";
import { ONEPASSWORD_RESET_USAGE, runOnepasswordReset } from "../../../../../cli/commands/onepassword/resetRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { RESET_USAGE } from "../../../../../cli/manifests/onepassword.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("runOnepasswordReset", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "onepassword-resetrun-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("the manifest's usage string matches this verb's own copy", () => {
    expect(RESET_USAGE).toBe(ONEPASSWORD_RESET_USAGE);
  });

  it("--help prints usage and exits EXIT_OK", () => {
    expect(runOnepasswordReset(["node", "slopweaver", "onepassword", "reset", "--help"])).toBe(EXIT_OK);
  });

  it("refuses without --confirm archive", () => {
    expect(runOnepasswordReset(["node", "slopweaver", "onepassword", "reset", "--home", home])).toBe(EXIT_USAGE);
  });

  it("refuses when there is nothing to reset", () => {
    expect(
      runOnepasswordReset(["node", "slopweaver", "onepassword", "reset", "--home", home, "--confirm", "archive"]),
    ).toBe(EXIT_ERROR);
  });

  it("archives an existing generation and exits EXIT_OK", () => {
    publishOnepasswordAtlas({
      derivedFrom: null,
      denylist: [],
      files: { user: emptyOnepasswordKindFile({ kind: "user", updatedAt: AT }) },
      manifest: initialOnepasswordManifest({ updatedAt: AT }),
      paths: onepasswordAtlasPaths({ home }),
    });

    expect(
      runOnepasswordReset(["node", "slopweaver", "onepassword", "reset", "--home", home, "--confirm", "archive"]),
    ).toBe(EXIT_OK);
  });
});
