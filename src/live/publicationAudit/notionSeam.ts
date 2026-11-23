/**
 * The publication audit's Notion door contract: the fixed gap labels a coverage row carries, and the reads the door
 * makes through the sanctioned named-object Notion factory.
 *
 * No label carries an id, a title, a URL or a provider message: Notion cannot tell a deleted page from one the
 * integration lost access to, and either way the only thing the audit may say is that it did not read it.
 * `./notionReader.ts` reads the pages.
 */
import { makeNotionNamedReadApi, type NotionNamedReadApi } from "../../corpus/notion/liveApi.js";

import { doorCoverage, type PublicationDoorCoverage } from "./types.js";

/** Every reason the Notion door can be short of complete, as the fixed labels a coverage row carries. */
export const NOTION_PUBLICATION_GAPS = {
  blockShapeUnreadable: "block shape unreadable",
  childObjectNotRead: "child page or database not read",
  credentialMissing: "credential missing",
  inventoryRowUnreadable: "inventory row unreadable",
  inventoryRowUnresolved: "inventory row unresolved",
  inventoryUnreadable: "inventory unreadable",
  nestedBlocksNotFullyRead: "nested blocks not fully read",
  objectAddressUnresolved: "object address unresolved",
  objectCeilingReached: "object ceiling reached",
  pageReadFailed: "page read failed",
  pageShapeUnreadable: "page shape unreadable",
  pageTitleUnreadable: "page title unreadable",
  topLevelBlocksNotFullyRead: "top-level blocks not fully read",
  uploadedFilesNotRead: "uploaded files not read",
} as const;

/** One fixed Notion gap label. */
export type NotionPublicationGap = (typeof NOTION_PUBLICATION_GAPS)[keyof typeof NOTION_PUBLICATION_GAPS];

/**
 * What the Notion door reads through: the bounded named-object API `notion read` uses, and the clock its nested
 * walk checks before starting each call. Plain functions in a test, {@link productionNotionPublicationSeam} live.
 */
export interface NotionPublicationSeam {
  readonly api: NotionNamedReadApi;
  readonly nowMs: () => number;
}

/**
 * The live seam over the sanctioned named-object Notion factory.
 *
 * @param token the Notion integration token, resolved by the caller from the state home
 * @returns the seam, sharing one local rate scheduler across every call of the run
 */
export function productionNotionPublicationSeam({ token }: { token: string }): NotionPublicationSeam {
  return { api: makeNotionNamedReadApi({ token }), nowMs: () => Date.now() };
}

/**
 * The coverage of a Notion door that read nothing, for a caller that stopped before the inventory — a missing
 * credential is the case.
 *
 * @param gap the one fixed reason nothing was read
 * @returns a partial row with no object, no text and that one gap
 */
export function notionNotReadCoverage({ gap }: { gap: NotionPublicationGap }): PublicationDoorCoverage {
  return doorCoverage({ attachmentsNotSwept: 0, door: "notion", gaps: [gap], objects: 0, texts: 0 });
}
