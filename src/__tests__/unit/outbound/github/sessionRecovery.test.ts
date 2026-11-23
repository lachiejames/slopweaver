import { describe, expect, it } from "vitest";

import { GithubAttachErrors } from "../../../../outbound/github/attach.errors.js";
import {
  loginCapturedEvent,
  needsOwnerLogin,
  needsOwnerLoginEvent,
  ownerSignInRefusal,
} from "../../../../outbound/github/sessionRecovery.js";

const SOURCE = "your own Chrome";
const EXPIRED = GithubAttachErrors.webSessionExpired({
  path: SOURCE,
  url: "https://github.com/o/r/pull/1?overview=false",
});
const MISSING = GithubAttachErrors.webSessionMissing({ path: "no Chrome profile has been recorded" });
const UNREADABLE = GithubAttachErrors.webSessionUnreadable({ detail: "no github.com cookie", path: "Default" });
const ORG_WALL = GithubAttachErrors.orgSsoRequired({ url: "https://github.com/acme/widgets/pull/1" });

describe("needsOwnerLogin", () => {
  it("claims a session GitHub answered anonymously", () => {
    expect(needsOwnerLogin({ error: EXPIRED })!.code).toBe("WEB_SESSION_EXPIRED");
  });

  it("claims a machine with no recorded Chrome profile", () => {
    expect(needsOwnerLogin({ error: MISSING })!.code).toBe("WEB_SESSION_MISSING");
  });

  it("claims a browser holding no usable github.com session", () => {
    expect(needsOwnerLogin({ error: UNREADABLE })!.code).toBe("WEB_SESSION_UNREADABLE");
  });

  it("claims an org SSO wall, which only the owner's own hands clear", () => {
    expect(needsOwnerLogin({ error: ORG_WALL })!.code).toBe("ORG_SSO_REQUIRED");
  });

  it("declines an unrelated failure", () => {
    expect(needsOwnerLogin({ error: GithubAttachErrors.pageUnreadable({ status: 404, url: "u" }) })).toBe(undefined);
  });
});

describe("ownerSignInRefusal", () => {
  it("names the state, that nothing was uploaded, the fleet's press, and only then the owner's own browser", () => {
    // A GitHub sign-in is the fleet's to press.
    expect(ownerSignInRefusal({ error: EXPIRED })).toBe(
      "GitHub answered your browser's cookies as an anonymous visitor and nothing was uploaded — press it with " +
        "`slopweaver browser sign-in --provider github`, or sign in to github.com in your own Chrome if that look " +
        "finds the step yours, then run this upload again",
    );
  });

  it("distinguishes an unrecorded profile from a browser that is merely signed out", () => {
    expect(ownerSignInRefusal({ error: MISSING })).toContain("no Chrome profile has been recorded for this machine");
    expect(ownerSignInRefusal({ error: UNREADABLE })).toContain("your Chrome holds no usable github.com session");
  });

  it("is one line, because it sits in front of an operation the reader asked for", () => {
    expect(ownerSignInRefusal({ error: UNREADABLE }).includes("\n")).toBe(false);
  });

  it("names the ORG's own sign-on over a wall, never a plain sign-in that would change nothing", () => {
    // The trap this area keeps setting: being signed in to github.com never establishes an organisation's
    // SAML grant, so a reader who just signs in watches the identical upload fail.
    const refusal = ownerSignInRefusal({ error: ORG_WALL });
    expect(refusal).toContain("press the organisation's single sign-on prompt with `slopweaver browser sign-in");
    expect(refusal).toContain("--provider github --org <org>`");
    expect(refusal).toContain("nothing was uploaded");
  });

  it("keeps the plain sign-in for a failure a plain sign-in DOES fix", () => {
    expect(ownerSignInRefusal({ error: EXPIRED })).toContain("sign in to github.com in your own Chrome");
  });
});

describe("needsOwnerLoginEvent", () => {
  it("carries the source and an alert-worthy sentence, because it is the only trace a block leaves", () => {
    expect(needsOwnerLoginEvent({ atIso: "2026-08-26T14:30:00.000Z", error: EXPIRED, sessionPath: SOURCE })).toEqual({
      atIso: "2026-08-26T14:30:00.000Z",
      kind: "needs-owner-login",
      sessionPath: SOURCE,
      source: "github-attach",
      why:
        "GitHub answered your browser's cookies as an anonymous visitor — an upload was NOT delivered, and " +
        "only signing in yourself unblocks it",
    });
  });

  it("says plainly that the delivery did not happen, whichever state caused it", () => {
    const event = needsOwnerLoginEvent({ atIso: "2026-08-26T14:30:00.000Z", error: MISSING, sessionPath: SOURCE });
    expect(event.why).toContain("an upload was NOT delivered");
  });

  it("carries the source on the stream event even though the wall carries a url", () => {
    expect(
      needsOwnerLoginEvent({ atIso: "2026-08-27T00:00:00.000Z", error: ORG_WALL, sessionPath: SOURCE }).sessionPath,
    ).toBe(SOURCE);
  });
});

describe("loginCapturedEvent", () => {
  it("names the account and says uploads work again", () => {
    expect(loginCapturedEvent({ atIso: "2026-08-26T14:35:00.000Z", login: "octocat", sessionPath: SOURCE })).toEqual({
      atIso: "2026-08-26T14:35:00.000Z",
      kind: "login-captured",
      sessionPath: SOURCE,
      source: "github-attach",
      why: "your own Chrome is signed in to github.com as octocat — uploads work again",
    });
  });
});
