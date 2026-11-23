/**
 * The `linear` noun's manifest rows in `cli/manifests/linear.ts` quote their usage from a leaf module rather than from
 * the command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { LINEAR_ATTACH_USAGE } from "../../../../cli/commands/linear/attachUsage.js";
import { LINEAR_BRIEFING_USAGE } from "../../../../cli/commands/linear/briefingUsage.js";
import { LINEAR_DOCUMENT_FLAG_NAMES } from "../../../../cli/commands/linear/documentCore.js";
import { LINEAR_DOCUMENT_USAGE } from "../../../../cli/commands/linear/documentUsage.js";
import { LINEAR_ISSUES_USAGE } from "../../../../cli/commands/linear/issuesUsage.js";
import { LINEAR_LABEL_FLAG_NAMES } from "../../../../cli/commands/linear/labelCore.js";
import { LINEAR_LABELS_FLAG_NAMES } from "../../../../cli/commands/linear/labelsCore.js";
import { LINEAR_LABELS_USAGE } from "../../../../cli/commands/linear/labelsUsage.js";
import { LINEAR_LABEL_USAGE } from "../../../../cli/commands/linear/labelUsage.js";
import { LINEAR_MOVE_ISSUES_USAGE } from "../../../../cli/commands/linear/moveIssuesUsage.js";
import { LINEAR_PROJECT_USAGE } from "../../../../cli/commands/linear/projectUsage.js";
import { LINEAR_TEAM_MEMBERSHIP_USAGE } from "../../../../cli/commands/linear/teamMembershipUsage.js";
import { linearManifest } from "../../../../cli/manifests/linear.js";
import { linearBriefingManifest } from "../../../../cli/manifests/linearBriefing.js";
import { linearDocumentManifest } from "../../../../cli/manifests/linearDocument.js";
import { linearInitiativeManifest } from "../../../../cli/manifests/linearInitiative.js";
import { linearIssuesManifest } from "../../../../cli/manifests/linearIssues.js";
import { linearLabelManifest } from "../../../../cli/manifests/linearLabel.js";

describe("linearManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(linearManifest["attach"]!.meta.usage).toBe(LINEAR_ATTACH_USAGE);
    expect(linearManifest["team-membership"]!.meta.usage).toBe(LINEAR_TEAM_MEMBERSHIP_USAGE);
    expect(linearManifest["project"]!.meta.usage).toBe(LINEAR_PROJECT_USAGE);
    expect(linearManifest["label"]!.meta.usage).toBe(LINEAR_LABEL_USAGE);
    expect(linearManifest["labels"]!.meta.usage).toBe(LINEAR_LABELS_USAGE);
  });

  it("names every flag `linear label` and `linear labels` accept in their usage", () => {
    const missing = [
      ...LINEAR_LABEL_FLAG_NAMES.filter((flag) => !LINEAR_LABEL_USAGE.includes(flag)),
      ...LINEAR_LABELS_FLAG_NAMES.filter((flag) => !LINEAR_LABELS_USAGE.includes(flag)),
    ];

    expect(LINEAR_LABEL_FLAG_NAMES.length).toBeGreaterThan(0);
    expect(LINEAR_LABELS_FLAG_NAMES.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("spreads the `label` and `labels` rows in from their own manifest file, unchanged", () => {
    expect(linearManifest["label"]).toBe(linearLabelManifest["label"]);
    expect(linearManifest["labels"]).toBe(linearLabelManifest["labels"]);
  });

  it("routes the label write through the door and leaves the label read outside it", () => {
    expect(linearManifest["label"]!.meta.effect).toBe("external-write");
    expect(linearManifest["label"]!.meta.doorRouted).toBe(true);
    expect(linearManifest["labels"]!.meta.effect).toBe("external-read");
    expect(linearManifest["labels"]!.meta.doorRouted).toBe(false);
  });

  it("spreads the `document` row in from its own manifest file, unchanged", () => {
    expect(linearManifest["document"]).toBe(linearDocumentManifest["document"]);
    expect(linearDocumentManifest["document"]!.meta.usage).toBe(LINEAR_DOCUMENT_USAGE);
  });

  it("spreads the `issues` row in from its own manifest file, a live read the door does not route", () => {
    expect(linearManifest["issues"]).toBe(linearIssuesManifest["issues"]);
    expect(linearIssuesManifest["issues"]!.meta.usage).toBe(LINEAR_ISSUES_USAGE);
    expect(linearIssuesManifest["issues"]!.meta.effect).toBe("external-read");
    expect(linearIssuesManifest["issues"]!.meta.doorRouted).toBe(false);
  });

  it("spreads the `move-issues` row in from the issues manifest, a door-routed write quoting its own leaf", () => {
    expect(linearManifest["move-issues"]).toBe(linearIssuesManifest["move-issues"]);
    expect(linearIssuesManifest["move-issues"]!.meta.usage).toBe(LINEAR_MOVE_ISSUES_USAGE);
    expect(linearIssuesManifest["move-issues"]!.meta.effect).toBe("external-write");
    expect(linearIssuesManifest["move-issues"]!.meta.doorRouted).toBe(true);
  });

  it("spreads the `briefing` row in from its own manifest file, a local write that reaches no provider", () => {
    expect(linearManifest["briefing"]).toBe(linearBriefingManifest["briefing"]);
    expect(linearBriefingManifest["briefing"]!.meta.usage).toBe(LINEAR_BRIEFING_USAGE);
    expect(linearBriefingManifest["briefing"]!.meta.effect).toBe("local-state");
    expect(linearBriefingManifest["briefing"]!.meta.doorRouted).toBe(false);
  });

  it("spreads the `initiative` and `initiative-update` rows in from their own manifest file, both door-routed", () => {
    expect(linearManifest["initiative"]).toBe(linearInitiativeManifest["initiative"]);
    expect(linearManifest["initiative-update"]).toBe(linearInitiativeManifest["initiative-update"]);
    expect(linearInitiativeManifest["initiative"]!.meta.doorRouted).toBe(true);
    expect(linearInitiativeManifest["initiative-update"]!.meta.doorRouted).toBe(true);
  });

  it("tells a reader of `linear issues` that a walk is not a snapshot", () => {
    expect(LINEAR_ISSUES_USAGE).toContain("A walk is not a snapshot");
  });

  it("names every flag `linear document` accepts in its usage", () => {
    const missing = LINEAR_DOCUMENT_FLAG_NAMES.filter((flag) => !LINEAR_DOCUMENT_USAGE.includes(flag));

    expect(LINEAR_DOCUMENT_FLAG_NAMES.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
