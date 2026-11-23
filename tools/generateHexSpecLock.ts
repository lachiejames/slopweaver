/**
 * Emit `src/atlas/hex/generated/specLock.ts` from Hex's own published OpenAPI document.
 *
 * ```bash
 * yarn tsx tools/generateHexSpecLock.ts            # fetch, compile and rewrite the lock
 * yarn tsx tools/generateHexSpecLock.ts --verify   # exit non-zero if the served bytes have moved
 * ```
 *
 * ## The address carries no version, and that is Hex's decision rather than an oversight here
 *
 * `static.hex.site/openapi.json` is the file Hex's own public API reference renders from, and there is no
 * tag, release or commit in it — a shipped change lands under the same URL. So the digest below is the only
 * handle on WHICH document was reviewed, and the sibling Twilio lock's tag-plus-commit pair has no
 * counterpart here. MEASURED: the document was served with `last-modified` three days old, the
 * same instant the login page's own `data-web-client-build-time` carried, so the document and the client
 * ship together and this digest moves on an ordinary release.
 *
 * `atlas/hex/errors.ts` carries what the sync does about that, and it is not to refuse.
 *
 * ## What a digest match does and does not prove
 *
 * It proves the document is byte-for-byte the one that was reviewed. It does NOT prove the projection is
 * complete over it — an operation declaring no JSON response schema contributes no response field names,
 * and a digest lock blesses that silence. `descriptor.ts` states the shortfall rather than leaving a reader
 * to infer it from a count.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { readHexSpecSurface } from "../src/atlas/hex/specSurface.js";
import { isRecord } from "../src/lib/parsers.js";

/** The one address ever fetched, here and at run time. */
const SPEC_URL = "https://static.hex.site/openapi.json";

/** This atlas's own id for the document — the provider id every `api` row and every citation uses. */
const SPEC_ID = "hex-public-api";

/**
 * `info.version` as the document declares it, or a stated stand-in.
 *
 * @param document the parsed document
 * @returns the version string
 */
function documentVersion({ document }: { document: unknown }): string {
  if (!isRecord(document)) {
    return "unversioned";
  }
  const info = document["info"];
  if (!isRecord(info)) {
    return "unversioned";
  }
  return typeof info["version"] === "string" ? info["version"] : "unversioned";
}

/** Fail loudly. */
function refuse({ message }: { message: string }): never {
  process.stderr.write(`generateHexSpecLock: ${message}\n`);
  process.exit(1);
}

/**
 * Fetch, compile and print the pin — or, with `--verify`, compare it to what is committed.
 *
 * @returns nothing; the process exits non-zero on a refusal
 */
async function main(): Promise<void> {
  const response = await fetch(SPEC_URL);
  if (!response.ok) {
    refuse({ message: `${SPEC_URL} answered ${String(response.status)}` });
  }
  const text = await response.text();
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    refuse({ message: `${SPEC_URL} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  const surface = readHexSpecSurface({ document, specId: SPEC_ID });
  if (surface.isErr()) {
    refuse({ message: surface.error.join("; ") });
  }
  const compiled = surface.value;
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  const byteLength = Buffer.byteLength(text, "utf8");
  const version = documentVersion({ document });

  if (process.argv.includes("--verify")) {
    const { HEX_SPEC_PINS } = await import("../src/atlas/hex/generated/specLock.js");
    const pinned = HEX_SPEC_PINS[0]!;
    if (pinned.sha256 !== sha256) {
      refuse({ message: `the served document does not match the lock: pinned ${pinned.sha256}, served ${sha256}` });
    }
    process.stdout.write(`generateHexSpecLock: the lock still matches what is served (${sha256})\n`);
    return;
  }

  const header = `/**
 * The published Hex OpenAPI document, pinned by digest. GENERATED — do not edit.
 *
 * Regenerate with \`yarn tsx tools/generateHexSpecLock.ts\`, and check the committed pin against what is
 * served with \`yarn tsx tools/generateHexSpecLock.ts --verify\`.
 *
 * ${String(compiled.pathCount)} paths declaring ${String(compiled.operations.length)} operations, answering
 * on ${compiled.hosts.join(", ")}. The address carries no version, so the digest is the only handle on which
 * document was reviewed — the generator's header says why, and \`atlas/hex/errors.ts\` says why a moved
 * digest is compiled and reported rather than refused.
 */
import type { HexSpecPin } from "../specPin.js";

/** The one address ever fetched. No caller supplies one. */
export const HEX_SPEC_URL = ${JSON.stringify(SPEC_URL)};

/** The published document, pinned by digest. One row, because Hex publishes one document. */
export const HEX_SPEC_PINS: readonly HexSpecPin[] = [
  {
    byteLength: ${String(byteLength)},
    hosts: ${JSON.stringify(compiled.hosts)},
    id: ${JSON.stringify(SPEC_ID)},
    operationCount: ${String(compiled.operations.length)},
    pathCount: ${String(compiled.pathCount)},
    securitySchemes: ${JSON.stringify(compiled.securitySchemes)},
    sha256: ${JSON.stringify(sha256)},
    title: ${JSON.stringify(compiled.title)},
    url: HEX_SPEC_URL,
    version: ${JSON.stringify(version)},
  },
];
`;
  writeFileSync("src/atlas/hex/generated/specLock.ts", header, "utf8");
  process.stdout.write(
    `wrote 1 pin: ${String(compiled.pathCount)} paths, ${String(compiled.operations.length)} operations, sha256 ${sha256}\n`,
  );
}

await main();
