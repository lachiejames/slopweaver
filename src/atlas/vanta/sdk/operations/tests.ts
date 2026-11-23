/**
 * The Tests tag's four methods. Endpoint shapes are built from Vanta's own OpenAPI spec, and every method
 * that reads JSON back reads it through its endpoint's strict boundary in
 * {@link VANTA_TESTS_OPERATION_BOUNDARIES} (`testsBoundaries.ts`), declared once at load.
 */
import type { Result } from "../../../../lib/result.js";
import type { VantaTokenProvider } from "../../oauth.js";
import type { VantaTransport } from "../../transport.js";
import type { VantaSdkError } from "../errors.js";
import { requestJson, requestNoContent } from "../httpBoundary.js";
import type {
  VantaControlTestDto,
  VantaDeactivateTestEntityInput,
  VantaListTestsInput,
  VantaTestsPage,
} from "../schemas/tests.js";
import { VANTA_TESTS_OPERATION_BOUNDARIES } from "./testsBoundaries.js";

type Bound = { tokenProvider: VantaTokenProvider; transport: VantaTransport };

function testsPath(): string {
  return "/v1/tests";
}

function testPath({ testId }: { testId: string }): string {
  return `/v1/tests/${encodeURIComponent(testId)}`;
}

function testEntityDeactivatePath({ testId, entityId }: { testId: string; entityId: string }): string {
  return `/v1/tests/${encodeURIComponent(testId)}/entities/${encodeURIComponent(entityId)}/deactivate`;
}

function testEntityReactivatePath({ testId, entityId }: { testId: string; entityId: string }): string {
  return `/v1/tests/${encodeURIComponent(testId)}/entities/${encodeURIComponent(entityId)}/reactivate`;
}

/** Build `GET /v1/tests`'s query string, omitting any filter left undefined. */
function withTestsQuery({ path, input }: { path: string; input: VantaListTestsInput }): string {
  const params = new URLSearchParams();
  const entries: readonly (readonly [string, string | number | boolean | undefined])[] = [
    ["pageSize", input.pageSize],
    ["pageCursor", input.pageCursor],
    ["statusFilter", input.statusFilter],
    ["frameworkFilter", input.frameworkFilter],
    ["integrationFilter", input.integrationFilter],
    ["controlFilter", input.controlFilter],
    ["ownerFilter", input.ownerFilter],
    ["categoryFilter", input.categoryFilter],
    ["isInRollout", input.isInRollout],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}

const JSON_HEADERS = { "content-type": "application/json" };

export interface VantaTestsOperations {
  /** `GET /v1/tests` — list tests, filterable by status/framework/integration/control/owner/category. */
  listTests: (input: VantaListTestsInput) => Promise<Result<VantaTestsPage, VantaSdkError>>;
  /** `GET /v1/tests/{testId}` — a single test by ID. */
  getTest: (input: { testId: string }) => Promise<Result<VantaControlTestDto, VantaSdkError>>;
  /** `POST /v1/tests/{testId}/entities/{entityId}/deactivate` — deactivate one test entity. */
  deactivateTestEntity: (
    input: { testId: string; entityId: string } & VantaDeactivateTestEntityInput,
  ) => Promise<Result<null, VantaSdkError>>;
  /** `POST /v1/tests/{testId}/entities/{entityId}/reactivate` — reactivate one test entity. */
  reactivateTestEntity: (input: { testId: string; entityId: string }) => Promise<Result<null, VantaSdkError>>;
}

async function listTests(input: VantaListTestsInput & Bound): Promise<Result<VantaTestsPage, VantaSdkError>> {
  const { tokenProvider, transport, ...filters } = input;
  return requestJson({
    boundary: VANTA_TESTS_OPERATION_BOUNDARIES.listTests,
    method: "GET",
    operationId: "ListTests",
    path: withTestsQuery({ input: filters, path: testsPath() }),
    tokenProvider,
    transport,
  });
}

async function getTest({
  testId,
  tokenProvider,
  transport,
}: { testId: string } & Bound): Promise<Result<VantaControlTestDto, VantaSdkError>> {
  return requestJson({
    boundary: VANTA_TESTS_OPERATION_BOUNDARIES.getTest,
    method: "GET",
    operationId: "GetTest",
    path: testPath({ testId }),
    tokenProvider,
    transport,
  });
}

async function deactivateTestEntity({
  testId,
  entityId,
  tokenProvider,
  transport,
  ...body
}: { testId: string; entityId: string } & VantaDeactivateTestEntityInput & Bound): Promise<
  Result<null, VantaSdkError>
> {
  return requestNoContent({
    body: JSON.stringify(body),
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "DeactivateTestEntity",
    path: testEntityDeactivatePath({ entityId, testId }),
    tokenProvider,
    transport,
  });
}

async function reactivateTestEntity({
  testId,
  entityId,
  tokenProvider,
  transport,
}: { testId: string; entityId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "POST",
    operationId: "ReactivateTestEntity",
    path: testEntityReactivatePath({ entityId, testId }),
    tokenProvider,
    transport,
  });
}

/**
 * Build the Tests tag's operations.
 *
 * @param tokenProvider mints/reuses the bearer token for every request
 * @param transport the bound Vanta transport
 * @returns the operations, spread into `VantaClient`
 */
export function createTestsOperations({ tokenProvider, transport }: Bound): VantaTestsOperations {
  return {
    deactivateTestEntity: (input) => deactivateTestEntity({ ...input, tokenProvider, transport }),
    getTest: (input) => getTest({ ...input, tokenProvider, transport }),
    listTests: (input) => listTests({ ...input, tokenProvider, transport }),
    reactivateTestEntity: (input) => reactivateTestEntity({ ...input, tokenProvider, transport }),
  };
}
