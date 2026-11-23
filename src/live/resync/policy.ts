/**
 * One target's whole scheduling policy: what it is, how stale it may get, when it is due, and what
 * running it actually executes.
 *
 * This is the pure join. Everything it needs already exists somewhere — an atlas's `resyncCommand` and
 * `freshnessWindow` on its descriptor, a corpus source's window in `corpus/freshnessPolicy.ts`, and the
 * repositories a github corpus resync must name in `$SLOPWEAVER_HOME/profile.json`'s declared main
 * checkouts — and nothing here invents a second copy of any of it, nor reads any of it. What it adds is the
 * derivation the definition store cannot do for itself: the cron, the recipe id, and the reviewed steps.
 *
 * ## One failure does not sink the roster
 *
 * A descriptor whose declared command cannot be resolved is reported as its own problem and every other
 * atlas still gets a policy. That is the same judgement `live/automation/definitionStore.ts` makes about a
 * malformed definition file, for the same reason: one bad row silencing a whole schedule is the failure
 * mode this work exists to end, so it must not be the failure mode of the thing that ends it.
 */
import type { CorpusSource } from "../../corpus/types.js";
import { cadenceNote, deriveResyncCadence } from "./cadence.js";
import { type ResyncStep, resolveResyncSteps } from "./steps.js";
import { type ResyncTarget, resyncRecipeId, resyncTargetLabel } from "./target.js";

/** Everything one atlas contributes, gathered by a caller that can load descriptors. */
export interface AtlasResyncInput {
  readonly platform: string;
  /** The descriptor's declared `resyncCommand`, verbatim. */
  readonly resyncCommand: string;
  /** The window already resolved through `atlas/kit/freshnessWindow.ts`. */
  readonly windowMs: number;
  /**
   * Whether a pass needs a seat of its own — false only for a compile-only atlas
   * (`atlas/kit/contract.ts#isCompileOnlyDescriptor`), whose sync walks no account, needs no model and runs
   * in seconds once cached.
   */
  readonly seated: boolean;
}

/**
 * What a corpus source's refresh must be TOLD on its command line, because a scheduled pass has no cwd it
 * may resolve one from.
 *
 * A scheduler's cwd is always a worktree under `$SLOPWEAVER_HOME`, and `config.ts`'s `cwdRepositoryRefusal`
 * refuses the state home's own `origin` as any verb's subject — correctly, for a measured incident. So
 * `refresh --source github` with nothing named cannot succeed from a scheduled pass at all, whatever the
 * machine is configured to hold. Every other fetchable source resolves its subject from a credential rather
 * than from a path, and names nothing.
 *
 * Discriminated rather than an optional string so this file stays source-agnostic: `none` is a source that
 * names nothing, `org` is one that must name an organisation. A nullable field collapses those two into the
 * same value and would force the string `"github"` into this pure join.
 *
 * Org mode pulls everything from all repos across the org, because it is all useful context: the fetch takes
 * everything reachable and puts it in the store. `refresh --all-repos` enumerates with `repos.listForOrg({ type: "all" })` and caps nothing by default.
 *
 * `export` is the third shape: a source fed by an export the owner downloads rather than by an API, whose pass is its
 * own `<source> sync` — take in a newer export if one has arrived, then run this same `refresh --store` in
 * process. A bare refresh would only ever re-read the export already held, so it could never bring the source
 * any further forward. Still seated, like every corpus row: what changes is the step, not who watches it.
 *
 * `live` is the fourth: a source the owner's own web session reads back, whose pass is its own `<source> live-sync` —
 * list the account, read whole what moved, then the same `refresh --store` in process. Once the live copy holds a chat
 * it is the pass, the export it may also hold being the backup and cross-check the owner takes in by hand.
 */
type CorpusResyncSubject =
  | { readonly kind: "none" }
  | { readonly kind: "org"; readonly org: string }
  | { readonly kind: "export" }
  | { readonly kind: "live" };

/** Everything one corpus source contributes. */
export interface CorpusResyncInput {
  readonly source: CorpusSource;
  /** The window already resolved through `corpus/freshnessPolicy.ts`. */
  readonly windowMs: number;
  /** What its refresh must name, resolved by the caller that can read the profile. */
  readonly subject: CorpusResyncSubject;
}

/** One target's resolved schedule. */
export interface ResyncPolicy {
  readonly target: ResyncTarget;
  readonly recipeId: string;
  readonly windowMs: number;
  readonly cadence: string;
  /** What running this target executes, in order. Every step routes. */
  readonly steps: readonly ResyncStep[];
  /** Why the cadence does not match the window exactly, when it does not. */
  readonly note: string | null;
  /**
   * Whether the row is SEATED (`resync`, a visible session per pass) or run in the chair's own tick
   * (`verb-run`, no seat and no model). Every corpus source and every atlas that walks a provider is seated;
   * only a compile-only atlas is not.
   */
  readonly seated: boolean;
}

