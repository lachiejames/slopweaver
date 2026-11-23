/**
 * The reader gate's runner: the exit code it returns for one `PreToolUse` payload, and the fact that
 * each row's refusal names its replacement and its own hatch.
 *
 * Every seam is a plain injected function, never a mock: the payload is a string this test writes, and the
 * two homes are arguments.
 */
import { describe, expect, it } from "vitest";

import { runDiskScanGuard } from "../../../admit/diskScanGuardRunner.js";

/** The home directory and state home every case is judged against. */
const HOME = "/Users/someone";
const STATE_HOME = "/Users/someone/.slopweaver";

/** Run the guard over one payload, collecting whatever it wrote to stderr. */
async function judge({
  payload,
  env = {},
}: {
  payload: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly code: number; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runDiskScanGuard({
    env,
    homeDir: HOME,
    readStdin: () => Promise.resolve(payload),
    stateHome: STATE_HOME,
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

/** A `PreToolUse` payload for one Bash command. */
function bashPayload({ command, cwd }: { command: string; cwd?: string }): string {
  return JSON.stringify({ cwd, session_id: "s1", tool_input: { command }, tool_name: "Bash" });
}

/** The incident's own corpus file. */
const SLACK_BRONZE = `${STATE_HOME}/corpus/bronze/slack/compact.jsonl`;

describe("runDiskScanGuard", () => {
  it("refuses a scan from / with exit 2", async () => {
    const { code } = await judge({ payload: bashPayload({ command: "find / -name x" }) });
    expect(code).toBe(2);
  });

  it("names the root, the state home, the index alternative and the hatch in the refusal", async () => {
    const { errors } = await judge({ payload: bashPayload({ command: "find / -name x" }) });
    expect(errors.length).toBe(1);
    const refusal = errors[0]!;
    expect(refusal).toContain("find was about to walk /");
    expect(refusal).toContain(`ls ${STATE_HOME}/<first-segment-of-the-path>`);
    expect(refusal).toContain("rg --files <folder> -g '*<name>*'");
    expect(refusal).not.toContain("mdfind");
    expect(refusal).toContain("SLOPWEAVER_ALLOW_DISK_WIDE_SCAN=1");
    expect(refusal).toContain("Use good judgement");
  });

  it("allows a bounded scan and writes nothing", async () => {
    const { code, errors } = await judge({ payload: bashPayload({ command: "find src -name x" }) });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });

  it("is opened by the hatch", async () => {
    const { code, errors } = await judge({
      env: { SLOPWEAVER_ALLOW_DISK_WIDE_SCAN: "1" },
      payload: bashPayload({ command: "find / -name x" }),
    });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });

  it("refuses a corpus search, naming the file, the store verbs and its own hatch", async () => {
    const { code, errors } = await judge({
      payload: bashPayload({ command: `grep -c nonconformity ${SLACK_BRONZE}` }),
    });
    expect(code).toBe(2);
    expect(errors.length).toBe(1);
    const refusal = errors[0]!;
    expect(refusal).toContain(`grep was about to read ${SLACK_BRONZE}, inside the corpus`);
    expect(refusal).toContain("slopweaver store cite <question>");
    expect(refusal).toContain("slopweaver store read <question> --search <terms> --contains <literal>");
    expect(refusal).toContain("SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH=1");
  });

  it("refuses a recursive grep of the home with the narrower-directory replacement", async () => {
    const { code, errors } = await judge({ payload: bashPayload({ command: "grep -r password ~" }) });
    expect(code).toBe(2);
    expect(errors[0]!).toContain(`grep was about to search everything under ${HOME}`);
    expect(errors[0]!).toContain("Name the directory the text is actually in");
  });

  it("resolves a relative corpus path against the payload's cwd", async () => {
    const { code } = await judge({
      payload: bashPayload({ command: "grep -c x bronze/slack/compact.jsonl", cwd: `${STATE_HOME}/corpus` }),
    });
    expect(code).toBe(2);
  });

  it("opens the search row by its own hatch, and the scan hatch does not open it", async () => {
    const payload = bashPayload({ command: `grep -c x ${SLACK_BRONZE}` });
    expect((await judge({ env: { SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH: "1" }, payload })).code).toBe(0);
    expect((await judge({ env: { SLOPWEAVER_ALLOW_DISK_WIDE_SCAN: "1" }, payload })).code).toBe(2);
  });

  it("fails OPEN on a payload it cannot read", async () => {
    expect((await judge({ payload: "not json" })).code).toBe(0);
    expect((await judge({ payload: "[]" })).code).toBe(0);
    expect((await judge({ payload: JSON.stringify({ tool_name: "Read" }) })).code).toBe(0);
    expect((await judge({ payload: JSON.stringify({ tool_input: {}, tool_name: "Bash" }) })).code).toBe(0);
  });
});
