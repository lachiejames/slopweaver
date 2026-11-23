/**
 * The environment probes — can this machine run Slopweaver at all, and what about it is unhealthy — as a
 * PURE grading of facts someone else gathered (`./gather.ts`).
 *
 * `doctor` is the verb that runs them and onboarding's first step is one of its callers (portability is less of a
 * concern when onboarding guides the user to a correct environment). The list is derived from the portability research's inventory of every
 * binary the code, hooks and launcher shell out to (`~/.slopweaver/portability-research.md` § Part 1b), plus
 * the five the owner named.
 *
 * Every probe carries three sentences a person can act on: what is true (`says`), the recommended fix
 * (`fix`), and what continuing WITHOUT the fix costs (`withoutFix`) — because onboarding offers an override at
 * every one and never stops on a red probe. Two rules the old `doctor` broke shape the verdicts:
 *
 * - **A fatal miss is one the machine cannot run Slopweaver past**, and `doctor` exits non-zero on one
 *   (`./runtimeProbes.ts`). What degrades rather than stops is a warning (`./toolProbes.ts`).
 * - **Never a false miss.** A probe whose evidence was not gathered says `unchecked` and names the flag that
 *   gathers it; it is never graded on silence.
 *
 * And one scoping rule: the zsh profile and the Datadog agent are developer ENVIRONMENT HEALTH at this
 * organisation, never Slopweaver requirements (`./healthProbes.ts`), so neither can be fatal. Docker is a
 * requirement — the local store runs in it — so its probe sits with the runtime ones. The pinned Supabase CLI
 * is Slopweaver's too (`./storeProbes.ts`), but a warning: `yarn install` restores it.
 *
 * Deliberately NOT probed, each from § Part 1b: `osascript`/`screencapture` (optional proof capture),
 * `python3` (not in this repository), `rsync` (the mirror already falls back to `cp -R`), `mkfifo` (tests
 * only), and every network endpoint (reaching one costs a round trip; the verbs that need one say so).
 */
import type { EnvironmentFacts, EnvironmentProbe } from "./facts.js";
import { datadogAgentProbe, zshProfileProbe } from "./healthProbes.js";
import { dockerProbe, nodeManagerProbe, nodeProbe, requiredBinaryProbe, yarnProbe } from "./runtimeProbes.js";
import { supabaseCliProbe } from "./storeProbes.js";
import { cmuxProbe, githubProbe, hostProbe, slopweaverProbe } from "./toolProbes.js";

/**
 * Grade every environment probe, in the order a person should fix them: what stops Slopweaver first, what
 * degrades it next, developer health last.
 *
 * @param facts what `./gather.ts` found on this machine
 * @returns one probe per check, never omitting one — an omitted probe and a passing one look identical
 */
export function environmentProbes({ facts }: { facts: EnvironmentFacts }): readonly EnvironmentProbe[] {
  return [
    nodeProbe({ facts }),
    yarnProbe({ facts }),
    requiredBinaryProbe({
      facts,
      fix: "`xcode-select --install` (macOS ships git with the command-line tools)",
      name: "git",
      withoutFix: "almost nothing works — repository resolution, every hook and every GitHub write run git",
    }),
    requiredBinaryProbe({
      facts,
      fix: "put /bin back on PATH (macOS ships bash there)",
      name: "bash",
      withoutFix: "no hook or install script can run; every one is a bash script",
    }),
    dockerProbe({ facts }),
    nodeManagerProbe({ facts }),
    slopweaverProbe({ facts }),
    githubProbe({ facts }),
    cmuxProbe({ facts }),
    hostProbe({ facts, name: "claude" }),
    hostProbe({ facts, name: "codex" }),
    supabaseCliProbe({ facts }),
    zshProfileProbe({ facts }),
    datadogAgentProbe({ facts }),
  ];
}

/**
 * Count the probes on each verdict that matters to an exit code or a summary line.
 *
 * @param probes the graded probes
 * @returns the fatal, warning and unchecked counts
 */
export function probeTally({ probes }: { probes: readonly EnvironmentProbe[] }): {
  readonly fatal: number;
  readonly warnings: number;
  readonly unchecked: number;
} {
  return {
    fatal: probes.filter((probe) => probe.verdict === "fatal").length,
    unchecked: probes.filter((probe) => probe.verdict === "unchecked").length,
    warnings: probes.filter((probe) => probe.verdict === "warning").length,
  };
}
