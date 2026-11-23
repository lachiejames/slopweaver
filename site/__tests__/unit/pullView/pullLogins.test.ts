/*
 * The people the pull-request view names, and the pictures a body embeds.
 */

import { describe, expect, it } from "vitest";

import { pictureCount, pullLogins } from "../../../lib/pullView";
import { VIEW } from "./harness";

describe("pullLogins and pictureCount", () => {
  it("names every person once, the author first", () => {
    expect(pullLogins({ view: VIEW })).toEqual(["author", "dave", "bob", "carol"]);
  });

  it("counts both ways a body embeds a picture", () => {
    expect(pictureCount({ body: '![a](x) and <img src="y"> and <IMG src="z">' })).toBe(3);
    expect(pictureCount({ body: "no pictures, just [a link](x)" })).toBe(0);
  });

  it("does not count a shields badge, which the page draws from its own address", () => {
    const body =
      '<a href="#risk"><img src="https://img.shields.io/badge/risk-unchecked-dbab09?style=flat" alt="risk: unchecked"></a> ' +
      "![solved](https://img.shields.io/badge/solved-silver-9ea7ad) " +
      '<img src="https://github.com/user-attachments/assets/aaa84994" alt="a screenshot">';
    expect(pictureCount({ body })).toBe(1);
  });
});
