/**
 * The two shapes a calendar write plan carries that need nothing of the intent: the one SDK call it makes, and
 * whether it reaches anyone but the owner. `writePlan.ts` builds both. Types only.
 */
import type { calendar_v3 } from "@googleapis/calendar";

/**
 * The one SDK call a plan makes.
 *
 * @internal — carried as {@link ./writePlan.CalendarWritePlan}'s `mutation`; only writePlan.ts names the type.
 */
export type CalendarMutation =
  | { readonly kind: "insert"; readonly body: calendar_v3.Schema$Event }
  | { readonly kind: "patch"; readonly etag: string; readonly body: calendar_v3.Schema$Event }
  | { readonly kind: "delete"; readonly etag: string };

/** Whether a write reaches anyone but the owner, and every reason it does. */
export interface OutwardVerdict {
  readonly outward: boolean;
  readonly reasons: readonly string[];
}
