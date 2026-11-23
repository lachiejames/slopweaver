/**
 * One valid line or document per store export part, shaped exactly as each domain's own writer emits it, and
 * the contents of a whole export built from them. Synthetic organisation throughout.
 */
import type { OwnerDirectiveOverlay } from "../../../../judgement/ownerDirective.js";
import { standingAskLine } from "../../../../profile/standingAsks.js";
import {
  steerMeasurementEnvelopeLine,
  steerMeasurementEnvelopeOfV1Line,
} from "../../../../profile/steerMeasurementTransfer.js";
import { PROFILE_PAYLOAD_SCHEMA_VERSION } from "../../../../store/profile/types.js";
import type { StoreExportContents } from "../../../../store/transfer/bundlePublish.js";

/** One exported recording line, as `knowledge export` writes it. */
export const MEMORY_LINE = JSON.stringify({
  behaviourChange: "check the sample rate first",
  caveat: null,
  claim: "acme's widget queue drains in order",
  createdAt: "2026-10-01T09:00:01.000Z",
  domain: "datadog",
  evidence: "0 of 412 traces over 7d",
  id: "l-0000000000000001",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: "2026-10-01T09:00:00.000Z",
  recordingId: "bbbbbbbb-0000-4000-8000-000000000001",
  repro: null,
  retrievalCue: "a widget queue task",
  run: "ad-hoc",
  seq: 4,
  supersedes: null,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
});

/** One exported recall line. */
export const RECALL_LINE = JSON.stringify({
  createdAt: "2026-10-02T09:00:01.000Z",
  evidence: "re-ran the probe, still 0",
  memoryId: "l-0000000000000001",
  outcome: "held",
  recallId: "cccccccc-0000-4000-8000-000000000001",
  recordedAt: "2026-10-02T09:00:00.000Z",
  recordingId: "bbbbbbbb-0000-4000-8000-000000000001",
  run: "ad-hoc",
  seq: 2,
});

/** One measured voice cohort line. */
export const VOICE_LINE = JSON.stringify({
  ceilingWords: 50,
  cohort: "all-sent",
  measuredAt: "2026-08-23T00:00:00.000Z",
  medianWords: 14,
  p75Words: 29,
  p90Words: 54,
  qualification: "residual agent-authored messages in the sample",
  sampleCount: 4718,
  source: "file:profile/rules/communication-style.md",
  surface: "slack",
});

/** The owner row's portable half. */
export const OWNER = {
  displayName: "Acme Owner",
  judgementProfile: null,
  selfDescription: { alwaysLoaded: [], facts: [], schemaVersion: PROFILE_PAYLOAD_SCHEMA_VERSION, waysOfWorking: [] },
} as const;

/** One directive, twice under two ids — the shape a real export held. */
export const DIRECTIVES: OwnerDirectiveOverlay = {
  corrections: [],
  directives: ["d-one", "d-two"].map((id) => ({
    id,
    source: { contentHash: `sha256:${"a".repeat(64)}`, file: "acme-rule.md", modified: null },
    text: "draft first, never post directly",
  })),
  schemaVersion: 2,
};

const QUOTE = {
  anchor: "talk:00000000-0000-4000-8000-000000000001",
  atIso: "2026-10-04T00:55:00.000Z",
  cut: "none",
  where: "console-voice",
  words: "if you ever find something worth a look, chuck it on the board",
} as const;

/** One recorded standing ask, then its withdrawal. */
export const STANDING_ASK_LINES = [
  standingAskLine({
    event: {
      covers: ["findings"],
      id: "org-intel",
      kind: "recorded",
      quote: QUOTE,
      recordedAtIso: "2026-10-09T12:00:00.000Z",
    },
  }),
  standingAskLine({
    event: { id: "org-intel", kind: "withdrawn", reason: "superseded", withdrawnAtIso: "2026-10-09T13:00:00.000Z" },
  }),
] as const;

/** One steer verdict that found nothing. */
export const STEER_LINE = JSON.stringify({
  anchor: "slack:acme/C0FIXTURE/1760000000.000100",
  judgedAtIso: "2026-10-10T00:00:00.000Z",
  says: "nothing",
  turnAtIso: "2026-10-09T23:00:00.000Z",
});

/**
 * The v2 envelope an import of {@link STEER_LINE} makes at a place in its file.
 *
 * @returns the envelope's part line
 */
export function steerEnvelopeLine({ sourceOrdinal }: { sourceOrdinal: number }): string {
  return steerMeasurementEnvelopeLine({
    envelope: steerMeasurementEnvelopeOfV1Line({ exactText: STEER_LINE, sourceOrdinal }),
  });
}

/** A recorded measurement's v2 envelope, its id a uuid and its place none. */
export const STEER_RECORDED_ENVELOPE_LINE = steerMeasurementEnvelopeLine({
  envelope: {
    eventId: "steer-event-aaaaaaaa-0000-4000-8000-000000000001",
    exactText: STEER_LINE,
    parseStatus: "parsed",
    schemaVersion: 2,
    sourceOrdinal: null,
  },
});

/** A whole export's contents, one or two rows per part. */
export const CONTENTS: StoreExportContents = {
  directives: DIRECTIVES,
  memoryLines: [MEMORY_LINE],
  owner: OWNER,
  recallLines: [RECALL_LINE],
  standingAskLines: STANDING_ASK_LINES,
  steerMeasurementLines: [steerEnvelopeLine({ sourceOrdinal: 1 }), steerEnvelopeLine({ sourceOrdinal: 2 })],
  voiceLines: [VOICE_LINE],
};
