import { describe, expect, it } from "vitest";

import {
  isSelfOwner,
  ownerKind,
  ownersForPath,
  parseCodeowners,
  patternMatches,
  requiredOwners,
  requiredRules,
} from "../../../review/codeowners.js";

/** A trimmed copy of the work repository's own CODEOWNERS, kept for the shapes it exercises. */
const CONTENT = `# Default codeowner
* @org/eng

/apps/helpbot/ @reviewer-three
/packages/zenstack/schema.zmodel  @reviewer-five
.github @org/platform
/package.json @org/platform
.yarnrc.yml @org/platform @reviewer-one
/apps/etl @reviewer-six
/apps/etl/package.json @org/platform
/packages/config-manager/ @org/platform
/packages/config-manager/config/*/schema.ts
/packages/otel/ @author-login @reviewer-four
/packages/infra/cloud/index.ts # Remove ownership of the main index
/apps/ops/datadog/ @author-login
`;

const RULES = parseCodeowners({ content: CONTENT });

describe("parseCodeowners", () => {
  it("keeps a rule that names no owner, because that rule REMOVES ownership", () => {
    const rule = RULES.find((candidate) => candidate.pattern === "/packages/infra/cloud/index.ts")!;
    expect(rule.owners).toEqual([]);
  });

  it("strips a trailing comment from the owner list", () => {
    const rule = RULES.find((candidate) => candidate.pattern === "/packages/infra/cloud/index.ts")!;
    expect(rule.pattern).toBe("/packages/infra/cloud/index.ts");
  });

  it("drops comment-only and blank lines", () => {
    expect(RULES.length).toBe(13);
  });

  it("keeps every owner on a multi-owner rule", () => {
    const rule = RULES.find((candidate) => candidate.pattern === ".yarnrc.yml")!;
    expect(rule.owners).toEqual(["@org/platform", "@reviewer-one"]);
  });
});

