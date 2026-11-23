/**
 * The one clock a published generation carries, DERIVED from what it vouches for rather than asserted.
 *
 * ## The defect this exists to make unrepresentable
 *
 * MEASURED on the installed generations: `slopweaver atlas doctor` reported "onepassword
 * ANSWERABLE <n> entities readable from the generation published" at an instant earlier
 * than the one in that atlas's own `events.jsonl` envelope — the manifest clock behind the newest file it
 * vouched for, with every schema test passing. The cause was a per-atlas
 * `manifestUpdateFor` that spread the stored manifest and rewrote only `kinds`, so `updatedAt` silently kept
 * whatever it had. FOUR copies of that shape stood at once — `onepassword/sync.ts`, `vanta/sync.ts`,
 * `cloudflare/kindFold.ts`'s `stampKindAttempt` and `vanta/browserSurface.ts`'s `walkManifest` — the kit
 * owned none, and Cloudflare and Slack read coherent only because a base literal elsewhere happened to
 * restamp. A hand audit over the same tree found three; the count above is the gate's own, measured by
 * running `scanAtlasManifestClock` over every `git show HEAD:<path>` under `src/atlas/`, which is the only
 * way to reproduce it now that the copies are gone. Reproduce the DEFECT on any generation:
 *
 * ```bash
 * slopweaver atlas doctor | grep onepassword
 * for f in ~/.slopweaver/atlas/onepassword/*.jsonl; do echo "$(basename "$f") $(head -1 "$f" | jq -r .updatedAt)"; done
 * ```
 *
 * ## Why derived, and not guarded
 *
 * Owner ruling: no ad hoc fix on one single platform; make the mistake impossible to repeat. The rule covers
 * BOTH directions, a generation that reads older than it is and one that reads newer. A guard leaves the caller holding a value it can
 * still get wrong; deriving removes the value from the caller entirely. `publish.ts` already does exactly this
 * for `digest` and `entityCount`, computed from the bytes `publishAtlas` actually writes, and `kindStatus.ts`'s
 * `succeededKindStatus` says why: a caller filling one in "would be describing a file it has not written".
 * A caller supplying `updatedAt` is describing a generation it has not published. Same argument, same fix.
 *
 * ## What the clock IS
 *
 * The newest `updatedAt` among the kind files the manifest vouches for — the ones this publish is writing,
 * read from memory, and the ones it is leaving alone, read from their envelopes on disk. That makes the
 * manifest clock exactly "when this generation was last actually updated" in both directions: it cannot lag,
 * because a fresh file drags it forward, and it cannot run ahead, because there is nothing for it to be but
 * the maximum of real file clocks.
 *
 * {@link kindClocks} is the one effectful function here — it reads the envelope of every kind file this
 * publish is NOT rewriting. Everything else is pure: clocks in, a clock and a list of defects out. The
 * per-kind STAMPING lives here too — {@link stampAtlasManifest} and {@link withKindStatus} — because the
 * one thing both must never do is set the clock, and keeping them beside the derivation is what makes that
 * legible. `src/devLint/atlasManifestClock.ts` refuses a per-atlas copy of either.
 */
import { isRecord } from "../../lib/parsers.js";
import { readKindEnvelopeIfPresent } from "../atlasFile.js";
import { recordPerKind } from "./kindRecord.js";
import type { AtlasKindStatus } from "./kindStatus.js";
import type { AtlasKindFileLike, AtlasManifestLike, AtlasStorePaths } from "./store.js";

/** One kind file's own clock, as this publish knows it. `null` when the kind holds no file at all. */
export interface KindClock {
  readonly kind: string;
  /**
   * Whether this publish is writing the file AND is the publish that recorded a SUCCESS for the kind. Only
   * then must the file's clock and the status's success time agree — see {@link manifestClockDefects}. A
   * publish that writes a kind's file while carrying an EARLIER run's status through is not this, and
   * {@link kindClocks} says why.
   */
  readonly writtenSuccessfully: boolean;
  /** The file envelope's own `updatedAt`, or `null` when there is no file. */
  readonly updatedAt: string | null;
  /** The success time the manifest status records for this kind, or `null` when it has never succeeded. */
  readonly lastSuccessAt: string | null;
}

