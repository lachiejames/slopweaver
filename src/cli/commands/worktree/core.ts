/**
 * The `worktree` noun's flag specs, usage strings and shared resolution.
 *
 * The specs are exported so the help-truth ratchet compares the manifest's literal usage lines against the
 * REAL parser rather than against a copy of them — see `cmux/core.ts` for the sibling this mirrors.
 *
 * `--install`/`--no-install`, `--build`/`--no-build` and `--dev-build`/`--no-dev-build` are declared as six
 * independent switches rather than as three negatable flags, because `parseFlags` is built on `node:util`'s
 * `parseArgs` and that has no negation. Passing both halves of a pair is a usage error rather than a
 * last-one-wins race: the two spell opposite intentions, and silently picking one is how a `--no-install` in
 * a script stops meaning anything.
 *
 * `--build` is the repository's tsc script and stays OFF by default. `--dev-build` is the built CLI
 * (`dist-cli`) and is ON by default — two different artifacts, which is why they are two different pairs;
 * `worktree/devBuild.ts` carries the measurement.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type SessionItem, sessionName } from "../../../sessions/session.js";
import { DEFAULT_DEPS_MODE, type DepsMode } from "../../../worktree/deps.js";
import { worktreePathKey } from "../../../worktree/location.js";
import { mainCheckoutRoot } from "../../../worktree/shell.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/**
 * Flags each verb accepts.
 *
 * `--repo` names the main checkout to act on and defaults to the repository the caller is standing in, so a
 * session inside a worktree addresses its own repository without saying so. `--base` is the ref a brand-new
 * branch forks from on `create`, and the ref drift is measured against on `status` — the same word for the
 * same relationship, deliberately.
 */
const SPECS: Readonly<Record<string, FlagSpec>> = {
  create: {
    boolean: ["build", "dev-build", "install", "json", "no-build", "no-dev-build", "no-install"],
    string: ["base", "branch", "deps", "repo"],
  },
  list: { boolean: ["json"], string: ["repo"] },
  "mirror-prune": { boolean: ["apply", "json"], string: ["budget"] },
  remove: { boolean: ["force", "json"], string: ["repo"] },
  prune: {
    boolean: ["apply", "if-idle", "json", "merged-only", "no-salvage"],
    string: ["budget", "nuke-after", "older-than", "repo", "scan-budget"],
  },
  status: { boolean: ["json"], string: ["base", "repo"] },
  here: { boolean: ["json"], string: [] },
  noindex: { boolean: ["json"], string: ["repo"] },
  unshare: { boolean: ["all", "json", "report"], string: ["repo"] },
};

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const WORKTREE_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [
    verb,
    [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted(),
  ]),
);

/** The flags that take a value, so a usage line renders `[--x <value>]` for exactly those. */
const WITH_VALUE: ReadonlySet<string> = new Set([
  "--base",
  "--branch",
  "--budget",
  "--deps",
  "--nuke-after",
  "--older-than",
  "--repo",
  "--scan-budget",
]);

/** What each verb's positional tail is called in its usage line. */
const POSITIONALS: Readonly<Record<string, string>> = {
  create: "<slug>",
  remove: "<slug>",
  status: "<slug>",
};

/** A verb's declared flag names; a verb with no spec entry declares none, so its usage line names none. */
function declaredFlagNames({ verb }: { verb: string }): readonly string[] {
  const names = WORKTREE_FLAG_NAMES[verb];
  if (names === undefined) {
    return [];
  }
  return names;
}

