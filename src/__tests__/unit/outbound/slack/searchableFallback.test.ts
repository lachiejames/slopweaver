import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../outbound/artifact/types.js";
import { renderFullChromeWrapper, renderUpdateCard } from "../../../../outbound/slack/render.js";
import { githubRefsInBlocks, searchableFallback } from "../../../../outbound/slack/searchableFallback.js";
import type { SlackCardChrome } from "../../../../outbound/slack/types.js";

const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

const PR = "https://github.com/acme/widgets/pull/17344";

/** The shape the ISO answer carried: the PR reachable only through a `[1]` chip whose URL is the one place its number lives. */
function citedArtifact(): UpdateArtifact {
  return {
    citations: [{ id: "c1", label: "[1]", url: PR }],
    detail: [
      {
        runs: [
          { text: "draft PR ", type: "text" },
          { citationId: "c1", type: "citation" },
          { text: " adds the alert policies", type: "text" },
        ],
        type: "paragraph",
      },
    ],
    index: [],
    kind: "update",
    media: [],
    tldr: "went the IaC route",
  };
}

describe("githubRefsInBlocks", () => {
  it("reads a link run's url, a mrkdwn link and an issue, in first-seen order, each once", () => {
    const blocks = [
      {
        elements: [{ elements: [{ text: "[1]", type: "link", url: PR }], type: "rich_text_section" }],
        type: "rich_text",
      },
      { elements: [{ text: "<https://github.com/acme/api/issues/9|the ticket>", type: "mrkdwn" }], type: "context" },
      {
        elements: [{ elements: [{ text: "again", type: "link", url: `${PR}/files` }], type: "rich_text_section" }],
        type: "rich_text",
      },
    ];

    expect(githubRefsInBlocks({ blocks })).toEqual(["acme/widgets#17344", "acme/api#9"]);
  });

  it("finds nothing in blocks that link no GitHub object", () => {
    const blocks = [{ elements: [{ text: "<https://example.invalid/x|x>", type: "mrkdwn" }], type: "context" }];

    expect(githubRefsInBlocks({ blocks })).toEqual([]);
  });
});

describe("searchableFallback", () => {
  it("appends each cited reference on a line under the untouched TL;DR", () => {
    const blocks = [{ elements: [{ text: "[1]", type: "link", url: PR }], type: "rich_text_section" }];

    expect(searchableFallback({ blocks, fallback: "went the IaC route" })).toBe(
      "went the IaC route\nacme/widgets#17344",
    );
  });

  it("returns the fallback byte for byte when the blocks link no GitHub object", () => {
    expect(searchableFallback({ blocks: [], fallback: "A short lead." })).toBe("A short lead.");
  });

  it("does not repeat a reference the fallback already spells", () => {
    const blocks = [{ text: PR, type: "link", url: PR }];

    expect(searchableFallback({ blocks, fallback: "closing acme/widgets#17344" })).toBe("closing acme/widgets#17344");
  });

  it("still appends a reference that the fallback only contains inside a longer one", () => {
    const shorter = [{ text: "[1]", type: "link", url: "https://github.com/acme/widgets/pull/1734" }];
    const otherOwner = [{ text: "[1]", type: "link", url: "https://github.com/acme/widgets/pull/9" }];

    expect(searchableFallback({ blocks: shorter, fallback: "closing acme/widgets#17344" })).toBe(
      "closing acme/widgets#17344\nacme/widgets#1734",
    );
    expect(searchableFallback({ blocks: otherOwner, fallback: "see bigacme/widgets#9" })).toBe(
      "see bigacme/widgets#9\nacme/widgets#9",
    );
    expect(searchableFallback({ blocks: otherOwner, fallback: "see acme/widgets#9a" })).toBe(
      "see acme/widgets#9a\nacme/widgets#9",
    );
  });

  it("reads a repository whose name opens on a dot", () => {
    const blocks = [{ text: "[1]", type: "link", url: "https://github.com/acme/.github/pull/3" }];

    expect(searchableFallback({ blocks, fallback: "lead" })).toBe("lead\nacme/.github#3");
  });
});

describe("every wrapper constructor carries the cited references", () => {
  it("renderUpdateCard puts a citation chip's PR into the fallback", () => {
    const payload = renderUpdateCard({
      artifact: citedArtifact(),
      artifactFingerprint: "fp-1",
      chrome: CHROME,
      mentions: { groups: new Map(), people: new Map() },
    });

    expect(payload.attachments[0].fallback).toBe("went the IaC route\nacme/widgets#17344");
  });

  it("renderFullChromeWrapper puts a detail block's PR into the fallback", () => {
    const wrapper = renderFullChromeWrapper({
      chrome: CHROME,
      content: {
        elements: [{ elements: [{ text: "lead", type: "text" }], type: "rich_text_section" }],
        type: "rich_text",
      },
      details: [{ elements: [{ text: `<${PR}|the PR>`, type: "mrkdwn" }], type: "context" }],
      fallback: "lead",
    });

    expect(wrapper.fallback).toBe("lead\nacme/widgets#17344");
  });
});
