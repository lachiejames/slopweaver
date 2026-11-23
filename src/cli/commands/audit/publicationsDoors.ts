/**
 * The Slack, Linear and Notion doors as production reads them for `audit publications`: each one's write inventory,
 * its credential from the state home, and its doored named-object read. A door with no credential reads nothing and
 * says so as a gap, so it is partial and never clean, while the other doors are still read.
 */
import { linearToken, notionToken, slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { readLinearInventory } from "../../../live/publicationAudit/linearInventory.js";
import { readLinearPublications } from "../../../live/publicationAudit/linearReader.js";
import { LINEAR_PUBLICATION_GAPS, productionLinearPublicationSeam } from "../../../live/publicationAudit/linearSeam.js";
import { readNotionPublications } from "../../../live/publicationAudit/notionReader.js";
import {
  NOTION_PUBLICATION_GAPS,
  notionNotReadCoverage,
  productionNotionPublicationSeam,
} from "../../../live/publicationAudit/notionSeam.js";
import { readSlackPublications, slackPublicationSeam } from "../../../live/publicationAudit/slackReader.js";
import { doorCoverage, type PublicationRead } from "../../../live/publicationAudit/types.js";
import { readPlacementJournal } from "../../../live/slack/placementJournal.js";
import { listPageRecords } from "../../../outbound/notion/pageLedgerListing.js";

/** The gap a door whose credential is not configured reports: it read nothing, so it is partial, never clean. */
export const CREDENTIAL_MISSING = "credential missing";

/**
 * The Slack door as production reads it: the placement journal, the user token (the bot token is a narrower fallback,
 * reported as a gap), and the doored exact-message read.
 *
 * @returns the door's coverage and the texts it read back
 */
export async function productionReadSlack({ home }: { home: string }): Promise<PublicationRead> {
  const inventory = readPlacementJournal({ home });
  const credential = slackReadCredential({ home });
  if (credential === undefined) {
    return readSlackPublications({ botOnly: false, inventory, seam: undefined });
  }
  const seam = slackPublicationSeam({ api: makeSlackApi({ token: credential.token }) });
  return readSlackPublications({ botOnly: credential.botOnly, inventory, seam });
}

/** The Slack token the audit reads with: the user's, else the bot's (marked, because it sees less), else none. */
function slackReadCredential({ home }: { home: string }): { token: string; botOnly: boolean } | undefined {
  const user = slackUserToken({ home });
  if (user !== undefined) {
    return { botOnly: false, token: user };
  }
  const bot = slackBotToken({ home });
  if (bot === undefined) {
    return undefined;
  }
  return { botOnly: true, token: bot };
}

/**
 * The Linear door as production reads it: every write ledger, then the named-object read when a token is configured.
 * With none it reads nothing, so it is partial — and an attachment upload keeps no ledger, so that gap stands either way.
 *
 * @returns the door's coverage and the texts it read back
 */
export async function productionReadLinear({ home }: { home: string }): Promise<PublicationRead> {
  const token = linearToken({ home });
  if (token === undefined) {
    const gaps = [CREDENTIAL_MISSING, LINEAR_PUBLICATION_GAPS.attachmentWritesNotInventoried];
    return {
      coverage: doorCoverage({ attachmentsNotSwept: 0, door: "linear", gaps, objects: 0, texts: 0 }),
      texts: [],
    };
  }
  return readLinearPublications({
    inventory: readLinearInventory({ home }),
    seam: productionLinearPublicationSeam({ token }),
  });
}

/**
 * The Notion door as production reads it: the page ledger, then the named-object read when a token is configured. An
 * empty, readable ledger is complete with no token; a ledger holding pages and no token is partial.
 *
 * @returns the door's coverage and the texts it read back
 */
export async function productionReadNotion({ home }: { home: string }): Promise<PublicationRead> {
  const inventory = listPageRecords({ home });
  if (inventory.isOk() && inventory.value.rows.length === 0 && inventory.value.unreadableRows === 0) {
    return {
      coverage: doorCoverage({ attachmentsNotSwept: 0, door: "notion", gaps: [], objects: 0, texts: 0 }),
      texts: [],
    };
  }
  const token = notionToken({ home });
  if (token === undefined) {
    return { coverage: notionNotReadCoverage({ gap: NOTION_PUBLICATION_GAPS.credentialMissing }), texts: [] };
  }
  return readNotionPublications({ inventory, seam: productionNotionPublicationSeam({ token }) });
}
