/*
 * A spoken relay's two narrowed modes refuse what the voice supplied beside them: words-alone takes neither a reading
 * nor a read, and heard-only takes only reads the voice has, never a reading, and always the owner's words.
 */
import { describe, expect, it } from "vitest";

import { readsAfterRefusal, wordsAloneRefusal } from "../../../talk/relayModeRefusals.js";

const SOURCES = ["queue_read", "card_read"];

describe("wordsAloneRefusal", () => {
  it("passes a relay that is not words-alone, and words-alone carrying only the owner's words", () => {
    expect([
      wordsAloneRefusal({ heard: "", readsAfter: ["queue_read"], wordsAlone: false, words: "say" }),
      wordsAloneRefusal({ heard: "fix the tab", readsAfter: [], wordsAlone: true, words: "" }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses a reading or a read beside it, and refuses it with none of the owner's words", () => {
    expect([
      wordsAloneRefusal({ heard: "fix the tab", readsAfter: [], wordsAlone: true, words: "say" }),
      wordsAloneRefusal({ heard: "fix the tab", readsAfter: ["queue_read"], wordsAlone: true, words: "" }),
      wordsAloneRefusal({ heard: "", readsAfter: [], wordsAlone: true, words: "" }),
    ]).toEqual([
      "--words-alone carries the owner's words only: it takes neither --say nor --read-after",
      "--words-alone carries the owner's words only: it takes neither --say nor --read-after",
      "--words-alone needs the owner's words: a relay of the owner's words alone with none carries nothing of theirs",
    ]);
  });
});

describe("readsAfterRefusal", () => {
  it("passes a full relay, and a heard-only one naming known reads with the owner's words", () => {
    expect([
      readsAfterRefusal({ heard: "", readsAfter: [], sources: SOURCES, words: "say" }),
      readsAfterRefusal({ heard: "fix the tab", readsAfter: ["card_read"], sources: SOURCES, words: "" }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses an unknown read, a reading beside the reads, and reads with none of the owner's words", () => {
    expect([
      readsAfterRefusal({ heard: "fix the tab", readsAfter: ["web_read"], sources: SOURCES, words: "" }),
      readsAfterRefusal({ heard: "fix the tab", readsAfter: ["card_read"], sources: SOURCES, words: "say" }),
      readsAfterRefusal({ heard: "", readsAfter: ["card_read"], sources: SOURCES, words: "" }),
    ]).toEqual([
      "--read-after names web_read, which is not one of the voice's reads (queue_read, card_read)",
      "--say cannot travel with --read-after: after a read the voice's reading is dropped and only the owner's words go",
      "--read-after needs the owner's words: a heard-only relay with none carries nothing of theirs",
    ]);
  });
});
