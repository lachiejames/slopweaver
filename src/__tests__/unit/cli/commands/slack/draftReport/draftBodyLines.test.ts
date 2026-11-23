/*
 * `draftBodyLines`: the body `slack draft` prints is the exact bytes a release would post, drawn through the
 * poster's own preview renderer, and the plain escape hatch keeps its own bytes.
 */
import { describe, expect, it } from "vitest";

import { draftBodyLines } from "../../../../../../outbound/slack/draftText.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";
import { RICH } from "./harness.js";

describe("draftBodyLines", () => {
  it("draws the blocks through the poster's own preview renderer, list marker included", () => {
    expect(draftBodyLines({ payload: RICH })).toEqual(["Four groups, one question.", "• Everyone"]);
  });

  it("gives the plain escape hatch its own bytes, one line each", () => {
    const plain: SlackDripMessagePayload = {
      form: "plain",
      text: "one\ntwo",
      unfurl_links: false,
      unfurl_media: false,
    };
    expect(draftBodyLines({ payload: plain })).toEqual(["one", "two"]);
  });
});
