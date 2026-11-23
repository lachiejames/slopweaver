/**
 * The `profile` noun's manifest: the bare noun and `show` share one read-only entry, `words` and `guidance` also read only, and
 * every other verb is `local-state`. `set`, `person` and `harvest` REQUIRE a flag and refuse a bare run before any
 * read; the rest act on a bare run. `hook` parses nothing, so even an unknown flag runs its load. The three usage
 * strings the manifest quotes are the literal-only leaf constants the commands print. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { PROFILE_STANDING_USAGE } from "../../../../cli/commands/profile/standingUsage.js";
import { PROFILE_STEERS_USAGE } from "../../../../cli/commands/profile/steersUsage.js";
import { PROFILE_WORDS_USAGE } from "../../../../cli/commands/profile/wordsUsage.js";
import { profileManifest } from "../../../../cli/manifests/profile.js";

import { classificationsOf } from "./_classification.js";

describe("profileManifest", () => {
  it("declares exactly the bare noun plus eleven verbs", () => {
    expect(Object.keys(profileManifest).toSorted()).toEqual([
      "",
      "context",
      "guidance",
      "harvest",
      "hook",
      "person",
      "set",
      "show",
      "standing",
      "steers",
      "voice",
      "words",
    ]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: profileManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      context: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      guidance: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      harvest: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      hook: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      person: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      set: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      show: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      standing: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      steers: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      voice: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      words: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("quotes the standing, steers and words usage leaves by identity", () => {
    expect(profileManifest["standing"]!.meta.usage).toBe(PROFILE_STANDING_USAGE);
    expect(profileManifest["steers"]!.meta.usage).toBe(PROFILE_STEERS_USAGE);
    expect(profileManifest["words"]!.meta.usage).toBe(PROFILE_WORDS_USAGE);
  });
});
