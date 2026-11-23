/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  classifyWall,
  isSignInProvider,
  sessionOpenedOnProvider,
  snapshotControls,
  wallPressLines,
} from "../../../browser/signInPress.js";

const WORK = "ada.owner@acme.com";

describe("snapshotControls", () => {
  it("reads every button and link with its name and ref, in page order", () => {
    const elements = ['- heading "Sign in" [level=1]', '- button "Continue" [ref=e12]', '- link "Help" [ref=e13]'].join(
      "\n",
    );

    expect(snapshotControls({ elements })).toEqual([
      { name: "Continue", ref: "e12", role: "button" },
      { name: "Help", ref: "e13", role: "link" },
    ]);
  });
});

describe("classifyWall", () => {
  it("presses Datadog's Sign in with Google button", () => {
    const elements = ['- textbox "Email" [ref=e3]', '- button "Sign in with Google" [ref=e7]'].join("\n");

    expect(classifyWall({ elements, landedUrl: "https://app.datadoghq.com/account/login", workEmail: WORK })).toEqual({
      kind: "pressable",
      label: "Sign in with Google",
      ref: "e7",
    });
  });

  it("leaves a Datadog login page with no Google button to the owner's hands", () => {
    const verdict = classifyWall({
      elements: '- button "Log in" [ref=e4]',
      landedUrl: "https://app.datadoghq.com/account/login",
      workEmail: WORK,
    });

    expect(verdict).toEqual({
      kind: "owner-hands",
      why: "Datadog's sign-in page at /account/login offers no Google button",
    });
  });

  it("leaves a Datadog login the Google press already bounced off to the owner's hands, Google button and all", () => {
    const verdict = classifyWall({
      elements: ['- button "Sign in with Google" [ref=f2e32]', '- textbox "Password" [ref=f2e51]'].join("\n"),
      landedUrl: "https://ap1.datadoghq.com/account/login?google_invalid_email=t&next=%2Fapm%2Fhome",
      workEmail: WORK,
    });

    expect(verdict).toEqual({
      kind: "owner-hands",
      why: "Datadog on ap1.datadoghq.com has no account for the Google user Chrome signed in as, so the Google press bounced",
    });
  });

  it("presses the Google chooser row that names the owner's work account", () => {
    const elements = ['- link "Ada Owner ada@personal.example" [ref=e20]', `- link "Ada Owner ${WORK}" [ref=e21]`].join(
      "\n",
    );

    expect(
      classifyWall({ elements, landedUrl: "https://accounts.google.com/v3/signin/accountchooser", workEmail: WORK }),
    ).toEqual({ kind: "pressable", label: `Ada Owner ${WORK}`, ref: "e21" });
  });

  it("leaves a chooser that does not list the owner's work account to the owner's hands", () => {
    const verdict = classifyWall({
      elements: '- link "Ada Owner ada@personal.example" [ref=e20]',
      landedUrl: "https://accounts.google.com/v3/signin/accountchooser",
      workEmail: WORK,
    });

    expect(verdict).toEqual({
      kind: "owner-hands",
      why: `Google's chooser does not list the owner's work account ${WORK}`,
    });
  });

  it("presses nothing on a chooser when no work account is recorded", () => {
    const verdict = classifyWall({
      elements: `- link "Ada Owner ${WORK}" [ref=e21]`,
      landedUrl: "https://accounts.google.com/v3/signin/accountchooser",
      workEmail: undefined,
    });

    expect(verdict.kind).toBe("owner-hands");
  });

  it("presses Datadog's Google button beside the password box its login page also carries — the press fills nothing", () => {
    const elements = [
      '- textbox "Email" [ref=e3]',
      '- textbox "Password" [ref=e4]',
      '- button "Log in" [ref=e5]',
      '- button "Sign in with Google" [ref=e7]',
    ].join("\n");

    expect(classifyWall({ elements, landedUrl: "https://app.datadoghq.com/account/login", workEmail: WORK })).toEqual({
      kind: "pressable",
      label: "Sign in with Google",
      ref: "e7",
    });
  });

  it("names a password field as the reason when the page offers nothing in the press set", () => {
    const elements = ['- textbox "Password" [ref=e4]', '- button "Log in" [ref=e5]'].join("\n");

    expect(classifyWall({ elements, landedUrl: "https://app.datadoghq.com/account/login", workEmail: WORK })).toEqual({
      kind: "owner-hands",
      why: "app.datadoghq.com asks for a password, passkey or second factor",
    });
  });

  it("never presses the account chip on a Google challenge page, though it names the owner's work account", () => {
    const elements = [
      `- button "${WORK} selected. Switch account" [ref=e2]`,
      '- button "Try another way" [ref=e9]',
    ].join("\n");

    expect(
      classifyWall({ elements, landedUrl: "https://accounts.google.com/v3/signin/challenge/pk", workEmail: WORK }),
    ).toEqual({ kind: "owner-hands", why: "Google wants the owner's own step at /v3/signin/challenge/pk" });
  });

  it("presses Continue on GitHub's organisation single sign-on page", () => {
    const elements = ['- button "Continue" [ref=e9]', '- link "Learn more" [ref=e10]'].join("\n");

    expect(classifyWall({ elements, landedUrl: "https://github.com/orgs/acme/sso", workEmail: WORK })).toEqual({
      kind: "pressable",
      label: "Continue",
      ref: "e9",
    });
  });

  it("leaves GitHub's own login to the owner's hands", () => {
    const verdict = classifyWall({
      elements: '- button "Sign in" [ref=e3]',
      landedUrl: "https://github.com/login",
      workEmail: WORK,
    });

    expect(verdict).toEqual({ kind: "owner-hands", why: "GitHub wants the owner's own sign-in at /login" });
  });

  it("leaves a page this has never seen to the owner's hands", () => {
    const verdict = classifyWall({
      elements: '- button "Sign in with Google" [ref=e7]',
      landedUrl: "https://login.microsoftonline.com/common",
      workEmail: WORK,
    });

    expect(verdict).toEqual({
      kind: "owner-hands",
      why: "the sign-in moved on to login.microsoftonline.com, a page the fleet never presses",
    });
  });

  it("leaves the Cloudflare Access login a GitHub SSO press leads to in the owner's hands, Continue button and all", () => {
    const verdict = classifyWall({
      elements: ['- heading "Sign in to acme" [level=1]', '- button "Continue" [ref=e4]'].join("\n"),
      landedUrl: "https://acme.cloudflareaccess.com/cdn-cgi/access/login/github.com",
      workEmail: WORK,
    });

    expect(verdict).toEqual({
      kind: "owner-hands",
      why: "the sign-in moved on to acme.cloudflareaccess.com, a page the fleet never presses",
    });
  });
});

