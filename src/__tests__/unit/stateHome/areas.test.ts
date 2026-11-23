import { describe, expect, it } from "vitest";
import { accountsStateHomePaths } from "../../../stateHome/accounts.js";
import { corpusStateHomePaths } from "../../../stateHome/corpus.js";
import { evidenceStateHomePaths } from "../../../stateHome/evidence.js";
import { identityStateHomePaths } from "../../../stateHome/identity.js";
import { ledgersStateHomePaths } from "../../../stateHome/ledgers.js";
import { liveStateHomePaths } from "../../../stateHome/live.js";
import { providersStateHomePaths } from "../../../stateHome/providers.js";
import { sessionsStateHomePaths } from "../../../stateHome/sessions.js";
import { workstreamsStateHomePaths } from "../../../stateHome/workstreams.js";
import { stateHomePaths } from "../../../stateHome.js";

/*
 * Each area of the state-home contract declares exactly its own fields, derives them under the home it is given,
 * and is composed into the entry's `stateHomePaths` with identical values. The whole-layout values stay
 * `stateHome.test.ts`'s subject; this file pins which area owns which key.
 */
const HOME = "/tmp/sw-home";
const ENTRY = stateHomePaths({ home: HOME });

describe("the state-home areas", () => {
  it("partition the entry's keys: every key is the entry's own or exactly one area's", () => {
    const areaKeys = [
      accountsStateHomePaths({ home: HOME }),
      corpusStateHomePaths({ home: HOME }),
      evidenceStateHomePaths({ home: HOME }),
      identityStateHomePaths({ home: HOME }),
      ledgersStateHomePaths({ home: HOME }),
      liveStateHomePaths({ home: HOME }),
      providersStateHomePaths({ home: HOME }),
      sessionsStateHomePaths({ home: HOME }),
      workstreamsStateHomePaths({ home: HOME }),
    ].flatMap((area) => Object.keys(area));
    const entryOwn = [
      "atlas",
      "consoleSyncFailureAppendFailuresJsonl",
      "homeDocsSite",
      "homeExecStore",
      "homeVersion",
      "root",
    ];
    expect(areaKeys.length).toBeGreaterThan(0);
    expect(new Set(areaKeys).size).toBe(areaKeys.length);
    expect([...areaKeys, ...entryOwn].toSorted()).toEqual(Object.keys(ENTRY).toSorted());
  });
});

