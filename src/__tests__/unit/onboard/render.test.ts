/**
 * The WORDS `slopweaver onboard` says.
 *
 * This suite is unusual in asserting copy, and deliberately so: the deliverable of this verb is the text a
 * new user reads at the moment they decide how much reach to hand a piece of software. "The most capable
 * option is recommended AND is called the least secure in the same breath, AND says which part of it can
 * never be undone" is a property of the prose, and prose that is not asserted drifts on the next edit.
 */
import { describe, expect, it } from "vitest";

import { LISTEN_SETUP_STEPS } from "../../../live/listen/preflight.js";
import {
  type AnswerNote,
  type OnboardAnswers,
  renderOnboardJson,
  renderOnboardSession,
} from "../../../onboard/render.js";
import { ONBOARD_SOURCES, SOURCE_SPECS } from "../../../onboard/sources.js";
import { type OnboardTier, renderSlackAppManifest, TIER_ORDER, TIERS } from "../../../onboard/tiers.js";

/** The notes a fully-defaulted run produces. */
const DEFAULT_NOTES: readonly AnswerNote[] = [
  { flag: "--app-name", label: "app name", source: "default", value: "Slopweaver" },
  { flag: "--tier", label: "tier", source: "asked", value: "agent" },
];

/** Render one session as a single string, for whole-output assertions. */
function sessionText({ tier, notes = DEFAULT_NOTES }: { tier: OnboardTier; notes?: readonly AnswerNote[] }): string {
  const answers: OnboardAnswers = { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier };
  return renderOnboardSession({ answers, notes }).join("\n");
}

describe("the tier copy", () => {
  it("has at least one entry in TIER_ORDER, so the guards below are not vacuously green", () => {
    expect(TIER_ORDER.length).toBeGreaterThan(0);
  });

  it("recommends the agent tier AND calls it the least secure, on the same line", () => {
    const lines = renderOnboardSession({
      answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "agent" },
      notes: DEFAULT_NOTES,
    });
    const heading = lines.findIndex((line) => line.includes("agent — RECOMMENDED"));

    expect(heading).toBeGreaterThan(0);
    expect(lines[heading]).toContain("LEAST SECURE");
  });

  it("states EVERY tier's trade whichever one was chosen, so an alternative is never hidden", () => {
    for (const tier of TIER_ORDER) {
      const text = sessionText({ tier });
      const missing = TIER_ORDER.filter((name) => !text.includes(TIERS[name].trade));

      expect(missing).toEqual([]);
    }
  });

  it("gives each tier's trade as ONE line, not a paragraph to skim past", () => {
    const lines = renderOnboardSession({
      answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "agent" },
      notes: DEFAULT_NOTES,
    });
    const counts = TIER_ORDER.map((name) => lines.filter((line) => line.trim() === TIERS[name].trade).length);

    expect(counts).toEqual([1, 1, 1]);
  });

  it("states what cannot be undone AT the point of choice — inside the tier block, not in a footnote", () => {
    const lines = renderOnboardSession({
      answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "agent" },
      notes: DEFAULT_NOTES,
    });
    const heading = lines.findIndex((line) => line.includes("agent — RECOMMENDED"));
    const oneWay = lines.findIndex((line) => line.startsWith("      ONE-WAY:"));
    const manifest = lines.findIndex((line) => line.includes("Paste this"));

    expect(oneWay).toBe(heading + 2);
    expect(oneWay).toBeLessThan(manifest);
    expect(lines[oneWay]).toContain("CANNOT BE UNDONE");
  });

  it("says the irreversible thing whichever tier was chosen, so it is read before it is skipped", () => {
    const missing = TIER_ORDER.filter((tier) => !sessionText({ tier }).includes("CANNOT BE UNDONE"));

    expect(missing).toEqual([]);
  });

  it("marks the chosen tier and names the command that switches to each of the others", () => {
    expect(sessionText({ tier: "agent" })).toContain("▸ agent");
    expect(sessionText({ tier: "agent" })).toContain("Switch with: slopweaver onboard --tier restricted");
    expect(sessionText({ tier: "agent" })).toContain("Switch with: slopweaver onboard --tier standard");
    expect(sessionText({ tier: "restricted" })).toContain("▸ restricted");
    expect(sessionText({ tier: "restricted" })).toContain("Switch with: slopweaver onboard --tier agent");
  });

  it("gates nothing and nags nobody — the safer tier is offered once, as a command", () => {
    const text = sessionText({ tier: "agent" });

    expect(text).not.toContain("are you sure");
    expect(text).not.toContain("WARNING");
    expect(text.split("slopweaver onboard --tier restricted").length - 1).toBe(1);
  });
});

