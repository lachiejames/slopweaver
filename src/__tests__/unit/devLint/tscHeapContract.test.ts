import { describe, expect, it } from "vitest";

import {
  assessTscHeapContract,
  HEAP_FLAG,
  heapArgument,
  mentionsCompiler,
  namesCompiler,
  readSimpleCommand,
  refusalClause,
} from "../../../devLint/tscHeapContract.js";
import { ManifestScriptsErrors, readScripts } from "../../../devLint/tscHeapContractRun.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The spelling the contract accepts, and the one `package.json` actually carries. */
const COMPLIANT = "node --max-old-space-size=8192 node_modules/typescript/bin/tsc -p tsconfig.json";

/** The `typecheck` script as it stands, which has carried this shape since before the gate existed. */
const TYPECHECK =
  "node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p config/typescript/tsconfig.lint.json";

describe("namesCompiler", () => {
  it("answers on the path BASENAME, so a wrapper cannot hide behind a directory", () => {
    expect(namesCompiler({ token: "tsc" })).toBe(true);
    expect(namesCompiler({ token: "node_modules/.bin/tsc" })).toBe(true);
    expect(namesCompiler({ token: "./node_modules/typescript/bin/tsc" })).toBe(true);
    expect(namesCompiler({ token: "node_modules/typescript/lib/tsc.js" })).toBe(true);
  });

  it("does not answer on a token that merely contains the letters", () => {
    expect(namesCompiler({ token: "tsconfig.json" })).toBe(false);
    expect(namesCompiler({ token: "tsc-watch" })).toBe(false);
    expect(namesCompiler({ token: "vitest" })).toBe(false);
  });
});

describe("mentionsCompiler", () => {
  it("selects a subject off the RAW text, quotes stripped", () => {
    expect(mentionsCompiler({ command: COMPLIANT })).toBe(true);
    expect(mentionsCompiler({ command: 'node "node_modules/.bin/tsc" -p tsconfig.json' })).toBe(true);
  });

  it("leaves a script that never names the compiler out of the selection entirely", () => {
    expect(mentionsCompiler({ command: "vitest run --config config/vitest/unit.ts" })).toBe(false);
    expect(mentionsCompiler({ command: "prettier --write ." })).toBe(false);
  });
});

describe("readSimpleCommand", () => {
  it("splits one simple command into quote-aware words", () => {
    expect(readSimpleCommand({ command: 'node --flag "two words" tsc' })).toEqual({
      kind: "tokens",
      tokens: ["node", "--flag", "two words", "tsc"],
    });
  });

  it("refuses a shell operator by name, because a masked failure is the thing being prevented", () => {
    expect(readSimpleCommand({ command: "tsc -p tsconfig.json || true" })).toEqual({
      kind: "unreadable",
      why: "it is not one simple command — `||` makes its failure maskable",
    });
    expect(readSimpleCommand({ command: "tsc | tee out.log" }).kind).toBe("unreadable");
    expect(readSimpleCommand({ command: "tsc; echo done" }).kind).toBe("unreadable");
    expect(readSimpleCommand({ command: "tsc > out.log" }).kind).toBe("unreadable");
    expect(readSimpleCommand({ command: "$(which tsc) -p tsconfig.json" }).kind).toBe("unreadable");
  });

  it("refuses quoting that does not close, rather than guessing where the word ended", () => {
    expect(readSimpleCommand({ command: 'node "tsc -p' })).toEqual({
      kind: "unreadable",
      why: "its quoting does not close, so no reader can say what it runs",
    });
  });
});

describe("heapArgument", () => {
  it("reads the joined spelling and reports the token it ends on", () => {
    expect(heapArgument({ tokens: ["node", `${HEAP_FLAG}=8192`, "tsc"] })).toEqual({ kind: "at", lastIndex: 1 });
  });

  it("reads the separated spelling, which is what Node itself also accepts", () => {
    expect(heapArgument({ tokens: ["node", HEAP_FLAG, "8192", "tsc"] })).toEqual({ kind: "at", lastIndex: 2 });
  });

  it("names the absence rather than reporting an index nobody can use", () => {
    expect(heapArgument({ tokens: ["node", "tsc"] })).toEqual({
      kind: "wrong",
      why: `it names no \`${HEAP_FLAG}\`, so it runs at V8's own default ceiling`,
    });
  });

  it("refuses two of them, because only one decides the ceiling", () => {
    expect(heapArgument({ tokens: ["node", `${HEAP_FLAG}=4096`, `${HEAP_FLAG}=8192`, "tsc"] })).toEqual({
      kind: "wrong",
      why: `it names \`${HEAP_FLAG}\` 2 times, counting the \`_\` spelling V8 reads as the same flag, and only the LAST of them decides the ceiling`,
    });
  });

  it("refuses a value V8 would not apply — zero, empty, and a non-integer alike", () => {
    const why = `its \`${HEAP_FLAG}\` value is not a positive whole number of MiB`;
    expect(heapArgument({ tokens: ["node", `${HEAP_FLAG}=0`, "tsc"] })).toEqual({ kind: "wrong", why });
    expect(heapArgument({ tokens: ["node", `${HEAP_FLAG}=`, "tsc"] })).toEqual({ kind: "wrong", why });
    expect(heapArgument({ tokens: ["node", `${HEAP_FLAG}=8g`, "tsc"] })).toEqual({ kind: "wrong", why });
    expect(heapArgument({ tokens: ["node", HEAP_FLAG, "tsc"] })).toEqual({ kind: "wrong", why });
  });
});

