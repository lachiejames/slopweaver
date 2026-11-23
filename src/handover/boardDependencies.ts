/*
 * The second pass: `blockedBy` edges, resolved only for a row whose own evidence reached
 * `"dependency-pending"`.
 *
 * It is a second pass rather than a deeper first one because a doc's own evidence never depends on its own
 * prerequisites — see `boardState.ts`'s header. So this module asks one question of the docs around it,
 * "did that other row's own evidence reach DONE", and never re-enters the rule family to find out.
 *
 * {@link dependencyClosures} is exported for the same reason it is cycle-safe: callers outside the board
 * walk the same chain to report a stuck prerequisite, and a second walk written elsewhere would be free to
 * disagree with this one about ordering or about revisiting a slug.
 */

import { type BoardModel, type DependencyClosure, type OwnEvidence, type RunDisposition } from "./boardTypes.js";
import { type Consistency } from "./consistency.js";
import { type DerivedRowState } from "./derivedRowState.js";
import { type DocProbeState, type HandoverDoc } from "./doc.js";
import { registeredAskOf } from "./registeredAsk.js";

/**
 * Every direct/transitive `blockedBy` closure this doc reaches, cycle-safe, in deterministic slug order.
 *
 * @param doc the doc whose dependency chain is being walked
 * @param all every doc `blockedBy` slugs may resolve against, keyed by slug
 * @returns every terminal-not-shipped prerequisite reached, direct or transitive
 */
export function dependencyClosures({
  doc,
  all,
}: {
  doc: HandoverDoc;
  all: ReadonlyMap<string, HandoverDoc>;
}): readonly DependencyClosure[] {
  const closures: DependencyClosure[] = [];
  const seenLeaves = new Set<string>();
  const visited = new Set<string>([doc.slug]);
  const walk = ({ slug, via }: { slug: string; via: readonly string[] }): void => {
    const dependency = all.get(slug);
    if (dependency === undefined || visited.has(slug)) {
      return;
    }
    visited.add(slug);
    if (dependency.status === "cancelled" || dependency.status === "rejected") {
      if (!seenLeaves.has(slug)) {
        seenLeaves.add(slug);
        closures.push({
          leaf: slug,
          reason: dependency.statusSummary,
          status: dependency.status,
          via: [...via, slug],
        });
      }
      return;
    }
    for (const next of dependency.blockedBy) {
      walk({ slug: next, via: [...via, slug] });
    }
  };
  for (const slug of doc.blockedBy) {
    walk({ slug, via: [doc.slug] });
  }
  return closures;
}

/** One root's evidence, computed independently of every other root — see the module header for why this is safe. */
export interface IntrinsicModel {
  readonly doc: HandoverDoc;
  readonly derived: DerivedRowState;
  readonly probe: DocProbeState | undefined;
  readonly run: RunDisposition;
  readonly movedIso: string | undefined;
  readonly consistency: Consistency;
  readonly evidence: OwnEvidence;
  readonly tags: BoardModel["tags"];
  readonly tagsIncomplete: boolean;
}

/** Every `blockedBy` slug this doc names that is neither on the board nor yet confirmed `DONE`. */
function unfinishedDependencies({
  doc,
  resolutionBySlug,
  doneSlugs,
  closures,
}: {
  doc: HandoverDoc;
  resolutionBySlug: ReadonlyMap<string, HandoverDoc>;
  doneSlugs: ReadonlySet<string>;
  closures: readonly DependencyClosure[];
}): { readonly missing: readonly string[]; readonly unfinished: readonly string[] } {
  const unique = [...new Set(doc.blockedBy)];
  return {
    missing: unique.filter((slug) => !resolutionBySlug.has(slug)),
    unfinished: unique.filter(
      (slug) =>
        resolutionBySlug.has(slug) && !doneSlugs.has(slug) && closures.every((closure) => closure.leaf !== slug),
    ),
  };
}

/** The exact reason text for a doc blocked by a terminal closure, a missing slug, or an unfinished dependency. */
function blockedReason({
  closures,
  missing,
  unfinished,
}: {
  closures: readonly DependencyClosure[];
  missing: readonly string[];
  unfinished: readonly string[];
}): string {
  if (closures.length > 0) {
    return `blocked by ${closures.map((closure) => `${closure.leaf} (${closure.status})`).join(", ")}`;
  }
  return missing.length > 0
    ? `blockedBy names ${missing.join(", ")}, which no doc on the board claims`
    : `waiting on ${unfinished.join(", ")}`;
}

/**
 * Resolve the `blockedBy`-sensitive rules (10 through 12) for a doc whose own evidence reached that point.
 *
 * @param intrinsic the doc's own-evidence pass, carrying everything the second pass must not recompute
 * @param resolutionBySlug every doc a `blockedBy` slug may resolve against, roots and archived alike
 * @param doneSlugs the slugs whose own evidence already reached `DONE`
 * @returns the finished model, in `RUN NOW`, `WAITING ON OWNER`, `IN FLIGHT`, `CONTRADICTION` or `NOT YET`
 */
export function resolveDependencyPending({
  intrinsic,
  resolutionBySlug,
  doneSlugs,
}: {
  intrinsic: IntrinsicModel;
  resolutionBySlug: ReadonlyMap<string, HandoverDoc>;
  doneSlugs: ReadonlySet<string>;
}): BoardModel {
  const { doc, derived, probe, run, movedIso, consistency, evidence, tags, tagsIncomplete } = intrinsic;
  const closures = dependencyClosures({ all: resolutionBySlug, doc });
  const { missing, unfinished } = unfinishedDependencies({ closures, doc, doneSlugs, resolutionBySlug });
  const blocked = closures.length > 0 || missing.length > 0 || unfinished.length > 0;

  // Every field but the verdict is the doc's own; only the section and its reason depend on the dependencies.
  const own = {
    consistency,
    dependencyClosures: closures,
    derived,
    doc,
    movedIso,
    probe,
    run,
    satisfiesDependency: false,
    tags,
    tagsIncomplete,
  };
  if (!blocked) {
    // A registered ask carrying its whole shape is the owner's decision, not a seat's work — `./registeredAsk.ts`. Placed
    // HERE rather than among the own-evidence rules so an unfinished `blockedBy` still reads NOT YET.
    const registered = registeredAskOf({ derived, doc, run });
    if (registered !== undefined) {
      return { ...own, reason: `waiting on the owner: ${registered.question}`, section: "WAITING ON OWNER" };
    }
    return { ...own, reason: evidence.reason, section: derived.status === "ready" ? "RUN NOW" : "IN FLIGHT" };
  }
  if (run.kind === "active" || run.kind === "waiting-on-owner") {
    return { ...own, reason: "a run is open while a dependency is unresolved", section: "CONTRADICTION" };
  }
  return { ...own, reason: blockedReason({ closures, missing, unfinished }), section: "NOT YET" };
}
