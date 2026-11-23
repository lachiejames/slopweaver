/**
 * How `parseChronicleServiceConfig` treats the YAML library's own diagnostics: an error and a warning are both
 * refused, even where the schema would read past them.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("refuses a YAML error even where the schema would read past it, such as a key declared twice", () => {
    // A second `authentication:` would replace the real rules for a reader that let the later key win.
    const texts = [
      `${CONFIG}authentication:\n  rules:\n  - selector: '*'\n    oauth:\n      canonical_scopes: x\n`,
      `${CONFIG}foo: [unclosed\n`,
    ];
    const messages = texts.map((text) => unwrapErr(parseChronicleServiceConfig({ text })).message);
    expect(messages[0]).toContain("could not be read: Map keys must be unique at line 27, column 1");
    expect(messages[1]).toContain("could not be read: Flow sequence in block collection must be sufficiently indented");
  });

  it("refuses a YAML warning as it refuses an error, such as an alias ending in a colon", () => {
    const text = CONFIG.replace("  api_short_name: chronicle\n", "  api_short_name: *chronicle:\n");
    expect(unwrapErr(parseChronicleServiceConfig({ text })).message).toContain(
      "could not be read: Alias ending in : is ambiguous at line 26, column 29",
    );
  });
});
