import { describe, expect, it } from "vitest";

import {
  type CloudflarePagesChildItem,
  type CloudflarePagesDomainDetail,
  type CloudflarePagesProjectDetail,
  extractCloudflarePagesChildren,
  isCloudflarePagesProjectDetail,
  missingDeclaredPagesDomains,
  normalizeCloudflarePagesChildItem,
  projectCloudflarePagesProject,
} from "../../../../../atlas/cloudflare/projection/pages.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

/** One stored domain with only its name and status set. */
function domainDetail({ name, status }: { name: string; status: string }): CloudflarePagesDomainDetail {
  return {
    certificateAuthority: null,
    domainId: null,
    name,
    status,
    validationStatus: null,
    verificationStatus: null,
    zoneTag: null,
  };
}

/** The same domain, tagged as one of a project's child items. */
function pagesDomain({ name, status }: { name: string; status: string }): CloudflarePagesChildItem {
  return { domain: domainDetail({ name, status }), itemKind: "domain" };
}

describe("missingDeclaredPagesDomains", () => {
  it("names every declared domain the read did not return, in declared order", () => {
    expect(
      missingDeclaredPagesDomains({
        declared: ["a.example.test", "b.example.test", "c.example.test"],
        read: [domainDetail({ name: "b.example.test", status: "active" })],
      }),
    ).toEqual(["a.example.test", "c.example.test"]);
  });

  it("matches names case-insensitively", () => {
    expect(
      missingDeclaredPagesDomains({
        declared: ["App.Example.Test"],
        read: [domainDetail({ name: "app.example.test", status: "active" })],
      }),
    ).toEqual([]);
  });
});

describe("normalizeCloudflarePagesChildItem", () => {
  it("normalizes a domain, defaulting missing optional fields to null", () => {
    expect(
      normalizeCloudflarePagesChildItem({ raw: { domain: { name: "my-site.example.test" }, itemKind: "domain" } }),
    ).toEqual({
      domain: {
        certificateAuthority: null,
        domainId: null,
        name: "my-site.example.test",
        status: null,
        validationStatus: null,
        verificationStatus: null,
        zoneTag: null,
      },
      itemKind: "domain",
    });
  });

  it("keeps a domain's present fields", () => {
    const normalized = normalizeCloudflarePagesChildItem({
      raw: {
        domain: {
          certificate_authority: "lets_encrypt",
          domain_id: "dom-1",
          name: "my-site.example.test",
          status: "active",
          validation_data: { method: "http", status: "active" },
          verification_data: { status: "active" },
          zone_tag: "zone-1",
        },
        itemKind: "domain",
      },
    });
    expect(normalized).toEqual({
      domain: {
        certificateAuthority: "lets_encrypt",
        domainId: "dom-1",
        name: "my-site.example.test",
        status: "active",
        validationStatus: "active",
        verificationStatus: "active",
        zoneTag: "zone-1",
      },
      itemKind: "domain",
    });
  });

  it("stores a domain's nested validation and verification status as null when the nested object omits it", () => {
    const normalized = normalizeCloudflarePagesChildItem({
      raw: {
        domain: { name: "my-site.example.test", validation_data: {}, verification_data: {} },
        itemKind: "domain",
      },
    });
    expect(normalized).toEqual({
      domain: {
        certificateAuthority: null,
        domainId: null,
        name: "my-site.example.test",
        status: null,
        validationStatus: null,
        verificationStatus: null,
        zoneTag: null,
      },
      itemKind: "domain",
    });
  });

  it("keeps a deployment's present fields, its latest stage and its aliases, leaving the rest as open config", () => {
    const normalized = normalizeCloudflarePagesChildItem({
      raw: {
        deployment: {
          aliases: ["preview.my-site.pages.dev"],
          created_on: "2026-01-01T00:00:00Z",
          environment: "production",
          id: "dep-1",
          latest_stage: { name: "deploy", status: "success" },
          modified_on: "2026-01-02T00:00:00Z",
          short_id: "abc123",
          source: { type: "github" },
          url: "https://abc123.my-site.pages.dev",
        },
        itemKind: "deployment",
      },
    });
    expect(normalized).toEqual({
      deployment: {
        aliases: ["preview.my-site.pages.dev"],
        config: { source: { type: "github" } },
        createdOn: "2026-01-01T00:00:00Z",
        environment: "production",
        id: "dep-1",
        latestStageName: "deploy",
        latestStageStatus: "success",
        modifiedOn: "2026-01-02T00:00:00Z",
        shortId: "abc123",
        url: "https://abc123.my-site.pages.dev",
      },
      itemKind: "deployment",
    });
  });

  it("stores a deployment's null aliases and an empty latest stage as an empty list and null fields", () => {
    const normalized = normalizeCloudflarePagesChildItem({
      raw: { deployment: { aliases: null, id: "dep-1", latest_stage: {} }, itemKind: "deployment" },
    });
    expect(normalized).toEqual({
      deployment: {
        aliases: [],
        config: {},
        createdOn: null,
        environment: null,
        id: "dep-1",
        latestStageName: null,
        latestStageStatus: null,
        modifiedOn: null,
        shortId: null,
        url: null,
      },
      itemKind: "deployment",
    });
  });

  it("redacts a secret-text environment variable's value at any nesting depth inside a deployment's config", () => {
    const normalized = normalizeCloudflarePagesChildItem({
      raw: {
        deployment: {
          env_vars: { API_KEY: { type: "secret_text", value: "shh" } },
          id: "dep-1",
        },
        itemKind: "deployment",
      },
    });
    expect(normalized).toEqual({
      deployment: {
        aliases: [],
        config: { env_vars: { API_KEY: { type: "secret_text", value: null } } },
        createdOn: null,
        environment: null,
        id: "dep-1",
        latestStageName: null,
        latestStageStatus: null,
        modifiedOn: null,
        shortId: null,
        url: null,
      },
      itemKind: "deployment",
    });
  });

  it("keeps a plain-text environment variable's value", () => {
    const normalized = normalizeCloudflarePagesChildItem({
      raw: {
        deployment: { env_vars: { MODE: { type: "plain_text", value: "prod" } }, id: "dep-1" },
        itemKind: "deployment",
      },
    });
    expect(normalized.itemKind === "deployment" && normalized.deployment.config).toEqual({
      env_vars: { MODE: { type: "plain_text", value: "prod" } },
    });
  });
});

