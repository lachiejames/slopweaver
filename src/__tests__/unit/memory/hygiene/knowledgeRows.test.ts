/**
 * The knowledge rows the referent arm reads: each claim's CURRENT belief, as recall would return it, rendered as
 * one document per claim. Pure — every recording here is an invented plain object.
 */
import { describe, expect, it } from "vitest";

import {
  currentKnowledgeBeliefs,
  type KnowledgeRecording,
  knowledgeDocuments,
} from "../../../../memory/hygiene/knowledgeRows.js";

/** One invented recording; only what a case varies is passed. */
function recording({
  id,
  seq,
  atIso = "2099-01-01T00:00:00.000Z",
  kind = "lesson",
  supersedes = null,
  claim = `claim of ${id}`,
}: {
  id: string;
  seq: number;
  atIso?: string;
  kind?: KnowledgeRecording["kind"];
  supersedes?: string | null;
  claim?: string;
}): KnowledgeRecording {
  return {
    behaviourChange: null,
    caveat: null,
    claim,
    evidence: `evidence of ${id}`,
    id,
    kind,
    recordedAt: new Date(atIso),
    repro: null,
    retrievalCue: null,
    seq,
    supersedes,
  };
}

describe("currentKnowledgeBeliefs", () => {
  it("reads nothing out of an empty table", () => {
    expect(currentKnowledgeBeliefs({ recordings: [] })).toEqual([]);
  });

  it("keeps the LATEST recording of a claim, by instant and then by write sequence", () => {
    const beliefs = currentKnowledgeBeliefs({
      recordings: [
        recording({ atIso: "2099-01-03T00:00:00.000Z", claim: "newest", id: "a", seq: 1 }),
        recording({ atIso: "2099-01-01T00:00:00.000Z", claim: "oldest", id: "a", seq: 9 }),
        recording({ claim: "first write", id: "b", seq: 2 }),
        recording({ claim: "second write", id: "b", seq: 3 }),
      ],
    });
    expect(beliefs.map((belief) => [belief.id, belief.claim])).toEqual([
      ["a", "newest"],
      ["b", "second write"],
    ]);
  });

  it("drops a claim a LATER recording supersedes, and keeps one only an EARLIER recording names", () => {
    const beliefs = currentKnowledgeBeliefs({
      recordings: [
        recording({ atIso: "2099-01-01T00:00:00.000Z", id: "retired", seq: 1 }),
        recording({ atIso: "2099-01-02T00:00:00.000Z", id: "successor", seq: 2, supersedes: "retired" }),
        recording({ atIso: "2099-01-01T00:00:00.000Z", id: "early-namer", seq: 3, supersedes: "re-recorded" }),
        recording({ atIso: "2099-01-05T00:00:00.000Z", id: "re-recorded", seq: 4 }),
      ],
    });
    expect(beliefs.map((belief) => belief.id)).toEqual(["early-namer", "re-recorded", "successor"]);
  });

  it("never reads a trace, which is a dated observation rather than a claim acted on now", () => {
    const beliefs = currentKnowledgeBeliefs({
      recordings: [
        recording({ id: "looked-here", kind: "trace", seq: 1 }),
        recording({ id: "a-way-of-working", kind: "preference", seq: 2 }),
      ],
    });
    expect(beliefs.map((belief) => [belief.id, belief.kind])).toEqual([["a-way-of-working", "preference"]]);
  });
});

describe("knowledgeDocuments", () => {
  const roots = new Set(["src", "skills"]);

  it("names each document for its claim, reading spans, prose paths and the repro's verbs across every field", () => {
    const documents = knowledgeDocuments({
      beliefs: [
        {
          ...recording({ claim: "It lived in src/pelican/burst.ts until the move.", id: "full", seq: 1 }),
          behaviourChange: "Use /slopweaver:quokka-audit instead.",
          caveat: "The span `--gone-flag` says so too.",
          repro: "slopweaver pelican migrate --dry | slopweaver quokka list",
          retrievalCue: "skills/pelican-sweep",
        },
        recording({ claim: "only a claim", id: "sparse", seq: 2 }),
      ],
      roots,
    });
    expect(documents).toEqual([
      {
        file: "knowledge:full",
        referents: [
          { kind: "flag", line: 3, text: "--gone-flag" },
          { kind: "path", line: 1, text: "src/pelican/burst.ts" },
          { kind: "skill", line: 5, text: "skills/quokka-audit" },
          { kind: "skill", line: 6, text: "skills/pelican-sweep" },
          { kind: "verb", line: 4, text: "pelican migrate" },
          { kind: "verb", line: 4, text: "quokka list" },
        ],
      },
      { file: "knowledge:sparse", referents: [] },
    ]);
  });

  it("counts the repro's line past every field above it that is present, never a blank one", () => {
    const [document] = knowledgeDocuments({
      beliefs: [{ ...recording({ claim: "one\ntwo", id: "multi", seq: 1 }), repro: "slopweaver pelican migrate" }],
      roots,
    });
    expect(document!.referents).toEqual([{ kind: "verb", line: 4, text: "pelican migrate" }]);
  });

  it("drops a path that is shorthand for a longer one the same row names, and keeps an unrelated one", () => {
    const [document] = knowledgeDocuments({
      beliefs: [
        recording({
          claim: "Copy to packages/backend/src/test/mocks.ts, then run src/test/mocks.ts and src/test/other.ts.",
          id: "shorthand",
          seq: 1,
        }),
      ],
      roots: new Set(["packages", "src"]),
    });
    expect(document!.referents.map((referent) => referent.text)).toEqual([
      "packages/backend/src/test/mocks.ts",
      "src/test/other.ts",
    ]);
  });

  it("drops a path through an installed package, in prose or a span, and keeps the checkout's own beside it", () => {
    const [document] = knowledgeDocuments({
      beliefs: [
        recording({
          claim:
            "It throws in site/node_modules/pelican/dist/start.js and `src/node_modules/quokka.js`, called from site/app.ts.",
          id: "dependency",
          seq: 1,
        }),
      ],
      roots: new Set(["site", "src"]),
    });
    expect(document!.referents.map((referent) => referent.text)).toEqual(["site/app.ts"]);
  });

  it("reads no verb out of prose, where a sentence naming the binary is not a command", () => {
    const [document] = knowledgeDocuments({
      beliefs: [
        recording({ claim: "slopweaver memory is fine, run as slopweaver pelican migrate", id: "prose", seq: 1 }),
      ],
      roots,
    });
    expect(document!.referents).toEqual([]);
  });
});
