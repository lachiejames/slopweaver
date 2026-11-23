/**
 * `talk relay --also-answers`, the other Queue cards the voice judged the owner's words answer: every
 * spelling of the repeated flag in the order given, and each shape argv alone can refuse.
 */
import { describe, expect, it } from "vitest";

import { alsoAnswersArgsOf } from "../../../../../cli/commands/talk/relayAlsoAnswersArgs.js";
import { parseRelayArgs } from "../../../../../cli/commands/talk/relayArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const BASE = ["--turn", TURN, "--say", "split them", "--about", "ask:queue-freshness"];

describe("parseRelayArgs --also-answers", () => {
  it("reads the spaced and = spellings, in the order given, and none as an empty list", () => {
    const both = unwrap(
      parseRelayArgs({ rest: [...BASE, "--also-answers", "pr:acme.widgets.42", "--also-answers=ask:split-files"] }),
    );
    expect([both.alsoAnswers, unwrap(parseRelayArgs({ rest: BASE })).alsoAnswers]).toEqual([
      ["pr:acme.widgets.42", "ask:split-files"],
      [],
    ]);
  });

  it("refuses a duplicate, the --about card, a hand step, a check-in, a bare pull request and a non-key, by name", () => {
    const refused = (...extra: string[]) => unwrapErr(parseRelayArgs({ rest: [...BASE, ...extra] }));
    expect([
      refused("--also-answers", "pr:acme.widgets.42", "--also-answers", "pr:acme.widgets.42"),
      refused("--also-answers", "ask:queue-freshness"),
      refused("--also-answers", "hand:sign-in"),
      refused("--also-answers", "act:ev-2"),
      refused("--also-answers", "pr:42"),
      refused("--also-answers", "split files"),
    ]).toEqual([
      ["--also-answers pr:acme.widgets.42 is named twice"],
      ["--also-answers ask:queue-freshness is the --about card already"],
      ["--also-answers hand:sign-in is a kind the owner's words never answer as another card"],
      ["--also-answers act:ev-2 is a kind the owner's words never answer as another card"],
      ["--also-answers pr:42 names no repository; a pull request's key is pr:<owner>.<repo>.<n>"],
      ["--also-answers takes a card key such as ask:<slug>, got split files"],
    ]);
  });

  it("refuses six cards, and any on a typed steer", () => {
    const six = ["a", "b", "c", "d", "e", "f"].flatMap((id) => ["--also-answers", `ask:${id}`]);
    const typed = ["--turn", TURN, "--heard", "split them", "--typed", "--also-answers", "pr:acme.widgets.42"];
    expect([
      unwrapErr(parseRelayArgs({ rest: [...BASE, ...six] })),
      unwrapErr(parseRelayArgs({ rest: typed })),
    ]).toEqual([
      ["--also-answers names at most 5 cards, got 6"],
      [
        "talk relay --typed takes no --also-answers: which other cards the owner's words answer is the voice's judgement",
      ],
    ]);
  });
});

describe("alsoAnswersArgsOf", () => {
  it("appends to the parse's running problems and returns no keys once any is refused", () => {
    const problems = ["--say is required"];
    const keys = alsoAnswersArgsOf({
      about: "",
      problems,
      rest: ["--also-answers", "pr:acme.widgets.42", "--also-answers", "hand:sign-in"],
      typed: false,
    });
    expect([keys, problems]).toEqual([
      [],
      ["--say is required", "--also-answers hand:sign-in is a kind the owner's words never answer as another card"],
    ]);
  });
});
