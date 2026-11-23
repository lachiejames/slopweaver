/**
 * The error-shape-threshold gate's own tests. Three properties, and each is the rule rather than a sample:
 * the matcher reads every string an author TYPES into an `err`/`errAsync` call and nothing forwarded or
 * routed through a union; two sites differing only in what they interpolate are ONE shape, and the count is
 * of distinct shapes per directory; and the threshold is applied before the debt list. The ratchet this gate
 * then judges against is `countRatchet.ts`, tested with the ratchet.
 *
 * The first case is the audit's own finding — a verb directory whose `${flag} is required` family had grown
 * past anything the plain string list was kept for — because a gate that did not catch the shape it was
 * ruled into existence over would be worth nothing.
 */
import { describe, expect, it } from "vitest";
import {
  countsOf,
  type DirectoryCount,
  isScannablePath,
  MAX_PLAIN_SHAPES,
  overThreshold,
} from "../../../devLint/errorShapeThreshold.js";
import { scanErrorShapeFacts } from "../../../devLint/errorShapeThresholdFacts.js";
import { resolveErrorShapeFacts, type ShapeSite } from "../../../devLint/errorShapeThresholdResolve.js";

/**
 * The `Result` constructors' import, appended rather than prepended — an import hoists, so each case's line numbers
 * stay the lines it was written on.
 */
const RESULT_IMPORT = '\nimport { err, errAsync } from "#lib/result.js";\n';

/** Both halves over one file, as the gate runs them over the pool: every resolved site. */
function scanErrorShapes({ content, path }: { content: string; path: string }): readonly ShapeSite[] {
  return resolveErrorShapeFacts({ facts: scanErrorShapeFacts({ content: content + RESULT_IMPORT, path }) });
}

/** Scan one snippet as if it were a source file, as `<line> <shape>` pairs. */
function shapes({ content, path = "src/x/a.ts" }: { content: string; path?: string }): readonly string[] {
  return scanErrorShapes({ content, path }).map((site) => `${String(site.line)} ${site.shape}`);
}

/** One counted directory, for building a debt list in a test. */
function entry({ path, count }: { path: string; count: number }): DirectoryCount {
  return { count, path };
}

describe("scanErrorShapes — the shapes it must catch", () => {
  it("catches a string literal typed into an err array", () => {
    expect(shapes({ content: 'return err(["a Slack permalink is required"]);\n' })).toEqual([
      "1 a Slack permalink is required",
    ]);
  });

  it("catches a template, normalising every hole so the interpolated value is not part of the shape", () => {
    const content = "return err([`${flag} is required`]);\nreturn err([`${other} is required`]);\n";
    expect(shapes({ content })).toEqual(["1 {} is required", "2 {} is required"]);
  });

  it("catches every element of a multi-string array, each as its own shape", () => {
    const content = 'return err(["--poll needs --dispatch", "usage: turn review --dispatch <id>"]);\n';
    expect(shapes({ content })).toEqual(["1 --poll needs --dispatch", "1 usage: turn review --dispatch <id>"]);
  });

  it("catches a bare string argument — the Result<T, string> spelling", () => {
    expect(shapes({ content: 'return err("debt list missing");\n' })).toEqual(["1 debt list missing"]);
  });

  it("catches a bare template argument", () => {
    expect(shapes({ content: "return err(`could not read ${path}`);\n" })).toEqual(["1 could not read {}"]);
  });

  it("catches errAsync exactly as err", () => {
    expect(shapes({ content: 'return errAsync(["no token configured"]);\n' })).toEqual(["1 no token configured"]);
  });

  it("catches an err call wherever an expression may sit — a ternary arm, a return, an argument", () => {
    const content = 'const r = ok ? okValue : err(["not ok"]);\nreport(err(["nested"]));\n';
    expect(shapes({ content })).toEqual(["1 not ok", "2 nested"]);
  });

  it("catches the literal elements of a mixed array and skips an identifier bound to nothing it can read", () => {
    const content = 'return err(["pass --dispatch <id>", TURN_REVIEW_USAGE]);\n';
    expect(shapes({ content })).toEqual(["1 pass --dispatch <id>"]);
  });

  it("follows a module const into the err that uses it, charged at the use", () => {
    const content = 'const USAGE = "usage: verb <id>";\nreturn err(["bad id", USAGE]);\n';
    expect(shapes({ content })).toEqual(["2 bad id", "2 usage: verb <id>"]);
  });

  it("reads both arms of a conditional, and drops an arm with no literal text", () => {
    const content = 'return err([ready ? "not yet" : `stale by ${n}`]);\nreturn err([why ? why : "no reason"]);\n';
    expect(shapes({ content })).toEqual(["1 not yet", "1 stale by {}", "2 no reason"]);
  });

  it("follows a const bound to an array, and a conditional choosing between arrays", () => {
    const content =
      'const MISSING = "needs --turn";\nfunction f() {\n  const problems = gone ? [MISSING] : [];\n  return err(problems);\n}\n';
    expect(shapes({ content })).toEqual(["4 needs --turn"]);
  });

  it("follows a spread item into the array literal it spreads", () => {
    expect(shapes({ content: 'return err(["inline", ...["spread"]]);\n' })).toEqual(["1 inline", "1 spread"]);
  });

  it("follows a conditional spread into its arms — the problem-list spelling", () => {
    const content = 'return err(["the call did not answer", ...(ok ? [] : ["it answered HTTP 500"])]);\n';
    expect(shapes({ content })).toEqual(["1 the call did not answer", "1 it answered HTTP 500"]);
  });

  it("follows a spread of a name bound to a const array, charged at the err use", () => {
    const content = [
      "function f() {",
      "  const problems = [...(weeks > 0 ? [] : [`--weeks must be positive, got ${weeks}`])];",
      "  return err([...problems, USAGE]);",
      "}",
      'const USAGE = "usage: forecast";',
      "",
    ].join("\n");
    expect(shapes({ content })).toEqual(["3 --weeks must be positive, got {}", "3 usage: forecast"]);
  });

  it("follows a const in an enclosing block and in a for header, not past a shadowing one", () => {
    const content = [
      'const M = "outer";',
      "function f() {",
      '  const M = "inner";',
      "  return err([M]);",
      "}",
      'for (const each of ["looped"]) {',
      "  err([each]);",
      "}",
      'for (const W = "header"; ; ) {',
      "  err([W]);",
      "}",
    ].join("\n");
    expect(shapes({ content })).toEqual(["4 inner", "10 header"]);
  });

  it("ends a cycle of consts rather than looping", () => {
    const content =
      "function f() {\n  const a = b;\n  const b = a;\n  return err([a]);\n}\nconst x = y;\nconst y = x;\nerr([x]);\n";
    expect(shapes({ content })).toEqual([]);
  });

  it("catches a plus-chain of literals as ONE shape — the spelling Prettier gives a long message", () => {
    const content =
      'return err([\n  "GitHub accepted the merge as pending but named no uuid " +\n    "to poll it by",\n]);\n';
    expect(shapes({ content })).toEqual(["2 GitHub accepted the merge as pending but named no uuid to poll it by"]);
  });

  it("reads a non-literal operand of a plus-chain as a hole, exactly as a template's", () => {
    const content = 'return err(["could not read " + path]);\nreturn err([`could not read ${path}`]);\n';
    expect(shapes({ content })).toEqual(["1 could not read {}", "2 could not read {}"]);
  });

  it("sees through a wrapper that changes only the type — parentheses, as const, satisfies", () => {
    const content = 'return err((["a"]));\nreturn err(["b"] as const);\nreturn err(["c" satisfies string]);\n';
    expect(shapes({ content })).toEqual(["1 a", "2 b", "3 c"]);
  });

  it("reports the line of the string itself when the array wraps", () => {
    const content = 'return err([\n  "first line of a wrapped array",\n]);\n';
    expect(shapes({ content })).toEqual(["2 first line of a wrapped array"]);
  });
});

