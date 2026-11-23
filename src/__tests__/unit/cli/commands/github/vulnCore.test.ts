import { describe, expect, it } from "vitest";

import { GithubVerbErrors, githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { parseGithubVulnArgs } from "../../../../../cli/commands/github/vulnCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubVulnArgs list", () => {
  it("parses the repository and both filters", () => {
    const parsed = parseGithubVulnArgs({
      argv: ["list", "--repo", "acme/widget", "--severity", "critical", "--state", "open"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({
      home: undefined,
      json: false,
      owner: "acme",
      repo: "widget",
      severity: "critical",
      state: "open",
      subVerb: "list",
    });
  });

  it("defaults severity to absent and state to OPEN, which the usage line has always promised", () => {
    const parsed = parseGithubVulnArgs({ argv: ["list", "--repo", "acme/widget"] });
    expect(unwrap(parsed)).toEqual({
      home: undefined,
      json: false,
      owner: "acme",
      repo: "widget",
      severity: undefined,
      state: "open",
      subVerb: "list",
    });
  });

  it("keeps an explicitly named state, so the default never overrides a caller", () => {
    const parsed = parseGithubVulnArgs({ argv: ["list", "--repo", "acme/widget", "--state", "fixed"] });
    expect(unwrap(parsed)).toMatchObject({ state: "fixed", subVerb: "list" });
  });

  it("refuses a severity outside GitHub's own enum", () => {
    const parsed = parseGithubVulnArgs({ argv: ["list", "--repo", "acme/widget", "--severity", "urgent"] });
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--severity must be one of low, medium, high, critical",
    ]);
  });

  it("accepts auto_dismissed, which Dependabot has and code scanning does not", () => {
    const parsed = parseGithubVulnArgs({ argv: ["list", "--repo", "acme/widget", "--state", "auto_dismissed"] });
    expect(unwrap(parsed)).toMatchObject({ state: "auto_dismissed", subVerb: "list" });
  });

  it("refuses --number on list and names the verb that takes it", () => {
    const parsed = parseGithubVulnArgs({ argv: ["list", "--repo", "acme/widget", "--number", "5"] });
    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() }).join(" ")).toContain("github vuln get");
  });

  it("refuses a missing repository", () => {
    const parsed = parseGithubVulnArgs({ argv: ["list"] });
    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })).toContain("--repo owner/name is required");
  });
});

describe("parseGithubVulnArgs get", () => {
  it("parses one alert number", () => {
    const parsed = parseGithubVulnArgs({ argv: ["get", "--repo", "acme/widget", "--number", "583"] });
    expect(unwrap(parsed)).toEqual({
      home: undefined,
      json: false,
      number: 583,
      owner: "acme",
      repo: "widget",
      subVerb: "get",
    });
  });

  it("refuses a non-numeric alert number", () => {
    const parsed = parseGithubVulnArgs({ argv: ["get", "--repo", "acme/widget", "--number", "GHSA-1"] });
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--number must be a positive whole number — the Dependabot alert's own number, not a PR number",
    ]);
  });

  it("refuses a list filter on get", () => {
    const parsed = parseGithubVulnArgs({
      argv: ["get", "--repo", "acme/widget", "--number", "5", "--severity", "high"],
    });
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["--severity is not a `get` flag"]);
  });
});

