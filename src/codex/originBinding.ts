/**
 * The repository a pass record or Claude fallback request was taken in, recorded while its checkout still exists.
 *
 * A record has always named its checkout by PATH (`repoRoot`) and its code by commit (`tree.headSha`). Neither
 * says which repository the work belongs to once that path is gone: a fork's commit object can sit in this
 * clone, so "a surviving checkout holds the commit" is lineage, not provenance. `originRepository` is the binding
 * that lets a landing read re-prove a deleted worktree's evidence (`./orphanedEvidence.ts`) without reading
 * another repository's evidence as this one's.
 *
 * Absent means "cannot be re-proved after the path is gone", never "matches". Records written before this field
 * existed carry none, so they stay NOT RUN once their worktree is deleted: there is no retroactive recovery and
 * nothing backfills the field onto an old record.
 *
 * Pure; the live read that writes the field is `./originBindingLive.ts`.
 */

import { isRecord } from "#lib/parsers.js";

/** GitHub's `owner/name` spelling: an owner of letters, digits and inner hyphens, a name of `[A-Za-z0-9._-]`. */
const REPOSITORY_SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u;

/**
 * The recorded origin repository, when the value is a well-formed `owner/name` slug. Pure.
 *
 * Every reader goes through this, so a malformed value — a number, an empty string, a path, `owner/..` — reads as
 * ABSENT and can never be compared equal to a pull request's repository.
 *
 * @param value the field as parsed off disk, through `unknown` because the record decoders are shallow
 * @returns the slug, or `undefined` when the value is absent or malformed
 */
export function recordedOriginRepository({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string" || !REPOSITORY_SLUG.test(value)) {
    return undefined;
  }
  const name = value.slice(value.indexOf("/") + 1);
  return name === "." || name === ".." ? undefined : value;
}

/**
 * The binding field to spread into a record, present only when the value validates. Pure.
 *
 * @param value the field as parsed off disk
 * @returns `{ originRepository }` for a well-formed slug, else an empty object
 */
export function originRepositoryField({ value }: { value: unknown }): { readonly originRepository?: string } {
  const slug = recordedOriginRepository({ value });
  return slug === undefined ? {} : { originRepository: slug };
}

/**
 * Whether a fallback receipt's EMBEDDED request may speak for its origin binding. Pure.
 *
 * Adoption reads a receipt's embedded copy, but only the request FILE is bound by the receipt's hash — and a plan
 * receipt's binding checks no more than that hash and the request id. So an embedded origin is trusted only when the
 * hash-bound file carries the same origin AND the same checkout path, branch and head: every field adoption places
 * by. An embedded copy with no origin has nothing to trust and is never adopted anyway.
 *
 * @param embedded the request copy the receipt embeds
 * @param onDisk the request file as parsed beside it, through `unknown`
 * @returns `true` when the embedded placement is the file's, or the copy claims no origin
 */
export function embeddedOriginTrusted({
  embedded,
  onDisk,
}: {
  embedded: {
    readonly originRepository?: string;
    readonly repoRoot: string;
    readonly tree: { readonly branch: string | null; readonly headSha: string };
  };
  onDisk: unknown;
}): boolean {
  if (embedded.originRepository === undefined) {
    return true;
  }
  if (!isRecord(onDisk) || !isRecord(onDisk["tree"])) {
    return false;
  }
  return (
    recordedOriginRepository({ value: onDisk["originRepository"] }) === embedded.originRepository &&
    onDisk["repoRoot"] === embedded.repoRoot &&
    onDisk["tree"]["branch"] === embedded.tree.branch &&
    onDisk["tree"]["headSha"] === embedded.tree.headSha
  );
}
