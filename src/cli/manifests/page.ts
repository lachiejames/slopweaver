/**
 * Lazy manifest for the `page` noun — the LOCAL page a session ends in.
 *
 * Publishing a Claude artifact is impossible by design. That rule is only
 * safe because this verb exists — a session's last step used to be a publish that supplied a document shell,
 * kept the bytes and handed back an address, and `publish` is all three, in the local store, bound to no account.
 *
 * `read` is a verb because a page lives in the store's Storage, not a file a read could open: the console's page route
 * asks it for every file a page serves, signed (`../../store/publishedPages/presentation.ts`). There is deliberately
 * no `page delete`. `export` writes one page out of the store as a single file, once, to the path its caller names:
 * the desktop's Reveal in Finder, since the store keeps no copy on disk to reveal. `tag` is a verb because no file operation can
 * tie a page to the meeting it prepares the owner for (`../../pages/meetingTag.ts`). `find` is one because a listing
 * cannot turn what the owner SAID into a slug: the console voice listed 429 untitled directories
 * alphabetically, never reached the page they described, and asked the owner for its link (`../../pages/find.ts`).
 */
import {
  PAGE_EXPORT_USAGE,
  PAGE_FIND_USAGE,
  PAGE_PUBLISH_USAGE,
  PAGE_READ_USAGE,
  PAGE_REVIEW_PREPARE_USAGE,
  PAGE_TAG_USAGE,
} from "../commands/page/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const pageManifest: Readonly<Record<string, VerbManifestEntry>> = {
  publish: lazy({
    load: () => import("../commands/page/publishRun.js").then((m) => m.pagePublishCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver page publish queue-decision --page ./scratchpad/queue-decision.html --review 4f1c2a9e-0b7d-4e55-9a31-2c8d6e0f7b14",
      parseRejectIsIoFree: true,
      summary:
        "Publish one reviewed fragment as a complete page into the store, its only copy, with its review record folded in, its exact bytes frozen and its images read from --assets-from, and print the address to give the owner",
      usage: PAGE_PUBLISH_USAGE,
    },
  }),
  "review-prepare": lazy({
    load: () => import("../commands/page/reviewPrepareRun.js").then((m) => m.pageReviewPrepareCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver page review-prepare queue-decision --page ./scratchpad/queue-decision.html --inputs ./scratchpad/owner-words.md",
      parseRejectIsIoFree: true,
      summary:
        "Commit a page and the inputs it answers to into a review repository, and print the Codex review, its capped fallback and the publish that cites it",
      usage: PAGE_REVIEW_PREPARE_USAGE,
    },
  }),
  find: lazy({
    load: () => import("../commands/page/findRun.js").then((m) => m.pageFindCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver page find twenty potential icons --json",
      parseRejectIsIoFree: true,
      summary:
        "The owner's published pages with their titles, newest first or ranked against the words they used, so a page they describe can be opened by its slug",
      usage: PAGE_FIND_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/page/readRun.js").then((m) => m.pageReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver page read queue-decision --presentation --json",
      parseRejectIsIoFree: true,
      summary:
        "Every file one published page serves, each with a short-lived signed read address from the store, so the console can show a page held only there",
      usage: PAGE_READ_USAGE,
    },
  }),
  export: lazy({
    load: () => import("../commands/page/exportRun.js").then((m) => m.pageExportCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver page export queue-decision --out /tmp/reveal/queue-decision.html --json",
      parseRejectIsIoFree: true,
      summary:
        "Write one published page out of the store as a single file carrying its own images, once, to a path the caller names, so it can be dragged into Slack",
      usage: PAGE_EXPORT_USAGE,
    },
  }),
  tag: lazy({
    load: () => import("../commands/page/tagRun.js").then((m) => m.pageTagCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver page tag tobias-one-on-one-2-oct --meeting 6h1s9r0k4p2m8n3q_20261002T050000Z",
      parseRejectIsIoFree: true,
      summary:
        "Tie a published page to the one calendar meeting it prepares the owner for, so it floats in front of them in the hour before",
      usage: PAGE_TAG_USAGE,
    },
  }),
};
