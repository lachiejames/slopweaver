/**
 * The publication audit's Linear door contract: the fixed gap labels a coverage row carries, the one read failure
 * shape, and the reads the door makes through Linear's shared paced transport.
 *
 * Every blind spot is a fixed label from {@link LINEAR_PUBLICATION_GAPS} — never an id, a title, a URL or a provider
 * message — and a live read failure crosses this seam as its code and a FIXED message, so nothing upstream said
 * reaches a gap or a report. `./linearInventory.ts` resolves the ledgers to objects; `./linearReader.ts` reads them.
 */
import type { Result } from "#lib/result.js";

import type { LinearLiveError } from "../linear/errors.js";
import { linearReadRequest, readLinearObject, readLinearProjectUpdates } from "../linear/read.js";

/** Every reason the Linear door is not complete, as the fixed labels a coverage row carries. */
export const LINEAR_PUBLICATION_GAPS = {
  activityPageCeiling: "activity page ceiling reached",
  attachmentWritesNotInventoried: "attachment writes not inventoried",
  commentDestinationUnknown: "comment destination kind not inventoried",
  initiativeUpdatesNotSwept: "initiative updates not swept",
  initiativesNotSwept: "initiatives not swept",
  inventoryRowUnreadable: "inventory row unreadable",
  inventoryRowUnresolved: "inventory row unresolved",
  inventoryUnreadable: "inventory unreadable",
  labelsNotSwept: "labels not swept",
  milestonesNotSwept: "milestones not swept",
  objectAddressUnresolved: "object address unresolved",
  objectCeiling: "object ceiling reached",
  objectNotAddressable: "object not addressable",
  objectNotFound: "object not found or not visible",
  objectReadFailed: "object read failed",
  uploadsNotRead: "uploaded files not read",
} as const;

/**
 * Items read from one parent's comment or update connection. One page, because `readLinearObject` reads each
 * activity connection from its start with no cursor; a parent holding more reports `activity page ceiling reached`
 * rather than an absence. Kept under the corpus sync's 250 (`../../corpus/linear/queries.ts`'s `COMMENTS_PAGE_SIZE`)
 * because a document comment node carries the document's content (`../linear/documentComments.ts`). Unmeasured.
 */
const LINEAR_PUBLICATION_PAGE = 100;

/**
 * A Linear read failure as this door keeps it: the live error's code, which picks the gap, and a FIXED message. A
 * live error's message can carry upstream text (an issue key, a title), so it never crosses the seam.
 */
export interface LinearPublicationReadError {
  readonly code: LinearLiveError["code"];
  readonly message: string;
}

/** Factories for the door's one read failure shape. */
export const LinearPublicationReadErrors = {
  /** @returns the live failure restated with a fixed message, keeping only its code */
  fromLive: ({ error }: { error: LinearLiveError }): LinearPublicationReadError => ({
    code: error.code,
    message: `the linear publication read failed (${error.code})`,
  }),
} as const;

/** The reads this door makes: plain functions, so a test passes fakes and production the shared paced transport. */
export interface LinearPublicationSeam {
  /** One issue, document or project by address, with its comments connection when asked; the provider payload. */
  readonly readObject: (args: {
    readonly address: string;
    readonly comments: boolean;
  }) => Promise<Result<unknown, LinearPublicationReadError>>;
  /** One project's `projectUpdates` connection by project URL; the provider's `{ nodes, pageInfo }`. */
  readonly readProjectUpdates: (args: {
    readonly address: string;
  }) => Promise<Result<unknown, LinearPublicationReadError>>;
}

/**
 * The production seam over Linear's process-wide paced read transport.
 *
 * @param token the configured Linear API key
 * @returns the door's reads, each one request sequence through `../linear/read.ts`
 */
export function productionLinearPublicationSeam({ token }: { token: string }): LinearPublicationSeam {
  const request = linearReadRequest({ token });
  return {
    readObject: async ({ address, comments }) => {
      const read = await readLinearObject({
        address,
        include: { comments },
        limit: LINEAR_PUBLICATION_PAGE,
        nowIso: () => new Date().toISOString(),
        request,
      });
      return read.map((document) => document.data).mapErr((error) => LinearPublicationReadErrors.fromLive({ error }));
    },
    readProjectUpdates: async ({ address }) => {
      const read = await readLinearProjectUpdates({ address, limit: LINEAR_PUBLICATION_PAGE, request });
      return read.mapErr((error) => LinearPublicationReadErrors.fromLive({ error }));
    },
  };
}
