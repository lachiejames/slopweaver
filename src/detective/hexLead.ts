/**
 * Turning what the LOCAL Hex atlas knows into leads a wave can spend a detective on. Pure.
 *
 * ## The same gate shape as Datadog's, and the same reason
 *
 * `datadogLead.ts` probes a question's keywords against a local shape catalogue and costs no network; this
 * does the identical thing against the Hex atlas's stored `project` and `resource` rows. A question whose
 * keywords hit nothing produces no Hex lead and the wave never touches Hex — which matters more here than
 * there, because a Hex read is a read of customer data behind Hex's own masking, and spending one on a
 * question that has nothing to do with the warehouse is exactly what should not happen.
 *
 * ## What makes a hit, and why a table name counts
 *
 * A project's title, description and categories are what a person wrote about the question the notebook
 * answers, so they are the strongest signal. A project's QUERIED TABLE names are next, and they are the
 * reason this gate reaches questions nobody phrased in a notebook's words: a question naming a
 * booking or a customer hits the tables those notebooks read even when no title mentions
 * them. A data connection's name is the weakest — it names a warehouse, not a subject — and produces one
 * workspace-wide lead rather than one per connection.
 *
 * ## Why this gate exists at all, in the owner's own terms
 *
 * Datadog is useful for debugging issues over the last 15 days but is not great for a full breakdown of who is
 * affected and who is not. A Datadog lead and a Hex lead on
 * the same question is the correlation the owner asked for — the first is event-by-event inside the window, the
 * second is the long view — so the two gates run side by side and the wave's round-robin gives each a slot.
 */
import { absentAsNull } from "#lib/absent.js";
import { MIN_KEYWORD_CHARS } from "../datadog/detective/gate.js";
import type { Lead } from "./fanout.js";

/**
 * The `source` every Hex lead carries, so a brief and a report can tell it from a store or Datadog lead.
 *
 * @internal
 */
export const HEX_LEAD_SOURCE = "hex";

/**
 * How much one rank of hit kind is worth, in the nominal units {@link hexLeadWeight} counts in.
 *
 * Matched to `datadogLead.ts`'s own constant deliberately: the two gates' weights are compared against each
 * other by `planWave`'s ordering, so a Hex project hit and a Datadog service hit have to be denominated the
 * same way or one source silently outranks the other on arithmetic nobody chose.
 */
const KIND_WEIGHT = 1000;

/**
 * What kind of thing in the atlas a keyword hit, weakest last.
 *
 * @internal
 */
export const HEX_HIT_KINDS = ["project-title", "queried-table", "project-description", "connection"] as const;

/** One hit kind's id. */
export type HexHitKind = (typeof HEX_HIT_KINDS)[number];

/** One stored Hex row, reduced to what this gate matches on. The caller projects the atlas into these. */
export interface HexAtlasSubject {
  /** The project's own id, which is the `startShape` a detective opens on. `null` for a connection row. */
  readonly projectId: string | null;
  /** The title, or the connection's name. */
  readonly name: string;
  /** The description, or `null`. */
  readonly description: string | null;
  /** The project's categories; empty for a connection. */
  readonly categories: readonly string[];
  /** The warehouse tables the project's cells query; empty for a connection. */
  readonly queriedTables: readonly string[];
  /** Whether this row is a project or a data connection. */
  readonly family: "project" | "connection";
}

/** Case-insensitive containment in either direction — the same rule `datadog/detective/gate.ts` applies. */
function touches({ keyword, value }: { keyword: string; value: string }): boolean {
  const left = keyword.toLowerCase();
  const right = value.toLowerCase();
  return right.includes(left) || left.includes(right);
}

/**
 * How much one subject's accumulated hits are worth, dominated by the strongest kind.
 *
 * The count only breaks ties, for the reason `datadogLead.ts` measured: a project whose TITLE names the
 * question is a categorically better lead than one whose table list mentions the word nine times, and an
 * ordering that counted would put the second first.
 *
 * @param hits how many things on this subject matched
 * @param kinds every kind of thing it matched
 * @returns the nominal weight
 */
export function hexLeadWeight({ hits, kinds }: { hits: number; kinds: ReadonlySet<HexHitKind> }): number {
  const strongest = Math.min(...[...kinds].map((kind) => HEX_HIT_KINDS.indexOf(kind)));
  return (HEX_HIT_KINDS.length - strongest) * KIND_WEIGHT + hits;
}

/** What one keyword matched on one subject. */
interface SubjectHits {
  readonly keywords: readonly string[];
  readonly kinds: ReadonlySet<HexHitKind>;
  readonly matched: readonly string[];
  readonly count: number;
}

/**
 * Everything one subject matched, across every usable keyword.
 *
 * @param subject the stored row
 * @param keywords the question's keywords, already filtered for length
 * @returns what it matched, or `null` when it matched nothing
 */
function subjectHits({
  subject,
  keywords,
}: {
  subject: HexAtlasSubject;
  keywords: readonly string[];
}): SubjectHits | null {
  const kinds = new Set<HexHitKind>();
  const words = new Set<string>();
  const matched: string[] = [];
  let count = 0;
  for (const keyword of keywords) {
    for (const hit of keywordHits({ keyword, subject })) {
      kinds.add(hit.kind);
      words.add(keyword);
      count += 1;
      if (hit.matched !== null) {
        matched.push(hit.matched);
      }
    }
  }
  if (kinds.size === 0) {
    return null;
  }
  return { count, keywords: [...words].toSorted(), kinds, matched: [...new Set(matched)].toSorted() };
}

