import { cva, type VariantProps } from "class-variance-authority";
import type { ReactElement } from "react";
import { formatDisplayCount } from "@/lib/displayCount";
import { cn } from "@/lib/utils";

const counterLabelVariants = cva(
  "inline-flex min-w-[1.4rem] items-center justify-center rounded-full px-1.5 text-[0.68rem] leading-[1.5] font-semibold tabular-nums",
  {
    variants: {
      scheme: {
        primary: "bg-primary/20 text-foreground",
        secondary: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      scheme: "secondary",
    },
  },
);

/**
 * A small numeric pill: an unread count, a waiting count, a section total — the archive's `CounterLabel`,
 * re-drawn on the console's own tokens.
 *
 * @param count the number, printed in full up to `max`
 * @param max the largest number printed in full; past it the pill reads `max+`
 * @returns the pill
 */
function CounterLabel({
  count,
  max = 99,
  scheme,
  className,
  title,
}: VariantProps<typeof counterLabelVariants> & {
  count: number;
  max?: number;
  className?: string;
  title?: string;
}): ReactElement {
  return (
    <span data-slot="counter-label" className={cn(counterLabelVariants({ scheme }), className)} title={title}>
      {formatDisplayCount({ count, max })}
    </span>
  );
}

export { CounterLabel };
