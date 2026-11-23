/**
 * The crawl's own id-to-name index, and the rehydration that turns `@linear/sdk`'s bare `{ id }` references
 * back into the objects this connector's projectors read.
 *
 * ## Why this exists at all
 *
 * Every generated fragment in the pinned bundle carries a relation as an id and nothing else — `creator
 * { id }`, `state { id }`, `project { id }`, `assignee { id }` — where the hand-written documents this
 * connector used to send selected `creator { id displayName }` and `state { name type }` in the same round
 * trip. Reading a NAME is not optional: a record's `attrs` are what `retrievalIndex.ts` indexes, and "who
 * wrote this" answered as a UUID answers nothing.
 *
 * Resolving each one at the provider would be a request per reference, which is the N+1 this connector
 * exists to avoid. So the ids are resolved LOCALLY instead, against the reference lanes the crawl already
 * pages to exhaustion — users, teams, projects, initiatives, labels, cycles, milestones, workflow states,
 * project statuses, customers. That costs no extra request for any lane the crawl already walks, and it is
 * the resolution `queries.ts` always argued for: *"the corpus already holds the users, cycles, projects,
 * teams and labels those ids point at, so a reader can resolve them locally for free."*
 *
 * ## Rehydration rather than a threaded index
 *
 * {@link hydrateNode} puts the resolved fields back ON the node, under the key they used to arrive under, so
 * every projector, every record shape and every test downstream of the seam is unchanged by the move. That
 * is deliberate: a change that rewrote thirty pure projectors to consult an index would be the same change
 * with thirty more places to get it wrong, and `raw` in bronze would stop matching what the projectors read.
 *
 * ## The one thing it cannot do, stated rather than discovered
 *
 * An id the index has never seen resolves to `{ id }` alone — the node keeps the reference, and the name is
 * simply absent. That is reachable in exactly one shape: a WINDOWED refresh whose issues point at an object
 * no reference lane covers and no earlier crawl stored, e.g. a relation to an issue outside the window. The
 * reference lanes are walked WHOLE rather than windowed precisely to keep that set small, and an absent name
 * is visibly absent rather than wrong.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * The kinds of object a reference can point at, and therefore the maps the index holds.
 *
 * One kind per Linear type rather than one per FIELD, because the same type is referenced under many names —
 * a user arrives as `creator`, `assignee`, `owner`, `lead`, `user` and `updatedBy` — and an index keyed by
 * field name would hold six copies of the same map.
 *
 * @internal — walked by this file's own index builder; every other module names a kind as a literal.
 */
export const LINEAR_REF_KINDS = [
  "user",
  "externalUser",
  "team",
  "project",
  "initiative",
  "issue",
  "issueLabel",
  "projectLabel",
  "cycle",
  "milestone",
  "workflowState",
  "projectStatus",
  "customer",
] as const;

/** @see LINEAR_REF_KINDS — the list is the declaration, so the kinds can be WALKED as well as named. */
export type LinearRefKind = (typeof LINEAR_REF_KINDS)[number];

/** One resolved reference: the fields a projector reads off it, always including its own `id`. */
export type LinearRef = Readonly<Record<string, unknown>>;

/** The whole index, as a READER sees it: one id-to-fields map per kind. */
export type LinearNameIndex = ReadonlyMap<LinearRefKind, ReadonlyMap<string, LinearRef>>;

/**
 * The same maps, as the one writer sees them.
 *
 * The index is a CACHE — `./referenceFill.ts` fills a miss on demand — so exactly one module needs to write to
 * it. Spelling the mutable view as its own type is what lets that module do so without a type assertion, and
 * what keeps every other caller on the readonly one.
 */
export type LinearNameCache = Map<LinearRefKind, Map<string, LinearRef>>;

/**
 * The fields each kind contributes, chosen to match exactly what the hand-written documents used to select.
 *
 * Nothing here is a guess: each list is the selection the replaced document carried, so a projector reading
 * `team.key` or `cycle.number` finds what it has always found. `identifier` is derived rather than selected
 * — see {@link issueRefsFrom}.
 */
