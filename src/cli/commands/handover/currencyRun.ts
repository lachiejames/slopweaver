/**
 * `slopweaver handover currency` — the effectful shell over `../../../handover/currency.ts`: is each Queue card still
 * the owner's to act on.
 *
 * It reads four things the pure core cannot: the board (which asks are the owner's), each Slack-anchored ask's thread (have they
 * replied), the chair's turns and the voice relays through the SAME reader `handover reconcile` uses
 * (`./intakeHalves.ts`), and the call words past the chair's own unread cursor. It never runs a doc's shell: the one
 * done-check it evaluates is the register's own, recognised by exact equality and read in-process.
 *
 * And a fifth: the live body of every pull request the owner asked proof on, in one batched GitHub read, so a card about it
 * leads with what the body still lacks (`../../../handover/prProof.ts`). The Queue and the talk pack both read that
 * verdict off this recorded reading; neither reaches GitHub itself.
 *
 * The reading is BATCHED: the card says when it was checked rather than pretending to be live. The
 * tick records it (`../../../supervisor/scratch/tickCapture.ts`), and so does the console's Queue on opening, through
 * `--record-reading sync-now` (`./currencyReadingRecord.ts`); the Queue reads whichever was recorded last.
 */
import { githubToken, originRepositoryOf, slopweaverHome } from "../../../config.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import {
  CURRENCY_SCHEMA_VERSION,
  type CurrencyAsk,
  type CurrencyCardCandidate,
  type CurrencyDocument,
  type CurrencyDone,
  type CurrencyRow,
  currencyRowOf,
  derivedReplyCheck,
  doneOf,
  sourceLine,
  type VoiceUnread,
} from "../../../handover/currency.js";
import { askCurrencyCard } from "../../../handover/currencyCards.js";
import { oneRowPerCard } from "../../../handover/currencyRowIdentity.js";
import { saidOf } from "../../../handover/currencySaid.js";
import { type CurrencyPullRequest, currencyPullRequestsOf, proofAskedPrs } from "../../../handover/prProof.js";
import { prsOnBoard } from "../../../handover/prSteers.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import { makeReadPrBodies, prAddressOfIdentity } from "../../../live/github/prBody.js";
import { noGithubCredential, type PrAddress } from "../../../live/github/prPremise.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { INTAKE_SWEEP_WINDOW_MS } from "../../../supervisor/intake.js";
import { SUPERVISOR_UNREAD_CURSOR } from "../../../talk/unreadCursorStore.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { selectUnreadWords } from "../../../talk/unreadWords.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { checkOwnerReply } from "../slack/repliedRead.js";
import { repositorySlugs } from "./boardReferences.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { CURRENCY_USAGE, currencyNowRefusal, parseHandoverCurrencyArgs } from "./currencyArgs.js";
import { currencyBoardOf } from "./currencyBoard.js";
import { readCurrencyCardSources } from "./currencyCardRead.js";
import { currencyHumanLines } from "./currencyPrint.js";
import { currencyOutputOf, recordedExit } from "./currencyReadingRecord.js";
import { type CurrencyStandingDeps, PRODUCTION_STANDING_DEPS, readCurrencyStanding } from "./currencyStandingRead.js";
import { readIntakeHalves } from "./intakeHalves.js";
import { boardPrSteerRows } from "./listJsonPrSteers.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/**
 * The furthest back the owner's words are read, however old the oldest card. A card older than this names the gap rather
 * than walking a month of transcripts on every tick.
 */
const CURRENCY_MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Where to read the owner's words from: the oldest card's floor, never later than the sweep's own window and never earlier
 * than {@link CURRENCY_MAX_LOOKBACK_MS}.
 *
 * @param cards the cards, each by its floor
 * @param nowIso the verb's clock
 * @returns the instant
 */
function readFromOf({ cards, nowIso }: { cards: readonly CurrencyCardCandidate[]; nowIso: string }): string {
  const nowMs = Date.parse(nowIso);
  let fromMs = nowMs - INTAKE_SWEEP_WINDOW_MS;
  for (const { floorIso } of cards) {
    if (floorIso !== undefined && Date.parse(floorIso) < fromMs) {
      fromMs = Date.parse(floorIso);
    }
  }
  return new Date(Math.max(fromMs, nowMs - CURRENCY_MAX_LOOKBACK_MS)).toISOString();
}

/**
 * The call words the chair has not read, through its own cursor.
 *
 * @returns the words, or why they could not be read
 */
function readVoiceUnread({ home, nowIso }: { home: string; nowIso: string }): VoiceUnread {
  const read = readUnread({ home, name: SUPERVISOR_UNREAD_CURSOR, nowIso });
  if (read.isErr()) {
    return { kind: "unavailable", why: read.error.message };
  }
  const words = selectUnreadWords({ read: read.value }).words;
  return { kind: "read", words: words.map(({ atIso, cut, pointer, text }) => ({ atIso, cut, pointer, text })) };
}

