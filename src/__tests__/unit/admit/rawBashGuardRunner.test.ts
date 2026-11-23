/**
 * The raw-Bash gate's runner: the exit code it returns for one `PreToolUse` payload, that it fails open on
 * anything it cannot read, and that the ambient hatch opens it.
 *
 * Every seam is a plain injected function, never a mock.
 */
import { describe, expect, it } from "vitest";

import { runRawBashGuard } from "../../../admit/rawBashGuardRunner.js";

/** Run the guard over one payload, collecting whatever it wrote to stderr. */
async function judge({
  payload,
  env = {},
}: {
  payload: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly code: number; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runRawBashGuard({
    env,
    readStdin: () => Promise.resolve(payload),
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

/** A `PreToolUse` payload for one Bash command. */
function bashPayload({ command }: { command: string }): string {
  return JSON.stringify({ session_id: "s1", tool_input: { command }, tool_name: "Bash" });
}

describe("runRawBashGuard", () => {
  it("refuses a script and writes the refusal", async () => {
    const { code, errors } = await judge({ payload: bashPayload({ command: "a; b; c" }) });

    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_BASH=1");
  });

  it("lets one command through silently", async () => {
    expect(await judge({ payload: bashPayload({ command: "git status" }) })).toEqual({ code: 0, errors: [] });
  });

  it("refuses jq in a Monitor command, and lets the Monitor's own watch loop through", async () => {
    const monitor = ({ command }: { command: string }): string =>
      JSON.stringify({ session_id: "s1", tool_input: { command }, tool_name: "Monitor" });
    const refused = await judge({ payload: monitor({ command: "jq . tick.json" }) });
    const looped = await judge({ payload: monitor({ command: "until test -f done; do sleep 5; done" }) });

    expect(refused.code).toBe(2);
    expect(refused.errors.join("")).toContain("jq, which is banned");
    expect(looped).toEqual({ code: 0, errors: [] });
  });

  it("is opened by the ambient hatch", async () => {
    const env = { SLOPWEAVER_ALLOW_BASH: "1" };
    expect(await judge({ env, payload: bashPayload({ command: "a; b; c" }) })).toEqual({ code: 0, errors: [] });
  });

  it("fails open on a malformed payload, another tool, and a missing command", async () => {
    const payloads = [
      "not json",
      JSON.stringify({ tool_input: { command: "jq . a.json" }, tool_name: "Read" }),
      JSON.stringify({ tool_input: {}, tool_name: "Bash" }),
      JSON.stringify({ tool_input: { ws: { url: "wss://x" } }, tool_name: "Monitor" }),
    ];
    const results = await Promise.all(payloads.map((payload) => judge({ payload })));

    expect(results).toEqual(payloads.map(() => ({ code: 0, errors: [] })));
  });
});
