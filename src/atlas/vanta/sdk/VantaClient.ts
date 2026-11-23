/**
 * The Zod-validated, Result-returning SDK-style Vanta client. Composes each tag's operations
 * (`operations/*.ts`) into one flat, consumer-facing object.
 *
 * Meant to read like a real, independently-publishable TypeScript SDK a caller could `npm install` — the
 * same shape as a published provider SDK — with one repo-wide convention still enforced: every method
 * returns `Result<T, VantaSdkError>` rather than throwing, per `.claude/rules/error-handling.md`.
 *
 * Every method is strictly 1:1 with one Vanta endpoint. No method composes multiple HTTP calls — a method
 * that silently issues 2+ requests can fail on the second with the first already having taken effect
 * against a real compliance record. Cursor-paginated `list*` methods follow the same rule: each call
 * returns ONE page, never an auto-walked-all collection — walking pages is the caller's job.
 *
 * Every method reads its answer through that endpoint's strict `defineBoundary` (each tag's
 * `VANTA_*_OPERATION_BOUNDARIES`, in `operations/*Boundaries.ts`), so a field Vanta adds, drops, renames or retypes is refused by name rather than
 * dropped or misread (owner ruling: stay strict, update when upstream changes).
 */
import type { VantaTokenProvider } from "../oauth.js";
import type { VantaTransport } from "../transport.js";
import { createControlsOperations, type VantaControlsOperations } from "./operations/controls.js";
import { createDocumentsOperations, type VantaDocumentsOperations } from "./operations/documents.js";
import { createTestsOperations, type VantaTestsOperations } from "./operations/tests.js";
import { createVendorsOperations, type VantaVendorsOperations } from "./operations/vendors.js";

/** Every tag's operations, intersected — Vendors is the last of the four scoped tags. */
export type VantaClient = VantaControlsOperations &
  VantaDocumentsOperations &
  VantaTestsOperations &
  VantaVendorsOperations;

/**
 * Build the client.
 *
 * @param tokenProvider mints/reuses the bearer token for every request — the same provider `client.ts` and
 *   `writeClient.ts` use, since every Vanta client shares one Manage application and its
 *   one-token-per-app constraint
 * @param transport the bound Vanta transport
 * @returns the client
 */
export function createVantaClient({
  tokenProvider,
  transport,
}: {
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): VantaClient {
  return {
    ...createControlsOperations({ tokenProvider, transport }),
    ...createDocumentsOperations({ tokenProvider, transport }),
    ...createTestsOperations({ tokenProvider, transport }),
    ...createVendorsOperations({ tokenProvider, transport }),
  };
}
