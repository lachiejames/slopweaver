/** The source plan: multi-leg, profile-overlaid and honest about unavailable sources. */
import { describe, expect, it } from "vitest";

import {
  CAPABILITY_PROFILE_SCHEMA_VERSION,
  type CapabilityProfile,
  capabilityProfileSchema,
  QUESTION_COMMAND_TOKEN,
  type SourceCapability,
} from "../../../route/profile.js";
import { buildSourcePlan, sourcePlanSchema } from "../../../route/sourcePlan.js";

/** A generic private-profile row with per-test identity and terms. */
function capability({
  command,
  id,
  terms,
}: {
  command: readonly string[];
  id: string;
  terms: readonly string[];
}): SourceCapability {
  return {
    availability: { kind: "available" },
    command,
    coverage: { detail: "the configured test estate", kind: "bounded" },
    effect: "read",
    freshness: { detail: "measured when called", kind: "live" },
    id,
    owner: "private-console",
    sourceClass: "atlas",
    terms,
    truthMode: "current",
    what: `the ${id} test source`,
  };
}

/** A validated profile fixture, built through the real schema. */
function profile({ capabilities }: { capabilities: readonly SourceCapability[] }): CapabilityProfile {
  return capabilityProfileSchema.parse({ capabilities, schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION });
}

