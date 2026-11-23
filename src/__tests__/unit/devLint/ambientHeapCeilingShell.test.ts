/**
 * The shell reader `ambient-heap-ceiling` stands on, checked against the shell's own behaviour.
 *
 * Every case below was a live evasion first: a real file this reader called clean whose ceiling a real
 * `node` child then applied. That is why the fixtures look adversarial — they are, and each one is a review
 * pass's counterexample rather than an invented edge.
 */
import { describe, expect, it } from "vitest";
import {
  AMBIENT_VAR,
  assignsCeiling,
  type CeilingSite,
  HEAP_FLAG,
  namesHeapFlag,
  shellSites,
} from "../../../devLint/ambientHeapCeilingShell.js";

const CEILING = `--${HEAP_FLAG}=8192`;

describe("namesHeapFlag", () => {
  it("accepts V8's hyphen spelling", () => {
    expect(namesHeapFlag({ text: CEILING })).toBe(true);
  });

  it("accepts V8's underscore alias, which applies the same ceiling", () => {
    expect(namesHeapFlag({ text: "--max_old_space_size=8192" })).toBe(true);
  });

  it("rejects a string naming no ceiling", () => {
    expect(namesHeapFlag({ text: "--enable-source-maps" })).toBe(false);
  });
});

describe("assignsCeiling", () => {
  it("accepts a shell assignment of the variable", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}=${CEILING} node build.js` })).toBe(true);
  });

  it("rejects a sentence that merely names both, which every comment about this gate does", () => {
    expect(assignsCeiling({ text: `we removed ${AMBIENT_VAR} and its ${HEAP_FLAG} ceiling` })).toBe(false);
  });

  it("rejects the flag on a process's own argv", () => {
    expect(assignsCeiling({ text: `node --${HEAP_FLAG}=8192 build.js` })).toBe(false);
  });

  it("accepts a DOUBLE-quoted value carrying another option first — the r1 counterexample", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}="--enable-source-maps ${CEILING}" node build.js` })).toBe(true);
  });

  it("accepts a SINGLE-quoted value carrying another option first", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}='--enable-source-maps ${CEILING}' node build.js` })).toBe(true);
  });

  it("accepts V8's UNDERSCORE spelling of the flag, which node applies identically", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}="--max_old_space_size=128" node build.js` })).toBe(true);
  });

  it("still rejects an unquoted value whose ceiling belongs to the NEXT word, not to the variable", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}=--enable-source-maps node --${HEAP_FLAG}=8192 build.js` })).toBe(
      false,
    );
  });
});

describe("shellSites", () => {
  it("numbers the assigning line from one", () => {
    const content = `#!/bin/sh\nset -e\n${AMBIENT_VAR}=${CEILING} node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 3" },
    ]);
  });

  it("ignores a commented-out assignment, so history in a script is not a finding", () => {
    const content = `#!/bin/sh\n# ${AMBIENT_VAR}=${CEILING} node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([]);
  });

  it("catches a quoted value carrying another option first — the r1 counterexample", () => {
    const content = `#!/bin/sh\n${AMBIENT_VAR}="--enable-source-maps ${CEILING}" node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 2" },
    ]);
  });

  it("ignores an assignment in a trailing comment", () => {
    const content = `node build.js # was ${AMBIENT_VAR}=${CEILING}\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([]);
  });
});
describe("assignsCeiling and quoting INSIDE the flag", () => {
  it("dequotes the word, so a quote boundary inside the flag is still the flag — the r2 counterexample", () => {
    expect(assignsCeiling({ text: `export ${AMBIENT_VAR}="--max-old-"space-size=128` })).toBe(true);
  });

  it("dequotes a word assembled from both quote kinds", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}='--max-old-'"space-size=128" node x.js` })).toBe(true);
  });

  it("stops at unquoted whitespace, so the flag in the NEXT word is not read as this value", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}=--trace-warnings node --${HEAP_FLAG}=8192 x.js` })).toBe(false);
  });

  it("stops at a command separator, so a later command's argv is not read as this value", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}=--trace-warnings; node --${HEAP_FLAG}=8192 x.js` })).toBe(false);
  });

  it("reads EVERY assignment on the line, so a harmless first one hides nothing — the r3 counterexample", () => {
    const text = `${AMBIENT_VAR}=--enable-source-maps; export ${AMBIENT_VAR}=${CEILING}; node build.js`;
    expect(assignsCeiling({ text })).toBe(true);
  });

  it("still finds the ceiling when it is the FIRST of two assignments", () => {
    const text = `${AMBIENT_VAR}=${CEILING}; export ${AMBIENT_VAR}=--enable-source-maps; node build.js`;
    expect(assignsCeiling({ text })).toBe(true);
  });

  it("finds nothing when neither of two assignments names the flag", () => {
    const text = `${AMBIENT_VAR}=--enable-source-maps; export ${AMBIENT_VAR}=--trace-warnings; node build.js`;
    expect(assignsCeiling({ text })).toBe(false);
  });

  it("drops an UNQUOTED backslash inside the flag, as the shell does — the r2 counterexample", () => {
    expect(assignsCeiling({ text: `export ${AMBIENT_VAR}=--max-old-\\space-size=128` })).toBe(true);
  });

  it("KEEPS a backslash inside double quotes, where the shell keeps it, so no flag is invented", () => {
    expect(assignsCeiling({ text: `export ${AMBIENT_VAR}="--max-old-\\space-size=128"` })).toBe(false);
  });

  it("keeps a backslash inside single quotes, where the shell also keeps it", () => {
    expect(assignsCeiling({ text: `export ${AMBIENT_VAR}='--max-old-\\space-size=128'` })).toBe(false);
  });

  it("drops a backslash before a double quote inside double quotes, which the shell does escape", () => {
    expect(assignsCeiling({ text: `export ${AMBIENT_VAR}="--max-old-space-size=128\\""` })).toBe(true);
  });

  it("does not let an ESCAPED space end the word early", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}=--enable-source-maps\\ ${CEILING} node build.js` })).toBe(true);
  });

  it("reads a MENTION of the variable as no assignment at all", () => {
    expect(assignsCeiling({ text: `if [[ "\${${AMBIENT_VAR}:-}" != *${HEAP_FLAG}* ]]; then` })).toBe(false);
  });
});

describe("shellSites and a quoted hash", () => {
  it("does not let a QUOTED # hide the assignment after it — the r1 counterexample", () => {
    const content = `printf '%s\\n' '# build'; ${AMBIENT_VAR}=${CEILING} node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });

  it("still drops a real trailing comment, whose # follows whitespace outside quotes", () => {
    const content = `yarn lint # was ${AMBIENT_VAR}=${CEILING}\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([]);
  });

  it("does not let an ESCAPED # truncate the line, because the shell does not read it as a comment", () => {
    const content = `echo \\# ; ${AMBIENT_VAR}=${CEILING} node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });

  it("does not treat a # inside a word as a comment, so a fragment identifier does not swallow the line", () => {
    const content = `curl https://example.com/x#frag; ${AMBIENT_VAR}=${CEILING} node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });

  it("does NOT read a variable name buried inside another word as an assignment, because no shell does", () => {
    const content = `curl https://example.com/x#${AMBIENT_VAR}=${CEILING}\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([]);
  });
});

