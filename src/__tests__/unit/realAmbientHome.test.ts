import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { realAmbientHome } from "../realAmbientHome.js";

/**
 * The RUNTIME witness for `realAmbientHome.ts`, and the half a static gate cannot supply: `home-safety`'s
 * `env-home-read` check proves nothing in the test tree reads the variable, and this proves the one module
 * that resolves a home instead captured it BEFORE `setup-ambient-home.ts` swapped in the sandbox.
 *
 * The sandbox's directory name is the discriminator (`mkdtempSync(join(tmpdir(), "slopweaver-ambient-home-"))`
 * in that file). It is what a LAZY resolve would return — so this suite fails loudly if the capture is ever
 * moved inside the function, which is the single mistake that would silently re-open the class.
 */
const SANDBOX_PREFIX = "slopweaver-ambient-home-";

describe("realAmbientHome", () => {
  it("is not the ambient-home sandbox — the capture beat the beforeAll that installs it", () => {
    expect(realAmbientHome().includes(SANDBOX_PREFIX)).toBe(false);
  });

  it("is an absolute path, so it is usable as a `home` without further resolution", () => {
    expect(isAbsolute(realAmbientHome())).toBe(true);
  });

  it("returns the same home on every call, so two readers of the real home cannot disagree", () => {
    expect(realAmbientHome()).toBe(realAmbientHome());
  });

  it("is not the per-test sandbox the guard installed, which every other home resolution now sees", () => {
    // The witness that the assertion above can fail: the sandbox IS the live value at test time, so a lazy
    // capture would make these two equal.
    // home-safety-exempt: reads the sandbox the guard installed, to contrast it with the captured home —
    // this never resolves a home from the variable, it asserts the two differ.
    const sandboxNow = process.env["SLOPWEAVER_HOME"];
    expect(sandboxNow!.includes(SANDBOX_PREFIX)).toBe(true);
    expect(realAmbientHome()).not.toBe(sandboxNow);
  });
});
