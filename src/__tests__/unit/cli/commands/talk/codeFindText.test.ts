/** `talk code find`'s literal from `--text` or `--text-hex`: each spelling, and every way the pair is refused. */
import { describe, expect, it } from "vitest";

import { CodeFindTextErrors, codeFindText } from "../../../../../cli/commands/talk/codeFindText.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("codeFindText", () => {
  it("passes a plain --text through unchanged, and undefined when neither is given", () => {
    expect(unwrap(codeFindText({ hex: undefined, plain: "needle" }))).toBe("needle");
    expect(unwrap(codeFindText({ hex: undefined, plain: undefined }))).toBeUndefined();
  });

  it("decodes --text-hex to a literal that starts with a hyphen", () => {
    expect(unwrap(codeFindText({ hex: "2d2d6a736f6e", plain: undefined }))).toBe("--json");
  });

  it("refuses both spellings at once", () => {
    const refused = unwrapErr(codeFindText({ hex: "6e", plain: "n" }));
    expect(refused).toEqual(CodeFindTextErrors.both());
    expect(refused.message).toBe("talk code find takes --text or --text-hex, not both");
  });

  it("refuses empty, odd-length and uppercase hex", () => {
    expect(unwrapErr(codeFindText({ hex: "", plain: undefined })).code).toBe("TEXT_HEX_MALFORMED");
    expect(unwrapErr(codeFindText({ hex: "2d2", plain: undefined })).code).toBe("TEXT_HEX_MALFORMED");
    expect(unwrapErr(codeFindText({ hex: "2D2D", plain: undefined }))).toEqual(CodeFindTextErrors.malformed());
  });

  it("refuses bytes that are not UTF-8", () => {
    expect(unwrapErr(codeFindText({ hex: "ff", plain: undefined }))).toEqual(CodeFindTextErrors.notUtf8());
  });
});