describe("patternMatches", () => {
  it("matches everything for the bare default rule", () => {
    expect(patternMatches({ path: "a/b/c.ts", pattern: "*" })).toBe(true);
  });

  it("owns everything under a `**/logs` directory at any depth, GitHub's own example", () => {
    expect(patternMatches({ path: "deeply/nested/logs/error.txt", pattern: "**/logs" })).toBe(true);
    expect(patternMatches({ path: "build/logs/x/y.txt", pattern: "/build/logs/" })).toBe(true);
    expect(patternMatches({ path: "deeply/nested/catalogs/error.txt", pattern: "**/logs" })).toBe(false);
  });

  it("owns what is inside a trailing `/**` directory, never a file bearing that directory's name", () => {
    expect(patternMatches({ path: "foo", pattern: "/foo/**" })).toBe(false);
    expect(patternMatches({ path: "foo/a.ts", pattern: "/foo/**" })).toBe(true);
    expect(patternMatches({ path: "foo/b/c.ts", pattern: "/foo/**" })).toBe(true);
  });

  it("owns only what is BELOW a trailing `/**/` directory, never its direct files, as `git check-ignore` does", () => {
    expect(patternMatches({ path: "foo/direct.txt", pattern: "/foo/**/" })).toBe(false);
    expect(patternMatches({ path: "foo/bar/deep.txt", pattern: "/foo/**/" })).toBe(true);
    expect(patternMatches({ path: "foo/direct.txt", pattern: "foo/**/" })).toBe(false);
  });

  it("lets a middle `**` take no directory, so `/foo/**/**` owns a file directly inside `foo`", () => {
    expect(patternMatches({ path: "foo/direct.txt", pattern: "/foo/**/**" })).toBe(true);
    expect(patternMatches({ path: "foo/bar/deep.txt", pattern: "/foo/**/**/" })).toBe(true);
    expect(patternMatches({ path: "foo/direct.txt", pattern: "/foo/**/**/" })).toBe(false);
    expect(patternMatches({ path: "foo", pattern: "/foo/**/**" })).toBe(false);
  });

  it("owns nothing by a bare `/` or a doubled slash, the way `git check-ignore` reads them", () => {
    expect(patternMatches({ path: "README.md", pattern: "/" })).toBe(false);
    expect(patternMatches({ path: "a/b.ts", pattern: "//" })).toBe(false);
    expect(patternMatches({ path: "foo/x.ts", pattern: "foo//" })).toBe(false);
    expect(patternMatches({ path: "foo/x.ts", pattern: "//foo" })).toBe(false);
    expect(patternMatches({ path: "foo/x.ts", pattern: "/foo/" })).toBe(true);
  });

  it("reads an anchored `/*` as the root's direct files, the way `docs/*` is a directory's", () => {
    expect(patternMatches({ path: "README.md", pattern: "/*" })).toBe(true);
    expect(patternMatches({ path: "src/a.ts", pattern: "/*" })).toBe(false);
    expect(patternMatches({ path: "src/a.ts", pattern: "/**" })).toBe(true);
  });

  it("owns every file beneath a directory pattern", () => {
    expect(patternMatches({ path: "apps/helpbot/src/x.ts", pattern: "/apps/helpbot/" })).toBe(true);
  });

  it("owns every file beneath a directory named without a trailing slash", () => {
    expect(patternMatches({ path: "apps/etl/main.ts", pattern: "/apps/etl" })).toBe(true);
  });

  it("floats a pattern carrying no slash to any depth", () => {
    expect(patternMatches({ path: "packages/foo/.github/x.yml", pattern: ".github" })).toBe(true);
  });

  it("anchors a pattern that carries a slash to the repository root", () => {
    expect(patternMatches({ path: "apps/foo/package.json", pattern: "/package.json" })).toBe(false);
  });

  it("matches a star inside one segment and never across a slash", () => {
    expect(
      patternMatches({
        path: "packages/config-manager/config/agent-system/schema.ts",
        pattern: "/packages/config-manager/config/*/schema.ts",
      }),
    ).toBe(true);
    expect(
      patternMatches({
        path: "packages/config-manager/config/a/b/schema.ts",
        pattern: "/packages/config-manager/config/*/schema.ts",
      }),
    ).toBe(false);
  });

  it("owns a directory's direct files with a trailing star, never a deeper one, as GitHub documents", () => {
    expect(patternMatches({ path: "docs/getting-started.md", pattern: "docs/*" })).toBe(true);
    expect(patternMatches({ path: "docs/build-app/troubleshooting.md", pattern: "docs/*" })).toBe(false);
  });

  it("still owns everything beneath the directories a trailing-slash star names", () => {
    expect(patternMatches({ path: "docs/sub/a.md", pattern: "/docs/*/" })).toBe(true);
    expect(patternMatches({ path: "docs/sub/deeper/b.md", pattern: "/docs/*/" })).toBe(true);
  });

  it("never gives a trailing-slash pattern a file of that name, only what is under the directory", () => {
    expect(patternMatches({ path: "docs/readme.md", pattern: "/docs/*/" })).toBe(false);
    expect(patternMatches({ path: "apps/helpbot", pattern: "/apps/helpbot/" })).toBe(false);
  });

  it("keeps containment for a star inside a segment, so a floating `foo*` still owns a `foobar` directory", () => {
    expect(patternMatches({ path: "foobar/deep.ts", pattern: "foo*" })).toBe(true);
  });

  it("reads `?` as exactly one character inside a segment, never a slash or none", () => {
    expect(patternMatches({ path: "src/file1.ts", pattern: "/src/file?.ts" })).toBe(true);
    expect(patternMatches({ path: "src/file.ts", pattern: "/src/file?.ts" })).toBe(false);
    expect(patternMatches({ path: "src/file12.ts", pattern: "/src/file?.ts" })).toBe(false);
  });

  it("skips a `[ ]` range or `!` negation line, which GitHub does not take", () => {
    const content = "* @org/default\n/src/[ab].ts @org/special\n!/src/c.ts @org/other";
    const rules = parseCodeowners({ content });
    expect(rules.map((rule) => rule.pattern)).toEqual(["*"]);
    expect(ownersForPath({ path: "src/a.ts", rules })).toEqual(["@org/default"]);
  });

  it("matches a character outside the BMP as one character, literally and under `?`", () => {
    // Spelled as an escape, so the source carries no raw astral character for a tool to cut in half.
    const emoji = "\u{1F600}";
    expect(patternMatches({ path: `${emoji}.ts`, pattern: `/${emoji}.ts` })).toBe(true);
    expect(patternMatches({ path: `a${emoji}.ts`, pattern: "/a?.ts" })).toBe(true);
  });

  it("reads a run of three stars as one `*`, the way gitignore does", () => {
    const rules = parseCodeowners({ content: "* @default\n***.js @javascript" });
    expect(ownersForPath({ path: "src/a.js", rules })).toEqual(["@javascript"]);
    expect(ownersForPath({ path: "src/a.ts", rules })).toEqual(["@default"]);
    expect(patternMatches({ path: "src/a.ts", pattern: "/***/a.ts" })).toBe(true);
    expect(patternMatches({ path: "src/b/a.ts", pattern: "/***/a.ts" })).toBe(false);
    expect(patternMatches({ path: "src/a.ts", pattern: "/***" })).toBe(false);
    expect(patternMatches({ path: "README.md", pattern: "/***" })).toBe(true);
    expect(parseCodeowners({ content: "*** @default" }).map((rule) => rule.pattern)).toEqual(["*"]);
  });

  it("lets a star retry after a partial match, so `*.test.ts` owns `a.test.test.ts`", () => {
    expect(patternMatches({ path: "src/a.test.test.ts", pattern: "*.test.ts" })).toBe(true);
    expect(patternMatches({ path: "src/a.test.tsx", pattern: "*.test.ts" })).toBe(false);
  });
});

