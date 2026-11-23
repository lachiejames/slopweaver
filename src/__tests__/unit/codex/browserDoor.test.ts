/**
 * The browser door on every Codex thread launch (`codex/browserDoor.ts`): every arm of the decision over a
 * plain probe result, and the hatch read through the injected environment — no `codex` process is started.
 */
import { describe, expect, it } from "vitest";

import {
  applyCodexBrowserDoor,
  type CodexBrowserDoorDecision,
  codexBrowserDoorDecision,
} from "../../../codex/browserDoor.js";
import type { CodexCli } from "../../../codex/vendoredCli.js";
import { err, ok, type Result } from "../../../lib/result.js";

const HOME = "/state/plan-six/.codex";
const VENDORED: CodexCli = { path: "/vendor/bin/codex", pathDirs: ["/vendor/codex-path"] };
const ON_PATH: CodexCli = { path: "codex", pathDirs: [] };

type Refusal = Extract<CodexBrowserDoorDecision, { kind: "refuse" }>;

describe("codexBrowserDoorDecision", () => {
  it("proceeds silently when no browser-capable server survives the overrides", () => {
    expect(
      codexBrowserDoorDecision({ codexHome: HOME, hatchOpen: false, launch: "cmux spawn", probe: ok([]) }),
    ).toEqual({
      kind: "proceed",
      notice: undefined,
    });
  });

  it("refuses a seat whose home still starts one, in the four-line shape naming the server and the fix", () => {
    const decision = codexBrowserDoorDecision({
      codexHome: HOME,
      hatchOpen: false,
      launch: "cmux spawn",
      probe: ok(["shiny_new_agent"]),
    });

    expect(decision.kind).toBe("refuse");
    const lines = (decision as Refusal).refusal.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("a Codex thread launch (a visible seat, or a codex plan/review pass) blocked because");
    expect(lines[0]).toContain(`shiny_new_agent on ${HOME}`);
    expect(lines[0]).toContain("codex/browserSurface.ts");
    expect(lines[2]).toContain("SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR=1");
  });

  // An unread list is not a safe one: the launch loads the same configuration the listing failed on.
  it("refuses an unreadable listing rather than treating it as clean", () => {
    const decision = codexBrowserDoorDecision({
      codexHome: undefined,
      hatchOpen: false,
      launch: "codex pass",
      probe: err(["codex mcp list could not run: spawnSync codex ENOENT"]),
    });

    expect(decision.kind).toBe("refuse");
    expect((decision as Refusal).refusal).toContain(
      "the MCP servers a Codex on the ambient Codex home would start could not be read (codex mcp list could not run: spawnSync codex ENOENT)",
    );
  });

  it("proceeds past a finding when the hatch is open, and says what it let through", () => {
    const decision = codexBrowserDoorDecision({
      codexHome: HOME,
      hatchOpen: true,
      launch: "codex pass",
      probe: ok(["shiny_new_agent"]),
    });

    expect(decision).toEqual({
      kind: "proceed",
      notice:
        "codex pass: Codex browser door OVERRIDDEN by SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR=1 — " +
        `shiny_new_agent on ${HOME}; add its plugin or server to codex/browserSurface.ts so every launch switches it off`,
    });
  });
});

describe("applyCodexBrowserDoor", () => {
  // The binary is the launch's own: a pass door that asked PATH's codex about a thread the vendored one
  // starts judged a list that launch never loads (Codex review r2).
  // The directory too: a trusted project layers its own .codex/config.toml from the launch's cwd (r3).
  it("probes the home, the directory and the binary it was given, the ambient home included", () => {
    const asked: { codexHome: string | undefined; cwd: string; cli: CodexCli }[] = [];
    const probe = (args: { codexHome: string | undefined; cwd: string; cli: CodexCli }): Result<readonly string[]> => {
      asked.push(args);
      return ok([]);
    };
    applyCodexBrowserDoor({
      codexHome: HOME,
      cwd: "/scratch/pass-1",
      env: {},
      cli: VENDORED,
      launch: "codex pass",
      probe,
    });
    applyCodexBrowserDoor({
      codexHome: undefined,
      cwd: "/repo",
      env: {},
      cli: ON_PATH,
      launch: "cmux spawn",
      probe,
    });

    expect(asked).toEqual([
      { cli: VENDORED, codexHome: HOME, cwd: "/scratch/pass-1" },
      { cli: ON_PATH, codexHome: undefined, cwd: "/repo" },
    ]);
  });

  it("reads the hatch from the environment it is handed, and only the value 1 opens it", () => {
    const decide = (env: NodeJS.ProcessEnv): string =>
      applyCodexBrowserDoor({
        codexHome: HOME,
        cwd: "/repo",
        env,
        cli: ON_PATH,
        launch: "cmux spawn",
        probe: () => ok(["cua_repl"]),
      }).kind;

    expect(decide({ SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR: "1" })).toBe("proceed");
    expect(decide({ SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR: "true" })).toBe("refuse");
    expect(decide({})).toBe("refuse");
  });
});
