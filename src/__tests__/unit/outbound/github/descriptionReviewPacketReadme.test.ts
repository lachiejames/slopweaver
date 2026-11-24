/**
 * The packet README a description reviewer reads: the base README, then the section naming which tree `rules/` came
 * from, then the closed section when `github attach upload` is not permitted, so the reviewer never asks the author
 * for a picture that cannot be supplied.
 */
import { describe, expect, it } from "vitest";

import {
  ATTACH_UPLOAD_CLOSED_SECTION,
  DESCRIPTION_REVIEW_PACKET_README,
  descriptionReviewPacketReadme,
  rulesProvenanceSection,
} from "../../../../outbound/github/descriptionReviewTypes.js";

const INSTALLED = { kind: "installed" } as const;
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const HEAD = { headRef: "feature/rule`edit", headSha: HEAD_SHA, kind: "head" } as const;

describe("descriptionReviewPacketReadme", () => {
  it("is the base README then the provenance section when attach upload is permitted", () => {
    expect(descriptionReviewPacketReadme({ attachUploadPermitted: true, rulesOrigin: INSTALLED })).toBe(
      [DESCRIPTION_REVIEW_PACKET_README, ...rulesProvenanceSection({ rulesOrigin: INSTALLED })].join("\n"),
    );
  });

  it("appends the closed section after the provenance section when attach upload is not permitted", () => {
    const readme = descriptionReviewPacketReadme({ attachUploadPermitted: false, rulesOrigin: HEAD });
    const opening = [DESCRIPTION_REVIEW_PACKET_README, ...rulesProvenanceSection({ rulesOrigin: HEAD })].join("\n");
    expect([readme.startsWith(opening), readme.slice(opening.length)]).toEqual([
      true,
      `\n${ATTACH_UPLOAD_CLOSED_SECTION.join("\n")}`,
    ]);
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

describe("rulesProvenanceSection", () => {
  it("names the head ref JSON-quoted and its full commit, so a backtick in the ref cannot break the markdown", () => {
    expect(rulesProvenanceSection({ rulesOrigin: HEAD })).toEqual([
      "## Where `rules/` came from",
      "",
      `\`rules/\` was read from the head under review, ref "feature/rule\`edit" at commit ${HEAD_SHA}, so a rule the change set edits is judged as edited.`,
      "",
    ]);
  });

  it("names the installed tree without any local path", () => {
    expect(rulesProvenanceSection({ rulesOrigin: INSTALLED })).toEqual([
      "## Where `rules/` came from",
      "",
      "`rules/` was read from the installed tree of the CLI that prepared this packet, because the repository under review does not carry them.",
      "",
    ]);
  });
});
