/*
 * The plain-words criterion, which is the whole of what `autonomy record --said` refuses at the door.
 *
 * Two duties, and the second is the one that makes this file worth having. The first is that each class
 * fires on the notation it was written for. The second is that NONE of them fires on ordinary English —
 * a criterion that refuses the way the owner actually writes would make the field unwritable, so the passing cases
 * below are taken from the measured corpus the module's own overview names rather than invented here.
 */
import { describe, expect, it } from "vitest";

import { pastTheFold, SAID_ADVICE, saidRefusal, unparsableIn } from "../../../autonomy/said.js";
import { AUTONOMY_SAID_MAX } from "../../../autonomy/types.js";
import { WHAT_MAX_SENTENCES, WHAT_MAX_WORDS } from "../../../briefing/caps.js";

/** The line the card the owner could not parse would have carried, had the field existed when it was written. */
const READABLE =
  "I opened a pull request on my own repository: eight of the fourteen things the identity tool says it " +
  "watches were not actually being watched, and nobody outside this machine sees the change.";

describe("a line written in words the owner reads", () => {
  it("finds nothing to refuse in it", () => {
    expect(unparsableIn({ said: READABLE })).toBe(undefined);
  });

  it("finds nothing in the ordinary two-segment compounds this repository speaks in", () => {
    expect(unparsableIn({ said: "I set it to merge-when-ready, which is read-only until CI is green." })).toBe(
      undefined,
    );
  });

  it("finds nothing in a date, a clock time or a version", () => {
    expect(unparsableIn({ said: "I did it on 2026-09-21 at 14:20, on v2.1.4 of the console." })).toBe(undefined);
  });

  it("finds nothing in a ticket key or a pull-request number", () => {
    expect(unparsableIn({ said: "I closed JJJJ-1642 and the pull request #16644 that went with it." })).toBe(undefined);
  });

  it("finds nothing in a unix timestamp, which carries no letter", () => {
    expect(unparsableIn({ said: "The last message in the thread was at 1789702388." })).toBe(undefined);
  });

  // The FLOOR of the slug sense, pinned as a passing line rather than left to be discovered: a
  // three-segment slug is admitted, because three segments is where ordinary English lives. The two lines
  // below are the whole argument — the second is a live board row and the first is a phrase the owner writes —
  // and they are indistinguishable to any sense that would refuse either one. `../../../autonomy/said.ts`
  // § Two residues states it; this is what reddens if the threshold is ever quietly lowered to `{2,}`.
  it("admits a three-segment token, which is where ordinary English and a short board slug meet", () => {
    expect(unparsableIn({ said: "I keep it up-to-date as part of the day-to-day." })).toBe(undefined);
    expect(unparsableIn({ said: "I answered the search-reindex-review ask on the board." })).toBe(undefined);
  });
});

describe("a line carrying this repository's own notation", () => {
  it("names a doctrine rule number as a rule-number", () => {
    const found = unparsableIn({ said: "Rule 10 says this was mine to do." })!;
    expect(found.name).toBe("rule-number");
    expect(found.used).toBe("Rule 10");
  });

  it("names a recorded turn reference as a rule-number too — it is the same class to the owner", () => {
    const found = unparsableIn({ said: "The word on 245-2 covers it." })!;
    expect(found.name).toBe("rule-number");
    expect(found.used).toBe("245-2");
  });

  it("names a session id as a session-id, never as a slug", () => {
    const found = unparsableIn({ said: "Observed by ab5b7089-9ea4-4b19-9aa7-100c6277eb04 this morning." })!;
    expect(found.name).toBe("session-id");
    expect(found.used).toBe("ab5b7089-9ea4-4b19-9aa7-100c6277eb04");
  });

  it("names a bare hexadecimal run carrying a letter and a digit as a session-id", () => {
    const found = unparsableIn({ said: "The session fd64a339 did it." })!;
    expect(found.name).toBe("session-id");
    expect(found.used).toBe("fd64a339");
  });

  it("names a four-segment board slug as a slug", () => {
    const found = unparsableIn({ said: "This is about eight-of-the-workos-atlas-s-fourteen-declared." })!;
    expect(found.name).toBe("slug");
    expect(found.used).toBe("eight-of-the-workos-atlas-s-fourteen-declared");
  });

  it("names a prefixed record reference as a slug", () => {
    const found = unparsableIn({ said: "The evidence is at state:ledgers/autonomy.jsonl." })!;
    expect(found.name).toBe("slug");
    expect(found.used).toBe("state:ledgers/autonomy.jsonl");
  });

  it("reports the FIRST class in the declared order, so one refusal names one thing to fix", () => {
    const found = unparsableIn({
      said: "Rule 10 on eight-of-the-workos-atlas-s-fourteen-declared, seen by fd64a339.",
    })!;
    expect(found.name).toBe("rule-number");
  });

  it("carries the same verdict on a second call — the senses are not global and do not hold a lastIndex", () => {
    const line = "This is about eight-of-the-workos-atlas-s-fourteen-declared.";
    expect(unparsableIn({ said: line })!.name).toBe("slug");
    expect(unparsableIn({ said: line })!.name).toBe("slug");
  });
});

describe("the refusal a composer reads", () => {
  it("quotes the phrase, names the class, and says what to write instead", () => {
    const line = saidRefusal({ found: unparsableIn({ said: "Rule 10 says this was mine to do." })! });
    expect(line).toBe(
      'carries "Rule 10", which is a rule-number — say what the rule made obvious, not which rule it was. ' +
        SAID_ADVICE,
    );
  });

  it("points at the why field, so the fleet's own reasoning is not simply deleted", () => {
    expect(SAID_ADVICE).toContain("`why` field");
  });
});

describe("the budget the owner's card can actually draw", () => {
  it("passes a line the card draws whole", () => {
    expect(pastTheFold({ said: READABLE })).toBe(undefined);
  });

  // The measured case: 379 characters — inside AUTONOMY_SAID_MAX — running to 67 words. The character cap
  // and the word budget bound different things, and this is the line that proves they disagree.
  it("refuses a line inside the character cap that still runs past the word budget", () => {
    const said =
      "I went through every one of my open pull requests on the admin repository this morning and pressed " +
      "the merge button on the four that had already gone green, because each of them had been sitting there " +
      "for days with every check passing and nobody left to press it, and leaving them open was costing the " +
      "team a rebase every single time somebody else landed anything nearby.";
    expect(said.length).toBeLessThanOrEqual(AUTONOMY_SAID_MAX);
    expect(pastTheFold({ said })).toStrictEqual({ budget: "words", cap: WHAT_MAX_WORDS, measured: 67 });
  });

  it("refuses a line of more sentences than the card takes, however short they are", () => {
    const said = "I did it. It was fine. Someone asked. It landed. Nothing broke.";
    expect(pastTheFold({ said })).toStrictEqual({ budget: "sentences", cap: WHAT_MAX_SENTENCES, measured: 5 });
  });

  it("reports the SENTENCE budget first, so one refusal names the cut the fold makes first", () => {
    const words = Array.from({ length: 70 }, () => "word").join(" ");
    expect(pastTheFold({ said: `${words}. a. b. c. d.` })!.budget).toBe("sentences");
  });

  it("keeps a line sitting exactly on each budget", () => {
    const exact = Array.from({ length: WHAT_MAX_WORDS }, () => "word").join(" ");
    expect(pastTheFold({ said: exact })).toBe(undefined);
    expect(pastTheFold({ said: "a. b. c. d." })).toBe(undefined);
  });
});
