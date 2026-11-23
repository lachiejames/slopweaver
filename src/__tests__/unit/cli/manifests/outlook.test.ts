/**
 * The `outlook` noun's manifest in `cli/manifests/outlook.ts`: pins the verb set, each verb's six classification
 * fields, and that every verb's example and usage line name that verb. The five mailbox-changing verbs are
 * door-routed external writes, the reads are external reads, and `connect` and `attachment` only write local state.
 */
import { describe, expect, it } from "vitest";

import { outlookManifest } from "../../../../cli/manifests/outlook.js";
import { classificationsOf } from "./_classification.js";

describe("outlookManifest", () => {
  it("declares exactly these verbs", () => {
    expect(Object.keys(outlookManifest).toSorted()).toEqual([
      "archive",
      "attachment",
      "categories",
      "category",
      "connect",
      "draft",
      "folders",
      "list",
      "mark",
      "measure",
      "read",
      "send",
      "triage",
    ]);
  });

  it("classifies each verb by its own effect, door, work-item, diagnostic and parse fields", () => {
    const write = {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      parseRejectIsIoFree: true,
    } as const;
    const read = {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      parseRejectIsIoFree: true,
    } as const;

    expect(classificationsOf({ manifest: outlookManifest })).toEqual({
      archive: write,
      attachment: { ...read, dryParseSafe: true, effect: "local-state" },
      categories: read,
      category: write,
      connect: { ...read, effect: "local-state" },
      draft: write,
      folders: read,
      list: read,
      mark: write,
      measure: read,
      read: { ...read, dryParseSafe: true },
      send: write,
      triage: read,
    });
  });

  it("gives every verb an example that runs that verb", () => {
    const verbs = Object.keys(outlookManifest);

    const notRunning = verbs.filter(
      (verb) => !outlookManifest[verb]!.meta.example!.includes(`slopweaver outlook ${verb}`),
    );
    const notLeading = verbs.filter(
      (verb) => !outlookManifest[verb]!.meta.example!.startsWith(`slopweaver outlook ${verb}`),
    );

    expect(verbs.length).toBeGreaterThan(0);
    expect(notRunning).toEqual([]);
    // `draft` takes its form on stdin, so its example pipes into the verb instead of leading with it.
    expect(notLeading).toEqual(["draft"]);
  });

  it("gives every verb a usage line naming that verb", () => {
    const verbs = Object.keys(outlookManifest);

    const wrong = verbs.filter(
      (verb) => !outlookManifest[verb]!.meta.usage.startsWith(`usage: slopweaver outlook ${verb} `),
    );

    expect(wrong).toEqual([]);
  });

  it("gives every verb a non-empty summary", () => {
    const summaries = Object.values(outlookManifest).map((entry) => entry.meta.summary);

    expect(summaries.length).toBe(13);
    expect(summaries.filter((summary) => summary.length === 0)).toEqual([]);
  });
});
