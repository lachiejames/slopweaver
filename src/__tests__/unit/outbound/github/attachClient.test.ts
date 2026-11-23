/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type AttachFetch,
  type AttachResponse,
  readOrgGrant,
  readOwnerGrant,
  readUploadContext,
  targetPageUrl,
} from "../../../../outbound/github/attachClient.js";
import { classifyAttachment } from "../../../../outbound/github/attachment.js";
import { uploadAttachment } from "../../../../outbound/github/attachUpload.js";
import { BYTES, CLASSIFIED, CONTEXT, fakeTransport, POLICY_BODY, reply, TARGET } from "./attachFakes.js";

const SIGNED_IN_PAGE =
  '<meta name="user-login" content="octocat">' +
  '<file-attachment data-upload-repository-id="1226919613" data-upload-policy-url="/upload/policies/assets">' +
  '<input class="js-data-upload-policy-url-csrf" value="page-token"></file-attachment>';

describe("targetPageUrl", () => {
  it("addresses the pull-request page the upload is attributed to", () => {
    expect(targetPageUrl({ target: TARGET })).toBe("https://github.com/slopweaver/slopweaver/pull/485");
  });
});

describe("readUploadContext", () => {
  it("scrapes the token off the classic pull-request page and asks for nothing else", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: [reply({ body: SIGNED_IN_PAGE, status: 200 })] });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).authenticityToken).toBe("page-token");
    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET https://github.com/slopweaver/slopweaver/pull/485?overview=false",
    ]);
    expect(sent[0]?.headers["cookie"]).toBe("user_session=v");
  });

  it("reports an anonymous 200 as an expired session, not as a failed scrape", async () => {
    const anonymous = '<meta name="octolytics-dimension-repository_id" content="7">';
    const { fetchImpl } = fakeTransport({ replies: [reply({ body: anonymous, status: 200 })] });
    const result = await readUploadContext({
      cookieHeader: "user_session=stale",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("WEB_SESSION_EXPIRED");
    expect(unwrapErr(result).message).toContain("https://github.com/slopweaver/slopweaver/pull/485?overview=false");
  });

  it("reports an SSO wall by name rather than as a page with no upload region", async () => {
    const wall = '<meta name="user-login" content="octocat">' + '<a href="/orgs/an-org/sso/sign_in">single sign-on</a>';
    const { fetchImpl } = fakeTransport({ replies: [reply({ body: wall, status: 200 })] });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("ORG_SSO_REQUIRED");
    expect(unwrapErr(result).message).toContain("separate grant");
  });

  it("reports a 404 against the page rather than guessing why", async () => {
    const { fetchImpl } = fakeTransport({ replies: [reply({ status: 404 })] });
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("PAGE_UNREADABLE");
  });

  it("turns a thrown transport failure into a typed error", async () => {
    const fetchImpl: AttachFetch = () => Promise.reject(new Error("ECONNRESET"));
    const result = await readUploadContext({
      cookieHeader: "user_session=v",
      fetchImpl,
      sessionPath: "state-home/github-web-session.json",
      target: TARGET,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
    expect(unwrapErr(result).message).toContain("ECONNRESET");
  });
});

describe("uploadAttachment", () => {
  const happyReplies = [
    reply({ body: POLICY_BODY, status: 201 }),
    reply({ status: 204 }),
    reply({ body: '{"id":999}', status: 200 }),
  ];
  /** What every upload below sends bar its bytes and transport: a picture whose pixels show no text. */
  const SEND = {
    classified: CLASSIFIED,
    context: CONTEXT,
    cookieHeader: "user_session=v",
    pixelText: [],
    refererUrl: targetPageUrl({ target: TARGET }),
  } as const;

  it("completes all three calls and returns the permanent href", async () => {
    const { fetchImpl } = fakeTransport({ replies: happyReplies });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).href).toBe("https://github.com/user-attachments/assets/uuid-1");
    expect(unwrap(result).assetId).toBe(999);
  });

  it("refuses a file whose bytes carry a dead Datadog host, before the first call", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    const result = await uploadAttachment({
      bytes: new TextEncoder().encode('<svg><a href="https://app.ap1.datadoghq.com/monitors/1"/></svg>'),
      ...SEND,
      fetchImpl,
    });
    expect(unwrapErr(result).code).toBe("DEAD_DATADOG_HOST");
    expect(unwrapErr(result).message).toContain("use ap1.datadoghq.com — found at file");
    expect(sent).toEqual([]);
  });

  it("refuses a picture whose PIXELS show a dead Datadog host, before the first call", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    const result = await uploadAttachment({
      bytes: BYTES,
      classified: CLASSIFIED,
      context: CONTEXT,
      cookieHeader: "user_session=v",
      fetchImpl,
      pixelText: ["Monitors", "https://app.ap1.datadoghq.com/monitors/1"],
      refererUrl: targetPageUrl({ target: TARGET }),
    });
    expect(unwrapErr(result).code).toBe("DEAD_DATADOG_HOST");
    expect(unwrapErr(result).message).toContain("use ap1.datadoghq.com — found at pixelText");
    expect(sent).toEqual([]);
  });

  it("refuses a file whose NAME carries a dead Datadog host, since the policy call sends it", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    const result = await uploadAttachment({
      bytes: BYTES,
      classified: unwrap(classifyAttachment({ byteLength: 4, fileName: "app.ap1.datadoghq.com monitor.png" })),
      context: CONTEXT,
      cookieHeader: "user_session=v",
      fetchImpl,
      pixelText: [],
      refererUrl: targetPageUrl({ target: TARGET }),
    });
    expect(unwrapErr(result).message).toContain("use ap1.datadoghq.com — found at fileName");
    expect(sent).toEqual([]);
  });

  it("refuses a policy whose form carries a dead Datadog host, before the bytes move", async () => {
    const policy = JSON.stringify({
      ...(JSON.parse(POLICY_BODY) as Record<string, unknown>),
      form: { key: "k", note: "https://app.ap1.datadoghq.com/monitors/1" },
    });
    const { fetchImpl, sent } = fakeTransport({ replies: [reply({ body: policy, status: 201 })] });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(unwrapErr(result).message).toContain("use ap1.datadoghq.com — found at body.note");
    expect(sent.map((request) => request.url)).toEqual(["https://github.com/upload/policies/assets"]);
  });

  it("refuses a policy whose finalize token carries a dead Datadog host, before finalizing", async () => {
    const policy = JSON.stringify({
      ...(JSON.parse(POLICY_BODY) as Record<string, unknown>),
      asset_upload_authenticity_token: "https://app.ap1.datadoghq.com/monitors/1",
    });
    const { fetchImpl, sent } = fakeTransport({
      replies: [reply({ body: policy, status: 201 }), reply({ status: 204 })],
    });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(unwrapErr(result).message).toContain("use ap1.datadoghq.com — found at body.authenticity_token");
    expect(sent.map((request) => request.url)).toEqual([
      "https://github.com/upload/policies/assets",
      "https://github-production-user-asset-6210df.s3.amazonaws.com",
    ]);
  });

  it("refuses a page token carrying a dead Datadog host, sending nothing", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    const result = await uploadAttachment({
      bytes: BYTES,
      classified: CLASSIFIED,
      context: { ...CONTEXT, authenticityToken: "https://app.ap1.datadoghq.com/monitors/1" },
      cookieHeader: "user_session=v",
      fetchImpl,
      pixelText: [],
      refererUrl: targetPageUrl({ target: TARGET }),
    });
    expect(unwrapErr(result).message).toContain("use ap1.datadoghq.com — found at body.authenticity_token");
    expect(sent).toEqual([]);
  });

  it("sends exactly three requests, to the policy path, the bucket and the finalize path", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://github.com/upload/policies/assets",
      "POST https://github-production-user-asset-6210df.s3.amazonaws.com",
      "PUT https://github.com/upload/assets/999",
    ]);
  });

  it("appends the file LAST on the bucket call, after every signature field", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(sent[1]?.fieldNames).toEqual(["X-Amz-Signature", "key", "policy", "file"]);
  });

  it("sends the bytes it was given", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(sent[1]?.fields["file"]).toBe("<file:4>");
  });

  it("finalizes with the token the policy response handed back, never a re-scraped page token", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(sent[2]?.fields["authenticity_token"]).toBe("finalize-token");
    expect(sent[2]?.fields["authenticity_token"]).not.toBe("page-token");
  });

  it("declares the origin and the page the upload belongs to", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(sent[0]?.headers["origin"]).toBe("https://github.com");
    expect(sent[0]?.headers["referer"]).toBe("https://github.com/slopweaver/slopweaver/pull/485");
    expect(sent[0]?.headers["x-requested-with"]).toBe("XMLHttpRequest");
  });

  it("never sends a github.com cookie to the presigned bucket", async () => {
    const { fetchImpl, sent } = fakeTransport({ replies: happyReplies });
    await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(sent[1]?.headers["cookie"]).toBeUndefined();
  });

  it("carries GitHub's own refusal text through when the policy is refused", async () => {
    const refusal = JSON.stringify({ errors: [{ field: "size", message: "This video is too big." }] });
    const { fetchImpl } = fakeTransport({ replies: [reply({ body: refusal, status: 422 })] });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("POLICY_REFUSED");
    expect(unwrapErr(result).message).toContain("This video is too big.");
  });

  it("stops after the bucket refuses the bytes, and never finalizes", async () => {
    const { fetchImpl, sent } = fakeTransport({
      replies: [reply({ body: POLICY_BODY, status: 201 }), reply({ status: 403 })],
    });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("BYTES_REFUSED");
    expect(sent.length).toBe(2);
  });

  it("refuses to report success when the bytes landed but finalizing did not", async () => {
    const { fetchImpl } = fakeTransport({
      replies: [reply({ body: POLICY_BODY, status: 201 }), reply({ status: 204 }), reply({ status: 422 })],
    });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("FINALIZE_REFUSED");
    expect(unwrapErr(result).message).toContain("not safe to embed");
  });

  it("still uploads when the bucket's 204 and the finalize 200 tear their bodies, since neither is read", async () => {
    const torn = ({ status }: { status: number }): AttachResponse => ({
      status,
      text: () => Promise.reject(new Error("stream torn after headers")),
    });
    const { fetchImpl } = fakeTransport({
      replies: [reply({ body: POLICY_BODY, status: 201 }), torn({ status: 204 }), torn({ status: 200 })],
    });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).href).toBe("https://github.com/user-attachments/assets/uuid-1");
  });

  it("names a torn body on a refused bucket call as a transport failure, never a success", async () => {
    const { fetchImpl } = fakeTransport({
      replies: [
        reply({ body: POLICY_BODY, status: 201 }),
        { status: 403, text: () => Promise.reject(new Error("stream torn after headers")) },
      ],
    });
    const result = await uploadAttachment({
      bytes: BYTES,
      ...SEND,
      fetchImpl,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
  });
});

