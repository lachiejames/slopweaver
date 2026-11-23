import { describe, expect, it } from "vitest";

import { probeOutcomeOf, probesHeld, readBackLines } from "../../../../../cli/commands/privateTerms/readBack.js";
import { PRIVATE_TERMS_HEADER_V2 } from "../../../../../hygiene/privateTerms.js";
import { applyPrivateTermsEdit, type PrivateTermsEdited } from "../../../../../hygiene/privateTermsEdit.js";
import { unwrap } from "../../../../../lib/result.js";

/** One synthetic row added to an empty file, its meaning as given. */
function addedRow({ meaning }: { meaning: string }): PrivateTermsEdited {
  return unwrap(
    applyPrivateTermsEdit({
      current: { kind: "absent" },
      edit: {
        kind: "add",
        row: {
          allowedWhere: "the acme workspace",
          caseInsensitive: true,
          className: "person",
          meaning,
          pattern: "quillfeather",
          source: "relay:acme-row",
        },
      },
      mintId: () => "pt-00000000000a",
    }),
  );
}

const PROBES = { matches: ["lunch with Quillfeather"], misses: ["lunch with Inkwell"] };

describe("probeOutcomeOf", () => {
  it("counts each probe that came out as given", () => {
    const row = addedRow({ meaning: "a colleague at acme" }).edited!;
    expect(probeOutcomeOf({ probes: PROBES, term: row })).toStrictEqual({
      matchedAsExpected: 1,
      matchesGiven: 1,
      missedAsExpected: 1,
      missesGiven: 1,
    });
  });

  it("counts a miss the row matches as not missed", () => {
    const row = addedRow({ meaning: "a colleague at acme" }).edited!;
    const probes = { matches: [], misses: ["QUILLFEATHER again"] };
    expect(probeOutcomeOf({ probes, term: row }).missedAsExpected).toBe(0);
  });
});

describe("probesHeld", () => {
  it("holds when every probe came out as given", () => {
    const outcome = { matchedAsExpected: 2, matchesGiven: 2, missedAsExpected: 0, missesGiven: 0 };
    expect(probesHeld({ outcome })).toBe(true);
  });

  it("fails when one match was missed", () => {
    const outcome = { matchedAsExpected: 1, matchesGiven: 2, missedAsExpected: 0, missesGiven: 0 };
    expect(probesHeld({ outcome })).toBe(false);
  });
});

describe("readBackLines", () => {
  it("reads an added row back by id, class, case, meaning, place and probe counts, never its pattern", () => {
    const lines = readBackLines({
      action: "add",
      edited: addedRow({ meaning: "a colleague at acme" }),
      home: "/home/acme",
      probes: PROBES,
      proposalId: "pp-00000000000a",
    });
    expect(lines).toStrictEqual([
      "proposal pp-00000000000a: add pt-00000000000a (person, case-insensitive)",
      "  means: a colleague at acme",
      "  fine where: the acme workspace",
      "  probes: 1 of 1 matched as they should, 1 of 1 missed as they should",
      "  rows: 0 before, 1 after",
      "  Nothing is written yet. Read this back to the owner; on the owner's yes: slopweaver private-terms confirm pp-00000000000a --home /home/acme",
    ]);
  });

  it("withholds a meaning that carries the term itself", () => {
    const lines = readBackLines({
      action: "add",
      edited: addedRow({ meaning: "who Quillfeather is" }),
      home: "/home/acme",
      probes: PROBES,
      proposalId: "pp-00000000000a",
    });
    expect(lines[1]).toBe("  means: (withheld here: it carries a private term)");
  });

  it("reads a removal back by the removed row's id alone", () => {
    const edited = unwrap(
      applyPrivateTermsEdit({
        current: {
          kind: "present",
          text: `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000a\tperson\ti\tquillfeather\ta colleague\t\trelay:acme-row\n`,
        },
        edit: { kind: "remove", termId: "pt-00000000000a" },
        mintId: () => "pt-00000000000b",
      }),
    );
    const lines = readBackLines({
      action: "remove",
      edited,
      home: "/home/acme",
      probes: { matches: [], misses: [] },
      proposalId: "pp-00000000000b",
    });
    expect(lines.slice(0, 2)).toStrictEqual([
      "proposal pp-00000000000b: remove pt-00000000000a",
      "  rows: 1 before, 0 after",
    ]);
  });
});