describe("refusalClause", () => {
  it("passes the two spellings this repository actually ships", () => {
    expect(refusalClause({ command: COMPLIANT })).toBe(undefined);
    expect(refusalClause({ command: TYPECHECK })).toBe(undefined);
  });

  it("refuses the bare compiler, which is the shape `yarn build` measurably died at", () => {
    expect(refusalClause({ command: "tsc -p tsconfig.json" })).toBe(
      "it does not run the compiler as a direct `node` invocation, so no argument of its own can carry a ceiling",
    );
  });

  it("refuses the implicit-project form the same way", () => {
    expect(refusalClause({ command: "tsc" })).toContain("direct `node` invocation");
  });

  it("refuses a direct node invocation that names no ceiling", () => {
    expect(refusalClause({ command: "node node_modules/typescript/bin/tsc -p tsconfig.json" })).toBe(
      `it names no \`${HEAP_FLAG}\`, so it runs at V8's own default ceiling`,
    );
  });

  it("refuses a ceiling AFTER the entrypoint, where Node hands it to the compiler instead of applying it", () => {
    expect(refusalClause({ command: `node node_modules/typescript/bin/tsc ${HEAP_FLAG}=8192 -p tsconfig.json` })).toBe(
      `its \`${HEAP_FLAG}\` sits AFTER the compiler entrypoint, where Node passes it through as a compiler argument instead of applying it`,
    );
  });

  it("refuses NODE_OPTIONS even when the direct flag is there too — the replacement is the flag, not an exception", () => {
    const blanket = "it reaches its ceiling through `NODE_OPTIONS`";
    expect(refusalClause({ command: `NODE_OPTIONS=${HEAP_FLAG}=8192 tsc -p tsconfig.json` })).toContain(blanket);
    expect(refusalClause({ command: `NODE_OPTIONS=--trace-gc ${COMPLIANT}` })).toContain(blanket);
  });

  it("refuses a failure-masking suffix on an otherwise compliant command", () => {
    expect(refusalClause({ command: `${COMPLIANT} || true` })).toBe(
      "it is not one simple command — `||` makes its failure maskable",
    );
  });

  it("covers a single-file compiler call too, which is the criterion being deliberately broad", () => {
    expect(refusalClause({ command: "tsc src/one.ts" })).toContain("direct `node` invocation");
  });
});

describe("assessTscHeapContract", () => {
  it("names its subjects and refuses only the ones that fail, whatever the key is called", () => {
    const assessment = assessTscHeapContract({
      scripts: {
        build: COMPLIANT,
        compile: "tsc -p tsconfig.json",
        format: "prettier --write .",
        typecheck: TYPECHECK,
      },
    });
    expect(assessment.compilerScripts).toEqual(["build", "compile", "typecheck"]);
    expect(assessment.findings).toEqual([
      {
        line: "`compile` runs the TypeScript compiler and it does not run the compiler as a direct `node` invocation, so no argument of its own can carry a ceiling: tsc -p tsconfig.json",
        script: "compile",
      },
    ]);
  });

  it("selects nothing at all from a scripts map that never names the compiler", () => {
    const assessment = assessTscHeapContract({ scripts: { test: "vitest run", format: "prettier --write ." } });
    expect(assessment.compilerScripts).toEqual([]);
    expect(assessment.findings).toEqual([]);
  });
});

