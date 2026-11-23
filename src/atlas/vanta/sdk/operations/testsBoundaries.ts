/**
 * The Tests tag's endpoint contracts: one strict boundary per endpoint that answers JSON, declared once at
 * load and read by `tests.ts`'s operations. Kept apart from the request plumbing so a schema drift is fixed
 * in one small file that names every route it covers.
 */
import { defineBoundary } from "#lib/boundary.js";
import { vantaControlTestDtoSchema, vantaTestsPageSchema } from "../schemas/tests.js";

/**
 * One strict boundary per Tests endpoint that answers JSON, named by its method and path template. A field
 * Vanta adds, drops or renames refuses that read by name; the fix is this map's schema, never a looser read.
 *
 * @internal — exported so a test can lock the endpoint each operation names.
 */
export const VANTA_TESTS_OPERATION_BOUNDARIES = {
  getTest: defineBoundary({ endpoint: "GET /v1/tests/{testId}", schema: vantaControlTestDtoSchema }),
  listTests: defineBoundary({ endpoint: "GET /v1/tests", schema: vantaTestsPageSchema }),
} as const;
