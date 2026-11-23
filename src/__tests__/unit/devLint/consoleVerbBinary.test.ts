import { describe, expect, it } from "vitest";

import { isScannablePath, scanConsoleVerbBinary } from "../../../devLint/consoleVerbBinary.js";

const PATH = "site/lib/spawnVerb.ts";

describe("scanConsoleVerbBinary", () => {
  /**
   * The exact shape the gate was written against, reproduced verbatim from `site/lib/spawnVerb.ts` as it
   * originally stood. It is the witness: if the criterion ever stops matching it, this reddens.
   */
  it("refuses a spawn whose command is a bare string literal", () => {
    const hits = scanConsoleVerbBinary({
      content: 'const child = spawn("slopweaver", [...argv], { stdio: ["ignore", "pipe", "pipe"] });',
      path: PATH,
    });

    expect(hits.length).toBe(1);
    expect(hits[0]!.path).toBe(PATH);
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.message).toContain("resolved off whatever PATH");
  });

  it("names every launcher whose first argument is the command", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        'spawn("a", []);',
        'spawnSync("b", []);',
        'exec("c");',
        'execSync("d");',
        'execFile("e", []);',
        'execFileSync("f", []);',
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  /** A method call is the same launch written another way, so the criterion reads the property name. */
  it("reads a launcher called off a namespace import", () => {
    const hits = scanConsoleVerbBinary({ content: 'childProcess.spawn("slopweaver", []);', path: PATH });

    expect(hits.length).toBe(1);
  });

  /**
   * The whole point of the criterion: a command reached through a NAME is already a resolved path a reader
   * can follow, which is what the fix looks like. The gate must not flag its own remedy.
   */
  it("passes a command reached through a name", () => {
    const hits = scanConsoleVerbBinary({
      content: ["const bin = binFrom(root);", "spawn(bin, [...argv]);"].join("\n"),
      path: PATH,
    });

    expect(hits).toEqual([]);
  });

  /**
   * The shape of `site/lib/spawnVerb.ts` once, when a console restarted from another seat ran that
   * seat's worktree behind main's binary: the command resolved, the environment inherited whole.
   */
  it("refuses the resolved binary launched with the server's environment unpinned", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        "const resolved = slopweaverBin();",
        "spawn(resolved.bin, [...argv], {",
        "  env: withQuietLauncher({ env: process.env }),",
        '  stdio: ["ignore", "pipe", "pipe"],',
        "});",
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([2]);
    expect(hits[0]!.message).toContain("does not pin `resolved.root`");
  });

  it("refuses the resolved binary launched with no options, or options with no env", () => {
    const hits = scanConsoleVerbBinary({
      content: ["spawn(resolved.bin, [...argv]);", 'spawn(resolved.bin, [], { stdio: "pipe" });'].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([1, 2]);
  });

  it("refuses a pin naming a root other than the binary's own resolution", () => {
    const hits = scanConsoleVerbBinary({
      content: "spawn(resolved.bin, [], { env: consoleChildEnv({ env: process.env, root: other.root }) });",
      path: PATH,
    });

    expect(hits.length).toBe(1);
  });

  /** The pin has to BE the environment handed over, not merely appear inside its expression. */
  it("refuses a pin sitting in a branch the child's environment does not come from", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        "spawn(resolved.bin, [], {",
        "  env: inherited ? process.env : consoleChildEnv({ env: process.env, root: resolved.root }),",
        "});",
        "spawn(resolved.bin, [], {",
        "  env: merge({ env: process.env, extra: consoleChildEnv({ env: process.env, root: resolved.root }) }),",
        "});",
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([1, 4]);
  });

  /** The `(command, options)` overload carries its env in the second argument. */
  it("reads the env of a launch written without an args array", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        "spawn(resolved.bin, { env: consoleChildEnv({ env: process.env, root: resolved.root }) });",
        "spawn(resolved.bin, { env: process.env });",
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([2]);
  });

  /** A call whose body the gate cannot read may drop the pin, so only a known composer counts. */
  it("follows the env field of withQuietLauncher only, never of an unknown call", () => {
    const pin = "consoleChildEnv({ env: process.env, root: resolved.root })";
    const hits = scanConsoleVerbBinary({
      content: [
        `spawn(resolved.bin, [], { env: discardPin({ env: ${pin} }) });`,
        `spawn(resolved.bin, [], { env: withQuietLauncher({ env: withQuietLauncher({ env: ${pin} }) }) });`,
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([1]);
  });

  /** A wrapper that changes nothing at run time changes nothing here either. */
  it("reads through parentheses, casts and non-null assertions on both the command and the pin", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        "spawn((resolved.bin), [], { env: process.env });",
        "spawn(resolved!.bin as string, [], { env: (consoleChildEnv({ env: process.env, root: (resolved.root) })) });",
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([1]);
  });

  it("reads the env the options object ends up holding, not the first one written", () => {
    const pin = "consoleChildEnv({ env: process.env, root: resolved.root })";
    const hits = scanConsoleVerbBinary({
      content: [
        `spawn(resolved.bin, [], { env: ${pin}, env: process.env });`,
        `spawn(resolved.bin, [], { env: ${pin}, ...overrides });`,
        `spawn(resolved.bin, [], { env: process.env, env: ${pin} });`,
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([1, 2]);
  });

  /** A wrapped or bracketed callee is the same launcher. */
  it("reads the launcher through parentheses, a cast and a bracketed name", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        "(spawn)(resolved.bin, [], { env: process.env });",
        "(childProcess.spawn as typeof spawn)(resolved.bin, [], { env: process.env });",
        'childProcess["execFile"](resolved.bin, [], { env: process.env });',
        '(spawn)("slopweaver", []);',
        '(cp[("spawn" as "spawn")] as typeof spawn)(resolved.bin, [], { env: process.env });',
        "(<typeof spawn>spawn)(resolved.bin, [], { env: process.env });",
        "spawn<never>(resolved.bin, [], { env: <NodeJS.ProcessEnv>process.env });",
        "(spawn<never>)(resolved.bin, [], { env: process.env });",
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  /** A wrapper on the pin's own callee, or on a literal command, is transparent too. */
  it("reads the pin and a literal command through wrappers on either", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        "spawn(resolved.bin, [], { env: (consoleChildEnv)({ env: process.env, root: resolved.root }) });",
        "spawn(resolved.bin, [], { env: (withQuietLauncher as typeof withQuietLauncher)({ env: consoleChildEnv({ env: process.env, root: resolved.root }) }) });",
        'spawn(("slopweaver" as string), []);',
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([3]);
  });

  /** A member naming another field cannot overwrite env; one naming env can. */
  it("clears the pin only for a later member that may write env itself", () => {
    const pin = "consoleChildEnv({ env: process.env, root: resolved.root })";
    const hits = scanConsoleVerbBinary({
      content: [
        `spawn(resolved.bin, [], { env: ${pin}, harmless() {}, get other() { return 1; }, stdio });`,
        `spawn(resolved.bin, [], { env: ${pin}, 1n: "harmless", 2: "also" });`,
        `spawn(resolved.bin, [], { env: ${pin}, env() {} });`,
        `spawn(resolved.bin, [], { env: ${pin}, env });`,
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([3, 4]);
  });

  /** A quoted key after the pin was read as unknowable and cleared it. */
  it("reads a quoted key as the field it names, before or after the pin", () => {
    const pin = "consoleChildEnv({ env: process.env, root: resolved.root })";
    const hits = scanConsoleVerbBinary({
      content: [
        `spawn(resolved.bin, [], { env: ${pin}, "stdio": "pipe" });`,
        `spawn(resolved.bin, [], { "env": ${pin} });`,
        `spawn(resolved.bin, [], { env: ${pin}, "env": process.env });`,
        `spawn(resolved.bin, [], { env: ${pin}, [key]: process.env });`,
      ].join("\n"),
      path: PATH,
    });

    expect(hits.map((hit) => hit.line)).toEqual([3, 4]);
  });

  it("passes the resolved binary launched with its own root pinned, inside the quiet wrapper", () => {
    const hits = scanConsoleVerbBinary({
      content: [
        "spawn(resolved.bin, [...argv], {",
        "  env: withQuietLauncher({ env: consoleChildEnv({ env: process.env, root: resolved.root }) }),",
        '  stdio: ["ignore", "pipe", "pipe"],',
        "});",
      ].join("\n"),
      path: PATH,
    });

    expect(hits).toEqual([]);
  });

  /** A template that interpolates is not a literal command, and a plain one is. */
  it("separates an interpolated template from a fixed one", () => {
    const interpolated = scanConsoleVerbBinary({ content: "spawn(`${root}/bin/slopweaver`, []);", path: PATH });
    const fixed = scanConsoleVerbBinary({ content: "spawn(`slopweaver`, []);", path: PATH });

    expect(interpolated).toEqual([]);
    expect(fixed.length).toBe(1);
  });

  /** `fork`'s first argument is a module path, not a command, so it is outside the criterion by shape. */
  it("leaves fork alone", () => {
    expect(scanConsoleVerbBinary({ content: 'fork("./worker.js");', path: PATH })).toEqual([]);
  });

  it("is clean on a file that launches nothing", () => {
    expect(scanConsoleVerbBinary({ content: "export const SHOWN = 8;\n", path: PATH })).toEqual([]);
  });
});

describe("consoleVerbBinary's scan scope", () => {
  it("takes the console's TypeScript and nothing outside it", () => {
    expect(isScannablePath({ path: "site/lib/spawnVerb.ts" })).toBe(true);
    expect(isScannablePath({ path: "site/components/live/Tile.tsx" })).toBe(true);
    expect(isScannablePath({ path: "src/lib/safeJson.ts" })).toBe(false);
    expect(isScannablePath({ path: "site/next.config.mjs" })).toBe(false);
    expect(isScannablePath({ path: "site/lib/consoleVerbBinary.ts" })).toBe(false);
  });
});
