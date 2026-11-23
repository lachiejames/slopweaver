/**
 * A count as a counter pill prints it: the number, or `max+` once it passes the cap.
 *
 * A negative count is printed as it is rather than clamped to zero: zero is a measured claim, and a
 * negative number is a defect upstream that the pill should show rather than hide.
 *
 * @param max the largest number printed in full
 * @returns the decimal count, or `${max}+` above the cap
 */
export function formatDisplayCount({ count, max }: { count: number; max: number }): string {
  if (count > max) {
    return `${String(max)}+`;
  }
  return String(count);
}
