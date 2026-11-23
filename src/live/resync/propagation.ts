/**
 * The propagation map — which derived surface reads which corpus source, and what brings each current after
 * that source syncs.
 *
 * Corpus syncs run and propagate everywhere, because queue cards and pull request data rely on them to stay
 * up to date. Every corpus sync has a session that does a pass over everything in the queue, the workstreams and
 * the database, and updates anything that is worth updating.
 *
 * ## Three ways a surface is brought current, and only one of them is a write here
 *
 * - **`reading`** — the surface draws a PERSISTED reading (`$SLOPWEAVER_HOME/readings/`), so it shows what the
 *   last producer run saw until something runs the producer again. After a sync of a source it reads, the resync
 *   takes a fresh reading itself, in code, with no model. Only `github landing` is this shape for a corpus
 *   source: its review state scans Slack bronze up to the Slack watermark and reads GitHub live.
 * - **`live`** — the console derives it per request from files the sync already wrote (or that nothing in the
 *   corpus feeds), so there is nothing to re-derive.
 * - **`judgement`** — what the visible pass does: read the fresh corpus against the queue, the workstreams and
 *   the store, and update what is worth updating through the typed verbs. That is never code here (rule 2).
 *
 * Silver (`derive`) is not a row: `refresh` already runs it after every fetch (`cli/commands/refresh/run.ts`
 * `postIngestSteps`), so a resync that succeeded has already re-derived it.
 *
 * `docs/propagation-map.md` is {@link renderPropagationMapMarkdown}'s output, byte for byte, and a unit test
 * pins the two together — so the doc cannot drift from what the resync actually does.
 *
 * Pure: declarations, a lookup and a renderer. No I/O.
 */
import type { CorpusSource } from "../../corpus/types.js";
import { FETCHABLE_SOURCES } from "../../integrations/corpusSources.js";

/** A derived surface a corpus sync can leave stale. */
export type PropagationSurface = "pull-requests-review-state" | "queue" | "workstreams" | "fleet-briefing";

/** How one surface is brought current after one source syncs. */
type PropagationMode =
  | { readonly kind: "reading"; readonly producer: "github landing" }
  | { readonly kind: "live"; readonly why: string }
  | { readonly kind: "judgement"; readonly why: string };

/** One surface's line in the map. */
export interface PropagationEdge {
  readonly surface: PropagationSurface;
  readonly mode: PropagationMode;
}

/** What one corpus source's sync propagates to. */
export interface SourcePropagation {
  readonly source: CorpusSource;
  readonly edges: readonly PropagationEdge[];
}

/** Every surface, in the order the doc lists them. */
export const SURFACES: readonly PropagationSurface[] = [
  "pull-requests-review-state",
  "queue",
  "workstreams",
  "fleet-briefing",
];

/** Where each surface is drawn, for a reader of the doc. */
const SURFACE_WHERE: Readonly<Record<PropagationSurface, string>> = {
  "fleet-briefing": "`$SLOPWEAVER_HOME/pages/fleet-briefing/`, published by `briefing render`",
  "pull-requests-review-state":
    "console `/pull-requests` and the queue's `pr` rows, from `reading last --producer 'github landing'`",
  queue: "console `/queue` ask, hand, draft, post and act rows, each a live verb per request",
  workstreams: "console `/fleet`, from `reading last --producer 'handover reconcile'` and the live board",
};

/** The landing reading, for the two sources its review state reads. */
const LANDING: PropagationEdge = {
  mode: { kind: "reading", producer: "github landing" },
  surface: "pull-requests-review-state",
};

/** The same surface, for a source it does not read. */
const LANDING_UNRELATED: PropagationEdge = {
  mode: { kind: "live", why: "the landing derivation reads GitHub live and Slack bronze, never this source" },
  surface: "pull-requests-review-state",
};

/** The three edges every source shares. */
const SHARED: readonly PropagationEdge[] = [
  {
    mode: { kind: "live", why: "every register is re-read per request; the pass decides which rows the sync changed" },
    surface: "queue",
  },
  {
    mode: { kind: "judgement", why: "board rows and their tags are journal state; only the pass can say one moved" },
    surface: "workstreams",
  },
  {
    mode: {
      kind: "judgement",
      why: "`briefing render` needs the chair's typed form; its freshness section reads resync-state at render",
    },
    surface: "fleet-briefing",
  },
];

