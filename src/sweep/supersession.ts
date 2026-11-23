/**
 * Which live board row supersedes which — read from a row's own DECLARATION, never inferred from a mention.
 *
 * ## The measurement that settled the design
 *
 * The first cut of this file inferred supersession from a mention: a strictly newer live row naming an older
 * row's slug. Run against the live board it proposed three edges, and **every one was a false
 * positive of the same kind** — the newer row cited the older one as EVIDENCE. Reproduce the sharpest:
 *
 * ```bash
 * grep -n 'delete-three-days-of-alert-channel-digests' \
 *   ~/.slopweaver/handovers/register-repo-slug-is-written-as-a-path-and-spawn-hides-the-enoent.md
 * ```
 *
 * Two hits, both an `evidence:` link. A citation is the opposite of a replacement: it says the older row is
 * still worth reading. Inference would have settled three live rows on the strength of their being useful.
 *
 * ## So supersession is DECLARED, which is also what the precedent does
 *
 * The published page cited the ADR convention, and the thing to copy
 * from it is not the vocabulary but the direction of the write: `Status: Superseded by ADR-0012` is a line
 * somebody TYPED. Google's g3doc freshness dates are the same shape — a human declares the claim and the
 * machine checks it, rather than the machine guessing the claim.
 *
 * **The honest consequence, stated rather than discovered:** nothing on the board declares this yet, so this
 * verdict is ZERO on its first run and stays zero until rows start carrying the field. That is the correct
 * number. A mechanism that reports three deletions it cannot justify is worse than one that reports none.
 *
 * ## The one inferred edge: a later top-up GENERATION
 *
 * A top-up automation registers one row per firing, `<stem>-<owner>-<repo>-<epochMs>`, each a gap-limited batch
 * planned from the repository's state at that moment. So a row matching the same top-up's slug and batch brief
 * with a larger epoch is a reason to look again at the older one — not a mention, and not age — though it
 * proves neither that a planner made it (`handover register --slug` can write the shape) nor that it took the
 * older batch over, so the classifier reports it and never acts. MEASURED: `vulnfix-topup-acme-acme-admin-1789633808900`
 * (seat dead a day after it registered) stood open for a month while six later generations of the same prefix
 * were registered and settled, and `sweep board` read it UNWITNESSED throughout. Every generation and the
 * instant it registered:
 *
 * ```bash
 * grep -H '^askedIso:' ~/.slopweaver/handovers/vulnfix-topup-acme-acme-admin-*.md
 * ```
 *
 * The recipe's SCHEDULE was weighed as the witness instead and dropped: a held recipe is due and never fires,
 * so a schedule proves a firing was owed, while the later row proves one happened.
 *
 * Pure: text and timestamps in, edges out. No filesystem, no clock.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { topupBatchFromAsk } from "../review/vulnTopupBatchRead.js";
import { TOPUP_SLUG_STEM } from "../review/vulnTopupGate.js";

/**
 * Why one row is superseded, and by which newer row.
 *
 * `declared` is a newer live row's own typed line; `generation` is a later firing of the same top-up, which
 * carries the instant that firing registered so the witness can be checked without opening either row, and the
 * recipe id that fires it (`<stem>-<name>`, `slopweaver automation status`), the one a pause may name.
 */
export type SupersessionEdge =
  | { readonly kind: "declared"; readonly newerSlug: string }
  | {
      readonly kind: "generation";
      readonly newerSlug: string;
      readonly recipe: string;
      readonly registeredIso: string;
    };

/** One live row, reduced to what supersession needs. */
export interface SupersessionInput {
  readonly slug: string;
  /** The row's own `askedIso`, or `undefined` when it declares none — such a row never supersedes anything. */
  readonly askedIso: string | undefined;
  /** The row's full text, as read from disk. */
  readonly text: string;
}

/**
 * The slugs one row's text declares it supersedes.
 *
 * Two spellings are read, and both are a DECLARATION rather than a mention:
 *
 * - a front-matter `supersedes:` key, whose value is one slug or a bracketed comma-separated list;
 * - a prose line whose first word is `supersedes` or `replaces`, followed by the slug.
 *
 * The prose form exists because the board's rows are written by hand as often as by a verb, and a convention
 * only one of the two can express would be followed by neither.
 *
 * @param text the row's whole file
 * @returns every slug it declares superseded, in the order declared
 */