describe("projectCloudflarePagesProject", () => {
  it("stores a project's omitted optional fields as null", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: { domains: [], id: "proj-1", name: "my-site", production_branch: "main" },
    });
    expect(entity.detail).toEqual({
      canonicalDeploymentId: null,
      config: {},
      declaredDomainNames: [],
      deployments: [],
      domains: [],
      domainsComplete: true,
      framework: null,
      frameworkVersion: null,
      kind: "pages-project",
      latestDeploymentId: null,
      name: "my-site",
      productionBranch: "main",
      subdomain: null,
      usesFunctions: null,
    });
  });

  it("stores null deployment references and an empty nested reference as null", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: {
        canonical_deployment: {},
        id: "proj-1",
        latest_deployment: null,
        name: "my-site",
        production_branch: "main",
      },
    });
    const detail = entity.detail as CloudflarePagesProjectDetail;
    expect(detail.latestDeploymentId).toBeNull();
    expect(detail.canonicalDeploymentId).toBeNull();
  });

  it("keeps a project's present fields and leaves the rest as open config", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: {
        canonical_deployment: { id: "dep-canonical" },
        created_on: "2026-01-01T00:00:00Z",
        domains: ["my-site.pages.dev"],
        framework: "astro",
        framework_version: "4.0.0",
        id: "proj-1",
        latest_deployment: { id: "dep-latest" },
        name: "my-site",
        production_branch: "main",
        subdomain: "my-site.pages.dev",
        uses_functions: false,
      },
    });
    expect(entity.detail).toEqual({
      canonicalDeploymentId: "dep-canonical",
      config: { created_on: "2026-01-01T00:00:00Z" },
      declaredDomainNames: [],
      deployments: [],
      domains: [],
      domainsComplete: true,
      framework: "astro",
      frameworkVersion: "4.0.0",
      kind: "pages-project",
      latestDeploymentId: "dep-latest",
      name: "my-site",
      productionBranch: "main",
      subdomain: "my-site.pages.dev",
      usesFunctions: false,
    });
  });

  it("marks domains complete when the read count matches the project's own declared domains", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        {
          domain: {
            certificateAuthority: null,
            domainId: null,
            name: "my-site.example.test",
            status: null,
            validationStatus: null,
            verificationStatus: null,
            zoneTag: null,
          },
          itemKind: "domain",
        },
      ],
      raw: { domains: ["my-site.example.test"], id: "proj-1", name: "my-site", production_branch: "main" },
    });
    const detail = entity.detail as CloudflarePagesProjectDetail;
    expect(detail.domainsComplete).toBe(true);
    expect(detail.declaredDomainNames).toEqual(["my-site.example.test"]);
  });

  it("marks domains incomplete when the read count falls short of the declared domains", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: { domains: ["my-site.example.test"], id: "proj-1", name: "my-site", production_branch: "main" },
    });
    expect((entity.detail as CloudflarePagesProjectDetail).domainsComplete).toBe(false);
  });

  it("marks domains complete when the read also returns an undeclared deactivated domain, the referral-hub shape", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [pagesDomain({ name: "referral.example.test", status: "deactivated" })],
      raw: { domains: [], id: "proj-1", name: "referral-hub", production_branch: "main" },
    });
    expect((entity.detail as CloudflarePagesProjectDetail).domainsComplete).toBe(true);
  });

  it("marks domains complete when the read returns every declared domain plus one in error, the customer-ui shape", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        pagesDomain({ name: "app.example.test", status: "active" }),
        pagesDomain({ name: "app2.example.test", status: "error" }),
      ],
      raw: { domains: ["app.example.test"], id: "proj-1", name: "customer-ui", production_branch: "main" },
    });
    expect((entity.detail as CloudflarePagesProjectDetail).domainsComplete).toBe(true);
  });

  it("marks domains incomplete when the counts match but a declared name was not read", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        pagesDomain({ name: "a.example.test", status: "active" }),
        pagesDomain({ name: "x.example.test", status: "error" }),
      ],
      raw: { domains: ["a.example.test", "b.example.test"], id: "proj-1", name: "my-site", production_branch: "main" },
    });
    expect((entity.detail as CloudflarePagesProjectDetail).domainsComplete).toBe(false);
  });

  it("excludes the project's own built-in *.pages.dev subdomain from the declared domain list, since domains.list() never returns it", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        {
          domain: {
            certificateAuthority: null,
            domainId: null,
            name: "my-site.example.test",
            status: null,
            validationStatus: null,
            verificationStatus: null,
            zoneTag: null,
          },
          itemKind: "domain",
        },
      ],
      raw: {
        domains: ["my-site.pages.dev", "my-site.example.test"],
        id: "proj-1",
        name: "my-site",
        production_branch: "main",
        subdomain: "my-site.pages.dev",
      },
    });
    const detail = entity.detail as CloudflarePagesProjectDetail;
    expect(detail.declaredDomainNames).toEqual(["my-site.example.test"]);
    expect(detail.domainsComplete).toBe(true);
  });

  it("a project with only the default subdomain and no custom domains reads complete with zero declared domains", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: {
        domains: ["my-site.pages.dev"],
        id: "proj-1",
        name: "my-site",
        production_branch: "main",
        subdomain: "my-site.pages.dev",
      },
    });
    const detail = entity.detail as CloudflarePagesProjectDetail;
    expect(detail.declaredDomainNames).toEqual([]);
    expect(detail.domainsComplete).toBe(true);
  });

  it("splits combined children back into their own deployments/domains collections", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        {
          deployment: {
            aliases: [],
            config: {},
            createdOn: null,
            environment: "production",
            id: "dep-1",
            latestStageName: null,
            latestStageStatus: null,
            modifiedOn: null,
            shortId: null,
            url: null,
          },
          itemKind: "deployment",
        },
      ],
      raw: { id: "proj-1", name: "my-site", production_branch: "main" },
    });
    const detail = entity.detail as CloudflarePagesProjectDetail;
    expect(detail.deployments).toHaveLength(1);
    expect(detail.domains).toHaveLength(0);
  });

  it("redacts a secret-text value inside the project's own open config bucket", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: {
        deployment_configs: { production: { env_vars: { API_KEY: { type: "secret_text", value: "shh" } } } },
        id: "proj-1",
        name: "my-site",
        production_branch: "main",
      },
    });
    const detail = entity.detail as CloudflarePagesProjectDetail;
    expect(detail.config).toEqual({
      deployment_configs: { production: { env_vars: { API_KEY: { type: "secret_text", value: null } } } },
    });
  });
});

