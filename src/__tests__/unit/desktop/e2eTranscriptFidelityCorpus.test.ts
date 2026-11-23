import { describe, expect, it } from "vitest";
import { fidelityWords } from "../../../desktop/e2eTranscriptFidelity.js";
import {
  E2E_MIC_CANDIDATES,
  FIDELITY_CALL_CAP_MS,
  FIDELITY_LEAD_MS,
  GAIN_FACTOR,
  parseMicCandidate,
  parseMicVariant,
  TRANSCRIPT_FIDELITY_CORPUS,
  transcriptFidelitySchedule,
} from "../../../desktop/e2eTranscriptFidelityCorpus.js";

const UTTERANCES = TRANSCRIPT_FIDELITY_CORPUS.utterances;

describe("TRANSCRIPT_FIDELITY_CORPUS", () => {
  it("opens on one unscored setup line, then eight scored lines", () => {
    expect(UTTERANCES.length).toBeGreaterThan(0);
    expect(UTTERANCES.map((one) => [one.id, one.scored])).toEqual([
      ["setup", false],
      ["short-ordinary", true],
      ["short-quiet", true],
      ["start-ordinary", true],
      ["start-quiet", true],
      ["end-ordinary", true],
      ["end-quiet", true],
      ["glossary-ordinary", true],
      ["glossary-quiet", true],
    ]);
  });

  it("speaks every scored stratum once ordinary and once quiet", () => {
    const pairs = UTTERANCES.filter((one) => one.scored).map((one) => `${one.stratum}/${one.gain}`);
    expect(pairs).toEqual([
      "short/ordinary",
      "short/quiet",
      "start-critical/ordinary",
      "start-critical/quiet",
      "end-critical/ordinary",
      "end-critical/quiet",
      "glossary/ordinary",
      "glossary/quiet",
    ]);
  });

  it("declares only critical words the line itself says, as the scorer renders them", () => {
    expect(UTTERANCES.length).toBeGreaterThan(0);
    const stray = UTTERANCES.flatMap((one) =>
      one.critical
        .filter((word) => !fidelityWords({ text: one.text }).includes(word))
        .map((word) => `${one.id}:${word}`),
    );
    expect(stray).toEqual([]);
  });

  it("puts a start-critical line's word first and an end-critical line's word last", () => {
    const edge = UTTERANCES.filter((one) => one.stratum === "start-critical" || one.stratum === "end-critical").map(
      (one) => {
        const words = fidelityWords({ text: one.text });
        return one.stratum === "start-critical" ? words[0] : words[words.length - 1];
      },
    );
    expect(edge).toEqual(["delete", "keep", "urgent", "overnight"]);
  });

  it("leaves twenty seconds after each line and a long tail after the last", () => {
    expect(UTTERANCES.map((one) => one.silenceAfterMs)).toEqual([
      20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 260_000,
    ]);
  });

  it("outlasts the call's cap on silence alone, so the looping microphone never repeats the script in one call", () => {
    const silence = UTTERANCES.reduce((sum, one) => sum + one.silenceAfterMs, FIDELITY_LEAD_MS);
    expect(silence).toBe(435_000);
    expect(silence).toBeGreaterThan(FIDELITY_CALL_CAP_MS);
  });

  it("plays quiet lines at 0.35 of ordinary", () => {
    expect([GAIN_FACTOR.ordinary, GAIN_FACTOR.quiet]).toEqual([1, 0.35]);
  });
});

describe("transcriptFidelitySchedule", () => {
  it("runs three rounds, counterbalancing which member of each pair goes first", () => {
    const schedule = transcriptFidelitySchedule({ candidate: "noise-suppression-off" });
    expect(schedule.map((call) => [call.round, call.variant])).toEqual([
      [1, "control"],
      [1, "noise-suppression-off"],
      [2, "noise-suppression-off"],
      [2, "control"],
      [3, "control"],
      [3, "noise-suppression-off"],
    ]);
  });

  it("tags every call with the corpus version and the candidate it is compared against", () => {
    const schedule = transcriptFidelitySchedule({ candidate: "both-off" });
    expect(new Set(schedule.map((call) => `${call.corpusVersion}|${call.candidate}`))).toEqual(
      new Set(["transcription-fidelity-v1|both-off"]),
    );
  });
});

describe("parseMicVariant and parseMicCandidate", () => {
  it("read every candidate back as itself", () => {
    expect(E2E_MIC_CANDIDATES.length).toBeGreaterThan(0);
    expect(E2E_MIC_CANDIDATES.map((text) => parseMicCandidate({ text }))).toEqual([...E2E_MIC_CANDIDATES]);
  });

  it("never reads control as a candidate, though it is a variant", () => {
    expect([parseMicCandidate({ text: "control" }), parseMicVariant({ text: "control" })]).toEqual([
      undefined,
      "control",
    ]);
  });

  it("refuses an unknown or differently cased name", () => {
    expect([parseMicVariant({ text: "Control" }), parseMicCandidate({ text: "agc-off" })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