export function declaredSupersedes({ text }: { text: string }): readonly string[] {
  const found: string[] = [];
  text.split("\n").forEach((line) => {
    const trimmed = line.trim().replace(/^[-*]\s+/u, "");
    // The keyword is matched on its own and the separator is stripped with plain string work, rather than in
    // one `\s*:?\s+` pattern. Those three quantifiers are adjacent over overlapping classes, so a long run of
    // whitespace makes the engine try every split of it — `redos-check` refuses exactly that shape.
    const keyword = /^(?:supersedes|replaces)\b/iu.exec(trimmed);
    if (keyword === null) {
      return;
    }
    let body = trimmed.slice(keyword[0].length).trimStart();
    if (body.startsWith(":")) {
      body = body.slice(1).trimStart();
    }
    if (body.length === 0) {
      return;
    }
    body
      .replace(/^\[/u, "")
      .replace(/\]$/u, "")
      .split(",")
      .forEach((piece) => {
        const slug = piece.trim().replace(/^`|`$/gu, "");
        if (/^[a-z0-9][a-z0-9-]*$/u.test(slug)) {
          found.push(slug);
        }
      });
  });
  return found;
}

/**
 * Compute every supersession edge across the live rows.
 *
 * A declaration is honoured only when the declaring row is **strictly newer** and is itself **still live** —
 * the caller passes only live rows, and the timestamp check is what stops a backfilled row from retiring the
 * work that replaced it. Where two live rows declare the same slug, the newest one wins, so the edge names
 * the row a reader should go and read instead.
 *
 * @param rows every live row, each with its text and its own asked instant
 * @returns superseded slug to the newest live row that declares it superseded
 */
export function supersessionEdges({
  rows,
}: {
  rows: readonly SupersessionInput[];
}): ReadonlyMap<string, SupersessionEdge> {
  const edges = new Map<string, SupersessionEdge>();
  const winners = new Map<string, string>();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  rows.forEach((declaring) => {
    const declaringAsked = declaring.askedIso;
    if (declaringAsked === undefined) {
      return;
    }
    declaredSupersedes({ text: declaring.text }).forEach((slug) => {
      const older = bySlug.get(slug);
      if (older === undefined || older.slug === declaring.slug) {
        return;
      }
      const olderAsked = older.askedIso;
      if (olderAsked === undefined || olderAsked >= declaringAsked) {
        return;
      }
      const standing = winners.get(slug);
      if (standing === undefined || declaringAsked > standing) {
        winners.set(slug, declaringAsked);
        edges.set(slug, { kind: "declared", newerSlug: declaring.slug });
      }
    });
  });
  return edges;
}

/** One scanned row, reduced to what the generation witness reads. */
export interface GenerationInput {
  readonly slug: string;
  /**
   * The row's own `askedIso`; a row without a parseable one is neither superseded nor supersedes. An integrity
   * check only, never the order: `handover quote --apply` re-dates it to a transcript turn.
   */
  readonly askedIso: string | undefined;
  /**
   * Whether the top-up's own strict batch reader reads the brief ({@link generationBriefReads}): a slug and an
   * opening sentence in the convention's shape are a naming inference, a batch that parses is a firing.
   */
  readonly briefReads: boolean;
  /**
   * The `owner/name` the row's brief names, or `undefined` when its opening sentence does not parse.
   *
   * The slug alone is not a repository identity: `acme-tools/api` and `acme/tools-api` flatten to one prefix,
   * which `review/vulnTopupBatchRead.ts`'s `topupAskRepo` exists to tell apart. A row without one infers no edge.
   */
  readonly repo: string | undefined;
  /**
   * Whether the doc may carry evidence at all. An untrusted doc (front-matter problems, or an archived file not
   * named for its slug) infers no edge on either side, but still counts against its slug's uniqueness, so a
   * malformed copy of a slug can never leave the clean copy looking like the only one.
   */
  readonly trusted: boolean;
}

/** A generation slug: the top-up stem, the flattened repository, the epoch. */
const GENERATION_SLUG = new RegExp(`^(${TOPUP_SLUG_STEM})-(.+)-(\\d{13})$`, "u");

/** One `owner/name` and nothing else — `topupAskRepo` reads any non-space token, so the shape is checked here. */
const OWNER_NAME = /^([^/\s]+)\/([^/\s]+)$/u;