describe("ownersForPath", () => {
  it("falls back to the default rule when nothing more specific matches", () => {
    expect(ownersForPath({ path: "README.md", rules: RULES })).toEqual(["@org/eng"]);
  });

  it("lets the LAST matching rule win rather than the union of every match", () => {
    expect(ownersForPath({ path: "apps/etl/package.json", rules: RULES })).toEqual(["@org/platform"]);
  });

  it("keeps the earlier rule for a path the later one does not match", () => {
    expect(ownersForPath({ path: "apps/etl/main.ts", rules: RULES })).toEqual(["@reviewer-six"]);
  });

  it("reports NO owner for a path whose last matching rule removes ownership", () => {
    expect(ownersForPath({ path: "packages/infra/cloud/index.ts", rules: RULES })).toEqual([]);
  });

  it("reports no owner for a schema file the ownership-removing star rule matches", () => {
    expect(ownersForPath({ path: "packages/config-manager/config/agent-system/schema.ts", rules: RULES })).toEqual([]);
  });
});

describe("requiredOwners", () => {
  it("names each distinct owner once, with the paths that required it", () => {
    const owners = requiredOwners({ paths: ["apps/etl/main.ts", "README.md", "apps/etl/infra/x.ts"], rules: RULES });
    expect(owners).toEqual([
      { kind: "team", paths: ["README.md"], token: "@org/eng" },
      { kind: "user", paths: ["apps/etl/main.ts", "apps/etl/infra/x.ts"], token: "@reviewer-six" },
    ]);
  });

  it("reports nothing for a change touching only unowned paths", () => {
    expect(requiredOwners({ paths: ["packages/infra/cloud/index.ts"], rules: RULES })).toEqual([]);
  });
});

describe("requiredRules", () => {
  it("keeps the RULE as the unit, so two rules invoked by one change stay two requirements", () => {
    const rules = requiredRules({ paths: ["apps/etl/main.ts", "README.md", ".yarnrc.yml"], rules: RULES });
    expect(rules).toEqual([
      { owners: ["@org/eng"], paths: ["README.md"], pattern: "*" },
      { owners: ["@org/platform", "@reviewer-one"], paths: [".yarnrc.yml"], pattern: ".yarnrc.yml" },
      { owners: ["@reviewer-six"], paths: ["apps/etl/main.ts"], pattern: "/apps/etl" },
    ]);
  });

  // `requiredOwners` flattens these two rules to `@org/platform @reviewer-six` and cannot tell whether one
  // approval or two is owed. That collapse is what let one satisfied rule read as all of them.
  it("splits what the flattened owner list merges — one rule per requirement", () => {
    const paths = ["apps/etl/main.ts", "apps/etl/package.json"];
    expect(requiredOwners({ paths, rules: RULES }).map((owner) => owner.token)).toEqual([
      "@org/platform",
      "@reviewer-six",
    ]);
    expect(requiredRules({ paths, rules: RULES }).map((rule) => rule.pattern)).toEqual([
      "/apps/etl",
      "/apps/etl/package.json",
    ]);
  });

  it("leaves out a rule that removes ownership, which requires nothing", () => {
    expect(requiredRules({ paths: ["packages/infra/cloud/index.ts"], rules: RULES })).toEqual([]);
  });
});

describe("ownerKind and isSelfOwner", () => {
  it("reads a slash as a team", () => {
    expect(ownerKind({ token: "@org/platform" })).toBe("team");
    expect(ownerKind({ token: "@reviewer-one" })).toBe("user");
  });

  it("recognises the author's own login regardless of case", () => {
    expect(isSelfOwner({ authorLogin: "Author-Login", token: "@author-login" })).toBe(true);
  });

  it("never calls a team the author", () => {
    expect(isSelfOwner({ authorLogin: "author-login", token: "@org/platform" })).toBe(false);
  });
});
