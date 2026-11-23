/**
 * The GraphQL variables one page of a Linear corpus lane sends: the `updatedAt` window, the page size and the
 * cursor. Pure, and kept apart from the lanes that send them so each lane's window is judged in one place.
 */
import { PAGE_SIZE } from "./queries.js";

/**
 * The GraphQL variables for one page of either lane — issues use it as is, projects widen its filter
 * ({@link projectPageQueryVariables}); both share the `first`/`after` cursor shape. Pure.
 *
 * @param since the `updatedAt >= ` window bound
 * @param cursor the `after` cursor (absent on the first page)
 * @param pageSize the page size (absent ⇒ the lane default)
 * @returns the GraphQL variables
 */
export function pageQueryVariables({
  since,
  cursor,
  pageSize = PAGE_SIZE,
}: {
  since: string;
  cursor: string | undefined;
  pageSize?: number | undefined;
}): Record<string, unknown> {
  return {
    filter: { updatedAt: { gte: since } },
    first: pageSize,
    ...(cursor !== undefined ? { after: cursor } : {}),
  };
}

/**
 * The GraphQL variables for one page of the PROJECTS lane: {@link pageQueryVariables}, with the window widened
 * to a project whose status updates moved. Pure.
 *
 * Posting a status update does not move the project's own `updatedAt`, so an `updatedAt >= since` window never
 * re-landed a project after one — measured, three projects updated whose newest bronze
 * record stayed days older, with no update nodes, through every later refresh until a backfill happened to
 * re-read them. `ProjectFilter.projectUpdates` is a collection filter, so `some.updatedAt` catches a new
 * update and an edited one in the same request.
 *
 * @param since the window bound, applied to the project and to each of its updates
 * @param cursor the `after` cursor (absent on the first page)
 * @param pageSize the page size (absent ⇒ the lane default)
 * @returns the GraphQL variables
 */
export function projectPageQueryVariables({
  since,
  cursor,
  pageSize,
}: {
  since: string;
  cursor: string | undefined;
  pageSize?: number | undefined;
}): Record<string, unknown> {
  return {
    ...pageQueryVariables({ cursor, pageSize, since }),
    filter: {
      or: [{ updatedAt: { gte: since } }, { projectUpdates: { some: { updatedAt: { gte: since } } } }],
    },
  };
}
