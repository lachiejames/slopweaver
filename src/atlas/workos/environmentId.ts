/**
 * Resolving THIS installation's WorkOS environment segment, and saying honestly when there isn't one.
 *
 * Most of the dashboard hangs off `/environment_<id>/` (`dashboardPages.ts`), and that id is this
 * installation's own. AGENTS.md — "tools in the codebase, state outside it" — puts it outside git
 * altogether, so it resolves at runtime from `$SLOPWEAVER_HOME` and this file is where.
 *
 * ## Two routes, in precedence order, mirroring `credential.ts`
 *
 * 1. `WORKOS_ENVIRONMENT_ID` in the environment, when it is set — what an install with no walk yet, or one
 *    deliberately mapping a sibling environment, has to say so with;
 * 2. the atlas's OWN witnessed page rows, under `$SLOPWEAVER_HOME/atlas/workos/`.
 *
 * ## Why the witness is the `finalUrl` and never the address we asked for
 *
 * A walk records both: `deepLink` is the address this repository built and `detail.finalUrl` is where the
 * browser actually ended. Reading the id out of the address we built would be circular — it would only ever
 * hand back what was already resolved. The `finalUrl` is WorkOS's own answer, and MEASURED it
 * carries the segment for free: a walk of the bare `/api-keys` and `/webhooks` was redirected to
 * `/environment_<id>/api-keys` and `/environment_<id>/webhooks` by the dashboard itself. That redirect is
 * the bootstrap this whole scheme stands on, which is why an unresolved environment route is still
 * published at its bare path rather than as no address at all.
 *
 * ## Two witnesses that disagree resolve to NOTHING, and say so
 *
 * One generation holding two distinct environment segments means a walk was taken somewhere this atlas's
 * content half is blind to, and picking one of them would deep-link every row into an environment its
 * detail does not describe. So it is `unknown`, with a reason naming both — `sync.ts` puts that reason on
 * the `dashboard-environment-unresolved` gap rather than letting the atlas stop deep-linking in silence.
 */

/** The environment variable checked before the generation's own witnesses. */
export const WORKOS_ENVIRONMENT_ID_ENV = "WORKOS_ENVIRONMENT_ID";

/**
 * The prefix WorkOS gives the segment. Carried here so a caller never assembles one by hand.
 *
 * @internal
 */
export const WORKOS_ENVIRONMENT_SEGMENT_PREFIX = "environment_";

/**
 * Where a resolved segment came from, so a coverage cell can say which.
 *
 * @internal
 */
export type WorkosEnvironmentSource = "environment-variable" | "witnessed-walk";

/**
 * This installation's environment segment, or why there is none.
 *
 * @internal
 */
export type WorkosEnvironmentResolution =
  | { readonly state: "resolved"; readonly environmentId: string; readonly source: WorkosEnvironmentSource }
  | { readonly state: "unknown"; readonly reason: string };

/**
 * One stored page row, as much of it as this resolver reads.
 *
 * Declared structurally rather than as the atlas's own entity type, because the only thing being asked of
 * a row is "did a browser end somewhere, and where" — and a resolver that takes the narrower shape is a
 * pure function a test can call with two lines of fixture.
 *
 * @internal
 */
export interface WorkosWitnessedFinalUrl {
  readonly channels: { readonly browser: { readonly detail: unknown } | null };
}

/**
 * The `environment_<id>` segment one URL hangs off.
 *
 * @param url the address to read
 * @returns the segment, or `null` when the URL is unparseable or hangs off no environment
 */
export function workosEnvironmentSegmentFromUrl({ url }: { url: string }): string | null {
  const parsed = parseUrl({ url });
  if (parsed === null) {
    return null;
  }
  const first = parsed.pathname.split("/").find((segment) => segment.length > 0);
  if (first === undefined) {
    return null;
  }
  return validSegment({ candidate: first });
}

/**
 * Resolve this installation's environment segment from the environment, else from what a walk witnessed.
 *
 * @param env the process environment, consulted first
 * @param pages every `page` entity the generation holds
 * @returns the segment and where it came from, or the reason there is none
 */
