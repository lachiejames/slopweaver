import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type AttachAssetFetch,
  GITHUB_USER_ASSET_BUCKET_HOST,
  readBackAsset,
  readBackRedirectProblem,
  readBackVerdict,
} from "../../../../outbound/github/attachReadBack.js";
import { imageDigestOf } from "../../../../visualEvidence/imageIo.js";
import { SIGNED_ASSET_URL, servingReadBack } from "../../../attachEvidenceFixture.js";

const HREF = "https://github.com/user-attachments/assets/uuid-1";
const BYTES = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);

/** A transport that answers every request with one fixed response. */
function answering({ status, location }: { status: number; location: string | null }): AttachAssetFetch {
  return () => Promise.resolve({ bytes: () => Promise.resolve(BYTES), location, status });
}

describe("readBackRedirectProblem", () => {
  it("accepts an https attachment host", () => {
    expect(readBackRedirectProblem({ location: SIGNED_ASSET_URL })).toBeNull();
  });

  it("accepts GitHub's own asset bucket, the host a real upload's read-back redirected to", () => {
    expect(
      readBackRedirectProblem({
        location: `https://${GITHUB_USER_ASSET_BUCKET_HOST}/1/asset.png?X-Amz-Signature=FIXTURE`,
      }),
    ).toBeNull();
  });

  it("accepts the other signed attachment host, so every trusted host has a witness", () => {
    expect(readBackRedirectProblem({ location: "https://user-images.githubusercontent.com/1/a.png" })).toBeNull();
  });

  it.each([
    ["another GitHub bucket", "https://github-production-release-asset-2e65be.s3.amazonaws.com/x"],
    ["a bucket one character off", "https://github-production-user-asset-6210de.s3.amazonaws.com/x"],
    ["a prefixed look-alike", "https://evil-github-production-user-asset-6210df.s3.amazonaws.com/x"],
    ["the bucket as a subdomain of a foreign host", `https://${GITHUB_USER_ASSET_BUCKET_HOST}.attacker.example/x`],
    ["a subdomain under the bucket", `https://cdn.${GITHUB_USER_ASSET_BUCKET_HOST}/x`],
    ["the bare S3 endpoint, path-style", "https://s3.amazonaws.com/github-production-user-asset-6210df/x"],
    [
      "the bucket name as userinfo before a foreign host",
      `https://${GITHUB_USER_ASSET_BUCKET_HOST}@attacker.example/x`,
    ],
  ])("refuses %s, naming only its host", (_label, location) => {
    const host = new URL(location).hostname;
    expect(readBackRedirectProblem({ location })).toBe(
      `the redirect points at https://${host}, not a GitHub attachment host`,
    );
  });

  it("refuses the bucket over plain http, naming the scheme and host only", () => {
    const refusal = readBackRedirectProblem({
      location: `http://${GITHUB_USER_ASSET_BUCKET_HOST}/x?X-Amz-Signature=SIGNEDFIXTURE`,
    });
    expect(refusal).toBe(
      `the redirect points at http://${GITHUB_USER_ASSET_BUCKET_HOST}, not a GitHub attachment host`,
    );
    expect(refusal).not.toContain("SIGNEDFIXTURE");
  });

  it.each([
    ["userinfo before the bucket", `https://user@${GITHUB_USER_ASSET_BUCKET_HOST}/x`],
    ["a non-default port", `https://${GITHUB_USER_ASSET_BUCKET_HOST}:444/x`],
    ["an explicit default port, which parsing erases", `https://${GITHUB_USER_ASSET_BUCKET_HOST}:443/x`],
    ["an uppercase host, which parsing lowercases", `https://${GITHUB_USER_ASSET_BUCKET_HOST.toUpperCase()}/x`],
    ["an uppercase scheme, which parsing lowercases", `HTTPS://${GITHUB_USER_ASSET_BUCKET_HOST}/x`],
    ["leading whitespace, which parsing trims", ` https://${GITHUB_USER_ASSET_BUCKET_HOST}/x`],
  ])("refuses the bucket spelled with %s", (_label, location) => {
    expect(readBackRedirectProblem({ location })).toBe(
      `the redirect to ${GITHUB_USER_ASSET_BUCKET_HOST} is not spelled as the bare host, so it is not a GitHub asset address`,
    );
  });

  it("refuses a missing Location, a relative one, plain http and a foreign host, naming only the host", () => {
    expect(readBackRedirectProblem({ location: null })).toBe("the redirect carried no Location");
    expect(readBackRedirectProblem({ location: "/assets/1" })).toBe(
      "the redirect's Location is not an absolute address",
    );
    expect(
      readBackRedirectProblem({ location: "http://private-user-images.githubusercontent.com/1?jwt=FIXTURE" }),
    ).toBe("the redirect points at http://private-user-images.githubusercontent.com, not a GitHub attachment host");
    expect(readBackRedirectProblem({ location: "https://attacker.example/x?jwt=FIXTURE" })).toBe(
      "the redirect points at https://attacker.example, not a GitHub attachment host",
    );
  });
});

