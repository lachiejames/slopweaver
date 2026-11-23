import { describe, expect, it } from "vitest";

import { BUNDLE_ID } from "../../../desktop/installPlan.js";
import {
  certificateArgs,
  certificateSha1,
  designatedRequirement,
  grantsNeedReset,
  identityRequirement,
  recordedRequirement,
} from "../../../desktop/signing.js";

const SHA1 = "85E8D67CA8047CB356EC5B71AB28E67594A5BBDD";

describe("certificateArgs", () => {
  it("mints a code-signing leaf that is never a certificate authority", () => {
    const args = certificateArgs({ certPath: "/t/cert.pem", keyPath: "/t/key.pem" });
    expect(args.slice(0, 2)).toEqual(["req", "-x509"]);
    expect(args).toContain("extendedKeyUsage=critical,codeSigning");
    expect(args).toContain("basicConstraints=critical,CA:false");
    expect(args[args.indexOf("-subj") + 1]).toBe("/CN=Slopweaver Local Signing");
  });
});

describe("certificateSha1", () => {
  it("reads the SHA-1 line security prints, not the SHA-256 above it", () => {
    const text = `SHA-256 hash: 11B3902D1F792198B9B651683746B7BD25E7B140DE02683B2D00B07C721E21B0\nSHA-1 hash: ${SHA1}\nkeychain: "/k"`;
    expect(certificateSha1({ text })).toBe(SHA1);
  });

  it("is undefined when the keychain printed no certificate", () => {
    expect(certificateSha1({ text: "" })).toBeUndefined();
  });
});

describe("designatedRequirement", () => {
  it("reads the requirement codesign prints with its comment prefix", () => {
    expect(
      designatedRequirement({ text: '# designated => cdhash H"c79a36e697419b71ef58bbfa695b6095d73d3b5d"\n' }),
    ).toBe('cdhash H"c79a36e697419b71ef58bbfa695b6095d73d3b5d"');
  });

  it("is undefined when there is no requirement line", () => {
    expect(designatedRequirement({ text: "Executable=/Applications/Slopweaver.app/Contents/MacOS/Slopweaver" })).toBe(
      undefined,
    );
  });
});

describe("identityRequirement", () => {
  it("names the bundle and the leaf in the lowercase spelling codesign prints", () => {
    expect(identityRequirement({ sha1: SHA1 })).toBe(
      `identifier "${BUNDLE_ID}" and certificate leaf = H"85e8d67ca8047cb356ec5b71ab28e67594a5bbdd"`,
    );
  });
});

describe("grantsNeedReset", () => {
  const next = identityRequirement({ sha1: SHA1 });

  it("keeps the grants once they were cleared for this signature", () => {
    expect(grantsNeedReset({ next, recorded: next, replaced: next })).toBe(false);
  });

  it("keeps them when the build being replaced could not be read, since the record covers a build this install made", () => {
    expect(grantsNeedReset({ next, recorded: next, replaced: undefined })).toBe(false);
  });

  it("clears them when the build being replaced is not the identity's, though the record matches", () => {
    expect(grantsNeedReset({ next, recorded: next, replaced: 'cdhash H"c79a36e6"' })).toBe(true);
  });

  it("clears them when they were last cleared for an ad-hoc build's cdhash", () => {
    expect(grantsNeedReset({ next, recorded: 'cdhash H"f549155d"', replaced: next })).toBe(true);
  });

  it("clears them when no clear is recorded, since a grant outlives the build it was made to", () => {
    expect(grantsNeedReset({ next, recorded: undefined, replaced: undefined })).toBe(true);
  });
});

describe("recordedRequirement", () => {
  it("reads the requirement without its newline", () => {
    expect(recordedRequirement({ text: 'identifier "x" and certificate leaf = H"ab"\n' })).toBe(
      'identifier "x" and certificate leaf = H"ab"',
    );
  });

  it("is undefined for an empty record", () => {
    expect(recordedRequirement({ text: "\n" })).toBeUndefined();
  });
});
