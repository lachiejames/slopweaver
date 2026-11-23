/**
 * The developer-health probes — the zsh profile and the Datadog agent. The owner named them as this
 * organisation's ENVIRONMENT HEALTH, never as Slopweaver requirements: nothing in Slopweaver needs the agent.
 * So their scope is `dev-environment` and neither can be fatal. Docker is not here because it is a
 * requirement for anyone who installs Slopweaver — the local store is `supabase start` — so its probe is
 * `./runtimeProbes.ts`'s.
 */
import { DEEP_FLAG, type EnvironmentFacts, type EnvironmentProbe, okProbe, uncheckedProbe } from "./facts.js";

/**
 * The zsh profile: does an interactive shell start cleanly? `--deep` only, because checking runs the profile.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function zshProfileProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "zsh-profile";
  const scope = "dev-environment";
  if (facts.deep === null) {
    return uncheckedProbe({
      id,
      says: `an interactive zsh's startup was not checked (\`doctor ${DEEP_FLAG}\` starts one)`,
      scope,
    });
  }
  const startup = facts.deep.zshStartup;
  if (startup === "no-zsh") {
    return okProbe({ id, says: "no zsh on PATH, so there is no zsh profile to check", scope });
  }
  if (startup === "unreadable") {
    const says = "an interactive zsh started but its startup could not be read to the end (run `zsh -i -c exit`)";
    return uncheckedProbe({ id, says, scope });
  }
  if (startup.timedOut) {
    return {
      fix: "time your profile with `zsh -i -c exit` and remove what is slow, at startup or in an EXIT trap",
      id,
      says: "an interactive zsh did not start and exit within the time limit",
      scope,
      verdict: "warning",
      withoutFix: "every new terminal and every agent shell pays the same wait",
    };
  }
  if (startup.zshReportedError) {
    let detail = "the error is in a file it sources or evals (run `zsh -i -c exit` to see where)";
    if (startup.errorAt !== null) {
      detail = `the error is at ${startup.errorAt}`;
    }
    return {
      fix: "open the file named (or ~/.zshrc and what it sources) at the failing line, and fix or remove it",
      id,
      says: `your zsh profile reports an error on startup — ${detail}`,
      scope,
      verdict: "warning",
      withoutFix:
        "the lines after the broken one may never run — a PATH entry or an export you rely on can be silently missing",
    };
  }
  return okProbe({ id, says: "an interactive zsh starts cleanly", scope });
}

/**
 * The Datadog agent: present as an install directory, an app bundle or a binary on `PATH`.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function datadogAgentProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "datadog-agent";
  const scope = "dev-environment";
  if (facts.datadogAgent || facts.onPath["datadog-agent"] !== null) {
    return okProbe({ id, says: "the Datadog agent is installed (Slopweaver does not need it)", scope });
  }
  return {
    fix: "install the Datadog agent the way this organisation's onboarding describes",
    id,
    says: "the Datadog agent is not installed",
    scope,
    verdict: "warning",
    withoutFix: "nothing in Slopweaver changes — Slopweaver's Datadog verbs call the API with keys, not the agent",
  };
}
