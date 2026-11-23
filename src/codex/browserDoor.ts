/**
 * The browser door on every Codex this repository starts a thread in — a visible seat and a `codex plan` /
 * `codex review` pass: refuse to start one whose Codex home would still run a server that can launch a
 * browser, after every override that launch carries.
 *
 * Both launches switch the ChatGPT app's KNOWN browser and computer-use surfaces off by name
 * (`./browserSurface.ts`). The app writes `~/.codex/config.toml` itself and ships new plugins on its own
 * schedule, so a surface under a new name would start straight past that list. This is the check that sees it:
 * the home's effective server list, read with the same overrides BY THE SAME BINARY the launch runs IN THE
 * DIRECTORY it runs in (a trusted project adds its own `.codex/config.toml`), judged on what each server RUNS.
 *
 * It is wired at the two places a thread can begin: `cmux/spawn.ts`'s `openWorkspaceFor`, as a REQUIRED
 * `SpawnDeps` member, so a seat answers it in its own worktree once that exists and before a tab does; and
 * `cli/commands/codex/passDeps.ts`'s production client, whose every thread answers it at start in the working
 * directory the pass minted (`codex/client.ts`'s `admittedCodexClient`). The account read in `./accountLive.ts` is not a third: it starts no thread, and an app-server starts
 * its MCP servers only on one (that module's header carries the measurement).
 *
 * **A listing that could not be read REFUSES.** An unread list is not evidence of a safe one, and the launch
 * loads the same configuration the listing does, so a home the probe cannot read is one the launch would
 * most likely fail on too. The hatch is the way past both.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { logger } from "../lib/logger.js";
import { err, ok, type Result } from "../lib/result.js";
import { probeCodexBrowserServers } from "./browserProbe.js";
import { applyCodexElectronGuard } from "./electronGuard.js";
import type { CodexCli } from "./vendoredCli.js";

/** The override for this door, named once so the read and the notice cannot disagree. */
const ALLOW_CODEX_BROWSER_DOOR_ENV = "SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR";

/** What the door decided, and the one line to print for it, if any. */
export type CodexBrowserDoorDecision =
  | { readonly kind: "proceed"; readonly notice: string | undefined }
  | { readonly kind: "refuse"; readonly refusal: string };

/** How the home is named in what is printed: its path, or the ambient home when nothing routed one. */
function homeLabel({ codexHome }: { codexHome: string | undefined }): string {
  if (codexHome === undefined) {
    return "the ambient Codex home";
  }
  return codexHome;
}

/**
 * Decide the door from one probe result — pure, so every arm is a unit test.
 *
 * @param probe the browser-capable servers still enabled on the home, or why the listing failed
 * @param hatchOpen whether `SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR=1` was set
 * @param codexHome the home the launch runs on, named in what is printed; undefined is the ambient one
 * @param launch which launch is asking — `cmux spawn` or `codex pass` — so an override notice says where it fired
 * @returns proceed (with a notice when the hatch let a finding through), or the four-line refusal
 */
export function codexBrowserDoorDecision({
  probe,
  hatchOpen,
  codexHome,
  launch,
}: {
  probe: Result<readonly string[]>;
  hatchOpen: boolean;
  codexHome: string | undefined;
  launch: string;
}): CodexBrowserDoorDecision {
  const home = homeLabel({ codexHome });
  if (probe.isOk() && probe.value.length === 0) {
    return { kind: "proceed", notice: undefined };
  }
  const detail = probe.isErr()
    ? `the MCP servers a Codex on ${home} would start could not be read (${probe.error.join("; ")}), and an unread list is not a safe one`
    : `${probe.value.join(", ")} on ${home}; add its plugin or server to codex/browserSurface.ts so every launch switches it off`;
  if (hatchOpen) {
    return {
      kind: "proceed",
      notice: `${launch}: Codex browser door OVERRIDDEN by ${ALLOW_CODEX_BROWSER_DOOR_ENV}=1 — ${detail}`,
    };
  }
  return { kind: "refuse", refusal: hatchRefusal({ detail, hatch: hatchFor({ id: "codex-browser-door" }) }) };
}

/**
 * Probe the home and decide the door — the production half a seat and a pass both wire in.
 *
 * @param codexHome the home the launch runs on, or undefined for the ambient one
 * @param cwd the directory the launch runs in, whose trusted project config Codex layers over the home's
 * @param cli the Codex binary the launch itself runs, and its PATH directories, so the list read is the list that launch loads
 * @param launch which launch is asking, for the override notice
 * @param probe the listing seam; production runs `<cli> mcp list --json` with the overrides
 * @param env the environment the hatch is read from
 * @returns the decision
 */
export function applyCodexBrowserDoor({
  codexHome,
  cwd,
  cli,
  launch,
  probe = probeCodexBrowserServers,
  env = process.env,
}: {
  codexHome: string | undefined;
  cwd: string;
  cli: CodexCli;
  launch: string;
  probe?: (args: { codexHome: string | undefined; cwd: string; cli: CodexCli }) => Result<readonly string[]>;
  env?: NodeJS.ProcessEnv;
}): CodexBrowserDoorDecision {
  const hatchOpen = env[ALLOW_CODEX_BROWSER_DOOR_ENV] === "1";
  return codexBrowserDoorDecision({ codexHome, hatchOpen, launch, probe: probe({ cli, codexHome, cwd }) });
}

/**
 * The thread gate a pass's client carries (`codex/client.ts`'s `admittedCodexClient`): the browser door, then the
 * Electron guard (`./electronGuard.ts`), each asked in the thread's own working directory, with an override
 * notice printed where a hatch let a finding through.
 *
 * @param codexHome the home the pass spends against, or undefined for the ambient one
 * @param cli the Codex binary the SDK spawns — the same one its client is pinned to
 * @returns the gate: `ok` to start the thread, `err` carrying the first four-line refusal
 */
export function codexThreadAdmit({
  codexHome,
  cli,
}: {
  codexHome: string | undefined;
  cli: CodexCli;
}): (args: { workingDirectory: string }) => Result<void, string> {
  return ({ workingDirectory }) => {
    const door = applyCodexBrowserDoor({ cli, codexHome, cwd: workingDirectory, launch: "codex pass" });
    if (door.kind === "refuse") {
      return err(door.refusal);
    }
    if (door.notice !== undefined) {
      logger.error({ msg: door.notice });
    }
    const guard = applyCodexElectronGuard({ cli, codexHome, cwd: workingDirectory });
    if (guard.kind === "refuse") {
      return err(guard.refusal);
    }
    if (guard.notice !== undefined) {
      logger.error({ msg: guard.notice });
    }
    return ok(undefined);
  };
}
