/**
 * `browser sign-in`'s refusal path: a provider outside the two the owner's ruling hands to the fleet is refused
 * before any browser opens, and no look is recorded.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { githubSignInPlan, runSignIn } from "../../../../../cli/commands/browser/signInRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryRecordedProfilePort } from "../../../../recordedProfileFixture.js";

const homes: string[] = [];

/** A throwaway state home, removed after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sign-in-run-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("runSignIn", () => {
  it("refuses a provider the ruling does not hand to the fleet, and records no look", async () => {
    const home = freshHome();
    expect(
      await runSignIn({
        home,
        org: undefined,
        profiles: memoryRecordedProfilePort(),
        provider: "xero",
        sessionId: undefined,
      }),
    ).toBe(EXIT_USAGE);
    expect(existsSync(stateHomePaths({ home }).signInProbesJsonl)).toBe(false);
  });

  it("refuses a missing --provider the same way", async () => {
    const home = freshHome();
    expect(
      await runSignIn({
        home,
        org: "acme",
        profiles: memoryRecordedProfilePort(),
        provider: undefined,
        sessionId: undefined,
      }),
    ).toBe(EXIT_USAGE);
    expect(existsSync(stateHomePaths({ home }).signInProbesJsonl)).toBe(false);
  });
});

describe("githubSignInPlan", () => {
  it("keeps an authorised organisation's signed-in row and line exactly", () => {
    expect(githubSignInPlan({ grant: { account: "organisation", verdict: "granted" }, owner: "acme" })).toEqual({
      kind: "signed-in",
      message: "browser sign-in: github SIGNED IN — acme is SAML-authorised. Nothing to press.",
      page: "https://github.com/orgs/acme",
      why: "GitHub answers acme as SAML-authorised for the owner's Chrome's session",
    });
  });

  it("opens the organisation's sign-on page on a wall", () => {
    expect(githubSignInPlan({ grant: { account: "organisation", verdict: "walled" }, owner: "acme" })).toEqual({
      kind: "wall",
      url: "https://github.com/orgs/acme/sso",
    });
  });

  it("opens GitHub's login for a signed-out organisation session", () => {
    expect(githubSignInPlan({ grant: { account: "organisation", verdict: "signed-out" }, owner: "acme" })).toEqual({
      kind: "wall",
      url: "https://github.com/login",
    });
  });

  it("reads a signed-in personal account as signed in off its own page, with no SAML grant to name", () => {
    expect(githubSignInPlan({ grant: { account: "personal", verdict: "signed-in" }, owner: "octocat" })).toEqual({
      kind: "signed-in",
      message:
        "browser sign-in: github SIGNED IN — octocat is a personal account, so no SAML grant applies. Nothing to press.",
      page: "https://github.com/octocat",
      why: "GitHub answers octocat's personal account page signed in for the owner's Chrome's session",
    });
  });

  it("opens GitHub's login for a signed-out personal account", () => {
    expect(githubSignInPlan({ grant: { account: "personal", verdict: "signed-out" }, owner: "octocat" })).toEqual({
      kind: "wall",
      url: "https://github.com/login",
    });
  });
});
