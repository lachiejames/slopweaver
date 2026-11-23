/**
 * Zod schemas for the Vanta Manage API's GROUP MEMBERSHIP write surface — the two bulk calls that move
 * people into and out of a group, the one body serializer both the client and the preview send, and the
 * per-person outcome each call answers with.
 *
 * ## Which document these shapes were read from, and which one is pinned
 *
 * `AddPeopleToGroup` and `RemovePeopleFromGroup`, read from the document Vanta serves at the
 * address `generated/specLock.ts` names — sha256 `e3dfe650277c574496a4e33f53302948dd8a4da3b7fa399b8b1bc618284d3ddd`,
 * 1,104,281 bytes. **That is NOT the pinned bytes**: `VANTA_SPEC_PIN` holds
 * `4f51bc9619c413b4443f2dbb6923ba4a3305910b326a52aa304f92564f6e62b9` at 1,057,873, so the served document
 * has moved since it was last reviewed. Re-pinning is a REVIEW of every operation and is deliberately not
 * done here. Reproduce both halves:
 *
 * ```bash
 * yarn tsx tools/generateVantaEndpoints.ts --verify          # the committed GET table, no network
 * yarn tsx tools/generateVantaEndpoints.ts --verify --fetch   # refuses on the moved digest, which is the point
 * ```
 *
 * ## What this surface does NOT hold, stated here so nobody goes looking again
 *
 * The reviewed Manage API contract has no operation assigning a policy or evidence document to a group.
 * `/policies` and `/policies/{policyId}` carry a `get` and nothing else, `PATCH /groups/{groupId}`
 * (`UpdateGroup`) takes `name`, `description` and `pointOfContactEmail` only, and no `/documents` route
 * mentions a group. So the group verb changes people's MEMBERSHIP and does not edit a group's
 * policy/document assignments. That is an absence in this API, and an absence is not evidence that some
 * other route exists — nothing here says where else such a change could be made.
 */
import { z } from "zod";

/**
 * Vanta's own cap on one `add-people`/`remove-people` call, declared as `maxItems` on both request bodies.
 * The verb refuses above it rather than letting the endpoint truncate a batch silently.
 */
export const VANTA_GROUP_MEMBERSHIP_BATCH_MAX = 100;

/**
 * One person's move, as both bulk endpoints take it — an id and nothing else.
 *
 * @internal
 */
export const vantaGroupMembershipUpdateSchema = z.object({ id: z.string().min(1) }).strict();

export type VantaGroupMembershipUpdate = z.infer<typeof vantaGroupMembershipUpdateSchema>;

/**
 * Per-person outcome, as a real two-armed union rather than one shape with an optional `message`.
 *
 * The document requires `message` on the failure arm (`NonSuccessResponse`) and forbids it on the success
 * arm (`SuccessResponse`), and that distinction is load-bearing: modelled as optional, a reader has to
 * invent a message for a failure that did not carry one, which is a fallback standing in for a contract.
 * Modelled as a union, a failure without a message fails the parse where it belongs — at the boundary.
 */
export const vantaGroupMembershipResultSchema = z.discriminatedUnion("status", [
  z.object({ id: z.string(), status: z.literal("SUCCESS") }).strict(),
  z.object({ id: z.string(), message: z.string(), status: z.literal("ERROR") }).strict(),
]);

export type VantaGroupMembershipResult = z.infer<typeof vantaGroupMembershipResultSchema>;

export const vantaGroupMembershipResponseSchema = z
  .object({ results: z.array(vantaGroupMembershipResultSchema) })
  .strict();

export type VantaGroupMembershipResponse = z.infer<typeof vantaGroupMembershipResponseSchema>;

/**
 * The exact request body both group legs send — ONE serializer, so the bytes `--dry-run` prints and the
 * bytes the client puts on the wire cannot come apart. `vulnerabilityApiSchemas.ts`'s
 * `vantaVulnerabilityBatchBody` is the same contract for the two vulnerability batch writes.
 *
 * @param updates the batch as it would be sent, in order
 * @returns the request body, byte for byte
 */
export function vantaGroupMembershipBody({ updates }: { updates: readonly VantaGroupMembershipUpdate[] }): string {
  return JSON.stringify({ updates });
}
