/**
 * `gmail clear-meeting-notes`'s production edges: the stored Gmail grant, gmail bronze, the selected store,
 * `gmail archive`'s own run (the one door write), and the handover register a kept mail's card lives in.
 */
import { commitMeetingTranscripts } from "../../../corpus/gmail/meetingCommit.js";
import { fetchMeetingDocs, type MeetingDocResult } from "../../../corpus/gmail/meetingDocs.js";
import { readMeetingTranscriptProofs } from "../../../corpus/gmail/meetingProof.js";
import { type ExactDoc, readExactDoc } from "../../../handover/store.js";
import { accountWorkspace } from "../../../handover/workspace.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import { makeGoogleDocsApi } from "../../../live/gmail/docs.js";
import {
  type MeetingNotesMail,
  type MeetingNotesScope,
  readMeetingNotesMail,
} from "../../../live/gmail/meetingNotesRead.js";
import type { ParsedGmailMessage } from "../../../live/gmail/parse.js";
import { GMAIL_SCOPE_TABLE } from "../../../live/gmail/scopes.js";
import { satisfiesCapability } from "../../../live/google/scopes.js";
import type { Organisation } from "../../../organisation/core.js";
import { readOrganisation } from "../../../organisation/read.js";
import { connectStore } from "../../../store/client.js";
import { matchingContentIds, readStoredContentFacts, type StoredContentFacts } from "../../../store/contentMatch.js";
import { EXIT_OK } from "../../exitCodes.js";
import { registerAskRow } from "../handover/askRowRun.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { runHandoverSettle } from "../handover/settleRowRun.js";
import { productionStoreIngest, storeLegLine } from "../refresh/storeLeg.js";
import { type CardReceipt, type MeetingCard, meetingCardArgv } from "./clearMeetingNotesCard.js";
import { type ClearMeetingNotesError, ClearMeetingNotesErrors } from "./clearMeetingNotesErrors.js";
import { MEETING_DATE_ATTR } from "./clearMeetingNotesGather.js";
import type { ClearMeetingNotesDeps } from "./clearMeetingNotesRun.js";
import { productionGmailModifyDeps, runGmailArchive } from "./modifyRun.js";

/**
 * The production edges.
 *
 * @returns the edges
 */
