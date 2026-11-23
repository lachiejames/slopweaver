/**
 * Deriving a register slug — the one identity question this domain has to get right, because the slug is the
 * filename every event for a proposal is appended to.
 *
 * Two writers create a register entry: `proposal publish`'s hook, and `proposal sync`'s backfill. When the
 * publish belongs to a tracked intake, its `id` IS the register slug — `ProposalIntake.id` is already the
 * stable local identity Notion cannot provide (`intake.ts`'s own module doc), and reusing it verbatim gives
 * publish an exact join with no derivation at all.
 *
 * Every OTHER case — a publish with no `--intake`, or a `sync` backfill of a proposal this tooling never
 * drafted — has no local id to reuse. A title alone is unstable (edited later) and ambiguous (two proposals
 * can share a title); a provider id alone is stable but unreadable at the command line. This is a title STEM
 * (bounded, so the whole slug stays inside the filename-safe 80-character cap `store.ts` enforces) plus the
 * FULL compact id (provider-prefixed for anything but Notion), so two proposals can never collide on this axis and the id half stays the single
 * source of truth `sync` re-matches against on a later run.
 */
import type { ProposalAddress } from "../address.js";

/** The filename-safe cap `store.ts`'s `SAFE_SLUG` enforces. */
const MAX_SLUG_LENGTH = 80;

/**
 * Lowercase, dash-joined, no leading/trailing dash — the same shape `intake.ts`'s own slugifier produces.
 *
 * `title` is legitimately absent (a bare `sync` discovery with no readable title), which is a real case rather
 * than a bug — so this branches on it explicitly instead of coalescing to `""`.
 */
function slugifyTitle({ title }: { title: string | undefined }): string {
  return title === undefined
    ? ""
    : title
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-+|-+$/g, "");
}

/** A provider id, compacted — a Notion UUID loses its dashes; defensively filtered to `[a-z0-9]`. */
function compactId({ id }: { id: string }): string {
  return id.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/**
 * The id half of a slug. A Notion address keeps the bare compact id, byte-for-byte what every slug filed
 * before addresses were provider-tagged used, so an existing entry is still found. Any other provider is
 * prefixed with its name, because two providers can mint the same id and a slug must name ONE proposal.
 */
function idHalf({ address }: { address: ProposalAddress }): string {
  const id = compactId({ id: address.id });
  if (address.provider === "notion") {
    return id;
  }
  return `${address.provider}-${id}`;
}

/**
 * Derive the slug a register entry is filed under.
 *
 * @param title the proposal's title, when one is known (absent for a bare `sync` discovery with no readable title)
 * @param address where this entry's proposal lives
 * @param intakeId the tooling intake this proposal belongs to, when it has one — reused verbatim as the slug
 * @returns the slug, always filename-safe and within `store.ts`'s 80-character cap
 */
export function deriveRegisterSlug({
  title,
  address,
  intakeId,
}: {
  title: string | undefined;
  address: ProposalAddress;
  intakeId: string | undefined;
}): string {
  if (intakeId !== undefined) {
    return intakeId;
  }
  const id = idHalf({ address });
  const stemBudget = Math.max(0, MAX_SLUG_LENGTH - id.length - 1);
  const stem = slugifyTitle({ title }).slice(0, stemBudget).replaceAll(/-+$/g, "");
  return stem.length > 0 ? `${stem}-${id}` : id;
}
