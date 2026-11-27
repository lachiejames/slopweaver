/**
 * The `GUARDED`, `PROBES` and `PARSERS` help-truth tables, assembled from one slice per verb family. A spread
 * would let a later slice's address silently replace an earlier one, which a single object literal refused at
 * compile time, so {@link mergeSlices} records every address defined twice and `../helpTruth.test.ts` asserts
 * there are none. `UNGUARDED` stays a literal in the test, where the `help-flag-opt-out` gate reads it.
 */

import { atlasHexAndNotionSlice } from "./atlasHexAndNotion.js";
import { automationAndSweepSlice } from "./automationAndSweep.js";
import { automationSwitchSlice } from "./automationSwitch.js";
import { briefingAndReflectSlice } from "./briefingAndReflect.js";
import { browserSlice } from "./browser.js";
import { calendarAndDriveSlice } from "./calendarAndDrive.js";
import { cloudAndSecretsSlice } from "./cloudAndSecrets.js";
import { cmuxSlice } from "./cmux.js";
import { corpusAndMemorySlice } from "./corpusAndMemory.js";
import { datadogInvestigateSlice } from "./datadogInvestigate.js";
import { datadogOperationsSlice } from "./datadogOperations.js";
import { devAndProofSlice } from "./devAndProof.js";
import { fleetAndWorkstreamsSlice } from "./fleetAndWorkstreams.js";
import { freshCutSlice } from "./freshCut.js";
import { githubCiSlice } from "./githubCi.js";
import { githubLandingSlice } from "./githubLanding.js";
import { githubPullRequestsSlice } from "./githubPullRequests.js";
import { githubRepositorySlice } from "./githubRepository.js";
import { githubReviewsSlice } from "./githubReviews.js";
import { gmailSlice } from "./gmail.js";
import { grantAndVulnerabilityFixSlice } from "./grantAndVulnerabilityFix.js";
import { handSlice } from "./hand.js";
import { handoverBoardSlice } from "./handoverBoard.js";
import { handoverRulingsSlice } from "./handoverRulings.js";
import { handoverRunSlice } from "./handoverRun.js";
import { knowledgeSlice } from "./knowledge.js";
import { linearReadsSlice } from "./linearReads.js";
import { linearWritesSlice } from "./linearWrites.js";
import { listenAndWitnessSlice } from "./listenAndWitness.js";
import { meetingAndCallProvidersSlice } from "./meetingAndCallProviders.js";
import { type HelpTruthSlice, mergeSlices } from "./mergeSlices.js";
import { modelHostsSlice } from "./modelHosts.js";
import { orgAndProfileSlice } from "./orgAndProfile.js";
import { plansSlice } from "./plans.js";
import { privateTermsSlice } from "./privateTerms.js";
import { proposalSlice } from "./proposal.js";
import { protectSlice } from "./protect.js";
import { queueKnockAndAutonomySlice } from "./queueKnockAndAutonomy.js";
import { rulingSlice } from "./ruling.js";
import { securityAndComplianceSlice } from "./securityAndCompliance.js";
import { sessionsSlice } from "./sessions.js";
import { slackDraftsSlice } from "./slackDrafts.js";
import { slackReadsSlice } from "./slackReads.js";
import { slackWritesSlice } from "./slackWrites.js";
import { spendAndPerfSlice } from "./spendAndPerf.js";
import { storeBackupSlice } from "./storeBackup.js";
import { storeCorpusSlice } from "./storeCorpus.js";
import { storeProjectionsSlice } from "./storeProjections.js";
import { storeReadsSlice } from "./storeReads.js";
import { supervisorChairSlice } from "./supervisorChair.js";
import { supervisorStateSlice } from "./supervisorState.js";
import { supervisorTickSlice } from "./supervisorTick.js";
import { talkCallsSlice } from "./talkCalls.js";
import { talkCardsAndRelaySlice } from "./talkCardsAndRelay.js";
import { talkContextSlice } from "./talkContext.js";
import { transcriptsAndReadingSlice } from "./transcriptsAndReading.js";
import { turnBlocksSlice } from "./turnBlocks.js";
import { turnRunSlice } from "./turnRun.js";
import { workspaceSlice } from "./workspace.js";

/** Every slice: one per small-noun family, or one per verb family of a long noun. */
const SLICES: readonly HelpTruthSlice[] = [
  atlasHexAndNotionSlice,
  automationAndSweepSlice,
  automationSwitchSlice,
  briefingAndReflectSlice,
  browserSlice,
  calendarAndDriveSlice,
  cloudAndSecretsSlice,
  cmuxSlice,
  corpusAndMemorySlice,
  datadogInvestigateSlice,
  datadogOperationsSlice,
  devAndProofSlice,
  fleetAndWorkstreamsSlice,
  freshCutSlice,
  githubCiSlice,
  githubLandingSlice,
  githubPullRequestsSlice,
  githubRepositorySlice,
  githubReviewsSlice,
  gmailSlice,
  grantAndVulnerabilityFixSlice,
  handSlice,
  handoverBoardSlice,
  handoverRulingsSlice,
  handoverRunSlice,
  knowledgeSlice,
  linearReadsSlice,
  linearWritesSlice,
  listenAndWitnessSlice,
  meetingAndCallProvidersSlice,
  modelHostsSlice,
  orgAndProfileSlice,
  plansSlice,
  privateTermsSlice,
  proposalSlice,
  protectSlice,
  queueKnockAndAutonomySlice,
  rulingSlice,
  securityAndComplianceSlice,
  sessionsSlice,
  slackDraftsSlice,
  slackReadsSlice,
  slackWritesSlice,
  spendAndPerfSlice,
  storeBackupSlice,
  storeCorpusSlice,
  storeProjectionsSlice,
  storeReadsSlice,
  supervisorChairSlice,
  supervisorStateSlice,
  supervisorTickSlice,
  talkCallsSlice,
  talkCardsAndRelaySlice,
  talkContextSlice,
  transcriptsAndReadingSlice,
  turnBlocksSlice,
  turnRunSlice,
  workspaceSlice,
];

const guarded = mergeSlices({ pick: (slice) => slice.guarded, slices: SLICES });
const probes = mergeSlices({ pick: (slice) => slice.probes, slices: SLICES });
const parsers = mergeSlices({ pick: (slice) => slice.parsers, slices: SLICES });

/**
 * Each guarded verb's address and the flags its parser accepts, which its usage must advertise exactly.
 *
 * @internal — read only by `../helpTruth.test.ts`.
 */
export const GUARDED = guarded.table;

/**
 * Each guarded verb's address, then each advertised flag and a valid invocation that exercises it.
 *
 * @internal — read only by `../helpTruth.test.ts`.
 */
export const PROBES = probes.table;

/**
 * Which parser each guarded verb is probed against — a TABLE rather than a ternary chain, because this is a
 * mapping, and the residual the test's header documents turns on seeing at a glance which parser checks which
 * verb.
 *
 * @internal — read only by `../helpTruth.test.ts`.
 */
export const PARSERS = parsers.table;

/**
 * Every address some table defines in more than one slice, as `<table> <address>` — empty when the split holds.
 *
 * @internal — read only by `../helpTruth.test.ts`.
 */
export const DUPLICATE_ADDRESSES: readonly string[] = [
  ...guarded.duplicates.map((address) => `GUARDED ${address}`),
  ...probes.duplicates.map((address) => `PROBES ${address}`),
  ...parsers.duplicates.map((address) => `PARSERS ${address}`),
];
