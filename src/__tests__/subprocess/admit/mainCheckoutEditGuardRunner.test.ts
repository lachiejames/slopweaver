import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { codexApplyPatchPaths, runMainCheckoutEditGuard } from "../../../admit/mainCheckoutEditGuardRunner.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real repo's main checkout, in a fresh temp dir, still on its default branch. */
function realMainCheckout(): string {
  const main = mkdtempSync(join(tmpdir(), "slopweaver-edit-guard-runner-"));
  fixtureDirs.push(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  writeFileSync(join(main, "package.json"), '{"name":"slopweaver"}\n');
  gitInTemp({ args: ["add", "package.json"], cwd: main });
  gitInTemp({ args: ["commit", "-q", "-m", "root"], cwd: main });
  return main;
}

/** Run the guard with an injected stdin string + capture the written diagnostics. */
async function run({
  stdin,
  allowOverride = false,
}: {
  stdin: string;
  allowOverride?: boolean;
}): Promise<{ code: number; errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runMainCheckoutEditGuard({
    env: allowOverride ? { SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE: "1" } : {},
    readStdin: () => Promise.resolve(stdin),
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

describe("runMainCheckoutEditGuard", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("extracts every Codex patch target, including both sides of a move", () => {
    expect(
      codexApplyPatchPaths({
        command: [
          "*** Begin Patch",
          "*** Add File: src/new.ts",
          "*** Update File: src/old.ts",
          "*** Move to: src/moved.ts",
          "*** Delete File: src/gone.ts",
          "*** End Patch",
        ].join("\n"),
      }),
    ).toEqual(["src/new.ts", "src/old.ts", "src/moved.ts", "src/gone.ts"]);
  });

  it("ignores malformed and unknown patch directives", () => {
    expect(
      codexApplyPatchPaths({
        command: ["*** Begin Patch", "*** Update File:", "*** Replace File: src/unknown.ts", "*** End Patch"].join(
          "\n",
        ),
      }),
    ).toEqual([]);
  });

  it("blocks with exit 2 + a message, using a fake evaluator", async () => {
    const errors: string[] = [];
    const code = await runMainCheckoutEditGuard({
      env: {},
      evaluate: () => ({ block: true, message: "blocked for the test" }),
      readStdin: () =>
        Promise.resolve(JSON.stringify({ cwd: "/repo", tool_input: { file_path: "a.ts" }, tool_name: "Edit" })),
      writeError: (line) => {
        errors.push(line);
      },
    });
    expect(code).toBe(2);
    expect(errors.join("")).toBe("blocked for the test\n");
  });

  it("allows an unguarded tool call", async () => {
    expect(await run({ stdin: JSON.stringify({ cwd: "/repo", tool_input: {}, tool_name: "Read" }) })).toEqual({
      code: 0,
      errors: [],
    });
  });

  it("allows on malformed JSON — this guard fails OPEN", async () => {
    expect(await run({ stdin: "not-json" })).toEqual({ code: 0, errors: [] });
  });

  it("allows a payload missing cwd — fails open on state it cannot use", async () => {
    expect(await run({ stdin: JSON.stringify({ tool_input: { file_path: "a.ts" }, tool_name: "Edit" }) })).toEqual({
      code: 0,
      errors: [],
    });
  });

  it("blocks a real Edit targeting a real main checkout, end to end", async () => {
    const cwd = realMainCheckout();
    const { code, errors } = await run({
      stdin: JSON.stringify({ cwd, tool_input: { file_path: "index.ts" }, tool_name: "Edit" }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE");
  });

  it("blocks a real Write targeting a real main checkout, end to end", async () => {
    const cwd = realMainCheckout();
    const { code, errors } = await run({
      stdin: JSON.stringify({ cwd, tool_input: { file_path: "new-file.ts" }, tool_name: "Write" }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE");
  });

  it("blocks a real Codex apply_patch targeting a real main checkout, end to end", async () => {
    const cwd = realMainCheckout();
    const { code, errors } = await run({
      stdin: JSON.stringify({
        cwd,
        tool_input: {
          command: ["*** Begin Patch", "*** Update File: index.ts", "*** End Patch"].join("\n"),
        },
        tool_name: "apply_patch",
      }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE");
  });

  it("blocks when a Codex move destination targets the real main checkout", async () => {
    const cwd = realMainCheckout();
    const { code, errors } = await run({
      stdin: JSON.stringify({
        cwd,
        tool_input: {
          command: [
            "*** Begin Patch",
            "*** Update File: /outside/source.ts",
            "*** Move to: destination.ts",
            "*** End Patch",
          ].join("\n"),
        },
        tool_name: "apply_patch",
      }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE");
  });

  it("allows that same real Edit under the override env var, end to end", async () => {
    const cwd = realMainCheckout();
    expect(
      await run({
        allowOverride: true,
        stdin: JSON.stringify({ cwd, tool_input: { file_path: "index.ts" }, tool_name: "Edit" }),
      }),
    ).toEqual({ code: 0, errors: [] });
  });
});