/** The roster one pass built, and every target it could not build one for. */
export interface ResyncPolicyRoster {
  readonly policies: readonly ResyncPolicy[];
  readonly problems: readonly string[];
}

/**
 * Build one policy per atlas and per corpus source.
 *
 * @param atlases every registered atlas, with its declared command and resolved window
 * @param corpus every fetchable corpus source, with its resolved window
 * @returns the policies, sorted by recipe id, and one problem per target that could not get one
 */
export function buildResyncPolicies({
  atlases,
  corpus,
}: {
  readonly atlases: readonly AtlasResyncInput[];
  readonly corpus: readonly CorpusResyncInput[];
}): ResyncPolicyRoster {
  const policies: ResyncPolicy[] = [];
  const problems: string[] = [];

  for (const atlas of atlases) {
    const target: ResyncTarget = { kind: "atlas", platform: atlas.platform };
    const steps = resolveResyncSteps({ command: atlas.resyncCommand });
    if (steps.isErr()) {
      problems.push(...steps.error.map((line) => `${resyncTargetLabel({ target })}: ${line}`));
      continue;
    }
    const built = composePolicy({ seated: atlas.seated, steps: steps.value, target, windowMs: atlas.windowMs });
    if (built.problem !== null) {
      problems.push(built.problem);
      continue;
    }
    // Safe: `composePolicy` returns exactly one of the two.
    policies.push(built.policy!);
  }

  for (const source of corpus) {
    const target: ResyncTarget = { kind: "corpus", source: source.source };
    const steps = corpusSteps({ source: source.source, subject: source.subject });
    const built = composePolicy({ seated: true, steps, target, windowMs: source.windowMs });
    if (built.problem !== null) {
      problems.push(built.problem);
      continue;
    }
    // Safe: as above.
    policies.push(built.policy!);
  }

  return {
    policies: policies.toSorted((left, right) => left.recipeId.localeCompare(right.recipeId)),
    problems,
  };
}

/**
 * One corpus source's single step: a `refresh` naming an organisation or naming nothing, or an export source's
 * own `sync`.
 *
 * `--store` is what makes a step reach the STORE and not only bronze: without it the step writes a window
 * file nothing ingests, and the postcondition in `./outcome.ts` — the store's newest row — cannot move. It
 * is also half of the resync's purpose: fetch everything reachable, and put it in the store.
 *
 * `--all-repos --github-org <org>` is why this reaches the store at all from a scheduled pass.
 * `refresh/githubJobs.ts`'s `resolveGithubOrg` answers the explicit org and returns BEFORE the single-repo
 * arm's `resolveRepository()`, so org mode never consults the working directory — and a scheduled pass's
 * working directory is always a worktree under `$SLOPWEAVER_HOME`, which `config.ts`'s
 * `cwdRepositoryRefusal` refuses as any verb's subject.
 *
 * NO FILTERS, deliberately. `--include-repo`/`--exclude-repo` exist on the verb and stay reachable by hand,
 * but a scheduled pass carrying them would contradict "everything reachable", so the subject has nowhere to
 * put one.
 */
function corpusSteps({
  source,
  subject,
}: {
  readonly source: CorpusSource;
  readonly subject: CorpusResyncSubject;
}): readonly ResyncStep[] {
  if (subject.kind === "export") {
    return [{ argv: [source, "sync"] }];
  }
  if (subject.kind === "live") {
    return [{ argv: [source, "live-sync"] }];
  }
  const base: readonly string[] = ["refresh", "--source", source, "--store"];
  if (subject.kind === "none") {
    return [{ argv: base }];
  }
  return [{ argv: [...base, "--all-repos", "--github-org", subject.org] }];
}

/** One target's policy, or the one reason its window could not become a cadence. */
function composePolicy({
  target,
  windowMs,
  steps,
  seated,
}: {
  readonly target: ResyncTarget;
  readonly windowMs: number;
  readonly steps: readonly ResyncStep[];
  readonly seated: boolean;
}): { readonly policy: ResyncPolicy | null; readonly problem: string | null } {
  const cadence = deriveResyncCadence({ windowMs });
  if (cadence.isErr()) {
    return { policy: null, problem: `${resyncTargetLabel({ target })}: ${cadence.error.join("; ")}` };
  }
  return {
    policy: {
      cadence: cadence.value,
      note: cadenceNote({ cadence: cadence.value, windowMs }),
      recipeId: resyncRecipeId({ target }),
      seated,
      steps,
      target,
      windowMs,
    },
    problem: null,
  };
}

/**
 * The one policy a target resolves to, out of a roster.
 *
 * @param policies the whole roster
 * @param recipeId the row being run
 * @returns the policy, or `undefined` when this build schedules no such target
 */
export function findResyncPolicy({
  policies,
  recipeId,
}: {
  readonly policies: readonly ResyncPolicy[];
  readonly recipeId: string;
}): ResyncPolicy | undefined {
  return policies.find((policy) => policy.recipeId === recipeId);
}
