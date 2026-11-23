import { describe, expect, it } from "vitest";
import {
  fidelityWords,
  type ScriptedUtterance,
  scoreTranscriptFidelity,
} from "../../../desktop/e2eTranscriptFidelity.js";

const SCRIPT: readonly ScriptedUtterance[] = [
  { critical: ["next", "card"], id: "next", words: "Next card." },
  { critical: ["close", "older", "today"], id: "close", words: "Close the older draft and merge the newer one today." },
  { critical: ["acme", "cmux"], id: "names", words: "Ask Acme about cmux." },
];

const FAITHFUL = [
  "Next card.",
  "Close the older draft and merge the newer one today.",
  "Ask Acme about cmux.",
] as const;

/** The faithful transcript with one line replaced. */
function heardWith({ index, text }: { index: number; text: string }): readonly string[] {
  return FAITHFUL.map((line, at) => (at === index ? text : line));
}

describe("fidelityWords", () => {
  it("drops sound tags, fillers, case and punctuation, keeping apostrophes inside a word", () => {
    expect(fidelityWords({ text: " Um, [lip smack ]It's the NEXT card — uh, right?" })).toEqual([
      "it's",
      "the",
      "next",
      "card",
      "right",
    ]);
  });

  it("reads a line of nothing but a sound tag as no words", () => {
    expect(fidelityWords({ text: " [chuckle] " })).toEqual([]);
  });
});

describe("scoreTranscriptFidelity", () => {
  it("scores a faithful transcript as nothing misheard, across a split and a merge of segments", () => {
    const scored = scoreTranscriptFidelity({
      heard: ["Um, next card. Close the older draft", "and merge the newer one today. Ask Acme about cmux"],
      script: SCRIPT,
    });
    expect([scored.misheard, scored.total, scored.wer]).toEqual([0, 3, 0]);
  });

  it("counts a short turn's mis-heard first word as a critical loss at its start and its end", () => {
    const next = scoreTranscriptFidelity({ heard: heardWith({ index: 0, text: "Text card." }), script: SCRIPT })
      .utterances[0]!;
    expect(next.criticalLost).toEqual(["next"]);
    expect([next.substitutions, next.deletions, next.insertions]).toEqual([1, 0, 0]);
    expect([next.startWrong, next.endWrong]).toEqual([true, true]);
  });

  it("counts a clipped last word of a long turn as a deletion at its end only", () => {
    const scored = scoreTranscriptFidelity({
      heard: heardWith({ index: 1, text: "Close the older draft and merge the newer one" }),
      script: SCRIPT,
    });
    const close = scored.utterances[1]!;
    expect(close.criticalLost).toEqual(["today"]);
    expect([close.substitutions, close.deletions, close.insertions]).toEqual([0, 1, 0]);
    expect([close.startWrong, close.endWrong]).toEqual([false, true]);
    expect(scored.misheard).toBe(1);
  });

  it("never counts a lost word that carries no meaning toward the rate, though WER sees it", () => {
    const scored = scoreTranscriptFidelity({
      heard: heardWith({ index: 1, text: "Close older draft and merge the newer one today." }),
      script: SCRIPT,
    });
    expect(scored.utterances[1]!.criticalLost).toEqual([]);
    expect(scored.misheard).toBe(0);
    // 2 + 10 + 4 scripted words, one dropped.
    expect(scored.wer).toBe(1 / 16);
  });

  it("never normalises a known mis-hearing of a name into the name", () => {
    const names = scoreTranscriptFidelity({
      heard: heardWith({ index: 2, text: "Ask Acme about Cmarks." }),
      script: SCRIPT,
    }).utterances[2]!;
    expect(names.criticalLost).toEqual(["cmux"]);
    expect(names.heard).toEqual(["ask", "acme", "about", "cmarks"]);
  });

  it("marks an utterance the transcript never carried as missing", () => {
    const scored = scoreTranscriptFidelity({ heard: FAITHFUL.slice(1), script: SCRIPT });
    const next = scored.utterances[0]!;
    expect(next.missing).toBe(true);
    expect(next.criticalLost).toEqual(["next", "card"]);
    expect(scored.wer).toBe(2 / 16);
  });

  it("charges words heard before the first scripted word to the first utterance's start", () => {
    const next = scoreTranscriptFidelity({ heard: heardWith({ index: 0, text: "Okay so next card." }), script: SCRIPT })
      .utterances[0]!;
    expect([next.insertions, next.startWrong, next.criticalLost.length]).toEqual([2, true, 0]);
  });

  it("scores an empty script as a zero rate", () => {
    const scored = scoreTranscriptFidelity({ heard: ["hello"], script: [] });
    expect([scored.total, scored.misheard, scored.wer]).toEqual([0, 0, 0]);
  });
});
