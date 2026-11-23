/**
 * `gmail clear-meeting-notes`'s shell: the order of the steps.
 *
 * The order is the contract. Gather the evidence (`./clearMeetingNotesGather.ts`): read the mail, prove what bronze
 * holds, ingest what it lacks, prove again, make the store hold it. Only then archive every proven mail and every
 * mail whose document holds no transcript — each through `gmail archive`'s own run, door-routed on the modify grant,
 * never a second write path — and settle any open card such a mail, out of the inbox, no longer needs. A kept mail
 * the owner has to act on gets its Queue card last, so a card
 * never describes a mail this run went on to archive. `--dry-run` and `--audit` stop before the first write. Every
 * judgement is `./clearMeetingNotesCore.ts`'s, so the shell decides nothing; the production edges are
 * `./clearMeetingNotesProduction.ts`.
 */
import type { MeetingTranscriptCommitReport } from "../../../corpus/gmail/meetingCommit.js";
import type { MeetingDocResult } from "../../../corpus/gmail/meetingDocs.js";
import type { MeetingBronzeProof, MeetingProofExpectation } from "../../../corpus/gmail/meetingProof.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { Result } from "../../../lib/result.js";
import type { MeetingNotesMail, MeetingNotesScope } from "../../../live/gmail/meetingNotesRead.js";
import type { ParsedGmailMessage } from "../../../live/gmail/parse.js";
import type { Organisation } from "../../../organisation/core.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import type { StoredContentFacts } from "../../../store/contentMatch.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type CardReceipt, type MeetingCard, meetingCard, meetingCardSlug } from "./clearMeetingNotesCard.js";
import {
  clearMeetingNotesMode,
  keptReasonNeedsOwner,
  type MeetingDisposition,
  type MeetingOutcome,
  outcomeArchives,
  parseClearMeetingNotesArgs,
} from "./clearMeetingNotesCore.js";
import type { ClearMeetingNotesError } from "./clearMeetingNotesErrors.js";
import { gatherMeetingDispositions } from "./clearMeetingNotesGather.js";
import { productionClearMeetingNotesDeps } from "./clearMeetingNotesProduction.js";
import { clearMeetingNotesExit, clearMeetingNotesLines } from "./clearMeetingNotesReport.js";
import { GMAIL_CLEAR_MEETING_NOTES_USAGE } from "./clearMeetingNotesUsage.js";
import { gmailArgsErrorLines } from "./errors.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The edges one run goes through. Injected, so the order is tested against plain fakes. */
export interface ClearMeetingNotesDeps {
  /** The mail in scope, and the mailbox it was read in — the account a kept mail's card is placed by. */
  readonly readMail: (args: {
    home: string;
    scope: MeetingNotesScope;
    limit: number;
  }) => Promise<Result<MeetingNotesMail & { readonly account: string }, ClearMeetingNotesError>>;
  readonly fetchDocs: (args: {
    home: string;
    messages: readonly ParsedGmailMessage[];
  }) => Promise<Result<MeetingDocResult, ClearMeetingNotesError>>;
  readonly readProofs: (args: {
    home: string;
    expectations: readonly MeetingProofExpectation[];
  }) => Result<ReadonlyMap<string, MeetingBronzeProof>, ClearMeetingNotesError>;
  readonly commit: (args: {
    home: string;
    records: readonly CorpusRecord[];
  }) => Result<MeetingTranscriptCommitReport, ClearMeetingNotesError>;
  /** The source ids whose stored row carries the kind, title, body and date bronze proved — never the key alone. */
  readonly storeHolds: (args: {
    home: string;
    expected: readonly StoredContentFacts[];
  }) => Promise<Result<ReadonlySet<string>, ClearMeetingNotesError>>;
  /** Replay ALL of gmail bronze into the store; answers the line it printed. */
  readonly replayStore: (args: { home: string }) => Promise<Result<string, ClearMeetingNotesError>>;
  /** `gmail archive` over ONE id, so its exit code says what became of that mail; answers the exit code. */
  readonly archive: (args: { home: string; id: string }) => Promise<number>;
  /** The organisation the store holds (`../../../organisation/read.ts`), whose Google domain places a card. */
  readonly readOrganisation: (args: { home: string }) => Promise<Result<Organisation, OrganisationError>>;
  /** Place one card, `account` the mailbox its mail was read in — never the grant as it stands at placement. */
  readonly ensureCard: (args: {
    home: string;
    card: MeetingCard;
    account: string;
    organisation: Organisation;
  }) => Promise<Result<CardReceipt, ClearMeetingNotesError>>;
  /** Settle a still-open card under `slug` now its mail is proven and archived; `none` when no open card stands. */
  readonly settleCard: (args: {
    home: string;
    slug: string;
    witness: string;
  }) => Promise<Result<"settled" | "none", ClearMeetingNotesError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** What the write half of a real run did. */
interface Acted {
  readonly archived: readonly string[];
  readonly cardsSettled: readonly string[];
  readonly cards: ReadonlyMap<string, CardReceipt>;
  /** Whether any archive, settle or card step failed — the run then exits 1 whatever it judged. */
  readonly failed: boolean;
}

/** A dry run and an audit write nothing. */
const NOTHING_ACTED: Acted = { archived: [], cards: new Map(), cardsSettled: [], failed: false };

/**
 * Run `gmail clear-meeting-notes` against injected edges.
 *
 * @param rest the argv after the verb
 * @param deps the edges
 * @returns the process exit code — see `clearMeetingNotesExit`, and 1 when any step or archive failed
 */
export async function runGmailClearMeetingNotes({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ClearMeetingNotesDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(GMAIL_CLEAR_MEETING_NOTES_USAGE);
    return EXIT_OK;
  }
  const parsed = parseClearMeetingNotesArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const mode = clearMeetingNotesMode({ args });
  const mail = await deps.readMail({ home, limit: args.limit, scope: args.audit ? "anywhere" : "inbox" });
  if (mail.isErr()) {
    deps.writeDiagnostic(mail.error.message);
    return EXIT_ERROR;
  }
  const gathered = await gatherMeetingDispositions({ deps, home, mail: mail.value, mode });
  if (gathered.isErr()) {
    reportUnproven({ deps, error: gathered.error, mail: mail.value });
    return EXIT_ERROR;
  }
  const dispositions = gathered.value;
  const acted = mode === "run" ? await act({ account: mail.value.account, deps, dispositions, home }) : NOTHING_ACTED;
  const { complete, query, unparsed } = mail.value;
  const report = { ...acted, complete, dispositions, mode, query, unparsed };
  for (const line of clearMeetingNotesLines({ report })) {
    deps.writeOut(line);
  }
  if (acted.failed) {
    return EXIT_ERROR;
  }
  return clearMeetingNotesExit({ report });
}

/** Say the run stopped before proving anything, and name every mail it therefore kept unjudged. */
function reportUnproven({
  deps,
  error,
  mail,
}: {
  deps: ClearMeetingNotesDeps;
  error: ClearMeetingNotesError;
  mail: MeetingNotesMail;
}): void {
  deps.writeDiagnostic(error.message);
  deps.writeDiagnostic("nothing was archived: a mail is archived only on proof, and this run could not prove");
  for (const id of [...mail.messages.map((message) => message.id), ...mail.unparsed]) {
    deps.writeDiagnostic(`  ${id} — kept: not judged, because the run stopped before proving anything`);
  }
}

/** A real run's writes, in order: archive what may leave, settle the cards that answers, card what needs the owner. */
async function act({
  account,
  deps,
  dispositions,
  home,
}: {
  account: string;
  deps: ClearMeetingNotesDeps;
  dispositions: readonly MeetingDisposition[];
  home: string;
}): Promise<Acted> {
  const archived = await archiveProven({ deps, dispositions, home });
  const closed = await settleProvenCards({ archived: archived.ids, deps, dispositions, home });
  const cards = await cardKept({ account, deps, dispositions, home });
  return {
    archived: archived.ids,
    cards: cards.cards,
    cardsSettled: closed.ids,
    failed: archived.failed || closed.failed || cards.failed,
  };
}

/**
 * Archive every proven or never-transcribed inbox mail, one `gmail archive` call per id: a batch's single exit code
 * cannot say which of its ids left the inbox, and the report names only the ones that did.
 */
async function archiveProven({
  deps,
  dispositions,
  home,
}: {
  deps: ClearMeetingNotesDeps;
  dispositions: readonly MeetingDisposition[];
  home: string;
}): Promise<{ ids: readonly string[]; failed: boolean }> {
  const leaving = dispositions
    .filter((disposition) => disposition.inInbox && outcomeArchives({ outcome: disposition.outcome }))
    .map((disposition) => disposition.messageId);
  const archived: string[] = [];
  let failed = false;
  for (const id of leaving) {
    if ((await deps.archive({ home, id })) === EXIT_OK) {
      archived.push(id);
    } else {
      failed = true;
    }
  }
  return { failed, ids: archived };
}

/**
 * Settle the card still open under each proven or never-transcribed mail that is out of the inbox — archived now,
 * or before this run — so a card never goes on asking about a mail with nothing left to download.
 */
async function settleProvenCards({
  archived,
  deps,
  dispositions,
  home,
}: {
  archived: readonly string[];
  deps: ClearMeetingNotesDeps;
  dispositions: readonly MeetingDisposition[];
  home: string;
}): Promise<{ ids: readonly string[]; failed: boolean }> {
  const archivedNow = new Set(archived);
  const settled: string[] = [];
  let failed = false;
  for (const { inInbox, messageId, outcome } of dispositions) {
    const outOfInbox = !inInbox || archivedNow.has(messageId);
    if (!outcomeArchives({ outcome }) || !outOfInbox) {
      continue;
    }
    const witness = settleWitness({ messageId, outcome });
    const closed = await deps.settleCard({ home, slug: meetingCardSlug({ messageId }), witness });
    if (closed.isErr()) {
      deps.writeDiagnostic(closed.error.message);
      failed = true;
    } else if (closed.value === "settled") {
      settled.push(messageId);
    }
  }
  return { failed, ids: settled };
}

/** The witness a settled card carries: the held transcript, or the document read with none in it. */
function settleWitness({ messageId, outcome }: { messageId: string; outcome: MeetingOutcome }): string {
  if (outcome.kind === "proven") {
    return `gmail ${outcome.sourceId} proven and out of the inbox`;
  }
  return `gmail ${messageId} notes document read with no transcript to download, and out of the inbox`;
}

/** Place ONE Queue card per kept inbox mail the owner has to act on. */
async function cardKept({
  account,
  deps,
  dispositions,
  home,
}: {
  account: string;
  deps: ClearMeetingNotesDeps;
  dispositions: readonly MeetingDisposition[];
  home: string;
}): Promise<{ cards: ReadonlyMap<string, CardReceipt>; failed: boolean }> {
  const cards = new Map<string, CardReceipt>();
  const owed = dispositions.filter(
    ({ inInbox, outcome }) => inInbox && outcome.kind === "kept" && keptReasonNeedsOwner({ reason: outcome.reason }),
  );
  if (owed.length === 0) {
    return { cards, failed: false };
  }
  // Read once, and only when a card is owed: a card states the team's workspace off the mailbox's domain, which only
  // the organisation names. One that will not read places no card and fails the run, never a card placed by a guess.
  const organisation = await deps.readOrganisation({ home });
  if (organisation.isErr()) {
    deps.writeDiagnostic(organisation.error.message);
    return { cards, failed: true };
  }
  let failed = false;
  for (const disposition of owed) {
    const { outcome } = disposition;
    if (outcome.kind !== "kept") {
      continue;
    }
    const card = meetingCard({ disposition, reason: outcome.reason });
    const placed = await deps.ensureCard({ account, card, home, organisation: organisation.value });
    if (placed.isErr()) {
      deps.writeDiagnostic(placed.error.message);
      failed = true;
      continue;
    }
    cards.set(disposition.messageId, placed.value);
  }
  return { cards, failed };
}

/** `slopweaver gmail clear-meeting-notes` — archive each Gemini notes mail whose transcript is held, or never was. */
export const gmailClearMeetingNotesCommand = defineCommand({
  run: (argv) =>
    runGmailClearMeetingNotes({ deps: productionClearMeetingNotesDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
