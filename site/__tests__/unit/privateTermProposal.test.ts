/*
 * The pure halves of the private-word card: which proposal ids a card names, the only query the route reads, the
 * strict check the card runs over the route's answer, and the two act rows a Yes or No presses. Every word here is
 * synthetic.
 */
import { describe, expect, it } from "vitest";

import { actVerbFor, buildActArgv } from "../../lib/actVerbs";
import { PRIVATE_TERM_ANSWER_SLUGS } from "../../lib/actVerbsPrivateTerms";
import { privateTermProposalsAnswerOf } from "../../lib/privateTermProposal";
import {
  PRIVATE_TERM_PROPOSAL_MAX_IDS,
  privateTermProposalIdsIn,
  privateTermProposalQuery,
  privateTermProposalRequest,
} from "../../lib/privateTermProposalIds";

const SHOWN = {
  action: "add",
  allowedWhere: null,
  answer: null,
  caseInsensitive: true,
  className: "person",
  kind: "shown",
  meaning: "a colleague at acme",
  pattern: "quillfeather",
  proposalId: "pp-00000000000a",
  termId: "pt-00000000000a",
} as const;

describe("privateTermProposalIdsIn", () => {
  it("reads whole ids, first seen first, each once, skipping an absent field", () => {
    const texts = [
      "confirm pp-00000000000b and pp-00000000000a",
      undefined,
      "again pp-00000000000a; not xpp-00000000000c, pp-00000000000dz or pp-0000000000",
    ];
    expect(privateTermProposalIdsIn({ texts })).toStrictEqual(["pp-00000000000b", "pp-00000000000a"]);
  });

  it("stops at the most one card asks for", () => {
    const ids = Array.from(
      { length: PRIVATE_TERM_PROPOSAL_MAX_IDS + 2 },
      (_, index) => `pp-${index.toString(16).padStart(12, "0")}`,
    );
    expect(privateTermProposalIdsIn({ texts: [ids.join(" ")] })).toStrictEqual(
      ids.slice(0, PRIVATE_TERM_PROPOSAL_MAX_IDS),
    );
  });
});

describe("privateTermProposalRequest", () => {
  it("reads back exactly the query the card sends", () => {
    const query = privateTermProposalQuery({ ids: ["pp-00000000000b", "pp-00000000000a"] });
    expect(privateTermProposalRequest({ params: new URLSearchParams(query) })).toStrictEqual([
      "pp-00000000000b",
      "pp-00000000000a",
    ]);
  });

  it("refuses no id, a repeat, a malformed id, another parameter, and too many", () => {
    const tooMany = Array.from(
      { length: PRIVATE_TERM_PROPOSAL_MAX_IDS + 1 },
      (_, index) => `pp-${index.toString(16).padStart(12, "0")}`,
    );
    const refused = [
      "",
      "id=pp-00000000000a&id=pp-00000000000a",
      "id=pp-0000000000",
      "id=../pp-00000000000a",
      "id=pp-00000000000a&home=/tmp",
      privateTermProposalQuery({ ids: tooMany }),
    ].map((query) => privateTermProposalRequest({ params: new URLSearchParams(query) }));
    expect(refused).toStrictEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("privateTermProposalsAnswerOf", () => {
  it("takes an answer naming every asked id in order", () => {
    const unavailable = { kind: "unavailable", proposalId: "pp-00000000000b", reason: "not-waiting" } as const;
    const body = { items: [SHOWN, unavailable], kind: "read" };
    expect(privateTermProposalsAnswerOf({ body, expectedIds: ["pp-00000000000a", "pp-00000000000b"] })).toStrictEqual([
      SHOWN,
      unavailable,
    ]);
  });

  it("refuses a refusal, a reordered or short answer, an unknown reason and an unknown action", () => {
    const expectedIds = ["pp-00000000000a"];
    const bodies = [
      { kind: "refused", reason: "not-the-console" },
      { items: [{ ...SHOWN, proposalId: "pp-00000000000b" }], kind: "read" },
      { items: [], kind: "read" },
      { items: [{ kind: "unavailable", proposalId: "pp-00000000000a", reason: "quillfeather" }], kind: "read" },
      { items: [{ ...SHOWN, action: "rename" }], kind: "read" },
      { items: [{ ...SHOWN, answer: "maybe" }], kind: "read" },
    ];
    expect(bodies.map((body) => privateTermProposalsAnswerOf({ body, expectedIds }))).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("the Yes and No act rows", () => {
  it("each record one fixed answer to one proposal id, and nothing else", () => {
    const built = (["yes", "no"] as const).map((answer) =>
      buildActArgv({
        slots: { proposal: "pp-00000000000a" },
        verb: actVerbFor({ slug: PRIVATE_TERM_ANSWER_SLUGS[answer] })!,
      }),
    );
    expect(built).toStrictEqual([
      {
        argv: [
          "private-terms",
          "answer",
          "pp-00000000000a",
          "--as",
          "yes",
          "--via",
          "console",
          "--by-session",
          "work-console",
          "--json",
        ],
        kind: "argv",
      },
      {
        argv: [
          "private-terms",
          "answer",
          "pp-00000000000a",
          "--as",
          "no",
          "--via",
          "console",
          "--by-session",
          "work-console",
          "--json",
        ],
        kind: "argv",
      },
    ]);
  });
});
