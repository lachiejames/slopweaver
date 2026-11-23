/**
 * The closed list of frozen readings a page may show instead of a live one.
 *
 * A fixture exists so a page can be REACTED TO before the verb behind it is cheap enough, or exists at
 * all, to read on every open — `github landing --json --include-drafts` took 68 seconds on this machine
 * over eleven rows (mock data first is allowed). What makes one safe to show is that it
 * is labelled in the same weight as a live stamp: the route answers with `fixture` set, and every tile
 * prints FIXTURE and the frozen instant where it would print how long ago the machine was read.
 *
 * The map is closed for the same reason `liveVerbs.ts` is: a name off the URL is looked up here and
 * resolves to a basename this file chose, so nothing the URL carries ever becomes a path. An unknown
 * name is a 404, a bug in the page, exactly like an unknown verb slug.
 *
 * A fixture is the verb's own `--json` document in the exact shape the argv on its row prints: either a
 * capture taken with that argv, re-captured rather than hand-edited, or a written synthetic document whose
 * people, organisation and ids are invented (`acme`, `0SYN`) while every key, count, verdict and instant
 * stays the verb's. A credential in one is what the pre-push scan refuses.
 */

/** One frozen reading: which verb it stands in for, and when it was true of the machine. */
export interface LiveFixture {
  /** The allowlist slug of the verb this reading stands in for. */
  readonly slug: string;
  /** The name a page passes as `?fixture=<name>`. */
  readonly name: string;
  /** The basename under `site/fixtures/<slug>/`, chosen here, never by a caller. */
  readonly file: string;
  /** The instant the reading stands at — the fixture's own clock, printed wherever an age would be. */
  readonly frozenAtIso: string;
  /** The exact command whose document this is, or whose shape a synthetic one keeps. */
  readonly takenWith: string;
}

