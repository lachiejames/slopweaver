/**
 * Shared flag specs, usage strings and the `str` helper for every `recipe` verb — mirrors `turn/core.ts`'s
 * own shape for the same reason: laziness means `--help` reads these LITERALS without importing any verb's
 * run module, so they must not be computed from anything that would defeat that.
 */

/**
 * A string flag's value, or `undefined` when it was absent.
 *
 * @param values the parsed flag values
 * @param key the flag name, without the leading dashes
 * @returns the value when the flag was given a string, else `undefined`
 */
export function str({
  values,
  key,
}: {
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly key: string;
}): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

export const RECIPE_RUN_DUE_USAGE =
  "usage: slopweaver automation run-due [--recipe <id>] [--claim-id <token>] [--media a.png,b.png]\n" +
  "       [--dry-run] [--limit <n>] [--home <dir>]\n" +
  "  --claim-id  the token `automation seat` printed when it claimed this row, which is the ONLY way a\n" +
  "              SPAWN-shaped row runs here: this process is then the session that was seated for it, so\n" +
  "              the row runs, its slot is stamped, and its claim is dropped. Without it a spawn-shaped\n" +
  "              row is reported SEAT IT and left due. A token that is not the row's live claim is\n" +
  "              refused rather than run. A token whose firing the row's NEXT firing overtook before this\n" +
  "              session started it is CARRIED FORWARD: that attempt is given back and the firing the row\n" +
  "              is due for now runs under the same token, unless another seat already holds it\n" +
  "  --media     the graded captures to attach to a datadog-alert-digest row whose params carry\n" +
  "              `shots`. Taken by the session this row was SEATED in, of the views its own firing\n" +
  "              probes cite, and only ever accepted alongside --claim-id: a tick that has not been\n" +
  "              seated has no browser to have taken one with. The card posts either way — an image\n" +
  "              never holds the digest up (the image and the card both land within 24 hours)\n" +
  "  --recipe    judge and run ONLY the row carrying this recipeId, and report only that row. Nothing\n" +
  "              else about the tick changes: a row inside its cadence is still not run, a held row is\n" +
  "              still skipped, and a row that runs is still stamped. Without it a tick takes the due\n" +
  "              rows in store order, so a row registered behind dozens of others cannot be reached by\n" +
  "              --limit at all. Refused when no row carries that id.\n" +
  "  --dry-run   judge and plan every row, and withhold every effect. A `verb-run` row prints its plan\n" +
  "              and runs nothing; an `alert-summary` row still READS its channel and a\n" +
  "              `datadog-alert-digest` row still COUNTS its probes, each rendering the card through\n" +
  "              `slack post --dry-run`, so what you see is what the channel would have seen\n" +
  "  --limit     run at most this many due rows and report the rest as still due, so one tick cannot be\n" +
  "              held for an hour by a schedule that has drifted a long way behind\n" +
  "  --home      the state home whose definitions to run, instead of $SLOPWEAVER_HOME\n" +
  "  A row held by another session's LIVE claim is reported and skipped, never run twice.\n" +
  "  runs the definition store's DUE run-here rows — never a spawn-shaped one, never a model";

export const RECIPE_RUN_DUE_FLAG_SPEC = {
  boolean: ["dry-run"],
  string: ["claim-id", "home", "limit", "media", "recipe"],
} as const;

