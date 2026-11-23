/**
 * `github repoint-plan`'s state-home link scan: every authored file that links a numbered object of the repository,
 * through the injected edges, READ-ONLY. A file the scan could not read, or that holds a link it could not rewrite
 * as text, is residue rather than a silent omission. `./repointReaders.ts` composes it into the whole gather.
 */
import { sha256Hex } from "#lib/hash.js";

import { historicalLinkReplacements } from "./repointLinks.js";
import type { RepositoryRepointFacts, RepositoryRepointRequest } from "./repointModel.js";
import type { RepointReadDeps } from "./repointReaders.js";

/**
 * A file larger than this is reported as residue, not scanned: a link to rewrite lives in an authored note, and the
 * bound keeps one read well under `safeJson`'s 32 MiB one-string warning (`src/lib/safeJson.ts`).
 */
const LINK_SCAN_MAX_BYTES = 16 * 1024 * 1024;

/** What scanning one authored file found. */
type LinkScan =
  | { readonly kind: "residue"; readonly why: string }
  | { readonly kind: "non-text-without-links" }
  | { readonly kind: "links"; readonly file: RepositoryRepointFacts["links"][number] }
  | { readonly kind: "none" };

/**
 * A file that is not UTF-8 (an image, say): a link the switch would rewrite is ASCII, so the raw bytes are searched
 * for one. A file with none needs no rewrite; one WITH one cannot be rewritten as text, so it stays residue.
 */
function nonTextScan({
  deps,
  path,
  request,
  why,
}: {
  deps: RepointReadDeps;
  path: string;
  request: RepositoryRepointRequest;
  why: string;
}): LinkScan {
  const raw = deps.readBytesAsLatin1({ path });
  const linked =
    raw === undefined ||
    historicalLinkReplacements({ archiveName: request.archiveName, repository: request.repository, text: raw }).length >
      0;
  return linked ? { kind: "residue", why } : { kind: "non-text-without-links" };
}

/** One authored file: over the bound, not text, linked or not. */
function scanLinkFile({
  deps,
  path,
  request,
}: {
  deps: RepointReadDeps;
  path: string;
  request: RepositoryRepointRequest;
}): LinkScan {
  const size = deps.sizeOf({ path });
  if (size !== undefined && size > LINK_SCAN_MAX_BYTES) {
    return { kind: "residue", why: `${String(size)} bytes, over the ${String(LINK_SCAN_MAX_BYTES)}-byte scan bound` };
  }
  const read = deps.readText({ path });
  if (read.isErr()) {
    return nonTextScan({ deps, path, request, why: read.error });
  }
  if (read.value === null) {
    return { kind: "none" };
  }
  const replacements = historicalLinkReplacements({
    archiveName: request.archiveName,
    repository: request.repository,
    text: read.value,
  });
  if (replacements.length === 0) {
    return { kind: "none" };
  }
  return { file: { path, replacements, sha256: sha256Hex({ bytes: read.value }) }, kind: "links" };
}

/**
 * Every authored state-home file that links a numbered object of the repository, and what was not scanned.
 *
 * @param home the state home whose authored files are walked
 * @returns the files to rewrite, the residue (unlisted, unclassified, oversized or unrewritable) and the count of
 *   non-text files naming no link
 */
export function linksOf({
  deps,
  home,
  request,
}: {
  deps: RepointReadDeps;
  home: string;
  request: RepositoryRepointRequest;
}): Pick<RepositoryRepointFacts, "linkResidue" | "links" | "nonTextFilesWithoutLinks"> {
  const listing = deps.listAuthoredFiles({ home });
  const links: RepositoryRepointFacts["links"][number][] = [];
  let nonTextFilesWithoutLinks = 0;
  const linkResidue: { locator: string; why: string }[] = [
    ...listing.unreadable.map((entry) => ({ locator: entry.locator, why: `would not list: ${entry.why}` })),
    ...listing.unclassified.map((locator) => ({
      locator,
      why: "no authored-state row classifies it, so it was not read",
    })),
  ];
  for (const path of listing.files) {
    const scan = scanLinkFile({ deps, path, request });
    if (scan.kind === "residue") {
      linkResidue.push({ locator: path, why: scan.why });
    } else if (scan.kind === "non-text-without-links") {
      nonTextFilesWithoutLinks += 1;
    } else if (scan.kind === "links") {
      links.push(scan.file);
    }
  }
  return { linkResidue, links, nonTextFilesWithoutLinks };
}
