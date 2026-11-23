/**
 * Deciding what the definition store SHOULD hold, given the roster this build derives — the pure half of
 * `slopweaver automation register-resyncs`.
 *
 * ## Reconciliation rather than installation, and why that distinction is the whole point
 *
 * A one-time "install the rows" command recreates the exact failure reconciliation exists to prevent. The
 * failure is not that nobody ever set a schedule up; it is that a schedule which exists on paper
 * drifts from the estate until 36 of 36 atlases are behind and a card ends up asking the owner whether to
 * resync. So this runs at every visible decision point and answers the same question each time: which
 * managed rows are missing, which have drifted from what the repository now derives, and which name a
 * target this build no longer has.
 *
 * ## What it will not do
 *
 * - **It never touches a row it does not own.** Ownership is the id prefix (`./target.ts`), so a hand-written
 *   recipe on the same install is invisible to it. The definition directory is outside code review and it
 *   is not this registrar's to tidy.
 * - **It never re-enables a row somebody disabled.** `enabled: false` is how a recipe is paused rather than
 *   lost, and a reconciler that undid that every pass would make pausing impossible.
 * - **It never overwrites a managed row whose executable fields were hand-edited.** That is reported as a
 *   CONFLICT and left alone. Silently reverting somebody's edit and silently keeping it are both wrong; the
 *   only honest third option is to say so.
 *
 * Pure: rosters in, a plan out. Nothing is written here.
 */
import type { RecipeDefinition } from "../automation/definition.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../automation/definition.js";
import { RESYNC_KIND } from "../automation/kinds.js";
import { planVerbRun, VERB_RUN_KIND } from "../automation/verbRun.js";
import { driftedKind, withOperatorFields } from "./managedRowFields.js";
import type { ResyncPolicy } from "./policy.js";
import { isManagedResyncId, resyncTargetLabel } from "./target.js";

/** What this pass would do to one row. */
export type RegistrationAction = "create" | "update" | "unchanged" | "retire" | "conflict";

/** One row's verdict, and the definition that would be written for it. */
export interface RegistrationChange {
  readonly recipeId: string;
  readonly action: RegistrationAction;
  /** What the row should hold, for `create` and `update`; `null` for every other action. */
  readonly definition: RecipeDefinition | null;
  /** Why this row is a conflict, or why it is being retired. `null` when there is nothing to explain. */
  readonly reason: string | null;
}

/** Everything one reconciliation decided. */
export interface RegistrationPlan {
  readonly changes: readonly RegistrationChange[];
}

/**
 * The definition one policy should produce.
 *
 * `effect: "read"` is not a narrowing anyone chose for comfort — it is what the row is allowed to do, and
 * `verbRun.ts` checks it against `automation resync`'s own manifest effect. A resync reads a provider and
 * writes this machine's own state; it never writes to a provider, so a row declaring more would be
 * claiming a capability the schedule has no business holding.
 *
 * `destination: local-atlas` says the result lands on this machine rather than in anybody's channel, which
 * is why `onMissed` resolves to `backfill`: a missed generation is data that is simply absent, not a card
 * nobody wanted three copies of.
 *
 * ## The kind is derived from the TARGET, every write, and there is nothing to remember
 *
 * A managed resync row is seated, so it carries {@link RESYNC_KIND} — unless its target
 * is a compile-only atlas, which walks no account, needs no model and runs in seconds once cached, so it
 * carries {@link VERB_RUN_KIND} and runs in the chair's own tick with no seat and no model (the cadence
 * page's compile-only leans). Which one is `policy.seated`, derived from the
 * descriptor by this build every time a row is written, never read back from the store and never carried
 * by a flag. That is the whole of the property, and it is worth stating because the opposite was tried. A
 * `--to-seat` cutover
 * flag used to decide this, defaulting to the pre-cutover `verb-run`, and the default is what broke:
 * MEASURED, a hand repair moved 44 rows aside and re-ran `register-resyncs`, so every one was
 * RECREATED on `verb-run` and the cutover to seats was undone in one command. `automation due` then read
 * `43 actionable · 0 want a session` — `../recipe/definitionShape.ts` answers `spawn` only for
 * {@link RESYNC_KIND} — so `automation seat` could seat nothing while 43 rows sat hours late, and the tally
 * read like health. Repro on a pre-fix tree: `slopweaver automation register-resyncs --dry-run` and read the
 * kind it would write.
 *
 * The flag's own reason had expired: its JSDoc guarded against the standing recipe-scheduler session
 * flipping rows to a kind it then refused to run, and that session no longer exists. A stale checkout is not
 * an argument for keeping it either — a build predating {@link RESYNC_KIND} has no such constant and writes
 * `verb-run` whatever this file says, so the flag protected nothing it could reach.
 *
 * @param policy the target's resolved schedule
 * @returns the row that target should be registered as
 */
