import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names the way every shadcn/ui and AI Elements component expects: `clsx` resolves the
 * conditional parts, then `tailwind-merge` drops a utility a later one overrides (`p-2` then `p-4` keeps
 * only `p-4`), so a caller's `className` wins over a component's default.
 *
 * @returns one class string
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