/** The two reads behind the pull-request verdicts, injected so a test reaches neither git nor GitHub. */
export interface CurrencyPrDeps {
  /** Each `repo:` path's `owner/repo` — what lets a bare `#N` name a pull request. */
  readonly repoSlugs: (args: { paths: readonly string[] }) => ReadonlyMap<string, string>;
  /** Each pull request's live body, keyed by lowercased identity. */
  readonly readPrBodies: (args: {
    addresses: readonly PrAddress[];
    home: string;
  }) => Promise<Result<ReadonlyMap<string, string>, GithubLiveError>>;
}

/** The production reads: `git remote get-url` per path, and one batched GitHub read with the home's credential. */
export const PRODUCTION_CURRENCY_PR_DEPS: CurrencyPrDeps = {
  readPrBodies: async ({ addresses, home }) => {
    if (addresses.length === 0) {
      return ok(new Map<string, string>());
    }
    const token = githubToken({ home });
    if (token === undefined) {
      return err(noGithubCredential());
    }
    return makeReadPrBodies({ graphql: githubReadGraphql({ token }) })({ addresses });
  },
  repoSlugs: ({ paths }) => repositorySlugs({ now: Date.now, paths, resolve: originRepositoryOf }),
};

/** Every read `handover currency` injects: the pull-request reads, and where the owner's standing guidance is read from. */
export interface CurrencyDeps extends CurrencyPrDeps {
  readonly standing: CurrencyStandingDeps;
}

/** The production reads, pull requests and standing guidance alike. */
export const PRODUCTION_CURRENCY_DEPS: CurrencyDeps = {
  ...PRODUCTION_CURRENCY_PR_DEPS,
  standing: PRODUCTION_STANDING_DEPS,
};

/**
 * Every pull request the owner asked proof on, and whether its live body carries it. A failed GitHub read is a verdict of
 * `body-unread` on each, never a failed reading: the rest of the document is still true.
 *
 * @param models the composed board, every row — a quote on a settled row still bears on its pull request
 * @param home the state home the credential is read from
 * @param deps the injected reads
 * @returns the verdicts, and the source line naming what was read
 */
async function pullRequestsOf({
  models,
  home,
  deps,
}: {
  models: readonly BoardModel[];
  home: string;
  deps: CurrencyPrDeps;
}): Promise<{ readonly pullRequests: readonly CurrencyPullRequest[]; readonly github: string }> {
  const paths = models.flatMap((model) => (model.doc.repo === undefined ? [] : [model.doc.repo]));
  const repoSlugs = deps.repoSlugs({ paths });
  const asked = proofAskedPrs({ prs: prsOnBoard({ rows: boardPrSteerRows({ models, repoSlugs }) }) });
  const addresses = asked.flatMap(({ pr }) => {
    const address = prAddressOfIdentity({ identity: pr.identity });
    return address === undefined ? [] : [address];
  });
  const read = await deps.readPrBodies({ addresses, home });
  if (read.isErr()) {
    const pullRequests = currencyPullRequestsOf({ asked, bodies: { kind: "unread", why: read.error.message } });
    return { github: sourceLine({ read: "", why: read.error.message }), pullRequests };
  }
  const pullRequests = currencyPullRequestsOf({ asked, bodies: { bodies: read.value, kind: "read" } });
  return {
    github: sourceLine({ read: `${String(read.value.size)} pull-request bodies read`, why: undefined }),
    pullRequests,
  };
}

/**
 * Each ask's Slack reply check, run only where the ask carries the one done-check the register writes.
 *
 * @param asks the waiting asks, in the reading's order
 * @param home the state home the Slack credential is read from
 * @returns each ask's reply check, `undefined` where it carries none
 */
async function repliesOf({
  asks,
  home,
}: {
  asks: readonly CurrencyAsk[];
  home: string;
}): Promise<readonly (Awaited<ReturnType<typeof checkOwnerReply>> | undefined)[]> {
  return Promise.all(
    asks.map(async (ask) => {
      const permalink = derivedReplyCheck({ ask });
      if (permalink === undefined) {
        return undefined;
      }
      return checkOwnerReply({ home, permalink });
    }),
  );
}

/**
 * Build the whole reading.
 *
 * @param handoverDir the board's directory
 * @param home the state home every source is read under
 * @param nowIso the verb's clock — when the card says it was checked
 * @param deps the pull-request and standing reads, {@link PRODUCTION_CURRENCY_DEPS} in production
 * @returns the document, or why the board could not be read
 */
