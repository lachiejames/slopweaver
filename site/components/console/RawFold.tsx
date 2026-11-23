/**
 * The raw message behind a plain line, folded: closed until the owner chooses to open it, then scrollable rather than tall.
 *
 * The owner rarely wants a raw stack trace; an accurate, concise explanation serves better. So every error and warning the console shows leads with one plain line, and the message it
 * was told from — a stderr tail, a stack, a service's JSON — sits here, under it, never above it. One component so
 * the fold reads the same on every page.
 */
import type { ReactElement } from "react";

import { plainReasonOf } from "../../lib/plainReason";
import { leadBeforeReason } from "../../lib/quotedReason";

/** What the closed fold says, the same everywhere so the owner learns it once. */
export const RAW_FOLD_LABEL = "Full message";

/**
 * The raw message, folded under its plain line.
 *
 * @param raw the message exactly as it was recorded
 * @returns a closed disclosure holding it
 */
export function RawFold({ raw }: { raw: string }): ReactElement {
  return (
    <details className="mt-0.5 text-[0.72rem] text-muted-foreground">
      <summary className="cursor-pointer select-none">{RAW_FOLD_LABEL}</summary>
      <pre className="m-0 mt-1 max-h-48 overflow-auto rounded-sm bg-muted/50 p-1.5 font-mono text-[0.7rem] whitespace-pre-wrap break-words">
        {raw}
      </pre>
    </details>
  );
}

/**
 * A reason as the console shows it: the console's own lead when it quotes one (`../../lib/quotedReason.ts`), its plain
 * line (`plainReasonOf`), then the raw message folded under it when the line is not the message itself. For a reason
 * drawn whole, such as a press's refusal, where a list of them is not. A fragment, so a caller's own block element
 * holds it: the fold is a `<details>`, which no `<p>` or `<span>` may.
 *
 * @param lead the console's own sentence quoting the reason, when it has one
 * @param why the reason exactly as it arrived
 * @returns the lead, the plain line and, when it differs, the fold
 */
export function PlainWhy({ lead, why }: { lead?: string; why: string }): ReactElement {
  const reason = plainReasonOf({ why });
  return (
    <>
      {lead === undefined ? null : leadBeforeReason({ lead })}
      {reason.plain}
      {reason.raw === undefined ? null : <RawFold raw={reason.raw} />}
    </>
  );
}
