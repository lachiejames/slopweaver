/**
 * The escape-hatch VOCABULARY — the one shape every refusal in this repository names its way through in.
 *
 * ## Why this is a type rather than a convention
 *
 * Every rule has an exception to be found, so a hatch belongs on **pretty much everything**; and the blocks
 * and escape hatches are formalised so that it is structurally impossible to deviate. A prose convention is exactly what the audit measured
 * failing: 29 sites in `src/` render a door refusal to a caller and **0** of them print the override token
 * the door's own contract guarantees, while 41 of the 46 lint gates name no way through at all.
 *
 * So the shape is a type, the set is a register ({@link ./registry}), the message is emitted by one pure
 * function ({@link ./render}), and `src/devLint/escapeHatch.ts` refuses a hatch that is not declared here.
 * A future feature adds a row; it cannot add a bespoke refusal string.
 *
 * ## The two incantation families, in one register
 *
 * Two mechanisms already exist and neither is going away: an ambient variable set to `1` (nearly always
 * `SLOPWEAVER_ALLOW_<SUFFIX>`) read by the module that refuses, and the door's own
 * `SLOPWEAVER_DOOR_OVERRIDE=<token>` list waiving one `warn`.
 * An outbound gate that is not a door carries neither: its `grant` key opens on a journalled grant alone.
 * {@link HatchKey} is the union of the two, so one register covers both and a reader never has to know
 * which family a given gate belongs to — {@link hatchIncantation} spells whichever applies.
 */

/**
 * How a hatch is actually opened — the two mechanisms this repo already ships, and no third.
 *
 * @internal — a field type of {@link EscapeHatch}; callers read the hatch, never the key alone.
 */
export type HatchKey =
  /**
   * An ambient variable set to `1`, read by the refusing module for itself — named in FULL. Nearly every one is
   * `SLOPWEAVER_ALLOW_<SUFFIX>`, the ruled shape; `ALLOW_FABLE_OVERRIDE` is the one that is not, because it is
   * the owner's own name for the hatch, and the row carries the name rather than rebuilding it.
   */
  | { readonly kind: "env"; readonly variable: string }
  /** A `warn` token waived through the door's `$SLOPWEAVER_DOOR_OVERRIDE` comma list (e.g. `answer.quality:v1`). */
  | { readonly kind: "door-token"; readonly token: string }
  /**
   * A journalled grant and nothing else — `slopweaver hatch open <id>`, read back by `./open.ts`.
   *
   * The key an outbound gate that is not a door carries. No variable opens it: an exported one would survive
   * the shell and waive the rule for every later send with no line left to read, which is what the
   * journalled outbound lane exists to end.
   */
  | { readonly kind: "grant" }
  /**
   * A FLAG or verb the operator types instead — `--acknowledge <path>`, `slopweaver audit hygiene --scrub`.
   *
   * It exists because an escape-hatch audit once measured this family wrong. Its sweep read one module
   * at a time, so `outbound/github/mergeGuard.ts` was reported as offering nothing while its escape sat in
   * `cli/commands/github/mergeCore.ts` — which already accepts a `reverts-main` finding by subject AND
   * prints `--acknowledge <subject,...>` in its own verdict line. The page carried that as a confirmed
   * defect and it was a false positive of exactly the class the page described. The lesson is the variant:
   * a named command IS a working hatch, so the register has to be able to hold one, or the next audit
   * proposes a second env var beside a mechanism that already works.
   */
  | { readonly kind: "command"; readonly incantation: string };

/**
 * How a hatch is SPENT — the axis the owner settled: journalled on outbound only.
 *
 * @internal — a field of {@link EscapeHatch}; `src/devLint/escapeHatch.ts` checks it against the row's group.
 */
export type HatchLane =
  /** An ambient variable or flag, typed inline on the one re-run. Right for a one-off, risky command. */
  | "ambient"
  /** A grant that names the session, carries a written reason and expires. Every OUTBOUND row. */
  | "journalled";

/**
 * Whether the owner has ruled on a hatch's exception list, or it is still a proposal awaiting the owner's reaction.
 *
 * @internal — a field type of {@link EscapeHatch}.
 */
export type HatchStanding =
  /** The owner has ruled on this hatch's exceptions; the list below is their word. */
  | "ruled"
  /** Proposed by a session and listed on the escape-hatch artifact for the owner to narrow, widen or reject. */
  | "proposed";

/**
 * One escape hatch: everything an agent needs to decide whether to use it, and nothing it has to go and
 * look up. The three fields the owner named as required are {@link EscapeHatch.command},
 * {@link EscapeHatch.exceptions} and the variable carried in {@link EscapeHatch.key}.
 */
export interface EscapeHatch {
  /** Stable id, kebab-case — what a gate imports and what the artifact and the register key on. */
  readonly id: string;
  /** How the hatch is opened. */
  readonly key: HatchKey;
  /** What is blocked, as the owner would type it: `slopweaver slack post --as me`, `git commit` in main. */
  readonly command: string;
  /**
   * What caught it and WHY, in one clause that reads after "blocked because" — the convention, the rule, or
   * the measurement. Never just the gate's name: a refusal that does not say why is one an agent cannot
   * weigh, which is the whole defect this register exists to close.
   */
  readonly caught: string;
  /**
   * Legitimate exceptions, in the agent's own decision terms — at least one, because a hatch with no example
   * of when to use it is a hatch nobody will use. Non-empty by TYPE, so the field cannot be filled with `[]`.
   */
  readonly exceptions: readonly [string, ...(readonly string[])];
  /** The repo-relative module that reads the key and refuses. Checked by `src/devLint/escapeHatch.ts`. */
  readonly reader: string;
  /** Whether the exception list is the owner's word or a session's proposal. */
  readonly standing: HatchStanding;
  /**
   * How the hatch is spent. Every outbound row is `journalled` and every other row is `ambient`, which is
   * the owner's ruling rather than a default — see {@link HatchLane}.
   */
  readonly lane: HatchLane;
}

/**
 * A `SLOPWEAVER_ALLOW_<SUFFIX>` variable from its suffix — the family name a reader builds when it spells
 * only the suffix. A row carries the FULL name in its key, so nothing here is how the register is read.
 *
 * @param suffix the register's suffix for this hatch
 * @returns the full variable name, `SLOPWEAVER_ALLOW_<suffix>`
 */
export function hatchEnvVar({ suffix }: { suffix: string }): string {
  return `SLOPWEAVER_ALLOW_${suffix}`;
}

/**
 * The exact incantation an agent types to open a hatch — the `VAR=value` half, without the command.
 *
 * A `journalled` row answers with the grant verb rather than its key: the key is what the CODE reads, and
 * for that lane the operator never types it — they take a grant and re-runs.
 *
 * @param hatch the hatch being named
 * @returns the grant verb for a journalled row, else the row's variable `=1`, a door token, or a flag
 */
export function hatchIncantation({ hatch }: { hatch: EscapeHatch }): string {
  if (hatch.lane === "journalled" || hatch.key.kind === "grant") {
    return `slopweaver hatch open ${hatch.id} --reason "<why this one is a legitimate exception>", then re-run`;
  }
  if (hatch.key.kind === "env") {
    return `${hatch.key.variable}=1`;
  }
  if (hatch.key.kind === "door-token") {
    return `SLOPWEAVER_DOOR_OVERRIDE=${hatch.key.token}`;
  }
  return hatch.key.incantation;
}