export async function currencyDocument({
  handoverDir,
  home,
  nowIso,
  deps,
}: {
  handoverDir: string;
  home: string;
  nowIso: string;
  deps: CurrencyDeps;
}): Promise<{ kind: "built"; document: CurrencyDocument } | { kind: "unreadable"; why: string }> {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return { kind: "unreadable", why: scan.error.message };
  }
  const others = readCurrencyCardSources({ checkedIso: nowIso, home });
  if (others.isErr()) {
    return { kind: "unreadable", why: others.error.message };
  }
  const docs = scan.value.docs;
  const { asks, journals, models } = currencyBoardOf({ docs, handoverDir, home, unreadable: scan.value.unreadable });
  const replies = await repliesOf({ asks, home });
  const askCards = asks.map((ask, index) => {
    const done = doneOf({ ask, reply: replies[index] });
    return { card: askCurrencyCard({ ask, done }), done };
  });
  const cards: readonly { card: CurrencyCardCandidate; done: CurrencyDone | undefined }[] = [
    ...askCards,
    ...others.value.map((card) => ({ card, done: undefined })),
  ];
  const { github, pullRequests } = await pullRequestsOf({ deps, home, models });
  const readFromIso = readFromOf({ cards: cards.map(({ card }) => card), nowIso });
  const { intake, voice: relays } = readIntakeHalves({
    docs,
    handoverDir,
    home,
    journals,
    nowIso,
    sinceIso: readFromIso,
  });
  const voice = readVoiceUnread({ home, nowIso });
  const standing = await readCurrencyStanding({ deps: deps.standing, home, journals, nowIso });
  const rows: CurrencyRow[] = oneRowPerCard({
    rows: cards.map(({ card, done }) => currencyRowOf({ card, done, intake, readFromIso, relays, standing, voice })),
  });
  return {
    document: {
      checkedIso: nowIso,
      schemaVersion: CURRENCY_SCHEMA_VERSION,
      pullRequests,
      readFromIso,
      rows,
      said: saidOf({ intake, relays, rows, standing, voice }),
      sources: { ...sourcesOf({ github, intake, relays, voice }), ...standing.sources },
    },
    kind: "built",
  };
}

/**
 * What each source of the owner's words read, or why it could not.
 *
 * @param github the pull-request body read's own line
 * @returns the document's owner-words `sources`; the standing read supplies the rest
 */
function sourcesOf({
  github,
  intake,
  relays,
  voice,
}: {
  github: string;
  intake: ReturnType<typeof readIntakeHalves>["intake"];
  relays: ReturnType<typeof readIntakeHalves>["voice"];
  voice: VoiceUnread;
}): Omit<CurrencyDocument["sources"], "memory" | "profile" | "rulings"> {
  const chairRead = intake.kind === "read" ? `${String(intake.finding.turns.length)} turns read` : "";
  const relaysRead = relays.kind === "read" ? `${String(relays.relays.length)} undelivered` : "";
  const voiceRead = voice.kind === "read" ? `${String(voice.words.length)} unread call words` : "";
  return {
    chair: sourceLine({ read: chairRead, why: intake.kind === "unavailable" ? intake.why : undefined }),
    github,
    relays: sourceLine({ read: relaysRead, why: relays.kind === "unavailable" ? relays.why : undefined }),
    voice: sourceLine({ read: voiceRead, why: voice.kind === "unavailable" ? voice.why : undefined }),
  };
}

/**
 * Run the `handover currency` verb.
 *
 * @param argv the full process argv
 * @returns 0 whenever the reading was written and any requested append landed, 1 when the board could not be read
 *   or the ledger refused a requested append, 2 a usage mistake
 */
export async function runHandoverCurrency(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CURRENCY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverCurrencyArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CURRENCY_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const handoverDir = resolveHandoverDir({ dir: typeof values["dir"] === "string" ? values["dir"] : undefined, home });
  const nowIso = typeof values["now"] === "string" ? values["now"] : new Date().toISOString();
  const nowRefusal = currencyNowRefusal({ now: nowIso, wallMs: Date.now() });
  if (nowRefusal !== undefined) {
    logger.error({ msg: `handover currency: ${nowRefusal}` });
    logger.error({ msg: CURRENCY_USAGE });
    return EXIT_USAGE;
  }
  const built = await currencyDocument({ deps: PRODUCTION_CURRENCY_DEPS, handoverDir, home, nowIso });
  if (built.kind === "unreadable") {
    logger.error({ msg: `handover currency: ${built.why}` });
    return EXIT_ERROR;
  }
  const { document } = built;
  const recordReadingBy = typeof values["record-reading"] === "string" ? values["record-reading"] : undefined;
  // The append is attempted before anything prints, and its exit returned after: a completed read is always shown.
  const { recorded, text } = currencyOutputOf({ document, home, recordReadingBy });
  if (values["json"] === true) {
    logger.out({ line: text });
  } else {
    for (const line of currencyHumanLines({ document, full: values["full"] === true })) {
      logger.out({ line });
    }
  }
  return recordedExit({ recorded });
}

export const handoverCurrencyCommand = defineCommand({ run: runHandoverCurrency });