describe("shellSites and a line continuation", () => {
  it("joins a backslash-newline, so a split assignment is still caught — the r2 counterexample", () => {
    const content = `export ${AMBIENT_VAR}="--enable-source-maps \\\n--max-old-space-size=128"\nnode build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });

  it("numbers a continued assignment by the line it STARTS on, not the one the flag lands on", () => {
    const content = `set -euo pipefail\nyarn install\nexport ${AMBIENT_VAR}="--enable-source-maps \\\n--max-old-space-size=128"\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 3" },
    ]);
  });

  it("joins a continuation that spans three physical lines", () => {
    const content = `export ${AMBIENT_VAR}="--enable-source-maps \\\n--trace-warnings \\\n--max-old-space-size=128"\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });

  it("treats an EVEN run of trailing backslashes as literal, so the next line stays its own", () => {
    const content = `printf 'a\\\\\\\\'\n${AMBIENT_VAR}=${CEILING} node build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 2" },
    ]);
  });

  it("joins with NOTHING, so a break INSIDE the flag is still the flag — the r3 counterexample", () => {
    const content = `export ${AMBIENT_VAR}="--max-old-\\\nspace-size=128"\nnode build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });

  it("keeps a space that was already there before the backslash, exactly as the shell does", () => {
    const content = `${AMBIENT_VAR}=${CEILING} \\\nnode build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });

  it("finds nothing in a continued command that assigns no ceiling", () => {
    const content = `node \\\n  --trace-warnings \\\n  build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([]);
  });
});

describe("shellSites and a comment ending in a backslash", () => {
  it("ends the comment at the newline, so the export below it is still found — the r3 counterexample", () => {
    const content = `#!/bin/sh\n# build options \\\nexport ${AMBIENT_VAR}=${CEILING}\nnode build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/ceiling-comment.sh" }) })).toEqual([
      { file: "scripts/ceiling-comment.sh", where: "line 3" },
    ]);
  });

  it("still swallows the rest of the comment's OWN line", () => {
    const content = `# was ${AMBIENT_VAR}=${CEILING} \\\nnode build.js\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([]);
  });

  it("keeps a continuation that is NOT in a comment, which the same newline rule governs", () => {
    const content = `export ${AMBIENT_VAR}=--max-old-\\\nspace-size=128\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });
});

describe("shellSites and a newline inside quotes", () => {
  it("keeps one logical line open, so an assignment split across it is still found", () => {
    const content = `export ${AMBIENT_VAR}="--max-old-space-size=128\nmore"\n`;
    expect(at({ sites: shellSites({ content, file: "scripts/build.sh" }) })).toEqual([
      { file: "scripts/build.sh", where: "line 1" },
    ]);
  });
});

describe("assignsCeiling and quoting inside the variable NAME", () => {
  it("dequotes the whole word, so NODE_'OPTIONS'= is still an assignment — the r1 counterexample", () => {
    expect(assignsCeiling({ text: `export NODE_'OPTIONS'=--max-old-space-size=128` })).toBe(true);
  });

  it("sees the assignment when the whole word is quoted", () => {
    expect(assignsCeiling({ text: `export "${AMBIENT_VAR}=${CEILING}"` })).toBe(true);
  });

  it("sees bash's append form, which sets the variable just as effectively", () => {
    expect(assignsCeiling({ text: `${AMBIENT_VAR}+=" ${CEILING}"` })).toBe(true);
  });

  it("still refuses a MENTION of the variable that assigns nothing", () => {
    expect(assignsCeiling({ text: `echo "\${${AMBIENT_VAR}:-}" # ${CEILING}` })).toBe(false);
  });

  it("still refuses a DIFFERENT variable assigned the flag, which no Node process inherits as options", () => {
    expect(assignsCeiling({ text: `OLD_${AMBIENT_VAR}=${CEILING}` })).toBe(false);
  });
});

describe("a NON-shell script offered to the shell reader", () => {
  it("reports nothing for JavaScript that merely names the variable, so the wider filter is free", () => {
    const content = `#!/usr/bin/env node\nprocess.env.${AMBIENT_VAR} = "${CEILING}";\n`;
    expect(at({ sites: shellSites({ content, file: "bin/other" }) })).toEqual([]);
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
