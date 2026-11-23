import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

/**
 * The console's one progress indicator: a turning ring, with what it is waiting on as its accessible name and title
 * rather than as words on the page.
 *
 * Something not loaded yet is shown with a progress indicator, not with text, as other apps do. A line saying "reading the machine…" reads as a page that broke;
 * a spinner reads as one on its way. So the words survive only where a screen reader or a hover asks for them.
 *
 * The ring stops turning under `prefers-reduced-motion` and stays drawn, so the state still reads.
 *
 * `data-spinner` marks it as THE indicator, so the desktop walk (`src/cli/commands/desktop/e2ePage.ts`) can name what a
 * loading mark is waiting on from this label alone, never from some other labelled `<output>` that holds data. It is
 * deliberately not a loading selector itself: an inline ring beside a reading in hand says re-reading, not loading.
 *
 * @param label what is still on its way, spoken and shown on hover, never drawn
 * @param size the ring's size: `sm` inline beside a word or in a badge, `md` in a tile, `lg` where a page would be
 * @returns the indicator
 */
function Spinner({
  label,
  size = "md",
  className,
}: {
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}): ReactElement {
  const ring = { lg: "size-6", md: "size-[1.1rem]", sm: "size-3" }[size];
  return (
    <output
      data-spinner=""
      aria-label={label}
      title={label}
      className={cn("inline-flex text-muted-foreground", className)}
    >
      <LoaderCircle aria-hidden="true" className={cn("animate-spin motion-reduce:animate-none", ring)} />
    </output>
  );
}

/**
 * A whole section's loading state: the indicator centred in the room its content will take, so the section holds its
 * place instead of collapsing to a line and then jumping when the data arrives.
 *
 * @param label what the section is waiting on, as the indicator's accessible name
 * @returns the block
 */
function SpinnerBlock({ label, className }: { label: string; className?: string }): ReactElement {
  return (
    <div aria-busy="true" className={cn("flex min-h-[4.5rem] items-center justify-center", className)}>
      <Spinner label={label} size="lg" />
    </div>
  );
}

export { Spinner, SpinnerBlock };
