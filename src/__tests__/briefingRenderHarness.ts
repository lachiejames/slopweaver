/**
 * The seams `briefing render` runs over in its unit tests: a form, a session-start document and a recording `run`
 * that drives the whole verb through plain functions, no mocks and no disk. Kept beside
 * `unit/cli/briefingRender.test.ts` rather than in it, so that file stays under its size baseline.
 */
import type { AutonomyAction } from "../autonomy/types.js";
import {
  mapPageReader,
  type PrefetchedPage,
  PublishedPageReadErrors,
  type PublishedPageUnreadableError,
} from "../briefing/publishedPageRead.js";
import type { BriefingRenderDeps } from "../cli/commands/briefing/briefingRenderTypes.js";
import { runBriefingRenderDetailed } from "../cli/commands/briefing/renderRun.js";
import { staleSnapshotRefusalLines } from "../cli/staleSnapshotDoor.js";
import { err, ok, type Result } from "../lib/result.js";
import { GithubLiveErrors } from "../live/github/errors.js";
import type { PrPremise } from "../live/github/prPremise.js";
import type { Organisation } from "../organisation/core.js";
import { PublishedPagesReadErrors } from "../store/publishedPages/readErrors.js";
import type { SupervisorTickWindow } from "../supervisor/tickStore.js";
import { ACME_ORGANISATION } from "./organisationFixture.js";

/** The generated owner-intake sentence, which every form carries in the alignment fold. */
const INTAKE_SENTENCE = "Owner turns: 4 read across 1 supervisor session(s), all witnessed.";

export const FORM = {
  alignment: {
    headline: [{ kind: "text", text: "Both live sessions are on the board's top 5." }],
    intake: [{ kind: "text", text: INTAKE_SENTENCE }],
  },
  awaiting: [],
  header: {
    handoff: "handoff-9012",
    lede: [{ kind: "text", text: "One thing needs your word." }],
    model: "opus",
    pinnedAt: "23:57",
    sleeping: false,
    workspace: "ws:598",
  },
  history: [],
  reactNow: {
    meFacing: [],
    teamFacing: [
      {
        ifSilent: [{ kind: "text", text: "The draft stays unsent." }],
        lean: [{ kind: "text", text: "A." }],
        options: [
          { letter: "A", text: "Send it as written." },
          { letter: "B", text: "Send it with edits." },
        ],
        // A fold, because a card must offer somewhere to go for what decides it. It costs nothing above the
        // fold, so the word-budget figures these render tests assert on are untouched.
        detail: {
          blocks: [{ content: [{ kind: "text", text: "The whole draft, as it stands." }], kind: "para" }],
          summary: "The draft in full",
        },
        // Earlier than every instant any of these runs stamps, since a premise read after the render is
        // refused as dated in the future.
        premise: { kind: "composed", readIso: "2026-08-30T00:00:00.000Z" },
        question: "Are you happy with the draft?",
        what: [{ kind: "text", text: "The draft adds a template. It also adds a check that only reports." }],
        whyYou: [{ kind: "text", text: "It is a post under your name." }],
      },
    ],
  },
  recent: [],
};

/**
 * One `slopweaver session-start --json` run, holding two ranked rows.
 *
 * Its `nowIso` sits half an hour before the harness clock below, which is load-bearing rather than
 * incidental: `src/briefing/snapshotAge.ts` refuses a document older than ninety minutes, so a fixture
 * standing in for a HEALTHY run has to be one the door would let through.
 */
export const SESSION_START = {
  nowIso: "2026-09-02T01:09:30.684Z",
  ranking: {
    ranked: [
      {
        item: {
          doneWhen: "Land the render verb yourself.",
          nativeId: "a-run",
          source: "handover",
          whenIso: "2026-08-31T02:26:50.911Z",
          where: "slopweaver handover resume a-run",
          who: "the a-run session",
        },
        score: 12,
        trace: { verdict: "rank" },
        why: "somebody is stopped waiting on you",
      },
      {
        item: {
          doneWhen: "Answer the second row.",
          nativeId: "b-run",
          source: "handover",
          whenIso: "2026-08-30T02:26:50.911Z",
          where: "slopweaver handover resume b-run",
          who: "the b-run session",
        },
        score: 4,
        trace: { verdict: "rank" },
        why: "one reply finishes it",
      },
    ],
  },
};

/**
 * The same form whose one card carries a pull request as its subject — what every projected open-pull-request
 * card looks like, and what the freshness half of the gate judges.
 */
export const FORM_ON_A_PULL_REQUEST = {
  ...FORM,
  reactNow: {
    meFacing: [],
    teamFacing: [
      {
        ...FORM.reactNow.teamFacing[0],
        subject: {
          text: "acme-admin 11141 the parity proof",
          url: "https://github.com/acme/acme-admin/pull/11141",
        },
      },
    ],
  },
};

/** What one run recorded: what it wrote where, and every line it printed. */
export interface Recorded {
  readonly exit: number;
  /** The typed refusal's code, as `supervisor tick close` reads it in process. */
  readonly refusalCode: string | undefined;
  readonly written: { path: string; html: string }[];
  readonly out: string[];
  readonly diagnostics: string[];
  /** How many times the run asked GitHub for the pull requests its cards name. */
  readonly premiseReads: number;
}

/**
 * The store refusal a down store answers, naming the first page asked for.
 *
 * @returns the unreadable-page refusal whose cause is a refused connection
 */