export function resolveWorkosEnvironmentId({
  env,
  pages,
}: {
  env: Readonly<Record<string, string | undefined>>;
  pages: readonly WorkosWitnessedFinalUrl[];
}): WorkosEnvironmentResolution {
  const declared = env[WORKOS_ENVIRONMENT_ID_ENV];
  if (declared !== undefined && declared.trim().length > 0) {
    const segment = validSegment({ candidate: normalised({ value: declared.trim() }) });
    if (segment === null) {
      return {
        reason:
          `$${WORKOS_ENVIRONMENT_ID_ENV} is set to "${declared.trim()}", which is not a WorkOS environment ` +
          `segment — it reads \`${WORKOS_ENVIRONMENT_SEGMENT_PREFIX}<id>\` in the dashboard's own address bar`,
        state: "unknown",
      };
    }
    return { environmentId: segment, source: "environment-variable", state: "resolved" };
  }
  return fromWitnesses({ pages });
}

/**
 * The segment every walked page's final URL agrees on.
 *
 * @param pages every `page` entity the generation holds
 * @returns the witnessed segment, or the reason the witnesses do not settle one
 */
function fromWitnesses({ pages }: { pages: readonly WorkosWitnessedFinalUrl[] }): WorkosEnvironmentResolution {
  const witnessed = new Set<string>();
  for (const page of pages) {
    const finalUrl = finalUrlOf({ page });
    if (finalUrl === null) {
      continue;
    }
    const segment = workosEnvironmentSegmentFromUrl({ url: finalUrl });
    if (segment !== null) {
      witnessed.add(segment);
    }
  }
  const segments = [...witnessed].toSorted();
  const [only] = segments;
  if (only === undefined) {
    return {
      reason:
        "no dashboard walk has ended on an environment-scoped address yet, so this installation's " +
        `environment segment is not known. Run \`slopweaver atlas workos walk\`, or set ` +
        `$${WORKOS_ENVIRONMENT_ID_ENV}`,
      state: "unknown",
    };
  }
  if (segments.length > 1) {
    return {
      reason:
        `walked pages in this generation end on ${String(segments.length)} different environments ` +
        `(${segments.join(", ")}), so no single one addresses this atlas's content. Set ` +
        `$${WORKOS_ENVIRONMENT_ID_ENV} to the one this install's API key is scoped to, or reset the atlas ` +
        "and walk once",
      state: "unknown",
    };
  }
  return { environmentId: only, source: "witnessed-walk", state: "resolved" };
}

/**
 * The final URL one stored page row's browser channel recorded.
 *
 * @param page the stored row
 * @returns the URL the browser ended on, or `null` when this row holds none
 */
function finalUrlOf({ page }: { page: WorkosWitnessedFinalUrl }): string | null {
  const browser = page.channels.browser;
  if (browser === null) {
    return null;
  }
  const detail = browser.detail;
  if (typeof detail !== "object" || detail === null || !("finalUrl" in detail)) {
    return null;
  }
  const finalUrl = detail.finalUrl;
  if (typeof finalUrl !== "string" || finalUrl.length === 0) {
    return null;
  }
  return finalUrl;
}

/**
 * The declared value with the prefix WorkOS's own address bar shows, whether or not it was typed.
 *
 * @param value the trimmed value read from the environment
 * @returns the value as a full segment
 */
function normalised({ value }: { value: string }): string {
  if (value.startsWith(WORKOS_ENVIRONMENT_SEGMENT_PREFIX)) {
    return value;
  }
  return `${WORKOS_ENVIRONMENT_SEGMENT_PREFIX}${value}`;
}

/**
 * The candidate, when it is shaped like a WorkOS environment segment.
 *
 * @param candidate the string to check
 * @returns the segment, or `null` when it is not one
 */
function validSegment({ candidate }: { candidate: string }): string | null {
  if (!/^environment_[0-9A-Za-z]+$/.test(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * The URL, when it parses.
 *
 * @param url the address to parse
 * @returns the parsed URL, or `null` when it is not one
 */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
