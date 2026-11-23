"use client";

import type { ReactElement } from "react";

import { ageAt } from "../../lib/ageOf";
import { useNow } from "../console/QueueSections";

/**
 * How often a drawn age is re-told. Ten seconds is `ageAt`'s finest rung (`just now` gives way to `12s ago`), so a
 * reading's age never lags its own scale by more than one step.
 */
const AGE_TICK_MS = 10_000;

/**
 * A reading's age that keeps counting while the page stays open (a number that cannot be
 * live yet shows its own age). An age told once at render froze wherever nothing re-rendered it: a read-once tile drew
 * `just now` for as long as the page stayed open, the opposite of what the stamp is for.
 *
 * @param iso when the reading was true
 * @param title the hover sentence, when the age needs one
 * @param className the caller's spacing and weight
 * @returns the age, re-told every ten seconds
 */
export function ReadingAge({
  iso,
  title,
  className,
}: {
  iso: string;
  title?: string | undefined;
  className?: string | undefined;
}): ReactElement {
  const nowMs = useNow({ everyMs: AGE_TICK_MS });
  return (
    <span className={className} title={title}>
      {ageAt({ iso, nowMs })}
    </span>
  );
}
