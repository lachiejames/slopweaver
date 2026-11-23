/**
 * The register's baseline: one opaque token naming the CONTENT a writer read, carried inside the document it hands
 * back, so a whole-register write can refuse a register that has changed since — the replacement for the file
 * register's sha256 `--if-current`.
 *
 * ## Why content, not revisions
 *
 * A revision-only token is portable across stores: two stores holding the same ids at the same revisions but different contents would each accept the other's
 * token. Nothing in this repository names a store's identity to bind to, so the token binds to what was read. A token
 * from another store then passes only where that store holds byte-identical content — and there the edit a person
 * made against that content is exactly the edit applied, so nothing they did not see is overwritten.
 *
 * Revisions still fence the final race: a writer compares this token against a fresh read, then hands that read's
 * revisions to the batch's `wholeRegister` and meta compare-and-set, so a change between the read and the commit
 * refuses too.
 *
 * ## What is content
 *
 * The authored aggregate and the register document, nothing a store mints: revisions, `createdAtIso`, `updatedAtIso`
 * and derived progress are left out, so two stores written at different instants with the same authored register
 * hash equal. Each aggregate is put in canonical order (`./canonical.ts`), the workstreams by
 * id, and serialised with every object's keys sorted (`#lib/stableStringify.js`), `detail` included.
 *
 * Pure.
 */
import { createHash } from "node:crypto";

import { stableStringify } from "#lib/stableStringify.js";

import { byCodeUnit, canonicalAggregate } from "./canonical.js";
import type { WorkstreamAggregate, WorkstreamRegisterMeta, WorkstreamRegisterSnapshot } from "./types.js";

/** What every baseline opens with, so a token of another kind is refused rather than compared. */
const REGISTER_BASELINE_PREFIX = "wsb1.";

/** A baseline's exact shape: the prefix, then a lowercase sha256. */
export const REGISTER_BASELINE_PATTERN = /^wsb1\.[0-9a-f]{64}$/u;

/**
 * The authored fields of an aggregate alone, in canonical order — whatever else a stored workstream carries dropped.
 *
 * @returns the content a baseline hashes
 */
function authoredContent({ aggregate }: { aggregate: WorkstreamAggregate }): WorkstreamAggregate {
  const { detail, entries, id, kind, links, milestones, name, outcome, status, workspace } = canonicalAggregate({
    aggregate,
  });
  return { detail, entries, id, kind, links, milestones, name, outcome, status, workspace };
}

/**
 * The baseline of a register's content.
 *
 * @param meta the register document, `null` when there is none
 * @param workstreams every workstream, in any order; a stored one's store-minted fields are ignored
 * @returns `wsb1.` and the sha256 of the canonical content
 */
export function registerBaseline({
  meta,
  workstreams,
}: {
  meta: WorkstreamRegisterMeta | null;
  workstreams: readonly WorkstreamAggregate[];
}): string {
  const content = {
    meta,
    workstreams: workstreams
      .map((aggregate) => authoredContent({ aggregate }))
      .toSorted((a, b) => byCodeUnit({ a: a.id, b: b.id })),
  };
  return `${REGISTER_BASELINE_PREFIX}${createHash("sha256")
    .update(stableStringify({ value: content }))
    .digest("hex")}`;
}

/**
 * The baseline of what one read of the store returned.
 *
 * @returns the baseline
 */
export function snapshotBaseline({ snapshot }: { snapshot: WorkstreamRegisterSnapshot }): string {
  let meta: WorkstreamRegisterMeta | null = null;
  if (snapshot.meta !== null) {
    meta = snapshot.meta.document;
  }
  return registerBaseline({ meta, workstreams: snapshot.workstreams });
}

/** The baseline of a register with no document and no workstreams: what a document carrying none is judged against. */
export const EMPTY_REGISTER_BASELINE = registerBaseline({ meta: null, workstreams: [] });
