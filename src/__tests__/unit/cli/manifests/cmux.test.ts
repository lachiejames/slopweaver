/**
 * The `cmux` noun's manifest in `cli/manifests/cmux.ts`: pins the verb set and each verb's six classification fields.
 * Most verbs act on a local application and are `local-state`; `list`, `picture`, `processes`, `read-screen` and
 * `usage` are diagnostic `external-read`s, `templates` is a diagnostic `none`, and `events` and `spawn` are the
 * diagnostic `local-state`s — `events` because each drain files its cursor. `dialog`, `events`, `list`, `picture`,
 * `pin`, `revive`, `status`, `strands`, `takeover`, `templates`, `todo`, `unpin` and `usage` act on a bare run, so none
 * of them is dry-parse safe,
 * and `spawn` is the one row whose parse refusals are not I/O-free.
 * Usage strings are inline and not copied here.
 */
import { describe, expect, it } from "vitest";

import { cmuxManifest } from "../../../../cli/manifests/cmux.js";
import { classificationsOf } from "./_classification.js";

describe("cmuxManifest", () => {
  it("declares exactly these verbs", () => {
    expect(Object.keys(cmuxManifest).toSorted()).toEqual([
      "close",
      "dialog",
      "events",
      "list",
      "picture",
      "pin",
      "processes",
      "read-screen",
      "reseat",
      "revive",
      "send",
      "spawn",
      "stop",
      "strands",
      "submit",
      "takeover",
      "templates",
      "title",
      "unpin",
      "usage",
    ]);
  });

  it("classifies each verb by its own effect and diagnostic fields", () => {
    expect(classificationsOf({ manifest: cmuxManifest })).toEqual({
      close: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      dialog: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      events: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      picture: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      pin: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      processes: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      "read-screen": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      reseat: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      revive: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      send: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      spawn: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      stop: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      strands: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      submit: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      takeover: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      templates: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      title: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      unpin: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      usage: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
    });
  });
});
