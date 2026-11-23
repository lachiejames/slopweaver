/**
 * What a walk of the Admin console brings back, and the one rule that keeps a person out of it.
 *
 * ## Every route is normalised, and the rule is general rather than a list of families
 *
 * MEASURED on a real walk. The console's own pages link to routes carrying opaque
 * per-record ids, and they are not where a reader would guess. `/ac/users/<id>` is obvious. So are
 * `/ac/chrome/browsers/<uuid>`, `/ac/billing/subscriptions/<id>`, `/ac/billing/accounts/<id>/transactions`
 * and `/ac/managedsettings/<digits>` — and the first reduction written here named four families by hand
 * and missed three of those, because a hand-written list of families is a guess about a surface nobody has
 * enumerated.
 *
 * So {@link normaliseConsoleRoute} replaces any SEGMENT that looks like an opaque identifier, wherever it
 * sits, and the families are never named. That is the no-private-identifiers rule made mechanical: one
 * page of this console renders a link per person in the directory, so a walk that stored routes verbatim
 * would put the whole staff list in the atlas by accident.
 *
 * The rule is deliberately eager. A real route segment is a WORD somebody chose — `subscriptions`,
 * `orgunits`, `useractivity` — and an id is not. Over-normalising costs a route that reads
 * `/ac/foo/{id}` when `{id}` was a word; under-normalising costs a person's identifier on disk. Those are
 * not comparable, so this errs one way on purpose and says so.
 */
import { z } from "zod";

/** What one segment must look like to survive: letters, and long enough to be a word somebody chose. */
const WORDY = /^[a-z][a-z-]{1,}$/;

/**
 * Whether one path segment is an opaque identifier rather than a word somebody chose.
 *
 * @param segment one `/`-separated path segment
 * @returns true when it should be replaced by a placeholder
 */
export function isOpaqueSegment({ segment }: { segment: string }): boolean {
  if (segment.length === 0 || segment === "{id}") {
    return false;
  }
  if (WORDY.test(segment)) {
    return false;
  }
  // Anything else — mixed case, digits, hyphenated UUIDs, base64-ish keys — is an id. `v1`, `v2` and the
  // like are the one lowercase-plus-digit shape worth keeping, because they are versions rather than ids.
  return !/^v\d+$/.test(segment);
}

/**
 * Replace every opaque identifier in a console route with a placeholder.
 *
 * @param path the console path exactly as the page linked it
 * @returns the route with each id segment replaced by `{id}`, and any trailing slash removed
 */
export function normaliseConsoleRoute({ path }: { path: string }): string {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = trimmed.split("/").map((segment) => (isOpaqueSegment({ segment }) ? "{id}" : segment));
  return segments.join("/");
}

/**
 * One page a walk actually opened.
 *
 * `screenshot` is nullable and is null on every page today. That is the measured limit of the route into
 * the owner's own Chrome rather than a shortcoming of this walk — `docs/browser-route/brief-profile-and-walks.md` records that the
 * extension answers with an image to the MODEL and never writes a file a verb could read back. So a walk
 * judges each page loaded by what it rendered, and the atlas says `reached but not photographed` rather
 * than claiming a proof it does not hold.
 * @internal
 */
export const googleAdminWalkedPageSchema = z
  .object({
    /** Whether the page rendered console chrome, judged by the walker rather than by an HTTP status. */
    reached: z.boolean(),
    /** The route asked for, normalised. */
    route: z.string().min(1),
    /** Where the browser actually settled, normalised — how a redirect becomes visible. */
    settledRoute: z.string().min(1),
    /** The page's own title as rendered, or `null` when none was read. */
    title: z.string().min(1).nullable(),
  })
  .strict();

/**
 * One page a walk opened.
 * @internal
 */
export type GoogleAdminWalkedPage = z.infer<typeof googleAdminWalkedPageSchema>;

/**
 * What one walk of the console brings back.
 *
 * `observedRoutes` is every route the pages it opened LINKED to, which is a wider set than the pages it
 * opened. Keeping the two apart is the whole honesty of the browser surface: a route this atlas has seen
 * named is not a page it has looked at, and the Slack atlas's "reported nine, reached one" failure is what
 * makes the distinction worth a field rather than a comment.
 * @internal
 */
export const googleAdminWalkObservationSchema = z
  .object({
    /** Every route the opened pages linked to, normalised, sorted, deduplicated. */
    observedRoutes: z.array(z.string().min(1)),
    pages: z.array(googleAdminWalkedPageSchema),
    /** When the walk ran, which is also what stamps the coverage cell. */
    walkedAtIso: z.iso.datetime(),
  })
  .strict();

/**
 * What one walk brings back.
 * @internal
 */
export type GoogleAdminWalkObservation = z.infer<typeof googleAdminWalkObservationSchema>;