describe("accountsStateHomePaths", () => {
  const area = accountsStateHomePaths({ home: HOME });

  it("declares the plan register and the model-account records", () => {
    expect(Object.keys(area).toSorted()).toEqual([
      "claudeAccountsJson",
      "claudeMemory",
      "claudeResetClaimsJsonl",
      "codexAccountsDir",
      "codexBurnClaims",
      "codexBurnJsonl",
      "codexFallback",
      "codexQuotaDir",
      "codexQuotaJson",
      "codexResetClaimsJsonl",
      "codexSignInDir",
      "codexSupersessionsJsonl",
      "drawdownJsonl",
      "plansJson",
    ]);
    expect(area.codexBurnClaims).toBe("/tmp/sw-home/codex-burn/claims");
    expect(area.codexAccountsDir).toBe("/tmp/sw-home/codex-accounts");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("corpusStateHomePaths", () => {
  const area = corpusStateHomePaths({ home: HOME });

  it("declares the medallion corpus and nothing else", () => {
    expect(Object.keys(area)).toEqual(["corpus"]);
    expect(area.corpus.root).toBe("/tmp/sw-home/corpus");
    expect(area.corpus.chatgptExports).toBe("/tmp/sw-home/corpus/exports/chatgpt");
    expect(area.corpus.chatgptLive).toBe("/tmp/sw-home/corpus/chatgpt/live");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("evidenceStateHomePaths", () => {
  const area = evidenceStateHomePaths({ home: HOME });

  it("declares proof, pages, proposals, briefs and fan-outs", () => {
    expect(Object.keys(area).toSorted()).toEqual([
      "answerQualityCasesJson",
      "briefs",
      "datadogShotsDir",
      "desktopE2eProofDir",
      "detective",
      "evidenceDir",
      "fanout",
      "footprint",
      "freshCuts",
      "githubExposureReports",
      "morning",
      "notionRendersDir",
      "pageMeetings",
      "pageReviews",
      "pages",
      "prDescriptionReviews",
      "proofDir",
      "proposals",
      "proposalsDestinationJson",
      "proposalsRegister",
      "publicationAuditReports",
      "publishedPages",
      "visualEvidenceCaptures",
      "visualEvidenceRecords",
      "visualEvidenceUploads",
      "zeroReferencesProofDir",
    ]);
    expect(area.visualEvidenceCaptures).toBe("/tmp/sw-home/visual-evidence/captures");
    expect(area.visualEvidenceUploads).toBe("/tmp/sw-home/visual-evidence/uploads");
    expect(area.publicationAuditReports).toBe("/tmp/sw-home/evidence/publication-audit");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("identityStateHomePaths", () => {
  const area = identityStateHomePaths({ home: HOME });

  it("declares who the owner is, who may reach the bot, the per-install lists and the secrets store", () => {
    expect(Object.keys(area).toSorted()).toEqual([
      "capabilityProfileJson",
      "cassetteRedaction",
      "generalRulingsJson",
      "hygieneDenylist",
      "hygieneReplacementsTsv",
      "identityExclusion",
      "identityJson",
      "indirectReferenceMap",
      "indirectReferenceReport",
      "judgement",
      "memoryGateBaseline",
      "orgDomains",
      "privateTermProposals",
      "privateTermReviews",
      "privateTerms",
      "profileContextJson",
      "profileDeliveredDir",
      "profileFirstBootDir",
      "profileJson",
      "profileLoadsJsonl",
      "profileOwnerWritten",
      "protectedPathsJson",
      "pushRootsJson",
      "referenceMap",
      "respondersJson",
      "rulingsJsonl",
      "secrets",
      "statePrePushHook",
      "storeLockBackups",
      "storeLockDir",
      "syncAuthorDenylist",
      "trustedAskersJson",
      "vantaTokenDir",
    ]);
    expect(Object.keys(area.judgement).toSorted()).toEqual([
      "dataClassRulesJson",
      "miningBriefJson",
      "miningCacheJson",
      "ownerDirectivesJson",
      "profileJson",
      "root",
      "standingAsksJsonl",
      "steerKindsJsonl",
    ]);
    expect(area.cassetteRedaction.idMap).toBe("/tmp/sw-home/cassette-id-map.json");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("ledgersStateHomePaths", () => {
  const area = ledgersStateHomePaths({ home: HOME });

  it("declares ledgers/ and every journal inside it, and the laps/ run directory beside it", () => {
    expect(Object.keys(area).toSorted()).toEqual([
      "autonomyLedgerJsonl",
      "baselineBumps",
      "goldDebtLedgerJsonl",
      "handoverWakeJournalJsonl",
      "handoverWakeTurnsJson",
      "homeReclaimLedgerJsonl",
      "landingPressResealsJsonl",
      "lapLockJson",
      "lapSeatJson",
      "laps",
      "ledgers",
      "prChecksReadJsonl",
      "reviewerRegisterJsonl",
      "signInProbesJsonl",
      "slackSendFailuresJsonl",
      "sweepLedgerJsonl",
      "valueSamples",
      "walkthroughThreadsJsonl",
    ]);
    expect(area.sweepLedgerJsonl).toBe("/tmp/sw-home/ledgers/sweep.jsonl");
    expect(area.valueSamples).toBe("/tmp/sw-home/ledgers/value-samples");
    expect(area.baselineBumps).toBe("/tmp/sw-home/ledgers/baseline-bumps");
    expect(area.landingPressResealsJsonl).toBe("/tmp/sw-home/ledgers/landing-press-reseals.jsonl");
    expect(area.lapLockJson).toBe("/tmp/sw-home/laps/lock.json");
    expect(area.lapSeatJson).toBe("/tmp/sw-home/laps/seat.json");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("liveStateHomePaths", () => {
  const area = liveStateHomePaths({ home: HOME });

  it("declares the live tier and each of its sub-trees", () => {
    expect(Object.keys(area)).toEqual(["live"]);
    expect(Object.keys(area.live).toSorted()).toEqual([
      "browser",
      "chatgpt",
      "claudeUsageSnapshotsDir",
      "codexPassReservationsJson",
      "consoleSyncFailuresJsonl",
      "devLintGateSecondsJson",
      "events",
      "fathom",
      "frictionReview",
      "github",
      "gmail",
      "hygiene",
      "listener",
      "machine",
      "outlook",
      "planConnectionsDir",
      "pollGateDir",
      "recipe",
      "root",
      "seatPassDir",
      "slack",
      "standing",
      "syncRunsDir",
      "vuln",
    ]);
    expect(area.live.slack.turnJournal).toBe("/tmp/sw-home/live/slack/turn-journal");
    expect(area.live.recipe.propagationDir).toBe("/tmp/sw-home/live/recipe/propagation");
    expect(area.live.codexPassReservationsJson).toBe("/tmp/sw-home/live/codex-pass-reservations.json");
    expect(area.live.devLintGateSecondsJson).toBe("/tmp/sw-home/live/dev-lint-gate-seconds.json");
    expect(area.live.consoleSyncFailuresJsonl).toBe("/tmp/sw-home/live/console-sync-failures.jsonl");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("providersStateHomePaths", () => {
  const area = providersStateHomePaths({ home: HOME });

  it("declares what this install keeps about the providers and processes it drives", () => {
    expect(Object.keys(area).toSorted()).toEqual([
      "alignmentBoardJson",
      "bakeoff",
      "browserJson",
      "calendarIntents",
      "chromePin",
      "datadogCatalogue",
      "datadogHits",
      "gmailTriageRulesJson",
      "incidents",
      "incidentsSeenJsonl",
      "landingCodeRabbitNudgesDir",
      "landingPressesJsonl",
      "landingReadsJson",
      "linearRetiredTeamsJson",
      "orgHealthAcknowledgementsJsonl",
      "orgHealthIncidentsJson",
      "orgHealthSightingsJson",
      "perfConsole",
      "queue",
      "rulingGatesJson",
      "slackDraftMedia",
      "slices",
      "spendCapture",
      "spendCards",
      "spendForwards",
      "storeBackups",
      "vantaChanges",
      "vantaChangesCursorJson",
      "worktreeBundles",
      "worktreePruneTriggerDir",
      "worktreePruneTriggerLog",
    ]);
    expect(area.datadogCatalogue).toEqual({
      manifest: "/tmp/sw-home/datadog/catalogue/manifest.json",
      root: "/tmp/sw-home/datadog/catalogue",
      rows: "/tmp/sw-home/datadog/catalogue/rows.jsonl",
    });
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("sessionsStateHomePaths", () => {
  const area = sessionsStateHomePaths({ home: HOME });

  it("declares the sessions, the board, the grants, the fleet's imports, cmux and the hand steps", () => {
    expect(Object.keys(area).toSorted()).toEqual([
      "agentToolBansJson",
      "cmuxEventCursorJson",
      "cmuxNotificationDecisionsJsonl",
      "cmuxNotificationFilterSh",
      "cmuxRelays",
      "cmuxReviveJsonl",
      "cmuxSessionActivityJson",
      "fleetConfigJson",
      "fleetHealthShownJson",
      "fleetResumeJsonl",
      "grantJournalJsonl",
      "grants",
      "handNoteApps",
      "handNoteDismiss",
      "handPushedJsonl",
      "handShots",
      "handSteps",
      "handStepsJsonl",
      "handoverArchive",
      "handovers",
      "hatchGrantsJsonl",
      "intakeMarksJsonl",
      "orchestration",
      "reachGrantsJsonl",
      "runs",
      "sessions",
      "skillRemindersJson",
      "staleSeatNoticesJson",
      "supervisorChainJsonl",
      "supervisorPinJson",
      "supervisorScratch",
      "voiceBriefReceipts",
    ]);
    expect(area.grantJournalJsonl).toBe("/tmp/sw-home/grants/journal.jsonl");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});

describe("workstreamsStateHomePaths", () => {
  const area = workstreamsStateHomePaths({ home: HOME });

  it("declares the knowledge register, the readings ledger, the owner's workstreams and the console voice", () => {
    expect(Object.keys(area).toSorted()).toEqual([
      "knowledge",
      "knowledgeDomainsJson",
      "knowledgeLessonsJsonl",
      "knowledgeRedactionArchive",
      "readings",
      "readingsIndexJsonl",
      "talkAttachments",
      "talkCourier",
      "talkE2eReopenProbeJson",
      "talkPackJson",
      "talkRelaysJsonl",
      "talkRunningListJson",
      "talkTurns",
      "talkUnreadAdoptReceiptsJsonl",
      "workstreamsCandidatesJson",
      "workstreamsDefinitionsJsonl",
      "workstreamsProposalsJsonl",
      "workstreamsReactionsJsonl",
      "workstreamsRegisterJson",
      "workstreamsStatedCandidatesJson",
      "workstreamsTitlesJsonl",
      "workstreamsWhoFirstJsonl",
    ]);
    expect(area.talkTurns).toBe("/tmp/sw-home/talk/turns");
  });

  it("is composed into the entry with identical values", () => {
    expect(ENTRY).toMatchObject(area);
  });
});
