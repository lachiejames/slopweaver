/**
 * The pure half of the Xero API surface: what one generated module's TEXT states about its operations.
 *
 * Written against a fixture rather than the installed package on purpose — the parser has to be provable
 * with no `node_modules` present, and a fixture is where a shape the real package does not currently have
 * (an unterminated literal, an operation with no summary) can be stated at all. `sdkRead.test.ts` is the
 * other half, and it reads the real thing.
 */
import { describe, expect, it } from "vitest";

import {
  parseXeroSdkModelFields,
  parseXeroSdkModule,
  xeroModuleBasePath,
} from "../../../../atlas/xero/sdkEndpoints.js";

/** A generated API class, written exactly as `xero-node` 19.1.0 generates one. */
const MODULE_SOURCE = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let defaultBasePath = 'https://api.xero.com/api.xro/2.0';
class AccountingApi {
    constructor(basePathOrUsername, password, basePath) {
        this._basePath = defaultBasePath;
    }
    setDefaultAuthentication(auth) {
        this.authentications.default = auth;
    }
    setApiKey(key, value) {
        this.authentications[AccountingApiApiKeys[key]].apiKey = value;
    }
    /**
     *
     * @summary Retrieves sales invoices or purchase bills
     * @param xeroTenantId Xero identifier for Tenant
     */
    getInvoices(xeroTenantId_1) {
        return __awaiter(this, arguments, void 0, function* (xeroTenantId, options = { headers: {} }) {
            const localVarPath = this.basePath + '/Invoices';
            let localVarQueryParameters = {};
            localVarQueryParameters['where'] = models_1.ObjectSerializer.serialize(where, "string");
            localVarQueryParameters['page'] = models_1.ObjectSerializer.serialize(page, "number");
            localVarHeaderParams['xero-tenant-id'] = models_1.ObjectSerializer.serialize(xeroTenantId, "string");
            localVarHeaderParams['Accept'] = acceptHeadersFromSpec.join();
            let localVarRequestOptions = {
                method: 'GET',
                url: localVarPath,
            };
            body = models_1.ObjectSerializer.deserialize(response.data, "Invoices");
        });
    }
    /**
     *
     * @summary Updates a specific sales invoice or purchase bill
     */
    updateInvoice(xeroTenantId_1, invoiceID_1) {
        return __awaiter(this, arguments, void 0, function* (xeroTenantId, invoiceID, options = { headers: {} }) {
            const localVarPath = this.basePath + '/Invoices/{InvoiceID}'
                .replace('{' + 'InvoiceID' + '}', encodeURIComponent(String(invoiceID)));
            let localVarRequestOptions = {
                method: 'POST',
                url: localVarPath,
                data: models_1.ObjectSerializer.serialize(invoices, "Invoices"),
            };
            body = models_1.ObjectSerializer.deserialize(response.data, "Invoices");
        });
    }
    undocumented(xeroTenantId_1) {
        return __awaiter(this, arguments, void 0, function* (xeroTenantId) {
            const localVarPath = this.basePath + '/Nothing';
            let localVarRequestOptions = {
                method: 'DELETE',
                url: localVarPath,
            };
        });
    }
}
`;

describe("xeroModuleBasePath", () => {
  it("reads the product root every operation in the module hangs off", () => {
    expect(xeroModuleBasePath({ source: MODULE_SOURCE })).toBe("https://api.xero.com/api.xro/2.0");
  });

  it("answers null for a module that declares none, rather than inventing a root", () => {
    expect(xeroModuleBasePath({ source: "class Empty {}" })).toBe(null);
  });
});

describe("parseXeroSdkModule", () => {
  const operations = parseXeroSdkModule({ module: "accountingApi", source: MODULE_SOURCE });

  it("finds every operation and drops the three class members that are not operations", () => {
    expect(operations.map((operation) => operation.name)).toEqual(["getInvoices", "updateInvoice", "undocumented"]);
  });

  it("reads the path a collection operation addresses", () => {
    expect(operations[0]!.path).toBe("/Invoices");
  });

  it("reads a path template with its parameters left as placeholders", () => {
    expect(operations[1]!.path).toBe("/Invoices/{InvoiceID}");
  });

  it("reads the path parameters a template substitutes", () => {
    expect(operations[1]!.pathParams).toEqual(["InvoiceID"]);
  });

  it("reads every query parameter the operation sets, sorted", () => {
    expect(operations[0]!.queryParams).toEqual(["page", "where"]);
  });

  it("reads every header parameter, including the tenant header that scopes every Xero call", () => {
    expect(operations[0]!.headerParams).toEqual(["Accept", "xero-tenant-id"]);
  });

  it("upper-cases the HTTP verb, so a channel spelling it differently still matches", () => {
    expect(operations.map((operation) => operation.httpMethod)).toEqual(["GET", "POST", "DELETE"]);
  });

  it("reads the model an operation serialises into its request body", () => {
    expect(operations[1]!.requestModel).toBe("Invoices");
  });

  it("answers null for an operation that sends no body", () => {
    expect(operations[0]!.requestModel).toBe(null);
  });

  it("reads the model an operation deserialises its response into", () => {
    expect(operations[0]!.responseModel).toBe("Invoices");
  });

  it("answers null for an operation that declares no response model", () => {
    expect(operations[2]!.responseModel).toBe(null);
  });

  it("reads the one-line summary above a declaration", () => {
    expect(operations[0]!.summary).toBe("Retrieves sales invoices or purchase bills");
  });

  it("does not attach a preceding operation's summary to one that carries none", () => {
    expect(operations[2]!.summary).toBe(null);
  });

  it("stamps every operation with the module it was declared in", () => {
    expect(operations.map((operation) => operation.module)).toEqual([
      "accountingApi",
      "accountingApi",
      "accountingApi",
    ]);
  });

  it("stamps every operation with its module's base path", () => {
    expect(operations[0]!.basePath).toBe("https://api.xero.com/api.xro/2.0");
  });

  it("yields nothing for a module with no base path, because a row that cannot say what it addresses is not one", () => {
    expect(parseXeroSdkModule({ module: "brokenApi", source: "class X { getThing() {} }" })).toEqual([]);
  });
});

describe("parseXeroSdkModelFields", () => {
  const source = `Account.attributeTypeMap = [
    { "name": "code", "baseName": "Code", "type": "string" },
    { "name": "accountID", "baseName": "AccountID", "type": "string" },
    { "name": "code", "baseName": "Code", "type": "string" }
];`;

  it("reads the WIRE spelling rather than the TypeScript property name", () => {
    expect(parseXeroSdkModelFields({ source })).toEqual(["Code", "AccountID"]);
  });

  it("answers an empty list for a module that declares no fields", () => {
    expect(parseXeroSdkModelFields({ source: "exports.CurrencyCode = void 0;" })).toEqual([]);
  });
});