export function resyncDefinitionFor({ policy }: { readonly policy: ResyncPolicy }): RecipeDefinition {
  const kind = policy.seated ? RESYNC_KIND : VERB_RUN_KIND;
  return {
    cadence: policy.cadence,
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind,
    onMissed: "backfill",
    params: { argv: resyncArgv({ policy }) },
    recipeId: policy.recipeId,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

/**
 * The argv a row carries.
 *
 * Deliberately the WRAPPER verb and the target's name, never the underlying atlas or refresh command. The
 * definition directory is ungated, so an argv naming the real work would put the choice of what runs in a
 * file nothing reviews; naming `automation resync` puts it in `./policy.ts`, which is reviewed, tested and in
 * the repository. A row can then only choose WHICH target, and never what happens to it.
 *
 * @param policy the target's resolved schedule
 * @returns the argv words past the binary name
 */
export function resyncArgv({ policy }: { readonly policy: ResyncPolicy }): readonly string[] {
  if (policy.target.kind === "atlas") {
    return ["recipe", "resync", "--atlas", policy.target.platform];
  }
  return ["recipe", "resync", "--source", policy.target.source];
}

/**
 * One row's `argv` as a reader sees it, whatever a hand edit left in the field.
 *
 * `params` is `Record<string, unknown>` by construction — the kind validates its own shape and the store
 * is ungated — so this must render an argv that is not an array of strings rather than assert it is one.
 * A conflict message is exactly where a malformed value shows up, and asserting there would throw on the
 * one input the message exists to describe.
 */
function renderArgv({ value }: { readonly value: unknown }): string {
  if (!Array.isArray(value)) {
    return String(value);
  }
  return value.map((word) => String(word)).join(" ");
}

/**
 * Whether one stored row actually runs the target it is named for.
 *
 * A recipe id is a NAME and nothing more, and neither is an argv on its own. Two failures show the two
 * halves of that. The first wrote `resync-atlas-airtable.json` carrying
 * `automation resync --atlas clerk`, and the page reported Airtable as current on the strength of the filename.
 * The second left the argv correct and changed `kind` to `investigate` — which the definition parser
 * accepts — so `automation run-due` reported the row as "not mine" and never dispatched it, while the page
 * still read current.
 *
 * Three passes found three different fields that decided dispatch and were not being compared — the argv,
 * then the kind, then an extra `params` key that a `.strict()` schema rejects. Mirroring the dispatcher's
 * criteria one at a time is how that keeps happening, so this ASKS THE DISPATCHER instead — the same kind
 * selection and the same `planVerbRun` that `automation run-due` applies, in its order. A row either of them
 * refuses is a row nothing will ever run, whatever the reason. Only the target identity is checked
 * separately, since the planner has no opinion about which atlas a runnable row belongs to.
 *
 * @param definition the stored row
 * @param policy the target's derived schedule
 * @returns true when the row would actually run that target
 */
export function rowRunsTarget({
  definition,
  policy,
}: {
  readonly definition: RecipeDefinition;
  readonly policy: ResyncPolicy;
}): boolean {
  // The pair `automation run-due` itself applies, in its order: it dispatches a `verb-run` or a `resync` row —
  // both planned by `planVerbRun`, the second only inside the session seated for it — and then `planVerbRun`
  // decides whether that row is runnable. `planVerbRun` alone is not enough, because it never reads `kind`:
  // its caller has already selected on it.
  if (definition.kind !== VERB_RUN_KIND && definition.kind !== RESYNC_KIND) {
    return false;
  }
  const plan = planVerbRun({ definition });
  if (plan.isErr()) {
    return false;
  }
  return canonicalJson({ value: plan.value.argv }) === canonicalJson({ value: resyncArgv({ policy }) });
}

/**
 * The fields a managed row may not have drifted on without it being somebody's edit — every field the
 * dispatcher reads EXCEPT `kind`, which {@link driftedKind} judges separately.
 *
 * `params` WHOLESALE, not just its `argv`. `live/automation/verbRun.ts`'s params schema is `.strict()`, so an
 * extra key there makes `planVerbRun` refuse and `automation run-due` never dispatch the row — a row like that
 * survives as `unchanged`. Anything the dispatcher reads belongs in this
 * comparison; a subset of it is how a row that cannot run reads as the row this build wrote.
 *
 * `kind` is the one field this pass may itself be CHANGING, and comparing it here made repairing a row
 * impossible. MEASURED live: the pass reported 43 conflicts and wrote nothing, every line
 * reading ``runs `automation resync --atlas airtable` where this build derives `automation resync --atlas airtable`
 * `` — two identical commands, because the field that actually differed was the kind and the message
 * renders only the argv. Repro: `slopweaver automation register-resyncs --dry-run` against a store whose rows
 * carry `verb-run`, and read whether they report as `would update` or as a conflict.
 */
function executionFields({ definition }: { readonly definition: RecipeDefinition }): string {
  return canonicalJson({
    value: {
      destination: definition.destination.kind,
      effect: definition.effect,
      params: definition.params,
    },
  });
}

/**
 * Whether two definitions are the SAME ROW, every field compared.
 *
 * Not {@link executionFields}, and the difference is the whole reason this exists. That comparison asks
 * "would running this do something different", which is the right question for an owned row. Adoption asks
 * a stricter one — "is this row already exactly what I would have written" — because adopting anything less
 * takes ownership of somebody else's edit. A comparison of only cadence and `onMissed` would adopt a row
 * differing only in `enabled` as unchanged and record it as owned.
 *
 * Key order is normalised RECURSIVELY so two equal rows cannot differ by how their JSON was written. The
 * obvious spelling — `JSON.stringify(value, Object.keys(value).toSorted())` — is wrong here and was the
 * first cut: an array replacer filters keys at EVERY level, so a nested key absent from the top-level list
 * is dropped rather than compared, and an unowned row carrying an extra `params` field was adopted.
 */
function sameDefinition({
  left,
  right,
}: {
  readonly left: RecipeDefinition;
  readonly right: RecipeDefinition;
}): boolean {
  return canonicalJson({ value: left }) === canonicalJson({ value: right });
}

/** One value serialised with every object's keys sorted, at every depth. */
function canonicalJson({ value }: { readonly value: unknown }): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson({ value: entry })).join(",")}]`;
  }
  // `undefined` is checked before the stringify rather than after it. `JSON.stringify(undefined)` really
  // does answer `undefined` at runtime, while its type says `string`, so a `??` here is dead to the linter
  // and alive to the program — the one shape that would have compared two different rows as equal.
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  const entries = Object.entries(value)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson({ value: entry })}`);
  return `{${entries.join(",")}}`;
}

