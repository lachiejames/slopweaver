/**
 * Whether an `export NAME=1` earlier in one invocation still covers a later command, for `./shellSegments.ts`'s
 * hatch resolution: one pure step per segment. Every rule leans the same way — when a shell MAY not have run the
 * export, the command after it is uncovered, so a doubt costs a refusal and never opens a hatch.
 */

/** What one segment's own command does to the variable. */
export type SegmentOverrideOp =
  | { readonly kind: "export-set"; readonly matchesOne: boolean }
  | { readonly kind: "bare-set"; readonly matchesOne: boolean }
  | { readonly kind: "unset" }
  | { readonly kind: "unrelated" };

/**
 * The walk's state: whether the variable is `1` for a later command (`active`), whether it certainly carries
 * the export attribute (`exported`), and whether `active` rests on a segment a short-circuit could have skipped
 * (`conditional`), which holds only along an unbroken `&&` chain.
 */
export interface ExportState {
  readonly active: boolean;
  readonly exported: boolean;
  readonly conditional: boolean;
}

/** No export in scope. */
export const NO_EXPORT: ExportState = { active: false, conditional: false, exported: false };

/**
 * One segment's effect on the state. A pipe's right side is a subshell, so it passes `"piped"` and keeps
 * nothing. An export entered through `||` may have been skipped whenever what follows runs, and one entered
 * through `&&` stays in force only while every later separator is `&&` too: `false && export NAME=1; cmd` and
 * `true || export NAME=1; cmd` leave `cmd` uncovered. Only `&&`, `;` and a newline
 * keep anything for the next segment.
 *
 * @param state the state before this segment
 * @param op what the segment does to the variable, or `"piped"` when it runs in a pipe's subshell
 * @param entry the separator before the segment, when there is one
 * @param exit the separator after it, when there is one
 * @returns the state the next segment starts from
 */
export function exportStep({
  entry,
  exit,
  op,
  state,
}: {
  entry: string | undefined;
  exit: string | undefined;
  op: SegmentOverrideOp | "piped";
  state: ExportState;
}): ExportState {
  const next = op === "piped" ? NO_EXPORT : applied({ entry, op, state });
  if (exit !== "&&" && exit !== ";" && exit !== "\n") {
    return NO_EXPORT;
  }
  return next.conditional && exit !== "&&" ? { ...next, active: false, conditional: false } : next;
}

/** The state once this segment's own operation has run, or might have. */
function applied({
  entry,
  op,
  state,
}: {
  entry: string | undefined;
  op: SegmentOverrideOp;
  state: ExportState;
}): ExportState {
  if (op.kind === "unset") {
    return NO_EXPORT;
  }
  const sets = op.kind === "export-set" || (op.kind === "bare-set" && state.exported);
  if (!sets) {
    return state;
  }
  const skippable = entry === "&&" || entry === "||";
  const exported = op.kind === "export-set" ? !skippable || state.exported : state.exported;
  return { active: op.matchesOne && entry !== "||", conditional: skippable || state.conditional, exported };
}
