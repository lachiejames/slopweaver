/**
 * The verb contract: {@link CommandMeta}, the machine-enumerable description of what a verb DOES, and
 * {@link defineCommand}, the boundary a command module declares its behaviour through.
 *
 * ## One declaration, not two
 *
 * `CommandMeta` is owned by the MANIFESTS (`cli/manifests/<noun>.ts`) and by nothing else. `NOUN_GROUPS` is
 * folded straight from the manifest barrel and imports no command module, so the manifest copy is what
 * `--help`, `catalog`, `discoverCommands` and the door-coverage gate all read.
 *
 * `defineCommand` used to take the same ten fields a second time and hang them off the returned function.
 * Nothing compared the copies: measured across all 44 verb entries, 20 fields disagreed — twelve `usage`
 * strings, four `example`s, two `summary`s and two booleans (`dev lint · parseRejectIsIoFree`,
 * `codex status · diagnostic`) — and the two most recent PRs had each added a fresh disagreement. Because
 * only the manifest copy was ever read, every one of those was dead metadata that looked authoritative.
 *
 * So the second declaration is gone rather than merely corrected: a copy that cannot exist cannot drift.
 *
 * Kept tiny + pure: no I/O, no console, no global state.
 */
import type { DoorEffect } from "../admit/types.js";

/**
 * Typed, machine-enumerable description of a verb. EVERY field is required — a verb spells out its full
 * contract at the call site (no optional flag silently reading as false, masking a side effect or a
 * capability). `example` is `string | null` (null = "no example", stated explicitly).
 *
 * ## The field that used to be here
 *
 * `requiresApproval: boolean` was removed rather than corrected. Its own manifests described it as "the
 * CATALOG's mutation marker … not an interactive prompt", so it was a second, unenforced spelling of
 * {@link effect}`=== "external-write"` — and `catalog` rendered it as `[approval]`, which read as a safety
 * property no code anywhere supplied. `src/admit/approval.ts` carries the whole finding. Approval is a
 * property of a REQUEST, not of a verb: the same verb is approved when the caller shows the digest and
 * refused when they do not, so it lives on `DoorMeta` where the door can enforce it, and nowhere else.
 * This is the same reasoning that removed the duplicated meta from {@link defineCommand} — a copy that
 * cannot exist cannot drift.
 */
export interface CommandMeta {
  /** One line: what the verb does. Feeds `catalog` + help. */
  readonly summary: string;
  /** Single `usage: slopweaver <noun> <verb> [...]` line. Printed on a parse error. */
  readonly usage: string;
  /** A copy-pasteable invocation for help + the catalog, or `null` when there isn't one. */
  readonly example: string | null;
  /** Whether running this verb creates a tracked work item. */
  readonly createsWorkItem: boolean;
  /**
   * What this verb does to the world (the door's coverage axis). `none`/`external-read` touch nothing
   * persistent; `local-state` writes only under `$SLOPWEAVER_HOME` (the product working normally);
   * `external-write` MUTATES something outside the machine and MUST be `doorRouted`.
   */
  readonly effect: DoorEffect;
  /** Whether an `external-write` verb routes its effect through the door (`throughDoor`). Coverage requires it. */
  readonly doorRouted: boolean;
  /**
   * Whether invoking this verb with NO args, `--help`, or an unknown flag prints usage / a parse error
   * and returns WITHOUT any side effect (no network, no fs write, no process spawn) — its parse phase is
   * provably separable from its act phase.
   */
  readonly dryParseSafe: boolean;
  /**
   * Whether the verb's arg/usage REJECT path (unknown flag, missing value, malformed arg → `EXIT_USAGE`)
   * is provably I/O-free, EVEN THOUGH a valid bare invocation may do I/O. The narrower sibling of
   * {@link dryParseSafe}; a `dryParseSafe` verb already satisfies it.
   */
  readonly parseRejectIsIoFree: boolean;
  /**
   * Whether this verb is a DIAGNOSTIC / health-check whose non-zero exit REPORTS A FINDING rather than
   * signalling a broken tool (e.g. `doctor` exits non-zero when the env is unhealthy — it worked
   * perfectly, it found a fault). A THROWN error is still a real bug.
   */
  readonly diagnostic: boolean;
}

/** The argv->exit-code run function a verb supplies — the contract the CLI runtime dictates. */
export type CommandRun = (argv: readonly string[]) => Promise<number> | number;

/** What a command module declares: its behaviour, and nothing else. */
export interface DefineCommandInput {
  readonly run: CommandRun;
}

/**
 * Declare a verb's behaviour. Returns the run function itself.
 *
 * This used to also take the verb's metadata and hang it off the returned function. That metadata was a
 * SECOND declaration of a contract the manifest already owned, and nothing compared the two — measured
 * across all 44 verb entries, 20 fields disagreed, including two booleans. Nothing read the command-module
 * copy: `--help`, `catalog`, `discoverCommands` and the door-coverage gate all resolve through
 * `NOUN_GROUPS`, which is built purely from the manifest barrel and loads no command module.
 *
 * The helper is kept rather than deleted so a command module still has one uniform, named-object boundary
 * to declare through — but it can no longer carry anything that could disagree with the manifest.
 *
 * @param run the verb's behaviour
 * @returns the run function, unchanged
 */
export function defineCommand({ run }: DefineCommandInput): CommandRun {
  return run;
}