describe("scanErrorShapes — the shapes it must NOT catch", () => {
  it("does not count a forwarded message — authored in another domain", () => {
    const content = "return err([read.error.message]);\nreturn err(text.error);\nreturn err(inner.error);\n";
    expect(shapes({ content })).toEqual([]);
  });

  it("does not count a typed-union site — the compliant form the threshold points at", () => {
    const content = 'return err(GithubFetchErrors.repoNotFound({ owner: "o", repo: "r" }));\n';
    expect(shapes({ content })).toEqual([]);
  });

  it("does not count a template with no literal text of its own — a forwarded value in template syntax", () => {
    expect(shapes({ content: "return err([`${reason}`]);\nreturn err([` ${a}${b} `]);\n" })).toEqual([]);
  });

  it("does not follow a name the syntax cannot pin — a parameter, a let, a property read, a call", () => {
    const content = [
      'function f(p: string) { let l = "x"; return err([p, l, USAGES.drive, usage()]); }',
      'const { d } = { d: "destructured" };',
      "err([d]);",
    ].join("\n");
    expect(shapes({ content })).toEqual([]);
  });

  it("keeps a name inside a template hole or a plus operand a hole — only a whole-expression name is followed", () => {
    const content = 'const WHO = "the owner";\nerr([`ask ${WHO}`]);\nerr(["ask " + WHO]);\n';
    expect(shapes({ content })).toEqual(["2 ask {}", "3 ask {}"]);
  });

  it("does not read an err the file rebinds inside a function — it is not the Result constructor", () => {
    const content = 'function f() {\n  const err = (x: string[]) => x;\n  return err(["local"]);\n}\nerr(["real"]);\n';
    expect(shapes({ content })).toEqual(["5 real"]);
  });

  it("reads only an err imported from the result module — never a top-level one or an unrelated import", () => {
    const own = 'const err = (x: string[]) => x;\nerr(["top-level"]);\n';
    const unrelated = 'import { err } from "./logging.js";\nerr(["unrelated"]);\n';
    const renamed = 'import { err as fail } from "../lib/result.js";\nfail(["renamed"]);\n';
    const neverthrow = 'import { errAsync } from "neverthrow";\nerrAsync(["direct"]);\n';
    const read = [own, unrelated, renamed, neverthrow].map((content) =>
      resolveErrorShapeFacts({ facts: scanErrorShapeFacts({ content, path: "src/x/a.ts" }) }).map((one) => one.shape),
    );
    expect(read).toEqual([[], [], ["renamed"], ["direct"]]);
  });

  it("does not follow an array grown by push — the residue a problem list stays in", () => {
    const content =
      'function f() {\n  const problems: string[] = [];\n  problems.push("pushed");\n  return err(problems);\n}\n';
    expect(shapes({ content })).toEqual([]);
  });

  it("does not count a spread of a forwarded list — a property read stays unresolved", () => {
    expect(shapes({ content: "return err([...a.error, ...b.error]);\n" })).toEqual([]);
  });

  it("reads a const array as its initializer, an index write after it unseen — stated residue", () => {
    const content = 'const problems = ["bound"];\nproblems[0] = "written";\nexport const f = () => err(problems);\n';
    expect(shapes({ content })).toEqual(["3 bound"]);
  });

  it("does not count a plus-chain with no literal text — two forwarded values joined", () => {
    expect(shapes({ content: "return err([a.message + b.message]);\n" })).toEqual([]);
  });

  it("does not count an err with two arguments or none, which is not the repo's constructor", () => {
    expect(shapes({ content: 'other.err("a", "b");\nerr();\n' })).toEqual([]);
  });

  it("does not count a method named err — only the bare re-exported constructor", () => {
    expect(shapes({ content: 'Result.err(["x"]);\nlogger.err(["y"]);\n' })).toEqual([]);
  });

  it("does not count a thrown Error — the exception channel is a different class", () => {
    expect(shapes({ content: 'throw new Error("boom");\n' })).toEqual([]);
  });

  it("does not count an ok call, whatever it carries", () => {
    expect(shapes({ content: 'return ok(["not an error"]);\n' })).toEqual([]);
  });
});