describe("readScripts", () => {
  it("reads the scripts map out of a manifest", () => {
    expect(unwrap(readScripts({ path: "package.json", text: '{"scripts":{"build":"tsc"}}' }))).toEqual({
      build: "tsc",
    });
  });

  it("names a non-string script instead of dropping it, which is how a gate reports clean over nothing", () => {
    const text = '{"scripts":{"build":{"run":"tsc"}}}';
    expect(unwrapErr(readScripts({ path: "desktop/package.json", text }))).toEqual(
      ManifestScriptsErrors.nonStringScript({ path: "desktop/package.json", script: "build" }),
    );
  });

  it("names a missing scripts object", () => {
    expect(unwrapErr(readScripts({ path: "package.json", text: "{}" })).message).toBe(
      "package.json declares no `scripts` object",
    );
  });

  it("names a manifest that is not an object at all", () => {
    expect(unwrapErr(readScripts({ path: "package.json", text: "[]" })).message).toBe(
      "package.json does not hold an object",
    );
  });

  it("names unreadable JSON rather than treating it as an empty manifest", () => {
    expect(unwrapErr(readScripts({ path: "package.json", text: "{nope" })).code).toBe("MANIFEST_NOT_JSON");
  });
});

describe("the two evasions that walked past the first version of this gate", () => {
  it("counts `--max_old_space_size` as the same flag V8 counts it as, so a zero-valued duplicate cannot hide", () => {
    const evaded =
      "node --max-old-space-size=8192 --max_old_space_size=0 node_modules/typescript/bin/tsc -p tsconfig.json";
    expect(refusalClause({ command: evaded })).toBe(
      `it names \`${HEAP_FLAG}\` 2 times, counting the \`_\` spelling V8 reads as the same flag, and only the LAST of them decides the ceiling`,
    );
  });

  it("refuses the underscore spelling standing alone when its value is not positive", () => {
    const zeroed = "node --max_old_space_size=0 node_modules/typescript/bin/tsc -p tsconfig.json";
    expect(refusalClause({ command: zeroed })).toBe(`its \`${HEAP_FLAG}\` value is not a positive whole number of MiB`);
  });

  it("accepts the underscore spelling when it carries a real ceiling, because V8 does", () => {
    const underscored = "node --max_old_space_size=8192 node_modules/typescript/bin/tsc -p tsconfig.json";
    expect(refusalClause({ command: underscored })).toBe(undefined);
  });

  it("does not select a script whose only `tsc` sits in a shell comment", () => {
    expect(mentionsCompiler({ command: "echo ok # tsc" })).toBe(false);
    expect(readSimpleCommand({ command: "echo ok # tsc" })).toEqual({ kind: "tokens", tokens: ["echo", "ok"] });
  });

  it("still selects a `tsc` that is merely an argument, which is the over-selection it chose on purpose", () => {
    expect(mentionsCompiler({ command: "echo tsc" })).toBe(true);
    expect(refusalClause({ command: "echo tsc" })).toBe(
      "it does not run the compiler as a direct `node` invocation, so no argument of its own can carry a ceiling",
    );
  });

  it("reads a `#` inside quotes as a character, not as the start of a comment", () => {
    expect(readSimpleCommand({ command: 'node -e "# tsc"' })).toEqual({
      kind: "tokens",
      tokens: ["node", "-e", "# tsc"],
    });
  });

  it("keeps the shipped scripts passing after both fixes", () => {
    expect(assessTscHeapContract({ scripts: { build: COMPLIANT, typecheck: TYPECHECK } })).toEqual({
      compilerScripts: ["build", "typecheck"],
      findings: [],
    });
  });
});