/**
 * Decide what one pass should write.
 *
 * @param policies every target this build schedules
 * @param existing every definition already in the store, managed and not
 * @param owned the recipe ids a previous pass recorded as its own, so a retire can be proven rather than guessed
 * @param unreadable the file names `loadRecipeDefinitions` REFUSED — never treated as absent
 * @param aliased the recipe ids whose row is in a misnamed file or in more than one file
 * @returns one change per managed row, ordered by recipe id
 */
export function planResyncRegistration({
  policies,
  existing,
  owned,
  unreadable = [],
  aliased = [],
}: {
  readonly policies: readonly ResyncPolicy[];
  readonly existing: readonly RecipeDefinition[];
  readonly owned: readonly string[];
  readonly unreadable?: readonly string[];
  readonly aliased?: readonly string[];
}): RegistrationPlan {
  const byId = new Map(existing.map((definition) => [definition.recipeId, definition]));
  const changes: RegistrationChange[] = [];
  const wanted = new Set(policies.map((policy) => policy.recipeId));

  for (const policy of policies) {
    // A file that FAILED to parse is not an absent file, and the difference is somebody's work. Before
    // this, `loadRecipeDefinitions`'s rejected half was dropped on the floor, so a row the parser refused
    // — an unknown kind, a hand edit, a half-written file — read as nothing being there at all, and the
    // create path then OVERWROTE it and recorded this registrar as its owner. It is the ownership rule the other two paths already keep, on the one
    // path that had never been asked.
    if (aliased.includes(policy.recipeId) || unreadable.includes(`${policy.recipeId}.json`)) {
      changes.push(unreadableConflict({ aliased: aliased.includes(policy.recipeId), recipeId: policy.recipeId }));
      continue;
    }
    changes.push(changeFor({ current: byId.get(policy.recipeId), owned, policy }));
  }

  for (const definition of byId.values()) {
    if (wanted.has(definition.recipeId) || !isManagedResyncId({ recipeId: definition.recipeId })) {
      continue;
    }
    changes.push(retirementFor({ aliased, owned, recipeId: definition.recipeId }));
  }

  return { changes: changes.toSorted((left, right) => left.recipeId.localeCompare(right.recipeId)) };
}

