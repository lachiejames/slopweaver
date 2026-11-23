import { describe, expect, it } from "vitest";
import { ts, withSourceFile } from "#lib/tsSyntax.js";
import { callReading, processBindingsOf } from "../../../devLint/noPythonProcessBindings.js";

/** The reading of the first call expression statement in `text`, after reading its bindings. */
function readingOfFirstCall({ text }: { text: string }): string | undefined {
  return withSourceFile({
    fileName: "fixture.ts",
    text,
    use: (sf) => {
      const bindings = processBindingsOf({ sourceFile: sf });
      const statement = sf.statements.find((stmt): stmt is ts.ExpressionStatement => ts.isExpressionStatement(stmt))!;
      return callReading({ bindings, call: statement.expression as ts.CallExpression });
    },
  });
}

describe("callReading", () => {
  it("reads spawn as a program and exec as a shell command", () => {
    expect(readingOfFirstCall({ text: 'import { spawn } from "node:child_process";\nspawn("x");' })).toBe("program");
    expect(readingOfFirstCall({ text: 'import { exec } from "child_process";\nexec("x");' })).toBe("shell");
  });

  it("follows a renamed import", () => {
    expect(readingOfFirstCall({ text: 'import { execSync as run } from "child_process";\nrun("x");' })).toBe("shell");
  });

  it("follows a namespace import", () => {
    expect(readingOfFirstCall({ text: 'import * as cp from "node:child_process";\ncp.execFile("x");' })).toBe(
      "program",
    );
  });

  it("reads an execa default import as a program", () => {
    expect(readingOfFirstCall({ text: 'import execa from "execa";\nexeca("x");' })).toBe("program");
  });

  it("drops a binding the file redeclares", () => {
    expect(
      readingOfFirstCall({
        text: 'import { spawn } from "child_process";\nfunction f(spawn: unknown) {}\nspawn("x");',
      }),
    ).toBeUndefined();
  });

  it("claims nothing for an unrelated import", () => {
    expect(readingOfFirstCall({ text: 'import { spawn } from "./local.js";\nspawn("x");' })).toBeUndefined();
  });
});
