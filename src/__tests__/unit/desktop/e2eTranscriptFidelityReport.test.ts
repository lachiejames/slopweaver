import { describe, expect, it } from "vitest";

import { type E2eVerdict, failed } from "../../../desktop/e2eOutcome.js";
import {
  E2E_MIC_VARIANTS,
  type E2eMicVariant,
  TRANSCRIPT_FIDELITY_CORPUS,
} from "../../../desktop/e2eTranscriptFidelityCorpus.js";
import {
  type E2eAppliedMicSettings,
  type E2eFidelityHold,
  type E2eTranscriptFidelityTrial,
  micProcessingOf,
  surfaceReportOf,
  transcriptFidelityTrial,
} from "../../../desktop/e2eTranscriptFidelityReport.js";
import {
  compareTranscriptFidelity,
  FIDELITY_LIMITATIONS,
  transcriptFidelityReport,
} from "../../../desktop/e2eTranscriptFidelityVerdict.js";
import type { CallRecord, CallSegment } from "../../../talk/callRecord.js";

const PASSED: E2eVerdict = { passed: true };
const WHOLE: E2eFidelityHold = { heldMs: 210_000, neededMs: 205_090 };
const LINES = TRANSCRIPT_FIDELITY_CORPUS.utterances;
const SCRIPT = LINES.map((line) => line.text);

/**
 * The script as heard, with chosen lines replaced.
 *
 * @param swap line id to what was heard in its place
 * @returns the heard texts, one per line
 */
function heardWith({ swap = {} }: { swap?: Readonly<Record<string, string>> }): readonly string[] {
  return LINES.map((line) => (line.id in swap ? swap[line.id]! : line.text));
}

/** A folded call whose final owner segments are `texts`. */
function record({
  texts,
  ended = true,
  endedWhy = null,
  skipped = 0,
  openTail = [],
}: {
  texts: readonly string[];
  ended?: boolean;
  endedWhy?: string | null;
  skipped?: number;
  openTail?: readonly string[];
}): CallRecord {
  const segments: CallSegment[] = texts.map((text, index) => ({
    atIso: "2026-11-06T00:00:00.000Z",
    beganIso: "2026-11-06T00:00:00.000Z",
    final: true,
    id: `seg-${index}`,
    open: undefined,
    text,
    who: "owner",
  }));
  return {
    callId: "call-acme-1",
    ended: ended ? { atIso: "2026-11-06T00:07:00.000Z", why: endedWhy } : undefined,
    lastIso: "2026-11-06T00:07:00.000Z",
    notes: [],
    offers: [],
    openedIso: "2026-11-06T00:00:00.000Z",
    origin: undefined,
    reconnects: [],
    segments: [
      ...segments,
      ...openTail.map((text, index): CallSegment => ({
        atIso: "2026-11-06T00:06:00.000Z",
        beganIso: "2026-11-06T00:06:00.000Z",
        final: false,
        id: `open-${index}`,
        open: undefined,
        text,
        who: "owner",
      })),
      {
        atIso: "2026-11-06T00:00:01.000Z",
        beganIso: "2026-11-06T00:00:01.000Z",
        final: true,
        id: "voice-0",
        open: undefined,
        text: "okay",
        who: "voice",
      },
    ],
    sessionId: undefined,
    skipped,
    surface: "voice",
    usages: [],
    voice: undefined,
    written: [],
  };
}

/** Settings exactly as a variant asked. */
function appliedAs({ variant }: { variant: E2eMicVariant }): E2eAppliedMicSettings {
  return micProcessingOf({ variant });
}

/** A trial for one call, valid unless told otherwise. */
function trial({
  round,
  variant,
  texts = SCRIPT,
  sha = "sha-acme",
  verdict = PASSED,
  hold = WHOLE,
}: {
  round: 1 | 2 | 3;
  variant: E2eMicVariant;
  texts?: readonly string[];
  sha?: string;
  verdict?: E2eVerdict;
  hold?: E2eFidelityHold | null;
}): E2eTranscriptFidelityTrial {
  return transcriptFidelityTrial({
    evidence: {
      applied: [appliedAs({ variant })],
      callIds: [`call-${round}-${variant}`],
      record: record({ texts }),
      spec: { candidate: "noise-suppression-off", corpusVersion: "transcription-fidelity-v1", round, variant },
      wavSha256: sha,
      verdict,
      hold,
    },
  });
}