/**
 * The verdict for a managed-looking row whose target this build no longer derives.
 *
 * Retiring is the last of three answers rather than the first: a row whose file cannot be placed, and a row
 * no pass here recorded writing, are somebody's work wearing the prefix. Deleting either would be this
 * registrar tidying a row it never owned, which the header promises it does not do.
 *
 * @param recipeId the row with no policy behind it
 * @param owned the recipe ids a previous pass recorded as its own
 * @param aliased the recipe ids whose row cannot be tied to one file named for it
 * @returns the change to report for that row
 */
function retirementFor({
  recipeId,
  owned,
  aliased,
}: {
  readonly recipeId: string;
  readonly owned: readonly string[];
  readonly aliased: readonly string[];
}): RegistrationChange {
  if (aliased.includes(recipeId)) {
    return unreadableConflict({ aliased: true, recipeId });
  }
  if (!owned.includes(recipeId)) {
    return {
      action: "conflict",
      definition: null,
      reason:
        `carries a managed id but no pass on this install recorded writing it, so it is somebody else's ` +
        "row wearing the prefix — left alone rather than retired",
      recipeId,
    };
  }
  return {
    action: "retire",
    definition: null,
    reason: "names a target this build no longer schedules",
    recipeId,
  };
}

/**
 * The verdict for an id whose file the parser REFUSED.
 *
 * A file that failed to parse is not an absent file, and the difference is somebody's work. Before this,
 * `loadRecipeDefinitions`'s rejected half was dropped on the floor, so a row the parser refused — an
 * unknown kind, a hand edit, a half-written file — read as nothing being there at all, and the create path
 * OVERWROTE it and recorded this registrar as its owner. It is the
 * ownership rule the update and adopt paths already keep, on the one path that had never been asked.
 *
 * An ALIASED id takes the same road for the same reason. When this id's row was read from a file not named
 * for it, or appears in more than one file, the plan cannot know which file it is deciding about. An exact
 * copy in `zz-copy.json` would steer an update over a hand-edited canonical file.
 *
 * @param recipeId the id whose file could not be read, or whose row is not in its own file
 * @param aliased true when the row is aliased rather than unreadable, so the reason names the right cause
 * @returns the conflict to report instead of a create or update
 */
