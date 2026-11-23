/**
 * Whether a GraphQL document writes — the one question a write-transport guard asks of a request that travels
 * as an HTTP `POST` whether it reads or writes.
 *
 * GitHub's and Linear's GraphQL endpoints both take every operation as a `POST`, so the HTTP method cannot tell
 * a query from a mutation. The document can, and only a real parse reads it correctly. Three hand-rolled
 * scanners each fell to review: a leading-keyword test missed a mutation declared after a
 * `fragment`, a keyword-anywhere test judged a query aliasing a field as `mutation`, and a top-level
 * keyword test judged `query mutation(…)`, an operation legally NAMED `mutation`. So this module asks
 * the GraphQL reference implementation for each operation's own type, as `atlas/kit/graphqlDocument.ts` does.
 *
 * A document that does not parse is judged as a write: the server refuses it anyway, so judging it costs
 * nothing, while waving it through would let a malformed-but-accepted edge case skip the guard.
 */
import { Kind, parse } from "graphql";

/**
 * Whether a GraphQL document defines a mutation operation, or cannot be read well enough to say it does not.
 *
 * @param document the GraphQL document text
 * @returns true when any operation the document defines is a mutation, or the document does not parse
 */
export function isGraphqlMutation({ document }: { document: string }): boolean {
  try {
    return parse(document).definitions.some(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION && definition.operation === "mutation",
    );
  } catch {
    return true;
  }
}