/** Six valid trials, each round's control and candidate heard with its own swaps. */
function sixTrials({
  candidateSwaps,
  controlSwaps,
}: {
  controlSwaps: readonly Readonly<Record<string, string>>[];
  candidateSwaps: readonly Readonly<Record<string, string>>[];
}): readonly E2eTranscriptFidelityTrial[] {
  return ([1, 2, 3] as const).flatMap((round) => [
    trial({ round, texts: heardWith({ swap: controlSwaps[round - 1]! }), variant: "control" }),
    trial({ round, texts: heardWith({ swap: candidateSwaps[round - 1]! }), variant: "noise-suppression-off" }),
  ]);
}

describe("micProcessingOf", () => {
  it("keeps echo cancellation on in every arm and turns off only what the arm names", () => {
    expect(E2E_MIC_VARIANTS.length).toBeGreaterThan(0);
    expect(E2E_MIC_VARIANTS.map((variant) => [variant, micProcessingOf({ variant })])).toEqual([
      ["control", { autoGainControl: true, echoCancellation: true, noiseSuppression: true }],
      ["noise-suppression-off", { autoGainControl: true, echoCancellation: true, noiseSuppression: false }],
      ["auto-gain-off", { autoGainControl: false, echoCancellation: true, noiseSuppression: true }],
      ["both-off", { autoGainControl: false, echoCancellation: true, noiseSuppression: false }],
    ]);
  });
});

describe("surfaceReportOf", () => {
  it("counts nothing when every line is heard as spoken, over the eight scored lines only", () => {
    const report = surfaceReportOf({ heard: SCRIPT });
    expect([report.criticalErrors, report.scoredLines, report.startErrors, report.endErrors]).toEqual([0, 8, 0, 0]);
  });

  it("charges a lost critical word to its line's stratum and gain, and its edge", () => {
    const report = surfaceReportOf({
      heard: heardWith({
        swap: {
          "end-quiet": "The final word in this automated test line is overnite.",
          "start-ordinary": "Elite is the first word in this synthetic sentence.",
        },
      }),
    });
    expect(report.criticalErrors).toBe(2);
    expect(report.byStratum).toEqual({ "end-critical": 1, glossary: 0, short: 0, "start-critical": 1 });
    expect(report.byGain).toEqual({ ordinary: 1, quiet: 1 });
    expect([report.startErrors, report.endErrors, report.substitutions]).toEqual([1, 1, 2]);
  });

  it("never scores the setup line, however wrong it arrives", () => {
    const report = surfaceReportOf({ heard: heardWith({ swap: { setup: "This is a test." } }) });
    expect(report.criticalErrors).toBe(0);
  });
});

