"use client";

/**
 * Settings → Models' connected rows: one percentage drop-down per connected plan, in tens, pre-selected at the limit
 * the plan already carries — 100 on a plan nobody has limited — and nothing else to read.
 *
 * Onboarding pre-selects one hundred percent as a percentage drop-down in increments of ten, no words, with one
 * drop-down per plan when several are connected (a hundred percent of a personal plan, fifty percent of an enterprise
 * plan). So each row is the plan's account and its select; a choice presses `plans set-usage-limit`
 * at once, and the select draws the register's own value once the re-read lands. A refusal or an unknown outcome is
 * the only sentence the section ever draws, because a choice that did not land must never look as if it had.
 *
 * One choice at a time, for the whole section: from a press until its re-read lands every select is disabled, and
 * the press and its outcome belong to the section rather than to a row. So no re-read can land while a write is
 * pending, and a re-read that drops a plan cannot take a refusal down with that plan's row.
 */
import { type ChangeEvent, type ReactElement, useState } from "react";

import { ReadStandIn, StaleReadings } from "../live/LiveMarks";
import { type PlanLimit, type PlanLimitsView, readPlanLimits, USAGE_LIMIT_CHOICES } from "../live/readPlanLimits";
import { useLive } from "../live/useLive";
import { Button } from "../ui/button";
import { Outcome, type PressState, usePress, useSettling } from "./press";

/** The act a choice presses, and the reading it re-reads (`../../lib/actVerbs.ts`). */
const SET_USAGE_LIMIT = "plans-set-usage-limit";

/** The act that writes a found picture down, unlocking its drop-downs. */
const ADOPT = "plans-adopt";

/** The reading a choice re-reads, which is the one this section draws. */
const PLANS_SLUG = "plans";

/** The settling mark every choice in the section shares, so one choice holds every select until its re-read. */
const SECTION_KEY = "plan-limits";

/**
 * What a row is called: the account it is signed into, the way the owner names a plan, or its alias where the register has
 * cached no account.
 *
 * @returns the label
 */
function labelOf({ plan }: { plan: PlanLimit }): string {
  if (plan.email !== undefined) {
    return plan.email;
  }
  return plan.alias;
}

/** The plan a press was made on and the percent chosen, keyed the way rows are. */
interface Chosen {
  readonly key: string;
  readonly label: string;
  readonly percent: number;
  /** Which press this was, counted from the page's first, so two failures on one plan never share a key. */
  readonly seq: number;
}

/** A choice that did not land, and the outcome that said so. */
interface Failure {
  readonly chosen: Chosen;
  readonly state: PressState;
}

/**
 * A row's key: one plan, across readings.
 *
 * @returns the key
 */
function keyOf({ plan }: { plan: PlanLimit }): string {
  return `${plan.provider}:${plan.alias}`;
}

/**
 * One plan's row: its account and its drop-down.
 *
 * @param busy whether a choice anywhere in the section is still pending or not yet re-read
 * @param chosen the section's last choice, drawn on this row only while it is still pending and it was this row's
 * @param locked whether the register cannot be written yet, so the select is drawn but takes no choice
 * @param choose presses a choice for this plan
 * @returns the row
 */
function PlanRow({
  busy,
  chosen,
  choose,
  locked,
  plan,
}: {
  busy: boolean;
  chosen: Chosen | undefined;
  choose: (args: { plan: PlanLimit; percent: number }) => void;
  locked: boolean;
  plan: PlanLimit;
}): ReactElement {
  let shown = plan.percent;
  if (busy && chosen !== undefined && chosen.key === keyOf({ plan })) {
    shown = chosen.percent;
  }
  const label = labelOf({ plan });
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    choose({ percent: Number(event.target.value), plan });
  };
  return (
    <li className="flex items-center gap-3 text-sm">
      <span>{label}</span>
      <span className="text-[0.82rem] text-muted-foreground">{plan.provider}</span>
      <select
        aria-label={`${label} usage limit`}
        className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
        disabled={locked || busy}
        onChange={onChange}
        value={String(shown)}
      >
        {USAGE_LIMIT_CHOICES.map((percent) => (
          <option key={percent} value={String(percent)}>
            {String(percent)}%
          </option>
        ))}
      </select>
    </li>
  );
}

