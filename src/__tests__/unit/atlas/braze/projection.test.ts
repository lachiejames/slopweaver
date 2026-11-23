import { describe, expect, it } from "vitest";

import type { BrazeCollectionOperationRow } from "../../../../atlas/braze/collection.js";
import type { BrazeDocsOperationRow } from "../../../../atlas/braze/docsCatalogue.js";
import { brazeEntityId } from "../../../../atlas/braze/identity.js";
import type {
  BrazeAtlasEntity,
  BrazeOperationCollectionDetail,
  BrazeOperationDocsDetail,
} from "../../../../atlas/braze/model.js";
import {
  brazeCollectionUrl,
  projectBrazeCollectionOperation,
  projectBrazeDocsOperation,
} from "../../../../atlas/braze/projection.js";

const AT = "2026-10-01T00:00:00.000Z";
const NOT_AT = "2026-05-05T05:05:05.000Z";

/** A docs row whose every field carries a value no other field shares, including fields the projection must drop. */
const DOCS_ROW: BrazeDocsOperationRow = {
  disposition: "voluminous",
  dispositionReason: "reason-docs-voluminous",
  dispositionRuleId: "rule-docs-id",
  kind: "email",
  lastModified: NOT_AT,
  method: "PATCH",
  parameters: [
    { name: "param-first", required: true, type: "string" },
    { name: "param-second", required: false, type: null },
  ],
  pathDefect: "defect-docs-sentinel",
  pathShape: "/docs-path/{doc-id}",
  providerId: "PATCH /docs-provider-id",
  rateLimit: "rate-limit-docs-sentinel",
  responseFields: ["response-field-a", "response-field-b"],
  title: "Docs Title Sentinel",
  url: "https://www.braze.com/docs/api/endpoints/email/patch_docs_sentinel",
};

/** A collection row whose every field carries a value no other field shares. */
const COLLECTION_ROW: BrazeCollectionOperationRow = {
  disposition: "excluded",
  dispositionReason: "reason-collection-excluded",
  dispositionRuleId: "rule-collection-id",
  folders: ["Folder Outer", "Folder Inner"],
  headers: ["Header-First", "Header-Second"],
  method: "PUT",
  name: "Collection Request Name",
  pathDefect: "defect-collection-sentinel",
  pathShape: "/collection-path/{coll-id}",
  providerId: "PUT /collection-provider-id",
  queryParams: ["query-first", "query-second"],
  requestBodyFields: ["body-field-first", "body-field-second", "body-field-third"],
};

describe("projectBrazeDocsOperation", () => {
  it("projects the whole docs row into an entity carrying only the docs channel", () => {
    const expected: BrazeAtlasEntity = {
      channels: {
        api: null,
        browser: null,
        collection: null,
        docs: {
          channel: "docs",
          detail: {
            disposition: "voluminous",
            dispositionReason: "reason-docs-voluminous",
            dispositionRuleId: "rule-docs-id",
            method: "PATCH",
            parameters: [
              { name: "param-first", required: true, type: "string" },
              { name: "param-second", required: false, type: null },
            ],
            pathShape: "/docs-path/{doc-id}",
            rateLimit: "rate-limit-docs-sentinel",
            responseFields: ["response-field-a", "response-field-b"],
            title: "Docs Title Sentinel",
          },
          firstSeenAt: AT,
          lastSeenAt: AT,
          source: {
            artifacts: [],
            channel: "docs",
            deepLink: "https://www.braze.com/docs/api/endpoints/email/patch_docs_sentinel",
            deepLinkStatus: "provider-provided",
            endpoint: "PATCH /docs-path/{doc-id}",
            observedAt: AT,
          },
          state: "observed",
        },
      },
      id: brazeEntityId({ kind: "email", providerId: "PATCH /docs-provider-id" }),
      kind: "email",
      providerId: "PATCH /docs-provider-id",
    };
    expect(projectBrazeDocsOperation({ at: AT, row: DOCS_ROW })).toEqual(expected);
  });

  it("keeps a null rateLimit as null and an empty parameter list empty", () => {
    const row: BrazeDocsOperationRow = { ...DOCS_ROW, parameters: [], rateLimit: null, responseFields: [] };
    const projected = projectBrazeDocsOperation({ at: AT, row });
    expect(projected.channels.docs!.detail).toEqual({
      disposition: "voluminous",
      dispositionReason: "reason-docs-voluminous",
      dispositionRuleId: "rule-docs-id",
      method: "PATCH",
      parameters: [],
      pathShape: "/docs-path/{doc-id}",
      rateLimit: null,
      responseFields: [],
      title: "Docs Title Sentinel",
    });
  });

  it("copies the arrays rather than aliasing the row's own", () => {
    const projected = projectBrazeDocsOperation({ at: AT, row: DOCS_ROW });
    // `as`: the entity schema stores a channel's detail as `unknown`; the docs projection writes this shape.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const detail = projected.channels.docs!.detail as BrazeOperationDocsDetail;
    expect(detail.parameters).not.toBe(DOCS_ROW.parameters);
    expect(detail.parameters[0]).not.toBe(DOCS_ROW.parameters[0]);
    expect(detail.responseFields).not.toBe(DOCS_ROW.responseFields);
  });
});