/**
 * The block that makes the recommendation honest. The owner's rule is that we neither force the risky thing
 * nor quietly withhold the capable one, which only holds if the user can read what the risky thing is worth.
 */
describe("the Agents panel block", () => {
  it("names what the scope BUYS, measured, not just what it costs", () => {
    const text = sessionText({ tier: "agent" });

    expect(text).toContain("assistant.threads.setTitle");
    expect(text).toContain("assistant.threads.setSuggestedPrompts");
    expect(text).toContain("a tag is answered identically on the `standard` tier");
  });

  it("lists every irreversible cost the tier declares, plus the reinstall", () => {
    const text = sessionText({ tier: "agent" });
    const missing = TIERS["agent"].irreversible.filter((cost) => !text.includes(cost));

    expect(missing).toEqual([]);
    expect(text).toContain("it needs a reinstall, because `assistant:write` is a new scope");
  });

  it("appears for no other tier — a rung that does not turn it on does not explain it", () => {
    expect(sessionText({ tier: "standard" })).not.toContain("The Agents panel — read this before you paste");
    expect(sessionText({ tier: "restricted" })).not.toContain("The Agents panel — read this before you paste");
  });
});

describe("the manifest in the output", () => {
  it("is the rendered manifest for the chosen tier, verbatim", () => {
    expect(sessionText({ tier: "agent" })).toContain(renderSlackAppManifest({ appName: "Slopweaver", tier: "agent" }));
    expect(sessionText({ tier: "restricted" })).toContain(
      renderSlackAppManifest({ appName: "Slopweaver", tier: "restricted" }),
    );
  });

  it("warns that pasting over an existing app revokes scopes — BEFORE the paste, not after it fails", () => {
    const lines = renderOnboardSession({
      answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "agent" },
      notes: DEFAULT_NOTES,
    });
    const warning = lines.findIndex((line) => line.includes("REVOKES every scope"));
    const install = lines.findIndex((line) => line.includes("Install to Workspace"));

    expect(warning).toBeGreaterThan(0);
    expect(warning).toBeGreaterThan(install);
  });
});

describe("what happens after the paste", () => {
  it("says a scope change needs a reinstall, and names the error you get if you skip it", () => {
    const text = sessionText({ tier: "agent" });

    expect(text).toContain("REINSTALL");
    expect(text).toContain("missing_scope");
  });

  it("says a managed workspace may need an ADMIN to approve it, so the approval wall is not a surprise", () => {
    expect(sessionText({ tier: "agent" })).toContain("WORKSPACE ADMIN");
    expect(sessionText({ tier: "restricted" })).toContain("WORKSPACE ADMIN");
  });

  it("says where a token goes, and it is never the chat or a command line", () => {
    expect(sessionText({ tier: "restricted" })).toContain("$SLOPWEAVER_HOME/secrets");
  });
});

describe("the app-level token", () => {
  it("has at least one entry in LISTEN_SETUP_STEPS, so the guards below are not vacuously green", () => {
    expect(LISTEN_SETUP_STEPS.length).toBeGreaterThan(0);
  });

  it("prints `listen --check`'s own five steps, from the same list, so the two cannot drift", () => {
    const text = sessionText({ tier: "agent" });

    expect(LISTEN_SETUP_STEPS.filter((step) => !text.includes(step))).toEqual([]);
  });

  it("says which of those steps the manifest already did, rather than repeating work", () => {
    expect(sessionText({ tier: "agent" })).toContain("already did 1, 3 and 4");
  });

  it("says nothing about socket mode on the restricted tier, which does not use it", () => {
    const text = sessionText({ tier: "restricted" });

    expect(text).not.toContain("xapp-");
    expect(LISTEN_SETUP_STEPS.filter((step) => text.includes(step))).toEqual([]);
  });
});

