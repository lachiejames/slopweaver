import { describe, expect, it } from "vitest";

import {
  accountProbeUrl,
  orgGrantVerdict,
  orgProbeUrl,
  orgSsoInitiateUrl,
} from "../../../../outbound/github/orgSso.js";

/** A signed-in visitor looking at an organisation that has authorised this session. */
const GRANTED = '<meta name="user-login" content="octocat"><h1>Acme</h1><a href="/acme/widgets">widgets</a>';

/**
 * The wall: a valid page, served to an account that IS signed in, carrying the sign-on markers and no
 * repository content. Shaped from the live measurement in `attachment.ts`'s `isOrgSsoWall`.
 */
const WALLED =
  '<meta name="user-login" content="octocat">' +
  "<h2>Single sign-on to Acme</h2>" +
  '<form action="https://github.com/orgs/acme/saml/initiate" method="post">' +
  '<a href="/orgs/acme/sso/sign_in">Continue</a></form>';

/** GitHub serves a lapsed session a perfectly valid page with no `user-login` on it. */
const SIGNED_OUT = "<html><body>Sign in to GitHub</body></html>";

describe("orgSsoInitiateUrl", () => {
  it("addresses the organisation's own sign-on page", () => {
    expect(orgSsoInitiateUrl({ org: "acme" })).toBe("https://github.com/orgs/acme/sso");
  });
});

describe("orgProbeUrl", () => {
  it("addresses the organisation home page the verdict is read from", () => {
    expect(orgProbeUrl({ org: "acme" })).toBe("https://github.com/orgs/acme");
  });
});

describe("accountProbeUrl", () => {
  it("addresses a personal account's own profile page, which has no /orgs/ prefix", () => {
    expect(accountProbeUrl({ owner: "octocat" })).toBe("https://github.com/octocat");
  });
});

describe("orgGrantVerdict", () => {
  it("reads an authorised organisation page as granted", () => {
    expect(orgGrantVerdict({ html: GRANTED })).toBe("granted");
  });

  it("reads the sign-on interstitial as walled, NOT as granted", () => {
    // The whole point of the three-way verdict: the wall is signed in, so a signed-in check alone calls it
    // a success and every upload then fails on a session that just reported green.
    expect(orgGrantVerdict({ html: WALLED })).toBe("walled");
  });

  it("reads an anonymous page as signed-out rather than walled", () => {
    expect(orgGrantVerdict({ html: SIGNED_OUT })).toBe("signed-out");
  });

  it("does not call an empty body granted", () => {
    expect(orgGrantVerdict({ html: "" })).toBe("signed-out");
  });
});