export const RECIPE_SEAT_USAGE =
  "usage: slopweaver automation seat --limit <n> --model <name> [--recipe <id>] [--dry-run] [--home <dir>]\n" +
  "  Open ONE visible session on the automations that need a session, and claim each row it takes —\n" +
  "  nothing stands by for these, a supervisor pass decides to seat them. It registers\n" +
  "  a board row, claims every row it hands over, and spawns a workspace on that row; a spawn that fails\n" +
  "  releases every claim it took, so a refusal leaves the schedule exactly as it found it.\n" +
  "  --limit     how many due rows this seat hands to one session. REQUIRED, and deliberately without a\n" +
  "              default: MEASURED on this install, one pass over about forty targets took 2h40m, and a\n" +
  "              claim expires at its row's own next firing — so an unbounded pass stops being able to\n" +
  "              stamp what it ran. How many is the seating session's judgement, not a constant here\n" +
  "  --model     the model the seated session runs on, named per AGENTS.md rule 5\n" +
  "  --recipe    seat ONLY the row carrying this recipeId. --limit alone is a prefix of the ranking,\n" +
  "              so a row that is less overdue than forty resyncs cannot be reached with it; and two\n" +
  "              rows that each drive THEIR ONE CHROME must not be seated together (MEASURED: two\n" +
  "              browser-walk seats contended and every navigation read ETIMEDOUT)\n" +
  "  --dry-run   print which rows would be seated, and each row the ledger refuses, and stop:\n" +
  "              nothing registered, claimed or spawned\n" +
  "  --home      the state home whose definitions to read, instead of $SLOPWEAVER_HOME\n" +
  "  Exit 3 when nothing needs a session — a status, not a fault.";

export const RECIPE_SEAT_FLAG_SPEC = {
  boolean: ["dry-run"],
  string: ["home", "limit", "model", "recipe"],
} as const;