function unreadableConflict({
  recipeId,
  aliased,
}: {
  readonly recipeId: string;
  readonly aliased: boolean;
}): RegistrationChange {
  const cause = aliased
    ? "this id's row was read from a file not named for it, or from more than one file, so which file the " +
      "plan is deciding about is unknown"
    : "a file stands at this id that the definition parser refused, so what it holds is unknown";
  return {
    action: "conflict",
    definition: null,
    reason: `${cause} — reported rather than written, because a row this registrar cannot place is somebody's work. Resolve it, then run this again`,
    recipeId,
  };
}

/**
 * The conflict for a row whose EXECUTION has drifted, naming the field that actually differs.
 *
 * A message that always renders the argv is how a kind difference once printed two identical commands
 * against each other. `params` is compared wholesale, so the argv is only one of the ways it can differ —
 * an extra key `verbRun.ts`'s `.strict()` schema rejects is another, and it renders as nothing at all on an
 * argv-only message.
 *
 * @param current the row already in the store
 * @param wanted the row this build would write
 * @param policy the target's resolved schedule, for the label a reader identifies the row by
 * @returns the conflict change, with a reason naming the drifted field
 */
function executionConflict({
  current,
  wanted,
  policy,
}: {
  readonly current: RecipeDefinition;
  readonly wanted: RecipeDefinition;
  readonly policy: ResyncPolicy;
}): RegistrationChange {
  const label = resyncTargetLabel({ target: policy.target });
  const tail = " — a hand edit to what a managed row EXECUTES is never overwritten";
  if (canonicalJson({ value: current.params }) !== canonicalJson({ value: wanted.params })) {
    const currentArgv = renderArgv({ value: current.params["argv"] });
    const wantedArgv = renderArgv({ value: wanted.params["argv"] });
    const params =
      currentArgv === wantedArgv
        ? `carries params \`${canonicalJson({ value: current.params })}\` where this build derives ` +
          `\`${canonicalJson({ value: wanted.params })}\``
        : `runs \`${currentArgv}\` where this build derives \`${wantedArgv}\``;
    return { action: "conflict", definition: null, reason: `${params} for ${label}${tail}`, recipeId: policy.recipeId };
  }
  if (current.effect !== wanted.effect) {
    return {
      action: "conflict",
      definition: null,
      reason: `declares effect \`${current.effect}\` where this build derives \`${wanted.effect}\` for ${label}${tail}`,
      recipeId: policy.recipeId,
    };
  }
  return {
    action: "conflict",
    definition: null,
    reason:
      `lands in \`${current.destination.kind}\` where this build derives ` +
      `\`${wanted.destination.kind}\` for ${label}${tail}`,
    recipeId: policy.recipeId,
  };
}

/**
 * One managed row's verdict against what its policy now derives.
 *
 * ## The ownership check is on the UPDATE path too, and that is not symmetry for its own sake
 *
 * A review found it missing here while it was already present on the retire
 * path, with this counterexample: hand-write `resync-atlas-airtable.json` carrying the argv this build
 * derives but a cadence of your own, leave `resync-owned.json` absent, and the registrar rewrote your
 * cadence and then recorded itself as the owner. The header's promise — it writes only rows it owns — was
 * true of deletions and false of edits.
 *
 * An EXACTLY matching row is adopted rather than refused, and that is the difference between closing the
 * hole and making the registrar unusable. Losing the ownership file would otherwise turn all 43 rows into
 * conflicts at once; adopting a row this build would have written identically overwrites nothing, so there
 * is nothing for the check to protect. "Exactly" means {@link sameDefinition} — every field, `enabled`
 * included — never the narrower {@link executionFields} comparison, which this
 * path must not use.
 *
 * ## The kind is judged apart from the rest, because this pass may be changing it
 *
 * A row this registrar owns may legitimately be found on the pre-{@link RESYNC_KIND} `verb-run`, and
 * rewriting it to the kind a seat can pick up is the whole point of the pass, so folding `kind` into the
 * drift comparison would refuse the one repair that matters. The three questions are asked separately: has
 * what the row EXECUTES drifted ({@link executionFields}), is its kind one this registrar may write over
 * ({@link driftedKind}), and does it still match what this build derives.
 */
