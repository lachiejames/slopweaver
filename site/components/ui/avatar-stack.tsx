import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const OVERFLOW_SIZE = { lg: "size-10 text-sm", md: "size-8 text-xs", sm: "size-5 text-[0.6rem]" } as const;

/**
 * Overlapping avatars, the first `max` drawn and the rest counted in a `+N` disc — the archive's
 * `AvatarStack`.
 *
 * @param children one avatar per person, in the order they should overlap
 * @param max how many are drawn before the rest are counted
 * @returns the stack
 */
function AvatarStack({
  children,
  size = "md",
  max = 3,
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  max?: number;
  className?: string;
}): ReactElement {
  // `toArray` gives every element a key, its own or else its place, so each wrapper takes that one.
  const avatars = Children.toArray(children).filter(isValidElement);
  const visible = avatars.slice(0, max);
  const remaining = avatars.length - visible.length;
  return (
    <span data-slot="avatar-stack" className={cn("inline-flex -space-x-1.5", className)}>
      {visible.map((avatar, index) => (
        <span
          key={avatar.key}
          className="relative inline-flex rounded-full ring-2 ring-background"
          style={{ zIndex: visible.length - index }}
        >
          {avatar}
        </span>
      ))}
      {remaining > 0 ? (
        <span
          className={cn(
            "relative inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background",
            OVERFLOW_SIZE[size],
          )}
        >
          +{String(remaining)}
        </span>
      ) : null}
    </span>
  );
}

export { AvatarStack };