/** Every flag `automation seat` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_SEAT_FLAG_NAMES: readonly string[] = [
  ...RECIPE_SEAT_FLAG_SPEC.boolean,
  ...RECIPE_SEAT_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_RUN_DUE_FLAG_NAMES: readonly string[] = [
  ...RECIPE_RUN_DUE_FLAG_SPEC.boolean,
  ...RECIPE_RUN_DUE_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_DUE_USAGE =
  "usage: slopweaver automation due [--json] [--brief] [--home <dir>]\n" +
  "  Which automations are DUE, for the supervisor's own tick to judge — there is\n" +
  "  no clock, so a due ask is run or spawned by the supervisor at the decision point where it already\n" +
  "  spawns board rows. READ-ONLY: no network, no model, nothing claimed and nothing written.\n" +
  "  Every row prints a line, due or not, and each says whether running it is a command IN THIS PROCESS\n" +
  "  or a SPAWNED session, what it would do to the world, how late it is against its OWN cadence, and\n" +
  "  who is already running it. Exit 0 always — this is a report.\n" +
  "  --json      emit one machine-readable document instead of the lines\n" +
  "  --brief     print only the rows a tick decides on — due (claimed or not), BROKEN, UNOWNED, no executor —\n" +
  "              and ONE line counting the quiet rest; every problem line and the tally stay whole. With\n" +
  "              --json, `rows` is filtered the same way and `omittedQuiet` carries the count\n" +
  "  --home      the state home whose definitions to read, instead of $SLOPWEAVER_HOME";

export const RECIPE_DUE_FLAG_SPEC = {
  boolean: ["brief", "json"],
  string: ["home"],
} as const;

/** Every flag `automation due` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_DUE_FLAG_NAMES: readonly string[] = [
  ...RECIPE_DUE_FLAG_SPEC.boolean,
  ...RECIPE_DUE_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_REGISTER_RESYNCS_USAGE =
  "usage: slopweaver automation register-resyncs [--dry-run] [--json] [--home <dir>]\n" +
  "  Reconcile the definition store against the resync roster this build derives — one row per registered\n" +
  "  atlas and per fetchable corpus source, each on a cadence derived from that target's own declared\n" +
  "  freshness window. Scheduled resyncs run across ALL atlases and corpuses, so a\n" +
  "  card never asks whether to resync. Run it at every visible decision point, not once at install: an\n" +
  "  atlas that lands in the repository afterwards is otherwise silently unscheduled.\n" +
  "  It writes only rows it OWNS. A hand-written row, a paused row and a managed-looking row no pass here\n" +
  "  recorded writing are each left exactly as they are, and reported.\n" +
  "  Every managed row is written on the `resync` kind, which a supervisor pass SEATS a session for rather\n" +
  "  than running in its own process — except a compile-only atlas, which needs no\n" +
  "  model, credential or browser and is written on `verb-run`, run in the tick with no seat. The kind\n" +
  "  is derived from this build on every write, so a row a hand repair or a reinstall recreated is\n" +
  "  repaired back to it rather than left where nothing will ever pick it up.\n" +
  "  --dry-run   print the plan and write nothing at all — no definitions, no ownership record\n" +
  "  --json      emit one machine-readable document instead of the lines\n" +
  "  --home      the state home whose definitions to reconcile, instead of $SLOPWEAVER_HOME";

export const RECIPE_REGISTER_RESYNCS_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  string: ["home"],
} as const;

/** Every flag `automation register-resyncs` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_REGISTER_RESYNCS_FLAG_NAMES: readonly string[] = [
  ...RECIPE_REGISTER_RESYNCS_FLAG_SPEC.boolean,
  ...RECIPE_REGISTER_RESYNCS_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_RESYNC_USAGE =
  "usage: slopweaver automation resync --atlas <platform> | --source <corpus source> [--home <dir>]\n" +
  "       slopweaver automation resync --list [--json] [--home <dir>]\n" +
  "  Bring ONE target current and record whether it actually worked. This is the verb every scheduled\n" +
  "  resync row selects: the row names a target, and what that executes is resolved from the reviewed\n" +
  "  roster in this repository rather than from the ungated definition file.\n" +
  "  Zero exit is necessary and not sufficient for an atlas — the attempt succeeds only when the\n" +
  "  generation clock MOVED, because a sync can exit 0 having published nothing new. A corpus source is\n" +
  "  judged on its exit code instead: its watermark is the newest record OBSERVED, so a quiet week moves\n" +
  "  no cursor however well the fetch went — and its exit 3 (fetched fine, nothing new) is a success, not\n" +
  "  a failure, as long as the store holds the source at all.\n" +
  "  An atlas declaring `resyncDemand` (Aether) walks only when a person named it in the corpus since its\n" +
  "  last success: with no such mention it runs no step and exits 3; a check that cannot read exits 4.\n" +
  "  --atlas     the atlas to resync, by the platform name `atlas freshness` prints\n" +
  "  --source    the corpus source to refresh\n" +
  "  --list      print every target this build schedules, with its cadence, and run nothing\n" +
  "  --json      with --list, emit one machine-readable document instead of the lines\n" +
  "  --home      the state home to resync into, instead of $SLOPWEAVER_HOME";

export const RECIPE_RESYNC_FLAG_SPEC = {
  boolean: ["list", "json"],
  string: ["atlas", "source", "home"],
} as const;

/** Every flag `automation resync` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_RESYNC_FLAG_NAMES: readonly string[] = [
  ...RECIPE_RESYNC_FLAG_SPEC.boolean,
  ...RECIPE_RESYNC_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_PROPAGATE_USAGE =
  "usage: slopweaver automation propagate --status [--json] [--home <dir>]\n" +
  "       slopweaver automation propagate --done --batch <id> --through-revision <n> [--home <dir>]\n" +
  "       slopweaver automation propagate --seat [--home <dir>]\n" +
  "  The ONE open judgement pass every successful corpus resync joins. The resync itself re-derives the\n" +
  "  readings that read its source (docs/propagation-map.md) and seats the pass when none is open; this\n" +
  "  verb is how the seated session reads what it covers and says it is finished.\n" +
  "  --status            print the open pass: its board slug, its revision, and every sync it covers with\n" +
  "                      what that sync already re-derived. Exit 3 when no pass is open\n" +
  "  --json              with --status, emit one machine-readable document instead of the lines\n" +
  "  --done              confirm the pass THROUGH --through-revision; a sync that joined after that revision\n" +
  "                      stays pending, and the pass retires only when nothing is pending\n" +
  "  --batch             the batch --status printed; a pass retired since then is refused, never confirmed\n" +
  "  --through-revision  the revision --status printed when the pass read it\n" +
  "  --seat              open the pass's visible session now — for a resync run outside a visible session or\n" +
  "                      against another home, which records the pass and seats nothing\n" +
  "  --home              the state home, instead of $SLOPWEAVER_HOME";

export const RECIPE_PROPAGATE_FLAG_SPEC = {
  boolean: ["status", "json", "done", "seat"],
  string: ["batch", "through-revision", "home"],
} as const;

/** Every flag `automation propagate` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_PROPAGATE_FLAG_NAMES: readonly string[] = [
  ...RECIPE_PROPAGATE_FLAG_SPEC.boolean,
  ...RECIPE_PROPAGATE_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_BLOCKER_USAGE =
  "usage: slopweaver automation blocker --atlas <platform> | --source <corpus source>\n" +
  "         --reason <what was observed> --steps <json array | one step> [--finding <slug>] [--home <dir>]\n" +
  "       slopweaver automation blocker --atlas <platform> | --source <corpus source> --clear [--home <dir>]\n" +
  "  Record that ONE scheduled target cannot resync unattended until a human does something, with the\n" +
  "  exact steps that clear it. A card must never ask them whether to resync, so a\n" +
  "  blocker is a recorded fact on the freshness page with its clickops beside it, not a question.\n" +
  "  The blocker shows on the briefing's freshness section and is cleared automatically by the next\n" +
  "  successful resync of that target — so a stale one cannot outlive the problem it describes.\n" +
  "  --atlas     the atlas this is about\n" +
  "  --source    the corpus source this is about\n" +
  "  --reason    what was observed, in the words the verb itself used — never a paraphrase\n" +
  "  --steps     the clickops steps, in order: a JSON array of strings, or one plain step. A JSON array\n" +
  "              rather than a repeated flag or a delimiter, because a real step contains commas\n" +
  "  --finding   the `handover register --finding` slug this was also filed as, when it was\n" +
  "  --clear     drop the recorded blocker without running anything\n" +
  "  --home      the state home to record into, instead of $SLOPWEAVER_HOME";

export const RECIPE_BLOCKER_FLAG_SPEC = {
  boolean: ["clear"],
  string: ["atlas", "source", "reason", "steps", "finding", "home"],
} as const;

/** Every flag `automation blocker` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_BLOCKER_FLAG_NAMES: readonly string[] = [
  ...RECIPE_BLOCKER_FLAG_SPEC.boolean,
  ...RECIPE_BLOCKER_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_CLAIM_USAGE =
  "usage: slopweaver automation claim <recipeId> --by <who> [--home <dir>]\n" +
  "       slopweaver automation claim <recipeId> --release [--exit-code <n> --claim-id <id>] [--home <dir>]\n" +
  "  Take the claim on one due row as you spawn the session that runs it, so the next tick does not spawn\n" +
  "  it again. The claim EXPIRES AT THE ROW'S OWN NEXT FIRING: there is no TTL\n" +
  "  to tune, a claim can never outlive the schedule it belongs to, and a worker that dies leaves a row\n" +
  "  that comes back no later than its own next slot.\n" +
  "  --by        who is taking it — a workspace name, a session key, a verb; free text a reader can chase\n" +
  "  --release   drop a claim. On its own it stamps NOTHING, which is right for a spawn that never\n" +
  "              started. With --exit-code it is a FINISH: the run clock is stamped first and the claim\n" +
  "              dropped second, so the same firing is not immediately due again\n" +
  "  --exit-code the exit code the run finished with; makes this release a finish\n" +
  "  --claim-id  the token printed when the row was claimed. REQUIRED with --exit-code, so a worker whose\n" +
  "              claim expired cannot stamp the successor that took the row\n" +
  "  --home      the state home whose claims to write, instead of $SLOPWEAVER_HOME";

export const RECIPE_CLAIM_FLAG_SPEC = {
  boolean: ["release"],
  string: ["by", "claim-id", "exit-code", "home"],
} as const;

/** Every flag `automation claim` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_CLAIM_FLAG_NAMES: readonly string[] = [
  ...RECIPE_CLAIM_FLAG_SPEC.boolean,
  ...RECIPE_CLAIM_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_REPAIR_USAGE =
  "usage: slopweaver automation repair <recipeId> --row <slug> [--home <dir>]\n" +
  "  Say that the seat working board row <slug> has taken the repair of a recipe that stopped firing.\n" +
  "  A stop being fixed reaches the owner as a floating note naming the\n" +
  "  recipe and that seat — never a queue card, never blocked on them. A stop no seat has taken stays a loud card.\n" +
  "  The take lasts exactly as long as the row: once it is done, cancelled or rejected, or its run closes,\n" +
  "  the stop reads untaken again and the note is gone. Refused unless the recipe is defined and the row\n" +
  "  reads whole, is not terminal, and its run is not closed.\n" +
  "  --row       the board row whose seat is repairing it — `handover start` it first\n" +
  "  --home      the state home whose repairs register to write, instead of $SLOPWEAVER_HOME";

export const RECIPE_REPAIR_FLAG_SPEC = {
  boolean: [],
  string: ["row", "home"],
} as const;

/** Every flag `automation repair` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_REPAIR_FLAG_NAMES: readonly string[] = [
  ...RECIPE_REPAIR_FLAG_SPEC.boolean,
  ...RECIPE_REPAIR_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();

export const RECIPE_REGISTER_STANDING_USAGE =
  "usage: slopweaver automation register-standing\n" +
  "         [--repo <owner/name>] [--dry-run] [--json] [--home <dir>]\n" +
  "  Write back the rows this install declares that the definition store no longer holds. The definition\n" +
  "  directory is outside the repository, so deleting a standing row is silent and permanent: the\n" +
  "  `worktree-prune` row once left the store and nothing said so for seventeen\n" +
  "  days. `automation due` is what reports an absence; this is what answers it.\n" +
  "  It CREATES into an empty path, and writes over an occupied one only when that file — the id's one\n" +
  "  canonical `<recipeId>.json` — still holds exactly a row an earlier build declared (`automation due` calls\n" +
  "  it SUPERSEDED); that is how the daily worktree-prune row becomes hourly. A row that is paused, held or\n" +
  "  hand-edited is left exactly as it is — `automation due` already renders each of those states. The file is\n" +
  "  re-read just before the atomic rename; an edit landing inside that window is overwritten.\n" +
  "  Non-zero when a declared row is neither present nor written.\n" +
  "  What is declared: every install's generic rows, plus the rows of each TEAM repository registered in\n" +
  "  $SLOPWEAVER_HOME/live/recipe/team-repositories.json — a bump drive and a weekly Error Tracking batch. A\n" +
  "  fresh home registers none. A vulnerability-fix top-up is never declared here: it is an install's own\n" +
  "  definition, carrying its cadence and flags.\n" +
  "  --repo     register this team repository first (`owner/name`), then write its rows; a repeat is a no-op\n" +
  "  --dry-run  print what would be registered and written, and write nothing\n" +
  "  --json     emit one machine-readable document instead of the lines\n" +
  "  --home     the state home whose registry and definitions to write, instead of $SLOPWEAVER_HOME";

export const RECIPE_REGISTER_STANDING_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  string: ["home", "repo"],
} as const;

/** Every flag `automation register-standing` accepts, as the `--`-prefixed tokens a caller types. */
export const RECIPE_REGISTER_STANDING_FLAG_NAMES: readonly string[] = [
  ...RECIPE_REGISTER_STANDING_FLAG_SPEC.boolean,
  ...RECIPE_REGISTER_STANDING_FLAG_SPEC.string,
]
  .map((name) => `--${name}`)
  .toSorted();
