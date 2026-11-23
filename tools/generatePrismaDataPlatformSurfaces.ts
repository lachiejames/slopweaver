/**
 * Emit `src/atlas/prismaDataPlatform/generated/surfaces.ts` from the platform's own OpenAPI document and
 * its own documentation sitemap.
 *
 * ```bash
 * yarn tsx tools/generatePrismaDataPlatformSurfaces.ts --verify   # fetch, extract, check the pin and census
 * yarn tsx tools/generatePrismaDataPlatformSurfaces.ts            # rewrite the registry, then review the diff
 * yarn tsx tools/generatePrismaDataPlatformSurfaces.ts --spec <f> # use a local copy of the document
 * ```
 *
 * REFUSES when the digest or any census number moves. The generated table is the read-only boundary, and a
 * table regenerated from whatever Prisma shipped this morning is a table nobody reviewed.
 *
 * ## Two independent sources, because the finding is the disagreement between them
 *
 * The first is `GET https://api.prisma.io/v1/doc`, the OpenAPI 3.1.0 document the platform serves to
 * anybody. The second is `https://www.prisma.io/docs/sitemap.xml`, filtered to the endpoint reference pages,
 * each fetched as Markdown — Prisma states the contract itself: _"A markdown version of any docs page is
 * available by appending `.md` to its URL"_ — and each page's own `` `METHOD /path` `` line is what maps a
 * page to an operation.
 *
 * Deriving `documented` from the stability extension instead would be one fetch cheaper and would make the
 * partition unfalsifiable, which is the opposite of the point: that the 45 documented operations are
 * EXACTLY the 45 non-experimental ones is the headline finding, and a finding computed from one source is
 * an assumption.
 *
 * ## Neither request presents a credential or reaches an account
 *
 * Both are public documents on public hosts. Nothing here touches `console.prisma.io`, and the registry it
 * writes is committed — which is what keeps `slopweaver atlas prisma-data-platform sync` able to publish the
 * whole surface map with no network call at all.
 *
 * The operation walk lives in `prismaSurfacesOperations.ts`; the census assertions and module rendering live
 * in `prismaSurfacesCensus.ts`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { PRISMA_SPEC_PIN } from "../src/atlas/prismaDataPlatform/generated/specLock.js";
import { PRISMA_DATA_PLATFORM_ATLAS_KINDS } from "../src/atlas/prismaDataPlatform/kinds.js";
import { isRecord } from "../src/lib/parsers.js";
import { assertCensus, moduleText } from "./prismaSurfacesCensus.js";
import { operationsOf, refuse, rowOf } from "./prismaSurfacesOperations.js";

const OUTPUT = "src/atlas/prismaDataPlatform/generated/surfaces.ts";

/** Where the endpoint reference pages live, which is how the sitemap is filtered. */
const DOCS_ENDPOINT_PREFIX = "https://www.prisma.io/docs/rest-api/endpoints/";

/** The docs sitemap that enumerates them. */
const DOCS_SITEMAP = "https://www.prisma.io/docs/sitemap.xml";

/** The document's bytes, from a local file when one was handed over and from the pinned URL otherwise. */
async function specBytes({ specPath }: { specPath: string | null }): Promise<Buffer> {
  if (specPath !== null) {
    return readFileSync(specPath);
  }
  const response = await fetch(PRISMA_SPEC_PIN.documentUrl);
  if (!response.ok) {
    refuse(`${PRISMA_SPEC_PIN.documentUrl} answered ${String(response.status)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** The parsed document, with both halves of the pin checked first. */
function documentOf({ bytes }: { bytes: Buffer }): Record<string, unknown> {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== PRISMA_SPEC_PIN.documentSha256) {
    refuse(
      `the document's digest moved: pinned ${PRISMA_SPEC_PIN.documentSha256}, found ${digest} ` +
        `(${String(bytes.byteLength)} bytes, pinned ${String(PRISMA_SPEC_PIN.byteLength)}).\n` +
        "This URL serves whatever Prisma is running right now, so a moved digest is expected eventually" +
        " and is a REVIEW rather than a failure. If the census below still holds, only prose changed and" +
        " the new digest can be pinned on its own; if the census moved too, the surface did — say which in" +
        " the pull request.",
    );
  }
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(parsed)) {
    return refuse("the document did not parse to an object");
  }
  return parsed;
}

/** Every documentation page, mapped from the operation it documents to its URL. */
async function docsPages(): Promise<ReadonlyMap<string, string>> {
  const sitemap = await fetch(DOCS_SITEMAP);
  if (!sitemap.ok) {
    refuse(`${DOCS_SITEMAP} answered ${String(sitemap.status)}`);
  }
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(([, location = ""]) => location)
    .filter((url) => url.startsWith(DOCS_ENDPOINT_PREFIX));
  const pages = new Map<string, string>();
  for (const url of urls) {
    const page = await fetch(`${url}.md`);
    if (!page.ok) {
      refuse(`${url}.md answered ${String(page.status)} — the docs site's Markdown contract has changed`);
    }
    const [, method = "", path = ""] = /^`([A-Z]+) (\/[^`]*)`$/m.exec(await page.text()) ?? [];
    if (method.length === 0 || path.length === 0) {
      refuse(`${url}.md carries no \`METHOD /path\` line — the reference page layout has changed`);
    }
    pages.set(`${method} ${path}`, url);
  }
  return pages;
}

/** Fetch, extract, check and (unless verifying) write. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const specAt = argv.indexOf("--spec");
  const specPath = specAt < 0 ? null : (argv[specAt + 1] ?? refuse("--spec needs a path"));
  const spec = documentOf({ bytes: await specBytes({ specPath }) });
  const pages = await docsPages();
  const rows = operationsOf({ spec }).map((entry) => rowOf({ entry, pages, spec }));
  const unplaced = PRISMA_DATA_PLATFORM_ATLAS_KINDS.filter(
    (kind) => !["console-route", "method", "oauth-endpoint"].includes(kind) && !rows.some((row) => row.kind === kind),
  );
  if (unplaced.length > 0) {
    refuse(
      `${unplaced.join(", ")} is declared in kinds.ts and no operation feeds it — either Prisma removed a` +
        " family or the prefix table stopped matching. Say which in the same commit",
    );
  }
  assertCensus({ rows, spec });
  if (argv.includes("--verify")) {
    process.stdout.write(
      `prisma-data-platform spec pin and census hold: ${String(rows.length)} operations, ` +
        `${String(pages.size)} documentation pages\n`,
    );
    return;
  }
  writeFileSync(OUTPUT, moduleText({ rows }), "utf8");
  process.stdout.write(`wrote ${OUTPUT}: ${String(rows.length)} operations\n`);
}

void main();
