import { describe, expect, it } from "vitest";

import { buildResyncPolicies, findResyncPolicy } from "../../../../live/resync/policy.js";

const HOUR = 60 * 60 * 1000;

/** A source that resolves its own subject from a credential, so it names nothing on the command line. */
const NONE = { kind: "none" } as const;

/** A source that must name the organisation it crawls — github, and only github. */
const ORG = { kind: "org", org: "acme" } as const;

describe("buildResyncPolicies", () => {
  it("gives every atlas and every corpus source its own row, sorted by recipe id", () => {
    const roster = buildResyncPolicies({
      atlases: [
        { platform: "trelica", resyncCommand: "slopweaver atlas trelica refresh", seated: true, windowMs: 4 * HOUR },
        { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
      ],
      corpus: [{ source: "notion", subject: NONE, windowMs: 4 * HOUR }],
    });
    expect(roster.problems).toEqual([]);
    expect(roster.policies.map((policy) => policy.recipeId)).toEqual([
      "resync-atlas-airtable",
      "resync-atlas-trelica",
      "resync-corpus-notion",
    ]);
  });

  it("keeps an atlas and a corpus source of the SAME name on two rows and two clocks", () => {
    const roster = buildResyncPolicies({
      atlases: [
        { platform: "github", resyncCommand: "slopweaver atlas github sync", seated: true, windowMs: 4 * HOUR },
      ],
      corpus: [{ source: "github", subject: ORG, windowMs: 4 * HOUR }],
    });
    expect(roster.policies.map((policy) => policy.recipeId)).toEqual(["resync-atlas-github", "resync-corpus-github"]);
  });

  it("carries a compound atlas command as two ordered steps", () => {
    const roster = buildResyncPolicies({
      atlases: [
        {
          platform: "clerk",
          resyncCommand: "slopweaver atlas clerk sync && slopweaver atlas clerk walk",
          seated: true,
          windowMs: 4 * HOUR,
        },
      ],
      corpus: [],
    });
    expect(roster.policies[0]!.steps).toEqual([
      { argv: ["atlas", "clerk", "sync"] },
      { argv: ["atlas", "clerk", "walk"] },
    ]);
  });

  it("gives a corpus source the refresh command with its own source named AND the store leg", () => {
    const roster = buildResyncPolicies({
      atlases: [],
      corpus: [{ source: "slack", subject: NONE, windowMs: 4 * HOUR }],
    });
    expect(roster.policies[0]!.steps).toEqual([{ argv: ["refresh", "--source", "slack", "--store"] }]);
  });

  it("names the organisation on one org-mode step, so no cwd is ever consulted", () => {
    const roster = buildResyncPolicies({
      atlases: [],
      corpus: [{ source: "github", subject: ORG, windowMs: 4 * HOUR }],
    });
    expect(roster.problems).toEqual([]);
    expect(roster.policies[0]!.steps).toEqual([
      { argv: ["refresh", "--source", "github", "--store", "--all-repos", "--github-org", "acme"] },
    ]);
  });

  it("never leaves an org-subject source on the bare argv a scheduled pass refuses", () => {
    // The falsifiable witness for the finding. `refresh --source github --store` with nothing
    // named exits non-zero from any cwd under $SLOPWEAVER_HOME, which is every scheduled pass's cwd.
    // Reproduce the refusal itself with:
    //   cd "$SLOPWEAVER_HOME/.claude/worktrees.noindex/recipe-scheduler-"* && slopweaver refresh --source github --store
    // Both halves are asserted: the bare argv is absent AND the org-mode one is present, so a change that
    // dropped the step entirely reddens rather than passing on the absence.
    const bare = { argv: ["refresh", "--source", "github", "--store"] };
    const roster = buildResyncPolicies({
      atlases: [],
      corpus: [{ source: "github", subject: ORG, windowMs: 4 * HOUR }],
    });
    const everyStep = roster.policies.flatMap((policy) => policy.steps);
    expect(everyStep).toContainEqual({
      argv: ["refresh", "--source", "github", "--store", "--all-repos", "--github-org", "acme"],
    });
    expect(everyStep).not.toContainEqual(bare);
  });

  it("leaves a credential-addressed source on the bare argv, unchanged by org mode", () => {
    const roster = buildResyncPolicies({
      atlases: [],
      corpus: [
        { source: "github", subject: ORG, windowMs: 4 * HOUR },
        { source: "notion", subject: NONE, windowMs: 4 * HOUR },
      ],
    });
    const notion = roster.policies.find((policy) => policy.recipeId === "resync-corpus-notion")!;
    expect(notion.steps).toEqual([{ argv: ["refresh", "--source", "notion", "--store"] }]);
  });

  it("gives an export-fed source its own sync step, seated like every corpus row", () => {
    // A bare refresh would only re-read the export already held; `chatgpt sync` takes a newer one in first.
    const roster = buildResyncPolicies({
      atlases: [],
      corpus: [{ source: "chatgpt", subject: { kind: "export" }, windowMs: 24 * HOUR }],
    });
    expect(roster.problems).toEqual([]);
    expect(roster.policies[0]!.recipeId).toBe("resync-corpus-chatgpt");
    expect(roster.policies[0]!.steps).toEqual([{ argv: ["chatgpt", "sync"] }]);
    expect(roster.policies[0]!.seated).toBe(true);
  });
  it("derives each row's cadence from that target's own declared window", () => {
    const roster = buildResyncPolicies({
      atlases: [
        { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
        { platform: "cloudflare", resyncCommand: "slopweaver cloudflare sync", seated: true, windowMs: 48 * HOUR },
      ],
      corpus: [],
    });
    expect(roster.policies.map((policy) => policy.cadence)).toEqual(["0 */4 * * *", "0 0 * * *"]);
  });

  it("notes the capped row and leaves the matching one unannotated", () => {
    const roster = buildResyncPolicies({
      atlases: [
        { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
        { platform: "cloudflare", resyncCommand: "slopweaver cloudflare sync", seated: true, windowMs: 48 * HOUR },
      ],
      corpus: [],
    });
    expect(roster.policies[0]!.note).toBe(null);
    expect(roster.policies[1]!.note).toContain("scheduled daily");
  });

  it("reports one atlas's bad declaration and still builds every other row", () => {
    const roster = buildResyncPolicies({
      atlases: [
        {
          platform: "vanta",
          resyncCommand: "slopweaver atlas vanta evidence --control <id>",
          seated: true,
          windowMs: 4 * HOUR,
        },
        { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
      ],
      corpus: [],
    });
    expect(roster.policies.map((policy) => policy.recipeId)).toEqual(["resync-atlas-airtable"]);
    expect(roster.problems.length).toBe(1);
    expect(roster.problems[0]).toContain("atlas vanta:");
  });

  it("reports a window no cron can express as that target's own problem", () => {
    const roster = buildResyncPolicies({
      atlases: [{ platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 500 }],
      corpus: [],
    });
    expect(roster.policies).toEqual([]);
    expect(roster.problems[0]).toContain("atlas airtable:");
  });

  it("carries whether an atlas needs a seat, and seats every corpus source", () => {
    const roster = buildResyncPolicies({
      atlases: [
        { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: false, windowMs: 4 * HOUR },
        { platform: "jumpcloud", resyncCommand: "slopweaver atlas jumpcloud sync", seated: true, windowMs: 4 * HOUR },
      ],
      corpus: [{ source: "notion", subject: NONE, windowMs: 4 * HOUR }],
    });
    expect(roster.policies.map((policy) => [policy.recipeId, policy.seated])).toEqual([
      ["resync-atlas-airtable", false],
      ["resync-atlas-jumpcloud", true],
      ["resync-corpus-notion", true],
    ]);
  });

  it("schedules a pinned-document window weekly", () => {
    const roster = buildResyncPolicies({
      atlases: [
        { platform: "figma", resyncCommand: "slopweaver atlas figma sync", seated: false, windowMs: 14 * 24 * HOUR },
      ],
      corpus: [],
    });
    expect(roster.policies[0]!.cadence).toBe("0 0 * * 0");
    expect(roster.policies[0]!.note).toContain("scheduled weekly");
  });

  it("builds nothing and reports nothing for an empty estate", () => {
    expect(buildResyncPolicies({ atlases: [], corpus: [] })).toEqual({ policies: [], problems: [] });
  });
});

describe("findResyncPolicy", () => {
  it("finds the one policy a row names", () => {
    const roster = buildResyncPolicies({
      atlases: [
        { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
      ],
      corpus: [],
    });
    expect(findResyncPolicy({ policies: roster.policies, recipeId: "resync-atlas-airtable" })!.cadence).toBe(
      "0 */4 * * *",
    );
  });

  it("answers undefined for a row this build schedules no target for", () => {
    expect(findResyncPolicy({ policies: [], recipeId: "resync-atlas-gone" })).toBe(undefined);
  });
});