describe("the scope justifications", () => {
  it("prints every scope of the chosen tier with the capability and the call that needs it", () => {
    const text = sessionText({ tier: "agent" });
    const unnamed = TIERS["agent"].grants.filter(
      (grant) => !text.includes(grant.scope) || !text.includes(grant.capability) || !text.includes(grant.why),
    );

    expect(unnamed).toEqual([]);
  });

  it("separates the two token lanes, because they are two different grants", () => {
    const text = sessionText({ tier: "agent" });

    expect(text).toContain("USER TOKEN (xoxp-)");
    expect(text).toContain("BOT TOKEN (xoxb-)");
  });

  it("shows no bot lane at all on the restricted tier", () => {
    expect(sessionText({ tier: "restricted" })).not.toContain("BOT TOKEN");
  });

  it("names posting as YOU as its own capability — the sharpest grant is not buried in a scope list", () => {
    expect(sessionText({ tier: "agent" })).toContain("post as YOU");
  });
});

describe("the answers echoed back", () => {
  it("says where each answer came from, including which default it took", () => {
    const text = sessionText({ tier: "agent" });

    expect(text).toContain("app name  Slopweaver    (the default — --app-name)");
    expect(text).toContain("tier      agent         (you chose this — --tier)");
  });

  it("reports a flagged answer as coming from the flag", () => {
    const text = sessionText({
      notes: [
        { flag: "--app-name", label: "app name", source: "flag", value: "Team Brain" },
        { flag: "--tier", label: "tier", source: "flag", value: "restricted" },
      ],
      tier: "restricted",
    });

    expect(text).toContain("(from the flag — --tier)");
  });
});

describe("what the tier enables", () => {
  it("names the verbs each tier makes usable", () => {
    expect(sessionText({ tier: "agent" })).toContain("enables    refresh, store read, store cite, listen, turn");
    expect(sessionText({ tier: "restricted" })).toContain("enables    refresh, store read, store cite");
  });

  it("names what each lower rung withholds, and says the agent tier withholds nothing", () => {
    expect(sessionText({ tier: "restricted" })).toContain("withholds  listen, turn, slack post");
    expect(sessionText({ tier: "standard" })).toContain(
      "withholds  the Agents panel, the thread naming on a `turn brief --surface dm` turn",
    );
    expect(sessionText({ tier: "agent" })).toContain("withholds  nothing");
  });

  it("ends on the commands to run next, in order", () => {
    const lines = renderOnboardSession({
      answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "agent" },
      notes: DEFAULT_NOTES,
    });
    const order = [
      "slopweaver init",
      "secrets set slack-user-token",
      "connect slack --check",
      "refresh --source slack",
    ];
    const found = order.map((command) => lines.findIndex((line) => line.includes(command)));

    expect(found).toEqual([...found].toSorted((a, b) => a - b));
    expect(found.filter((index) => index < 0)).toEqual([]);
  });

  it("orders Outlook's client id, then its one consent, then its preflight, among the commands to run", () => {
    const lines = renderOnboardSession({
      answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "agent" },
      notes: DEFAULT_NOTES,
    });
    const order = [
      "slopweaver secrets set outlook-client-id",
      "slopweaver outlook connect --grant manage",
      "slopweaver connect outlook --check",
    ];
    // The source block above describes the consent too; the ORDER is the command list's, so read from there.
    const start = lines.findIndex((line) => line.startsWith("Then, in this order"));
    const found = order.map((command) => lines.findIndex((line, index) => index > start && line.includes(command)));

    expect(start).toBeGreaterThan(-1);
    expect(found.filter((index) => index < 0)).toEqual([]);
    expect(found).toEqual([...found].toSorted((a, b) => a - b));
    expect(lines.some((line) => line.includes("refresh --source outlook"))).toBe(false);
  });

  it("sends the shown-once Google secret to the reader's own password manager, naming no product", () => {
    const text = sessionText({ tier: "agent" });
    expect(text).toContain("SHOWN ONCE — save it to your password manager before you leave the page");
    expect(text).not.toMatch(/1password/iu);
  });

  it("tells only the tiers that provision a bot to capture a bot token", () => {
    expect(sessionText({ tier: "agent" })).toContain("secrets set slack-bot-token");
    expect(sessionText({ tier: "standard" })).toContain("secrets set slack-bot-token");
    expect(sessionText({ tier: "restricted" })).not.toContain("slack-bot-token");
  });

  it("makes the app-level token capture an explicit ordered step, not only narrative, on a socket-mode tier", () => {
    expect(sessionText({ tier: "agent" })).toContain("slopweaver secrets set slack-app-token");
    expect(sessionText({ tier: "restricted" })).not.toContain("slopweaver secrets set slack-app-token");
  });

  it("tells a socket-mode tier it must whitelist itself or every tag is refused, including its own", () => {
    const text = sessionText({ tier: "agent" });

    expect(text).toContain("slopweaver responders add --user");
    expect(text).toContain("responders.json starts EMPTY");
    expect(sessionText({ tier: "restricted" })).not.toContain("responders add");
  });
});

