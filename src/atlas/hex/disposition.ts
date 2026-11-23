/**
 * Whether an operation's records may be stored one row each, enumerated as a shape, or never fetched at all.
 *
 * ## Three dispositions, and the third is the whole reason this atlas exists in the shape it does
 *
 * `docs/atlas-intent/06-holdings.md` gives two: an atlas holds everything reachable, with the one bound that a
 * "highly voluminous" family is enumerated and declared rather than stored whole. The criterion that
 * decides between them, established by the Datadog atlas row:
 *
 * > A voluminous family's records are **time-series OBSERVATIONS** — emitted by the platform rather than
 * > created by a person, unbounded, growing with the clock, and identified by an INSTANT rather than by a
 * > name somebody chose. **Configuration is the complement**: what a person or a system CREATED, and what
 * > can be listed exhaustively.
 *
 * Hex adds a third, from the owner's rule that this platform is in scope: **this atlas
 * stores no customer data locally.** A Hex project is a notebook over the organisation's warehouse, so the
 * body on the other side of a handful of these operations is a RESULT SET — rows a query returned against
 * real sensitive and commercial data. Those are `withheld`.
 *
 * ## The criterion for `withheld`, stated so it decides an operation nobody has seen yet
 *
 * > An operation is withheld when its response **is, or renders, the result of executing something against
 * > a data connection** — a cell's computed output, an image of a chart drawn from one, or an agent
 * > conversation whose messages quote what a query returned. The complement is everything that describes
 * > what EXISTS and how it is configured: a project's title and owner, a collection's membership, a data
 * > connection's name, the tables a project queries.
 *
 * **Withheld is not excluded, and the difference is load-bearing.** A withheld operation is still mapped in
 * full: its method, its path, its parameters, its declared response field NAMES, the credential it needs
 * and the URL a reader opens. What never happens is a call for its body. An atlas that dropped these
 * operations would answer "Hex has no way to read a cell's output", which is false and is exactly the
 * silence `docs/atlas-intent/settled-decisions.md`'s gap-list property exists to refuse.
 *
 * ## Withheld is checked FIRST, because the two criteria overlap on a real path
 *
 * `GET /v1/projects/{projectId}/runs/{runId}/cells/{staticId}/image` is inside the runs family, which is
 * time-series observations, AND it renders a chart drawn from warehouse rows. Checking volume first would
 * grade it `shape-index`, which permits a shape read of a body this atlas must never fetch. The stricter
 * disposition wins, always.
 *
 * MEASURED against the published generation: 11 of the 113 method rows are withheld — 9 of the
 * document's 52 operations plus 2 of the client's 48 GraphQL ones — and 4 are shape-indexed, every one of
 * them in the project-run family. Reproduce both counts through the read path the bot uses:
 *
 * ```bash
 * slopweaver atlas hex read --kind method --query withheld --limit 1000 --json | jq '.page.matched'
 * slopweaver atlas hex read --kind method --limit 1000 --json \
 *   | jq '[.entities[] | select(.detail.disposition == "shape-index")] | length'
 * ```
 */

/**
 * What an observation of one operation may publish.
 *
 * @internal
 */
export const HEX_DISPOSITIONS = ["entity", "shape-index", "withheld"] as const;

/** Whether an operation's records may be stored one row each, only as a shape, or not at all. */
export type HexDisposition = (typeof HEX_DISPOSITIONS)[number];

/**
 * Path fragments whose response is, or renders, the result of executing something against a data connection.
 *
 * `/output` is a cell's computed result. `/image` is a chart drawn from one, which is the same data in a
 * form a redaction pass cannot even see into. `/v1/threads` is the agent conversation surface, and it is
 * here for a reason worth stating rather than assuming: an agent thread's messages quote the rows the agent
 * looked at, so a thread body carries warehouse data even though nothing in its path says so.
 *
 * @internal
 */
const WITHHELD_FRAGMENTS = ["/output", "/image", "/v1/threads", "/projects/export"] as const;

/**
 * Path fragments whose records are time-series observations.
 *
 * One family on this platform: a project RUN. Hex appends one per execution for the life of the project, so
 * the count is bounded by the clock rather than by anything a person maintains — the criterion, not the
 * noun. A project, a collection, a data connection and a group are all identified by a name somebody chose.
 *
 * @internal
 */
const OBSERVATION_FRAGMENTS = ["/runs"] as const;

/**
 * Why one operation is never called for its body, or `null` when it is not withheld.
 *
 * @param path the document's own path key, `{brace}` parameters intact
 * @returns the reason, in English, ready to store on the row
 */
export function hexWithholdingFor({ path }: { path: string }): string | null {
  if (!WITHHELD_FRAGMENTS.some((fragment) => path.includes(fragment))) {
    return null;
  }
  return (
    "this operation's response is, or renders, the result of executing something against a data connection " +
    "— a cell's computed output, a chart drawn from one, or an agent thread quoting what a query returned. " +
    "The owner's rule is that this atlas stores no customer data locally, so the operation " +
    "is mapped in full and never called for its body. Its parameters, its declared response field names, " +
    "the credential it needs and the URL to open are all here; the rows are not, and never will be"
  );
}

/**
 * Whether one operation's records may be stored individually, only as a shape, or not at all.
 *
 * @param path the document's own path key, `{brace}` parameters intact
 * @returns `withheld` for a result-bearing operation, `shape-index` for a time-series family, else `entity`
 */
export function hexDispositionFor({ path }: { path: string }): HexDisposition {
  if (hexWithholdingFor({ path }) !== null) {
    return "withheld";
  }
  if (OBSERVATION_FRAGMENTS.some((fragment) => path.includes(fragment))) {
    return "shape-index";
  }
  return "entity";
}

/**
 * GraphQL operation-name fragments whose response is, or renders, a computed result.
 *
 * The client's own GraphQL API has no paths to key on, so the criterion is applied to the operation NAME —
 * which is Hex's own identifier for it, not this repository's guess. `Output` is a cell's computed content;
 * `Preview` is a rendered sample of one. Everything else in the client's census describes SCHEMA (a table,
 * a column, a pinned dataset) or CONFIGURATION (an org, a connection, a workspace admin), and schema is not
 * a result set: a column's NAME is what a query could ask for, where its VALUES are what a query returned.
 *
 * @internal
 */
const WITHHELD_GRAPHQL_FRAGMENTS = ["Output", "Preview"] as const;

/**
 * Why one GraphQL operation is never called for its body, or `null` when it is not withheld.
 *
 * @param name the operation name the client's own bundle declares
 * @returns the reason, in English, ready to store on the row
 */
export function hexGraphqlWithholdingFor({ name }: { name: string }): string | null {
  if (!WITHHELD_GRAPHQL_FRAGMENTS.some((fragment) => name.includes(fragment))) {
    return null;
  }
  return (
    "this operation's name says it returns a computed result — a cell's output content or a preview of " +
    "one — which by the owner's rule is customer data this atlas never stores. The " +
    "operation is catalogued as callable and its body is never fetched or described"
  );
}

/**
 * Whether one GraphQL operation's response may be described at all.
 *
 * @param name the operation name the client's own bundle declares
 * @returns `withheld` for a result-bearing operation, else `entity`
 */
export function hexGraphqlDispositionFor({ name }: { name: string }): HexDisposition {
  return hexGraphqlWithholdingFor({ name }) === null ? "entity" : "withheld";
}