/** Every frozen reading the site holds. Adding a row here is the only way to add one. */
export const LIVE_FIXTURES: readonly LiveFixture[] = [
  {
    file: "2026-09-20.json",
    frozenAtIso: "2026-09-20T00:59:47Z",
    name: "2026-09-20",
    slug: "landing-reading",
    // Written synthetic, in the shape of three verbs, the last over a throwaway home: a landing document
    // over eleven invented pull requests, recorded as a reading, then read back as the page's own row reads it.
    takenWith:
      "dir=$(mktemp -d) && slopweaver github landing --json --include-drafts --author @me --limit 60 " +
      '> "$dir/landing.json" && slopweaver reading record --producer "github landing" --from "$dir/landing.json" ' +
      '--by fixture-capture --observed-at 2026-09-20T00:59:47Z --home "$dir" && ' +
      'slopweaver reading last --producer "github landing" --home "$dir" --json',
  },
  {
    file: "2026-09-20.json",
    frozenAtIso: "2026-09-20T05:34:11.986Z",
    name: "2026-09-20",
    slug: "watchers",
    // Written synthetic in the verb's shape, over the same repositories as the landing reading above, so
    // the fixture page's two readings are of one world. Nothing holds a watch at that instant, which every
    // entry says with an empty `watchers`.
    takenWith: "slopweaver github watchers --json",
  },
  // The three below are one instant, within half an hour the same morning, so the `now` fixture page reads
  // as one world: 15 open seats (five needing input, one silent, nine working, one of them unmapped), no
  // listener armed, and an ALERT on memory with no HOLD. Each is a verb's document recorded as a reading into
  // a throwaway home and read back as the page's row reads it; the seats and capacity are written synthetic.
  {
    file: "2026-09-20.json",
    frozenAtIso: "2026-09-20T09:24:10.306Z",
    name: "2026-09-20",
    slug: "watch-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver session watch --json-report > "$dir/watch.json" && slopweaver reading record ' +
      '--producer "session watch" --from "$dir/watch.json" --by fixture-capture --observed-at 2026-09-20T09:24:10.306Z ' +
      '--home "$dir" && slopweaver reading last --producer "session watch" --home "$dir" --json',
  },
  {
    file: "2026-09-20.json",
    frozenAtIso: "2026-09-20T08:58:42Z",
    name: "2026-09-20",
    slug: "listener-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver listen status --json > "$dir/listen.json" && slopweaver reading record ' +
      '--producer "listen status" --from "$dir/listen.json" --by fixture-capture --observed-at 2026-09-20T08:58:42Z ' +
      '--home "$dir" && slopweaver reading last --producer "listen status" --home "$dir" --json',
  },
  {
    file: "2026-09-20.json",
    frozenAtIso: "2026-09-20T08:58:39Z",
    name: "2026-09-20",
    slug: "capacity-reading",
    // The verb exits 1 on this verdict, and the document is the whole point: its ALERT verdict is in it.
    takenWith:
      'dir=$(mktemp -d) && slopweaver machine capacity --json > "$dir/cap.json"; slopweaver reading record ' +
      '--producer "machine capacity" --from "$dir/cap.json" --by fixture-capture --observed-at 2026-09-20T08:58:39Z ' +
      '--home "$dir" && slopweaver reading last --producer "machine capacity" --home "$dir" --json',
  },
  // The three below are one instant inside forty seconds, the first reading whose plans' ceilings carry each
  // plan's account and free resets — the reading the Fleet page's per-plan meters draw. Each document's own
  // instant is its `--observed-at`; the capacity and seats are written synthetic, the ceiling a capture.
  {
    file: "2026-10-07.json",
    frozenAtIso: "2026-10-07T18:46:51Z",
    name: "2026-10-07",
    slug: "capacity-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver machine capacity --json > "$dir/cap.json"; slopweaver reading record ' +
      '--producer "machine capacity" --from "$dir/cap.json" --by fixture-capture --observed-at 2026-10-07T18:46:51Z ' +
      '--home "$dir" && slopweaver reading last --producer "machine capacity" --home "$dir" --json',
  },
  {
    file: "2026-10-07.json",
    frozenAtIso: "2026-10-07T18:47:23.200Z",
    name: "2026-10-07",
    slug: "watch-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver session watch --json-report > "$dir/watch.json" && slopweaver reading record ' +
      '--producer "session watch" --from "$dir/watch.json" --by fixture-capture --observed-at 2026-10-07T18:47:23.200Z ' +
      '--home "$dir" && slopweaver reading last --producer "session watch" --home "$dir" --json',
  },
  {
    file: "2026-10-07.json",
    frozenAtIso: "2026-10-07T18:47:25.040Z",
    name: "2026-10-07",
    slug: "ceiling-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver fleet ceiling --days 7 --json > "$dir/ceiling.json" && slopweaver reading record ' +
      '--producer "fleet ceiling" --from "$dir/ceiling.json" --by fixture-capture --observed-at 2026-10-07T18:47:25.040Z ' +
      '--home "$dir" && slopweaver reading last --producer "fleet ceiling" --home "$dir" --json',
  },
  // `usage-limit`: the capture world of the rows above with two plans the owner's own settings stop — `codex-ambient` at its 30%
  // usage limit (its weekly window 30 of 30, so the raise offers 40%) and `plan-four` on a monthly spend nothing
  // measures. Written synthetic from that capacity capture; the seats and ceiling are that capture's own.
  {
    file: "usage-limit.json",
    frozenAtIso: "2026-10-07T18:46:51Z",
    name: "usage-limit",
    slug: "capacity-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver machine capacity --json > "$dir/cap.json"; slopweaver reading record ' +
      '--producer "machine capacity" --from "$dir/cap.json" --by fixture-capture --observed-at 2026-10-07T18:46:51Z ' +
      '--home "$dir" && slopweaver reading last --producer "machine capacity" --home "$dir" --json',
  },
  {
    file: "2026-10-07.json",
    frozenAtIso: "2026-10-07T18:47:23.200Z",
    name: "usage-limit",
    slug: "watch-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver session watch --json-report > "$dir/watch.json" && slopweaver reading record ' +
      '--producer "session watch" --from "$dir/watch.json" --by fixture-capture --observed-at 2026-10-07T18:47:23.200Z ' +
      '--home "$dir" && slopweaver reading last --producer "session watch" --home "$dir" --json',
  },
  {
    file: "2026-10-07.json",
    frozenAtIso: "2026-10-07T18:47:25.040Z",
    name: "usage-limit",
    slug: "ceiling-reading",
    takenWith:
      'dir=$(mktemp -d) && slopweaver fleet ceiling --days 7 --json > "$dir/ceiling.json" && slopweaver reading record ' +
      '--producer "fleet ceiling" --from "$dir/ceiling.json" --by fixture-capture --observed-at 2026-10-07T18:47:25.040Z ' +
      '--home "$dir" && slopweaver reading last --producer "fleet ceiling" --home "$dir" --json',
  },
];

/**
 * Resolve a fixture name for one verb, or nothing.
 *
 * @param slug the verb's allowlist slug
 * @param name the name off the URL
 * @returns the row when both match one, else `undefined`
 */
export function liveFixtureFor({ slug, name }: { slug: string; name: string }): LiveFixture | undefined {
  return LIVE_FIXTURES.find((row) => row.slug === slug && row.name === name);
}