describe("sessionOpenedOnProvider", () => {
  it("takes a session opened on GitHub's SSO wall as a GitHub look", () => {
    expect(sessionOpenedOnProvider({ origins: ["https://github.com"], provider: "github" })).toBe(true);
  });

  it("takes a session opened on a regional Datadog console as a Datadog look", () => {
    expect(sessionOpenedOnProvider({ origins: ["https://ap1.datadoghq.com"], provider: "datadog" })).toBe(true);
  });

  it("refuses a GitHub session standing behind a Datadog look", () => {
    expect(sessionOpenedOnProvider({ origins: ["https://github.com"], provider: "datadog" })).toBe(false);
  });

  it("refuses a session opened on some other page", () => {
    expect(sessionOpenedOnProvider({ origins: ["https://app.vanta.com"], provider: "github" })).toBe(false);
  });

  it("refuses a session whose recorded origin does not parse, and one with none", () => {
    expect(sessionOpenedOnProvider({ origins: ["not a url"], provider: "github" })).toBe(false);
    expect(sessionOpenedOnProvider({ origins: [], provider: "github" })).toBe(false);
  });
});

describe("isSignInProvider", () => {
  it("names exactly the providers the fleet signs in to", () => {
    expect([isSignInProvider("datadog"), isSignInProvider("github")]).toEqual([true, true]);
    expect([isSignInProvider("linear"), isSignInProvider(undefined)]).toEqual([false, false]);
  });
});

describe("wallPressLines", () => {
  it("prints the press, then the look after it through the same tab", () => {
    const lines = wallPressLines({
      observation: { id: "obs-1", url: "https://github.com/orgs/acme/sso" },
      provider: "github",
      ref: "e4",
      sessionId: "s-1",
      why: 'press "Continue" (e4) on github.com/orgs/acme/sso',
    });
    expect(lines).toEqual([
      'browser sign-in: github WALL the fleet presses — press "Continue" (e4) on github.com/orgs/acme/sso. Press it, then look again:',
      "  slopweaver browser act --session s-1 --do click --target e4 --observation obs-1",
      "  slopweaver browser sign-in --provider github --session s-1",
    ]);
  });

  it("names the break-glass second, before the press, when the wall is Google's account chooser", () => {
    const lines = wallPressLines({
      observation: { id: "obs-2", url: "https://accounts.google.com/chooser" },
      provider: "datadog",
      ref: "e9",
      sessionId: "s-2",
      why: "press the work account",
    });
    expect(lines[1]).toBe(
      `  slopweaver browser break-glass --page https://accounts.google.com/chooser --reason "Google chooser on a datadog sign-in, the owner's work account (owner ruling)"`,
    );
    expect(lines.length).toBe(4);
  });
});