describe("transcriptFidelityTrial", () => {
  it("is valid when one call heard the script under the settings it asked for", () => {
    const one = trial({ round: 1, variant: "auto-gain-off" });
    expect([one.valid, one.invalidReasons, one.callId, one.final!.criticalErrors]).toEqual([
      true,
      [],
      "call-1-auto-gain-off",
      0,
    ]);
  });

  it("names every instrument failure: two call ids, an omitted and a wrong setting, a torn and unended file", () => {
    const one = transcriptFidelityTrial({
      evidence: {
        applied: [{ autoGainControl: null, echoCancellation: true, noiseSuppression: true }],
        callIds: ["call-a", "call-b"],
        record: record({ ended: false, skipped: 1, texts: SCRIPT }),
        spec: {
          candidate: "noise-suppression-off",
          corpusVersion: "transcription-fidelity-v1",
          round: 2,
          variant: "noise-suppression-off",
        },
        wavSha256: "sha-acme",
        verdict: { passed: true },
        hold: WHOLE,
      },
    });
    expect(one.valid).toBe(false);
    expect(one.callId).toBe(null);
    expect(one.invalidReasons).toEqual([
      "expected exactly one transcript call id, saw 2",
      "noiseSuppression applied true, asked false",
      "Chromium omitted autoGainControl, so the arm is unproven",
      "call file has 1 unreadable line(s)",
      "call never recorded its end",
    ]);
  });

  it("is invalid when nothing was heard, the file was unreadable, or the script was heard twice over", () => {
    const silent = trial({ round: 1, texts: [], variant: "control" });
    const twice = trial({ round: 1, texts: [...SCRIPT, ...SCRIPT], variant: "control" });
    const unread = transcriptFidelityTrial({
      evidence: {
        applied: [appliedAs({ variant: "control" })],
        callIds: ["call-a"],
        record: "ENOENT",
        spec: { candidate: "both-off", corpusVersion: "transcription-fidelity-v1", round: 1, variant: "control" },
        wavSha256: "sha-acme",
        verdict: { passed: true },
        hold: WHOLE,
      },
    });
    expect(silent.invalidReasons).toContain(
      "no final transcript of the microphone at all — the call never heard the script",
    );
    expect(twice.invalidReasons).toEqual([
      "72 words heard beyond a 72-word script — the microphone repeated or something else spoke",
    ]);
    expect([unread.invalidReasons, unread.final]).toEqual([["call file unreadable: ENOENT"], null]);
  });

  it("scores one stray word as an insertion inside a valid trial, short of a whole repeat", () => {
    const stray = trial({ round: 1, texts: ["extra", ...SCRIPT], variant: "control" });
    expect([stray.valid, stray.invalidReasons]).toEqual([true, []]);
  });

  it("never scores a call that dropped partway, however clean its file reads", () => {
    const partial = LINES.slice(0, 3).map((line) => line.text);
    const one = trial({
      round: 1,
      texts: partial,
      variant: "control",
      verdict: failed({ detail: "the call dropped 100s after the microphone opened", kind: "call-dropped" }),
    });
    expect([one.valid, one.invalidReasons]).toEqual([
      false,
      ["the call itself failed (call-dropped): the call dropped 100s after the microphone opened"],
    ]);
  });

  it("never scores a call held short of the script, nor one whose hold went unmeasured", () => {
    const partial = LINES.slice(0, 3).map((line) => line.text);
    const short = trial({ hold: { heldMs: 40_500, neededMs: 205_090 }, round: 1, texts: partial, variant: "control" });
    const unmeasured = trial({ hold: null, round: 1, variant: "control" });
    const unreadClock = trial({ hold: { heldMs: null, neededMs: 205_090 }, round: 1, variant: "control" });
    expect([short.valid, short.invalidReasons]).toEqual([
      false,
      ["the call was held 40s of the 206s the script and its settle need, so its later lines may never have played"],
    ]);
    expect(unmeasured.invalidReasons).toEqual([
      "the hold was not measured exactly once, so the whole script is unproven",
    ]);
    expect(unreadClock.invalidReasons).toEqual(["the page's clock could not be read, so the whole script is unproven"]);
    const endless = trial({ hold: { heldMs: Infinity, neededMs: 205_090 }, round: 1, variant: "control" });
    const unnumbered = trial({ hold: { heldMs: NaN, neededMs: 205_090 }, round: 1, variant: "control" });
    expect([endless.invalidReasons, unnumbered.invalidReasons]).toEqual([
      ["the page's clock could not be read, so the whole script is unproven"],
      ["the page's clock could not be read, so the whole script is unproven"],
    ]);
  });

  it("accepts a hold that exactly covers the script and its settle", () => {
    const exact = trial({ hold: { heldMs: 205_090, neededMs: 205_090 }, round: 1, variant: "control" });
    expect([exact.valid, exact.invalidReasons]).toEqual([true, []]);
  });

  it("voids a call whose last lines sat in a turn the server never ended, rather than scoring them lost", () => {
    const heardFinal = LINES.slice(0, 7).map((line) => line.text);
    const one = transcriptFidelityTrial({
      evidence: {
        applied: [appliedAs({ variant: "noise-suppression-off" })],
        callIds: ["call-acme-r1"],
        hold: WHOLE,
        record: record({
          openTail: ["This synthetic glossary line says sloth with a Q. This synthetic glossary line says codex clux"],
          texts: heardFinal,
        }),
        spec: {
          candidate: "noise-suppression-off",
          corpusVersion: "transcription-fidelity-v1",
          round: 1,
          variant: "noise-suppression-off",
        },
        verdict: PASSED,
        wavSha256: "sha-acme",
      },
    });
    expect([one.valid, one.invalidReasons]).toEqual([
      false,
      ["1 of the owner's turn(s) never finalised before the call ended — turn-taking, not hearing"],
    ]);
  });

  it("voids a call the record says dropped, even when the page's hang-up control still clicked", () => {
    const one = transcriptFidelityTrial({
      evidence: {
        applied: [appliedAs({ variant: "control" })],
        callIds: ["call-acme-r1"],
        hold: WHOLE,
        record: record({ endedWhy: "the connection closed — ice", texts: LINES.map((line) => line.text) }),
        spec: {
          candidate: "noise-suppression-off",
          corpusVersion: "transcription-fidelity-v1",
          round: 1,
          variant: "control",
        },
        verdict: PASSED,
        wavSha256: "sha-acme",
      },
    });
    expect([one.valid, one.invalidReasons]).toEqual([
      false,
      ['the call ended on "the connection closed — ice", not on the test\'s hang-up'],
    ]);
  });

  it("counts a mis-hearing as an error, never as invalidity", () => {
    const one = trial({ round: 1, texts: heardWith({ swap: { "short-quiet": "" } }), variant: "control" });
    expect([one.valid, one.final!.criticalErrors]).toEqual([true, 1]);
  });
});

