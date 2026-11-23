import { describe, expect, it } from "vitest";

import { ANY_LETTER, ANY_MARK, carriesProblem, namesProblem, spelling } from "../../../prformat/spelling.js";

describe("spelling", () => {
  it("collapses a run of space and breaks to one, a break when it holds one (fallback review r24)", () => {
    expect(spelling({ text: "a\n\n\n  \nb  c" })).toBe("a\nb c");
  });

  it("never reads Problem off a date, and reads it off any word naming it (fallback reviews r22–r29)", () => {
    const spelled = [
      "2026-09-24",
      "\u{20BD}ROBLEM",
      "PR\u{3007}BLEM",
      "the problem in the retry path",
      "problem\n\nthe page",
      "\u{26A0}\u{FE0F} Problem: the page",
      "1. Problem: the page",
      "Problem\u{2014}the page",
      "a b c d problem",
      "10. Problem: the page",
      "(a) Problem: the page",
      "the page\n\n\n  \n drops",
      "JJJJ-1642 Problem: the page",
      "Reported by QA\u{2028}Problem: the page",
      "P r o b l e m: the page",
      "Pro blem: the page",
      "JJJJ-1642:P r o b l e m\u{2014}users",
      "P r \u{043E} b l \u{0435} m",
      "P. R. O. B. L. E. M.",
      "P\nr\no\nb\nl\ne\nm",
      "only requests under <p95 latency",
      "P r \u{3007} b l e m",
      "P..R..O..B..L..E..M",
    ].map((text) => spelling({ text }));
    expect(spelled.map((cell) => [carriesProblem({ spelled: cell }), namesProblem({ spelled: cell })])).toStrictEqual([
      [false, false],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [false, false],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, false],
      [true, true],
      [false, true],
    ]);
  });

  // `7.0.138` is one real bump's version, spelled `**O*LEB`: four look-alikes and no letter.
  it("never reads Problem off a number spelled only of look-alikes, while a label with a letter of its own still reads", () => {
    const spelled = [
      "7.0.138",
      "`7.0.138` → `7.0.139`",
      "0.2.136",
      "0.3.128",
      "2908134",
      "PRO8L3M",
      "PR0813M",
      "pr0813m",
      "\u{2117}\u{00AE}08I3\u{20A5}",
    ].map((text) => spelling({ text }));
    expect(spelled[0]).toBe(`${ANY_MARK}${ANY_MARK}O${ANY_MARK}LEB`);
    expect(spelled.map((cell) => [carriesProblem({ spelled: cell }), namesProblem({ spelled: cell })])).toStrictEqual([
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(spelled.at(-1)).toBe(`PROBlE${ANY_MARK}`);
  });

  it("never lets a dash or a connector stand in for a letter, while a label it splits still reads", () => {
    const spelled = [
      "Re-import",
      "re_import",
      "Re\u{2013}import",
      "Re\u{2011}import",
      "prettier-plugin-organize-imports",
      "Pro-blem",
      "P_r_o_b_l_e_m",
      "Problem\u{2014}the page",
      "Prob\u{FE31}em",
      "Prob\u{FE33}em",
      "Prob\u{2E5D}em",
    ].map((text) => spelling({ text }));
    expect(spelled.map((cell) => [carriesProblem({ spelled: cell }), namesProblem({ spelled: cell })])).toStrictEqual([
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(spelled.slice(-3)).toStrictEqual(["probLem", "probLem", `prob${ANY_MARK}em`]);
  });

  it("folds case, marks, compatibility forms and look-alike digits, keeps one space, and marks a sign or a digit", () => {
    const texts = ["Pr\u{00F6}b-lem!", "\u{1D40F}ROBIEM", "PRO8L3M", "a\u{200B}b c"];
    expect(texts.map((text) => spelling({ text }))).toStrictEqual([
      `prob lem${ANY_MARK}`,
      "problem",
      "proBlEm",
      "ab c",
    ]);
  });

  it("writes any other letter or symbol as a letter it could be", () => {
    const texts = ["Pr\u{043E}blem", "\u{1F17F}x", "\u{1D18}"];
    expect(texts.map((text) => spelling({ text }))).toStrictEqual([
      `pr${ANY_LETTER}blem`,
      `${ANY_LETTER}x`,
      ANY_LETTER,
    ]);
  });
});
