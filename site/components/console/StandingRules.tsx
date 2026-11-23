/**
 * The acts the owner's standing rules already answered, on the Alignment page: a chip beside its count of acts, and one
 * closed fold naming each rule, how many cards it took off the page, the owner's own words and where they said them, and
 * the cards. Applying the standing approval rules up front cuts the page's count down to 100. The
 * derivation is `../../lib/standingRules.ts`; nothing here acts, and nothing leaves the ledger.
 */
import type { ReactElement } from "react";

import type { StandingRuleSettlement } from "../../lib/standingRules";
import { markedCount } from "../../lib/workspacePlacementContext";
import { CHIP } from "./controls";
import { FindingMark, FoldedMarked } from "./workContextState";

/**
 * The chip: how many acts the owner's standing rules took off the page, over the same filtered list the page's count of acts
 * reads. Drawn only once that list has read; until then the page draws the ledger's spinner or staleness mark instead.
 *
 * @param rules the rules and what each settled, already filtered as the page's acts are
 * @param filtered whether the tag filter narrowed the count
 * @returns the chip
 */
export function StandingChip({
  rules,
  filtered,
}: {
  rules: readonly StandingRuleSettlement[];
  filtered: boolean;
}): ReactElement {
  const total = rules.reduce((sum, rule) => sum + rule.count, 0);
  return (
    <span className={CHIP} title="acts a rule you already gave answers; each is listed under the rule below">
      <b>{String(total)}</b> settled by your standing rules{filtered ? " that match the tag filter" : ""}
    </span>
  );
}

/**
 * The fold: one closed disclosure, one row per rule, largest first, each opening onto the owner's words and its cards.
 *
 * @param rules the rules and what each settled, already filtered as the page's acts are
 * @returns the fold, or nothing when no rule settled a card here
 */
export function StandingRulesFold({ rules }: { rules: readonly StandingRuleSettlement[] }): ReactElement | null {
  if (rules.length === 0) {
    return null;
  }
  const total = rules.reduce((sum, rule) => sum + rule.count, 0);
  // A settled card that is a finding is placed by the default rule, so it wears its mark here as on the list, and each
  // closed fold says how many it holds.
  const marked = markedCount({ rows: rules.flatMap((rule) => rule.rows) });
  return (
    <details className="group mt-[0.6rem] mb-[0.2rem]" data-testid="standing-rules">
      <summary className="cursor-pointer text-[0.82rem] text-muted-foreground group-open:mb-[0.6rem]">
        {`${String(total)} acts your standing rules already answered, by rule, off this page, still in the ledger`}{" "}
        <FoldedMarked count={marked} />
      </summary>
      <ul className="m-0 list-none pl-0">
        {rules.map((rule) => (
          <li key={rule.classId} className="mb-[0.4rem]">
            <details className="group/rule">
              <summary className="cursor-pointer text-[0.8rem]">
                <b>{String(rule.count)}</b> · <code>{rule.classId}</code>{" "}
                <FoldedMarked count={markedCount({ rows: rule.rows })} />
              </summary>
              <blockquote className="my-[0.4rem] border-l-2 border-border pl-[0.7rem] text-[0.8rem] italic">
                {rule.words}
              </blockquote>
              <p className="my-[0.2rem] text-[0.75rem] text-muted-foreground">
                said at <code>{rule.anchor}</code>
              </p>
              <ul className="my-[0.3rem] list-disc pl-[1.1rem] text-[0.78rem] text-muted-foreground">
                {rule.rows.map((row) => (
                  <li key={row.key}>
                    <code>{row.pill}</code> {row.card.question} <FindingMark placement={row.placement} />
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}
