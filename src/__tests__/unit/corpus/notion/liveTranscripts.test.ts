/**
 * The pure halves of meeting-transcript recovery: finding Notion's omission sentence, reading the transcript
 * child's id off a `transcription` block, and splicing the recovered text back in. Every fixture is synthetic.
 */
import { describe, expect, it } from "vitest";

import {
  omittedTranscripts,
  spliceTranscripts,
  transcriptBlockIdOf,
} from "../../../../corpus/notion/liveTranscripts.js";
import type { NotionMdNode } from "../../../../corpus/notion/markdownNodes.js";

const NOTE_ID = "a0000075000040008000000000000081";
const SENTENCE = `Transcript omitted. Use the view tool with the meeting note url (https://app.notion.com/p/aaaaaaaabbbbccccddddeeeeeeeeeeee#${NOTE_ID}) to view this transcript.`;

describe("omittedTranscripts", () => {
  it("finds the omission sentence and canonicalises the meeting note id", () => {
    expect(omittedTranscripts({ text: `\t\t### Action Items\n\t\t${SENTENCE}\n` })).toEqual([
      { sentences: [SENTENCE], transcriptionId: "a0000075-0000-4000-8000-000000000081" },
    ]);
  });

  it("names a meeting note once however its url is spelled, keeping every spelling", () => {
    const dashed = SENTENCE.replace(`#${NOTE_ID}`, "#a0000075-0000-4000-8000-000000000081");
    expect(omittedTranscripts({ text: `${SENTENCE}\n${SENTENCE}\n${dashed}` })).toEqual([
      { sentences: [SENTENCE, dashed], transcriptionId: "a0000075-0000-4000-8000-000000000081" },
    ]);
  });

  it("finds nothing in a body with no meeting note", () => {
    expect(omittedTranscripts({ text: "Transcript omitted from the minutes on purpose." })).toEqual([]);
  });
});

describe("transcriptBlockIdOf", () => {
  it("reads the transcript child's id off a transcription block", () => {
    const block = {
      transcription: { children: { notes_block_id: "n", summary_block_id: "s", transcript_block_id: "t-1" } },
      type: "transcription",
    };
    expect(transcriptBlockIdOf({ block })).toBe("t-1");
  });

  it("answers undefined for a meeting note still processing, with no transcript child", () => {
    const block = { transcription: { children: { summary_block_id: "s" } }, type: "transcription" };
    expect(transcriptBlockIdOf({ block })).toBe(undefined);
  });

  it("answers undefined for any other block type", () => {
    expect(transcriptBlockIdOf({ block: { paragraph: {}, type: "paragraph" } })).toBe(undefined);
  });
});

describe("spliceTranscripts", () => {
  it("replaces the sentence in the text and in a nested text node of the tree", () => {
    const tree: readonly NotionMdNode[] = [
      { kind: "text", text: "Summary" },
      { children: [{ kind: "text", text: `\t${SENTENCE}` }], kind: "toggle", label: undefined },
    ];
    const spliced = spliceTranscripts({
      recovered: [{ sentence: SENTENCE, transcript: "Morning all." }],
      text: `Summary\n\t${SENTENCE}`,
      tree,
    });
    expect(spliced.text).toBe("Summary\n\tTranscript:\n\nMorning all.");
    expect(spliced.tree).toEqual([
      { kind: "text", text: "Summary" },
      { children: [{ kind: "text", text: "\tTranscript:\n\nMorning all." }], kind: "toggle", label: undefined },
    ]);
  });

  it("keeps replacement-pattern characters in the transcript literally", () => {
    const spliced = spliceTranscripts({
      recovered: [{ sentence: SENTENCE, transcript: "it cost $& and $1" }],
      text: SENTENCE,
      tree: [],
    });
    expect(spliced.text).toBe("Transcript:\n\nit cost $& and $1");
  });

  it("never rewrites a sentence quoted inside a transcript it has just inserted", () => {
    const other = SENTENCE.replace(NOTE_ID, "99999999888877776666555555555555");
    const spliced = spliceTranscripts({
      recovered: [
        { sentence: SENTENCE, transcript: `Someone read out: ${other}` },
        { sentence: other, transcript: "Second meeting." },
      ],
      text: `${SENTENCE}\n${other}`,
      tree: [],
    });
    expect(spliced.text).toBe(`Transcript:\n\nSomeone read out: ${other}\nTranscript:\n\nSecond meeting.`);
  });

  it("leaves the body untouched when nothing was recovered", () => {
    const spliced = spliceTranscripts({ recovered: [], text: SENTENCE, tree: [{ kind: "text", text: SENTENCE }] });
    expect(spliced.text).toBe(SENTENCE);
  });
});
