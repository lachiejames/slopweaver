/**
 * The effectful half of the bounded auth-event read: page each auth service's window, fold every page into
 * one shared state, keep nothing.
 *
 * Every decision worth reviewing is in `./authEvents.ts`, which is pure. What is here is the loop: ask the
 * closed client for one page of one service, project it, fold it, and decide whether to ask for another.
 * There is no store write, no generation, no manifest and no journal on this path — see that file's header
 * for why a READ of a family the owner's ruling bans STORING is outside the ban rather than a hole in
 * it, and for the measurement that makes this one request per service rather than one request.
 *
 * ## Termination has three independent bounds, and each service says which one stopped it
 *
 * The provider's own end-of-interval signal is {@link insightsPageIsLast}, which reads the result COUNT
 * rather than the cursor — `X-Search_after` is present on the last page too, so a loop terminating on its
 * absence never terminates (`paging.ts`). A page cap is the second, because a window a caller typed wrong
 * should cost a bounded number of requests rather than one per page of whatever the wrong window spans. A cursor the provider stops
 * offering is the third. Which one fired is carried PER SERVICE rather than for the walk as a whole,
 * because that is the granularity at which it is true: `sso` exhausting its window while `directory` hits
 * the cap is one walk where a silence means two different things depending on who you ask about.
 */
import { err, ok, type Result } from "../../lib/result.js";

import {
  type AuthEvent,
  type AuthEventFold,
  type AuthFoldState,
  authEventsPageBody,
  closeAuthFold,
  emptyAuthFold,
  foldAuthPage,
  JUMPCLOUD_AUTH_EVENTS_PAGE_LIMIT,
  JUMPCLOUD_AUTH_EVENTS_SURFACE,
  JUMPCLOUD_AUTH_SERVICES,
  parseSearchAfter,
  projectAuthEvents,
} from "./authEvents.js";
import {
  type JumpcloudClientDeps,
  type JumpcloudResponse,
  productionJumpcloudFetch,
  requestJumpcloud,
} from "./client.js";
import { resolveJumpcloudCredentials } from "./credentials.js";
import type { JumpcloudReadError } from "./errors.js";
import { insightsCursor, insightsPageIsLast } from "./paging.js";
import { admitJumpcloudPage, type JumpcloudAdmit } from "./responseRegistry.js";

/**
 * Why one service's walk stopped, so a reader knows whether a silence is a fact or a truncation.
 * @internal
 */
export type AuthWalkEnding =
  | { readonly kind: "window-exhausted" }
  | { readonly kind: "page-cap"; readonly pages: number }
  | { readonly kind: "no-cursor" };

/** What one service's walk cost and what stopped it. */
export interface ServiceWalk {
  readonly service: string;
  readonly pagesRead: number;
  readonly eventsRead: number;
  readonly ending: AuthWalkEnding;
}

/** One completed read: what every service folded to, how far each got, and what stopped each. */
export interface AuthEventsReport {
  readonly startIso: string;
  readonly endIso: string;
  readonly services: readonly ServiceWalk[];
  readonly fold: AuthEventFold;
}

/** What one read needs: a credential, a transport, and how many pages each service may spend. */
export interface AuthEventsDeps {
  readonly client: JumpcloudClientDeps;
  /** How each answered page is admitted — {@link admitJumpcloudPage} in production. */
  readonly admit: JumpcloudAdmit;
  readonly maxPages: number;
  /** Where progress goes. A window of many pages that printed nothing looks identical to one that hung. */
  readonly progress: (line: string) => void;
}

/**
 * Build the production dependencies from the environment and the secrets store.
 *
 * @param env the process environment, consulted before the store
 * @param home the state home whose `secrets/` directory holds the administrator key
 * @param maxPages the per-service page ceiling this invocation allows
 * @param progress where a per-page line goes
 * @returns the dependencies, or every reason the credential could not be resolved
 */
export function productionAuthEventsDeps({
  env,
  home,
  maxPages,
  progress,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  maxPages: number;
  progress: (line: string) => void;
}): Result<AuthEventsDeps> {
  const credentials = resolveJumpcloudCredentials({ env, home });
  if (credentials.isErr()) {
    return err(credentials.error);
  }
  return ok({
    admit: admitJumpcloudPage,
    client: {
      apiKey: credentials.value.apiKey,
      fetch: productionJumpcloudFetch(),
      orgId: credentials.value.orgId,
    },
    maxPages,
    progress,
  });
}