const REF_FIELDS: Readonly<Record<LinearRefKind, readonly string[]>> = {
  customer: ["name"],
  cycle: ["number", "name"],
  externalUser: ["displayName", "name"],
  initiative: ["name"],
  issue: ["identifier"],
  issueLabel: ["name"],
  milestone: ["name"],
  project: ["name"],
  projectLabel: ["name"],
  projectStatus: ["name", "type"],
  team: ["key", "name"],
  user: ["displayName", "name"],
  workflowState: ["name", "type"],
};

/**
 * Fold one reference lane's raw nodes into an id-to-fields map. Pure.
 *
 * A node with no id is SKIPPED rather than fatal, the posture every parse in this connector takes. A field
 * the node does not carry is simply absent from the ref, so a caller sees "not known" rather than a default.
 *
 * @param kind which reference kind these nodes are
 * @param nodes the lane's raw nodes
 * @returns the map from id to the fields {@link REF_FIELDS} names for that kind
 */
export function refsFrom({
  kind,
  nodes,
}: {
  kind: LinearRefKind;
  nodes: readonly unknown[];
}): ReadonlyMap<string, LinearRef> {
  const fields = REF_FIELDS[kind];
  const refs = new Map<string, LinearRef>();
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const id = node["id"];
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    const ref: Record<string, unknown> = { id };
    for (const field of fields) {
      if (node[field] !== undefined && node[field] !== null) {
        ref[field] = node[field];
      }
    }
    refs.set(id, ref);
  }
  return refs;
}

/**
 * Fold an ISSUE lane's raw nodes into an id-to-`{ id, identifier }` map. Pure.
 *
 * Its own builder because `identifier` is the one reference field that is DERIVED rather than selected: the
 * SDK's `Issue` fragment carries `team { id }` and `number`, and an identifier is a team key and a number.
 * So an issue the crawl fetched contributes its own identifier directly when the fragment carries one, and
 * the team index supplies the key when it does not.
 *
 * @param nodes the issue nodes
 * @param teams the team index, for deriving an identifier the node did not carry; ABSENT when the crawl
 *   walked no team lane, in which case an issue without a selected identifier simply carries none
 * @returns the map from issue id to `{ id, identifier }`
 */
export function issueRefsFrom({
  nodes,
  teams,
}: {
  nodes: readonly unknown[];
  teams: ReadonlyMap<string, LinearRef> | undefined;
}): ReadonlyMap<string, LinearRef> {
  const refs = new Map<string, LinearRef>();
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const id = node["id"];
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    const identifier = identifierOf({ node, teams });
    refs.set(id, identifier === undefined ? { id } : { id, identifier });
  }
  return refs;
}

/** An issue node's identifier, selected if the document carried it and derived from `team`/`number` if not. */
function identifierOf({
  node,
  teams,
}: {
  node: Record<string, unknown>;
  teams: ReadonlyMap<string, LinearRef> | undefined;
}): string | undefined {
  const selected = node["identifier"];
  if (typeof selected === "string" && selected.length > 0) {
    return selected;
  }
  if (teams === undefined) {
    return undefined;
  }
  const teamId = isRecord(node["team"]) ? node["team"]["id"] : undefined;
  const key = typeof teamId === "string" ? teams.get(teamId)?.["key"] : undefined;
  const number = node["number"];
  return typeof key === "string" && typeof number === "number" ? `${key}-${String(number)}` : undefined;
}

/**
 * Which reference kind each nested field on a node points at.
 *
 * A per-lane map rather than one global one, because the same field name means different things on different
 * types: `issue.parent` is an ISSUE, `issueLabel.parent` is a LABEL, and resolving one against the other's
 * index would silently produce a name from the wrong object.
 */
export type LinearRefSpec = Readonly<Record<string, LinearRefKind>>;

