"use client";

import type { ReactElement } from "react";

import { Spinner, SpinnerBlock } from "../ui/spinner";

/**
 * The mark every console page draws while a read it waits on is in flight: the console's one progress indicator
 * (`../ui/spinner.tsx`), never a sentence.
 *
 * A region not yet loaded is shown with a progress indicator, never with text, because everyone recognizes the
 * indicator. What it is reading is still said — to a screen reader and on hover — but never printed where the data will be.
 *
 * One per loading region: it is an `<output>`, a `status`, so a row of them would announce over each other.
 *
 * @param label what it is reading, for a screen reader and the hover
 * @param block draw it centred in a box of its own, where the data will be, rather than inline beside other words
 * @param className spacing the page gives it
 * @returns the indicator
 */
export function ReadingIndicator({
  label,
  block = false,
  className,
}: {
  label: string;
  block?: boolean;
  className?: string;
}): ReactElement {
  if (block) {
    return <SpinnerBlock label={label} {...(className === undefined ? {} : { className })} />;
  }
  return <Spinner label={label} size="sm" {...(className === undefined ? {} : { className })} />;
}
