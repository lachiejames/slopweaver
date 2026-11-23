/**
 * The fixture remover's pure half: what a walk pins about its own fixture page, and whether the rows under the slug
 * are exactly that page. Every pinned field answers a counterexample Codex found. The digest alone is not the
 * walk's page (`r2-fixture-remover-rows-only`). A later publish of the same bytes moves the freeze instant
 * (`r3b-fixture-remover-rows-only`). An import from another home carries that home's address
 * (`r3c-fixture-remover-rows-only`). A version an import carried in is stamped `imported`
 * (`r3e-fixture-remover-loses-nothing`). A write that moves only the page's publish instant moves `publishedAt`,
 * which a publish stamps with its own freeze instant (`r3f-fixture-remover-loses-nothing`). With that, every column
 * of every row it deletes is pinned (`PINNED_COLUMNS`).
 *
 * The residue is a publish of the same bytes under the same slug, from the same home, in the same millisecond. The
 * slug carries the walk's own random nonce, so only the walk that planned it publishes it.
 */
import { err, ok, type Result } from "#lib/result.js";

import { PAGE_FILENAME } from "../../pages/url.js";

import { type PublishedPageFixtureRemovalError, PublishedPageFixtureRemovalErrors } from "./removeFixtureErrors.js";

/** The origin a publish stamps on the version it writes (`./importPlan.ts`); an import stamps `imported`. */
export const PUBLISHED_ORIGIN = "published";

/**
 * Every column of the three tables a removal deletes from, each one pinned by the verdict, the delete's own key or
 * (a file's `pageKind`) the schema's check, so
 * no state another writer left in a column goes unread. A unit test compares these against the schema's columns, so
 * a column added later fails it until the verdict reads that column too.
 */
export const PINNED_COLUMNS = {
  file: ["bodySha256", "pageKey", "pageKind", "relativePath"],
  page: [
    "canonicalAddress",
    "currentBodySha256",
    "kind",
    "latestFrozenAt",
    "latestFrozenBodySha256",
    "pageKey",
    "publishedAt",
  ],
  version: ["bodySha256", "firstFrozenAt", "origin", "pageKey"],
} as const;

/** What the walk's own publish left, which every row under the slug must match. */
export interface FixturePin {
  /** The fixture document's lower-case hex digest. */
  readonly bodySha256: string;
  /** The instant the walk's publish froze it at. */
  readonly frozenAtIso: string;
  /** The `file:` address the walk's home names the page by. */
  readonly canonicalAddress: string;
}

/** What the store holds under a fixture's slug, read inside its lock. */
export interface FixtureRows {
  readonly page:
    | {
        readonly kind: string;
        readonly canonicalAddress: string | null;
        readonly currentBodySha256: string | null;
        readonly latestFrozenBodySha256: string | null;
        readonly latestFrozenAt: Date | null;
        /** A publish stamps its own freeze instant here (`./project.ts`). */
        readonly publishedAt: Date | null;
      }
    | undefined;
  readonly files: readonly { readonly relativePath: string; readonly bodySha256: string }[];
  readonly versions: readonly {
    readonly bodySha256: string;
    readonly firstFrozenAt: Date;
    /** `published` for a publish's version, `imported` for one an import carried in. */
    readonly origin: string;
  }[];
  /** Every other spelling of the slug's address; a publish writes none, so a fixture has none. */
  readonly aliases: readonly { readonly address: string }[];
}

/**
 * Whether the rows under a slug are exactly one fixture page: a local page addressed under the walk's home, whose
 * document, freeze and every version are the pinned body, every version a publish's own, frozen at the walk's own
 * instant, serving that one document and nothing else.
 *
 * @param slug the fixture's slug
 * @param pin what the walk's own publish left
 * @param rows what the store holds under the slug
 * @returns nothing when they may be removed, or the check that failed
 */
export function fixtureRemovalVerdict({
  slug,
  pin,
  rows,
}: {
  slug: string;
  pin: FixturePin;
  rows: FixtureRows;
}): Result<void, PublishedPageFixtureRemovalError> {
  const { page, files, versions } = rows;
  if (page === undefined) {
    return err(PublishedPageFixtureRemovalErrors.absent({ slug }));
  }
  const mismatch = ({ detail }: { detail: string }): Result<void, PublishedPageFixtureRemovalError> =>
    err(PublishedPageFixtureRemovalErrors.mismatch({ detail, slug }));
  if (
    page.kind !== "local" ||
    page.currentBodySha256 !== pin.bodySha256 ||
    page.latestFrozenBodySha256 !== pin.bodySha256
  ) {
    return mismatch({ detail: "its page row does not point at the fixture's body" });
  }
  if (page.canonicalAddress !== pin.canonicalAddress) {
    return mismatch({ detail: "it is addressed under another home than this walk's" });
  }
  if (versions.length === 0 || versions.some((version) => version.bodySha256 !== pin.bodySha256)) {
    return mismatch({ detail: "its history holds a version that is not the fixture's" });
  }
  if (versions.some((version) => version.origin !== PUBLISHED_ORIGIN)) {
    return mismatch({ detail: "its history holds a version an import carried in, which no walk writes" });
  }
  const expectedMs = Date.parse(pin.frozenAtIso);
  const frozenByThisWalk =
    page.latestFrozenAt?.getTime() === expectedMs &&
    versions.every((version) => version.firstFrozenAt.getTime() === expectedMs);
  if (!frozenByThisWalk) {
    return mismatch({ detail: "it was frozen at another instant than this walk's publish" });
  }
  if (page.publishedAt?.getTime() !== expectedMs) {
    return mismatch({ detail: "it was published at another instant than this walk's publish" });
  }
  const onlyTheDocument =
    files.length === 1 && files[0]!.relativePath === PAGE_FILENAME && files[0]!.bodySha256 === pin.bodySha256;
  if (!onlyTheDocument) {
    return mismatch({ detail: "it serves a file other than the fixture's one document" });
  }
  if (rows.aliases.length > 0) {
    return mismatch({ detail: "another address resolves to it, which no publish writes" });
  }
  return ok(undefined);
}
