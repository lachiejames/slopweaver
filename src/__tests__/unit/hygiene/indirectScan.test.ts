/**
 * The indirect scan's pure core: candidate-map places, the dictionary harvest and the fold into classes. Every word
 * is synthetic (`zorblatt`, `Quillmore`, `ABC-1`), and the dictionary is a small injected one, never the system's.
 */
import { describe, expect, it } from "vitest";

import { parseIndirectMap } from "../../../hygiene/indirectMap.js";
import {
  harvestPlaces,
  type IndirectPlace,
  isHarvestCandidate,
  readHarvestDictionary,
  scanCandidateMap,
  summariseIndirect,
} from "../../../hygiene/indirectScan.js";
import { unwrap } from "../../../lib/result.js";

const MAP = unwrap(
  parseIndirectMap({
    text:
      "class\tflags\tdisposition\tpattern\treplacement\n" +
      "issue-key\t-\tremove\t\\bABC-\\d+\\b\tXYZ-1\n" +
      "person\ti\treview\t\\bzorblatt\\b\ta synthetic person\n",
  }),
);

const DICTIONARY = readHarvestDictionary({
  propernames: ["Quillmore", ""],
  words: ["pool", "ruleset", "name", "Capitalised", " "],
});

describe("scanCandidateMap", () => {
  it("reports a path hit at line 0 and each text hit at its 1-based line, with its excerpt", () => {
    const places = scanCandidateMap({
      map: MAP,
      path: "docs/abc-7.md",
      text: "intro\nsee ABC-12 and ABC-3\nZorblatt\n",
    });
    expect(places.map((p) => [p.className, p.line, p.term, p.disposition])).toEqual([
      ["map:issue-key", 2, "ABC-12", "remove"],
      ["map:issue-key", 2, "ABC-3", "remove"],
      ["map:person", 3, "Zorblatt", "review"],
    ]);
    expect(places[0]!.excerpt).toBe("see ABC-12 and ABC-3");
    expect(places[0]!.replacement).toBe("XYZ-1");
  });

  it("matches the path itself when the row's flags allow it", () => {
    const places = scanCandidateMap({ map: MAP, path: "fixtures/zorblatt.json", text: "{}" });
    expect(places.map((p) => [p.line, p.excerpt])).toEqual([[0, "fixtures/zorblatt.json"]]);
  });

  it("caps an excerpt from a long line at 200 characters around the match", () => {
    const text = `${"x".repeat(500)} ABC-9 ${"y".repeat(500)}`;
    const [place] = scanCandidateMap({ map: MAP, path: "min.js", text });
    expect(place!.excerpt.length).toBe(200);
    expect(place!.excerpt).toContain("ABC-9");
  });
});

describe("readHarvestDictionary", () => {
  it("keeps only lowercase entries as common words and every non-empty proper name", () => {
    expect([...DICTIONARY.common].toSorted()).toEqual(["name", "pool", "ruleset"]);
    expect([...DICTIONARY.proper]).toEqual(["Quillmore"]);
  });
});

describe("isHarvestCandidate", () => {
  it.each([
    ["Quillmore", true],
    ["Zorblatt", true],
    ["Pool", false],
    ["Rulesets", false],
    ["Pooled", false],
    ["Pooling", false],
  ])("%s is a candidate: %s", (word, expected) => {
    expect(isHarvestCandidate({ dictionary: DICTIONARY, word })).toBe(expected);
  });
});

describe("harvestPlaces", () => {
  it("lists a standalone capitalised word the dictionary does not know, by kind, never one inside an identifier", () => {
    const text = "Quillmore met Zorblatt\nthe Pool, $Zorblatt, a.Zorblatt, ZorblattX and Zor_blatt\n";
    const places = harvestPlaces({ dictionary: DICTIONARY, path: "a.md", text });
    expect(places.map((p) => [p.className, p.line, p.term, p.disposition])).toEqual([
      ["harvest:proper-name", 1, "Quillmore", "review"],
      ["harvest:unknown-word", 1, "Zorblatt", "review"],
    ]);
  });
});

