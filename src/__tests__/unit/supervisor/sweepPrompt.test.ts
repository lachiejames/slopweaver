import { parseArgs } from "node:util";

import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import {
  emptyShiftSourceMessage,
  flagTokensIn,
  MAX_RENDERED_PROMPT_WORDS,
  renderSweepPrompt,
  STANDING_STEP_MARKERS,
  shiftStateBudgetWords,
  standingMarkersIn,
  sweepPromptFrameWords,
  unreadableShiftSourceMessage,
  wordCount,
} from "../../../supervisor/sweepPrompt.js";

const CONTRACT = "/plugin/skills/supervisor/reference/sweep-contract.md";

describe("wordCount", () => {
  it("counts nothing in an empty string", () => {
    expect(wordCount({ text: "" })).toBe(0);
  });

  it("ignores runs of whitespace and newlines", () => {
    expect(wordCount({ text: "  one\n\n two   three \t four " })).toBe(4);
  });
});

describe("standingMarkersIn", () => {
  it("has at least one entry in STANDING_STEP_MARKERS, so the guards below are not vacuously green", () => {
    expect(STANDING_STEP_MARKERS.length).toBeGreaterThan(0);
  });

  it("finds no marker in a real shift state", () => {
    const shiftState =
      "MERGE QUEUE: #231 landed a1b2c3d4; behind it #232 owes one rebase lap. IN FLIGHT: ws 971, ws 972. " +
      "Owner asleep until 10:00 AEST. Depth line 500k, write the successor block at ~430k.";
    expect(standingMarkersIn({ shiftState })).toStrictEqual([]);
  });

  it("names every standing step a shift state re-states", () => {
    expect(standingMarkersIn({ shiftState: "run session watch then handover reconcile --json" })).toStrictEqual([
      "session watch",
      "handover reconcile",
    ]);
  });

  it("matches case-insensitively, so a shouted retype is still caught", () => {
    expect(standingMarkersIn({ shiftState: "LAST: FILL-TO-CAP" })).toStrictEqual(["fill-to-cap"]);
  });

  it("declares every marker as a non-empty phrase", () => {
    expect(STANDING_STEP_MARKERS.filter((marker) => marker.trim().length === 0)).toStrictEqual([]);
  });
});