/** The spec a verb parses with; a verb with no entry accepts no flags, so any flag it is given is refused. */
function verbSpec({ verb }: { verb: string }): FlagSpec {
  const spec = SPECS[verb];
  if (spec === undefined) {
    return { string: [] };
  }
  return spec;
}

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function worktreeUsage({ verb }: { verb: string }): string {
  const rendered = declaredFlagNames({ verb })
    .map((flag) => (WITH_VALUE.has(flag) ? `[${flag} <value>]` : `[${flag}]`))
    .join(" ");
  const tail = POSITIONALS[verb];
  const parts = ["usage: slopweaver worktree", verb, ...(tail === undefined ? [] : [tail]), rendered];
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

/**
 * Parse one worktree verb's flags.
 *
 * @param verb which verb's spec to use
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseWorktreeArgs({
  verb,
  rest,
}: {
  verb: string;
  rest: readonly string[];
}): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: verbSpec({ verb }) });
}

/**
 * One declared string flag, or `undefined`.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns the value, or `undefined` when the flag was not passed
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The main checkout a verb acts on: `--repo` as given, or — not given — the one `cwd` sits inside.
 *
 * @param parsed the verb's parsed flags, whose `--repo` names the main checkout outright
 * @param cwd the directory the main checkout is looked up from when no `--repo` was given
 * @returns the main checkout's root, or `undefined` when no `--repo` was given and `cwd` is in no git repository
 */
export function targetRepoRoot({ parsed, cwd }: { parsed: ParsedFlags; cwd: string }): string | undefined {
  const given = stringFlag({ name: "repo", parsed });
  if (given !== undefined) {
    return given;
  }
  return mainCheckoutRoot({ cwd });
}

/**
 * Resolve one `--x`/`--no-x` switch pair into a single decision.
 *
 * Pure, and the whole point is the third arm: a caller that passed BOTH halves gets an error rather than a
 * silent winner. `parseArgs` gives no ordering a tie-break could honestly use, so there is no correct
 * last-one-wins to implement.
 *
 * @param parsed the verb's parsed flags
 * @param name the positive switch's name, without the leading `--`
 * @param fallback what the flag means when neither half was passed
 * @returns the decision, or the error text when both halves were passed
 */
export function switchPair({
  parsed,
  name,
  fallback,
}: {
  parsed: ParsedFlags;
  name: string;
  fallback: boolean;
}): Result<boolean> {
  const on = parsed.values[name] === true;
  const off = parsed.values[`no-${name}`] === true;
  if (on && off) {
    return err([`--${name} and --no-${name} contradict each other — pass one`]);
  }
  let decision: boolean;
  if (on) {
    decision = true;
  } else if (off) {
    decision = false;
  } else {
    decision = fallback;
  }
  return ok(decision);
}

/**
 * Resolve `--deps own|shared`.
 *
 * @param parsed the verb's parsed flags
 * @returns the mode, or the error text when the value names neither
 */
export function depsMode({ parsed }: { parsed: ParsedFlags }): Result<DepsMode> {
  const raw = stringFlag({ name: "deps", parsed });
  if (raw === undefined) {
    return ok(DEFAULT_DEPS_MODE);
  }
  return raw === "own" || raw === "shared"
    ? ok(raw)
    : err([`--deps must be \`own\` or \`shared\`, got ${JSON.stringify(raw)}`]);
}

/**
 * Index every live reference to a worktree path, from the three registers that hold one by path: the session
 * ledger, the live workspace list, and every live process's working directory.
 *
 * Every key goes through `worktreePathKey`, because git registers the physical path while a session records
 * the directory it was launched in — on this machine those differ by `/private` on every temp path and by
 * the `worktrees` → `worktrees.noindex` alias on every repository, and a missed match here is a deleted live
 * workspace. A process is indexed by the cwd it stands in, so a background agent or a shell working in a
 * tree holds it whatever the ledger says.
 *
 * Pure: the caller does the reading, so the join that decides what `prune` protects is testable against
 * literal rows rather than against whatever happens to be running.
 *
 * @param sessions every session the ledger knows, folded
 * @param workspaces every live workspace, or an empty list when none were readable
 * @param cwds every live process's working directory by pid, or an empty map when none was readable
 * @returns resolved path to the human-readable references holding it
 */
export function liveReferenceIndex({
  sessions,
  workspaces,
  cwds,
}: {
  sessions: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
  cwds: ReadonlyMap<number, string>;
}): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  const add = ({ path, label }: { path: string | undefined; label: string }): void => {
    if (path === undefined || path.length === 0) {
      return;
    }
    const key = worktreePathKey({ path });
    const labels = index.get(key);
    if (labels === undefined) {
      index.set(key, [label]);
      return;
    }
    labels.push(label);
  };
  for (const session of sessions.filter((item) => item.status === "open")) {
    add({ label: `open session ${sessionName({ session })}`, path: session.cwd });
  }
  for (const workspace of workspaces) {
    add({ label: `live workspace ${workspace.workspaceRef}`, path: workspace.currentDirectory });
  }
  // One label per directory: a session's shell, its agent and their children share one cwd, and a label per pid
  // repeated the same path a dozen times in a single reason.
  const pidsByCwd = new Map<string, number[]>();
  for (const [pid, cwd] of cwds) {
    const pids = pidsByCwd.get(cwd);
    if (pids === undefined) {
      pidsByCwd.set(cwd, [pid]);
    } else {
      pids.push(pid);
    }
  }
  for (const [cwd, pids] of pidsByCwd) {
    const noun = pids.length === 1 ? "live process" : "live processes";
    add({ label: `${noun} ${pids.join(", ")} (cwd ${cwd})`, path: cwd });
  }
  return index;
}
