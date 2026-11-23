/*
 * The link `hand post` mints and the page that reads it name the same parameters and the same contexts.
 *
 * `src/hand/consoleLinkNames.ts` restates them because a file under `src/` may not import one under `site/`
 * (`tsconfig.build.json`'s `rootDir`); this file, in the lane that reaches both roots, is what binds the copy.
 */

import { describe, expect, it } from "vitest";

import {
  isLinkContext,
  CONTEXT_PARAM as MINTED_CONTEXT,
  OPEN_PARAM as MINTED_OPEN,
  QUEUE_KINDS,
} from "../../../src/hand/consoleLinkNames";
import { CARD_KEY, isRegisterCardKey } from "../../../src/talk/cardKey";
import { CARD_KEY as SITE_CARD_KEY } from "../../lib/cardKey";
import { OPEN_KEY } from "../../lib/pageVoice";
import { ABOUT_KEY } from "../../lib/talkRelayRequestWire";
import { CONTEXT_PARAM, isWorkContext, OPEN_PARAM, WORK_CONTEXTS } from "../../lib/workContext";

describe("the minted queue link and the console agree", () => {
  it("on the two parameter names", () => {
    expect(MINTED_OPEN).toBe(OPEN_PARAM);
    expect(MINTED_CONTEXT).toBe(CONTEXT_PARAM);
  });

  it("on every context the switcher offers, and on nothing else", () => {
    expect(WORK_CONTEXTS.length).toBeGreaterThan(0);
    expect(WORK_CONTEXTS.filter((context) => !isLinkContext(context))).toEqual([]);
    expect(["slopweaver", "work", "acme"].map((value) => [isLinkContext(value), isWorkContext(value)])).toEqual([
      [true, true],
      [true, true],
      [false, false],
    ]);
  });

  it("on the record kinds a key may name", () => {
    expect(QUEUE_KINDS).toEqual(["hand", "ask", "draft", "post", "review", "import", "pr", "act"]);
  });

  it("on every kind a card open to the voice, or a steer about it, may name", () => {
    const keys = [...QUEUE_KINDS, "recipe", "align", "candidate"].map((kind) => `${kind}:x_1`);

    expect(keys.filter((key) => !OPEN_KEY.test(key) || !ABOUT_KEY.test(key))).toEqual([]);
  });

  it("on the card key itself, to the character", () => {
    expect([SITE_CARD_KEY.source, SITE_CARD_KEY.flags]).toEqual([CARD_KEY.source, CARD_KEY.flags]);
  });

  it("that an Automations key and an Alignment question are card keys no register holds", () => {
    expect([
      CARD_KEY.test("recipe:organisation-hunt-daily"),
      isRegisterCardKey({ key: "recipe:x" }),
      CARD_KEY.test("align:voice-length"),
      isRegisterCardKey({ key: "align:voice-length" }),
      CARD_KEY.test("candidate:c-001"),
      isRegisterCardKey({ key: "candidate:c-001" }),
    ]).toEqual([true, false, true, false, true, false]);
    expect(QUEUE_KINDS.filter((kind) => !isRegisterCardKey({ key: `${kind}:x` }))).toEqual([]);
  });
});
