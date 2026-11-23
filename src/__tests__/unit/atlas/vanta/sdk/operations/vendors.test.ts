import { describe, expect, it } from "vitest";

import type { VantaTokenProvider } from "../../../../../../atlas/vanta/oauth.js";
import { createVendorsOperations } from "../../../../../../atlas/vanta/sdk/operations/vendors.js";
import type { VantaTransport } from "../../../../../../atlas/vanta/transport.js";
import { ok, unwrap } from "../../../../../../lib/result.js";

const tokenProvider: VantaTokenProvider = { getToken: async () => ok("tok") };

const vendorDto = {
  accountManagerEmail: null,
  accountManagerName: null,
  additionalNotes: null,
  authDetails: {
    method: null,
    passwordMFA: null,
    passwordMinimumLength: null,
    passwordRequiresNumber: null,
    passwordRequiresSymbol: null,
  },
  businessOwnerUserId: null,
  category: null,
  contractAmount: null,
  contractRenewalDate: null,
  contractStartDate: null,
  contractTerminationDate: null,
  customFields: null,
  id: "v1",
  inherentRiskLevel: "LOW",
  isRiskAutoScored: null,
  isVisibleToAuditors: null,
  lastSecurityReviewCompletionDate: null,
  latestDecision: null,
  linkedTaskTrackerTaskProcurementRequest: null,
  name: "n",
  nextSecurityReviewDueDate: null,
  residualRiskLevel: "LOW",
  riskAttributeIds: [],
  securityOwnerUserId: null,
  servicesProvided: null,
  status: "MANAGED",
  vendorHeadquarters: null,
  websiteUrl: null,
};

describe("createVendorsOperations", () => {
  it("createVendor posts the request body as JSON", async () => {
    let sentBody = "";
    const transport: VantaTransport = {
      request: async (init) => {
        sentBody = typeof init.body === "string" ? init.body : "";
        return ok({ body: JSON.stringify(vendorDto), headers: {}, status: 200 });
      },
    };
    const operations = createVendorsOperations({ tokenProvider, transport });
    const result = await operations.createVendor({ name: "n" });
    expect(unwrap(result).id).toBe("v1");
    expect(JSON.parse(sentBody)).toEqual({ name: "n" });
  });

  it("setStatusForVendor sends multipart/form-data, the one endpoint that isn't JSON", async () => {
    let sawBody: FormData | string | undefined;
    const transport: VantaTransport = {
      request: async (init) => {
        sawBody = init.body;
        return ok({ body: JSON.stringify(vendorDto), headers: {}, status: 200 });
      },
    };
    const operations = createVendorsOperations({ tokenProvider, transport });
    await operations.setStatusForVendor({ status: "ARCHIVED", vendorId: "v1" });
    expect(sawBody).toBeInstanceOf(FormData);
  });

  it("listAssessmentsForVendor repeats a query key per array entry", async () => {
    let seenPath = "";
    const transport: VantaTransport = {
      request: async (init) => {
        seenPath = init.path;
        return ok({
          body: JSON.stringify({
            results: {
              data: [],
              pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
            },
          }),
          headers: {},
          status: 200,
        });
      },
    };
    const operations = createVendorsOperations({ tokenProvider, transport });
    await operations.listAssessmentsForVendor({ statusMatchesAny: ["NOT_STARTED", "COMPLETED"], vendorId: "v1" });
    expect(seenPath).toBe("/v1/vendors/v1/assessments?statusMatchesAny=NOT_STARTED&statusMatchesAny=COMPLETED");
  });

  it("deleteVendor issues a DELETE with no body expected back", async () => {
    const transport: VantaTransport = { request: async () => ok({ body: "", headers: {}, status: 200 }) };
    const operations = createVendorsOperations({ tokenProvider, transport });
    expect(unwrap(await operations.deleteVendor({ vendorId: "v1" }))).toBeNull();
  });
});
