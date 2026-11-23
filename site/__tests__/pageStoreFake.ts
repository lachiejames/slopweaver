/**
 * An in-memory store for the page route's seams: each page's files, signed at `http://store.test/<sha256>`, and the
 * bytes behind each address. A test breaks one thing at a time — the whole store unreadable, or one address answering
 * other bytes — and reads back every ask and fetch it made. A plain fake passed in, never a mock.
 */
import { createHash } from "node:crypto";

import type { PresentationSource, SignedBodyFetch } from "../lib/localPageServe";
import type { PresentedFile } from "../lib/pagePresentation";

/** The fake store, and what was asked of it. */
export interface PageStoreFake {
  readonly presentation: PresentationSource;
  readonly fetchBody: SignedBodyFetch;
  readonly asked: { slug: string; fresh: boolean }[];
  readonly fetched: string[];
  /** Every address answers these bytes instead of its own, until cleared. */
  readonly tamper: { bytes: Uint8Array | undefined };
}

/**
 * A store holding `pages`, each a map of path to bytes.
 *
 * @param pages each page's files by path under it
 * @param unreadable whether every ask answers that the store could not say
 * @returns the seams and their records
 */
export function pageStoreFake({
  pages,
  unreadable = false,
}: {
  pages: Readonly<Record<string, Readonly<Record<string, string | Uint8Array>>>>;
  unreadable?: boolean;
}): PageStoreFake {
  const bodies = new Map<string, Uint8Array>();
  const asked: { slug: string; fresh: boolean }[] = [];
  const fetched: string[] = [];
  const tamper: { bytes: Uint8Array | undefined } = { bytes: undefined };
  const held = new Map(Object.entries(pages));
  const presentation: PresentationSource = async ({ slug, fresh }) => {
    asked.push({ fresh, slug });
    if (unreadable) {
      return { kind: "store-unreadable", why: "the published-page store did not connect: connect ECONNREFUSED" };
    }
    const page = held.get(slug);
    if (page === undefined) {
      return { kind: "not-found" };
    }
    const files = new Map<string, PresentedFile>();
    for (const [path, content] of Object.entries(page)) {
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const signedUrl = `http://store.test/${sha256}`;
      bodies.set(signedUrl, bytes);
      files.set(path, { byteLength: bytes.byteLength, sha256, signedUrl });
    }
    return { expiresInSeconds: 300, files, kind: "page" };
  };
  const fetchBody: SignedBodyFetch = async ({ url }) => {
    fetched.push(url);
    if (tamper.bytes !== undefined) {
      return tamper.bytes;
    }
    return bodies.get(url);
  };
  return { asked, fetchBody, fetched, presentation, tamper };
}
