/**
 * The gate that keeps the `NODE_OPTIONS` heap workaround from coming back, checked against itself.
 *
 * Two blocks, the shape `codebaseAtlas.test.ts` established: the first drives the pure readers on inline
 * fixtures, including the witnesses that put a ceiling BACK at each level it can hide; the second reads
 * THIS repository off disk and asserts none stands.
 *
 * The witnesses matter more than the clean case here. A gate asserting only that today's tree is clean
 * passes just as happily when its own walk has stopped reaching the place a ceiling would sit — which is
 * exactly how a guard rots into decoration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  collectSites,
  envNamesCeiling,
  isCeilingValue,
  parsedSites,
  renderCeilingReport,
  STANDING_CEILING_SITES,
  subjectsOf,
  withoutBom,
} from "../../../devLint/ambientHeapCeiling.js";
import { scriptSites } from "../../../devLint/ambientHeapCeilingScript.js";
import {
  AMBIENT_VAR,
  type CeilingSite,
  HEAP_FLAG,
  shellSites,
  siteText,
} from "../../../devLint/ambientHeapCeilingShell.js";
import { lintDeclarationFor } from "../../../devLint/refusal/registry.js";
import { lintGateRefusal } from "../../../devLint/refusal/render.js";
import { repoRootOf } from "../../../lib/gitRepo.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CEILING = `--${HEAP_FLAG}=8192`;

describe("isCeilingValue", () => {
  it("accepts a NODE_OPTIONS value that names the heap flag", () => {
    expect(isCeilingValue({ value: CEILING })).toBe(true);
  });

  it("rejects a NODE_OPTIONS value that sets something else", () => {
    expect(isCeilingValue({ value: "--enable-source-maps" })).toBe(false);
  });

  it("rejects a non-string, which is what a malformed document yields", () => {
    expect(isCeilingValue({ value: 8192 })).toBe(false);
  });
});

describe("envNamesCeiling", () => {
  it("reads the ceiling out of an env mapping", () => {
    expect(envNamesCeiling({ env: { [AMBIENT_VAR]: CEILING } })).toBe(true);
  });

  it("ignores a mapping that sets other variables", () => {
    expect(envNamesCeiling({ env: { CI: "true" } })).toBe(false);
  });

  it("ignores a missing mapping rather than throwing", () => {
    expect(envNamesCeiling({ env: undefined })).toBe(false);
  });
});

describe("parsedSites over a workflow", () => {
  it("finds none in a workflow that sets no ceiling", () => {
    const workflow = parse("jobs:\n  lint:\n    steps:\n      - run: yarn lint\n");
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([]);
  });

  it("names a workflow-level env — the witness that the walk reaches the top", () => {
    const workflow = parse(`env:\n  ${AMBIENT_VAR}: ${CEILING}\njobs:\n  lint:\n    steps: []\n`);
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([
      { file: "ci.yml", where: "env.NODE_OPTIONS" },
    ]);
  });

  it("names a job-level env — the witness that the walk reaches a job", () => {
    const workflow = parse(`jobs:\n  lint:\n    env:\n      ${AMBIENT_VAR}: ${CEILING}\n    steps: []\n`);
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([
      { file: "ci.yml", where: "jobs.lint.env.NODE_OPTIONS" },
    ]);
  });

  it("names a step-level env by index — the witness that the walk reaches a step", () => {
    const workflow = parse(
      `jobs:\n  lint:\n    steps:\n      - run: yarn install\n      - run: yarn lint\n        env:\n          ${AMBIENT_VAR}: ${CEILING}\n`,
    );
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([
      { file: "ci.yml", where: "jobs.lint.steps[1].env.NODE_OPTIONS" },
    ]);
  });

  it("names a step whose RUN body assigns the ceiling — the r1 counterexample", () => {
    const workflow = parse(
      `jobs:\n  lint:\n    steps:\n      - run: ${AMBIENT_VAR}="--enable-source-maps ${CEILING}" yarn lint\n`,
    );
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([
      { file: "ci.yml", where: "jobs.lint.steps[0].run" },
    ]);
  });

  it("leaves a run body that only COMMENTS about the variable alone, which ci.yml's own steps do", () => {
    const workflow = parse(
      `jobs:\n  lint:\n    steps:\n      - run: |\n          # we removed ${AMBIENT_VAR}=${CEILING} here\n          yarn lint\n`,
    );
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([]);
  });
});

describe("parsedSites over a manifest", () => {
  it("names the script that assigns the ceiling", () => {
    const manifest = { scripts: { build: `${AMBIENT_VAR}=${CEILING} tsc`, lint: "tsx src/cli/index.ts dev lint" } };
    expect(at({ sites: parsedSites({ document: manifest, file: "package.json" }) })).toEqual([
      { file: "package.json", where: "scripts.build" },
    ]);
  });

  it("leaves a ceiling on a process's OWN argv alone — the exception, computed not excused", () => {
    const manifest = { scripts: { typecheck: `node --${HEAP_FLAG}=8192 node_modules/typescript/bin/tsc` } };
    expect(at({ sites: parsedSites({ document: manifest, file: "package.json" }) })).toEqual([]);
  });

  it("catches a quoted value carrying another option first — the r1 counterexample", () => {
    const manifest = { scripts: { build: `${AMBIENT_VAR}="--enable-source-maps ${CEILING}" node build.js` } };
    expect(at({ sites: parsedSites({ document: manifest, file: "package.json" }) })).toEqual([
      { file: "package.json", where: "scripts.build" },
    ]);
  });

  it("reads a script as SHELL, so a continuation splitting the flag inside it is caught", () => {
    const manifest = { scripts: { probe: `${AMBIENT_VAR}="--max-old-\\\nspace-size=128" node build.js` } };
    expect(at({ sites: parsedSites({ document: manifest, file: "site/package.json" }) })).toEqual([
      { file: "site/package.json", where: "scripts.probe" },
    ]);
  });

  it("drops a script's own trailing comment, exactly as a shell file's is dropped", () => {
    const manifest = { scripts: { build: `node build.js # was ${AMBIENT_VAR}=${CEILING}` } };
    expect(at({ sites: parsedSites({ document: manifest, file: "package.json" }) })).toEqual([]);
  });
});

describe("subjectsOf", () => {
  it("buckets a workflow, a manifest and a script by name, and reads EVERYTHING else as shell", () => {
    const files = [
      ".github/workflows/ci.yml",
      ".github/workflows/pr-body-gate.yml",
      "package.json",
      "site/package.json",
      "hooks/hook.sh",
      "scripts/build.prod",
      "src/cli/index.ts",
      "node_modules/x/package.json",
    ];
    expect(subjectsOf({ files })).toEqual({
      manifests: ["package.json", "site/package.json"],
      scripts: ["src/cli/index.ts"],
      shells: ["hooks/hook.sh", "scripts/build.prod", "node_modules/x/package.json"],
      workflows: [".github/workflows/ci.yml", ".github/workflows/pr-body-gate.yml"],
    });
  });

  it("reads the NESTED manifest the docs site builds through — the r1 counterexample", () => {
    expect(subjectsOf({ files: ["site/package.json"] }).manifests).toEqual(["site/package.json"]);
  });

  it("never reads a dependency's own manifest AS a manifest", () => {
    expect(subjectsOf({ files: ["node_modules/x/package.json"] }).manifests).toEqual([]);
  });

  it("reads the EXTENSIONLESS launcher, which the .sh filter never saw", () => {
    expect(subjectsOf({ files: [STANDING_CEILING_SITES[0]!.file] }).shells).toEqual([STANDING_CEILING_SITES[0]!.file]);
  });

  it("reads a DOTTED shell name, which the no-dot-in-the-basename filter never saw", () => {
    expect(subjectsOf({ files: ["scripts/build.prod"] }).shells).toEqual(["scripts/build.prod"]);
  });

  it("reads a dotfile with no shebang and no extension — the .envrc the shebang filter never saw", () => {
    expect(subjectsOf({ files: [".envrc"] }).shells).toEqual([".envrc"]);
  });

  it("reads a file kind nobody has thought of, because the shell bucket is the DEFAULT", () => {
    expect(subjectsOf({ files: ["Makefile", "Dockerfile", ".zshenv", "LICENSE"] }).shells).toEqual([
      "Makefile",
      "Dockerfile",
      ".zshenv",
      "LICENSE",
    ]);
  });

  it("puts a path in exactly ONE bucket, so a manifest is never also read as shell", () => {
    expect(subjectsOf({ files: ["package.json"] }).shells).toEqual([]);
  });

  it("hands every extension TypeScript parses to the script bucket rather than to the shell reader", () => {
    const files = ["a.ts", "b.tsx", "c.js", "d.jsx", "e.cjs", "f.mjs", "g.cts", "h.mts"];
    expect(subjectsOf({ files }).scripts).toEqual(files);
  });
});

describe("this repository", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const read = ({ path }: { path: string }): unknown => parse(readFileSync(join(root, path), "utf8"));

  it("sets no ambient heap ceiling in the CI workflow, as shipped", () => {
    const file = ".github/workflows/ci.yml";
    expect(parsedSites({ document: read({ path: file }), file })).toEqual([]);
  });

  it("sets no ambient heap ceiling in the pull-request body gate, as shipped", () => {
    const file = ".github/workflows/pr-body-gate.yml";
    expect(parsedSites({ document: read({ path: file }), file })).toEqual([]);
  });

  it("STILL finds the standing ceiling in the launcher, so the debt entry is not a lie about the tree", () => {
    const content = readFileSync(join(root, STANDING_CEILING_SITES[0]!.file), "utf8");
    expect(subjectsOf({ files: [STANDING_CEILING_SITES[0]!.file] }).shells).toEqual([STANDING_CEILING_SITES[0]!.file]);
    expect(shellSites({ content, file: STANDING_CEILING_SITES[0]!.file }).length).toBe(1);
  });
});

describe("collectSites", () => {
  const empty = { manifests: [], scripts: [], shells: [], workflows: [] };

  it("walks all four kinds and returns every site in bucket order", () => {
    const files: Record<string, string> = {
      ".github/workflows/ci.yml": `jobs:\n  lint:\n    env:\n      ${AMBIENT_VAR}: ${CEILING}\n`,
      "package.json": `{"scripts":{"build":"${AMBIENT_VAR}=${CEILING} node build.js"}}`,
      "scripts/x.sh": `${AMBIENT_VAR}=${CEILING} node build.js\n`,
      "src/spawn.ts": `export const env = { ${AMBIENT_VAR}: "${CEILING}" };\n`,
    };
    const result = collectSites({
      read: ({ path }) => files[path]!,
      subjects: {
        manifests: ["package.json"],
        scripts: ["src/spawn.ts"],
        shells: ["scripts/x.sh"],
        workflows: [".github/workflows/ci.yml"],
      },
    });
    expect(result.isOk()).toBe(true);
    expect(at({ sites: unwrap(result) })).toEqual([
      { file: ".github/workflows/ci.yml", where: "jobs.lint.env.NODE_OPTIONS" },
      { file: "package.json", where: "scripts.build" },
      { file: "src/spawn.ts", where: "line 1" },
      { file: "scripts/x.sh", where: "line 1" },
    ]);
  });

  it("answers no sites for a tree that declares none", () => {
    const result = collectSites({ read: () => "{}", subjects: { ...empty, manifests: ["package.json"] } });
    expect(at({ sites: unwrap(result) })).toEqual([]);
  });

  it("stops and names the manifest it could not parse, rather than reporting a clean tree", () => {
    const result = collectSites({ read: () => "{not json", subjects: { ...empty, manifests: ["site/package.json"] } });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("cannot read site/package.json");
  });
});

describe("a byte-order mark is decoding, not content", () => {
  const BOM = "\uFEFF";

  it("removes a leading BOM and leaves everything else alone", () => {
    expect(withoutBom({ text: `${BOM}${AMBIENT_VAR}=${CEILING}` })).toBe(`${AMBIENT_VAR}=${CEILING}`);
    expect(withoutBom({ text: `${AMBIENT_VAR}=${CEILING}` })).toBe(`${AMBIENT_VAR}=${CEILING}`);
  });

  it("leaves a BOM that is not the first character where it is", () => {
    expect(withoutBom({ text: `a${BOM}b` })).toBe(`a${BOM}b`);
  });

  it("answers the empty string unchanged", () => {
    expect(withoutBom({ text: "" })).toBe("");
  });

  it("is what the shell reader needed — the r1 counterexample, both halves", () => {
    const assignment = `${AMBIENT_VAR}=${CEILING}\n`;
    expect(shellSites({ content: `${BOM}${assignment}`, file: "probe.env" })).toEqual([]);
    expect(
      at({ sites: shellSites({ content: withoutBom({ text: `${BOM}${assignment}` }), file: "probe.env" }) }),
    ).toEqual([{ file: "probe.env", where: "line 1" }]);
  });

  it("reaches every bucket through collectSites, so no reader carries its own strip", () => {
    const files: Record<string, string> = {
      ".github/workflows/ci.yml": `${BOM}jobs:\n  lint:\n    env:\n      ${AMBIENT_VAR}: ${CEILING}\n`,
      "package.json": `${BOM}{"scripts":{"build":"${AMBIENT_VAR}=${CEILING} node build.js"}}`,
      "probe.env": `${BOM}${AMBIENT_VAR}=${CEILING}\n`,
      "src/spawn.ts": `${BOM}export const env = { ${AMBIENT_VAR}: "${CEILING}" };\n`,
    };
    const result = collectSites({
      read: ({ path }) => files[path]!,
      subjects: {
        manifests: ["package.json"],
        scripts: ["src/spawn.ts"],
        shells: ["probe.env"],
        workflows: [".github/workflows/ci.yml"],
      },
    });
    expect(result.isOk()).toBe(true);
    expect(at({ sites: unwrap(result) })).toEqual([
      { file: ".github/workflows/ci.yml", where: "jobs.lint.env.NODE_OPTIONS" },
      { file: "package.json", where: "scripts.build" },
      { file: "src/spawn.ts", where: "line 1" },
      { file: "probe.env", where: "line 1" },
    ]);
  });
});

describe("every site carries the assignment that identifies it", () => {
  it("collapses every run of whitespace to one space and trims both ends", () => {
    expect(siteText({ raw: `  export   ${AMBIENT_VAR}=${CEILING}\n\t` })).toBe(`export ${AMBIENT_VAR}=${CEILING}`);
  });

  it("puts a multi-line assignment on one line, so indentation cannot mint a new identity", () => {
    expect(siteText({ raw: `export ${AMBIENT_VAR}=\n    "${CEILING}"` })).toBe(`export ${AMBIENT_VAR}= "${CEILING}"`);
  });

  it("carries the shell line that assigned it", () => {
    const content = `  export ${AMBIENT_VAR}=${CEILING}\n`;
    expect(shellSites({ content, file: "scripts/x.sh" })[0]!.text).toBe(`export ${AMBIENT_VAR}=${CEILING}`);
  });

  it("carries the script node that assigned it", () => {
    const content = `process.env.${AMBIENT_VAR} = "${CEILING}";\n`;
    expect(scriptSites({ content, file: "src/run.ts" })[0]!.text).toBe(`process.env.${AMBIENT_VAR} = "${CEILING}"`);
  });

  it("carries a parsed document's env value in shell spelling", () => {
    const document = { jobs: { lint: { env: { [AMBIENT_VAR]: CEILING } } } };
    expect(parsedSites({ document, file: "ci.yml" })[0]!.text).toBe(`${AMBIENT_VAR}=${CEILING}`);
  });

  it("carries a manifest script's own line, not the whole document", () => {
    const document = { scripts: { build: `${AMBIENT_VAR}=${CEILING} node build.js` } };
    expect(parsedSites({ document, file: "package.json" })[0]!.text).toBe(`${AMBIENT_VAR}=${CEILING} node build.js`);
  });
});

describe("renderCeilingReport", () => {
  const standingRow = STANDING_CEILING_SITES[0]!;
  const standingSite = { file: standingRow.file, text: standingRow.text, where: "line 87" };
  const freshInStandingFile = {
    file: standingRow.file,
    text: `export ${AMBIENT_VAR}=${CEILING}`,
    where: "line 92",
  };

  it("reports the scanned count and the standing debt on stdout, and exits 0", () => {
    const report = renderCeilingReport({ scanned: 36, sites: [standingSite] });
    expect(report.code).toBe(0);
    expect(report.refuse).toBe(false);
    expect(report.found).toBe("");
    expect(report.stdout).toBe(
      `ambient-heap-ceiling: clean (no new ${AMBIENT_VAR} heap ceiling in 36 scanned file(s))\n` +
        `ambient-heap-ceiling: standing debt, 1 site(s) in ${standingRow.file} — nothing may join them\n`,
    );
  });

  it("names every FRESH site it was given, one line each with its assignment, and exits 1 refusing", () => {
    const report = renderCeilingReport({
      scanned: 36,
      sites: [
        standingSite,
        { file: "package.json", text: `${AMBIENT_VAR}=${CEILING} node build.js`, where: "scripts.build" },
        { file: "site/package.json", text: `${AMBIENT_VAR}=${CEILING} node probe.js`, where: "scripts.build" },
      ],
    });
    expect(report.code).toBe(1);
    expect(report.refuse).toBe(true);
    expect(report.stdout).toBe("");
    expect(report.found).toBe(
      `  package.json: scripts.build sets ${AMBIENT_VAR} ${HEAP_FLAG} — ${AMBIENT_VAR}=${CEILING} node build.js\n` +
        `  site/package.json: scripts.build sets ${AMBIENT_VAR} ${HEAP_FLAG} — ${AMBIENT_VAR}=${CEILING} node probe.js\n`,
    );
  });

  it("refuses a SECOND ceiling in the standing file — the r2 counterexample", () => {
    const report = renderCeilingReport({ scanned: 36, sites: [standingSite, freshInStandingFile] });
    expect(report.code).toBe(1);
    expect(report.refuse).toBe(true);
    expect(report.stdout).toBe("");
    expect(report.found).toBe(
      `  ${standingRow.file}: line 92 sets ${AMBIENT_VAR} ${HEAP_FLAG} — export ${AMBIENT_VAR}=${CEILING}\n`,
    );
  });

  it("refuses a DUPLICATE of the declared assignment, because one row is one site", () => {
    const duplicate = { file: standingRow.file, text: standingRow.text, where: "line 92" };
    const report = renderCeilingReport({ scanned: 36, sites: [standingSite, duplicate] });
    expect(report.code).toBe(1);
    expect(report.refuse).toBe(true);
    expect(report.found).toBe(
      `  ${standingRow.file}: line 92 sets ${AMBIENT_VAR} ${HEAP_FLAG} — ${standingRow.text}\n`,
    );
  });

  it("refuses the standing file's own site once its assignment CHANGES", () => {
    const changed = { file: standingRow.file, text: `export ${AMBIENT_VAR}=${CEILING}`, where: "line 87" };
    const report = renderCeilingReport({ scanned: 36, sites: [changed] });
    expect(report.code).toBe(1);
    expect(report.refuse).toBe(true);
    expect(report.found).toContain(`${standingRow.file}: line 87 sets`);
  });

  it("fails just as loudly when the standing entry STOPS firing, and calls that a fact not a refusal", () => {
    const report = renderCeilingReport({ scanned: 36, sites: [] });
    expect(report.code).toBe(1);
    expect(report.refuse).toBe(false);
    expect(report.stdout).toBe("");
    expect(report.found).toBe(
      `  the standing debt entry ${standingRow.file} no longer sets ${AMBIENT_VAR} ${HEAP_FLAG} as ` +
        `\`${standingRow.text}\` — remove it from STANDING_CEILING_SITES, the list is now a lie about the tree\n`,
    );
  });
});

describe("the standing debt entry names a SITE, and the real launcher still matches it", () => {
  it("declares at least one row, each with a file and a non-empty assignment", () => {
    expect(STANDING_CEILING_SITES.length).toBeGreaterThan(0);
    expect(STANDING_CEILING_SITES.filter((row) => row.file.length === 0 || row.text.length === 0)).toEqual([]);
  });

  it("matches the launcher's real assignment, read off disk", () => {
    const root = repoRootOf({ importMetaUrl: import.meta.url });
    const row = STANDING_CEILING_SITES[0]!;
    const content = readFileSync(join(root, row.file), "utf8");
    const found = shellSites({ content, file: row.file });
    expect(found.length).toBe(1);
    expect(found[0]!.text).toBe(row.text);
  });
});

describe("the shell bucket has no filter left to evade", () => {
  it("reads a sourced .envrc, which has neither a shebang nor a .sh extension — the r1 counterexample", () => {
    const content = `export ${AMBIENT_VAR}=${CEILING}\n`;
    expect(at({ sites: shellSites({ content, file: ".envrc" }) })).toEqual([{ file: ".envrc", where: "line 1" }]);
  });

  it("reads a Makefile recipe line, a file kind no filter this gate ever had enumerated", () => {
    const content = `build:\n\t${AMBIENT_VAR}=${CEILING} node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "Makefile" }) })).toEqual([{ file: "Makefile", where: "line 2" }]);
  });

  it("reports nothing for a file that assigns nothing, so reading everything costs a walk and no noise", () => {
    expect(at({ sites: shellSites({ content: "MIT License\n\nCopyright\n", file: "LICENSE" }) })).toEqual([]);
  });
});

describe("the refusal this gate ends in", () => {
  it("tells the agent to explain the memory problem to the OWNER, which is what the rule asks for", () => {
    const declaration = lintDeclarationFor({ id: "ambient-heap-ceiling" });
    expect(lintGateRefusal({ declaration, detail: "1 ambient heap ceiling(s)" })).toContain("memory problem");
  });
});

describe("parsedSites and a field nobody enumerated", () => {
  it("names defaults.run.shell, which REPLACES the command every run body executes — the r3 counterexample", () => {
    const workflow = parse(
      `defaults:\n  run:\n    shell: env ${AMBIENT_VAR}=--max-old-space-size=128 bash {0}\njobs:\n  probe:\n    steps:\n      - run: node -p 1\n`,
    );
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([
      { file: "ci.yml", where: "defaults.run.shell" },
    ]);
  });

  it("names a JOB's own defaults.run.shell too, which the same walk reaches without being told about it", () => {
    const workflow = parse(
      `jobs:\n  probe:\n    defaults:\n      run:\n        shell: env ${AMBIENT_VAR}=${CEILING} bash {0}\n    steps: []\n`,
    );
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([
      { file: "ci.yml", where: "jobs.probe.defaults.run.shell" },
    ]);
  });

  it("names a STEP's own shell:, the third place the same field can sit", () => {
    const workflow = parse(
      `jobs:\n  probe:\n    steps:\n      - shell: env ${AMBIENT_VAR}=${CEILING} bash {0}\n        run: node -p 1\n`,
    );
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([
      { file: "ci.yml", where: "jobs.probe.steps[0].shell" },
    ]);
  });

  it("reaches a manifest field that is not scripts, because the walk asks no key for permission", () => {
    const manifest = { config: { probe: `${AMBIENT_VAR}=${CEILING} node build.js` }, scripts: { lint: "tsx x.ts" } };
    expect(at({ sites: parsedSites({ document: manifest, file: "package.json" }) })).toEqual([
      { file: "package.json", where: "config.probe" },
    ]);
  });

  it("finds nothing in a document whose strings assign nothing, so the wider walk stays quiet", () => {
    const workflow = parse(`name: CI\non: push\njobs:\n  lint:\n    steps:\n      - run: yarn lint\n`);
    expect(at({ sites: parsedSites({ document: workflow, file: "ci.yml" }) })).toEqual([]);
  });
});

/**
 * One site reduced to WHERE it is, for the cases whose subject is the location rather than the text.
 *
 * Every site also carries the assignment's own text, which identifies the standing debt entry apart from
 * a new ceiling in the same file; that field has its own exact cases rather than being restated on all of
 * these, where it would only repeat the fixture.
 */
function at({ sites }: { sites: readonly CeilingSite[] }): readonly { file: string; where: string }[] {
  return sites.map(({ file, where }) => ({ file, where }));
}