describe("parseGithubVulnArgs body", () => {
  it("takes the form inline and needs no repository", () => {
    const parsed = parseGithubVulnArgs({ argv: ["body", "--form", "{}"] });
    expect(unwrap(parsed)).toEqual({
      home: undefined,
      json: false,
      out: undefined,
      source: { from: "form", text: "{}" },
      subVerb: "body",
    });
  });

  it("takes the form from a file as the file arm, never a form", () => {
    const parsed = parseGithubVulnArgs({ argv: ["body", "--file", "f.json"] });
    expect(unwrap(parsed)).toEqual({
      home: undefined,
      json: false,
      out: undefined,
      source: { from: "file", path: "f.json" },
      subVerb: "body",
    });
  });

  it("refuses an empty --file path apart from a missing form", () => {
    const parsed = parseGithubVulnArgs({ argv: ["body", "--file", ""] });
    expect(unwrapErr(parsed).code).toBe("INVALID_FLAG_VALUE");
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--file was given an empty value — pass the value itself",
    ]);
  });

  it("names an empty source value before the exclusive pair it came in", () => {
    const bothEmpty = unwrapErr(parseGithubVulnArgs({ argv: ["body", "--form", "", "--file", ""] }));
    expect(bothEmpty).toStrictEqual(GithubVerbErrors.flagValueEmpty({ flag: "--form" }));
    const formEmpty = unwrapErr(parseGithubVulnArgs({ argv: ["body", "--form", "", "--file", "f.json"] }));
    expect(formEmpty).toStrictEqual(GithubVerbErrors.flagValueEmpty({ flag: "--form" }));
    const fileEmpty = unwrapErr(parseGithubVulnArgs({ argv: ["body", "--form", "{}", "--file", ""] }));
    expect(fileEmpty).toStrictEqual(GithubVerbErrors.flagValueEmpty({ flag: "--file" }));
  });

  it("refuses an empty --form apart from a missing form", () => {
    const parsed = parseGithubVulnArgs({ argv: ["body", "--form", ""] });
    expect(unwrapErr(parsed).code).toBe("INVALID_FLAG_VALUE");
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--form was given an empty value — pass the value itself",
    ]);
  });

  it("keeps a missing or empty source typed even beside another refused flag", () => {
    expect(unwrapErr(parseGithubVulnArgs({ argv: ["body", "--state", "open"] })).code).toBe("FLAG_MISSING");
    expect(unwrapErr(parseGithubVulnArgs({ argv: ["body", "--form", "", "--state", "open"] })).code).toBe(
      "INVALID_FLAG_VALUE",
    );
  });

  it("refuses --form and --file together", () => {
    const parsed = parseGithubVulnArgs({ argv: ["body", "--form", "{}", "--file", "f.json"] });
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--form and --file are exclusive; give the form once",
    ]);
  });

  it("refuses a body with no form at all", () => {
    const parsed = parseGithubVulnArgs({ argv: ["body"] });
    expect(unwrapErr(parsed).code).toBe("FLAG_MISSING");
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "`body` needs the form: --form <json|-> or --file <path|->",
    ]);
  });
});

describe("parseGithubVulnArgs", () => {
  it("refuses an unknown sub-verb", () => {
    const parsed = parseGithubVulnArgs({ argv: ["dismiss", "--repo", "acme/widget"] });
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "usage: slopweaver github vuln <list|get|body|surfaces> [...]",
    ]);
  });
});

describe("parseGithubVulnArgs surfaces", () => {
  it("parses the package and the checkout, with the measured default threshold", () => {
    const parsed = parseGithubVulnArgs({ argv: ["surfaces", "--package", "@pdfme/ui", "--checkout", "/src/app"] });
    expect(unwrap(parsed)).toEqual({
      checkout: "/src/app",
      everywhereAt: 12,
      home: undefined,
      json: false,
      packageName: "@pdfme/ui",
      subVerb: "surfaces",
    });
  });

  it("takes an explicit threshold", () => {
    const parsed = parseGithubVulnArgs({
      argv: ["surfaces", "--package", "lodash", "--checkout", ".", "--everywhere-at", "30"],
    });
    expect(unwrap(parsed)).toMatchObject({ everywhereAt: 30, subVerb: "surfaces" });
  });

  it("needs both the package and the checkout, and says which is missing", () => {
    const parsed = parseGithubVulnArgs({ argv: ["surfaces"] });
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })).toEqual([
      "`surfaces` needs --package <name>, as the manifest names it",
      "`surfaces` needs --checkout <dir>, the checkout to walk",
    ]);
  });

  it("refuses a threshold that is not a positive whole number", () => {
    const parsed = parseGithubVulnArgs({
      argv: ["surfaces", "--package", "lodash", "--checkout", ".", "--everywhere-at", "0"],
    });
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })).toEqual([
      "--everywhere-at must be a positive whole number of importers or features",
    ]);
  });

  it("refuses --repo, which it would otherwise silently ignore", () => {
    const parsed = parseGithubVulnArgs({
      argv: ["surfaces", "--package", "lodash", "--checkout", ".", "--repo", "acme/widget"],
    });
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })).toEqual([
      "--repo is not a `surfaces` flag; --checkout names the tree it walks",
    ]);
  });

  it("refuses its own flags on a sub-verb that reads GitHub", () => {
    const parsed = parseGithubVulnArgs({ argv: ["list", "--repo", "acme/widget", "--package", "lodash"] });
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() }).join(" ")).toContain(
      "--package is not a `list` flag; it belongs to `surfaces`",
    );
  });
});