describe("renderSweepPrompt", () => {
  it("names the contract by path so the wakeup reads it rather than carrying it", () => {
    const rendered = unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState: "ws 971 landing #231" }));
    expect(rendered.prompt).toContain(`THE STANDING CONTRACT IS ${CONTRACT}`);
    expect(rendered.prompt).toContain("SHIFT STATE (the only per-tick half): ws 971 landing #231");
  });

  it("renders a quiet tick explicitly rather than leaving the field blank", () => {
    const rendered = unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState: "   " }));
    expect(rendered.prompt).toContain("nothing this tick beyond the contract.");
  });

  it("stays far under the cap on a quiet tick", () => {
    const rendered = unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState: "" }));
    expect(rendered.words).toBe(75);
  });

  it("refuses a shift state that re-states the contract, naming the step", () => {
    const result = renderSweepPrompt({ contractPath: CONTRACT, shiftState: "first run session watch every tick" });
    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain("session watch");
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(CONTRACT);
  });

  it("refuses a shift state over its budget, naming the budget and the exact overage", () => {
    const budget = shiftStateBudgetWords({ contractPath: CONTRACT });
    const shiftState = Array.from({ length: budget + 7 }, () => "word").join(" ");
    const result = renderSweepPrompt({ contractPath: CONTRACT, shiftState });
    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toBe(
      `the shift state is ${String(budget + 7)} words against a budget of ${String(budget)} — the ` +
        `${String(MAX_RENDERED_PROMPT_WORDS)}-word cap on the rendered prompt less its frame. Cut 7 words; ` +
        `standing procedure belongs in ${CONTRACT}. ` +
        "'slopweaver supervisor sweep-prompt --budget' prints the budget before you write.",
    );
  });

  it("admits a shift state of exactly the budget, and refuses one word more", () => {
    const budget = shiftStateBudgetWords({ contractPath: CONTRACT });
    const exact = unwrap(
      renderSweepPrompt({ contractPath: CONTRACT, shiftState: Array.from({ length: budget }, () => "w").join(" ") }),
    );
    expect(exact.words).toBe(MAX_RENDERED_PROMPT_WORDS);
    expect(exact.remainingWords).toBe(0);
    const over = renderSweepPrompt({
      contractPath: CONTRACT,
      shiftState: Array.from({ length: budget + 1 }, () => "w").join(" "),
    });
    expect(over.isErr()).toBe(true);
  });

  it("reports every count a caller needs, and words is always frame plus shift", () => {
    const rendered = unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState: "ws 971 landing #231" }));
    expect(rendered.frameWords).toBe(sweepPromptFrameWords({ contractPath: CONTRACT }));
    expect(rendered.shiftWords).toBe(4);
    expect(rendered.budgetWords).toBe(shiftStateBudgetWords({ contractPath: CONTRACT }));
    expect(rendered.words).toBe(rendered.frameWords + rendered.shiftWords);
    expect(rendered.remainingWords).toBe(rendered.budgetWords - rendered.shiftWords);
  });

  it("returns EVERY refusal at once, so one run names the whole invocation's faults", () => {
    const budget = shiftStateBudgetWords({ contractPath: CONTRACT });
    const shiftState = `session watch --json ${Array.from({ length: budget }, () => "word").join(" ")}`;
    const result = renderSweepPrompt({ contractPath: CONTRACT, shiftState });
    expect(result.isErr()).toBe(true);
    const lines = supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() });
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("session watch");
    expect(lines[1]).toContain("--json");
    expect(lines[2]).toContain("against a budget of");
  });

  it("refuses a shift state that spells out how to invoke a verb", () => {
    const result = renderSweepPrompt({
      contractPath: CONTRACT,
      shiftState: "tick-draft wants --tick-id and --out before the capture's flags",
    });
    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toBe(
      "shift state spells out HOW to invoke a verb — it names the options --tick-id, --out. Which flags a " +
        `verb takes is standing procedure and lives in ${CONTRACT} and the reference files it links; the ` +
        "shift state carries this tick's STATE and nothing else. Delete the sentences holding them.",
    );
  });

  it("refuses a blank contract path", () => {
    const result = renderSweepPrompt({ contractPath: "  ", shiftState: "anything" });
    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain("no contract path");
  });

  it("admits the largest shift half measured across eleven handoffs (547 words)", () => {
    const shiftState = Array.from({ length: 547 }, () => "state").join(" ");
    const rendered = unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState }));
    expect(rendered.words).toBe(616);
  });
});

describe("flagTokensIn", () => {
  it("finds no option in a real shift state", () => {
    const shiftState =
      "MERGE QUEUE: #231 landed a1b2c3d4 — behind it #232 owes one rebase lap. IN FLIGHT: ws 971, ws 972. " +
      "Owner asleep until 10:00 AEST; the worktree-prune slot is cooling until 13:36Z.";
    expect(flagTokensIn({ shiftState })).toStrictEqual([]);
  });

  it("names each distinct option once, in the order it first appears", () => {
    expect(flagTokensIn({ shiftState: "--out then --tick-id then --out again" })).toStrictEqual(["--out", "--tick-id"]);
  });

  it("reads a SHOUTED option, since a shift state is prose rather than a command line", () => {
    expect(flagTokensIn({ shiftState: "pass --KEEP-NOTES 28" })).toStrictEqual(["--keep-notes"]);
  });

  it("leaves an em-dash and a horizontal rule alone — neither is an option", () => {
    expect(flagTokensIn({ shiftState: "the loop is up — arm ec77d5bb healthy\n---\nnothing else" })).toStrictEqual([]);
  });

  it("leaves a bare double dash and a trailing dash alone", () => {
    expect(flagTokensIn({ shiftState: "read it with -- and with x--y" })).toStrictEqual([]);
  });
});