describe("the escape that walked past the second version of this gate", () => {
  // A backslash written in a `package.json` string arrives here already decoded, so these build the
  // DECODED command the shell would receive. `BS` keeps that visible rather than hiding it in an escape.
  const BS = "\\";

  it("refuses the counterexample: an escaped duplicate the shell strips back into the same flag", () => {
    const command = `node ${HEAP_FLAG}=8192 --max${BS}-old-space-size=0 node_modules/typescript/bin/tsc --version`;
    expect(readSimpleCommand({ command })).toEqual({
      kind: "tokens",
      tokens: ["node", `${HEAP_FLAG}=8192`, `${HEAP_FLAG}=0`, "node_modules/typescript/bin/tsc", "--version"],
    });
    expect(assessTscHeapContract({ scripts: { build: command } }).findings).toEqual([
      {
        line: `\`build\` runs the TypeScript compiler and it names \`${HEAP_FLAG}\` 2 times, counting the \`_\` spelling V8 reads as the same flag, and only the LAST of them decides the ceiling: ${command}`,
        script: "build",
      },
    ]);
  });

  it("refuses the same evasion wearing both disguises at once — an escape AND the underscore spelling", () => {
    const command = `node ${HEAP_FLAG}=8192 --max${BS}_old_space_size=0 tsc`;
    expect(readSimpleCommand({ command })).toEqual({
      kind: "tokens",
      tokens: ["node", `${HEAP_FLAG}=8192`, "--max_old_space_size=0", "tsc"],
    });
    expect(assessTscHeapContract({ scripts: { build: command } }).findings.length).toBe(1);
  });

  it("keeps a backslash that the shell itself keeps — inside double quotes it escapes only five characters", () => {
    const command = `node ${HEAP_FLAG}=8192 tsc -p "a${BS}-b.json"`;
    expect(readSimpleCommand({ command })).toEqual({
      kind: "tokens",
      tokens: ["node", `${HEAP_FLAG}=8192`, "tsc", "-p", `a${BS}-b.json`],
    });
    expect(assessTscHeapContract({ scripts: { build: command } }).findings).toEqual([]);
  });

  it("drops a backslash inside double quotes when it escapes one of the five, as the shell does", () => {
    expect(readSimpleCommand({ command: `node -e "say ${BS}"hi${BS}""` })).toEqual({
      kind: "tokens",
      tokens: ["node", "-e", 'say "hi"'],
    });
  });

  it("reads an escaped `#` as a character, so an escape cannot fake a comment either", () => {
    const command = `node ${HEAP_FLAG}=8192 tsc -p ${BS}#a.json`;
    expect(readSimpleCommand({ command })).toEqual({
      kind: "tokens",
      tokens: ["node", `${HEAP_FLAG}=8192`, "tsc", "-p", "#a.json"],
    });
  });

  it("reads an escaped space as part of one word rather than as a delimiter", () => {
    expect(readSimpleCommand({ command: `node ${HEAP_FLAG}=8192 tsc -p my${BS} file.json` })).toEqual({
      kind: "tokens",
      tokens: ["node", `${HEAP_FLAG}=8192`, "tsc", "-p", "my file.json"],
    });
  });

  it("refuses a command ending on a backslash rather than guessing what its last word was", () => {
    const command = `node ${HEAP_FLAG}=8192 tsc ${BS}`;
    expect(readSimpleCommand({ command })).toEqual({
      kind: "unreadable",
      why: "it ends on a backslash, so its last word is not one this reader can close",
    });
    expect(assessTscHeapContract({ scripts: { build: command } }).findings.length).toBe(1);
  });

  it("leaves a backslash inside SINGLE quotes completely alone, where the shell escapes nothing", () => {
    expect(readSimpleCommand({ command: `node -e 'a${BS}-b'` })).toEqual({
      kind: "tokens",
      tokens: ["node", "-e", `a${BS}-b`],
    });
  });

  it("keeps the shipped scripts passing after all three fixes", () => {
    expect(assessTscHeapContract({ scripts: { build: COMPLIANT, typecheck: TYPECHECK } })).toEqual({
      compilerScripts: ["build", "typecheck"],
      findings: [],
    });
  });
});

describe("the selection hole that walked past the third version of this gate", () => {
  it("refuses the counterexample: a redirection glued to the entrypoint, which hid it from SELECTION", () => {
    const command = "node node_modules/typescript/bin/tsc</dev/null --version";
    expect(mentionsCompiler({ command })).toBe(true);
    expect(assessTscHeapContract({ scripts: { build: command } }).findings).toEqual([
      {
        line: `\`build\` runs the TypeScript compiler and it is not one simple command — \`<\` makes its failure maskable: ${command}`,
        script: "build",
      },
    ]);
  });

  it("still refuses when a compliant sibling script would otherwise have carried the whole assessment", () => {
    const assessment = assessTscHeapContract({
      scripts: { build: "node node_modules/typescript/bin/tsc</dev/null --version", typecheck: TYPECHECK },
    });
    expect(assessment.compilerScripts).toEqual(["build", "typecheck"]);
    expect(assessment.findings.length).toBe(1);
  });

  it("selects the compiler through every operator character, not only through whitespace", () => {
    expect(mentionsCompiler({ command: "node tsc>out.log" })).toBe(true);
    expect(mentionsCompiler({ command: "node tsc|tee out.log" })).toBe(true);
    expect(mentionsCompiler({ command: "node tsc;echo done" })).toBe(true);
    expect(mentionsCompiler({ command: "node tsc&&echo done" })).toBe(true);
    expect(mentionsCompiler({ command: "$(which tsc) -p tsconfig.json" })).toBe(true);
  });

  it("does not start selecting a script that names no compiler, which is the over-selection staying bounded", () => {
    expect(mentionsCompiler({ command: "prettier --write ." })).toBe(false);
    expect(mentionsCompiler({ command: "vitest run --config config/vitest/unit.ts" })).toBe(false);
    expect(mentionsCompiler({ command: "rm -rf dist && echo done" })).toBe(false);
  });

  it("keeps the shipped scripts passing after all four fixes", () => {
    expect(assessTscHeapContract({ scripts: { build: COMPLIANT, typecheck: TYPECHECK } })).toEqual({
      compilerScripts: ["build", "typecheck"],
      findings: [],
    });
  });
});

