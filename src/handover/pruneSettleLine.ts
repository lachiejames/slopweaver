/**
 * The `handover settle` command a prune verdict offers — the one place its shell line is built.
 *
 * Both interpolations go through `./runOwner.ts`'s `shellValue`, which already exists for exactly this reason
 * and already carries the measurement: `$` and a backtick stay ACTIVE inside double quotes, so a
 * `JSON.stringify`-quoted argument is not a safe paste. This function's first draft did use `JSON.stringify`
 * and review caught it — a witness is a run journal's own prose, which routinely carries a backticked
 * identifier. Reusing `shellValue` rather than minting a second copy is the point of the fix, not incidental
 * to it: the duplicated-quoting family is one a gate and a review both watch for here.
 */
import type { AskSettlement } from "./rowKind.js";
import { shellValue } from "./runOwner.js";

/**
 * The settle command that performs or proposes a verdict, witness and all.
 *
 * @param slug the row the command settles
 * @param settlement how it settles, `answered` unless the verdict says otherwise
 * @param summary the `--witness` value, quoted for a shell paste
 * @returns the command line
 */
export function pruneSettleLine({
  slug,
  summary,
  settlement = "answered",
}: {
  slug: string;
  summary: string;
  settlement?: AskSettlement;
}): string {
  return `slopweaver handover settle ${shellValue({ value: slug })} --as ${settlement} --witness ${shellValue({ value: summary })}`;
}
