/**
 * Which version of a published page the store holds now, so the viewer can say when the page the owner has open was
 * republished under them — and still only load it when they press (`../components/console/NewerVersion.tsx`).
 *
 * A version is one digest over every file the page serves, path and content hash alike, so a republish that changes
 * only an image beside the document still reads as newer. It is computed from the store's own presentation
 * (`./pagePresentation.ts`), whose per-file `sha256` the page route already verifies every byte against, so no file is
 * fetched to learn it. Pure apart from hashing.
 */
import { createHash } from "node:crypto";

import type { PresentationRead } from "./pagePresentation";

/** What the store says of one page's version: the digest, that it is gone, or that the store could not say. */
export type PageVersion =
  | { readonly kind: "version"; readonly version: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "unknown"; readonly why: string };

/**
 * The page's version from one presentation read.
 *
 * @param read what the store said the page serves
 * @returns the version digest, the page's absence, or why it could not be known
 */
export function pageVersionOf({ read }: { read: PresentationRead }): PageVersion {
  if (read.kind === "not-found") {
    return { kind: "not-found" };
  }
  if (read.kind === "store-unreadable") {
    return { kind: "unknown", why: read.why };
  }
  // Sorted, so the digest is the page's and never the order the store happened to list its files in.
  const lines = [...read.files.entries()].map(([path, file]) => `${path}\t${file.sha256}`).toSorted();
  return { kind: "version", version: createHash("sha256").update(lines.join("\n")).digest("hex") };
}