describe("compareTranscriptFidelity", () => {
  const CARD_LOST = { "short-quiet": "Say cart." };
  const TWO_LOST = { "short-quiet": "Say cart.", "start-quiet": "Sleep is the first word in this synthetic sentence." };

  it("stops when control misheard a critical word in fewer than two calls", () => {
    const result = compareTranscriptFidelity({
      trials: sixTrials({ candidateSwaps: [{}, {}, {}], controlSwaps: [CARD_LOST, {}, {}] }),
    });
    expect(result.decision).toBe("stop-control-near-perfect");
    expect(result.control!.criticalErrors).toBe(1);
  });

  it("calls the candidate improved when it is lower overall, better in two of three rounds and worse nowhere", () => {
    const result = compareTranscriptFidelity({
      trials: sixTrials({ candidateSwaps: [{}, {}, CARD_LOST], controlSwaps: [CARD_LOST, CARD_LOST, CARD_LOST] }),
    });
    expect([result.decision, result.control!.criticalErrors, result.candidate!.criticalErrors]).toEqual([
      "candidate-improved",
      3,
      1,
    ]);
  });

  it("calls it regressed when any stratum is worse, even with fewer errors overall", () => {
    const glossaryLost = { "glossary-quiet": "This synthetic glossary line says Codecs cmux handover." };
    const result = compareTranscriptFidelity({
      trials: sixTrials({ candidateSwaps: [{}, {}, glossaryLost], controlSwaps: [TWO_LOST, CARD_LOST, CARD_LOST] }),
    });
    expect(result.decision).toBe("candidate-regressed");
    expect(result.why).toBe("candidate worse on glossary critical errors 1 > 0");
  });

  // A quiet line newly lost, hidden under fewer errors overall and an unchanged stratum count.
  it("calls it regressed when the quiet gain is worse, even with fewer errors overall and no stratum worse", () => {
    const ordinaryLost = { "short-ordinary": "Yellow." };
    const result = compareTranscriptFidelity({
      trials: sixTrials({
        candidateSwaps: [{}, {}, CARD_LOST],
        controlSwaps: [ordinaryLost, ordinaryLost, ordinaryLost],
      }),
    });
    expect([result.decision, result.why]).toEqual([
      "candidate-regressed",
      "candidate worse on quiet-gain critical errors 1 > 0",
    ]);
  });

  it("is inconclusive when the candidate is lower overall but better in only one round", () => {
    const result = compareTranscriptFidelity({
      trials: sixTrials({ candidateSwaps: [{}, CARD_LOST, CARD_LOST], controlSwaps: [TWO_LOST, CARD_LOST, CARD_LOST] }),
    });
    expect([result.decision, result.pairs.map((pair) => [pair.controlCritical, pair.candidateCritical])]).toEqual([
      "inconclusive",
      [
        [2, 0],
        [1, 1],
        [1, 1],
      ],
    ]);
  });

  it("is invalid when one call is invalid, voiding its round and leaving two pairs", () => {
    const trials = sixTrials({ candidateSwaps: [{}, {}, {}], controlSwaps: [CARD_LOST, CARD_LOST, CARD_LOST] });
    const broken = [...trials.slice(0, 5), trial({ round: 3, texts: [], variant: "noise-suppression-off" })];
    const result = compareTranscriptFidelity({ trials: broken });
    expect([result.decision, result.why, result.pairs.map((pair) => pair.valid)]).toEqual([
      "invalid",
      "2 of 3 pairs valid; three are the fewest that show a direction repeat",
      [true, true, false],
    ]);
  });

  it("is invalid when two calls played different microphones", () => {
    const trials = sixTrials({ candidateSwaps: [{}, {}, {}], controlSwaps: [CARD_LOST, CARD_LOST, CARD_LOST] });
    const result = compareTranscriptFidelity({
      trials: [...trials.slice(0, 5), trial({ round: 3, sha: "sha-other", variant: "noise-suppression-off" })],
    });
    expect([result.decision, result.why]).toEqual([
      "invalid",
      "the calls played 2 different microphones, so no pair compares like with like",
    ]);
  });
});

describe("transcriptFidelityReport", () => {
  it("carries the candidate, the corpus version and every limitation", () => {
    const report = transcriptFidelityReport({
      candidate: "noise-suppression-off",
      trials: sixTrials({ candidateSwaps: [{}, {}, {}], controlSwaps: [{}, {}, {}] }),
    });
    expect(FIDELITY_LIMITATIONS.length).toBeGreaterThan(0);
    expect([report.schemaVersion, report.corpusVersion, report.candidate, report.limitations]).toEqual([
      1,
      "transcription-fidelity-v1",
      "noise-suppression-off",
      FIDELITY_LIMITATIONS,
    ]);
    expect(report.comparison.decision).toBe("stop-control-near-perfect");
  });
});
