/**
 * {@link claudeTemplateSuffix} and the rest of `cmux/launchTemplate.ts` — which template a seat boots from,
 * and the exact `--settings` text it adds to the boot line.
 */
import { describe, expect, it } from "vitest";

import {
  CODE_STANDARD_RULES,
  claudeMdExcludesFor,
  claudeTemplateSuffix,
  defaultTemplateForRole,
  isLaunchTemplate,
  LAUNCH_TEMPLATES,
  launchTemplateLine,
  measureLaunchTemplates,
  resolveLaunchTemplate,
  templateField,
  templateProblems,
} from "../../../cmux/launchTemplate.js";

describe("the template registry", () => {
  it("names code first, because code is the default", () => {
    expect(LAUNCH_TEMPLATES).toEqual(["code", "research", "supervisor", "bot"]);
  });

  it("guards a string against the registry", () => {
    expect(isLaunchTemplate("research")).toBe(true);
    expect(isLaunchTemplate("resarch")).toBe(false);
    expect(isLaunchTemplate(undefined)).toBe(false);
  });
});

describe("defaultTemplateForRole", () => {
  it("maps each standing surface to its own template and a workstream session to code", () => {
    expect(defaultTemplateForRole({ role: "supervisor" })).toBe("supervisor");
    expect(defaultTemplateForRole({ role: "bot" })).toBe("bot");
    expect(defaultTemplateForRole({ role: "scheduler" })).toBe("research");
    expect(defaultTemplateForRole({ role: "session" })).toBe("code");
  });
});

describe("resolveLaunchTemplate", () => {
  it("takes --template over the doc and the role", () => {
    expect(resolveLaunchTemplate({ docTemplate: "bot", flag: "research", role: "supervisor" })).toEqual({
      source: "flag",
      template: "research",
    });
  });

  it("takes the doc's template: over the role", () => {
    expect(resolveLaunchTemplate({ docTemplate: "bot", flag: undefined, role: "supervisor" })).toEqual({
      source: "doc",
      template: "bot",
    });
  });

  it("falls to the role's default when nothing names one, and says so", () => {
    expect(resolveLaunchTemplate({ docTemplate: undefined, flag: undefined, role: "session" })).toEqual({
      source: "role",
      template: "code",
    });
  });

  it("refuses a misspelt doc template: rather than booting the role's default as if none were written", () => {
    expect(resolveLaunchTemplate({ docTemplate: "resarch", flag: undefined, role: "session" })).toEqual({
      error: 'the doc\'s template: must be one of code|research|supervisor|bot, got "resarch"',
    });
  });

  it("refuses a misspelt doc template: even when a valid --template would otherwise win", () => {
    expect(resolveLaunchTemplate({ docTemplate: "resarch", flag: "bot", role: "session" })).toEqual({
      error: 'the doc\'s template: must be one of code|research|supervisor|bot, got "resarch"',
    });
  });

  it("refuses an unknown --template, naming the valid set", () => {
    expect(resolveLaunchTemplate({ docTemplate: undefined, flag: "lean", role: "session" })).toEqual({
      error: '--template must be one of code|research|supervisor|bot, got "lean"',
    });
  });
});

describe("templateProblems", () => {
  it("raises a problem for an unknown template: line, so the doc is malformed", () => {
    expect(templateProblems({ declared: "resarch" })).toEqual([
      'template must be one of code|research|supervisor|bot, got "resarch"',
    ]);
  });

  it("raises none for an absent line or a real template", () => {
    expect(templateProblems({ declared: undefined })).toEqual([]);
    expect(templateProblems({ declared: "bot" })).toEqual([]);
  });
});

describe("templateField", () => {
  it("carries the line as declared, a misspelling included, and no key at all when it is absent", () => {
    expect(templateField({ declared: "bot" })).toEqual({ template: "bot" });
    expect(templateField({ declared: "resarch" })).toEqual({ template: "resarch" });
    expect(templateField({ declared: undefined })).toEqual({});
  });
});