describe("readBackAsset", () => {
  it("sends the cookie to the asset address only, and follows the redirect without it", async () => {
    const seen: { url: string; cookieHeader: string | undefined }[] = [];
    const served = unwrap(
      await readBackAsset({
        cookieHeader: "user_session=v",
        fetchAsset: servingReadBack({ seen, served: BYTES }),
        href: HREF,
      }),
    );
    expect(served).toStrictEqual(BYTES);
    expect(seen).toStrictEqual([
      { cookieHeader: "user_session=v", url: HREF },
      { cookieHeader: undefined, url: SIGNED_ASSET_URL },
    ]);
  });

  it("follows a redirect to GitHub's asset bucket without the cookie and returns its bytes", async () => {
    const bucket = `https://${GITHUB_USER_ASSET_BUCKET_HOST}/1/asset.png?X-Amz-Signature=FIXTURE`;
    const seen: { url: string; cookieHeader: string | undefined }[] = [];
    const fetchAsset: AttachAssetFetch = ({ url, cookieHeader }) => {
      seen.push({ cookieHeader, url });
      const location = url === HREF ? bucket : null;
      return Promise.resolve({ bytes: () => Promise.resolve(BYTES), location, status: url === HREF ? 302 : 200 });
    };
    expect(unwrap(await readBackAsset({ cookieHeader: "user_session=v", fetchAsset, href: HREF }))).toStrictEqual(
      BYTES,
    );
    expect(seen).toStrictEqual([
      { cookieHeader: "user_session=v", url: HREF },
      { cookieHeader: undefined, url: bucket },
    ]);
  });

  it.each([
    ["a foreign host serving a direct 200", "https://attacker.example/user-attachments/assets/uuid-1"],
    ["GitHub's bucket named as the asset address", `https://${GITHUB_USER_ASSET_BUCKET_HOST}/1/asset.png`],
    ["github.com over plain http", "http://github.com/user-attachments/assets/uuid-1"],
    ["a look-alike of github.com", "https://github.com.attacker.example/user-attachments/assets/uuid-1"],
    ["github.com off the assets path", "https://github.com/user-attachments/assets/uuid-1/../../login"],
    ["userinfo before github.com", "https://user@github.com/user-attachments/assets/uuid-1"],
    ["github.com on a non-default port", "https://github.com:444/user-attachments/assets/uuid-1"],
    ["github.com on an explicit default port", "https://github.com:443/user-attachments/assets/uuid-1"],
    ["a query on the asset address", "https://github.com/user-attachments/assets/uuid-1?next=x"],
    ["a fragment on the asset address", "https://github.com/user-attachments/assets/uuid-1#x"],
    ["an uppercase host", "https://GITHUB.COM/user-attachments/assets/uuid-1"],
  ])("refuses %s before sending anything, cookie included", async (_label, href) => {
    const seen: string[] = [];
    const fetchAsset: AttachAssetFetch = ({ url }) => {
      seen.push(url);
      return Promise.resolve({ bytes: () => Promise.resolve(BYTES), location: null, status: 200 });
    };
    const error = unwrapErr(await readBackAsset({ cookieHeader: "user_session=v", fetchAsset, href }));
    expect(error.code).toBe("READ_BACK_FAILED");
    expect(error.message).toContain("is not https://github.com/user-attachments/assets/<id>");
    expect(seen).toStrictEqual([]);
  });

  it("accepts a direct 200 from the asset address", async () => {
    const served = unwrap(
      await readBackAsset({ cookieHeader: "c", fetchAsset: answering({ location: null, status: 200 }), href: HREF }),
    );
    expect(served).toStrictEqual(BYTES);
  });

  it("refuses a redirect to a host that is not GitHub's, without fetching it", async () => {
    const error = unwrapErr(
      await readBackAsset({
        cookieHeader: "c",
        fetchAsset: answering({ location: "https://attacker.example/x", status: 302 }),
        href: HREF,
      }),
    );
    expect(error.code).toBe("READ_BACK_FAILED");
    expect(error.message).toContain("https://attacker.example, not a GitHub attachment host");
  });

  it("refuses a status other than 200 and a transport that throws", async () => {
    const notFound = unwrapErr(
      await readBackAsset({ cookieHeader: "c", fetchAsset: answering({ location: null, status: 404 }), href: HREF }),
    );
    expect(notFound.code).toBe("READ_BACK_FAILED");
    expect(notFound.message).toContain("HTTP 404");
    const thrown = unwrapErr(
      await readBackAsset({
        cookieHeader: "c",
        fetchAsset: () => Promise.reject(new Error("socket hang up")),
        href: HREF,
      }),
    );
    expect(thrown.message).toContain("socket hang up");
  });
});

describe("readBackVerdict", () => {
  it("returns the digest when the served bytes are the sent bytes", () => {
    const digest = imageDigestOf({ bytes: BYTES });
    expect(unwrap(readBackVerdict({ href: HREF, sentDigest: digest, served: BYTES }))).toBe(digest);
  });

  it("refuses served bytes that differ from the sent bytes", () => {
    const error = unwrapErr(
      readBackVerdict({ href: HREF, sentDigest: imageDigestOf({ bytes: BYTES }), served: Uint8Array.from([0]) }),
    );
    expect(error.code).toBe("READ_BACK_MISMATCH");
  });
});