describe("extractCloudflarePagesChildren", () => {
  it("round-trips a stored detail's deployments/domains back into the combined, tagged shape", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        {
          domain: {
            certificateAuthority: null,
            domainId: null,
            name: "my-site.example.test",
            status: null,
            validationStatus: null,
            verificationStatus: null,
            zoneTag: null,
          },
          itemKind: "domain",
        },
      ],
      raw: { domains: ["my-site.example.test"], id: "proj-1", name: "my-site", production_branch: "main" },
    });
    const detail = entity.detail as CloudflarePagesProjectDetail;
    expect(extractCloudflarePagesChildren({ detail })).toEqual([
      {
        domain: {
          certificateAuthority: null,
          domainId: null,
          name: "my-site.example.test",
          status: null,
          validationStatus: null,
          verificationStatus: null,
          zoneTag: null,
        },
        itemKind: "domain",
      },
    ]);
  });
});

describe("isCloudflarePagesProjectDetail", () => {
  it("accepts a genuine detail", () => {
    const entity = projectCloudflarePagesProject({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: { id: "proj-1", name: "my-site", production_branch: "main" },
    });
    expect(isCloudflarePagesProjectDetail(entity.detail)).toBe(true);
  });

  it("rejects a detail from a different kind", () => {
    expect(isCloudflarePagesProjectDetail({ kind: "zone" })).toBe(false);
  });

  it("rejects a non-object value", () => {
    expect(isCloudflarePagesProjectDetail("not an object")).toBe(false);
  });
});