/** What one keyword matched on one subject: the kind, and the exact string, when there is one to quote. */
interface KeywordHit {
  readonly kind: HexHitKind;
  /** The value matched, when naming it helps a reader — a table name — else `null` for prose. */
  readonly matched: string | null;
}

/**
 * Everything ONE keyword matches on one subject — at most one hit per field.
 *
 * Pulled out of {@link subjectHits} rather than nested inside its loop: three independent tests over three
 * fields read as three lines here and as a branch thicket there, which is exactly the shape the complexity
 * ceiling names.
 *
 * @param subject the stored row
 * @param keyword one keyword, already known long enough to discriminate
 * @returns its hits, strongest field first
 */
function keywordHits({ subject, keyword }: { subject: HexAtlasSubject; keyword: string }): readonly KeywordHit[] {
  const isConnection = subject.family === "connection";
  const nameHit: readonly KeywordHit[] = touches({ keyword, value: subject.name })
    ? [{ kind: isConnection ? "connection" : "project-title", matched: subject.name }]
    : [];
  const table = subject.queriedTables.find((name) => touches({ keyword, value: name }));
  const tableHit: readonly KeywordHit[] = table === undefined ? [] : [{ kind: "queried-table", matched: table }];
  const prose = [describedProse({ description: subject.description }), ...subject.categories].join("\n");
  const proseHit: readonly KeywordHit[] =
    prose.length > 0 && touches({ keyword, value: prose })
      ? [{ kind: isConnection ? "connection" : "project-description", matched: null }]
      : [];
  return [...nameHit, ...tableHit, ...proseHit];
}

/**
 * The prose a subject's description contributes to the match.
 *
 * Hex returns a project or data connection with no description when nobody ever wrote one, and the atlas
 * stores that as `null`; there is then no author's prose to match a keyword against, so it contributes none.
 */
function describedProse({ description }: { description: string | null }): string {
  if (description === null) {
    return "";
  }
  return description;
}

/**
 * The lead one project earns.
 *
 * @param subject the stored project row
 * @param hits what it matched
 * @returns the lead, carrying the project id as where to open
 */
function projectLead({ subject, hits }: { subject: HexAtlasSubject; hits: SubjectHits }): Lead {
  const first = hits.keywords[0];
  return {
    keyword: absentAsNull({ value: first }),
    rows: hexLeadWeight({ hits: hits.count, kinds: hits.kinds }),
    source: HEX_LEAD_SOURCE,
    startShape: subject.projectId,
    why:
      `the Hex atlas holds the project "${subject.name}" matching ${hits.keywords.map((word) => `"${word}"`).join(", ")} ` +
      `(${[...hits.kinds].toSorted((left, right) => HEX_HIT_KINDS.indexOf(left) - HEX_HIT_KINDS.indexOf(right)).join(", ")})` +
      (hits.matched.length === 0 ? "" : ` — via ${hits.matched.join(", ")}`),
  };
}

/**
 * Probe one question's keywords against the stored Hex atlas.
 *
 * Touches no network and reaches no credential: this is the half of the design that costs nothing, and a
 * question that fails it never spends a read on the warehouse at all.
 *
 * @param subjects the atlas's project and connection rows, already projected
 * @param keywords the question's keywords, exactly as a caller typed them
 * @returns one lead per matching project, plus at most one for the connections, strongest first
 */
export function hexLeads({
  subjects,
  keywords,
}: {
  subjects: readonly HexAtlasSubject[];
  keywords: readonly string[];
}): readonly Lead[] {
  const usable = keywords.filter((keyword) => keyword.trim().length >= MIN_KEYWORD_CHARS);
  const projects: Lead[] = [];
  const connectionWords = new Set<string>();
  const connectionNames: string[] = [];
  let connectionHits = 0;
  for (const subject of subjects) {
    const hits = subjectHits({ keywords: usable, subject });
    if (hits === null) {
      continue;
    }
    if (subject.family === "project") {
      projects.push(projectLead({ hits, subject }));
    } else {
      connectionHits += hits.count;
      connectionNames.push(subject.name);
      hits.keywords.forEach((word) => connectionWords.add(word));
    }
  }
  const leads = [...projects];
  if (connectionHits > 0) {
    const first = [...connectionWords].toSorted()[0];
    leads.push({
      keyword: absentAsNull({ value: first }),
      rows: hexLeadWeight({ hits: connectionHits, kinds: new Set<HexHitKind>(["connection"]) }),
      source: HEX_LEAD_SOURCE,
      startShape: null,
      why:
        `the Hex atlas names data connection(s) ${connectionNames.toSorted().join(", ")} for ` +
        `${[...connectionWords]
          .toSorted()
          .map((word) => `"${word}"`)
          .join(", ")} — a warehouse, not a subject, ` +
        "so start by finding which project reads it",
    });
  }
  // Ties break on the project id so two runs of one gate order identically; the connection-wide lead carries
  // none and sorts last among ties rather than being coalesced to an empty name.
  return leads.toSorted((left, right) => {
    if (left.rows !== right.rows) {
      return right.rows - left.rows;
    }
    if (left.startShape === null || right.startShape === null) {
      return Number(left.startShape === null) - Number(right.startShape === null);
    }
    return left.startShape.localeCompare(right.startShape);
  });
}