describe("readOrgGrant", () => {
  const grantFetch = ({ answer }: { answer: AttachResponse }): { fetchImpl: AttachFetch; urls: string[] } => {
    const urls: string[] = [];
    return {
      fetchImpl: ({ url }) => {
        urls.push(url);
        return Promise.resolve(answer);
      },
      urls,
    };
  };

  it("reads an authorised organisation as granted, off its own page", async () => {
    const { fetchImpl, urls } = grantFetch({
      answer: { status: 200, text: () => Promise.resolve('<meta name="user-login" content="octocat">') },
    });
    const verdict = await readOrgGrant({ cookieHeader: "user_session=v", fetchImpl, org: "acme" });
    expect(verdict.isOk()).toBe(true);
    expect(unwrap(verdict)).toBe("granted");
    expect(urls).toEqual(["https://github.com/orgs/acme"]);
  });

  it("reads the interstitial as walled rather than as a page with nothing on it", async () => {
    const { fetchImpl } = grantFetch({
      answer: {
        status: 200,
        text: () =>
          Promise.resolve('<meta name="user-login" content="octocat"><a href="/orgs/acme/sso/sign_in">go</a>'),
      },
    });
    expect(unwrap(await readOrgGrant({ cookieHeader: "user_session=v", fetchImpl, org: "acme" }))).toBe("walled");
  });

  it("reports a non-200 as an unreadable page rather than guessing a verdict", async () => {
    const { fetchImpl } = grantFetch({ answer: { status: 404, text: () => Promise.resolve("") } });
    const verdict = await readOrgGrant({ cookieHeader: "user_session=v", fetchImpl, org: "acme" });
    expect(verdict.isErr()).toBe(true);
    expect(unwrapErr(verdict).code).toBe("PAGE_UNREADABLE");
  });

  it("sends the session cookies, since an anonymous read would report every org as signed-out", async () => {
    const sent: Record<string, string>[] = [];
    const fetchImpl: AttachFetch = ({ headers }) => {
      sent.push({ ...headers });
      return Promise.resolve({ status: 200, text: () => Promise.resolve('<meta name="user-login" content="o">') });
    };
    await readOrgGrant({ cookieHeader: "user_session=secret", fetchImpl, org: "acme" });
    expect(sent[0]!["cookie"]).toBe("user_session=secret");
  });
});

