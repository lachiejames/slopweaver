/**
 * {@link reseatLine} — the exact text `cmux reseat` types into a surface, asserted byte for byte, and the
 * no-headless gate's recognition of the module that returns it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NX_DAEMON_OFF_PREFIX } from "../../../cmux/fleetEnv.js";
import { type ReseatLineInput, reseatLine } from "../../../cmux/reseatLine.js";
import { scanNoHeadless } from "../../../devLint/noHeadless.js";

const SESSION = "a0000049-0000-4000-8000-000000000052";

/** A relaunch carrying nothing optional, so each case names only what it is about. */
const BARE: ReseatLineInput = {
  effort: undefined,
  envPrefix: "",
  launch: { kind: "resume", sessionId: SESSION },
  model: "opus",
  pluginDir: undefined,
  storeDir: undefined,
  templateSuffix: "",
  tokenPath: undefined,
};

describe("reseatLine", () => {
  it("resumes the session id last, on the model it names", () => {
    expect(reseatLine({ input: BARE })).toBe(`claude --model opus --resume ${SESSION}`);
  });

  it("boots on the plan's token over fd 3 against the seat's unbound store, in a fleet worktree", () => {
    const line = reseatLine({
      input: {
        ...BARE,
        effort: "high",
        envPrefix: NX_DAEMON_OFF_PREFIX,
        pluginDir: "/wt/seat",
        storeDir: "/home/claude-accounts/unbound/seat",
        tokenPath: "/home/claude-accounts/plan-one/setup-token",
      },
    });

    expect(line).toBe(
      "NX_DAEMON=false CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 " +
        "CLAUDE_SECURESTORAGE_CONFIG_DIR=/home/claude-accounts/unbound/seat " +
        "3</home/claude-accounts/plan-one/setup-token " +
        `claude --plugin-dir /wt/seat --model opus --effort high --resume ${SESSION}`,
    );
  });

  it("quotes a model alias zsh would glob, and a plugin dir with a space", () => {
    const line = reseatLine({ input: { ...BARE, model: "opus[1m]", pluginDir: "/wt/a seat" } });

    expect(line).toBe(`claude --plugin-dir '/wt/a seat' --model 'opus[1m]' --resume ${SESSION}`);
  });

  it("puts the launch template's settings before --resume", () => {
    const line = reseatLine({ input: { ...BARE, templateSuffix: " --settings '{}'" } });

    expect(line).toBe(`claude --model opus --settings '{}' --resume ${SESSION}`);
  });

  it("launches FRESH with no --resume at all when the session has no transcript to resume", () => {
    const line = reseatLine({ input: { ...BARE, launch: { kind: "fresh" }, templateSuffix: " --settings '{}'" } });

    expect(line).toBe("claude --model opus --settings '{}'");
  });
});

describe("the no-headless gate over reseatLine.ts", () => {
  it("recognises the returned relaunch line as a visible launch", () => {
    const path = join("src", "cmux", "reseatLine.ts");
    const content = readFileSync(join(import.meta.dirname, "..", "..", "..", "cmux", "reseatLine.ts"), "utf8");

    expect(scanNoHeadless({ content, path })).toEqual([]);
  });

  it("still refuses the same line once it is no longer exactly the recognised shape", () => {
    const content = "function f() {\n  return `${storePrefix}claude -p ${prompt} --resume ${sessionId}`;\n}\n";

    expect(scanNoHeadless({ content, path: "src/x.ts" }).map((finding) => finding.kind)).toEqual(["NH007"]);
  });
});