/**
 * Read one page of a service's window, admitted through the surface's strict boundary before projection, so a new
 * event key refuses the page by name.
 *
 * @param cursor the previous page's search-after cursor, `null` for the first page
 * @param startIso the inclusive start of the window
 * @param endIso the exclusive end
 * @param deps the credential, the transport and the admission
 * @returns the page's projected events and its headers, or the first typed failure
 */
async function readAuthPage({
  cursor,
  deps,
  endIso,
  service,
  startIso,
}: {
  cursor: readonly unknown[] | null;
  deps: AuthEventsDeps;
  endIso: string;
  service: string;
  startIso: string;
}): Promise<
  Result<{ readonly events: readonly AuthEvent[]; readonly headers: JumpcloudResponse["headers"] }, JumpcloudReadError>
> {
  const page = await requestJumpcloud({
    deps: deps.client,
    input: { body: authEventsPageBody({ endIso, searchAfter: cursor, service, startIso }) },
    surface: JUMPCLOUD_AUTH_EVENTS_SURFACE,
  });
  if (page.isErr()) {
    return err(page.error);
  }
  const { headers, text } = page.value;
  const admitted = deps.admit({ headers, surface: JUMPCLOUD_AUTH_EVENTS_SURFACE, text });
  if (admitted.isErr()) {
    return err(admitted.error);
  }
  return projectAuthEvents({ body: admitted.value.records, service }).map((events) => ({ events, headers }));
}

/**
 * Walk one service's window, folding every page into the shared state.
 *
 * @param service the one service this walk asks for
 * @param startIso the inclusive start of the window
 * @param endIso the exclusive end
 * @param state the fold shared with every other service's walk
 * @param deps the credential, the transport and the page ceiling
 * @returns what this service cost and what stopped it, or the first typed failure
 */
async function walkService({
  service,
  startIso,
  endIso,
  state,
  deps,
}: {
  service: string;
  startIso: string;
  endIso: string;
  state: AuthFoldState;
  deps: AuthEventsDeps;
}): Promise<Result<ServiceWalk, JumpcloudReadError>> {
  let cursor: readonly unknown[] | null = null;
  let pagesRead = 0;
  let eventsRead = 0;
  // Set only when the loop leaves by an end-of-data branch. A walk whose LAST allowed page happened to be
  // the provider's last page is window-exhausted, not truncated, and a reader may conclude a silence from
  // it — so the cap ending is decided by this staying null rather than by `pagesRead === maxPages`, which
  // is true of both cases and would have reported a complete walk as a partial one.
  let ending: AuthWalkEnding | null = null;
  while (pagesRead < deps.maxPages) {
    const page = await readAuthPage({ cursor, deps, endIso, service, startIso });
    if (page.isErr()) {
      return err(page.error);
    }
    const { events, headers } = page.value;
    pagesRead += 1;
    eventsRead += events.length;
    foldAuthPage({ events, state });
    deps.progress(
      `${service} page ${String(pagesRead)}: ${String(events.length)} event(s), ${String(state.byIdentity.size)} identity(ies) so far`,
    );
    if (insightsPageIsLast({ headers, requestedLimit: JUMPCLOUD_AUTH_EVENTS_PAGE_LIMIT })) {
      ending = { kind: "window-exhausted" };
      break;
    }
    const next = parseSearchAfter({ raw: insightsCursor({ headers }) });
    if (next === null) {
      ending = { kind: "no-cursor" };
      break;
    }
    cursor = next;
  }
  if (ending === null) {
    return ok({ ending: { kind: "page-cap", pages: deps.maxPages }, eventsRead, pagesRead, service });
  }
  return ok({ ending, eventsRead, pagesRead, service });
}

/**
 * Read one window of JumpCloud authentication events across every auth service and fold it to a last-auth
 * per identity.
 *
 * @param startIso the inclusive start of the window
 * @param endIso the exclusive end
 * @param deps the credential, the transport and the per-service page ceiling
 * @returns the fold and its bounds, or the first typed failure that stopped a service's walk
 */
export async function readJumpcloudAuthEvents({
  startIso,
  endIso,
  deps,
}: {
  startIso: string;
  endIso: string;
  deps: AuthEventsDeps;
}): Promise<Result<AuthEventsReport, JumpcloudReadError>> {
  const state = emptyAuthFold();
  const services: ServiceWalk[] = [];
  for (const service of JUMPCLOUD_AUTH_SERVICES) {
    const walk = await walkService({ deps, endIso, service, startIso, state });
    if (walk.isErr()) {
      return err(walk.error);
    }
    services.push(walk.value);
  }
  return ok({ endIso, fold: closeAuthFold({ state }), services, startIso });
}