/**
 * The top-up one row is a generation of — its stem and repository — or nothing.
 *
 * The slug must be EXACTLY `topupSlugPrefix` of the repository its brief names, plus an epoch: the brief tells
 * apart two repositories whose slugs flatten alike, and the slug ties the brief to the row it sits in.
 * Both compare case-folded, as GitHub resolves `Acme/API` and `acme/api` to one
 * repository.
 *
 * @param row the scanned row
 * @returns the grouping key, the slug's epoch and the recipe id, or undefined when the row is not a generation
 */
function generationOf({
  row,
}: {
  row: GenerationInput;
}): { readonly key: string; readonly epoch: number; readonly recipe: string } | undefined {
  const match = GENERATION_SLUG.exec(row.slug);
  if (match === null || row.repo === undefined || !row.briefReads || !row.trusted) {
    return undefined;
  }
  const repo = OWNER_NAME.exec(row.repo);
  if (repo === null || match[2]!.toLowerCase() !== `${repo[1]!}-${repo[2]!}`.toLowerCase()) {
    return undefined;
  }
  return {
    epoch: Number(match[3]!),
    key: `${match[1]!} ${row.repo.toLowerCase()}`,
    recipe: `${match[1]!}-${repo[2]!}`.toLowerCase(),
  };
}

/** One parsed generation, grouped by everything that makes two rows the same top-up. */
interface Generation {
  readonly slug: string;
  readonly askedIso: string | undefined;
  readonly epoch: number;
  readonly recipe: string;
}

/**
 * Whether `a` carries a later slug epoch than `b` — the epoch alone, which `runTopup` mints once and nothing
 * rewrites, though a hand `handover register --slug` can choose one.
 *
 * Never by `askedIso`: `handover quote --apply` re-dates it to a transcript turn, so an older generation quoted
 * later would outrank the newest and settle it. An equal epoch fires later than neither.
 *
 * @param a the challenger
 * @param b the standing newest
 * @returns true when `a` should replace `b` as the newest
 */
function registeredLater({ a, b }: { a: Generation; b: Generation }): boolean {
  return a.epoch > b.epoch;
}

/**
 * Whether a row's brief is a batch the top-up's own strict reader parses — the one its merge-release gate already
 * trusts to read a generation's brief back: the slug must carry the top-up stem, and the reader must read every
 * batch line and match the count the opening sentence states.
 *
 * @param slug the row's slug, which must carry the top-up stem
 * @param summary the row's brief, exactly as registered
 * @param repo the `owner/name` the brief names, or undefined when it names none
 * @returns true when the brief reads as one firing's batch
 */
export function generationBriefReads({
  slug,
  summary,
  repo,
}: {
  slug: string;
  summary: string;
  repo: string | undefined;
}): boolean {
  if (repo === undefined) {
    return false;
  }
  if (!slug.startsWith(`${TOPUP_SLUG_STEM}-`)) {
    return false;
  }
  return topupBatchFromAsk({ ask: summary, repo }).isOk();
}

/**
 * Whether a paused generation's pause named exactly its recipe's next firing, and a later-epoch row of the same
 * top-up came after the pause began — so the row is worth a person's look.
 *
 * A pause is a rail above every pruning rule (`handover/prune.ts`), and a pause on a PERSON stays one. But the
 * measured dead row (`vulnfix-topup-acme-acme-admin-1789633808900`) was paused on "the vulnfix-topup-acme-admin
 * recipe's next firing" before a later generation came, and hiding the row would
 * leave it the defect described. Whether that row WAS the firing no row records — an investigation run
 * registered it — so this only lets the row be reported, never settled. `pausedOn` is free text naming a person, team or outside
 * party (`handover/doc.ts`), so merely MENTIONING the recipe proves nothing — "Alice's review of whether the
 * vulnerability-fix-topup recipe is safe" is a pause on Alice. A pause is discharged only when the WHOLE of
 * `pausedOn` is {@link PAUSE_ON_FIRING} naming exactly the recipe that fires this top-up, `pausedSince` parses
 * strictly, and the newer generation's epoch is strictly after it.
 *
 * @param doc the paused row's pause
 * @param newerSlug the later-epoch row the edge names
 * @param recipe the recipe id that fires this top-up, off the generation edge
 * @returns true when the pause awaited exactly that recipe's firing and the newer row's epoch follows it
 */
