/**
 * A secret payload's bytes, checked: base64 both ways, CRC32C both ways, a size bound, and the fingerprint the
 * door prints instead of the value. Pure.
 *
 * What the door ever shows of a secret is its byte length, whether it ends in a newline (the commonest way a
 * copied value goes wrong) and its SHA-256. The SHA-256 is a CONFIRMATION oracle: whoever can guess a
 * low-entropy value can check the guess against it, so it is printed for a secret the reader already holds the
 * access to, never posted anywhere wider.
 *
 * CRC32C is Secret Manager's own integrity check (Castagnoli, reflected polynomial `0x82F63B78`); Node's
 * `zlib.crc32` is the other CRC32, so it is computed here.
 */
import { sha256Hex } from "#lib/hash.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";

/** Secret Manager's payload ceiling, 64 KiB. */
export const SECRET_PAYLOAD_MAX_BYTES = 65_536;

/** The 256-entry CRC32C table, reflected polynomial. */
const CRC32C_TABLE: readonly number[] = Array.from({ length: 256 }, (_unused, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0x82_f6_3b_78 : crc >>> 1;
  }
  return crc >>> 0;
});

/**
 * CRC32C of some bytes, as an unsigned 32-bit integer.
 *
 * @param bytes the payload
 * @returns the checksum — `0xE3069283` for the ASCII text `123456789`
 */
export function crc32c({ bytes }: { bytes: Uint8Array }): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC32C_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/** What the door prints of a payload in place of its bytes. */
export interface SecretFingerprint {
  readonly length: number;
  readonly sha256: string;
  readonly trailingNewline: boolean;
}

/**
 * The fingerprint of some bytes.
 *
 * @param bytes the payload
 * @returns its length, whether it ends in `\n`, and its SHA-256
 */
export function fingerprint({ bytes }: { bytes: Uint8Array }): SecretFingerprint {
  return { length: bytes.length, sha256: sha256Hex({ bytes }), trailingNewline: bytes.at(-1) === 0x0a };
}

/** A payload ready to send: base64 data, its CRC32C as decimal text, and its fingerprint. */
export interface EncodedSecretPayload {
  readonly data: string;
  readonly dataCrc32c: string;
  readonly fingerprint: SecretFingerprint;
}

/**
 * Encode some bytes for `:addVersion`.
 *
 * @param bytes the payload as read from its file
 * @returns the request fields and fingerprint, or `SECRET_INTEGRITY_FAILED` for an empty or oversized payload
 */
export function encodeSecretPayload({ bytes }: { bytes: Uint8Array }): Result<EncodedSecretPayload, GcpDoorError> {
  if (bytes.length === 0) {
    return err(GcpDoorErrors.secretIntegrity({ why: "the payload is empty" }));
  }
  if (bytes.length > SECRET_PAYLOAD_MAX_BYTES) {
    return err(
      GcpDoorErrors.secretIntegrity({
        why: `the payload is ${String(bytes.length)} bytes, over Secret Manager's ${String(SECRET_PAYLOAD_MAX_BYTES)}`,
      }),
    );
  }
  return ok({
    data: Buffer.from(bytes).toString("base64"),
    dataCrc32c: String(crc32c({ bytes })),
    fingerprint: fingerprint({ bytes }),
  });
}

/** An accessed payload, decoded and checked. `bytes` is for a file write only, never a line. */
export interface DecodedSecretPayload {
  readonly bytes: Uint8Array;
  readonly fingerprint: SecretFingerprint;
}

/**
 * Decode an `:access` answer's payload and check it against the CRC32C Google sent with it.
 *
 * @param data the payload as base64
 * @param dataCrc32c the checksum Google computed, as decimal text
 * @returns the bytes and fingerprint, or `SECRET_INTEGRITY_FAILED` for bad base64, a missing or wrong checksum
 */
export function decodeSecretPayload({
  data,
  dataCrc32c,
}: {
  data: string | undefined;
  dataCrc32c: string | undefined;
}): Result<DecodedSecretPayload, GcpDoorError> {
  if (data === undefined) {
    return err(GcpDoorErrors.secretIntegrity({ why: "the answer carried no payload" }));
  }
  if (dataCrc32c === undefined) {
    return err(
      GcpDoorErrors.secretIntegrity({ why: "the answer carried no CRC32C, so the payload cannot be checked" }),
    );
  }
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  if (Buffer.from(bytes).toString("base64") !== data) {
    return err(GcpDoorErrors.secretIntegrity({ why: "the payload is not canonical base64" }));
  }
  if (String(crc32c({ bytes })) !== dataCrc32c) {
    return err(GcpDoorErrors.secretIntegrity({ why: "the payload does not match its CRC32C" }));
  }
  return ok({ bytes, fingerprint: fingerprint({ bytes }) });
}
