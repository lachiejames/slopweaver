/**
 * Which Hex operations this atlas may CALL, and why each refusal is a refusal.
 *
 * ## The criterion, not a list
 *
 * A `GET` observes. Nothing else does. `POST`, `PUT`, `PATCH` and `DELETE` all create, change or remove
 * something in this workspace, so each is inventoried and never called.
 *
 * A vendor with a naming CONVENTION for a read whose input does not fit a query string could have those POSTs
 * exempted. **Hex has no such convention and the POSTs are unambiguously
 * writes** — `CreateProject`, `RunProject`, `CreateCell`, `DeactivateUser`, `PublishGuideDrafts`. `RunProject`
 * is the sharpest of them: it EXECUTES a notebook against the warehouse, which spends compute, can write to
 * downstream systems through the project's own cells, and produces exactly the result set this atlas is
 * forbidden to hold. There is no reading of it that is observational.
 *
 * ## A refused operation still gets a row, and so does a withheld one
 *
 * Every operation the compiled evidence declares is published as a `method` entity, refused or not.
 * `exclusions.ts` decides whether this atlas may CALL an operation; `disposition.ts` decides what it may
 * STORE if it does. They are independent: `GET /v1/cells/{cellId}/output` is observational and withheld,
 * `POST /v1/projects` is neither. An atlas that omitted either class would answer that Hex cannot do
 * something it plainly can.
 */

/** Every HTTP method the compiled evidence declares. */
export const HEX_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One HTTP method, as the evidence spells it. */
export type HexMethod = (typeof HEX_METHODS)[number];

/**
 * Why one operation is never called, or `null` when it observes.
 *
 * @param method the HTTP method the evidence declares
 * @returns the refusal reason, in English, or `null` for an observational operation
 */
export function hexExclusionFor({ method }: { method: HexMethod }): string | null {
  if (method === "GET") {
    return null;
  }
  if (method === "POST") {
    return (
      "Hex uses POST to create and to EXECUTE — `RunProject` runs a notebook against the warehouse, which " +
      "spends compute and can write through the project's own cells. None of the POSTs here is a read " +
      "wearing a write's verb, so all are inventoried and never called"
    );
  }
  if (method === "DELETE") {
    return "removes a record from this workspace; an atlas that could call it could destroy the ground truth it maps";
  }
  return `${method} changes a record in this workspace — this atlas only ever reads`;
}

/**
 * Whether this atlas may call one operation.
 *
 * @param method the HTTP method the evidence declares
 * @returns `true` when the operation observes and may be called
 */
export function isHexObservational({ method }: { method: HexMethod }): boolean {
  return hexExclusionFor({ method }) === null;
}
