/**
 * The shape tables `fileRedaction.ts` applies. What each shape masks is tested there, over whole texts; this
 * pins the two properties the engine relies on and cannot check itself.
 */
import { describe, expect, it } from "vitest";

import { TOKEN_PASSES, valuePasses } from "../../../talk/credentialShapes.js";

describe("credential shapes", () => {
  it("makes every pass global, which matchAll needs, and gives each a label", () => {
    const passes = [...TOKEN_PASSES, ...valuePasses({ source: false }), ...valuePasses({ source: true })];
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.filter((pass) => !pass.re.global || pass.label.length === 0)).toEqual([]);
  });

  it("gives a source file and a config file the same passes, bar how secret-config treats a type", () => {
    const labels = ({ source }: { source: boolean }): readonly string[] =>
      valuePasses({ source }).map((pass) => pass.label);
    expect(labels({ source: true })).toEqual(labels({ source: false }));
    const config = ({ source }: { source: boolean }): RegExp =>
      valuePasses({ source }).find((pass) => pass.label === "secret-config")!.re;
    expect("  token: string;".match(config({ source: false }))).toEqual(["  token: string;"]);
    expect("  token: string;".match(config({ source: true }))).toBeNull();
  });
});
