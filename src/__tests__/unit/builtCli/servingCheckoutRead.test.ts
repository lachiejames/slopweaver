/**
 * The read both the dev console's start check and a desktop walk call, over a throwaway git checkout whose
 * `dist-cli` manifest is written the way `dev build` writes one.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkServingCheckoutBuild } from "../../../builtCli/servingCheckoutRead.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { builtCheckoutFixture } from "../../builtCheckoutFixture.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A fresh throwaway directory with no built CLI, removed after the test. */
function scratch(): string {
  const at = mkdtempSync(join(tmpdir(), "serving-read-"));
  dirs.push(at);
  return at;
}

/** A built checkout, removed after the test. */
function builtCheckout(): string {
  const at = builtCheckoutFixture({ prefix: "serving-built-" });
  dirs.push(at);
  return at;
}

describe("checkServingCheckoutBuild", () => {
  it("passes a checkout with no built CLI, which runs from source and never waits on a rebuild", () => {
    expect(unwrap(checkServingCheckoutBuild({ checkout: scratch() }))).toBeUndefined();
  });

  it("passes a fresh build", () => {
    expect(unwrap(checkServingCheckoutBuild({ checkout: builtCheckout() }))).toBeUndefined();
  });

  it("refuses a stale build with the guard's own sentence naming the file that moved", () => {
    const checkout = builtCheckout();
    writeFileSync(join(checkout, "src/a.ts"), "export const a = 11;\n");

    const refused = unwrapErr(checkServingCheckoutBuild({ checkout }));

    expect([refused.code, refused.checkout, refused.evidence]).toEqual([
      "STALE_BUILT_CLI",
      checkout,
      "src/a.ts is 21 bytes, 20 at build time",
    ]);
  });
});
