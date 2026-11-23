/**
 * The two JumpCloud operations that answer with a file — `src/atlas/jumpcloud/fileResponses.ts`.
 *
 * Each decoder must store public certificate material and REFUSE a body carrying a private key, so the
 * refusal cases are asserted beside the happy ones rather than left to the sensitivity gate alone.
 */
import { describe, expect, it } from "vitest";

import { JUMPCLOUD_FILE_RESPONSES } from "../../../../atlas/jumpcloud/fileResponses.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const CERT = "-----BEGIN CERTIFICATE-----\nMIIFpublic\n-----END CERTIFICATE-----";
const depkey = JUMPCLOUD_FILE_RESPONSES["v2-applemdms-depkeyget"]!;
const csr = JUMPCLOUD_FILE_RESPONSES["v2-applemdms-csrget"]!;

/**
 * An Apple push-certificate request, encoded the way the provider sends it.
 *
 * @param entries the plist's string entries
 * @returns the base64 body
 */
function encodedPlist({ entries }: { entries: Readonly<Record<string, string>> }): string {
  const body = Object.entries(entries)
    .map(([key, value]) => `<key>${key}</key>\n<string>${value}</string>`)
    .join("\n");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n${body}\n</dict></plist>`;
  return Buffer.from(plist, "utf8").toString("base64");
}

describe("the DEP public key", () => {
  it("is asked for as a PEM file, because the provider answers JSON with 406", () => {
    expect(depkey.accept).toBe("application/x-pem-file");
  });

  it("stores each PEM block with its type", () => {
    expect(unwrap(depkey.decode({ surface: "v2-applemdms-depkeyget", text: CERT }))).toStrictEqual({
      blocks: [{ pem: CERT, type: "CERTIFICATE" }],
      format: "pem",
    });
  });

  it("refuses a body carrying a private key rather than storing it", () => {
    const body = `${CERT}\n-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----`;
    expect(unwrapErr(depkey.decode({ surface: "v2-applemdms-depkeyget", text: body })).code).toBe("UNEXPECTED_SHAPE");
    expect(unwrapErr(depkey.decode({ surface: "v2-applemdms-depkeyget", text: body })).message).toContain(
      "the body carries a private key block, which this atlas never stores",
    );
  });

  it("refuses a body with no PEM block at all", () => {
    expect(unwrapErr(depkey.decode({ surface: "v2-applemdms-depkeyget", text: "{}" })).code).toBe("UNEXPECTED_SHAPE");
    expect(unwrapErr(depkey.decode({ surface: "v2-applemdms-depkeyget", text: "{}" })).message).toContain(
      "the body carries no PEM block",
    );
  });
});

describe("the push-certificate request", () => {
  it("stores the plist's three public string entries by key", () => {
    const text = encodedPlist({
      entries: { PushCertCertificateChain: CERT, PushCertRequestCSR: "MIICcsr", PushCertSignature: "c2ln" },
    });
    expect(unwrap(csr.decode({ surface: "v2-applemdms-csrget", text }))).toStrictEqual({
      PushCertCertificateChain: CERT,
      PushCertRequestCSR: "MIICcsr",
      PushCertSignature: "c2ln",
      format: "apple-push-certificate-request",
    });
  });

  it("refuses a plist carrying a private key block", () => {
    const text = encodedPlist({ entries: { Leak: "-----BEGIN EC PRIVATE KEY-----\nMHcC" } });
    expect(unwrapErr(csr.decode({ surface: "v2-applemdms-csrget", text })).code).toBe("UNEXPECTED_SHAPE");
    expect(unwrapErr(csr.decode({ surface: "v2-applemdms-csrget", text })).message).toContain(
      "the property list carries a private key block, which this atlas never stores",
    );
  });

  it("refuses a body that does not decode to a property list", () => {
    expect(
      unwrapErr(csr.decode({ surface: "v2-applemdms-csrget", text: Buffer.from("not a plist").toString("base64") }))
        .code,
    ).toBe("UNEXPECTED_SHAPE");
    expect(
      unwrapErr(csr.decode({ surface: "v2-applemdms-csrget", text: Buffer.from("not a plist").toString("base64") }))
        .message,
    ).toContain("the body does not decode to a property list");
  });
});