export function pauseDischargedBy({
  doc,
  newerSlug,
  recipe,
}: {
  doc: { readonly pausedOn: string | undefined; readonly pausedSince: string | undefined };
  newerSlug: string;
  recipe: string;
}): boolean {
  const newerEpoch = GENERATION_SLUG.exec(newerSlug)?.[3];
  if (newerEpoch === undefined || doc.pausedOn === undefined || doc.pausedSince === undefined) {
    return false;
  }
  const named = PAUSE_ON_FIRING.exec(doc.pausedOn.trim())?.[1];
  const since = parseStrictIsoInstantMs({ text: doc.pausedSince });
  if (named === undefined || since === undefined || named.toLowerCase() !== recipe.toLowerCase()) {
    return false;
  }
  return Number(newerEpoch) > since;
}

/** The one pause text a firing discharges, whole: the measured row's own words, with the recipe id captured. */
const PAUSE_ON_FIRING = /^the (\S+) recipe's next firing$/iu;

/**
 * Every generation row grouped by its top-up's key, family and owner/name repo.
 *
 * An edge is keyed by slug alone, so a slug two scanned docs carry cannot say which doc it means: it takes part
 * on neither side.
 *
 * @param rows every scanned row; a slug that is not a generation, or that two rows share, is left out
 * @returns each top-up's key to its generations, in row order
 */
function generationGroups({ rows }: { rows: readonly GenerationInput[] }): ReadonlyMap<string, Generation[]> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  rows.forEach((row) => {
    if (seen.has(row.slug)) {
      shared.add(row.slug);
    }
    seen.add(row.slug);
  });
  const groups = new Map<string, Generation[]>();
  rows.forEach((row) => {
    const parsed = shared.has(row.slug) ? undefined : generationOf({ row });
    if (parsed === undefined) {
      return;
    }
    const { epoch, key, recipe } = parsed;
    const group = groups.get(key);
    const generation = { askedIso: row.askedIso, epoch, recipe, slug: row.slug };
    if (group === undefined) {
      groups.set(key, [generation]);
    } else {
      group.push(generation);
    }
  });
  return groups;
}

/**
 * Map every top-up generation that a later-epoch row of the same top-up overtakes to that newest one.
 *
 * Every row is passed, settled ones included: the newest generation has usually been settled already, and it
 * is evidence the top-up moved on, not a claim that the work is still live. Each older generation maps
 * straight to the NEWEST, never to its immediate successor, so the edge names the row a reader should read.
 *
 * @param rows every scanned row; a slug that is not a generation is ignored
 * @returns superseded slug to the newest generation of its top-up
 */
export function generationSupersessionEdges({
  rows,
}: {
  rows: readonly GenerationInput[];
}): ReadonlyMap<string, SupersessionEdge> {
  const edges = new Map<string, SupersessionEdge>();
  generationGroups({ rows }).forEach((group) => {
    // Only a DATED generation takes part, on both sides: a row whose asked instant is absent or will not parse
    // is not a well-formed registration, so it is never superseded, and never supersedes. Parsed
    // strictly: `Date.parse` rolls a nonexistent day into the next month. The instant gates; the epoch orders.
    const dated = group.filter(
      (generation) =>
        generation.askedIso !== undefined && parseStrictIsoInstantMs({ text: generation.askedIso }) !== undefined,
    );
    let newest: Generation | undefined;
    dated.forEach((generation) => {
      if (newest === undefined || registeredLater({ a: generation, b: newest })) {
        newest = generation;
      }
    });
    if (newest === undefined) {
      return;
    }
    const winner = newest;
    // Strictly later, never merely a different slug: two casings of one slug can tie on epoch,
    // and a tie supersedes neither. Nor ever its own slug: two scanned docs can carry one slug,
    // and an edge keyed by it would reach the newest row too.
    dated
      .filter((generation) => generation.slug !== winner.slug && registeredLater({ a: winner, b: generation }))
      .forEach((generation) => {
        edges.set(generation.slug, {
          kind: "generation",
          newerSlug: winner.slug,
          recipe: winner.recipe,
          registeredIso: new Date(winner.epoch).toISOString(),
        });
      });
  });
  return edges;
}

/**
 * Both edge sources as one map, a DECLARED edge winning where both name the same row.
 *
 * Declared wins because it is somebody's typed statement about which row replaced which, and the generation
 * edge is an inference; where they disagree, the statement is the one to read.
 *
 * @param declared the edges rows declare
 * @param generated the later-generation edges
 * @returns one edge per superseded slug
 */
export function mergeSupersessionEdges({
  declared,
  generated,
}: {
  declared: ReadonlyMap<string, SupersessionEdge>;
  generated: ReadonlyMap<string, SupersessionEdge>;
}): ReadonlyMap<string, SupersessionEdge> {
  return new Map([...generated, ...declared]);
}