describe("renderOnboardJson", () => {
  it("carries the manifest object, every tier's trade, and every grant", () => {
    const parsed: unknown = JSON.parse(
      renderOnboardJson({
        answers: { appName: "Team Brain", identity: "ada-lovelace", mailboxZone: "example.org", tier: "agent" },
        notes: DEFAULT_NOTES,
      }),
    );

    expect(parsed).toEqual({
      answers: { appName: "Team Brain", identity: "ada-lovelace", mailboxZone: "example.org", tier: "agent" },
      appLevelTokenSteps: [...LISTEN_SETUP_STEPS],
      connectSources: ONBOARD_SOURCES.map((source) => JSON.parse(JSON.stringify(SOURCE_SPECS[source]))),
      enables: [...TIERS["agent"].enables],
      grants: TIERS["agent"].grants.map((grant) => ({ ...grant })),
      mailbox: {
        identity: "ada-lovelace",
        kind: "derived",
        seats: [
          { address: "ada-lovelace-claude-one@example.org", provider: "claude" },
          { address: "ada-lovelace-codex-one@example.org", provider: "codex" },
        ],
        zone: "example.org",
      },
      manifest: JSON.parse(renderSlackAppManifest({ appName: "Team Brain", tier: "agent" })),
      notes: DEFAULT_NOTES.map((note) => ({ ...note })),
      tiers: [
        {
          agentView: true,
          irreversible: [...TIERS["agent"].irreversible],
          recommended: true,
          securityLabel: TIERS["agent"].securityLabel,
          tier: "agent",
          trade: TIERS["agent"].trade,
        },
        {
          agentView: false,
          irreversible: [],
          recommended: false,
          securityLabel: TIERS["standard"].securityLabel,
          tier: "standard",
          trade: TIERS["standard"].trade,
        },
        {
          agentView: false,
          irreversible: [],
          recommended: false,
          securityLabel: TIERS["restricted"].securityLabel,
          tier: "restricted",
          trade: TIERS["restricted"].trade,
        },
      ],
      withholds: [],
    });
  });

  it("marks exactly one tier recommended, and it is the one that carries the one-way cost", () => {
    const parsed: unknown = JSON.parse(
      renderOnboardJson({
        answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "agent" },
        notes: DEFAULT_NOTES,
      }),
    );

    expect(parsed).toMatchObject({
      tiers: [
        { agentView: true, recommended: true, tier: "agent" },
        { agentView: false, recommended: false, tier: "standard" },
        { agentView: false, recommended: false, tier: "restricted" },
      ],
    });
  });

  it("carries no app-level token steps for the tier that opens no socket", () => {
    const parsed: unknown = JSON.parse(
      renderOnboardJson({
        answers: { appName: "Slopweaver", identity: undefined, mailboxZone: undefined, tier: "restricted" },
        notes: DEFAULT_NOTES,
      }),
    );

    expect(parsed).toMatchObject({ appLevelTokenSteps: [] });
  });
});