describe("buildSourcePlan", () => {
  it("plans live workstream truth as required and history only as optional context", () => {
    // fleet-status answers a NARROWER question than "my open PRs" in general — the pull request, if any,
    // for each live/waiting orchestration workstream — which is why its terms name the workstream, not the
    // pull request. A generic "what are my open PRs?" is deliberately NOT this capability's terms anymore:
    // that question belongs to a private, repository-scoped capability the generic table cannot name.
    const plan = buildSourcePlan({ question: "is CI still green on my open branch right now?" });

    expect(plan.required.map((leg) => leg.capability.id)).toEqual(["fleet-status"]);
    expect(plan.optional.map((leg) => leg.capability.id)).toEqual(["corpus"]);
  });

  it("does not route a generic open-PRs question to fleet-status — that question is not this capability's", () => {
    const plan = buildSourcePlan({ question: "what are my open PRs?" });

    expect(plan.required.map((leg) => leg.capability.id)).not.toContain("fleet-status");
  });

  it("plans a decision-history question from the world model with no unnecessary live leg", () => {
    const plan = buildSourcePlan({ question: "what did we decide about onboarding?" });

    expect(plan.required.map((leg) => leg.capability.id)).toEqual(["corpus"]);
    expect(plan.optional).toEqual([]);
  });

  it("keeps every matching compliance leg in stable profile order", () => {
    const overlay = profile({
      capabilities: [
        capability({
          command: ["private-console", "compliance", "evidence"],
          id: "compliance-register",
          terms: ["compliance"],
        }),
        capability({
          command: ["private-console", "telemetry", "reach"],
          id: "telemetry-atlas",
          terms: ["compliance"],
        }),
      ],
    });

    const plan = buildSourcePlan({ profile: overlay, question: "check compliance" });

    expect(plan.required.map((leg) => leg.capability.id)).toEqual(["compliance-register", "telemetry-atlas"]);
  });

  it("lets a private profile replace an unavailable generic surface without leaking private identifiers", () => {
    const overlay = profile({
      capabilities: [
        capability({
          command: ["private-console", "telemetry", "reach", "--about", "logs"],
          id: "telemetry",
          terms: ["logs"],
        }),
      ],
    });

    const plan = buildSourcePlan({ profile: overlay, question: "show me the logs" });

    expect(plan.required[0]?.capability).toMatchObject({
      availability: { kind: "available" },
      command: ["private-console", "telemetry", "reach", "--about", "logs"],
      id: "telemetry",
    });
    expect(plan.exclusions).toEqual([
      {
        capabilityId: "telemetry",
        reason: "the slopweaver capability was replaced by the private-console profile capability",
      },
    ]);
  });

  it("materialises the exact question into command argv without mutating the profile template", () => {
    const overlay = profile({
      capabilities: [
        capability({
          command: ["private-console", "telemetry", "reach", "--about", QUESTION_COMMAND_TOKEN],
          id: "telemetry",
          terms: ["logs"],
        }),
      ],
    });

    const plan = buildSourcePlan({ profile: overlay, question: "logs for core-api: failures?" });

    expect(plan.required[0]?.capability.command).toEqual([
      "private-console",
      "telemetry",
      "reach",
      "--about",
      "logs for core-api: failures?",
    ]);
    expect(overlay.capabilities[0]?.command).toEqual([
      "private-console",
      "telemetry",
      "reach",
      "--about",
      QUESTION_COMMAND_TOKEN,
    ]);
  });

  it("keeps a literal question-token phrase inside the materialised question", () => {
    const overlay = profile({
      capabilities: [
        capability({ command: ["private-console", QUESTION_COMMAND_TOKEN], id: "telemetry", terms: ["logs"] }),
      ],
    });

    const plan = buildSourcePlan({ profile: overlay, question: "logs mentioning prefix-{question}" });

    expect(plan.required[0]?.capability.command).toEqual(["private-console", "logs mentioning prefix-{question}"]);
    expect(sourcePlanSchema.safeParse(plan).success).toBe(true);
  });

  it("keeps fixed command argv byte-identical", () => {
    const plan = buildSourcePlan({ question: "is CI still green on my open branch right now?" });

    expect(plan.required[0]?.capability.command).toEqual(["slopweaver", "fleet", "status"]);
  });

  it("replaces only a leading Slopweaver executable with the bundled absolute launcher", () => {
    const overlay = profile({
      capabilities: [
        capability({
          command: ["slopweaver", "github", "read", QUESTION_COMMAND_TOKEN, "--json"],
          id: "github-live",
          terms: ["github"],
        }),
      ],
    });
    const plan = buildSourcePlan({
      profile: overlay,
      question: "read https://github.com/o/r/issues/1",
      slopweaverCommand: "/plugin/bin/slopweaver",
    });

    expect(plan.required[0]?.capability.command).toEqual([
      "/plugin/bin/slopweaver",
      "github",
      "read",
      "read https://github.com/o/r/issues/1",
      "--json",
    ]);
  });

  it("returns the generic leg again when the private capability is removed", () => {
    const plan = buildSourcePlan({ question: "show me the logs" });

    expect(plan.required[0]?.capability).toMatchObject({
      availability: { kind: "available" },
      command: ["slopweaver", "datadog", "verify"],
      id: "telemetry",
    });
    expect(plan.exclusions).toEqual([]);
  });

  // The other half of the same property, kept on a row that is STILL generically unreachable: an
  // installation with no connector for a surface plans that surface as unavailable carrying its reason,
  // rather than dropping it. `telemetry` used to be this case and stopped being one when the row was
  // rewritten around the Datadog verbs this build actually ships.
  it("plans an unreachable generic surface as unavailable, carrying its reason", () => {
    const plan = buildSourcePlan({ question: "did that invoice get paid?" });

    expect(plan.required[0]?.capability.id).toBe("billing");
    expect(plan.required[0]?.capability.availability).toEqual({
      kind: "unavailable",
      reason:
        "Slopweaver has no payment-processor connector; use the installation's governed billing access. " +
        "This row is money RECEIVED and nothing else — what this organisation SPENDS is the `saas-spend` " +
        "row on this same roster, which is reachable",
    });
    expect(plan.required[0]?.capability.command).toEqual([]);
  });

  // The routing the SPEND finding is about, on the keyword path: money OUT must not land on the money-IN
  // row. `billing` was the only row on the table carrying cost vocabulary, so before `saas-spend` existed
  // this question planned an unreachable surface and a worker fell back to a seat-count proxy.
  it("plans a spend question onto `saas-spend`, never onto the unreachable payment-processor row", () => {
    const plan = buildSourcePlan({ question: "how much are we spending on saas subscriptions?" });

    expect(plan.required[0]?.capability.id).toBe("saas-spend");
    expect(plan.required[0]?.capability.availability).toEqual({ kind: "available" });
    expect(plan.required[0]?.capability.command).toEqual(["slopweaver", "atlas", "trelica", "coverage"]);
  });

  it("produces byte-identical plans from identical profile input and round-trips its schema", () => {
    const overlay = profile({
      capabilities: [
        capability({ command: ["private-console", "evidence", "list"], id: "evidence", terms: ["evidence"] }),
      ],
    });
    const left = buildSourcePlan({ profile: overlay, question: "show the evidence" });
    const right = buildSourcePlan({ profile: overlay, question: "show the evidence" });

    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(sourcePlanSchema.parse(JSON.parse(JSON.stringify(left)))).toEqual(left);
  });

  it("OFFERS a census-named question the Datadog rows, and never makes them required off a name alone", () => {
    const telemetry = capability({
      command: ["slopweaver", "atlas", "datadog", "read"],
      id: "telemetry",
      terms: ["logs"],
    });
    const live = capability({ command: ["slopweaver", "datadog", "probe"], id: "telemetry-live", terms: ["logs"] });
    const hex = capability({ command: ["slopweaver", "atlas", "hex", "read"], id: "hex-atlas", terms: ["cohort"] });
    const plan = buildSourcePlan({
      censusMatches: [{ events: 150, service: "jobs-api", token: "jobs-api" }],
      profile: profile({ capabilities: [telemetry, live, hex] }),
      question: "why is jobs-api throwing errors?",
    });
    // A review pass measured `asset-management` — a whole census service name that is also ordinary business
    // English — making Datadog REQUIRED on a compliance question and demoting the world model to optional.
    expect(plan.required.map((leg) => leg.capability.id)).toEqual(["corpus"]);
    expect(plan.optional.map((leg) => [leg.capability.id, leg.matched])).toEqual([
      ["telemetry", ["census:service:jobs-api"]],
      ["telemetry-live", ["census:service:jobs-api"]],
    ]);
  });

  it("keeps a Datadog row REQUIRED when the question carries a telemetry word of its own", () => {
    const telemetry = capability({
      command: ["slopweaver", "atlas", "datadog", "read"],
      id: "telemetry",
      terms: ["logs"],
    });
    const plan = buildSourcePlan({
      censusMatches: [{ events: 150, service: "jobs-api", token: "jobs-api" }],
      profile: profile({ capabilities: [telemetry] }),
      question: "why are logs missing for jobs-api?",
    });

    expect(plan.required.map((leg) => [leg.capability.id, leg.matched])).toEqual([
      ["telemetry", ["logs", "census:service:jobs-api"]],
    ]);
    expect(plan.optional.map((leg) => leg.capability.id)).toEqual(["corpus"]);
  });

  // A review pass measured this: census entries were counted by `decisiveOrder`'s tie-break, so three
  // recognised service slugs moved both Datadog rows above the row that had matched two of the question's
  // own terms. The skill tells a session to consult `required` IN ORDER, so rank is the whole claim.
  it("never lets census names buy RANK inside required — the plan is identical with and without them", () => {
    const rows = [
      capability({ command: ["slopweaver", "atlas", "datadog", "read"], id: "telemetry", terms: ["alerts"] }),
      capability({ command: ["slopweaver", "datadog", "probe"], id: "telemetry-live", terms: ["alerts"] }),
      capability({
        command: ["slopweaver", "atlas", "github"],
        id: "github-control-atlas",
        terms: ["branch protection", "required reviews"],
      }),
    ];
    const question = "which branch protection and required reviews cover the alerts for jobs-api and core-api?";
    const order = ({
      censusMatches,
    }: {
      censusMatches: readonly { events: number; service: string; token: string }[];
    }) =>
      buildSourcePlan({ censusMatches, profile: profile({ capabilities: rows }), question }).required.map(
        (leg) => leg.capability.id,
      );

    expect(
      order({
        censusMatches: [
          { events: 9, service: "jobs-api", token: "jobs-api" },
          { events: 8, service: "core-api", token: "core-api" },
        ],
      }),
    ).toEqual(order({ censusMatches: [] }));
    expect(order({ censusMatches: [] })[0]).toBe("github-control-atlas");
  });

  it("adds nothing when the census named no service", () => {
    const telemetry = capability({
      command: ["slopweaver", "atlas", "datadog", "read"],
      id: "telemetry",
      terms: ["logs"],
    });
    const plan = buildSourcePlan({
      censusMatches: [],
      profile: profile({ capabilities: [telemetry] }),
      question: "why is jobs-api throwing errors?",
    });
    expect(plan.required.map((leg) => leg.capability.id)).toEqual(["corpus"]);
  });
});

