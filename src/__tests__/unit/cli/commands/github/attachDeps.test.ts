/**
 * The production attach scan loads the private terms from a real home: an absent file refuses with the loader's
 * own sentence, and a header-only file builds a scan that passes clean text and flags a denylisted word.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { productionGithubAttachDeps } from "../../../../../cli/commands/github/attachDeps.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  absentPrivateTermsRefusal,
  homeDeclaringNoPrivateTerms,
  writePrivateTerms,
} from "../../../../privateTermsFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("productionGithubAttachDeps().textScanFor", () => {
  it("refuses with the loader's sentence when the home holds no private-terms file", () => {
    const home = mkdtempSync(join(tmpdir(), "attach-deps-no-terms-"));
    fixtureDirs.push(home);
    const scan = productionGithubAttachDeps().textScanFor({ home, ownRepository: "acme/app" });
    expect(unwrapErr(scan)).toBe(absentPrivateTermsRefusal({ home }));
  });

  it("builds a scan from a header-only file that passes clean text", () => {
    const home = homeDeclaringNoPrivateTerms({ prefix: "attach-deps-none-" });
    fixtureDirs.push(home);
    const scan = unwrap(productionGithubAttachDeps().textScanFor({ home, ownRepository: "acme/app" }));
    expect(scan({ surface: "proves", text: "the unit suite passes" })).toEqual([]);
  });

  it("flags a loaded private term by class only", () => {
    const home = mkdtempSync(join(tmpdir(), "attach-deps-terms-"));
    fixtureDirs.push(home);
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const scan = unwrap(productionGithubAttachDeps().textScanFor({ home, ownRepository: "acme/app" }));
    expect(scan({ surface: "frame-text", text: "from Quillfeather" })).toEqual([
      "captured frame text line 1: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    ]);
  });
});