describe("readOwnerGrant", () => {
  const SIGNED_IN = '<meta name="user-login" content="octocat">';
  const byUrl = ({
    answers,
  }: {
    answers: Readonly<Record<string, AttachResponse>>;
  }): { fetchImpl: AttachFetch; urls: string[] } => {
    const urls: string[] = [];
    return {
      fetchImpl: ({ url }) => {
        urls.push(url);
        return Promise.resolve(answers[url]!);
      },
      urls,
    };
  };
  const page = ({ status, body }: { status: number; body: string }): AttachResponse => ({
    status,
    text: () => Promise.resolve(body),
  });

  it("reads an organisation's grant off its own page and nothing else", async () => {
    const { fetchImpl, urls } = byUrl({
      answers: { "https://github.com/orgs/acme": page({ body: SIGNED_IN, status: 200 }) },
    });
    const grant = await readOwnerGrant({ cookieHeader: "user_session=v", fetchImpl, owner: "acme" });
    expect(unwrap(grant)).toEqual({ account: "organisation", verdict: "granted" });
    expect(urls).toEqual(["https://github.com/orgs/acme"]);
  });

  it("reads a personal account, whose organisation page is a 404, as signed in off its profile page", async () => {
    const { fetchImpl, urls } = byUrl({
      answers: {
        "https://github.com/octocat": page({ body: SIGNED_IN, status: 200 }),
        "https://github.com/orgs/octocat": page({ body: "", status: 404 }),
      },
    });
    const grant = await readOwnerGrant({ cookieHeader: "user_session=v", fetchImpl, owner: "octocat" });
    expect(unwrap(grant)).toEqual({ account: "personal", verdict: "signed-in" });
    expect(urls).toEqual(["https://github.com/orgs/octocat", "https://github.com/octocat"]);
  });

  it("reads a personal account's profile with no signed-in marker as signed out, sign-on text or not", async () => {
    const { fetchImpl } = byUrl({
      answers: {
        "https://github.com/octocat": page({ body: '<a href="/orgs/x/sso/sign_in">single sign-on</a>', status: 200 }),
        "https://github.com/orgs/octocat": page({ body: "", status: 404 }),
      },
    });
    const grant = await readOwnerGrant({ cookieHeader: "user_session=v", fetchImpl, owner: "octocat" });
    expect(unwrap(grant)).toEqual({ account: "personal", verdict: "signed-out" });
  });

  it("names the profile page when neither page exists", async () => {
    const { fetchImpl } = byUrl({
      answers: {
        "https://github.com/nobody": page({ body: "", status: 404 }),
        "https://github.com/orgs/nobody": page({ body: "", status: 404 }),
      },
    });
    const failure = unwrapErr(await readOwnerGrant({ cookieHeader: "user_session=v", fetchImpl, owner: "nobody" }));
    expect(failure.code).toBe("PAGE_UNREADABLE");
    expect(failure.message).toBe(
      "https://github.com/nobody answered HTTP 404 — check the repository and number are right",
    );
  });

  it("sends the session cookies on the profile read too, since an anonymous one reads every account signed out", async () => {
    const sent: { url: string; cookie: string | undefined }[] = [];
    const fetchImpl: AttachFetch = ({ url, headers }) => {
      sent.push({ cookie: headers["cookie"], url });
      return Promise.resolve(
        url.includes("/orgs/") ? page({ body: "", status: 404 }) : page({ body: SIGNED_IN, status: 200 }),
      );
    };
    await readOwnerGrant({ cookieHeader: "user_session=secret", fetchImpl, owner: "octocat" });
    expect(sent).toEqual([
      { cookie: "user_session=secret", url: "https://github.com/orgs/octocat" },
      { cookie: "user_session=secret", url: "https://github.com/octocat" },
    ]);
  });

  it("passes an organisation page's other failure through without reading a second page", async () => {
    const { fetchImpl, urls } = byUrl({
      answers: { "https://github.com/orgs/acme": page({ body: "", status: 500 }) },
    });
    const failure = unwrapErr(await readOwnerGrant({ cookieHeader: "user_session=v", fetchImpl, owner: "acme" }));
    expect(failure.message).toBe(
      "https://github.com/orgs/acme answered HTTP 500 — check the repository and number are right",
    );
    expect(urls).toEqual(["https://github.com/orgs/acme"]);
  });
});