export function productionClearMeetingNotesDeps(): ClearMeetingNotesDeps {
  return {
    archive: ({ home, id }) => runGmailArchive({ deps: productionGmailModifyDeps(), rest: [id, "--home", home] }),
    commit: ({ home, records }) =>
      commitMeetingTranscripts({ home, records }).mapErr((error) =>
        ClearMeetingNotesErrors.bronzeCommitFailed({ message: error.message }),
      ),
    ensureCard: ({ account, home, card, organisation }) => ensureMeetingCard({ account, card, home, organisation }),
    readOrganisation: ({ home }) => readOrganisation({ home }),
    fetchDocs: ({ home, messages }) => fetchDocs({ home, messages }),
    readMail: ({ home, scope, limit }) => readMail({ home, limit, scope }),
    readProofs: ({ home, expectations }) =>
      readMeetingTranscriptProofs({ expectations, home }).mapErr((error) =>
        ClearMeetingNotesErrors.bronzeReadFailed({ message: error.message }),
      ),
    replayStore: async ({ home }) => {
      const replayed = await productionStoreIngest({ home, scope: "full", source: "gmail" });
      if (replayed.isErr()) {
        return err(ClearMeetingNotesErrors.storeReplayFailed({ message: replayed.error.join("; ") }));
      }
      return ok(storeLegLine({ outcome: replayed.value, source: "gmail" }));
    },
    settleCard: ({ home, slug, witness }) => settleMeetingCard({ home, slug, witness }),
    storeHolds: ({ home, expected }) => storeHolds({ expected, home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** Read every linked notes document, through the Docs scope when the grant carries it. */
async function fetchDocs({
  home,
  messages,
}: {
  home: string;
  messages: readonly ParsedGmailMessage[];
}): Promise<Result<MeetingDocResult, ClearMeetingNotesError>> {
  const bound = resolveGmailClient({ capabilities: ["read"], home });
  if (bound.isErr()) {
    return err(ClearMeetingNotesErrors.docsReadFailed({ message: bound.error.message }));
  }
  const canReadDocs = satisfiesCapability({
    capability: "docs",
    granted: bound.value.scopes,
    table: GMAIL_SCOPE_TABLE,
  });
  const docsApi = canReadDocs ? makeGoogleDocsApi({ account: bound.value.account, auth: bound.value.auth }) : undefined;
  return ok(await fetchMeetingDocs({ docsApi, messages }));
}

/** Read the meeting-notes mail in scope, beside the mailbox it was read in. */
async function readMail({
  home,
  limit,
  scope,
}: {
  home: string;
  limit: number;
  scope: MeetingNotesScope;
}): Promise<Result<MeetingNotesMail & { readonly account: string }, ClearMeetingNotesError>> {
  const bound = resolveGmailClient({ capabilities: ["read"], home });
  if (bound.isErr()) {
    return err(ClearMeetingNotesErrors.mailReadFailed({ message: bound.error.message }));
  }
  const { account } = bound.value;
  const api = makeGmailApi({ account, client: bound.value.client });
  const read = await readMeetingNotesMail({ api, limit, scope });
  return read
    .map((mail) => ({ ...mail, account }))
    .mapErr((error) => ClearMeetingNotesErrors.mailReadFailed({ message: error.message }));
}

/** The source ids whose stored row carries the kind, title, body and meeting date expected of it. */
async function storeHolds({
  expected,
  home,
}: {
  expected: readonly StoredContentFacts[];
  home: string;
}): Promise<Result<ReadonlySet<string>, ClearMeetingNotesError>> {
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return err(ClearMeetingNotesErrors.storeProbeFailed({ message: opened.error.message }));
  }
  try {
    const sourceIds = expected.map((facts) => facts.sourceId);
    const stored = await readStoredContentFacts({
      attrKey: MEETING_DATE_ATTR,
      client: opened.value,
      source: "gmail",
      sourceIds,
    });
    return stored
      .map((rows) => matchingContentIds({ expected, stored: rows }))
      .mapErr((error) => ClearMeetingNotesErrors.storeProbeFailed({ message: error.message }));
  } finally {
    await opened.value.close();
  }
}

/**
 * Place a kept mail's Queue card once: a live card under its slug is still standing, and one archived or carrying a
 * settlement is the owner's settled answer, so a run every hour never stacks a second card on the first, nor re-asks what
 * the owner answered.
 *
 * @param account the mailbox the card's mail was read in, which says whose work it is
 * @param organisation the organisation whose Google domain the mailbox is judged against
 * @returns whether the card was placed now or already stood, or why neither could be established
 */
export async function ensureMeetingCard({
  account,
  card,
  home,
  organisation,
}: {
  account: string;
  card: MeetingCard;
  home: string;
  organisation: Organisation;
}): Promise<Result<CardReceipt, ClearMeetingNotesError>> {
  const handoverDir = resolveHandoverDir({ dir: undefined, home });
  const standing = readExactDoc({ handoverDir, slug: card.slug });
  if (standing.isErr()) {
    return err(ClearMeetingNotesErrors.cardFailed({ message: standing.error.message, slug: card.slug }));
  }
  if (standing.value !== undefined) {
    return ok(standingReceipt({ exact: standing.value }));
  }
  // The mailbox the mail was read in says whose work it is — carried from the read, never re-resolved here, where a
  // grant replaced mid-run would name another account.
  const workspace = accountWorkspace({ account, organisation, what: "the Gemini notes mail of a meeting" });
  const code = await registerAskRow({
    argv: meetingCardArgv({ card, home, workspace }),
    origin: "automation",
    out: logger.out,
  });
  if (code === EXIT_OK) {
    return ok("placed");
  }
  const raced = readExactDoc({ handoverDir, slug: card.slug });
  if (raced.isOk() && raced.value !== undefined) {
    return ok(standingReceipt({ exact: raced.value }));
  }
  return err(
    ClearMeetingNotesErrors.cardFailed({ message: `handover register exited ${String(code)}`, slug: card.slug }),
  );
}

/**
 * Settle the open card under `slug` as answered, the corpus row its witness — the mail it asked about is proven and
 * out of the inbox, so nothing is left for the owner to decide.
 *
 * @param witness the corpus fact that answered the card
 * @returns `settled` when an open card was settled now, `none` when no open card stands, or why settling failed
 */
export async function settleMeetingCard({
  home,
  slug,
  witness,
}: {
  home: string;
  slug: string;
  witness: string;
}): Promise<Result<"settled" | "none", ClearMeetingNotesError>> {
  const standing = readExactDoc({ handoverDir: resolveHandoverDir({ dir: undefined, home }), slug });
  if (standing.isErr()) {
    return err(ClearMeetingNotesErrors.cardFailed({ message: standing.error.message, slug }));
  }
  if (standing.value === undefined || standingReceipt({ exact: standing.value }) === "settled") {
    return ok("none");
  }
  const argv = ["node", "cli", "handover", "settle", slug, "--as", "answered", "--witness", witness, "--home", home];
  const code = await runHandoverSettle(argv);
  if (code !== EXIT_OK) {
    return err(ClearMeetingNotesErrors.cardFailed({ message: `handover settle exited ${String(code)}`, slug }));
  }
  return ok("settled");
}

/** A card that stands: settled when it is archived or carries a settlement, else still open on the Queue. */
function standingReceipt({ exact }: { exact: ExactDoc }): "existing" | "settled" {
  if (exact.archived || exact.doc.settlement !== undefined) {
    return "settled";
  }
  return "existing";
}
