/**
 * The packet README a description reviewer reads: unchanged when `github attach upload` is permitted, and carrying the
 * closed section when it is not, so the reviewer never asks the author for a picture that cannot be supplied.
 */
import { describe, expect, it } from "vitest";

import {
  ATTACH_UPLOAD_CLOSED_SECTION,
  DESCRIPTION_REVIEW_PACKET_README,
  descriptionReviewPacketReadme,
} from "../../../../outbound/github/descriptionReviewTypes.js";

describe("descriptionReviewPacketReadme", () => {
  it("is the base README exactly when attach upload is permitted", () => {
    expect(descriptionReviewPacketReadme({ attachUploadPermitted: true })).toBe(DESCRIPTION_REVIEW_PACKET_README);
  });

  it("appends the closed section after the base README when attach upload is not permitted", () => {
    const readme = descriptionReviewPacketReadme({ attachUploadPermitted: false });
    expect([
      readme.startsWith(DESCRIPTION_REVIEW_PACKET_README),
      readme.slice(DESCRIPTION_REVIEW_PACKET_README.length),
    ]).toEqual([true, `\n${ATTACH_UPLOAD_CLOSED_SECTION.join("\n")}`]);
  });

  it("calls a local picture honest, forbids asking for one, and excuses no other claim", () => {
    const section = ATTACH_UPLOAD_CLOSED_SECTION.join(" ");
    expect([
      section.includes("Proof that says its picture stays local is an honest reading"),
      section.includes("Never ask the author to attach, upload or embed a picture"),
      section.includes("Every other claim is still judged on the text and the change set"),
      section.includes("unit tests"),
    ]).toEqual([true, true, true, false]);
  });
});