/**
 * The instant a generation is honestly last-updated at: the newest clock among the files it vouches for.
 *
 * A generation vouching for no file at all has no file clock to derive from, so it takes `fallback` — the
 * clock the caller was carrying. That is the ONE case where the clock is still asserted, and it is the one
 * case where nothing can contradict it: there is no file for the manifest to be stale or early against.
 *
 * @param clocks every kind's file clock, written and untouched alike
 * @param fallback the caller's own clock, used only when the generation vouches for no file at all
 * @returns the instant to stamp on the manifest
 */
export function derivedManifestClock({ clocks, fallback }: { clocks: readonly KindClock[]; fallback: string }): string {
  const present = clocks.flatMap((clock) => (clock.updatedAt === null ? [] : [clock.updatedAt]));
  if (present.length === 0) {
    return fallback;
  }
  // ISO-8601 with a fixed `Z` offset sorts lexicographically in instant order, which is why every clock in
  // this repo is written that way — see `lib/date.ts`.
  return present.reduce((newest, clock) => (clock > newest ? clock : newest));
}

/**
 * The two-clock disagreement ONE LEVEL DOWN, so a publish refuses instead of stamping a derived lie.
 *
 * Deriving the maximum already removes both of the directions the owner named at the manifest level: the
 * clock cannot lag its files, because a fresh file drags it forward, and it cannot run ahead of them,
 * because there is nothing for it to be but their maximum. What deriving does NOT cover is a kind file
 * disagreeing with the status published beside it — the same defect at the kind level, and the one that
 * would feed the derivation a number no reader could check.
 *
 * ## A FAILED kind honestly carries two different clocks, and that is not this defect
 *
 * MEASURED while building this, on `cloudflare/sync/lifecycle.test.ts`'s "a failed read leaves prior entities
 * untouched": a kind whose read failed still has its file REWRITTEN, because its coverage cell now records
 * the failure — so the file's `updatedAt` moves to this run while its `lastSuccessAt` stays at the last run
 * that actually got data. Both are true, and they answer different questions: the file's clock is when the
 * file was last written, the status's is when its DATA last succeeded. Comparing them on a failed kind
 * reported eleven false defects before this was narrowed. So the comparison is gated on the attempt having
 * SUCCEEDED, which is the only case where the two must be the same instant.
 *
 * It follows that a failed kind still drags the manifest clock forward, and that is correct: the generation
 * genuinely changed at that moment. Per-kind freshness is what `lastSuccessAt` is for, and it is untouched.
 *
 * There is deliberately no "this file is in the future" check here. It would need a wall clock, and a wall
 * clock inside a publish makes a replay fixture — a stopped world carrying its own instant, per
 * `.claude/rules/testing.md` — fail the day after it is cut. Measured while building this: eleven Inngest
 * kinds refused on a fixture stamped two days ahead of the day the suite ran.
 *
 * @param clocks every kind's file clock
 * @returns one line per defect, empty when the generation's clocks agree
 */
export function manifestClockDefects({ clocks }: { clocks: readonly KindClock[] }): readonly string[] {
  const defects: string[] = [];
  for (const { kind, writtenSuccessfully, updatedAt, lastSuccessAt } of clocks) {
    const comparable = writtenSuccessfully && lastSuccessAt !== null && updatedAt !== null;
    if (!comparable || lastSuccessAt === updatedAt) {
      continue;
    }
    defects.push(
      `${kind} carries two clocks: its file says ${updatedAt} while the status published` +
        ` beside it says it last succeeded at ${lastSuccessAt}`,
    );
  }
  return defects;
}