describe("claudeMdExcludesFor", () => {
  it("leaves nothing out for the code template", () => {
    expect(claudeMdExcludesFor({ cwd: "/work/acme", template: "code" })).toEqual([]);
  });

  it("names each code-standard rule under the seat's own directory for every other template, a trailing slash or not", () => {
    const expected = CODE_STANDARD_RULES.map((rule) => `/work/acme/${rule}`);
    expect(expected.length).toBeGreaterThan(0);
    expect(
      (["research", "supervisor", "bot"] as const).map((template) =>
        claudeMdExcludesFor({ cwd: "/work/acme/", template }),
      ),
    ).toEqual([expected, expected, expected]);
  });

  it("is the very list the boot line carries when the directory is spelled out", () => {
    const cwd = '/work/a"cme';
    expect(claudeTemplateSuffix({ cwd, template: "bot" })).toContain(
      JSON.stringify({ claudeMdExcludes: claudeMdExcludesFor({ cwd, template: "bot" }) }).replaceAll("'", "'\\''"),
    );
  });
});

describe("claudeTemplateSuffix", () => {
  it("adds nothing for code, so a code seat's boot line is byte-identical to the pre-template one", () => {
    expect(claudeTemplateSuffix({ cwd: "/tmp/repo", template: "code" })).toBe("");
  });

  it("excludes the three code-standards rules by absolute path, spelled $PWD for the shell it is typed into", () => {
    expect(claudeTemplateSuffix({ cwd: "/tmp/repo/", template: "supervisor" })).toBe(
      ` --settings "{\\"claudeMdExcludes\\":[\\"$PWD/.claude/rules/typescript-patterns.md\\",` +
        `\\"$PWD/.claude/rules/testing.md\\",\\"$PWD/.claude/rules/error-handling.md\\"]}"`,
    );
  });

  // MEASURED: this worktree's 150-byte cwd, spelled out three times, took a bot seat's typed boot
  // line past the terminal's 1,024-byte MAX_CANON and the seat sat at `quote>`. The suffix no longer grows
  // with the cwd, which is the property; the cwd below is that worktree's own length.
  it("is the same length whatever the cwd, so a long worktree path cannot push the line past the terminal", () => {
    const longCwd = `/Users/someone/dev/personal/slopweaver/.claude/worktrees.noindex/${"a".repeat(84)}`;

    expect(claudeTemplateSuffix({ cwd: longCwd, template: "bot" }).length).toBe(
      claudeTemplateSuffix({ cwd: "/r", template: "bot" }).length,
    );
    expect(claudeTemplateSuffix({ cwd: "/r", template: "bot" }).length).toBe(159);
  });

  it("keeps the JSON valid when the cwd carries a space and an apostrophe, which double quotes hold as-is", () => {
    expect(claudeTemplateSuffix({ cwd: "/tmp/ada's repo", template: "bot" })).toBe(
      claudeTemplateSuffix({ cwd: "/tmp/repo", template: "bot" }),
    );
  });

  it("falls back to the spelled-out single-quoted form when the cwd carries a double quote", () => {
    const root = `/tmp/a"b/.claude/rules`;
    const json = JSON.stringify({
      claudeMdExcludes: [`${root}/typescript-patterns.md`, `${root}/testing.md`, `${root}/error-handling.md`],
    });

    expect(claudeTemplateSuffix({ cwd: `/tmp/a"b`, template: "bot" })).toBe(` --settings '${json}'`);
  });
});

describe("launchTemplateLine", () => {
  it("says what a non-code template leaves out and where it came from", () => {
    expect(launchTemplateLine({ source: "role", template: "bot" })).toBe(
      "launch template bot (from role) — leaves out .claude/rules/typescript-patterns.md, " +
        ".claude/rules/testing.md, .claude/rules/error-handling.md",
    );
  });

  it("says a code template loads everything", () => {
    expect(launchTemplateLine({ source: "flag", template: "code" })).toBe(
      "launch template code (from flag) — loads every standing rule",
    );
  });
});

describe("measureLaunchTemplates", () => {
  const alwaysOn = [
    { content: "@AGENTS.md\n", path: "CLAUDE.md" },
    { content: "agents body\n", path: "AGENTS.md" },
    ...CODE_STANDARD_RULES.map((path) => ({ content: "0123456789", path })),
    { content: "grants\n", path: ".claude/rules/journalled-grants.md" },
  ];

  it("counts every always-on byte for code and drops the three rules for the rest", () => {
    const measured = measureLaunchTemplates({ alwaysOn });

    expect(measured.map((row) => [row.template, row.bytes, row.approximateTokens])).toEqual([
      ["code", 11 + 12 + 30 + 7, 15],
      ["research", 11 + 12 + 7, 8],
      ["supervisor", 30, 8],
      ["bot", 30, 8],
    ]);
    expect(measured[1]!.loadedPaths).toEqual(["CLAUDE.md", "AGENTS.md", ".claude/rules/journalled-grants.md"]);
  });
});
