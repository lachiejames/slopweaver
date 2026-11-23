/**
 * derive — the free, deterministic silver synthesis. Pure orchestration over the corpus: build the
 * directory, the cross-ref graph, and the opportunities, then rewrite opaque handles in opportunity
 * subjects/summaries via the identity map (a pass-through when the map is empty). A full re-scan each
 * run — cheap and deterministic, so there's no diffing. The verb handles reading the corpus and writing
 * the JSON artifacts.
 */

import type { CuratedEdge } from "../corpus/curated/types.js";
import type { MemberBronzeRow } from "../corpus/members/types.js";
import type { StructureBronzeRow } from "../corpus/structures/types.js";
import type { CorpusRecord } from "../corpus/types.js";
import { accountKindIndex, accountKindIndexAll, type KindedPerson, withAccountKinds } from "./accountKind.js";
import { type AttributionCoverage, describeAttribution, measureAttribution } from "./attribution.js";
import { buildCuratedGraph } from "./curatedGraph.js";
import { buildDirectory, type DirectoryEntry } from "./directory.js";
import { buildCrossRefGraph, type GraphEdge } from "./graph.js";
import { type IdentityMap, type IdentityResolution, resolveHandle } from "./identity.js";
import type { Opportunity, OpportunityDrops } from "./opportunity.js";
import { scanOpportunities } from "./opportunityScan.js";
import { buildStructures, type StructureArtifacts } from "./structures.js";

/** The empty resolution — the default, so a caller that doesn't resolve identities gets raw per-source ids. */
const EMPTY_RESOLUTION: IdentityResolution = { candidates: [], conflicts: [], index: new Map(), people: [] };

export interface SilverArtifacts {
  readonly directory: {
    readonly people: readonly DirectoryEntry[];
    readonly containers: readonly DirectoryEntry[];
    /** How many accounts were dropped from `people` as a bot/integration (PR4.8) — never silently. */
    readonly excludedPeople: number;
  };
  readonly graph: { readonly nodes: readonly string[]; readonly edges: readonly GraphEdge[] };
  readonly opportunities: readonly Opportunity[];
  /** Which noisy opportunity candidates the precision pass rejected, and why (PR4.8). */
  readonly opportunityDrops: OpportunityDrops;
  /** The resolved people labelled `person | bot | integration` (PR4.8) — the shape persisted to silver. */
  readonly kindedPeople: readonly KindedPerson[];
  /** The cross-source identity resolution the directory was merged with (empty when none supplied). */
  readonly identities: IdentityResolution;
  /**
   * How much of the corpus reaches a canonical person, and the named residual for the rest. Measured every
   * derive rather than quoted, because this is the number the whole identity lane exists to move.
   */
  readonly attribution: AttributionCoverage;
  /** The org-graph surface (orgs/teams/repos/channels/states/cycles + relations), empty when no structure. */
  readonly structures: StructureArtifacts;
  /**
   * The curated relation graph (PR4.3): explicit DECLARED edges (Notion relations/mentions, Linear
   * sub-issues/relations, GitHub Projects/milestones/CODEOWNERS) lifted from record attrs. Separate from
   * the token clique graph, so it never touches (or re-blows) the PR3.5-bounded cross-ref graph. `capped`
   * counts edges dropped by the per-record runaway guard.
   */
  readonly curated: {
    readonly nodes: readonly string[];
    readonly edges: readonly CuratedEdge[];
    readonly capped: number;
  };
}

/** Rewrite an opportunity's subject to a resolved handle, and reflect that in its summary. */
function rewriteSubject({
  opportunity,
  identityMap,
}: {
  opportunity: Opportunity;
  identityMap: IdentityMap;
}): Opportunity {
  const resolved = resolveHandle({ map: identityMap, raw: opportunity.subject });
  if (resolved === opportunity.subject) {
    return opportunity;
  }
  return { ...opportunity, subject: resolved, summary: opportunity.summary.split(opportunity.subject).join(resolved) };
}

/**
 * Derive the silver artifacts from the corpus.
 *
 * @param records the bronze corpus records
 * @param identityMap resolves opaque handles in opportunity subjects (empty ⇒ pass-through)
 * @param resolution the cross-source identity resolution to merge the directory with (defaults to empty)
 * @param structureRows the structure-bronze rows to surface as the org graph (defaults to none)
 * @param memberRows the hydrated member rows that classify bot/integration accounts (defaults to none ⇒
 *   nothing is filtered from the people directory)
 * @returns the directory, graph, opportunities (+ drops), kinded people, identity resolution, attribution
 *   coverage, and org structure
 */
