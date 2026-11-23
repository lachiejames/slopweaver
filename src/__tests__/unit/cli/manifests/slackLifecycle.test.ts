/**
 * `slack correct`, `delete` and `edit` in `cli/manifests/slackLifecycle.ts` quote their usage from the leaf the commands
 * print, declare a door-routed external write, and are placed into the slack noun unchanged and in the key order the
 * noun held before they were split out.
 */
import { describe, expect, it } from "vitest";

import { CORRECT_USAGE, DELETE_USAGE, EDIT_USAGE } from "../../../../cli/commands/slack/slackUsage.js";
import { slackManifest } from "../../../../cli/manifests/slack.js";
import { slackCorrectVerb, slackDeleteVerb, slackEditVerb } from "../../../../cli/manifests/slackLifecycle.js";

const LIFECYCLE = { correct: slackCorrectVerb, delete: slackDeleteVerb, edit: slackEditVerb } as const;

describe("slack lifecycle verbs", () => {
  it("quotes each verb's usage from the leaf, so the manifest and --help cannot drift", () => {
    expect([slackCorrectVerb.meta.usage, slackDeleteVerb.meta.usage, slackEditVerb.meta.usage]).toEqual([
      CORRECT_USAGE,
      DELETE_USAGE,
      EDIT_USAGE,
    ]);
  });

  it.each(["correct", "delete", "edit"] as const)(
    "declares %s a door-routed external write, placed into the slack noun",
    (verb) => {
      expect([LIFECYCLE[verb].meta.effect, LIFECYCLE[verb].meta.doorRouted]).toEqual(["external-write", true]);
      expect(slackManifest[verb]).toStrictEqual(LIFECYCLE[verb]);
    },
  );

  it("keeps delete before dm and edit after it, where they stood before the split, with correct beside them", () => {
    const order = Object.keys(slackManifest).filter((verb) =>
      ["channel", "correct", "delete", "dm", "edit"].includes(verb),
    );
    expect(order).toEqual(["channel", "correct", "delete", "dm", "edit"]);
  });
});