export function storeDownFor({ url }: { url: string }): PublishedPageUnreadableError {
  const cause = PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "connect" });
  return PublishedPageReadErrors.unreadable({ cause, url });
}

/**
 * A prefetch over the given frozen bytes. Only the URLs the run asks for are fetched, so a page a projection reads
 * without prefetching it refuses; a down store refuses any non-empty set, as the production adapter does.
 */
function prefetchOver({
  frozenPages,
  storeDown,
}: {
  frozenPages: Record<string, string>;
  storeDown: boolean;
}): BriefingRenderDeps["prefetchPublishedPages"] {
  return ({ urls }) => {
    const first = urls[0];
    if (storeDown && first !== undefined) {
      return Promise.resolve(err(storeDownFor({ url: first })));
    }
    const pages = urls.map((url): [string, PrefetchedPage] => {
      const html = frozenPages[url];
      return [url, html === undefined ? err(PublishedPagesReadErrors.neverFrozen({ pageKey: url })) : ok(html)];
    });
    return Promise.resolve(ok(mapPageReader({ pages: new Map(pages) })));
  };
}

/** What a case may vary about one run; every field but `rest` has a default the healthy run uses. */
interface RunOptions {
  rest: readonly string[];
  /** What the organisation read answers; Acme unless a case drives an install with none written. */
  organisation?: Result<Organisation>;
  /** The home's frozen page bytes by url; a page not named here answers as never frozen. */
  frozenPages?: Record<string, string>;
  /** Whether the published-page store refuses every prefetch that asks it for a page. */
  storeDown?: boolean;
  raw?: string;
  yourListDocument?: string;
  premises?: readonly PrPremise[];
  premiseReadFails?: boolean;
  openArtifactsDocument?: string;
  /** When the open-artifact file was last written; defaults to half an hour before the harness clock. */
  openArtifactsWrittenIso?: string | undefined;
  /** Whether the run holds an open stale-snapshot hatch, so one case can drive the page it publishes. */
  snapshotHatchOpen?: boolean;
  lockInLedger?: string;
  autonomyActions?: readonly AutonomyAction[];
  tickWindow?: SupervisorTickWindow;
  /** The voice-rule seam; no rules unless a case hands in the production reader. */
  voiceRules?: BriefingRenderDeps["voiceRules"];
}

/** The document readers a run answers from the case's options: each refuses when the case supplied nothing. */
function documentReaders({
  autonomyActions,
  openArtifactsDocument,
  openArtifactsWrittenIso = "2026-09-02T01:10:00.000Z",
  tickWindow,
  yourListDocument,
}: RunOptions): Pick<BriefingRenderDeps, "readAutonomy" | "readOpenArtifacts" | "readTicks" | "readYourList"> {
  return {
    readAutonomy: ({ home }) =>
      Promise.resolve(
        autonomyActions === undefined ? err([`${home}: no autonomy ledger in this test`]) : ok(autonomyActions),
      ),
    readOpenArtifacts: ({ source }) =>
      openArtifactsDocument === undefined
        ? err([`${source}: no open-artifact document in this test`])
        : ok({ text: openArtifactsDocument, writtenIso: openArtifactsWrittenIso }),
    readTicks: ({ source }) =>
      Promise.resolve(tickWindow === undefined ? err([`${source}: no tick ledger in this test`]) : ok(tickWindow)),
    readYourList: ({ source }) =>
      yourListDocument === undefined
        ? err([`${source}: no session-start document in this test`])
        : ok(yourListDocument),
  };
}

/**
 * Run the verb with recording seams and a form the caller may break.
 *
 * @returns the exit code, the refusal code, every page written and every line printed
 */
export async function run(options: RunOptions): Promise<Recorded> {
  const {
    rest,
    raw = JSON.stringify(FORM),
    premises = [],
    premiseReadFails = false,
    snapshotHatchOpen = false,
    lockInLedger = "",
    voiceRules = () => ok([]),
    frozenPages = {},
    storeDown = false,
    organisation = ok(ACME_ORGANISATION),
  } = options;
  let premiseReads = 0;
  const written: { path: string; html: string }[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: BriefingRenderDeps = {
    ...documentReaders(options),
    applyBareRefs: () => true,
    applyFraming: true,
    applyPrPremise: () => true,
    snapshotAgeRefusal: ({ stale }) =>
      stale.length === 0 || snapshotHatchOpen ? [] : staleSnapshotRefusalLines({ stale }),
    applyVoice: () => true,
    defaultHome: () => "/no/such/home",
    now: () => "2026-09-02T01:40:00.000Z",
    readForm: () => raw,
    readImageDataUri: ({ path }) => err([`${path}: no image reading seam in this test`]),
    readLockIns: () => lockInLedger,
    prefetchPublishedPages: prefetchOver({ frozenPages, storeDown }),
    // No page file exists in this test, so every subject is read as spelled.
    pagesOpened: () => [],
    readPrPremises: () => {
      premiseReads += 1;
      return Promise.resolve(
        premiseReadFails
          ? err(GithubLiveErrors.readFailed({ message: "the credential could not reach GitHub" }))
          : ok(new Map(premises.map((premise) => [premise.identity, premise]))),
      );
    },
    readOrganisation: () => Promise.resolve(organisation),
    voiceRules,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
    writePage: ({ path, html }) => {
      written.push({ html, path });
    },
  };
  const { exitCode: exit, refusalCode } = await runBriefingRenderDetailed({ deps, rest });
  return { diagnostics, exit, out, premiseReads, refusalCode, written };
}
