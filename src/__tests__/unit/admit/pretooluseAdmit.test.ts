import { describe, expect, it } from "vitest";

import { runPreToolUseAdmit } from "../../../admit/pretooluseAdmit.js";

/** Run the hook with an injected stdin string + capture the written diagnostics. */
async function run({
  stdin,
  allowRaw = false,
  env = {},
}: {
  stdin: string;
  allowRaw?: boolean;
  env?: Readonly<Record<string, string>>;
}): Promise<{ code: number; errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runPreToolUseAdmit({
    env: { ...(allowRaw ? { SLOPWEAVER_ALLOW_RAW: "1" } : {}), ...env },
    readStdin: () => Promise.resolve(stdin),
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

describe("runPreToolUseAdmit", () => {
  it("blocks a raw mutating Bash command with exit 2 + a message", async () => {
    const { code, errors } = await run({
      stdin: JSON.stringify({ tool_input: { command: "gh pr close 1" }, tool_name: "Bash" }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_RAW=1");
  });

  it("allows a read-only Bash command with exit 0 and no diagnostics", async () => {
    expect(await run({ stdin: JSON.stringify({ tool_input: { command: "git status" }, tool_name: "Bash" }) })).toEqual({
      code: 0,
      errors: [],
    });
  });

  it("allows the visible agent to continue an in-progress local rebase", async () => {
    expect(
      await run({
        stdin: JSON.stringify({
          tool_input: { command: "git -c core.editor=true rebase --continue" },
          tool_name: "Bash",
        }),
      }),
    ).toEqual({ code: 0, errors: [] });
  });

  it("allows under the SLOPWEAVER_ALLOW_RAW escape", async () => {
    const { code } = await run({
      allowRaw: true,
      stdin: JSON.stringify({ tool_input: { command: "gh pr close 1" }, tool_name: "Bash" }),
    });
    expect(code).toBe(0);
  });

  it("blocks a Python invocation with exit 2, and names its own hatch rather than the raw one", async () => {
    const { code, errors } = await run({
      stdin: JSON.stringify({ tool_input: { command: "python3 -c 'print(1)'" }, tool_name: "Bash" }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_PYTHON=1");
  });

  it("reads the ambient Python hatch from the environment beside the raw one", async () => {
    expect(
      await run({
        env: { SLOPWEAVER_ALLOW_PYTHON: "1" },
        stdin: JSON.stringify({ tool_input: { command: "python3 -V" }, tool_name: "Bash" }),
      }),
    ).toEqual({ code: 0, errors: [] });
  });

  it("does not let the RAW escape waive a Python invocation", async () => {
    const { code, errors } = await run({
      allowRaw: true,
      stdin: JSON.stringify({ tool_input: { command: "python3 -V" }, tool_name: "Bash" }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_PYTHON=1");
  });

  it("FAILS CLOSED (exit 2) on malformed JSON, loudly", async () => {
    const { code, errors } = await run({ stdin: "not-json" });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("malformed");
  });

  it("lets a thrown evaluator reject (so the entry fails closed), never swallowing it", async () => {
    await expect(
      runPreToolUseAdmit({
        env: {},
        evaluate: () => {
          throw new Error("boom");
        },
        readStdin: () => Promise.resolve('{"tool_name":"Bash","tool_input":{"command":"git status"}}'),
        writeError: () => {},
      }),
    ).rejects.toThrow("boom");
  });
});
