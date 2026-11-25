/*
 * Which of the owner's words end on the code word "over". The first four are spoken phrasings; the rest are the edges of the pattern and the ordinary phrases ending on "over".
 */
import { describe, expect, it } from "vitest";

import { endsOnOver } from "../../lib/overWord";

describe("endsOnOver", () => {
  it.each([
    " Uh, the former. Over",
    " Okay, um, well, ABC-1 is all set so I'm probably gonna drop now. Over",
    " but because I wanted that set up for all future Acme releases over",
    " And now let's see if you answer me when I use the code word. Okay. Over",
    "over",
    "OVER.",
    "that's all from me, over…  ",
    "It’s over. Over",
    "one sec. Over",
  ])("hears the code word in %j", (text) => {
    expect(endsOnOver({ text })).toBe(true);
  });

  it.each([
    "",
    "over voice",
    "let's start over",
    "it's over",
    "It’s over.",
    "it is over",
    "game over",
    "the logs were all over",
    "hand it over",
    "moreover",
    "a hangover",
  ])("hears no code word in %j", (text) => {
    expect(endsOnOver({ text })).toBe(false);
  });
});
