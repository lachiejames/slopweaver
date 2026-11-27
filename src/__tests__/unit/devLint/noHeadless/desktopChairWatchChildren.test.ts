import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

/**
 * The desktop chair watch's two calls: the read-only `supervisor chair-watch --json`, and `supervisor hand-off`, whose
 * successor is a visible app card. Each is recognised by exactly one literal argv, in `desktop/` alone, so an
 * override flag, a variable argv or the same call outside the desktop shell still fails.
 */
describe("NH008 — the desktop chair watch's two calls", () => {
  const EXEC_FILE = 'import { execFile } from "node:child_process";\n';
  const call = ({ argv }: { argv: string }): string =>
    `${EXEC_FILE}execFile(join(checkout, "bin", "slopweaver"), ${argv}, options, done);\n`;
  const PATH = "desktop/src/chairWatchShell.ts";

  it("passes each exact call, on one line and wrapped as prettier writes it", () => {
    const wrapped = `${EXEC_FILE}const ran = run({\n  launch: ({ done, options }) =>\n    execFile(\n      join(checkout, "bin", "slopweaver"),\n      ["supervisor", "hand-off"],\n      options,\n      done,\n    ),\n});\n`;
    expect(scanNoHeadless({ content: call({ argv: '["supervisor", "hand-off"]' }), path: PATH })).toEqual([]);
    expect(scanNoHeadless({ content: call({ argv: '["supervisor", "chair-watch", "--json"]' }), path: PATH })).toEqual(
      [],
    );
    expect(scanNoHeadless({ content: wrapped, path: PATH })).toEqual([]);
  });

  it("refuses an override flag, another supervisor verb and a variable argv", () => {
    const misses = [
      '["supervisor", "hand-off", "--now"]',
      '["supervisor", "hand-off", "--plan", alias]',
      '["supervisor", "chair-watch"]',
      '["supervisor", "tick"]',
      "argv",
    ];
    expect(misses.length).toBe(5);
    expect(
      misses.map((argv) => scanNoHeadless({ content: call({ argv }), path: PATH }).map((hit) => hit.kind)),
    ).toEqual(misses.map(() => ["NH001", "NH002"]));
  });

  it("refuses the hand-off call from any caller outside the desktop shell", () => {
    const content = call({ argv: '["supervisor", "hand-off"]' });
    const outside = ["src/x.ts", "site/lib/x.ts", "tools/x.ts"];
    expect(outside.length).toBe(3);
    expect(outside.map((path) => scanNoHeadless({ content, path }).map((hit) => hit.kind))).toEqual(
      outside.map(() => ["NH001", "NH002"]),
    );
  });
});
