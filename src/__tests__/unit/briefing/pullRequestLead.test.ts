/*
 * An opening leads with the discussion, never a pull request (fixtures shaped after an incident draft that
 * opened on its fix branch, sd-3f1c9a2e).
 */
import { describe, expect, it } from "vitest";

import { pullRequestLead, pullRequestLeadReason } from "../../../briefing/pullRequestLead.js";

/** A fixture incident draft's first block, as its payload rendered it: link address, label, then the TL;DR. */
const GATEWAY_DRAFT_OPENING =
  "🔗 https://github.com/acme/acme-admin/compare/staging...incident-acme-admin-gateway Fix branch\n\nFixture prod " +
  "gateway outage hitting many users. Every request has been a 5xx since the deploy, so events are dropping. " +
  "need a reviewer for the fix";

describe("pullRequestLead", () => {
  it("refuses the gateway draft's opening on its compare link", () => {
    expect(pullRequestLead({ text: GATEWAY_DRAFT_OPENING })).toBe(
      "https://github.com/acme/acme-admin/compare/staging...incident-acme-admin-gateway",
    );
  });

  it("refuses the same TL;DR without the link, on its ask for a fix reviewer", () => {
    const text = "Fixture prod gateway outage hitting many users. need a reviewer for the fix";
    expect(pullRequestLead({ text })).toBe("reviewer for the fix");
  });

  it.each([
    ["PR #1234 fixes the gateway", "PR #1234"],
    ["pull request 18406 is still wanted", "pull request 18406"],
    ["#18721 is ready", "#18721"],
    ["Fix branch for the gateway outage", "Fix branch"],
    ["https://github.com/acme/acme-admin/pull/18721 needs a look", "https://github.com/acme/acme-admin/pull/18721"],
    ["Approve the fix PR for the gateway outage, so events recover", "Approve the fix"],
    ["Should we merge this fix tonight?", "merge this fix"],
    ["Approve the PR that closes the outage, so events recover", "Approve the PR"],
    [
      "Can you approve https://github.com/acme/acme-admin/pull/18721 so events recover?",
      "approve https://github.com/acme/acme-admin/pull/18721",
    ],
    ["Should we land this fix PR today?", "land this fix PR"],
    ["Please land the fix pull request before the deploy", "land the fix pull request"],
    ["## PR 1234 fixes the gateway", "PR 1234"],
    ["> ### 🔗 Fix branch for the gateway outage", "Fix branch"],
  ])("refuses %j", (text, phrase) => {
    expect(pullRequestLead({ text })).toBe(phrase);
  });

  it.each([
    "Hey team, I just noticed these errors coming through on the gateway; looks like an incident, might be breaking our events",
    "Read the breakdown of Jasper's #18721: validate (uk) has never gone green",
    "Read why PRs are backing up, so you can decide which to chase",
    "Fix your Slack app scopes, so your status can be set",
    "hey, could I grab a review on https://github.com/acme/acme-admin/pull/18247 when you get a sec? no rush",
    "The PR lead-row gate reads the word 'Re-import' in a Next cell as a Problem row",
    "The fix proposed in the resync row is too narrow: a browser leg that dies part way still stamps",
    "find the cause of the resync deaths and land the fix",
    "Should we raise the gateway errors with platform? The fixture dashboard shows every request failing since the deploy.",
    "Raise 9 vulnerability-fix pull request(s) in acme/acme-admin as octocat, to bring the open set back",
    "A composed bot answer was destroyed at push time. Ledger row for the fix PR that resolves the root from the repo",
    "PR 2 of 2. Port the slopweaver PR-description verb into the Agent CLI package as a permissive Zod schema",
    "PR1 of owner turn 256-3 (banish pgvector/embeddings/re-ranking/semantic search) is WRITTEN and committed",
    "Jasper's uk stack needs a reviewer for the PR Jasper opened yesterday, so tag Jasper in #dev-reviews",
    "Who is a reviewer on this pull request, so the ask reaches the right person?",
    "## What the gateway errors look like since the deploy",
  ])("passes %j", (text) => {
    expect(pullRequestLead({ text })).toBe(undefined);
  });

  it("passes an empty opening", () => {
    expect(pullRequestLead({ text: "" })).toBe(undefined);
  });

  // a keycap emoji starts with a digit, which once stopped the leading-emoji skip.
  it.each(["1️⃣ Fix branch", "#️⃣ Fix branch", "1⃣ Fix branch"])(
    "refuses %j, skipping the keycap emoji it opens on",
    (text) => {
      expect(pullRequestLead({ text })).toBe("Fix branch");
    },
  );

  // The header's stated bound: at most 40 characters between the verb and the word introducing the fix.
  it("catches an ask with 40 characters before the fix's determiner, and passes one with 42", () => {
    expect(pullRequestLead({ text: `approve ${"x".repeat(38)} the fix` })).toBe(`approve ${"x".repeat(38)} the fix`);
    expect(pullRequestLead({ text: `approve ${"x".repeat(40)} the fix` })).toBe(undefined);
    expect(
      pullRequestLead({
        text: "Many users cannot finish checkout; approve, after the team reviews the evidence, the fix",
      }),
    ).toBe("approve, after the team reviews the evidence, the fix");
  });
});

describe("pullRequestLeadReason", () => {
  it("names the phrase and the reword", () => {
    expect(pullRequestLeadReason({ phrase: "fix PR" })).toContain(
      'leads with a pull request ("fix PR") instead of the discussion: open on what was noticed and its evidence',
    );
  });
});