describe("summariseIndirect", () => {
  /** One place with the fields the fold reads. */
  const place = (over: Partial<IndirectPlace> & { path: string; term: string; className: string }): IndirectPlace => ({
    disposition: "review",
    excerpt: "",
    line: 1,
    replacement: "r",
    ...over,
  });

  it("orders remove, review, aggregate, then harvest, splitting one class by disposition", () => {
    const classes = summariseIndirect({
      harvestMaxFiles: 3,
      places: [
        place({ className: "harvest:unknown-word", path: "h.md", term: "Zorblatt" }),
        place({ className: "map:locale", disposition: "aggregate", path: "l.ts", term: "en-ZZ" }),
        place({ className: "map:issue-key", path: "r.ts", term: "ABC-2" }),
        place({ className: "map:issue-key", disposition: "remove", path: "r.ts", term: "ABC-1" }),
      ],
    });
    expect(classes.map((c) => [c.className, c.disposition])).toEqual([
      ["map:issue-key", "remove"],
      ["map:issue-key", "review"],
      ["map:locale", "aggregate"],
      ["harvest:unknown-word", "review"],
    ]);
  });

  it("drops a harvest term spanning more files than the cap, and never a map term", () => {
    const spread = ["a", "b", "c", "d"].map((path) =>
      place({ className: "harvest:unknown-word", path, term: "Zorblatt" }),
    );
    const mapped = ["a", "b", "c", "d"].map((path) => place({ className: "map:person", path, term: "zorblatt" }));
    const classes = summariseIndirect({ harvestMaxFiles: 3, places: [...spread, ...mapped] });
    expect(classes.map((c) => [c.className, c.hits, c.files])).toEqual([["map:person", 4, 4]]);
  });

  it("does not harvest a word a map row already matched at the same place", () => {
    const classes = summariseIndirect({
      harvestMaxFiles: 3,
      places: [
        place({ className: "map:person", line: 4, path: "a.md", term: "Zorblatt" }),
        place({ className: "harvest:unknown-word", line: 4, path: "a.md", term: "Zorblatt" }),
        place({ className: "harvest:unknown-word", line: 5, path: "a.md", term: "Zorblatt" }),
      ],
    });
    expect(classes.map((c) => [c.className, c.hits])).toEqual([
      ["map:person", 1],
      ["harvest:unknown-word", 1],
    ]);
  });

  it("counts a harvest term's span before a map row claims one of its places, so it stays over the cap", () => {
    const spread = ["a", "b", "c", "d"].map((path) =>
      place({ className: "harvest:unknown-word", path, term: "Zorblatt" }),
    );
    const classes = summariseIndirect({
      harvestMaxFiles: 3,
      places: [...spread, place({ className: "map:person", path: "a", term: "Zorblatt" })],
    });
    expect(classes.map((c) => [c.className, c.hits])).toEqual([["map:person", 1]]);
  });

  it("sorts terms by descending hits, then by term", () => {
    const [entry] = summariseIndirect({
      harvestMaxFiles: 3,
      places: [
        place({ className: "map:issue-key", path: "a", term: "ABC-2" }),
        place({ className: "map:issue-key", path: "b", term: "ABC-1" }),
        place({ className: "map:issue-key", path: "c", term: "ABC-3" }),
        place({ className: "map:issue-key", path: "d", term: "ABC-3" }),
      ],
    });
    expect(entry!.terms.map((t) => [t.term, t.hits, t.files])).toEqual([
      ["ABC-3", 2, 2],
      ["ABC-1", 1, 1],
      ["ABC-2", 1, 1],
    ]);
  });

  it("reports nothing for no places", () => {
    expect(summariseIndirect({ harvestMaxFiles: 3, places: [] })).toEqual([]);
  });
});
