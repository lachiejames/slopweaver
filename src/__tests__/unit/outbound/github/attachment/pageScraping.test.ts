/*
 * Reading a server-rendered GitHub page: the upload token and repository id off its upload region, and whether
 * the page is an organisation SSO wall or a signed-out page rather than one with no comment box.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { isOrgSsoWall, isSignedInPage, scrapeUploadContext } from "../../../../../outbound/github/attachment.js";

/** The assets upload region GitHub server-renders into a classic pull-request page, trimmed to the two values read. */
const UPLOAD_REGION =
  '<file-attachment class="js-upload-markdown-image is-default" data-upload-repository-id="1226919613" ' +
  'data-upload-policy-url="/upload/policies/assets">' +
  '<input type="hidden" value="page-scraped-token" data-csrf="true" class="js-data-upload-policy-url-csrf">' +
  "</file-attachment>";

describe("scrapeUploadContext", () => {
  it("reads the token and the repository id off the upload region", () => {
    const result = scrapeUploadContext({ html: UPLOAD_REGION, url: "https://github.com/o/r/pull/1" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).authenticityToken).toBe("page-scraped-token");
    expect(unwrap(result).repositoryId).toBe("1226919613");
  });

  it("reads the token when GitHub emits class before value", () => {
    const swapped =
      '<file-attachment data-upload-repository-id="7" data-upload-policy-url="/upload/policies/assets">' +
      '<input class="js-data-upload-policy-url-csrf" value="other-order-token"></file-attachment>';
    const result = scrapeUploadContext({ html: swapped, url: "https://github.com/o/r/pull/1" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).authenticityToken).toBe("other-order-token");
  });

  it("reads the assets region even when a release-binaries region with its own token comes first", () => {
    const binaries =
      '<file-attachment input="releases-upload" data-upload-repository-id="999" ' +
      'data-upload-policy-url="/upload/policies/releases">' +
      '<input type="hidden" value="releases-token" data-csrf="true" class="js-data-upload-policy-url-csrf">' +
      "</file-attachment>";
    const result = scrapeUploadContext({ html: binaries + UPLOAD_REGION, url: "https://github.com/o/r/releases/new" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ authenticityToken: "page-scraped-token", repositoryId: "1226919613" });
  });

  it("refuses a page whose only upload region is the release-binaries one", () => {
    const binariesOnly =
      '<file-attachment data-upload-repository-id="999" data-upload-policy-url="/upload/policies/releases">' +
      '<input value="releases-token" class="js-data-upload-policy-url-csrf"></file-attachment>';
    const result = scrapeUploadContext({ html: binariesOnly, url: "https://github.com/o/r/releases/new" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
    expect(unwrapErr(result).message).toContain("rendered no assets upload region");
  });

  it("never takes a token from past the end of the assets region", () => {
    const tokenInNextRegion =
      '<file-attachment data-upload-repository-id="7" data-upload-policy-url="/upload/policies/assets"></file-attachment>' +
      '<file-attachment data-upload-policy-url="/upload/policies/releases">' +
      '<input class="js-data-upload-policy-url-csrf" value="releases-token"></file-attachment>';
    const result = scrapeUploadContext({ html: tokenInNextRegion, url: "https://github.com/o/r/releases/new" });
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
    expect(unwrapErr(result).message).toContain("the upload-policy CSRF input");
  });

  it("never reads an assets policy out of another attribute's quoted value", () => {
    const disguised =
      "<file-attachment title='data-upload-policy-url=\"/upload/policies/assets\"' " +
      'data-upload-policy-url="/upload/policies/releases" data-upload-repository-id="999">' +
      '<input class="js-data-upload-policy-url-csrf" value="releases-token"></file-attachment>';
    const result = scrapeUploadContext({ html: disguised, url: "https://github.com/o/r/releases/new" });
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
    expect(unwrapErr(result).message).toContain("rendered no assets upload region");
  });

  it("does not read a region out of a script body", () => {
    const scripted = `<script>const s = '${UPLOAD_REGION}';</script>`;
    const result = scrapeUploadContext({ html: scripted, url: "https://github.com/o/r/pull/1" });
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
  });

  it("never starts a region at an assets opener inside a comment within a real releases region", () => {
    const commented =
      '<file-attachment data-upload-policy-url="/upload/policies/releases" data-upload-repository-id="999">' +
      '<!-- <file-attachment data-upload-policy-url="/upload/policies/assets" data-upload-repository-id="7"> -->' +
      '<input class="js-data-upload-policy-url-csrf" value="releases-token"></file-attachment>';
    const result = scrapeUploadContext({ html: commented, url: "https://github.com/o/r/releases/new" });
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
    expect(unwrapErr(result).message).toContain("rendered no assets upload region");
  });

  it("never starts a region at an assets opener swallowed by a bogus comment", () => {
    const bogus =
      '<!x <file-attachment data-upload-policy-url="/upload/policies/assets" data-upload-repository-id="7">' +
      '<input class="js-data-upload-policy-url-csrf" value="stray-token">';
    const result = scrapeUploadContext({ html: bogus, url: "https://github.com/o/r/pull/1" });
    expect(unwrapErr(result).message).toContain("rendered no assets upload region");
  });

  it("does not end a script body at a closing tag whose name only starts the same", () => {
    const fakeRegion =
      '<file-attachment data-upload-policy-url="/upload/policies/assets" data-upload-repository-id="7">' +
      '<input class="js-data-upload-policy-url-csrf" value="script-token"></file-attachment>';
    const html = `<script>const x = \`</scriptX>${fakeRegion}\`;</script >${UPLOAD_REGION}`;
    const result = scrapeUploadContext({ html, url: "https://github.com/o/r/pull/1" });
    expect(unwrap(result)).toEqual({ authenticityToken: "page-scraped-token", repositoryId: "1226919613" });
  });

  it("reads nothing after a plaintext tag, since a browser makes the rest of the page text", () => {
    const html =
      '<file-attachment data-upload-policy-url="/upload/policies/releases" data-upload-repository-id="999">' +
      `<plaintext>${UPLOAD_REGION}`;
    const result = scrapeUploadContext({ html, url: "https://github.com/o/r/pull/1" });
    expect(unwrapErr(result).message).toContain("rendered no assets upload region");
  });

  it("does not split a class list on a non-breaking space, which HTML does not separate classes by", () => {
    const html =
      '<file-attachment data-upload-policy-url="/upload/policies/assets" data-upload-repository-id="7">' +
      '<input class="x&nbsp;js-data-upload-policy-url-csrf" value="wrong-token"></file-attachment>';
    const result = scrapeUploadContext({ html, url: "https://github.com/o/r/pull/1" });
    expect(unwrapErr(result).message).toContain("the upload-policy CSRF input");
  });

  it("skips an SVG element that only shares the upload component's name", () => {
    const html =
      '<svg><file-attachment data-upload-policy-url="/upload/policies/assets" data-upload-repository-id="7">' +
      '<input class="js-data-upload-policy-url-csrf" value="svg-token"></input></file-attachment></svg>' +
      UPLOAD_REGION;
    const result = scrapeUploadContext({ html, url: "https://github.com/o/r/pull/1" });
    expect(unwrap(result)).toEqual({ authenticityToken: "page-scraped-token", repositoryId: "1226919613" });
  });

  it("never reads a token from a template's inert content", () => {
    const html =
      '<file-attachment data-upload-repository-id="7" data-upload-policy-url="/upload/policies/assets">' +
      '<template><input class="js-data-upload-policy-url-csrf" value="inert-token"></template></file-attachment>';
    const result = scrapeUploadContext({ html, url: "https://github.com/o/r/pull/1" });
    expect(unwrapErr(result).message).toContain("the upload-policy CSRF input");
  });

  it("does not read a region out of a textarea body", () => {
    const quoted = `<textarea>${UPLOAD_REGION}</textarea>`;
    const result = scrapeUploadContext({ html: quoted, url: "https://github.com/o/r/pull/1" });
    expect(unwrapErr(result).message).toContain("rendered no assets upload region");
  });

  it("reads the real region after a comment that closes at once", () => {
    const result = scrapeUploadContext({ html: `<!--><!--->${UPLOAD_REGION}`, url: "https://github.com/o/r/pull/1" });
    expect(unwrap(result)).toEqual({ authenticityToken: "page-scraped-token", repositoryId: "1226919613" });
  });

  it("reads the token in single quotes and an upper-case tag name", () => {
    const shouty =
      "<FILE-ATTACHMENT DATA-UPLOAD-POLICY-URL='/upload/policies/assets' data-upload-repository-id='42'>" +
      "<INPUT value='quoted-token' class='js-upload x js-data-upload-policy-url-csrf'></FILE-ATTACHMENT>";
    const result = scrapeUploadContext({ html: shouty, url: "https://github.com/o/r/pull/1" });
    expect(unwrap(result)).toEqual({ authenticityToken: "quoted-token", repositoryId: "42" });
  });

  it("ends the assets region at an upper-case next region too, since HTML tag names carry no case", () => {
    const upperCaseNext =
      '<file-attachment data-upload-repository-id="7" data-upload-policy-url="/upload/policies/assets">' +
      '<FILE-ATTACHMENT data-upload-policy-url="/upload/policies/releases">' +
      '<input class="js-data-upload-policy-url-csrf" value="releases-token"></FILE-ATTACHMENT>';
    const result = scrapeUploadContext({ html: upperCaseNext, url: "https://github.com/o/r/releases/new" });
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
    expect(unwrapErr(result).message).toContain("the upload-policy CSRF input");
  });

  it("refuses a page that carries the repository id meta tag but renders no upload region", () => {
    const repoHomePage = '<meta name="octolytics-dimension-repository_id" content="1226919613">';
    const result = scrapeUploadContext({ html: repoHomePage, url: "https://github.com/o/r" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
  });

  it("names both values it looked for when the page has neither", () => {
    const result = scrapeUploadContext({ html: "<html></html>", url: "https://github.com/o/r" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("the upload-policy CSRF input");
    expect(unwrapErr(result).message).toContain("the file-attachment repository id");
  });

  it("refuses when only the repository id is present", () => {
    const partial =
      '<file-attachment data-upload-repository-id="7" data-upload-policy-url="/upload/policies/assets"></file-attachment>';
    const result = scrapeUploadContext({ html: partial, url: "https://github.com/o/r/pull/1" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("the upload-policy CSRF input");
  });

  it("refuses a page with a million sibling elements as a typed failure, never a stack overflow", () => {
    const wide = `<meta name="user-login" content="octocat"><div>${"<i></i>".repeat(1_000_000)}</div>`;
    const result = scrapeUploadContext({ html: wide, url: "https://github.com/o/r/pull/1?overview=false" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
  });
});

describe("isOrgSsoWall", () => {
  it("reads a SAML interstitial as a wall, not as a page with no comment box", () => {
    const wall =
      '<meta name="user-login" content="octocat">' +
      '<a href="/orgs/an-org/sso/sign_in">You must use single sign-on to access this resource</a>';
    expect(isOrgSsoWall({ html: wall })).toBe(true);
  });

  it("does not call a real repository page a wall, even when SSO chrome appears on it", () => {
    const real = '<meta name="octolytics-dimension-repository_id" content="725402259">' + "<span>single sign-on</span>";
    expect(isOrgSsoWall({ html: real })).toBe(false);
  });

  it("does not call an ordinary page a wall", () => {
    expect(isOrgSsoWall({ html: '<meta name="octolytics-dimension-repository_id" content="7">' })).toBe(false);
  });

  it("needs BOTH signals — a page mentioning nothing is not a wall", () => {
    expect(isOrgSsoWall({ html: "<html><body>nothing here</body></html>" })).toBe(false);
  });

  it("catches the saml/initiate form as well as the sso/sign_in link", () => {
    expect(isOrgSsoWall({ html: '<form action="/orgs/x/saml/initiate">' })).toBe(true);
  });
});

describe("isSignedInPage", () => {
  it("reads a signed-in page by the meta tag GitHub renders only when it is", () => {
    expect(isSignedInPage({ html: '<meta name="user-login" content="octocat">' })).toBe(true);
  });

  it("reads a signed-out page — a valid 200 with no upload region on it", () => {
    expect(isSignedInPage({ html: '<meta name="octolytics-dimension-repository_id" content="7">' })).toBe(false);
  });

  it("does not accept an empty user-login as signed in", () => {
    expect(isSignedInPage({ html: '<meta name="user-login" content="">' })).toBe(false);
  });
});
