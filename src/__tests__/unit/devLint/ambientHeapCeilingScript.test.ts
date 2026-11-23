/**
 * The TypeScript reader `ambient-heap-ceiling` hands a `.ts` to, rather than reading its text as shell.
 *
 * Two duties, and both are load-bearing. It finds a ceiling a script really SETS — the shape a spawn uses —
 * which no version of this gate before it could see at all, because a `.ts` has neither a shebang nor a
 * `.sh` extension. And it stays silent on the seven tracked files that only SPELL the assignment, inside a
 * refusal message, a test asserting on that message, or a measured comment carrying its own repro command:
 * those seven are what deleting the shell bucket's filter reports when nothing parses a script.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isScript, scriptSites } from "../../../devLint/ambientHeapCeilingScript.js";
import { AMBIENT_VAR, type CeilingSite, HEAP_FLAG, shellSites } from "../../../devLint/ambientHeapCeilingShell.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

const CEILING = `--${HEAP_FLAG}=8192`;

describe("isScript", () => {
  it("claims every extension the TypeScript parser reads", () => {
    const paths = ["a.ts", "b.tsx", "c.js", "d.jsx", "e.cjs", "f.mjs", "g.cts", "h.mts"];
    expect(paths.filter((path) => !isScript({ path }))).toEqual([]);
    expect(paths.length).toBeGreaterThan(0);
  });

  it("leaves everything else to the shell reader, so no file falls between the two", () => {
    const paths = [".envrc", "Makefile", "bin/slopweaver", "scripts/build.prod", "docs/toolchain.md", "a.json"];
    expect(paths.filter((path) => isScript({ path }))).toEqual([]);
  });
});

describe("scriptSites finds a ceiling a script SETS", () => {
  it("reads a spawn's env object literal", () => {
    const content = `const env = { ...process.env, ${AMBIENT_VAR}: "${CEILING}" };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([
      { file: "src/spawn.ts", where: "line 1" },
    ]);
  });

  it("reads a quoted key, which is the same write spelled differently", () => {
    const content = `const env = { "${AMBIENT_VAR}": \`${CEILING}\` };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([
      { file: "src/spawn.ts", where: "line 1" },
    ]);
  });

  it("reads an assignment in place through a property access", () => {
    const content = `process.env.${AMBIENT_VAR} = "${CEILING}";\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 1" },
    ]);
  });

  it("reads an assignment through an element access, which the repo's noUncheckedIndexedAccess style uses", () => {
    const content = `process.env["${AMBIENT_VAR}"] = "${CEILING}";\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 1" },
    ]);
  });

  it("names the line it sits on, so a reader opens the file at the write", () => {
    const content = `const a = 1;\nconst b = 2;\nprocess.env.${AMBIENT_VAR} = "${CEILING}";\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 3" },
    ]);
  });

  it("finds every write, not just the first", () => {
    const content = `process.env.${AMBIENT_VAR} = "${CEILING}";\nconst env = { ${AMBIENT_VAR}: "${CEILING}" };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 1" },
      { file: "src/run.ts", where: "line 2" },
    ]);
  });
});

describe("scriptSites stays silent where a script only SPELLS the assignment", () => {
  it("says nothing about a refusal message that names the workaround it is refusing", () => {
    const content = `const lines = ["to finish this read today: ${AMBIENT_VAR}=${CEILING} — still a mask"];\n`;
    expect(at({ sites: scriptSites({ content, file: "src/corpus/corpusStore.errors.ts" }) })).toEqual([]);
  });

  it("says nothing about a measured comment carrying its own repro command", () => {
    const content = `/** MEASURED: one \`${AMBIENT_VAR}=${CEILING} yarn lint\`, 467.2s serial. */\nexport const N = 4;\n`;
    expect(at({ sites: scriptSites({ content, file: "src/devLint/gateRunner.ts" }) })).toEqual([]);
  });

  it("says nothing about a test asserting on that message", () => {
    const content = `expect(error.message).toContain("${AMBIENT_VAR}=${CEILING}");\n`;
    expect(at({ sites: scriptSites({ content, file: "src/__tests__/unit/corpus/x.test.ts" }) })).toEqual([]);
  });

  it("says nothing about a value written to a DIFFERENT name, which is not an ambient ceiling", () => {
    const content = `const env = { NODE_OPTIONS_DOC: "${CEILING}" };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([]);
  });

  it("says nothing about NODE_OPTIONS carrying a flag that is not a heap ceiling", () => {
    const content = `const env = { ${AMBIENT_VAR}: "--enable-source-maps" };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([]);
  });
});

describe("scriptSites over input the parser cannot fully read", () => {
  it("recovers from a syntax error rather than refusing, because a typecheck reports that instead", () => {
    const content = `const env = { ${AMBIENT_VAR}: "${CEILING}" };\nfunction ( {{{\n`;
    expect(at({ sites: scriptSites({ content, file: "src/broken.ts" }) })).toEqual([
      { file: "src/broken.ts", where: "line 1" },
    ]);
  });

  it("reads an empty file as no sites", () => {
    expect(at({ sites: scriptSites({ content: "", file: "src/empty.ts" }) })).toEqual([]);
  });

  it("reads a .tsx generic element without mistaking it for a syntax error", () => {
    const content = `const f = <T,>(x: T): T => x;\nconst env = { ${AMBIENT_VAR}: "${CEILING}" };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/ui.tsx" }) })).toEqual([
      { file: "src/ui.tsx", where: "line 2" },
    ]);
  });
});