describe("countsOf — distinct shapes per directory", () => {
  it("counts the same shape in two files of one directory ONCE", () => {
    const sites = [
      ...scanErrorShapes({ content: "return err([`${flag} is required`]);\n", path: "src/x/a.ts" }),
      ...scanErrorShapes({ content: "return err([`${other} is required`]);\n", path: "src/x/b.ts" }),
    ];
    expect(countsOf({ sites })).toEqual([{ count: 1, path: "src/x" }]);
  });

  it("counts the same shape in two directories separately — a domain is a directory", () => {
    const sites = [
      ...scanErrorShapes({ content: 'return err(["a"]);\n', path: "src/x/a.ts" }),
      ...scanErrorShapes({ content: 'return err(["a"]);\n', path: "src/y/a.ts" }),
    ];
    expect(countsOf({ sites })).toEqual([
      { count: 1, path: "src/x" },
      { count: 1, path: "src/y" },
    ]);
  });

  it("counts distinct shapes, not sites", () => {
    const content = 'return err(["a"]);\nreturn err(["b"]);\nreturn err(["a"]);\n';
    expect(countsOf({ sites: scanErrorShapes({ content, path: "src/x/a.ts" }) })).toEqual([
      { count: 2, path: "src/x" },
    ]);
  });

  it("is empty for no sites", () => {
    expect(countsOf({ sites: [] })).toEqual([]);
  });

  it("sorts by directory path", () => {
    const sites = [
      ...scanErrorShapes({ content: 'return err(["a"]);\n', path: "src/z/a.ts" }),
      ...scanErrorShapes({ content: 'return err(["a"]);\n', path: "src/a/a.ts" }),
    ];
    expect(countsOf({ sites }).map((one) => one.path)).toEqual(["src/a", "src/z"]);
  });
});

describe("overThreshold — the number", () => {
  it("is four: one or two messages stay plain, and the audit drew its line at five", () => {
    expect(MAX_PLAIN_SHAPES).toBe(4);
  });

  it("keeps a directory AT the threshold and refuses one past it", () => {
    const counts = [entry({ count: 4, path: "src/at" }), entry({ count: 5, path: "src/past" })];
    expect(overThreshold({ counts, max: MAX_PLAIN_SHAPES })).toEqual([entry({ count: 5, path: "src/past" })]);
  });

  it("keeps a directory with one shape", () => {
    expect(overThreshold({ counts: [entry({ count: 1, path: "src/one" })], max: MAX_PLAIN_SHAPES })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans the source trees", () => {
    expect(isScannablePath({ path: "src/cli/commands/slack/lifecycleCore.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/x.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/y.ts" })).toBe(true);
  });

  it("does not scan a test, whose err([...]) is a fixture rather than a domain's failure", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/store/ingest.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/replayFixture.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/store/ingest.test.ts" })).toBe(false);
  });

  it("does not scan its own source, which quotes the shapes it refuses in its documentation", () => {
    expect(isScannablePath({ path: "src/devLint/errorShapeThreshold.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/errorShapeThreshold.entry.ts" })).toBe(false);
  });

  it("does not scan a document or a non-TypeScript file", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
    expect(isScannablePath({ path: ".baselines/error-shape-threshold-baseline.json" })).toBe(false);
  });
});
