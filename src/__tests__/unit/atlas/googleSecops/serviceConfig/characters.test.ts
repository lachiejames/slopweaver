/**
 * How `parseChronicleServiceConfig` refuses a character another YAML reader would decode differently: one
 * outside printable ASCII and newlines, or a backslash, wherever it sits.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("refuses a character another YAML reader would take as a line break, or any outside printable ASCII", () => {
    // Each hides an auth rule inside a comment for this reader; libyaml breaks the line there and reads it.
    const hidden = "  - selector: 'google.cloud.chronicle.v1.RuleService.*'\n    oauth:\n      canonical_scopes: x";
    // Built from code points: a formatter rewrites an escape in a literal into the invisible character itself.
    // DEL and the two ends of the control range pin both bounds of the printable range from outside.
    const characters = [0x2028, 0x2029, 0x85, 0xd, 0x9, 0xfeff, 0xe9, 0x7f, 0x1f, 0x1].map((codePoint) =>
      String.fromCodePoint(codePoint),
    );
    const errors = characters.map((character) =>
      unwrapErr(
        parseChronicleServiceConfig({
          text: CONFIG.replace("authentication:\n", `authentication:\n# note${character}${hidden}\n`),
        }),
      ),
    );
    const offset = CONFIG.indexOf("authentication:\n") + "authentication:\n# note".length;
    expect(errors).toStrictEqual(
      ["2028", "2029", "0085", "000D", "0009", "FEFF", "00E9", "007F", "001F", "0001"].map((codePoint) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `holds U+${codePoint} at offset ${offset}, outside the printable ASCII and newlines this reads`,
        }),
      ),
    );
  });

  it("refuses a backslash wherever it sits, because an escape decodes past the character check", () => {
    // A double-quoted backslash-u-FEFF escape is six ASCII bytes that decode to U+FEFF, which JavaScript's trim
    // strips from the selector and other readers keep — so the later rule would match here and nowhere else.
    const selector = "'google.cloud.chronicle.v1.RuleService.*'";
    const cases = [
      { offset: 0, text: `\\${CONFIG}` },
      {
        offset: "type: google.api.Service".length,
        text: CONFIG.replace("type: google.api.Service", "type: google.api.Service\\"),
      },
      {
        offset: CONFIG.indexOf(selector) + 1,
        text: CONFIG.replace(selector, '"\\uFEFFgoogle.cloud.chronicle.v1.RuleService.*"'),
      },
      {
        offset: CONFIG.indexOf("api_short_name: chronicle") + "api_short_name: chron".length,
        text: CONFIG.replace("api_short_name: chronicle", "api_short_name: chron\\icle"),
      },
    ];
    expect(cases.map(({ text }) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      cases.map(({ offset }) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `holds '\\' at offset ${offset}, which opens an escape that can decode outside the printable ASCII this reads`,
        }),
      ),
    );
  });

  it("refuses such a character wherever it sits, as the first byte or inside a value", () => {
    const nextLine = String.fromCodePoint(0x85);
    const value = "name: chronicle.googleapis.com";
    const texts = [`${nextLine}${CONFIG}`, CONFIG.replace(value, `${value}${nextLine}`)];
    const offsets = [0, CONFIG.indexOf(value) + value.length];
    expect(texts.map((text) => unwrapErr(parseChronicleServiceConfig({ text })))).toStrictEqual(
      offsets.map((offset) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `holds U+0085 at offset ${offset}, outside the printable ASCII and newlines this reads`,
        }),
      ),
    );
  });
});