describe("this repository", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const read = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");

  // The falsifiable half: each of these files DOES carry the text, so the silence below is the parser's
  // doing and not an empty input. Read as shell — which is what the gate does to every file it has no
  // parser for — every one of them reports a site.
  const SPELLED_NOT_SET = ["src/corpus/corpusStore.errors.ts", "src/devLint/ambientHeapCeiling.ts"] as const;

  it("reads the text in each of these files, so the silence below is falsifiable", () => {
    const quiet = SPELLED_NOT_SET.filter((file) => shellSites({ content: read({ path: file }), file }).length === 0);
    expect(SPELLED_NOT_SET.length).toBeGreaterThan(0);
    expect(quiet).toEqual([]);
  });

  it("sets no ambient heap ceiling in any of them, because a message and a comment are not writes", () => {
    const noisy = SPELLED_NOT_SET.filter((file) => scriptSites({ content: read({ path: file }), file }).length > 0);
    expect(noisy).toEqual([]);
  });
});

describe("scriptSites resolves a name ONE hop, which is how a script really writes this", () => {
  it("reads a value held in a constant beside the write", () => {
    const content = `const FLAG = "${CEILING}";\nprocess.env.${AMBIENT_VAR} = FLAG;\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 2" },
    ]);
  });

  it("reads a COMPUTED key held in a constant, which no literal name test would see", () => {
    const content = `const AMBIENT = "${AMBIENT_VAR}";\nconst env = { [AMBIENT]: "${CEILING}" };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([
      { file: "src/spawn.ts", where: "line 2" },
    ]);
  });

  it("reads an element-access key held in a constant", () => {
    const content = `const AMBIENT = "${AMBIENT_VAR}";\nprocess.env[AMBIENT] = "${CEILING}";\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 2" },
    ]);
  });

  it("does NOT resolve a property NAME through a constant, so a local named NODE_OPTIONS changes nothing", () => {
    const content = `const ${AMBIENT_VAR} = "not a ceiling";\nconst env = { ${AMBIENT_VAR}: "${CEILING}" };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([
      { file: "src/spawn.ts", where: "line 2" },
    ]);
  });

  it("stops at ONE hop, which is the declared blind spot rather than an oversight", () => {
    const content = `const A = "${CEILING}";\nconst B = A;\nprocess.env.${AMBIENT_VAR} = B;\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([]);
  });
});

describe("a DECLARATION is a write, and so is a shorthand property — the r2 counterexample", () => {
  it("reads a const declaration naming the variable, which a child inherits through a spread", () => {
    const content = `const ${AMBIENT_VAR} = "${CEILING}";\nconst env = { ...process.env, ${AMBIENT_VAR} };\n`;
    expect(at({ sites: scriptSites({ content, file: "ceiling.cjs" }) })).toEqual([
      { file: "ceiling.cjs", where: "line 1" },
      { file: "ceiling.cjs", where: "line 2" },
    ]);
  });

  it("reads a shorthand property whose constant is declared elsewhere in the file", () => {
    const content = `const env = { ...process.env, ${AMBIENT_VAR} };\nconst ${AMBIENT_VAR} = "${CEILING}";\n`;
    expect(at({ sites: scriptSites({ content, file: "ceiling.cjs" }) })).toEqual([
      { file: "ceiling.cjs", where: "line 1" },
      { file: "ceiling.cjs", where: "line 2" },
    ]);
  });

  it("leaves a shorthand whose constant is not a ceiling alone", () => {
    const content = `const ${AMBIENT_VAR} = "--enable-source-maps";\nconst env = { ${AMBIENT_VAR} };\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([]);
  });

  it("leaves a declaration under any OTHER name alone, however its value reads", () => {
    const content = `const CEILING_DOC = "${CEILING}";\n`;
    expect(at({ sites: scriptSites({ content, file: "src/spawn.ts" }) })).toEqual([]);
  });
});

describe("a CALL is a write too, and no function is named — the r3 counterexample", () => {
  it("reads Object.defineProperty, whose halves sit in two different arguments", () => {
    const content = `Object.defineProperty(process.env, "${AMBIENT_VAR}", { value: "${CEILING}" });\n`;
    expect(at({ sites: scriptSites({ content, file: "scripts/probe.cjs" }) })).toEqual([
      { file: "scripts/probe.cjs", where: "line 1" },
    ]);
  });

  it("reads Reflect.set, which no list of method names contained either", () => {
    const content = `Reflect.set(process.env, "${AMBIENT_VAR}", "${CEILING}");\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 1" },
    ]);
  });

  it("reads a call whose halves are held one hop away in constants", () => {
    const content = `const K = "${AMBIENT_VAR}";\nconst V = "${CEILING}";\nsetEnv(K, V);\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([
      { file: "src/run.ts", where: "line 3" },
    ]);
  });

  it("stays silent on a call carrying the variable's name but no ceiling", () => {
    const content = `Object.defineProperty(process.env, "${AMBIENT_VAR}", { value: "--enable-source-maps" });\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([]);
  });

  it("stays silent on a call carrying a ceiling but not the variable's name", () => {
    const content = `spawn("node", ["--${HEAP_FLAG}=8192", "build.js"]);\n`;
    expect(at({ sites: scriptSites({ content, file: "src/run.ts" }) })).toEqual([]);
  });

  it("stays silent when the name is only a FRAGMENT of an argument, so prose in a call is not a write", () => {
    const content = `expect(assignsCeiling({ text: "export ${AMBIENT_VAR}=${CEILING}" })).toBe(true);\n`;
    expect(at({ sites: scriptSites({ content, file: "src/__tests__/unit/x.test.ts" }) })).toEqual([]);
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
