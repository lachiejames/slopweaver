import { describe, expect, it } from "vitest";
import { isScannablePath, scanNoHeadless } from "../../../../devLint/noHeadless.js";
import { capabilityHits } from "../../../../devLint/noHeadlessCapability.js";

describe("NH008 — the console's async spawns", () => {
  const IMPORT = 'import { spawn } from "node:child_process";\n';

  it("applies the console's rule by path alone, leaving the rest of the tree on NH001/NH002", () => {
    const content = `${IMPORT}spawn(bin, args);\n`;
    expect(capabilityHits({ content, path: "site/lib/x.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH008", 2],
    ]);
    expect(capabilityHits({ content, path: "src/lib/x.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH002", 2],
    ]);
  });

  it("passes the verb runner and the plan call's app-server, each by the exact call shape", () => {
    const verb = `${IMPORT}const child = spawn(resolved.bin, [...argv], { env });\n`;
    const plan = `${IMPORT}const child = spawn(composition.executable, [...composition.argv], { cwd });\n`;
    expect(scanNoHeadless({ content: verb, path: "site/lib/spawnVerb.ts" })).toEqual([]);
    expect(scanNoHeadless({ content: plan, path: "site/lib/talkPlanLaunch.ts" })).toEqual([]);
  });

  it("refuses any other console spawn — a model runner by name, or an executable it cannot see", () => {
    const content = `${IMPORT}spawn("codex", ["exec", prompt], { detached: true });\nspawn(bin, args);\n`;
    expect(scanNoHeadless({ content, path: "site/lib/sneaky.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH008", 2],
      ["NH008", 3],
    ]);
  });

  it("does not let an unrecognized call ride beside a recognized one on the same line", () => {
    const content = `${IMPORT}spawn(resolved.bin, [...argv], {}); spawn("claude", ["-p"]);\n`;
    expect(scanNoHeadless({ content, path: "site/lib/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH008"]);
  });

  it("refuses the spawn import in a console file that makes no recognized call, and exec everywhere", () => {
    expect(scanNoHeadless({ content: IMPORT, path: "site/lib/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
    const exec = 'import { exec } from "node:child_process";\nexec("codex exec x");\n';
    expect(scanNoHeadless({ content: exec, path: "site/lib/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH002"]);
  });

  it("keeps the recognition to the console: the same shape under src/ is still NH001 and NH002", () => {
    const content = `${IMPORT}const child = spawn(composition.executable, [...composition.argv], {});\n`;
    expect(scanNoHeadless({ content, path: "src/talk/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH002"]);
  });

  it("scans the console's production sources and not its tests", () => {
    expect(isScannablePath({ path: "site/lib/talkPlanLaunch.ts" })).toBe(true);
    expect(isScannablePath({ path: "site/components/voice/VoiceProvider.tsx" })).toBe(true);
    expect(isScannablePath({ path: "site/__tests__/unit/talkPlanCall.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "site/content/console/call-widget.mdx" })).toBe(false);
  });
});