/**
 * Every kind's file clock, from memory for what this publish writes and from the envelope on disk for the
 * rest, so the derived manifest clock covers the whole generation rather than only the part being rewritten.
 *
 * A kind whose file cannot be read counts as holding NO clock, exactly as `store.ts`'s `evidenceChanges`
 * counts it as holding no evidence: this is a derivation, and an unreadable file is `readAtlas`'s problem
 * to report, not a reason to refuse an unrelated publish.
 *
 * @param paths the resolved atlas paths, for the kinds whose files are read off disk
 * @param kinds the platform's own exhaustive kind list
 * @param files the kind files this publish is writing, read from memory rather than from disk
 * @param manifest the manifest this publish is about to stamp, for each kind's recorded success time
 * @returns one clock per kind, in the platform's own kind order
 */
export function kindClocks<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  kinds,
  files,
  manifest,
}: {
  paths: AtlasStorePaths<TKind>;
  kinds: readonly TKind[];
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
}): readonly KindClock[] {
  return kinds.map((kind): KindClock => {
    const status = manifest.kinds[kind];
    const lastSuccessAt = status.lastSuccessAt;
    const file = files[kind];
    if (file !== undefined) {
      // Both halves are load-bearing. The OUTCOME excludes a failed kind, whose file legitimately moves
      // while its success time does not. The INSTANT excludes a kind this publish is writing WITHOUT having
      // acquired — `atlas vanta shot` merges a browser-discovered deep link onto two controls and carries
      // the sync's own status through untouched, so its `lastAttempt` is an earlier run's and comparing it
      // to this file's clock compares two publishes. Recording a success there instead would be the real
      // lie: `lastSuccessAt` is what `kit/freshness.ts` reads to decide whether a kind may be quoted as
      // current, so a two-control capture would make a week-old sync of a couple of hundred of them read as minutes old.
      const attempt = status.lastAttempt;
      const writtenSuccessfully = attempt?.outcome === "ok" && attempt.at === file.updatedAt;
      return { kind, lastSuccessAt, updatedAt: file.updatedAt, writtenSuccessfully };
    }
    const envelope = readKindEnvelopeIfPresent({ path: paths.kinds[kind] });
    const stored = envelope.isOk() ? envelope.value : null;
    const updatedAt = isRecord(stored) && typeof stored["updatedAt"] === "string" ? stored["updatedAt"] : null;
    return { kind, lastSuccessAt, updatedAt, writtenSuccessfully: false };
  });
}

/** One kind's status: this run's when it produced one, else the stored manifest's, else never reached. */
function kindStatusFor<TKind extends string>({
  kind,
  statuses,
  prior,
}: {
  kind: TKind;
  statuses: Readonly<Partial<Record<TKind, AtlasKindStatus>>>;
  prior: AtlasManifestLike<TKind> | null;
}): AtlasKindStatus {
  const fresh = statuses[kind];
  if (fresh != null) {
    return fresh;
  }
  const stored = prior?.kinds[kind];
  if (stored != null) {
    return stored;
  }
  return EMPTY_KIND_STATUS;
}

/**
 * Merge this run's per-kind statuses onto the stored manifest — the ONE implementation of a job three
 * atlases had each written privately.
 *
 * There is deliberately no variant that carries the previous top-level timestamp forward, and none that
 * takes one either: `publishAtlas` derives the clock from the files it writes, so `updatedAt` here is a
 * placeholder that publication replaces. `manifestClock.ts`'s header carries the measurement that made the
 * private copies a defect rather than duplication.
 *
 * @param prior the manifest currently on disk, or `null` when this is a fresh generation
 * @param statuses the per-kind statuses this run produced; a kind absent here keeps what it had
 * @param kinds the platform's own exhaustive kind list, iterated so a manifest is never built from a listing
 * @param base the platform's own manifest fields — its platform name, schema version and anything else it
 *   carries, which the kit cannot know
 * @returns the manifest to hand to `store.ts`'s `publishAtlas` — typed as the join it really is, the caller's
 *   own fields plus the kit's `kinds` and clock, so the caller's concrete manifest type is what checks it
 */
