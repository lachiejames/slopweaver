/**
 * The thresholds block `plans list` opens with: one provider per block, one field per line, each marked `(set)` when
 * the register names it and `(default)` when it decodes to the default (`../../../plans/thresholds.ts`). Printed
 * even when no row is registered, because the bars are the install's, not any row's.
 *
 * Each line leads with the flag `plans set-thresholds` takes, so the line a reader is looking at is the command they
 * would type to change it. Pure: a snapshot in, lines out.
 */
import { thresholdFields, thresholdFieldsFor, thresholdFieldsSet } from "../../../plans/thresholds.js";
import type { PlanProvider, PlanRegisterSnapshot } from "../../../plans/types.js";

import { thresholdFlagFor } from "./thresholdArgs.js";

/**
 * One field's value with its unit: minutes for the spend-out lead time, a percent for every other.
 *
 * @param field the register's own field name
 * @param value its whole-number value
 * @returns such as `95%` or `300 min`
 */
function valueText({ field, value }: { field: string; value: number }): string {
  if (field === "spendOutBeforeResetMinutes") {
    return `${String(value)} min`;
  }
  return `${String(value)}%`;
}

/**
 * The thresholds block for the providers a list shows.
 *
 * @param providers which providers' blocks to print, in order
 * @param snapshot the register as it was read
 * @returns the lines, in print order
 */
export function thresholdListLines({
  providers,
  snapshot,
}: {
  providers: readonly PlanProvider[];
  snapshot: PlanRegisterSnapshot;
}): readonly string[] {
  const fields = thresholdFields({ document: snapshot.document });
  return providers.flatMap((provider) => {
    const values: Readonly<Record<string, number>> = { ...fields[provider] };
    const set = new Set(thresholdFieldsSet({ document: snapshot.document, provider }));
    const width = Math.max(
      ...thresholdFieldsFor({ provider }).map((field) => thresholdFlagFor({ field, provider }).length),
    );
    return [
      `${provider} thresholds:`,
      ...thresholdFieldsFor({ provider }).map((field) => {
        const flag = thresholdFlagFor({ field, provider }).padEnd(width);
        const origin = set.has(field) ? "(set)" : "(default)";
        return `  ${flag}  ${valueText({ field, value: values[field]! })} ${origin}`;
      }),
    ];
  });
}