export function deriveSilver({
  records,
  identityMap,
  resolution = EMPTY_RESOLUTION,
  structureRows = [],
  memberRows = [],
}: {
  records: readonly CorpusRecord[];
  identityMap: IdentityMap;
  resolution?: IdentityResolution;
  structureRows?: readonly StructureBronzeRow[];
  memberRows?: readonly MemberBronzeRow[];
}): SilverArtifacts {
  const accountKinds = accountKindIndex({ rows: memberRows });
  // The unfiltered index as well, because attribution's actor question needs the `person` entries the
  // directory filter encodes as absence: without them every real teammate reads as an account nothing can
  // place, which is the opposite of what the residual is trying to say.
  const allAccountKinds = accountKindIndexAll({ rows: memberRows });
  const directory = buildDirectory({ accountKinds, records, resolution });
  const graph = buildCrossRefGraph({ records });
  const scan = scanOpportunities({ edges: graph.edges, records });
  return {
    attribution: measureAttribution({ accounts: allAccountKinds, memberRows, records, resolution }),
    curated: buildCuratedGraph({ records }),
    directory,
    graph,
    identities: resolution,
    kindedPeople: withAccountKinds({ index: accountKinds, people: resolution.people }),
    opportunities: scan.opportunities.map((opportunity) => rewriteSubject({ identityMap, opportunity })),
    opportunityDrops: scan.drops,
    structures: buildStructures({ resolution, rows: structureRows }),
  };
}

/**
 * The one-line "what the precision pass rejected" clause — every drop class, so a tightened detector is
 * never a silent truncation. Pure.
 *
 * @param drops the opportunity drop tally
 * @returns the human clause
 */
function describeOpportunityDrops({ drops }: { drops: OpportunityDrops }): string {
  return [
    `${String(drops.mentionOnly)} mention-only`,
    `${String(drops.genericToken)} generic`,
    `${String(drops.nonEntityToken)} non-entity`,
    `${String(drops.untitledTarget)} untitled`,
    `${String(drops.shortTitle)} short-title`,
    `${String(drops.duplicateSubject)} duplicate-subject`,
    `${String(drops.cappedEvidence)} evidence-capped`,
  ].join(", ");
}

/**
 * A human summary of a derive run.
 *
 * @param artifacts the derived silver artifacts
 * @param top how many top opportunities to list
 * @returns the summary lines
 */
export function planDeriveSummary({ artifacts, top }: { artifacts: SilverArtifacts; top: number }): readonly string[] {
  const { directory, graph, opportunities, identities, structures, curated } = artifacts;
  // Measured over COLLEAGUES, not over everyone the sources know about. Nearly all the single-source Linear
  // people are external contacts — customers who exist in one system because that is the truth about them —
  // so counting them here made a correct classification read as a coverage failure and sent readers hunting
  // a linking bug that does not exist. Both populations are reported below; neither is hidden.
  const externalIds = new Set(
    artifacts.kindedPeople.filter((person) => person.kind === "external").map((person) => person.id),
  );
  const colleagues = identities.people.filter((person) => !externalIds.has(person.id));
  const linked = colleagues.filter((person) => person.confidence !== "single-source").length;
  const struct = structures.directory;
  const cappedNote = curated.capped > 0 ? ` (${String(curated.capped)} capped)` : "";
  const bots = artifacts.kindedPeople.filter((person) => person.kind === "bot").length;
  const integrations = artifacts.kindedPeople.filter((person) => person.kind === "integration").length;
  // Named on the structures line rather than left to inference: a channel with no member edges because
  // nobody asked looks exactly like one nobody belongs to, and a derive that prints the second while meaning
  // the first is the silent-loss shape this repo refuses.
  const unresolvedNote =
    structures.membershipUnresolved > 0
      ? ` — ${String(structures.membershipUnresolved)} channel(s) have UNRESOLVED membership (never asked, not empty)`
      : "";
  const lines = [
    `directory: ${String(directory.people.length)} people, ${String(directory.containers.length)} containers (${String(directory.excludedPeople)} bot/integration excluded)`,
    `graph: ${String(graph.nodes.length)} nodes, ${String(graph.edges.length)} edges`,
    `opportunities: ${String(opportunities.length)} (${describeOpportunityDrops({ drops: artifacts.opportunityDrops })})`,
    `accounts: ${String(bots)} bot(s), ${String(integrations)} integration(s) among the resolved people (kept in the corpus, not counted as team members)`,
    `identities: ${String(colleagues.length)} workspace member(s) (${String(linked)} cross-source linked, ${String(identities.candidates.length)} held, ${String(identities.conflicts.length)} conflicts)`,
    `external contacts: ${String(externalIds.size)} (customers and contacts a source knows about — single-source by nature, never linked)`,
    `structures: ${String(struct.orgs.length)} orgs, ${String(struct.teams.length)} teams, ${String(struct.repos.length)} repos, ${String(struct.channels.length)} channels, ${String(struct.workflowStates.length)} states, ${String(struct.cycles.length)} cycles (${String(structures.graph.edges.length)} edges)${unresolvedNote}`,
    `curated: ${String(curated.nodes.length)} nodes, ${String(curated.edges.length)} edges${cappedNote}`,
    ...describeAttribution({ coverage: artifacts.attribution }),
  ];
  for (const opportunity of opportunities.slice(0, top)) {
    lines.push(`  [${opportunity.kind}] ${opportunity.summary} (score ${String(opportunity.score)})`);
  }
  return lines;
}
