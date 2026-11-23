/**
 * The tool probes — `slopweaver` itself, `gh`, cmux and the two agent hosts: what Slopweaver degrades without
 * rather than stops. Every miss here is a WARNING, and each one names what keeps working.
 */
import { DEEP_FLAG, type EnvironmentFacts, type EnvironmentProbe, okProbe, uncheckedProbe } from "./facts.js";

/**
 * `slopweaver` on PATH resolving to a RUNNABLE file — the check that would have caught the dangling shim.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function slopweaverProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "slopweaver";
  const scope = "slopweaver";
  if (facts.onPath.slopweaver !== null) {
    return okProbe({ id, says: `\`slopweaver\` resolves to ${facts.onPath.slopweaver}`, scope });
  }
  const shellNote = facts.zshrcDefinesSlopweaver
    ? " Your ~/.zshrc defines a `slopweaver` function, which covers an interactive terminal only — hooks, `timeout` and spawned sessions never see a shell function."
    : "";
  const withoutFix =
    "every skill and hint that says `slopweaver <verb>` fails outside a shell that defines it; the plugin's own hooks still work, because they use an absolute path";
  if (facts.danglingSlopweaver !== null) {
    return {
      fix: `restart the agent session so the plugin reinstalls the link, or point it at your checkout: \`ln -sf <checkout>/bin/slopweaver ${facts.danglingSlopweaver.link}\``,
      id,
      says: `${facts.danglingSlopweaver.link} is a broken link — it points at ${facts.danglingSlopweaver.target}, which is not there.${shellNote}`,
      scope,
      verdict: "warning",
      withoutFix,
    };
  }
  if (facts.localBinSlopweaver !== null) {
    return {
      fix: 'add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile and open a new terminal',
      id,
      says: `the plugin installed ${facts.localBinSlopweaver}, but ~/.local/bin is not on PATH.${shellNote}`,
      scope,
      verdict: "warning",
      withoutFix,
    };
  }
  return {
    fix: "start an agent session with the plugin loaded (it installs ~/.local/bin/slopweaver), and make sure ~/.local/bin is on PATH",
    id,
    says: `\`slopweaver\` is not on PATH.${shellNote}`,
    scope,
    verdict: "warning",
    withoutFix,
  };
}

/** Which GitHub fallback is ready, in words. */
function fallbackWords({ facts }: { facts: EnvironmentFacts }): string {
  if (facts.githubFallback === "env") {
    return "GITHUB_TOKEN/GH_TOKEN is set, so GitHub verbs authenticate without it";
  }
  if (facts.githubFallback === "secrets-file") {
    return "$SLOPWEAVER_HOME/secrets/github-token is present, so GitHub verbs authenticate without it";
  }
  return "neither fallback is set — GITHUB_TOKEN/GH_TOKEN in the environment, or `slopweaver secrets set github-token`";
}

/**
 * `gh` and a working `gh auth token`: a WARNING naming the two documented fallbacks.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function githubProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "gh";
  const scope = "slopweaver";
  const fallbackReady = facts.githubFallback !== null;
  const withoutFix = "GitHub reads are unauthenticated: public repositories only, at a much lower rate limit";
  const gh = facts.onPath.gh;
  if (gh === null) {
    const says = `\`gh\` is not on PATH; ${fallbackWords({ facts })}`;
    if (fallbackReady) {
      return okProbe({ id, says, scope });
    }
    const fix = "install the GitHub CLI (`brew install gh`) and `gh auth login`";
    return { fix, id, says, scope, verdict: "warning", withoutFix };
  }
  if (facts.githubFallback === "env") {
    return okProbe({ id, says: `gh at ${gh}; ${fallbackWords({ facts })} (an environment token wins over gh)`, scope });
  }
  if (facts.deep === null) {
    const says = `gh at ${gh}; its login was not checked (\`doctor ${DEEP_FLAG}\` runs \`gh auth token\`)`;
    return uncheckedProbe({ id, says, scope });
  }
  if (facts.deep.ghAuth === "ok") {
    return okProbe({ id, says: `gh at ${gh}, logged in`, scope });
  }
  if (fallbackReady) {
    return okProbe({ id, says: `gh at ${gh} is not logged in; ${fallbackWords({ facts })}`, scope });
  }
  const says = `gh at ${gh} is not logged in, and ${fallbackWords({ facts })}`;
  return { fix: "`gh auth login`", id, says, scope, verdict: "warning", withoutFix };
}

/**
 * `cmux` and its control socket: a WARNING — supervision is unavailable, the CLI is not.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function cmuxProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "cmux";
  const scope = "slopweaver";
  const withoutFix =
    "the supervisor, `cmux spawn` and the sidebar are unavailable; ask, refresh, the connectors and every other verb work without it";
  const cmux = facts.onPath.cmux;
  if (cmux === null) {
    const fix = "install cmux (https://cmux.dev) and open it";
    return { fix, id, says: "`cmux` is not on PATH", scope, verdict: "warning", withoutFix };
  }
  if (facts.deep === null) {
    const says = `cmux at ${cmux}; its control socket was not checked (\`doctor ${DEEP_FLAG}\` connects to it)`;
    return uncheckedProbe({ id, says, scope });
  }
  if (facts.deep.cmuxSocket.answered) {
    return okProbe({ id, says: `cmux at ${cmux}, and its control socket answered`, scope });
  }
  return {
    fix: "open the cmux app; if it is open, quit and reopen it",
    id,
    says: `cmux at ${cmux}, but its control socket did not answer (${facts.deep.cmuxSocket.detail})`,
    scope,
    verdict: "warning",
    withoutFix,
  };
}

/**
 * `claude` or `codex`: the agent hosts. A WARNING each — either can stand in for the other.
 *
 * @param facts what `./gather.ts` found
 * @param name which host
 * @returns the graded probe
 */
export function hostProbe({ facts, name }: { facts: EnvironmentFacts; name: "claude" | "codex" }): EnvironmentProbe {
  const found = facts.onPath[name];
  if (found !== null) {
    return okProbe({ id: name, says: `${name} at ${found}`, scope: "slopweaver" });
  }
  const isClaude = name === "claude";
  return {
    fix: isClaude
      ? "install Claude Code (https://claude.com/claude-code); its installer puts `claude` in ~/.local/bin"
      : "install the Codex CLI (`npm install -g @openai/codex`) and `codex login`",
    id: name,
    says: `\`${name}\` is not on PATH`,
    scope: "slopweaver",
    verdict: "warning",
    withoutFix: isClaude
      ? "no Claude Code session can be spawned or supervised; Codex can stand in as the host"
      : "Codex planning and review passes fall back to a visible Claude session (`codex plan-fallback`)",
  };
}