describe("projectBrazeCollectionOperation", () => {
  it("projects the whole collection row into an entity carrying only the collection channel, kinded by the argument", () => {
    const expected: BrazeAtlasEntity = {
      channels: {
        api: null,
        browser: null,
        collection: {
          channel: "collection",
          detail: {
            folders: ["Folder Outer", "Folder Inner"],
            headers: ["Header-First", "Header-Second"],
            method: "PUT",
            name: "Collection Request Name",
            pathShape: "/collection-path/{coll-id}",
            queryParams: ["query-first", "query-second"],
            requestBodyFields: ["body-field-first", "body-field-second", "body-field-third"],
          },
          firstSeenAt: AT,
          lastSeenAt: AT,
          source: {
            artifacts: [],
            channel: "collection",
            deepLink: null,
            deepLinkStatus: "unavailable",
            endpoint: "PUT /collection-path/{coll-id}",
            observedAt: AT,
          },
          state: "observed",
        },
        docs: null,
      },
      id: brazeEntityId({ kind: "undocumented", providerId: "PUT /collection-provider-id" }),
      kind: "undocumented",
      providerId: "PUT /collection-provider-id",
    };
    expect(projectBrazeCollectionOperation({ at: AT, kind: "undocumented", row: COLLECTION_ROW })).toEqual(expected);
  });

  it("derives the id from the kind argument, so one provider id under two kinds is two entities", () => {
    const asUndocumented = projectBrazeCollectionOperation({ at: AT, kind: "undocumented", row: COLLECTION_ROW });
    const asScim = projectBrazeCollectionOperation({ at: AT, kind: "scim", row: COLLECTION_ROW });
    expect(asScim.kind).toBe("scim");
    expect(asScim.id).toBe(brazeEntityId({ kind: "scim", providerId: "PUT /collection-provider-id" }));
    expect(asScim.id).not.toBe(asUndocumented.id);
  });

  it("copies the arrays rather than aliasing the row's own", () => {
    const projected = projectBrazeCollectionOperation({ at: AT, kind: "undocumented", row: COLLECTION_ROW });
    // `as`: the entity schema stores a channel's detail as `unknown`; the collection projection writes this shape.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const detail = projected.channels.collection!.detail as BrazeOperationCollectionDetail;
    expect(detail.folders).not.toBe(COLLECTION_ROW.folders);
    expect(detail.headers).not.toBe(COLLECTION_ROW.headers);
    expect(detail.queryParams).not.toBe(COLLECTION_ROW.queryParams);
    expect(detail.requestBodyFields).not.toBe(COLLECTION_ROW.requestBodyFields);
  });
});

describe("brazeCollectionUrl", () => {
  it("is the official Postman collection document's address", () => {
    expect(brazeCollectionUrl()).toBe(
      "https://documenter.gw.postman.com/api/collections/4689407/SVYrsdsG?segregateAuth=true&versionTag=latest",
    );
  });
});
