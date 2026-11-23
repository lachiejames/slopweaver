/**
 * The shapes the environment probes share: what `./gather.ts` finds, and what a graded probe says about it.
 * Types and two constants only, so every probe module and every renderer reads one definition.
 */
import type { DanglingLink } from "#lib/executableOnPath.js";

/** Whether a miss stops Slopweaver, degrades it, or is a developer-health note it does not depend on. */
export type ProbeVerdict = "ok" | "warning" | "fatal" | "unchecked";

/** Whose requirement a probe is: Slopweaver's own, or this organisation's developer environment. */
export type ProbeScope = "slopweaver" | "dev-environment";

/** One graded probe, in words a person who has never read this code can act on. */
export interface EnvironmentProbe {
  /** Stable identifier a caller (onboarding) branches on. */
  readonly id: string;
  readonly scope: ProbeScope;
  readonly verdict: ProbeVerdict;
  /** What is true, in plain words. */
  readonly says: string;
  /** The recommended fix, or `null` when there is nothing to fix. */
  readonly fix: string | null;
  /** What continuing WITHOUT the fix costs — the override onboarding offers — or `null` when nothing is lost. */
  readonly withoutFix: string | null;
}

/** The binaries a probe resolves on `PATH`, each by the name a call site spawns it by. */
export const PROBED_BINARIES = [
  "bash",
  "claude",
  "cmux",
  "codex",
  "corepack",
  "datadog-agent",
  "docker",
  "gh",
  "git",
  "node",
  "slopweaver",
  "yarn",
] as const;

/** One name from {@link PROBED_BINARIES}. */
export type ProbedBinary = (typeof PROBED_BINARIES)[number];

/** A Node version manager, recognised by the path it installs Node under. */
export type NodeManager = "proto" | "nvm" | "volta" | "fnm" | "asdf" | "mise" | "homebrew";

/** What the costed probes found — only present when the caller asked for them (`doctor --deep`). */
export interface DeepFacts {
  /** `gh auth token`'s outcome; `no-gh` when there was no `gh` to ask. */
  readonly ghAuth: "ok" | "failed" | "no-gh";
  /** Whether the cmux control socket answered a knock, and if not, what was heard. */
  readonly cmuxSocket: { readonly answered: true } | { readonly answered: false; readonly detail: string };
  /**
   * An interactive zsh's startup: `no-zsh` when there is none, `unreadable` when the spawn itself failed,
   * otherwise whether it timed out, whether zsh itself reported an error, and the `file:line` it named when
   * that is a startup file. Never the stderr text, and never the exit status — the profile chooses that.
   */
  readonly zshStartup:
    | "no-zsh"
    | "unreadable"
    | {
        readonly timedOut: boolean;
        readonly zshReportedError: boolean;
        readonly errorAt: string | null;
      };
}

/** Everything the probes grade, gathered by `./gather.ts` and injected so no probe touches the disk. */
export interface EnvironmentFacts {
  /** Each probed binary's resolved path on `PATH`, or `null` when no entry holds an executable file. */
  readonly onPath: Readonly<Record<ProbedBinary, string | null>>;
  /** A `slopweaver` symlink on `PATH` whose target does not resolve, when there is one. */
  readonly danglingSlopweaver: DanglingLink | null;
  /** The `~/.local/bin/slopweaver` link the plugin's PATH shim installs, when it is executable there. */
  readonly localBinSlopweaver: string | null;
  /** The Node actually running this process. */
  readonly runningNode: { readonly version: string; readonly execPath: string };
  /** A `corepack` shipped beside the running Node but absent from `PATH` — the proto-shims-only case. */
  readonly corepackBesideNode: string | null;
  /**
   * The pins this checkout declares: `package.json`'s `engines.node` floor, `.nvmrc`'s exact Node version, and
   * the exact Supabase CLI version in `dependencies.supabase`.
   */
  readonly pins: {
    readonly engineFloor: string | null;
    readonly nvmrc: string | null;
    readonly supabaseCli: string | null;
  };
  /**
   * The version of `node_modules/supabase` in this checkout — what `yarn store:*` runs — or `null` when it is
   * absent or this platform's `@supabase/cli-*` binary package is missing, not executable, or another version.
   */
  readonly installedSupabaseCli: string | null;
  /**
   * The `supabase` that `PATH` resolves to when it is NOT this checkout's own install — judged by the
   * resolved path, so `node_modules/.bin` first on `PATH` is not reported as a second install — else `null`.
   */
  readonly ambientSupabase: string | null;
  /** The manager that serves `PATH`'s `node`, by the path it resolves to; `null` when none is recognised. */
  readonly nodeManager: NodeManager | null;
  /** Every manager with a directory on `PATH`, in `PATH` order. */
  readonly managersOnPath: readonly NodeManager[];
  /**
   * The token tier a GitHub verb reads AHEAD of `gh` (environment, then the stored file), so `gh` not answering
   * costs nothing; `null` when neither is present.
   */
  readonly githubFallback: "env" | "secrets-file" | null;
  /** Whether `~/.zshrc` defines a `slopweaver` shell function. */
  readonly zshrcDefinesSlopweaver: boolean;
  /** Docker Desktop's app bundle. */
  readonly dockerApp: boolean;
  /** The Datadog agent's install directory or app bundle. */
  readonly datadogAgent: boolean;
  /** The costed probes' findings, or `null` when they were not run. */
  readonly deep: DeepFacts | null;
}

/** The flag that runs the costed probes, named in every `unchecked` line. */
export const DEEP_FLAG = "--deep";

/**
 * A probe with nothing to fix.
 *
 * @param id the probe's stable identifier
 * @param scope whose requirement it is
 * @param says what is true, in plain words
 * @returns the graded `ok` probe
 */
export function okProbe({ id, scope, says }: { id: string; scope: ProbeScope; says: string }): EnvironmentProbe {
  return { fix: null, id, says, scope, verdict: "ok", withoutFix: null };
}

/**
 * A probe whose evidence was not gathered — never graded on silence.
 *
 * @param id the probe's stable identifier
 * @param scope whose requirement it is
 * @param says what is true, and what would gather the rest
 * @returns the graded `unchecked` probe
 */
export function uncheckedProbe({ id, scope, says }: { id: string; scope: ProbeScope; says: string }): EnvironmentProbe {
  return { fix: null, id, says, scope, verdict: "unchecked", withoutFix: null };
}
