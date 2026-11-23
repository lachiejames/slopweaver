/**
 * Which pages an attach upload reads its token off: the classic pull-request page first, and the repository's
 * release form when that page renders no upload region. Every failure names the page or pages it read.
 */

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type AttachResponse,
  readUploadContext,
  uploadTokenPageUrls,
} from "../../../../outbound/github/attachClient.js";
import { fakeTransport, reply, TARGET } from "./attachFakes.js";

const SIGNED_IN_PAGE =
  '<meta name="user-login" content="octocat">' +
  '<file-attachment data-upload-repository-id="1226919613" data-upload-policy-url="/upload/policies/assets">' +
  '<input class="js-data-upload-policy-url-csrf" value="page-token"></file-attachment>';

/** GitHub's React pull-request page: signed in, the repository rendered, and no upload region anywhere. */
const REACT_PULL_PAGE =
  '<meta name="user-login" content="octocat">' +
  '<meta name="octolytics-dimension-repository_id" content="1226919613">' +
  '<react-app app-name="repo"></react-app>';

describe("uploadTokenPageUrls", () => {
  it("names the classic pull-request page first and the repository's release form second", () => {
    expect(uploadTokenPageUrls({ target: TARGET })).toEqual({
      classicPullPage: "https://github.com/slopweaver/slopweaver/pull/485?overview=false",
      releaseForm: "https://github.com/slopweaver/slopweaver/releases/new",
    });
  });
});

describe("readUploadContext's release-form fallback", () => {
  it("falls back to the release form when the number's page renders no upload region", async () => {
    const { fetchImpl, sent } = fakeTransport({
      replies: [reply({ body: REACT_PULL_PAGE, status: 200 }), reply({ body: SIGNED_IN_PAGE, status: 200 })],
    });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).repositoryId).toBe("1226919613");
    expect(sent.map((request) => request.url)).toEqual([
      "https://github.com/slopweaver/slopweaver/pull/485?overview=false",
      "https://github.com/slopweaver/slopweaver/releases/new",
    ]);
  });

  it("names both pages when neither renders an upload region", async () => {
    const { fetchImpl } = fakeTransport({
      replies: [reply({ body: REACT_PULL_PAGE, status: 200 }), reply({ body: REACT_PULL_PAGE, status: 200 })],
    });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("SCRAPE_FAILED");
    expect(unwrapErr(result).message).toContain(
      "https://github.com/slopweaver/slopweaver/pull/485?overview=false and " +
        "https://github.com/slopweaver/slopweaver/releases/new rendered no assets upload region",
    );
  });

  it("reads a 404 on the release form as a wrong repository or missing write access, naming both", async () => {
    const { fetchImpl } = fakeTransport({
      replies: [reply({ body: REACT_PULL_PAGE, status: 200 }), reply({ status: 404 })],
    });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("PAGE_UNREADABLE");
    expect(unwrapErr(result).message).toContain(
      "https://github.com/slopweaver/slopweaver/releases/new answered HTTP 404 — " +
        "https://github.com/slopweaver/slopweaver/pull/485?overview=false rendered no upload region",
    );
    expect(unwrapErr(result).message).toContain("both for a wrong repository and for an account that cannot push");
  });

  it("never tries the release form when the pull-request page itself is unreadable", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: [reply({ status: 404 })] });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(unwrapErr(result).code).toBe("PAGE_UNREADABLE");
    expect(sent.length).toBe(1);
  });

  it("returns a typed transport failure naming the page when its body fails mid-read", async () => {
    const torn: AttachResponse = { status: 200, text: () => Promise.reject(new Error("body read failed")) };
    const { fetchImpl } = fakeTransport({ replies: [torn] });
    const result = await readUploadContext({
      cookieHeader: "user_session=live",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
    expect(unwrapErr(result).message).toBe(
      "request to https://github.com/slopweaver/slopweaver/pull/485?overview=false did not complete: body read failed",
    );
  });

  it("names the pull-request page too when the release-form fallback hits an SSO wall", async () => {
    const wall = '<meta name="user-login" content="octocat">' + '<a href="/orgs/an-org/sso/sign_in">single sign-on</a>';
    const { fetchImpl } = fakeTransport({
      replies: [reply({ body: REACT_PULL_PAGE, status: 200 }), reply({ body: wall, status: 200 })],
    });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(unwrapErr(result).code).toBe("ORG_SSO_REQUIRED");
    expect(unwrapErr(result).message).toContain(
      "https://github.com/slopweaver/slopweaver/pull/485?overview=false rendered no upload region, so " +
        "https://github.com/slopweaver/slopweaver/releases/new was read: ",
    );
  });
});
