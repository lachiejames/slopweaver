/**
 * The addresses every Clerk dashboard walk test file shares — the instance root a walk learns, the two probes it
 * asks first and one instance page — plus a sink recording every root a walk remembers. Pure data and one
 * in-memory recorder; nothing here touches a disk or a browser.
 */
import {
  CLERK_APPLICATIONS_PROBE_PATH,
  CLERK_DASHBOARD_ORIGIN,
  CLERK_INSTANCE_PROBE_PATH,
} from "../../../../../atlas/clerk/dashboardAddress.js";

/** The instance root every signed-in fake dashboard in these files settles on. */
export const INSTANCE_ROOT = "/apps/app_2abcdefghijklmnop/instances/ins_2abcdefghijklmnop";
/** The bare-origin probe a walk asks first, purely to learn the root. */
export const PROBE_URL = `${CLERK_DASHBOARD_ORIGIN}${CLERK_INSTANCE_PROBE_PATH}`;
/** The application-list probe a walk falls back to. */
export const APPLICATIONS_URL = `${CLERK_DASHBOARD_ORIGIN}${CLERK_APPLICATIONS_PROBE_PATH}`;
/** One instance page, the address a settle is judged against. */
export const PAGE_URL = `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}/users`;

/**
 * A sink that records every root handed to it, so "it remembered" is an assertion rather than a silence.
 *
 * @returns the `remember` callback a walk is handed, and the roots it has recorded so far
 */
export function recordingSink(): { remember: (input: { root: string }) => void; roots: readonly string[] } {
  const roots: string[] = [];
  return { remember: ({ root }) => roots.push(root), roots };
}
