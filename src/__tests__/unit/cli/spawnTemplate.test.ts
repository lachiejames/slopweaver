/** {@link codexTemplateRefusal} and {@link resolveSpawnTemplate} — the spawn's template decision and its exit code. */
import { describe, expect, it } from "vitest";

import { codexTemplateRefusal, resolveSpawnTemplate } from "../../../cli/commands/cmux/spawnTemplate.js";
import { EXIT_USAGE } from "../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";

describe("codexTemplateRefusal", () => {
  it("says nothing when no --template was passed, on either driver", () => {
    expect(codexTemplateRefusal({ driver: "codex", flag: undefined })).toBeUndefined();
    expect(codexTemplateRefusal({ driver: "claude", flag: undefined })).toBeUndefined();
  });

  it("says nothing for a template on the claude driver, which is where it applies", () => {
    expect(codexTemplateRefusal({ driver: "claude", flag: "research" })).toBeUndefined();
  });

  it("refuses a template on codex, because codex never loaded what a template leaves out", () => {
    expect(codexTemplateRefusal({ driver: "codex", flag: "bot" })).toBe(
      "--template bot cannot be set on a codex spawn: codex expands no @ import, so it never loads the rules a " +
        "template leaves out and the flag would change nothing. Drop --template, or spawn on the claude driver",
    );
  });
});

describe("resolveSpawnTemplate", () => {
  const docWith = ({ template }: { template: string }) =>
    parseHandoverDoc({ path: "/h/a-doc.md", text: `---\nslug: a-doc\ntemplate: ${template}\n---\n` });

  it("boots the doc's own template when no flag names one", () => {
    expect(
      resolveSpawnTemplate({
        doc: docWith({ template: "research" }),
        driver: "claude",
        parsed: { positionals: [], values: {} },
      }),
    ).toBe("research");
  });

  it("refuses a misspelt doc template: instead of booting the role's default", () => {
    expect(
      resolveSpawnTemplate({
        doc: docWith({ template: "resarch" }),
        driver: "claude",
        parsed: { positionals: [], values: {} },
      }),
    ).toBe(EXIT_USAGE);
  });

  it("refuses a doubled template: line, whose misspelt repeat the parser would otherwise hide behind the first", () => {
    const doc = parseHandoverDoc({
      path: "/h/a-doc.md",
      text: "---\nslug: a-doc\ntemplate: research\ntemplate: resarch\n---\n",
    });

    expect(doc.template).toBe("research");
    expect(resolveSpawnTemplate({ doc, driver: "claude", parsed: { positionals: [], values: {} } })).toBe(EXIT_USAGE);
  });

  it("refuses a misspelt doc line even under a valid --template, as it refuses a doubled one", () => {
    const parsed = { positionals: [], values: { template: "bot" } };

    expect(resolveSpawnTemplate({ doc: docWith({ template: "resarch" }), driver: "claude", parsed })).toBe(EXIT_USAGE);
  });
});
