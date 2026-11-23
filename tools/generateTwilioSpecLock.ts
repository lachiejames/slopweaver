/**
 * Emit `src/atlas/twilio/generated/specLock.ts` from Twilio's own published API definitions.
 *
 * Run with a directory holding one file per definition, exactly as `twilio/twilio-oai` publishes them
 * under `spec/json/`:
 *
 * ```bash
 * yarn tsx tools/generateTwilioSpecLock.ts <spec-dir>
 * ```
 *
 * ## Why the pin is a TAG rather than a branch
 *
 * `twilio-oai` is Twilio's own repository of the definitions its SDKs are generated from, and `main` moves
 * whenever Twilio ships. A pin against `main` would silently re-describe the API under a reader, so every
 * `url` below addresses a release tag — the bytes at a tag are what was reviewed. The tag and the commit it
 * resolved to are both recorded, because a tag is a mutable pointer and a commit is not: if a digest ever
 * moves under a pinned tag, the commit is what proves the tag was retargeted rather than the file edited.
 *
 * ## What a digest match does and does not prove
 *
 * It proves the document is byte-for-byte the one that was reviewed. It does NOT prove the projection is
 * complete over it — an operation declaring no JSON response schema contributes no response field names,
 * and a digest lock blesses that silence. `descriptor.ts` states the shortfall rather than leaving a reader
 * to infer it from a count.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readTwilioSpecSurface } from "../src/atlas/twilio/specSurface.js";

/** The release tag every pinned url addresses. */
const TAG = "2.8.1";

/** The commit that tag resolved to when the lock was cut — a tag is mutable, a commit is not. */
const COMMIT = "ef1d81e7b6e49e602530601e913eedc21aedd6da";

/** Where the definitions are published, and the reproduction handle in the emitted header. */
const CATALOGUE_URL = "https://api.github.com/repos/twilio/twilio-oai/contents/spec/json";

/** One row as this tool assembles it, before it is printed. */
interface Pin {
  readonly byteLength: number;
  readonly hosts: readonly string[];
  readonly id: string;
  readonly operationCount: number;
  readonly pathCount: number;
  readonly product: string;
  readonly securitySchemes: readonly string[];
  readonly sha256: string;
  readonly title: string;
  readonly url: string;
  readonly version: string;
}

/**
 * The product and version Twilio's own file stem encodes.
 *
 * `twilio_messaging_v1` is the messaging product at v1; `twilio_iam_organizations` carries no version
 * segment at all and takes the whole tail as its product, which is Twilio's own inconsistency rather than
 * a parse failure.
 */
function productAndVersion({ stem }: { stem: string }): { product: string; version: string } {
  const withoutPrefix = stem.startsWith("twilio_") ? stem.slice("twilio_".length) : stem;
  const parts = withoutPrefix.split("_");
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && /^v\d+$/.test(last)) {
    return { product: parts.slice(0, -1).join("_"), version: last };
  }
  return { product: withoutPrefix, version: "unversioned" };
}

/** Read every definition in the directory and pin it against its own bytes. */
function pins({ root }: { root: string }): readonly Pin[] {
  const rows: Pin[] = [];
  for (const name of readdirSync(root).toSorted()) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const stem = name.slice(0, -".json".length);
    const text = readFileSync(join(root, name), "utf8");
    const surface = readTwilioSpecSurface({ document: JSON.parse(text), specId: stem });
    if (surface.isErr()) {
      throw new Error(`${stem}: ${surface.error.join("; ")}`);
    }
    const { product, version } = productAndVersion({ stem });
    rows.push({
      byteLength: Buffer.byteLength(text),
      hosts: surface.value.hosts,
      id: stem,
      operationCount: surface.value.operations.length,
      pathCount: surface.value.pathCount,
      product,
      securitySchemes: surface.value.securitySchemes,
      sha256: createHash("sha256").update(text).digest("hex"),
      title: surface.value.title,
      url: `https://raw.githubusercontent.com/twilio/twilio-oai/${TAG}/spec/json/${name}`,
      version,
    });
  }
  return rows;
}

/** One row, printed on a single line so the diff of a moved digest is one line long. */
function line({ pin }: { pin: Pin }): string {
  const list = (values: readonly string[]): string => `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
  return (
    `  { byteLength: ${String(pin.byteLength)}, hosts: ${list(pin.hosts)}, id: ${JSON.stringify(pin.id)}, ` +
    `operationCount: ${String(pin.operationCount)}, pathCount: ${String(pin.pathCount)}, ` +
    `product: ${JSON.stringify(pin.product)}, securitySchemes: ${list(pin.securitySchemes)}, ` +
    `sha256: ${JSON.stringify(pin.sha256)}, title: ${JSON.stringify(pin.title)}, ` +
    `url: ${JSON.stringify(pin.url)}, version: ${JSON.stringify(pin.version)} },`
  );
}

const root = process.argv.slice(2).join("");
if (root === "") {
  throw new Error("usage: yarn tsx tools/generateTwilioSpecLock.ts <spec-dir>");
}
const rows = pins({ root });
const operations = rows.reduce((sum, pin) => sum + pin.operationCount, 0);
const paths = rows.reduce((sum, pin) => sum + pin.pathCount, 0);
const hosts = new Set(rows.flatMap((pin) => pin.hosts));
const header = `/**
 * GENERATED by \`tools/generateTwilioSpecLock.ts\` from Twilio's own published API definitions.
 * Do not edit by hand — regenerate, and review the diff.
 *
 * ${String(rows.length)} pinned documents: ${String(paths)} paths, ${String(operations)} operations,
 * answering on ${String(hosts.size)} distinct origins.
 *
 * Pinned at tag \`${TAG}\`, which resolved to commit \`${COMMIT}\` when this lock was cut. Reproduce the
 * list this was built from with:
 *
 * \`\`\`bash
 * curl -fsSL ${CATALOGUE_URL}?ref=${TAG} | jq 'length'
 * \`\`\`
 *
 * Every VERSION of every product is pinned, not just the newest, and that is the point: Twilio serves
 * \`/v1/Services\` on \`messaging.twilio.com\` and \`/v2/Services\` beside it, both live, and an atlas that
 * mapped only the newest would answer that the first does not exist.
 */
import type { TwilioSpecPin } from "../specPin.js";

/** The release tag every pinned url addresses. */
export const TWILIO_SPEC_TAG = ${JSON.stringify(TAG)};

/** The commit that tag resolved to when the lock was cut. A tag is mutable; a commit is not. */
export const TWILIO_SPEC_COMMIT = ${JSON.stringify(COMMIT)};

/**
 * Where the definitions are published — the one address a regeneration starts from.
 * @internal
 */
export const TWILIO_SPEC_CATALOGUE_URL = ${JSON.stringify(CATALOGUE_URL)};

/** Every published definition, pinned by digest, sorted by id. */
export const TWILIO_SPEC_PINS: readonly TwilioSpecPin[] = [
`;
writeFileSync(
  "src/atlas/twilio/generated/specLock.ts",
  `${header}${rows.map((pin) => line({ pin })).join("\n")}\n];\n`,
  "utf8",
);
process.stdout.write(
  `wrote ${String(rows.length)} pins (${String(paths)} paths, ${String(operations)} operations, ${String(hosts.size)} origins)\n`,
);