function changeFor({
  policy,
  current,
  owned,
}: {
  readonly policy: ResyncPolicy;
  readonly current: RecipeDefinition | undefined;
  readonly owned: readonly string[];
}): RegistrationChange {
  const wanted = resyncDefinitionFor({ policy });
  if (current === undefined) {
    return { action: "create", definition: wanted, reason: null, recipeId: policy.recipeId };
  }
  if (executionFields({ definition: current }) !== executionFields({ definition: wanted })) {
    return executionConflict({ current, policy, wanted });
  }
  if (driftedKind({ current, wanted })) {
    return {
      action: "conflict",
      definition: null,
      reason:
        `carries kind \`${current.kind}\` where this build derives \`${wanted.kind}\` for ` +
        `${resyncTargetLabel({ target: policy.target })} — ` +
        "a hand edit to what a managed row EXECUTES is never overwritten",
      recipeId: policy.recipeId,
    };
  }
  const isOwned = owned.includes(policy.recipeId);
  if (
    isOwned &&
    current.kind === wanted.kind &&
    current.cadence === wanted.cadence &&
    current.onMissed === wanted.onMissed
  ) {
    return { action: "unchanged", definition: null, reason: null, recipeId: policy.recipeId };
  }
  if (!isOwned && sameDefinition({ left: current, right: wanted })) {
    return { action: "unchanged", definition: null, reason: null, recipeId: policy.recipeId };
  }
  if (!isOwned) {
    return {
      action: "conflict",
      definition: null,
      reason:
        "carries a managed id, differs from what this build derives, and no pass on this install recorded " +
        "writing it — so it is somebody else's row and none of it is this registrar's to rewrite",
      recipeId: policy.recipeId,
    };
  }
  return {
    action: "update",
    // A pause, a hold and a channel approval are never the registrar's, so the derived row inherits each as the
    // store holds it. Dropping `hold` here once lifted a failure hold on every pass that touched the row.
    definition: withOperatorFields({ current, wanted }),
    reason: null,
    recipeId: policy.recipeId,
  };
}

/**
 * How many rows each action covers, for the one line a pass prints.
 *
 * @param plan the plan just decided
 * @returns the count per action, zero included
 */
export function registrationCounts({
  plan,
}: {
  readonly plan: RegistrationPlan;
}): Readonly<Record<RegistrationAction, number>> {
  const counts: Record<RegistrationAction, number> = {
    conflict: 0,
    create: 0,
    retire: 0,
    unchanged: 0,
    update: 0,
  };
  for (const change of plan.changes) {
    counts[change.action] += 1;
  }
  return counts;
}

/**
 * Every recipe id whose row cannot be tied to one file named for it.
 *
 * A definition's recipeId lives inside its file, and the file is named separately. When they disagree, or
 * one id turns up in two files, the plan cannot say which file it is deciding about. A copy in
 * `zz-copy.json` would steer an update over a hand-edited canonical file. An id listed here is planned as a conflict and never written. A file list that does not line up
 * with the definitions answers every id, because a pairing that cannot be read is not evidence of none.
 *
 * @param definitions the rows the definitions directory parsed
 * @param definitionFiles the file each row came from, index-aligned with `definitions`
 * @returns the aliased recipe ids, each at most once, in first-seen order
 */
export function aliasedRecipeIds({
  definitions,
  definitionFiles,
}: {
  readonly definitions: readonly RecipeDefinition[];
  readonly definitionFiles: readonly string[];
}): readonly string[] {
  const aligned = definitionFiles.length === definitions.length;
  const counts = new Map<string, number>();
  definitions.forEach((definition) => {
    counts.set(definition.recipeId, (counts.get(definition.recipeId) ?? 0) + 1);
  });
  const aliased = definitions.flatMap((definition, index) => {
    const misnamed = !aligned || definitionFiles[index] !== `${definition.recipeId}.json`;
    // Counted above for every definition in this same list, so its own id is always there.
    const duplicated = counts.get(definition.recipeId)! > 1;
    return misnamed || duplicated ? [definition.recipeId] : [];
  });
  return [...new Set(aliased)];
}