describe("sweepPromptFrameWords", () => {
  it("costs the same for a one-word and a five-word shift state, so the budget is a property of the path", () => {
    const frame = sweepPromptFrameWords({ contractPath: CONTRACT });
    const short = unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState: "one" }));
    const longer = unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState: "one two three four five" }));
    expect(short.words - short.shiftWords).toBe(frame);
    expect(longer.words - longer.shiftWords).toBe(frame);
  });

  it("ignores whitespace around the contract path, exactly as the render does", () => {
    expect(sweepPromptFrameWords({ contractPath: `  ${CONTRACT}  ` })).toBe(
      sweepPromptFrameWords({ contractPath: CONTRACT }),
    );
  });

  it("is what the budget subtracts from the cap", () => {
    expect(shiftStateBudgetWords({ contractPath: CONTRACT })).toBe(
      MAX_RENDERED_PROMPT_WORDS - sweepPromptFrameWords({ contractPath: CONTRACT }),
    );
  });

  it("grows with a longer contract path, because the path is rendered into the frame", () => {
    const deeper = `${CONTRACT} one two`;
    expect(sweepPromptFrameWords({ contractPath: deeper })).toBe(sweepPromptFrameWords({ contractPath: CONTRACT }) + 2);
  });
});

describe("every counterexample reproduced against flagTokensIn", () => {
  it("leaves an option spelled inside this real shift state's logs URL alone — evidence is not an invocation", () => {
    const shiftState =
      "MERGE QUEUE: #231 landed; #232 awaits review. IN FLIGHT: ws 971. Incident evidence: " +
      "https://logs.example.com/search?q=--timeout&from=now-1h. DEPTH: 2 ready, 1 running.";
    expect(flagTokensIn({ shiftState })).toStrictEqual([]);
    expect(unwrap(renderSweepPrompt({ contractPath: CONTRACT, shiftState })).shiftWords).toBe(19);
  });

  it("still catches an option written as prose in the same shift state as a URL", () => {
    expect(
      flagTokensIn({ shiftState: "see https://logs.example.com/x?q=--timeout and pass --tick-id next tick" }),
    ).toStrictEqual(["--tick-id"]);
  });

  // Rounds one through seven each blanked a URL SPAN out of the prose and each died on the next arrangement
  // of the path, because deciding where a URL ends means deciding whether a trailing `.` `_` `:` `%` belongs
  // to the URL or to the sentence, and that question has no answer. Not one of these is handled by a rule
  // about URLs now: each token simply is not equal to an option.
  it("reports nothing for any URL shape a round died on", () => {
    const urls = [
      "https://logs.example.com/run_history?q=--timeout",
      "https://logs.example.com:8080/run__42/%20?q=--timeout",
      "https://logs.example.com:8080/run__%20?q=--timeout",
      "https://logs.example.com:8080/run%20__?q=--timeout",
      "https://logs.example.com:8080/run%20__.json?q=--timeout",
      "https://logs.example.com:8080/run__:42.json?q=--timeout",
      "https://[::1]/search?q=--timeout",
      "mailto:ops@example.com?subject=--timeout",
      "https://logs.example.com/search?q=+--timeout",
    ];

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => flagTokensIn({ shiftState: `Evidence: ${url}` }).length > 0)).toStrictEqual([]);
  });

  // The last two entries above are the pair that ended the span approach for good:
  // a `mailto:` carries no `://` at all, and `+` is a space inside a query. Both are well-formed URLs that no
  // amount of care about `://` or about which character opens a value was ever going to cover.
  it("reports nothing for a scheme with no double slash, which no URL heuristic here ever saw", () => {
    expect(flagTokensIn({ shiftState: "Evidence: mailto:ops@example.com?subject=--timeout" })).toStrictEqual([]);
  });

  // Markdown emphasis round a hand-copied option is a likelier shape than any URL case above, so the
  // inversion fixed a real miss rather than only trading one class for another. Which of these are NEWLY
  // reported is bound below off the removed matcher itself rather than asserted in prose, since an
  // earlier comment claiming all of them were silent before, when `(?<![\w-])` only ever hid the
  // UNDERSCORE forms — `*`, `"` and `(` are not word characters and were passing through all along.
  it("reports an option wrapped in markdown emphasis, quotes or brackets", () => {
    const written = ["_--tick-id_", "*--tick-id*", "**--tick-id**", '"--tick-id"', "(--tick-id)", "`--tick-id`"];

    expect(written.length).toBeGreaterThan(0);
    expect(
      written.filter((form) => !flagTokensIn({ shiftState: `pass ${form} next tick` }).includes("--tick-id")),
    ).toStrictEqual([]);
  });

  // What the inversion actually bought, read off the removed matcher's GUARDS rather than off a sample.
  // They were `[\w-]` on both sides, so every form wrapped in a word character or a hyphen was lost and no
  // bracket form ever was. Two readings are wrong in opposite directions — crediting
  // all four bracket forms, or crediting the underscore alone — so both halves of the
  // partition are asserted here, against the matcher itself.
  it("was silent before on every form a word character or a hyphen wrapped, and on no bracket form", () => {
    const removedMatcher = /(?<![\w-])--[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\w-])/g;
    const wrappedInWordOrHyphen = ["_--tick-id_", "__--tick-id__", "----tick-id", "--tick-id--"];
    const wrappedInBrackets = ["*--tick-id*", '"--tick-id"', "(--tick-id)", "`--tick-id`"];

    expect(wrappedInWordOrHyphen.filter((form) => form.match(removedMatcher) !== null)).toStrictEqual([]);
    expect(wrappedInBrackets.filter((form) => form.match(removedMatcher) === null)).toStrictEqual([]);
  });

  // The named miss, asserted so it is a decision rather than a hole. What abuts has to be ASCII for this to
  // hold, and a name that left the word out would be wrong: `é--tick-id` abuts a letter too and
  // reports, because a non-ASCII character is not a body character and strips off the edge like any other
  // decoration. The last assertion below is that boundary. This list drives a REFUSAL, so a false positive
  // rejects a sweep prompt whose author did nothing wrong, which is the tax this module exists to remove,
  // while a miss lets a few words past a nudge. The first of these is the side
  // to fail on rather than a defect.
  // It is ONE of the three, not the only one: a name reading "the one class it misses" would be false off the
  // grammar test below, where `--tick--id` is missed on its doubled interior hyphen with nothing abutting.
  it("does NOT report an option abutting ASCII text with no whitespace, one of the three named misses", () => {
    expect(
      flagTokensIn({ shiftState: "see [docs](https://docs.example.com/flags)?--tick-id is required." }),
    ).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "see _https://logs.example.com/run_.--tick-id is required" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "see x--tick-id is required" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "see é--tick-id is required" })).toStrictEqual(["--tick-id"]);
  });

  // The name is the whole finding , replacing an earlier one reading "for ANY arrangement
  // of a URL's path, host or scheme". The generator holds a scheme, a host and the key name `q` fixed, and
  // each of those is an ASCII body character sitting before the option — which is what keeps the value
  // silent. Drop all three and the claim fails: the last assertion is that counterexample, and it reports.
  // A test naming a universal its own generator does not reach is the class this whole round was about.
  // The name goes one word further: the generator's URLs carry no ASCII whitespace, and
  // the split is ASCII, so a URL holding a literal TAB is two tokens and its tail reports — while `new URL`
  // accepts that string whole, because the URL parser strips tab and newline before parsing. Both halves
  // are asserted at the end, and the name now carries the restriction the generator actually imposes.
  it("does not report a query value of a whitespace-free URL carrying a scheme, a host and a key name", () => {
    const fragments = ["a", "_", "__", "%20", "1", ".", ".json", "-", "/", "%2f", ":42", "~", "+", "!", "(", ")"];
    const urls = fragments.flatMap((first) =>
      fragments.flatMap((second) =>
        ["logs.example.com", "logs.example.com:8080", "[::1]"].flatMap((host) =>
          ["https://", "http://", "ftp://", "mailto:"].map(
            (scheme) => `${scheme}${host}/x${first}${second}?q=--timeout`,
          ),
        ),
      ),
    );

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => flagTokensIn({ shiftState: `Evidence: ${url}` }).length > 0)).toStrictEqual([]);
    expect([...new URL("/?=--timeout", "https://example.org").searchParams]).toStrictEqual([["", "--timeout"]]);
    expect(flagTokensIn({ shiftState: "Evidence: /?=--timeout" })).toStrictEqual(["--timeout"]);
    expect([...new URL("https://logs.example.com/search?q=\t--timeout").searchParams]).toStrictEqual([
      ["q", "--timeout"],
    ]);
    expect(flagTokensIn({ shiftState: "Evidence: https://logs.example.com/search?q=\t--timeout" })).toStrictEqual([
      "--timeout",
    ]);
  });

  // `"--tick-id"--` strips its quote but kept its trailing dashes, so the remainder was not an
  // option and a whitespace-delimited one vanished. The fix is read off BARE_OPTION rather than off this
  // case: that pattern ends in `[a-z0-9]`, so a trailing `-` can never close an option and is always
  // decoration — while a leading one may OPEN one and is kept. Hence the two edges below.
  // The halves of the one ambiguity. `-` is the only character that can be
  // either an option's opener or prose decoration, and BARE_OPTION's own opener settles both halves: a
  // leading `-` is that opener only as the exact prefix `--` followed by `[a-z]`, and every other leading
  // shape it can take decorates; the pattern ends in `[a-z0-9]`, so a trailing one always decorates. That
  // is why the leading half is stated that way rather than as "a `-` another `-` follows" — that spelling
  // kept `--"--tick-id"--`'s decorating pair and hid the option behind it.
  // The name goes one word further again. Every fixture here QUOTES the option, and the quote
  // is what stops a leading dash reaching its opener; drop it and `-` merges, exactly as the parity test
  // below says. The last assertion is that boundary, so the two tests cannot drift apart.
  it("reports a QUOTED option a seat wrote ASCII dashes around, not only em dashes", () => {
    expect(flagTokensIn({ shiftState: 'Use "--tick-id"-- please.' })).toStrictEqual(["--tick-id"]);
    expect(flagTokensIn({ shiftState: 'Use -"--tick-id"- please.' })).toStrictEqual(["--tick-id"]);
    expect(flagTokensIn({ shiftState: 'Use --"--tick-id"-- please.' })).toStrictEqual(["--tick-id"]);
    expect(flagTokensIn({ shiftState: "Use ---tick-id- please." })).toStrictEqual([]);
  });

  // The other half of that ruling, asserted so it is a decision and not a hole: a decoration ending in a
  // hyphen MERGES with the option's own `--`, and `---tick-id` is a different token rather than a decorated
  // `--tick-id`. Nothing lexical can tell those apart, so the guard consumes the run pair by pair and what
  // is left of an ODD one is not an option. Pinned in BOTH directions below, because the parity is the
  // mechanism's own consequence rather than a judgement about intent: an even run leaves the
  // opener standing and IS reported, and neither side is more likely to be what an author meant.
  it("does NOT report a token whose ODD leading hyphen run ran into the option", () => {
    expect(flagTokensIn({ shiftState: "run it ---tick-id today" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "run it '---tick-id today" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "run it -----tick-id today" })).toStrictEqual([]);
  });

  it("DOES report one an even leading hyphen run decorates, the other side of that parity", () => {
    expect(flagTokensIn({ shiftState: "run it ----tick-id today" })).toStrictEqual(["--tick-id"]);
    expect(flagTokensIn({ shiftState: "run it ------tick-id today" })).toStrictEqual(["--tick-id"]);
  });

  // A file path is not silent. The criterion is LEXICAL —
  // "cannot appear in an option" is not the same claim as "is prose decoration" — so a token whose
  // non-option characters all sit at its ENDS reads as a decorated option however it was meant. Asserted as
  // an accepted cost rather than left to be found: nothing lexical separates `./--out` from `(--out)`, and
  // the module's own JSDoc now says so instead of promising that paths are silent.
  it("DOES report a path-shaped token whose punctuation all sits at its ends", () => {
    expect(flagTokensIn({ shiftState: "wrote ./--out today" })).toStrictEqual(["--out"]);
    expect(flagTokensIn({ shiftState: "wrote ../--out today" })).toStrictEqual(["--out"]);
    expect(flagTokensIn({ shiftState: "wrote ~/--out today" })).toStrictEqual(["--out"]);
    expect(flagTokensIn({ shiftState: "wrote é--out today" })).toStrictEqual(["--out"]);
  });

  it("stays silent on a path carrying a body character on either side of the option", () => {
    expect(flagTokensIn({ shiftState: "wrote src/cli/--out today" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "wrote out/--out.json today" })).toStrictEqual([]);
  });

  // The fourth class of this partition. `toLowerCase` is
  // UNICODE-aware and `U+212A`, a compatibility letter, folds to ASCII `k`, so folding before classifying let a
  // character that is not an option character become one INSIDE a token: `--tic<U+212A>-id` reported
  // `--tick-id`, while `<U+212A>--tick-id` was silent and `é--tick-id` was not — one character, three
  // behaviours, and a partition true only of ASCII input. The fold is ASCII-only now, so `U+212A` is
  // decoration at an edge and a disqualifier inside the body, exactly like `é`.
  it("classifies a character that Unicode lowercasing would fold into the option alphabet", () => {
    expect(flagTokensIn({ shiftState: "Evidence: --ticK-id" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "Use K--tick-id next tick." })).toStrictEqual(["--tick-id"]);
    expect(flagTokensIn({ shiftState: "Use é--tick-id next tick." })).toStrictEqual(["--tick-id"]);
  });

  // `\s` matches `U+00A0`, `U+2003` and `U+FEFF`, so splitting on it cut a URL the author
  // typed as ONE thing into two tokens and reported its tail — a boundary nobody can see is not a
  // boundary. The split is ASCII now, so a non-ASCII space stays INSIDE the token and disqualifies it the
  // same way any other non-option character does.
  // The name says NON-ASCII because an unqualified name reads as covering every invisible
  // character: `ASCII_WHITESPACE` still holds the C0 controls, so a URL carrying `U+000B VERTICAL TAB` IS
  // split and its tail reported, which the last assertion pins. That is deliberate rather than an
  // oversight, because splitting a shift state on ASCII whitespace is the whole tokenisation and carving
  // the invisible C0 controls back out of it would be a rule about URLs again.
  it("does not find a NON-ASCII whitespace boundary a reader cannot see inside a URL", () => {
    expect(flagTokensIn({ shiftState: "Evidence: https://logs.example.com/ --out" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "Evidence: https://logs.example.com/ --out" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "Evidence: https://logs.example.com/﻿--out" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "Evidence: https://logs.example.com/\u000b--out" })).toStrictEqual(["--out"]);
  });

  // The other half of that, and the case that killed THREE successive stories about WHY a URL is silent.
  // It is not that a reported one lacks a host (`--out` IS the hostname), nor that a host spelled
  // unlike an option keeps one silent (`//é--out/` has hostname `xn----out-9ra` and reports), nor
  // that a surviving ASCII body character is what does it (the last case below has none, and is
  // silent on the odd-run merge instead). Each story was falsified by a URL the criterion itself handles,
  // so this test asserts the criterion and no mechanism: a URL is reported exactly when one of the
  // whitespace-delimited TOKENS it falls into strips to an option. The last two cases:
  // a literal tab inside the URL is a boundary like any other ASCII whitespace, so the tail after it takes
  // that same test and REPORTS, and adding one more query parameter to that same tail silences it again.
  // The hostnames are bound so the comment cannot drift back into a rule that is not there.
  it("reports a URL exactly when a TOKEN of it strips to an option, whatever its host is", () => {
    expect(new URL("//--out/", "https://example.org").hostname).toBe("--out");
    expect(new URL("//é--out/", "https://example.org").hostname).toBe("xn----out-9ra");
    expect(new URL("//---out/", "https://example.org").hostname).toBe("---out");
    expect(flagTokensIn({ shiftState: "Evidence: //--out/" })).toStrictEqual(["--out"]);
    expect(flagTokensIn({ shiftState: "Evidence: //é--out/" })).toStrictEqual(["--out"]);
    expect(flagTokensIn({ shiftState: "Evidence: //logs.example.com/--out" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "Evidence: //---out/" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "Evidence: https://logs.example.com/search?q=--timeout" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "Evidence: https://logs.example.com/search?q=\t--timeout" })).toStrictEqual([
      "--timeout",
    ]);
    expect(
      flagTokensIn({ shiftState: "Evidence: https://logs.example.com/search?q=\t--timeout&from=now-1h" }),
    ).toStrictEqual([]);
  });

  // Both docs described the alphabet partition and then called the class list closed, while
  // the pattern is also a GRAMMAR: `--tick--id` is built entirely of option characters and its leading run
  // is EVEN, so neither documented miss explains why it is silent — a doubled INTERIOR hyphen does. It is
  // a third reason a token goes unreported and both docs now say so. The justification
  // they gave for it fails: a PARSER takes both of these, asserted below off `node:util` rather than asserted by
  // the prose, so the pattern is narrower than parseable on purpose and it is this CLI's own 307 option
  // literals that set the width (the repro is on `flagTokensIn`).
  // STRIPPED is in the name: the test is about what survives the edges, not about the raw
  // token, since `--tick-id--` is built of option characters and fails BARE_OPTION while its stripped form
  // passes. The last assertion is that boundary.
  it("stays silent on a STRIPPED token of option characters that is not a well-formed option", () => {
    // `parseArgs` answers a null-prototype object, so read the value rather than comparing the bag.
    expect(
      parseArgs({ args: ["--tick--id"], options: { "tick--id": { type: "boolean" } }, strict: true }).values[
        "tick--id"
      ],
    ).toBe(true);
    expect(parseArgs({ args: ["--1x"], options: { "1x": { type: "boolean" } }, strict: true }).values["1x"]).toBe(true);
    expect(flagTokensIn({ shiftState: "run it (--tick--id) today" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "run it --1x today" })).toStrictEqual([]);
    expect(flagTokensIn({ shiftState: "run it --tick-id-- today" })).toStrictEqual(["--tick-id"]);
  });

  it("still folds an ASCII capital, which is the only fold left", () => {
    expect(flagTokensIn({ shiftState: "pass --KEEP-NOTES 28" })).toStrictEqual(["--keep-notes"]);
    expect(flagTokensIn({ shiftState: "pass --Out and --OUT" })).toStrictEqual(["--out"]);
  });

  // A name reading "never HIDES a whitespace-delimited option, however prose
  // decorates either end of it" — a universal the generator's own filter excludes, since `run it
  // ---tick-id today` answers `[]`. Both halves of that filter are asserted below now, so the parity is a
  // bound partition rather than a sentence beside a generator that skips it.
  it("hides no option a decoration with an EVEN trailing hyphen run wraps, and hides every odd one", () => {
    const edges = [
      "",
      ".",
      ",",
      ";",
      ":",
      ")",
      "]",
      "}",
      "!",
      "?",
      "*",
      "**",
      "_",
      "__",
      "`",
      "'",
      '"',
      "“",
      "”",
      "~~",
      "…",
      "—",
      "–",
      "(",
      "[",
      "{",
      "<",
      ">",
      "§",
      "•",
      "-",
      "--",
      "---",
      '-"',
      '--"',
      "'-",
      "'--",
      "-_",
    ];
    // A left decoration is excluded exactly when its own trailing hyphen run is ODD, and the case above is
    // why: an odd run merges with the option's `--` into a run no reader can split, while an even one (zero
    // included) leaves the opener standing. `-` and `---` are excluded here, `--` and `-"` are not. Every
    // other arrangement, both ends, must be reported.
    const trailingHyphens = ({ text }: { text: string }): number => text.length - text.replace(/-+$/, "").length;
    const spread = ({ left }: { left: string }): readonly string[] =>
      edges.map((right) => `run it ${left}--tick-id${right} today`);
    const evenCases = edges
      .filter((left) => trailingHyphens({ text: left }) % 2 === 0)
      .flatMap((left) => spread({ left }));
    const oddCases = edges
      .filter((left) => trailingHyphens({ text: left }) % 2 === 1)
      .flatMap((left) => spread({ left }));

    expect(evenCases.length).toBeGreaterThan(0);
    expect(oddCases.length).toBeGreaterThan(0);
    expect(evenCases.filter((shiftState) => !flagTokensIn({ shiftState }).includes("--tick-id"))).toStrictEqual([]);
    expect(oddCases.filter((shiftState) => flagTokensIn({ shiftState }).length > 0)).toStrictEqual([]);
  });

  // The earlier `[^a-z0-9]+$` ran at 14, 55, 203 and 800ms for a token of 5k, 10k, 20k and
  // 40k internal punctuation characters — four times the work for twice the input, because `$` anchors that
  // pattern only on the right and the engine retried it from every start position. Nothing upstream bounds
  // it: a token is ONE word, so the word cap cannot cap its length, and the option pass runs before the
  // budget defect is collected. The trailing edge is a backward walk now. This asserts the RESULT on a
  // token that used to be slow, not a duration — a clock assertion is banned here and would not prove a
  // complexity claim anyway; the growth measurement and its repro live on `stripProseEdges`.
  it("returns the same answer on a token holding a long run of internal punctuation", () => {
    const long = `a${"_".repeat(40_000)}b`;
    expect(flagTokensIn({ shiftState: `run it ${long} and --tick-id today` })).toStrictEqual(["--tick-id"]);
    expect(flagTokensIn({ shiftState: `run it ${"_".repeat(40_000)}--tick-id today` })).toStrictEqual(["--tick-id"]);
  });

  it("never refuses a quiet tick for being over budget, at the length where the budget runs out", () => {
    const longPath = `/${Array.from({ length: 632 }, () => "a").join(" ")}`;
    expect(shiftStateBudgetWords({ contractPath: longPath })).toBe(0);
    const rendered = unwrap(renderSweepPrompt({ contractPath: longPath, shiftState: "   " }));
    expect(rendered.prompt).toContain("nothing this tick beyond the contract.");
    expect(rendered.budgetWords).toBe(0);
  });

  it("floors the budget at zero, so a frame past the cap never asks for a negative cut", () => {
    const pastCap = `/${Array.from({ length: 633 }, () => "a").join(" ")}`;
    expect(sweepPromptFrameWords({ contractPath: pastCap })).toBe(MAX_RENDERED_PROMPT_WORDS + 1);
    expect(shiftStateBudgetWords({ contractPath: pastCap })).toBe(0);
    const rendered = unwrap(renderSweepPrompt({ contractPath: pastCap, shiftState: " \t\n " }));
    expect(rendered.budgetWords).toBe(0);
  });

  it("still refuses one authored word when the budget is zero", () => {
    const longPath = `/${Array.from({ length: 632 }, () => "a").join(" ")}`;
    const result = renderSweepPrompt({ contractPath: longPath, shiftState: "busy" });
    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      "the shift state is 1 words against a budget of 0",
    );
  });
});

describe("unreadableShiftSourceMessage / emptyShiftSourceMessage", () => {
  it("names the source that could not be read, and the flag-free way to arm a quiet tick", () => {
    expect(unreadableShiftSourceMessage({ source: "/tmp/shift-340.txt" })).toBe(
      "cannot read the shift state at /tmp/shift-340.txt — nothing was rendered. A tick with no state of its " +
        "own is armed by passing no shift flag at all, never by naming a source that cannot be read.",
    );
  });

  it("says an empty named source is a fault in the source rather than a quiet tick", () => {
    expect(emptyShiftSourceMessage({ source: "standard input" })).toBe(
      "the shift state at standard input is empty — nothing was rendered. Naming a source says this tick HAS " +
        "state, so an empty one is a fault in the source rather than a quiet tick; a genuinely quiet tick " +
        "passes no shift flag at all.",
    );
  });
});