export function stampAtlasManifest<TKind extends string, TManifest extends AtlasManifestLike<TKind>>({
  prior,
  statuses,
  kinds,
  base,
}: {
  prior: TManifest | null;
  statuses: Readonly<Partial<Record<TKind, AtlasKindStatus>>>;
  kinds: readonly TKind[];
  base: Omit<TManifest, "kinds" | "updatedAt">;
}): Omit<TManifest, "kinds" | "updatedAt"> & { kinds: Record<TKind, ManifestKindCell>; updatedAt: string } {
  return {
    ...base,
    kinds: recordPerKind({
      kinds,
      valueFor: ({ kind }) => manifestCell({ status: kindStatusFor({ kind, prior, statuses }) }),
    }),
    // Publication derives the real clock from the files; until then a stamped manifest carries the stored
    // one, and an atlas never published before has no stored manifest, so it carries the placeholder.
    updatedAt: prior === null ? PLACEHOLDER_CLOCK : prior.updatedAt,
  };
}

/**
 * Replace ONE kind's status on a manifest, for a sync that threads a manifest through its kinds rather than
 * collecting their statuses first.
 *
 * The incremental half of {@link stampAtlasManifest}, and in the kit for the same reason: this is the exact
 * shape three atlases had each written privately — spread the manifest, rewrite `kinds` — and preserving the
 * top-level clock while doing it is what put a generation five days behind its own files. Neither function
 * can reintroduce that, because neither can set the clock at all.
 *
 * @param manifest the manifest as it stands
 * @param kind which kind's status to replace
 * @param status the status this run produced for it
 * @returns the manifest with that one cell replaced
 */
export function withKindStatus<TKind extends string, TManifest extends AtlasManifestLike<TKind>>({
  manifest,
  kind,
  status,
}: {
  manifest: TManifest;
  kind: TKind;
  status: AtlasKindStatus;
}): TManifest {
  return { ...manifest, kinds: { ...manifest.kinds, [kind]: status } };
}

/**
 * The status a kind takes when neither this run nor the stored manifest has one for it — a kind nothing has
 * ever reached, which is distinct from one that reached and failed.
 */
const EMPTY_KIND_STATUS: AtlasKindStatus = {
  digest: null,
  entityCount: 0,
  lastAttempt: null,
  lastSuccessAt: null,
};

/**
 * One kind's status as a platform manifest stores it: the attempt's reasons copied into the manifest's own
 * mutable array. Every platform manifest is a zod-inferred type whose `reasons` is `string[]`, while the kit's
 * {@link AtlasKindStatus} carries `readonly string[]`, so the status cannot be placed there as it stands — the
 * copy is what makes the stamped manifest assignable to the platform's type rather than asserted into it.
 *
 * @param status the status to place in the manifest
 * @returns the same status, its attempt's reasons a fresh array
 */
function manifestCell({ status }: { status: AtlasKindStatus }) {
  const { lastAttempt } = status;
  return {
    ...status,
    lastAttempt: lastAttempt === null ? null : { ...lastAttempt, reasons: [...lastAttempt.reasons] },
  };
}

/** What {@link stampAtlasManifest} writes under each kind. */
type ManifestKindCell = ReturnType<typeof manifestCell>;

/**
 * What a manifest carries where its clock will go before `store.ts`'s `publishAtlas` derives the real one.
 *
 * Not the empty string and not this run's instant: both are values a reader could mistake for a real clock
 * if a manifest ever escaped unpublished, and the epoch is unmistakable.
 *
 * @internal
 */
export const PLACEHOLDER_CLOCK = new Date(0).toISOString();