describe("the composed evasion that walked past the fourth version of this gate", () => {
  const BS = "\\";

  it("refuses an escaped compiler name glued to a redirection, which beat BOTH earlier fixes at once", () => {
    const command = `node node_modules/typescript/bin/t${BS}sc</dev/null --version`;
    expect(mentionsCompiler({ command })).toBe(true);
    expect(assessTscHeapContract({ scripts: { build: command, typecheck: TYPECHECK } }).findings).toEqual([
      {
        line: `\`build\` runs the TypeScript compiler and it is not one simple command — \`<\` makes its failure maskable: ${command}`,
        script: "build",
      },
    ]);
  });

  it("selects through a quoted compiler name in an unreadable command too", () => {
    expect(mentionsCompiler({ command: `node "tsc"</dev/null` })).toBe(true);
    expect(mentionsCompiler({ command: `node ts${BS}c|tee out.log` })).toBe(true);
  });

  it("keeps the shipped scripts passing after every fix", () => {
    expect(assessTscHeapContract({ scripts: { build: COMPLIANT, typecheck: TYPECHECK } })).toEqual({
      compilerScripts: ["build", "typecheck"],
      findings: [],
    });
  });
});

describe("the real entrypoint found against the narrowed property", () => {
  it("selects and refuses TypeScript's own `_tsc.js`, which is the compiler and not an obfuscation", () => {
    const command = "node node_modules/typescript/lib/_tsc.js -p tsconfig.json";
    expect(namesCompiler({ token: "node_modules/typescript/lib/_tsc.js" })).toBe(true);
    expect(assessTscHeapContract({ scripts: { build: command, typecheck: TYPECHECK } })).toEqual({
      compilerScripts: ["build", "typecheck"],
      findings: [
        {
          line: `\`build\` runs the TypeScript compiler and it names no \`${HEAP_FLAG}\`, so it runs at V8's own default ceiling: ${command}`,
          script: "build",
        },
      ],
    });
  });

  it("passes `_tsc.js` when it does carry the ceiling, so the new spelling is judged and not just refused", () => {
    const command = `node ${HEAP_FLAG}=8192 node_modules/typescript/lib/_tsc.js -p tsconfig.json`;
    expect(assessTscHeapContract({ scripts: { build: command } })).toEqual({
      compilerScripts: ["build"],
      findings: [],
    });
  });

  it("does not widen to a token that merely ends in the letters", () => {
    expect(namesCompiler({ token: "my_tsc.js" })).toBe(false);
    expect(namesCompiler({ token: "_tsconfig.js" })).toBe(false);
  });
});

describe("the extensionless entrypoint found against the literal fix", () => {
  it("selects `_tsc` with no extension, which Node resolves and runs exactly the same", () => {
    const command = "node node_modules/typescript/lib/_tsc -p tsconfig.json";
    expect(namesCompiler({ token: "node_modules/typescript/lib/_tsc" })).toBe(true);
    expect(assessTscHeapContract({ scripts: { build: command, typecheck: TYPECHECK } }).findings).toEqual([
      {
        line: `\`build\` runs the TypeScript compiler and it names no \`${HEAP_FLAG}\`, so it runs at V8's own default ceiling: ${command}`,
        script: "build",
      },
    ]);
  });

  it("judges every spelling of the two stems the package ships, extension or not", () => {
    const spellings = ["tsc", "tsc.js", "_tsc", "_tsc.js", "lib/_tsc.cjs", "bin/tsc.mjs"];
    expect(spellings.filter((token) => !namesCompiler({ token }))).toEqual([]);
    expect(spellings.length).toBeGreaterThan(0);
  });

  it("still refuses a token that merely resembles one, so stems did not widen it into a substring match", () => {
    const strangers = ["my_tsc", "my_tsc.js", "tsconfig.json", "tsc-watch", "vitest", "tsx"];
    expect(strangers.filter((token) => namesCompiler({ token }))).toEqual([]);
    expect(strangers.length).toBeGreaterThan(0);
  });
});
