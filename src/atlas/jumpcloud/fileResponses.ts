/**
 * The admitted operations that answer with a FILE rather than a JSON document, and how each is read.
 *
 * MEASURED against the live tenancy, through the atlas's own admitted paths:
 *
 * - `GET /api/v2/applemdms/{id}/depkey` answers 406 `Not Acceptable` to `Accept: application/json` and to
 *   `*` + `/` + `*`, and 200 with a single PEM `CERTIFICATE` to `Accept: application/x-pem-file`.
 *   It is the Apple DEP PUBLIC key certificate.
 * - `GET /api/v2/applemdms/{id}/csr` answers 200 `application/octet-stream` with a base64 body. It
 *   decodes to an Apple push-certificate request plist — a flat dictionary of three strings:
 *   `PushCertCertificateChain` (a chain of PEM `CERTIFICATE` blocks), `PushCertRequestCSR` (a base64 DER
 *   certificate signing request) and `PushCertSignature`. Every one of them is public.
 *
 * Neither carries private key material, and each decoder REFUSES rather than stores a body that does — so a
 * provider that one day returned a private key here would fail the read with `UNEXPECTED_SHAPE`, before the
 * sensitivity gate (which refuses every `PRIVATE KEY` block independently) is ever reached.
 *
 * The decoded document then crosses a strict boundary like any JSON answer, so a plist that grows a fourth key
 * refuses by name rather than storing a field nobody measured.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

import { type JumpcloudReadError, JumpcloudReadErrors } from "./errors.js";
import { defineJumpcloudObjectBoundary, type JumpcloudPageBoundary } from "./responseBoundary.js";

/** The one PEM block type this atlas will never store, in any of its spellings. */
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** How one file-answering operation is asked for and read. */
export interface JumpcloudFileResponse {
  /** The `Accept` header the provider needs before it will answer at all. */
  readonly accept: string;
  /**
   * Turn the provider's text into the document the atlas stores.
   *
   * @param input the raw response body, and the operation it answered — named in a refusal
   * @returns the document, or why this body is not the file the contract describes
   */
  readonly decode: (input: {
    text: string;
    surface: string;
  }) => Result<Readonly<Record<string, unknown>>, JumpcloudReadError>;
  /** The strict boundary the decoded document is admitted through, declared from the measurement above. */
  readonly boundary: JumpcloudPageBoundary;
}

/**
 * The PEM blocks in a body, each with its type, refusing any private key.
 *
 * @param text the PEM text
 * @param surface the operation that answered, named in a refusal
 * @returns every block, or why the body is not public PEM material
 */
function publicPemBlocks({
  text,
  surface,
}: {
  text: string;
  surface: string;
}): Result<readonly { type: string; pem: string }[], JumpcloudReadError> {
  if (PRIVATE_KEY_BLOCK.test(text)) {
    return err(
      JumpcloudReadErrors.unexpectedShape({
        detail: "the body carries a private key block, which this atlas never stores",
        surface,
      }),
    );
  }
  const blocks = [...text.matchAll(/-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g)].map((match) => ({
    pem: match[0],
    type: match[1]!,
  }));
  if (blocks.length === 0) {
    return err(JumpcloudReadErrors.unexpectedShape({ detail: "the body carries no PEM block", surface }));
  }
  return ok(blocks);
}

/**
 * Read an Apple push-certificate request: base64 of a plist whose dictionary holds only strings.
 *
 * @param text the raw response body
 * @param surface the operation that answered, named in a refusal
 * @returns the plist's string entries by key, or why the body is not one
 */
function applePushCertRequest({
  text,
  surface,
}: {
  text: string;
  surface: string;
}): Result<Readonly<Record<string, unknown>>, JumpcloudReadError> {
  const encoded = text.trim().replace(/^"|"$/g, "");
  const plist = Buffer.from(encoded, "base64").toString("utf8");
  if (!plist.includes("<plist")) {
    return err(JumpcloudReadErrors.unexpectedShape({ detail: "the body does not decode to a property list", surface }));
  }
  if (PRIVATE_KEY_BLOCK.test(plist)) {
    return err(
      JumpcloudReadErrors.unexpectedShape({
        detail: "the property list carries a private key block, which this atlas never stores",
        surface,
      }),
    );
  }
  const entries = [...plist.matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)].map(
    (match): [string, string] => [match[1]!, match[2]!.trim()],
  );
  if (entries.length === 0) {
    return err(JumpcloudReadErrors.unexpectedShape({ detail: "the property list holds no string entries", surface }));
  }
  return ok({ format: "apple-push-certificate-request", ...Object.fromEntries(entries) });
}

/**
 * Every admitted operation that answers with a file, keyed by registry name.
 *
 * Named rather than matched, the discipline `requestContracts.ts` states: a new file-answering operation is
 * visibly uncontracted rather than swept into a rule written for a different endpoint.
 */
export const JUMPCLOUD_FILE_RESPONSES: Readonly<Record<string, JumpcloudFileResponse>> = {
  "v2-applemdms-csrget": {
    accept: "application/json",
    boundary: defineJumpcloudObjectBoundary({
      object: z.strictObject({
        PushCertCertificateChain: z.string(),
        PushCertRequestCSR: z.string(),
        PushCertSignature: z.string(),
        format: z.literal("apple-push-certificate-request"),
      }),
      surface: "v2-applemdms-csrget",
    }),
    decode: ({ text, surface }) => applePushCertRequest({ surface, text }),
  },
  "v2-applemdms-depkeyget": {
    accept: "application/x-pem-file",
    boundary: defineJumpcloudObjectBoundary({
      object: z.strictObject({
        blocks: z.array(z.strictObject({ pem: z.string(), type: z.string() })),
        format: z.literal("pem"),
      }),
      surface: "v2-applemdms-depkeyget",
    }),
    decode: ({ text, surface }) =>
      publicPemBlocks({ surface, text }).map((blocks) => ({
        blocks: blocks.map((block) => ({ ...block })),
        format: "pem",
      })),
  },
};
