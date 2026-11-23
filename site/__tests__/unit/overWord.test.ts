/*
 * Which of the owner's words end on the code word "over". The first four are spoken phrasings; the rest are the edges of the pattern and the ordinary phrases ending on "over".
 */
import { describe, expect, it } from "vitest";

import { endsOnOver } from "../../lib/overWord";

describe("endsOnOver", () => {
  it.each([
    " Uh, the former. Over",
    " Okay, um, well, I'm very irritated so I'm probably gonna drop now. Over",
    " but because I wanted to make that investment for all future weeks over",
    " And now you won't even answer me when I use the fucking code word. Fuck you. Over",
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