/**
 * The sources the landing derivation reads — GitHub live, Slack bronze up to its watermark. A fact about that
 * derivation rather than about an integration, so it stays beside {@link LANDING}: a new integration is one the
 * landing reading does not read until the derivation itself changes.
 */
const LANDING_READ_SOURCES: ReadonlySet<string> = new Set(["github", "slack"]);

/**
 * The propagation map over the given sources, in their order: the landing reading for a source it reads, the
 * unrelated landing edge otherwise, then the three edges every source shares.
 *
 * Takes the sources rather than reading {@link FETCHABLE_SOURCES}, so a test can add a fixture source and watch it
 * gain a row; production passes the fetchable list.
 *
 * @param sources the corpus sources the resync roster schedules
 * @returns one row per source, in the order given
 */
export function propagationMapOf<S extends string>({
  sources,
}: {
  sources: readonly S[];
}): readonly { readonly source: S; readonly edges: readonly PropagationEdge[] }[] {
  return sources.map((source) => ({
    edges: [LANDING_READ_SOURCES.has(source) ? LANDING : LANDING_UNRELATED, ...SHARED],
    source,
  }));
}

/** Every fetchable corpus source, and what its sync propagates to. */
export const PROPAGATION_MAP: readonly SourcePropagation[] = propagationMapOf({ sources: FETCHABLE_SOURCES });

/**
 * What one source's sync propagates to.
 *
 * @param source the corpus source that just synced
 * @returns its declared edges, or none for a source the map does not declare
 */
export function propagationFor({ source }: { readonly source: CorpusSource }): readonly PropagationEdge[] {
  const found = PROPAGATION_MAP.find((entry) => entry.source === source);
  if (found === undefined) {
    return [];
  }
  return found.edges;
}

/**
 * Whether a source's sync must take a fresh landing reading.
 *
 * @param source the corpus source that just synced
 * @returns true for a source the pull-requests review state reads
 */
export function takesLandingReading({ source }: { readonly source: CorpusSource }): boolean {
  return propagationFor({ source }).some((edge) => edge.mode.kind === "reading");
}

/**
 * One edge's cell in the doc's table.
 *
 * @param mode how the surface is brought current
 * @returns the cell text
 */
function modeCell({ mode }: { readonly mode: PropagationMode }): string {
  if (mode.kind === "reading") {
    return `re-derived by the resync: fresh \`${mode.producer}\` reading`;
  }
  return `${mode.kind} — ${mode.why}`;
}

/**
 * The propagation map as the markdown `docs/propagation-map.md` holds, byte for byte.
 *
 * @returns the whole document, ending in one newline
 */
export function renderPropagationMapMarkdown(): string {
  const lines: string[] = [
    "# Propagation map — what a corpus sync leaves stale, and what brings it current",
    "",
    "Generated from `src/live/resync/propagation.ts` by `renderPropagationMapMarkdown`; a unit test fails when the",
    "two differ, so edit the declaration and regenerate, never this file.",
    "",
    "Every successful `slopweaver automation resync --source <s>` ends in three steps, in this order:",
    "",
    "1. **Silver** is already current: `refresh` runs `derive` after every fetch.",
    "2. **Readings** the map marks `re-derived` are taken again by the resync itself, in code, no model, and",
    "   each receipt (`readingId`, `observedAtIso`) lands in `$SLOPWEAVER_HOME/live/recipe/propagation/`.",
    "3. **Judgement** joins ONE visible pass: the first sync seats an Opus session through `cmux spawn` on a",
    "   dispatch board row, and every later sync joins that open pass rather than seating another.",
    "   `slopweaver automation propagate --status` prints what it covers.",
    "",
    "A resync whose propagation fails still succeeded as a sync; the failure is on the record the pass reads.",
    "",
    "## Where each surface is drawn",
    "",
    ...SURFACES.map((surface) => `- \`${surface}\` — ${SURFACE_WHERE[surface]}`),
    "",
    "## Per source",
  ];
  // Lists rather than tables: Prettier pads a table's columns, which would break the byte-for-byte pin.
  for (const entry of PROPAGATION_MAP) {
    lines.push("", `### \`${entry.source}\``, "");
    for (const edge of entry.edges) {
      lines.push(`- \`${edge.surface}\` — ${modeCell({ mode: edge.mode })}`);
    }
  }
  lines.push(
    "",
    "## What no corpus sync feeds",
    "",
    "Atlases feed only the Fleet Briefing's freshness section, read at render time; hand cards are frozen at",
    "`hand post`. Neither is re-derived after a corpus sync.",
    "",
  );
  return lines.join("\n");
}
