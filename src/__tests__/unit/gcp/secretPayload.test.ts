/**
 * The secret payload's checks — CRC32C, base64 both ways, the size bound — and the fingerprint printed in place
 * of its bytes.
 */
import { describe, expect, it } from "vitest";

import {
  crc32c,
  decodeSecretPayload,
  encodeSecretPayload,
  fingerprint,
  SECRET_PAYLOAD_MAX_BYTES,
} from "../../../gcp/secretPayload.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const text = ({ value }: { value: string }): Uint8Array => new TextEncoder().encode(value);

describe("crc32c", () => {
  it("is Castagnoli's check value for the standard vector, not zlib's CRC32", () => {
    expect(crc32c({ bytes: text({ value: "123456789" }) })).toBe(0xe3_06_92_83);
  });

  it("is zero for no bytes", () => {
    expect(crc32c({ bytes: new Uint8Array() })).toBe(0);
  });
});

describe("fingerprint", () => {
  it("names the length, the trailing newline and the sha256", () => {
    expect(fingerprint({ bytes: text({ value: "abc\n" }) })).toEqual({
      length: 4,
      sha256: "edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb",
      trailingNewline: true,
    });
  });
});

describe("encodeSecretPayload", () => {
  it("encodes base64 and the CRC32C as decimal text", () => {
    const encoded = unwrap(encodeSecretPayload({ bytes: text({ value: "123456789" }) }));
    expect([encoded.data, encoded.dataCrc32c, encoded.fingerprint.length]).toEqual(["MTIzNDU2Nzg5", "3808858755", 9]);
  });

  it("refuses an empty payload and one past Secret Manager's ceiling", () => {
    expect([
      unwrapErr(encodeSecretPayload({ bytes: new Uint8Array() })).message,
      unwrapErr(encodeSecretPayload({ bytes: new Uint8Array(SECRET_PAYLOAD_MAX_BYTES + 1) })).message,
    ]).toEqual([
      "secret payload refused: the payload is empty",
      "secret payload refused: the payload is 65537 bytes, over Secret Manager's 65536",
    ]);
  });

  it("accepts exactly the ceiling", () => {
    expect(unwrap(encodeSecretPayload({ bytes: new Uint8Array(SECRET_PAYLOAD_MAX_BYTES) })).fingerprint.length).toBe(
      65_536,
    );
  });
});

describe("decodeSecretPayload", () => {
  it("round-trips what encode produced", () => {
    const encoded = unwrap(encodeSecretPayload({ bytes: text({ value: "s3cret" }) }));
    const decoded = unwrap(decodeSecretPayload({ data: encoded.data, dataCrc32c: encoded.dataCrc32c }));
    expect(new TextDecoder().decode(decoded.bytes)).toBe("s3cret");
  });

  it("refuses a missing payload, a missing checksum, non-canonical base64 and a wrong checksum", () => {
    expect([
      unwrapErr(decodeSecretPayload({ data: undefined, dataCrc32c: "1" })).message,
      unwrapErr(decodeSecretPayload({ data: "MTIzNDU2Nzg5", dataCrc32c: undefined })).message,
      unwrapErr(decodeSecretPayload({ data: "MTIzNDU2Nzg5!", dataCrc32c: "3808858755" })).message,
      unwrapErr(decodeSecretPayload({ data: "MTIzNDU2Nzg5", dataCrc32c: "1" })).message,
    ]).toEqual([
      "secret payload refused: the answer carried no payload",
      "secret payload refused: the answer carried no CRC32C, so the payload cannot be checked",
      "secret payload refused: the payload is not canonical base64",
      "secret payload refused: the payload does not match its CRC32C",
    ]);
  });
});
