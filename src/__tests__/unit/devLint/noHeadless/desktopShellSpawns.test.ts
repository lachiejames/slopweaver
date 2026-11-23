import { describe, expect, it } from "vitest";
import { isScannablePath, scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH008 — the desktop shell and tools/ are inside the scan", () => {
  const SPAWN = 'import { spawn } from "node:child_process";\n';
  const EXEC_FILE = 'import { execFile } from "node:child_process";\n';

  it("scans the shell's production sources and tools/, and neither's tests nor non-TypeScript files", () => {
    expect(isScannablePath({ path: "desktop/src/consoleServer.ts" })).toBe(true);
    expect(isScannablePath({ path: "tools/generateKnockSurfaces.ts" })).toBe(true);
    expect(isScannablePath({ path: "desktop/__tests__/unit/shellBuild.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "desktop/native/SystemAudioPermission.swift" })).toBe(false);
    expect(isScannablePath({ path: "desktop/yarn.lock" })).toBe(false);
  });

  it("refuses a headless model launch written in the desktop shell", () => {
    const content = `${SPAWN}spawn("claude", ["-p", prompt], { detached: true });\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/sneaky.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH008", 2],
    ]);
  });

  it("refuses a model launch through execFile in the desktop shell, as NH002", () => {
    const content = `${EXEC_FILE}execFile("codex", ["exec", prompt], cb);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/sneaky.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH002", 2],
    ]);
  });

  it("refuses an async child in tools/ on the plain rules", () => {
    const content = `${SPAWN}spawn("claude", ["-p"]);\n`;
    expect(scanNoHeadless({ content, path: "tools/x.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH002", 2],
    ]);
  });

  it("passes each of the shell's child processes by the exact call shape", () => {
    const docs = `${SPAWN}const child = spawn("bash", [join("scripts", "docs-site.sh"), flag], { cwd });\n`;
    const update = `${SPAWN}const child = spawn(\n  join(checkout.value, "bin", "slopweaver"),\n  ["desktop", "update", "--outcome", o],\n  { detached: true },\n);\n`;
    const health = `${EXEC_FILE}execFile(join(checkout, "bin", "slopweaver"), ["fleet", "health", "--json"], options, done);\n`;
    const revive = `${EXEC_FILE}execFile(join(checkout, "bin", "slopweaver"), ["cmux", "revive", "--json"], options, done);\n`;
    const open = `${EXEC_FILE}execFile("open", [...openCmuxArgs({ raise })], options, done);\n`;
    const osascript = `${EXEC_FILE}execFile("osascript", args, options, done);\n`;
    const helper = `${EXEC_FILE}const child = execFile(helperPath, [verb], { encoding: "utf8" }, cb);\n`;
    const front = `${EXEC_FILE}execFile(\n  "/usr/bin/osascript",\n  ["-l", "JavaScript", "-e", FRONT_WINDOW_PROGRAM],\n  { timeout },\n  cb,\n);\n`;
    const exported = `${EXEC_FILE}execFile(\n  join(checkout, "bin", "slopweaver"),\n  ["page", "export", slug, "--out", file, "--json"],\n  options,\n  done,\n);\n`;
    const fixtures = [docs, update, health, revive, exported, open, osascript, helper, front];
    expect(fixtures.length).toBe(9);
    expect(fixtures.map((content) => scanNoHeadless({ content, path: "desktop/src/x.ts" }))).toEqual(
      fixtures.map(() => []),
    );
  });

  it("refuses a generic program runner in the shell — one recognized call a later caller could hand a model runner", () => {
    const run = `${EXEC_FILE}execFile(file, args, { cwd, env }, (error) => {});\n`;
    const update = `${SPAWN}const child = spawn(launch.file, [...launch.args], { detached: true });\n`;
    const helper = `${EXEC_FILE}execFile(helperPath, args, { timeout }, cb);\n`;
    const bin = `${EXEC_FILE}execFile(join(checkout, "bin", "slopweaver"), args, options, done);\n`;
    expect(scanNoHeadless({ content: run, path: "desktop/src/x.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH002", 2],
    ]);
    expect(scanNoHeadless({ content: update, path: "desktop/src/x.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH008", 2],
    ]);
    expect(scanNoHeadless({ content: helper, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual([
      "NH001",
      "NH002",
    ]);
    expect(scanNoHeadless({ content: bin, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual([
      "NH001",
      "NH002",
    ]);
  });

  it("passes a Claude worker's one validated native child, and refuses every looser spelling of it", () => {
    const validated = `${SPAWN}const child = spawn(validated.claudePath, validated.args, {\n  cwd: validated.cwd,\n});\n`;
    expect(scanNoHeadless({ content: validated, path: "desktop/src/sessionWorker/x.ts" })).toEqual([]);
    const looser = [
      `${SPAWN}spawn("claude", validated.args, {});\n`,
      `${SPAWN}spawn(config.claudePath, request.args, {});\n`,
      `${SPAWN}spawn(request.command, request.args, {});\n`,
      `${SPAWN}spawn(validated.claudePath, ["-p", prompt], {});\n`,
      `${SPAWN}spawn(validated.claudePath, validated.args, {});\nspawn(validated.claudePath, ["-p"], {});\n`,
    ];
    expect(looser.length).toBe(5);
    expect(
      looser.map((content) => scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)),
    ).toEqual([
      ["NH001", "NH008"],
      ["NH001", "NH008"],
      ["NH001", "NH008"],
      ["NH001", "NH008"],
      ["NH001", "NH008"],
    ]);
  });

  it("keeps the validated Claude child to the desktop shell", () => {
    const content = `${SPAWN}spawn(validated.claudePath, validated.args, {});\n`;
    expect(scanNoHeadless({ content, path: "src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH002"]);
    expect(scanNoHeadless({ content, path: "site/lib/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH008"]);
  });

  it("refuses a program named by a constant, whose definition could change without the call changing", () => {
    const content = `${EXEC_FILE}execFile(OSASCRIPT, ["-l", "JavaScript", "-e", FRONT_WINDOW_PROGRAM], {}, cb);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH002", 2],
    ]);
  });

  it("keeps the recognition to the desktop shell: its shapes are NH001 and NH002 under src/ and NH008 under site/", () => {
    const content = `${SPAWN}const child = spawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n`;
    expect(scanNoHeadless({ content, path: "src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH002"]);
    expect(scanNoHeadless({ content, path: "site/lib/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH008"]);
    expect(scanNoHeadless({ content, path: "tools/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH002"]);
  });

  it("keeps the console's shapes out of the desktop shell", () => {
    const content = `${SPAWN}const child = spawn(resolved.bin, [...argv], {});\n`;
    expect(scanNoHeadless({ content, path: "site/lib/x.ts" })).toEqual([]);
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH008"]);
  });

  it("does not let an unrecognized call ride beside a recognized one on the same line", () => {
    const content = `${SPAWN}spawn("bash", [join("scripts", "docs-site.sh"), flag], {}); spawn("claude", ["-p"]);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001", "NH008"]);
  });

  it("clears the import only of the member it makes a recognized call to", () => {
    const content =
      'import { execFile, spawn } from "node:child_process";\nspawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n';
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => [hit.kind, hit.excerpt])).toEqual([
      ["NH001", "execFile"],
    ]);
  });

  it("still refuses an aliased import and a concealed one beside a recognized call", () => {
    const aliased =
      'import { spawn as launch } from "node:child_process";\nspawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n';
    const concealed =
      'import * as cp from "node:child_process";\nspawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n';
    expect(scanNoHeadless({ content: aliased, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
    expect(scanNoHeadless({ content: concealed, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
  });

  it("reports an unrecognized multi-line call at the line its callee is on", () => {
    const content = `${EXEC_FILE}\nexecFile(\n  "claude",\n  ["-p"],\n  cb,\n);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => [hit.kind, hit.line])).toEqual([
      ["NH001", 1],
      ["NH002", 3],
    ]);
  });

  it("keeps the import finding when the name is used any way but as a recognized call", () => {
    const recognized = 'spawn("bash", [join("scripts", "docs-site.sh"), flag], {});';
    const parenthesized = `${SPAWN}${recognized}\n(spawn)("claude", ["-p"]);\n`;
    const aliasedVariable = `${SPAWN}${recognized}\nconst run = spawn;\nrun("claude", ["-p"]);\n`;
    const calledThrough = `${SPAWN}${recognized}\nspawn.call(undefined, "claude", ["-p"]);\n`;
    const kinds = [parenthesized, aliasedVariable, calledThrough].map((content) =>
      scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind),
    );
    expect(kinds).toEqual([["NH001"], ["NH001"], ["NH001"]]);
  });

  it("reads an escaped spelling of the imported name as the name", () => {
    const content = `${SPAWN}spawn("bash", [join("scripts", "docs-site.sh"), flag], {});\nsp\\u0061wn("claude", ["-p"]);\n`;
    expect(content).toContain("sp\\u0061wn(");
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
  });

  it("does not clear the import for a recognized opening that is a constructor call, not a call", () => {
    const content = `${SPAWN}new spawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
  });

  it("does not let two comments fabricate an import clause around a real use", () => {
    const content = `${SPAWN}spawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n/* import { harmless */\nconst run = spawn;\n/* } from "node:child_process" */\nrun("claude", ["-p"]);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
  });

  it("does not let a comment holding `import {` ahead of the real import swallow it", () => {
    const content = `/* import { harmless */\n${SPAWN}spawn.call(undefined, "claude", ["-p"]);\n`;
    const kinds = ["desktop/src/x.ts", "site/lib/x.ts"].map((path) =>
      scanNoHeadless({ content, path }).map((hit) => `${hit.kind}:${String(hit.line)}`),
    );
    expect(kinds).toEqual([["NH001:2"], ["NH001:2"]]);
  });

  it("reads a type-only import of the name as no import at all", () => {
    const content = 'import { type spawn } from "node:child_process";\nimport type { exec } from "child_process";\n';
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" })).toEqual([]);
  });

  it("does not mistake a multiplication continued on the next line for a comment", () => {
    const content = `${SPAWN}spawn("bash", [join("scripts", "docs-site.sh"), flag], {});\nconst launched = 1\n  * spawn.call(undefined, "claude", ["-p"]);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
  });

  it("does not let a recognized call written in a comment balance a real unrecognized use", () => {
    const content = `${SPAWN}// spawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n(spawn)("claude", ["-p"]);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
  });

  it("does not let a $-prefixed lookalike call stand in for a recognized one", () => {
    const content = `${SPAWN}const run = spawn;\nconst $spawn = (...args) => args;\n$spawn("bash", [join("scripts", "docs-site.sh"), flag], {});\nrun("claude", ["-p"]);\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" }).map((hit) => hit.kind)).toEqual(["NH001"]);
  });

  it("does not count a comment's mention of a name as a use of it", () => {
    const content = `${SPAWN}// we spawn the docs site here\n/**\n * spawn is detached\n */\nspawn("bash", [join("scripts", "docs-site.sh"), flag], {});\n`;
    expect(scanNoHeadless({ content, path: "desktop/src/x.ts" })).toEqual([]);
  });

  it("excludes a nested production .test.tsx under desktop/ as well as .test.ts, but not under site/", () => {
    expect(isScannablePath({ path: "desktop/src/view.tsx" })).toBe(true);
    expect(isScannablePath({ path: "desktop/src/view.test.tsx" })).toBe(false);
    expect(isScannablePath({ path: "site/lib/widget.test.tsx" })).toBe(true);
    expect(isScannablePath({ path: "tools/example.js" })).toBe(false);
  });
});