/**
 * Put the index's fields back onto a node's bare `{ id }` references. Pure.
 *
 * SHALLOW by design: it rewrites the keys the spec names on the node it is given, and a caller hydrates a
 * nested connection's nodes by calling it on each of them with that connection's own spec. A key the node
 * does not carry is left alone; an id the index does not know keeps the reference it already had, so a
 * missing name is missing rather than wrong.
 *
 * @param node the raw node, of unvalidated shape
 * @param spec which kind each nested field points at
 * @param index the crawl's reference index
 * @returns the node with its named references resolved
 */
export function hydrateNode({
  node,
  spec,
  index,
}: {
  node: unknown;
  spec: LinearRefSpec;
  index: LinearNameIndex;
}): unknown {
  if (!isRecord(node)) {
    return node;
  }
  const out: Record<string, unknown> = { ...node };
  for (const [field, kind] of Object.entries(spec)) {
    const reference = out[field];
    if (!isRecord(reference)) {
      continue;
    }
    const id = reference["id"];
    const resolved = typeof id === "string" ? index.get(kind)?.get(id) : undefined;
    if (resolved !== undefined) {
      out[field] = { ...reference, ...resolved };
    }
  }
  return out;
}

/**
 * Resolve a LIST of ids into reference objects, dropping the ones the index does not know. Pure.
 *
 * The other half of the SDK's shape: where a connection used to arrive inline — an issue's `labels`, say —
 * the fragment now carries a scalar id list (`labelIds`) instead, and the connection is rebuilt from the
 * reference lane that already holds every one of them.
 *
 * @param ids the id list off the node, of unvalidated shape
 * @param kind which reference kind the ids point at
 * @param index the crawl's reference index
 * @returns one reference per id the index knows, in the order the ids arrived
 */
export function refsForIds({
  ids,
  kind,
  index,
}: {
  ids: unknown;
  kind: LinearRefKind;
  index: LinearNameIndex;
}): readonly LinearRef[] {
  if (!Array.isArray(ids)) {
    return [];
  }
  const map = index.get(kind);
  const refs: LinearRef[] = [];
  for (const id of ids) {
    const resolved = typeof id === "string" ? map?.get(id) : undefined;
    if (resolved !== undefined) {
      refs.push(resolved);
    }
  }
  return refs;
}

/**
 * An index built from the reference lanes a crawl has walked.
 *
 * The TEAM lane is folded first whatever order the caller wrote its object in, because the issue lane reads
 * it to derive an identifier the SDK's fragment does not carry. Relying on `Object.entries` order there is
 * exactly the kind of ordering hazard this comment exists to close — it was caught by this function's own
 * test, which passed `{ issue, team }` in that order and got an issue ref with no identifier.
 *
 * @param lanes the raw nodes of each reference lane, keyed by kind; a kind with no lane is simply absent
 * @returns the index, as the writable cache `./referenceFill.ts` fills on demand
 */
export function linearNameIndexFrom({
  lanes,
}: {
  lanes: Readonly<Partial<Record<LinearRefKind, readonly unknown[]>>>;
}): LinearNameCache {
  const index: LinearNameCache = new Map();
  const teamNodes = lanes["team"];
  if (teamNodes !== undefined) {
    index.set("team", new Map(refsFrom({ kind: "team", nodes: teamNodes })));
  }
  // Passed as-is, undefined and all: `issueRefsFrom` names the no-team-lane case itself and leaves an
  // identifier off rather than inventing one, so there is nothing to substitute here.
  const teams = index.get("team");
  // Walked over the DECLARED kinds rather than the caller's object keys, so the loop is typed without an
  // assertion and a kind the caller did not pass is simply absent.
  for (const refKind of LINEAR_REF_KINDS) {
    const nodes = lanes[refKind];
    if (nodes === undefined || refKind === "team") {
      continue;
    }
    const folded = refKind === "issue" ? issueRefsFrom({ nodes, teams }) : refsFrom({ kind: refKind, nodes });
    index.set(refKind, new Map(folded));
  }
  return index;
}