/**
 * The line under rows found on this Mac but never written down, whose drop-downs take no choice until they are: one
 * press keeps them (`plans adopt`), never a command to run.
 *
 * @returns the line and its press
 */
function KeepFoundPlans(): ReactElement {
  const { press, state } = usePress();
  return (
    <div className="flex flex-wrap items-center gap-3 text-[0.82rem] text-muted-foreground">
      <span>These plans were found on this Mac but aren&apos;t saved yet, so their limits can&apos;t be changed.</span>
      <Button
        size="sm"
        variant="outline"
        disabled={state.phase === "sending"}
        onClick={() => {
          void press({ readsSlug: PLANS_SLUG, slots: {}, slug: ADOPT });
        }}
      >
        Keep these plans
      </Button>
      <Outcome state={state} />
    </div>
  );
}

/**
 * Settings → Models' connected rows: one drop-down per plan. The section draws its heading and its Connect buttons.
 *
 * @returns the rows
 */
export function PlanLimits(): ReactElement {
  const plans = useLive<PlanLimitsView>({ read: readPlanLimits, slug: PLANS_SLUG });
  const { press, state } = usePress({ settles: SECTION_KEY });
  const settling = useSettling({ rowKey: SECTION_KEY });
  const [chosen, setChosen] = useState<Chosen | undefined>(undefined);
  const [failures, setFailures] = useState<readonly Failure[]>([]);
  const [presses, setPresses] = useState(0);
  const busy = state.phase === "sending" || settling;
  const [answered, setAnswered] = useState<PressState>(state);
  // Each press's answer is taken in once, while rendering the state that carries it: every failure is kept until a
  // later choice for the same plan lands, so no other choice erases its report.
  if (answered !== state) {
    setAnswered(state);
    if (chosen !== undefined && (state.phase === "refused" || state.phase === "unknown")) {
      setFailures([...failures, { chosen, state }]);
    } else if (chosen !== undefined && state.phase === "done") {
      setFailures(failures.filter((failure) => failure.chosen.key !== chosen.key));
    }
  }
  const choose = ({ plan, percent }: { plan: PlanLimit; percent: number }): void => {
    const seq = presses + 1;
    setPresses(seq);
    setChosen({ key: keyOf({ plan }), label: labelOf({ plan }), percent, seq });
    void press({
      readsSlug: PLANS_SLUG,
      // `from` is the limit this drop-down was drawn at, so the verb refuses a choice made off an older reading.
      slots: {
        allowance: plan.allowance,
        from: String(plan.percent),
        percent: String(percent),
        plan: plan.alias,
        provider: plan.provider,
      },
      slug: SET_USAGE_LIMIT,
    });
  };
  let body: ReactElement;
  if (plans.phase === "ready") {
    const locked = plans.value.unadoptedWhy !== undefined;
    body = (
      <>
        <ul className="m-0 grid list-none gap-2 p-0">
          {plans.value.plans.map((plan) => (
            <PlanRow key={keyOf({ plan })} busy={busy} chosen={chosen} choose={choose} locked={locked} plan={plan} />
          ))}
        </ul>
        {locked && <KeepFoundPlans />}
      </>
    );
  } else {
    body = <ReadStandIn state={plans} subject="your connected plans" block />;
  }
  return (
    <section aria-label="connected plans" className="grid gap-2">
      <StaleReadings row readings={[{ state: plans, subject: "your connected plans" }]} />
      {body}
      {failures.map((failure) => (
        <div key={String(failure.chosen.seq)} className="grid gap-1">
          <span className="text-[0.82rem] text-muted-foreground">
            {failure.chosen.label} at {String(failure.chosen.percent)}%
          </span>
          <Outcome state={failure.state} />
        </div>
      ))}
    </section>
  );
}