describe("capabilityProfileSchema", () => {
  it("refuses a shell command string because command boundaries must remain argv", () => {
    const parsed = capabilityProfileSchema.safeParse({
      capabilities: [
        { ...capability({ command: ["tool", "read"], id: "tool", terms: ["tool"] }), command: "tool read" },
      ],
      schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses duplicate capability ids rather than choosing one silently", () => {
    const row = capability({ command: ["tool", "read"], id: "tool", terms: ["tool"] });

    expect(
      capabilityProfileSchema.safeParse({
        capabilities: [row, row],
        schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
      }).success,
    ).toBe(false);
  });

  it("refuses a runnable command on an unavailable capability", () => {
    const row = capability({ command: ["tool", "read"], id: "tool", terms: ["tool"] });

    expect(
      capabilityProfileSchema.safeParse({
        capabilities: [{ ...row, availability: { kind: "unavailable", reason: "not installed" } }],
        schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
      }).success,
    ).toBe(false);
  });

  it("refuses the question token embedded inside a larger argv element", () => {
    const row = capability({ command: ["tool", `prefix-${QUESTION_COMMAND_TOKEN}`], id: "tool", terms: ["tool"] });

    expect(
      capabilityProfileSchema.safeParse({
        capabilities: [row],
        schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
      }).success,
    ).toBe(false);
  });
});

describe("sourcePlanSchema invariants", () => {
  it("refuses a current source demoted to optional", () => {
    const plan = buildSourcePlan({ question: "what are my open PRs?" });

    expect(sourcePlanSchema.safeParse({ ...plan, optional: plan.required }).success).toBe(false);
  });

  it("refuses the same capability in required and optional legs", () => {
    const plan = buildSourcePlan({ question: "what did we decide?" });

    expect(sourcePlanSchema.safeParse({ ...plan, optional: plan.required }).success).toBe(false);
  });
});

describe("an ask that names an ARTIFACT", () => {
  it("routes the pentest-report question to the drive door, with history as optional context", () => {
    const plan = buildSourcePlan({ question: "where is the aether pentest report pdf" });
    expect(plan.required.map((leg) => leg.capability.id)).toContain("drive");
    expect(plan.required[0]!.capability.truthMode).toBe("current");
    expect(plan.optional.map((leg) => leg.capability.id)).toEqual(["corpus"]);
  });

  it("routes a question about an invitation to the mailbox rather than to the corpus alone", () => {
    const plan = buildSourcePlan({ question: "did the aether invite email ever arrive?" });
    expect(plan.required.map((leg) => leg.capability.id)).toContain("gmail");
  });

  it("owes a meeting-transcript question the Drive and mailbox doors, never this machine's session logs", () => {
    const plan = buildSourcePlan({ question: "is there a transcript of the onboarding meeting with acme" });
    expect(plan.required.map((leg) => [leg.capability.id, leg.matched])).toEqual([
      ["drive", ["transcript"]],
      ["gmail", ["transcript"]],
      ["outlook", ["transcript"]],
      ["calendar", ["meeting"]],
    ]);
    expect(plan.optional.map((leg) => leg.capability.id)).toEqual(["corpus"]);
  });

  it.each([
    "did anyone keep a recording of the acme kickoff",
    "where are the recordings from last week",
    "send me the meeting notes from the ABC-1 review",
    "Where is the Meeting Note from kickoff?",
    "Can you find the notes from the onboarding meeting?",
    "Where is the note from yesterday's meeting?",
    "Where is yesterday's meeting-notes file?",
    "is there a Meeting-Recording of the acme kickoff",
    "the TRANSCRIPTS of the acme call",
  ])("owes %j the Drive and mailbox doors too", (question) => {
    const doors = ["drive", "gmail", "outlook"];
    const plan = buildSourcePlan({ question });
    expect(plan.required.map((leg) => leg.capability.id).filter((id) => doors.includes(id))).toEqual(doors);
  });

  it("still plans this machine's session logs for a qualified session-transcript question, beside the doors", () => {
    const plan = buildSourcePlan({ question: "which claude transcripts hit a tool error yesterday" });
    expect(plan.required.map((leg) => [leg.capability.id, leg.matched])).toEqual([
      ["drive", ["transcripts"]],
      ["gmail", ["transcripts"]],
      ["outlook", ["transcripts"]],
      ["session-transcripts", ["claude transcripts", "tool error"]],
    ]);
  });

  it("routes a question about a vendor portal to the browser door", () => {
    const plan = buildSourcePlan({ question: "can we still get into the dvuln portal?" });
    expect(plan.required.map((leg) => leg.capability.id)).toContain("browser");
  });

  it("plans a door command that runs as written, never one with the question substituted into a query", () => {
    const plan = buildSourcePlan({ question: "where is the pentest report pdf" });
    const drive = plan.required.find((leg) => leg.capability.id === "drive")!;
    expect(drive.capability.command).toEqual(["slopweaver", "drive", "drives"]);
  });
});
