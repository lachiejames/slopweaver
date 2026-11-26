import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

/**
 * The owner's Recovery press, `fleet recover`: the one desktop child that causes model sessions, each a visible app
 * card. It is recognised by exactly one call shape, in `desktop/` alone, so every near miss still fails.
 */
describe("NH008 — the desktop shell's one fleet recover call", () => {
  const EXEC_FILE = 'import { execFile } from "node:child_process";\n';
  const call = ({ argv }: { argv: string }): string =>
    `${EXEC_FILE}execFile(join(checkout, "bin", "slopweaver"), ${argv}, options, done);\n`;

  it("passes the exact call, on one line and wrapped as prettier writes it", () => {
    const wrapped = `${EXEC_FILE}const ran = run({\n  launch: ({ done, options }) =>\n    execFile(\n      join(checkout, "bin", "slopweaver"),\n      ["fleet", "recover"],\n      options,\n      done,\n    ),\n});\n`;
    expect(
      scanNoHeadless({ content: call({ argv: '["fleet", "recover"]' }), path: "desktop/src/fleetProcess.ts" }),
    ).toEqual([]);
    expect(scanNoHeadless({ content: wrapped, path: "desktop/src/fleetProcess.ts" })).toEqual([]);
  });

  it("refuses another verb, another argument and a variable argv", () => {
    const misses = ['["fleet", "resume"]', '["fleet", "recover", "--x"]', "argv", '[...["fleet", "recover"]]'];
    expect(misses.length).toBe(4);
    expect(
      misses.map((argv) =>
        scanNoHeadless({ content: call({ argv }), path: "desktop/src/x.ts" }).map((hit) => hit.kind),
      ),
    ).toEqual(misses.map(() => ["NH001", "NH002"]));
  });

  it("refuses the same call from any caller outside the desktop shell", () => {
    const content = call({ argv: '["fleet", "recover"]' });
    const outside = ["src/x.ts", "site/lib/x.ts", "tools/x.ts"];
    expect(outside.length).toBe(3);
    expect(outside.map((path) => scanNoHeadless({ content, path }).map((hit) => hit.kind))).toEqual(
      outside.map(() => ["NH001", "NH002"]),
    );
  });
});
