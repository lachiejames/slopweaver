import { describe, expect, it } from "vitest";

import {
  projectCrowdstrikeConsolePage,
  projectCrowdstrikeConsoleRequest,
} from "../../../../atlas/crowdstrike/projectConsole.js";
import { projectCrowdstrikeDetection } from "../../../../atlas/crowdstrike/projectDetections.js";
import { projectCrowdstrikeHost, projectCrowdstrikeHostGroup } from "../../../../atlas/crowdstrike/projectHosts.js";
import type { ProjectionContext } from "../../../../atlas/crowdstrike/projectionEnvelope.js";
import { readIso, readNumber, readString, readStringArray } from "../../../../atlas/crowdstrike/projectionReaders.js";
import { projectCrowdstrikePolicy } from "../../../../atlas/crowdstrike/projectPolicies.js";
import { projectCrowdstrikeVulnerability } from "../../../../atlas/crowdstrike/projectVulnerabilities.js";
import {
  projectCrowdstrikeZeroTrustAssessment,
  projectCrowdstrikeZeroTrustAudit,
} from "../../../../atlas/crowdstrike/projectZeroTrust.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-04T00:00:00.000Z";

const API: ProjectionContext = {
  at: AT,
  source: { endpoint: "/devices/entities/devices/v2", observedAt: AT, surface: "falcon-api" },
};

const CONSOLE: ProjectionContext = {
  at: AT,
  source: { endpoint: "https://falcon.example-cloud.test (console walk)", observedAt: AT, surface: "falcon-console" },
};

describe("field accessors", () => {
  it("refuses a denied field even when the provider returned it", () => {
    expect(readString({ field: "local_ip", raw: { local_ip: "10.0.0.4" } })).toBe(null);
    expect(readString({ field: "cmdline", raw: { cmdline: "/bin/sh -c whoami" } })).toBe(null);
  });

  it("reads an admitted field and trims it", () => {
    expect(readString({ field: "hostname", raw: { hostname: "  EXAMPLE-1 " } })).toBe("EXAMPLE-1");
  });

  it("treats an empty string as absent", () => {
    expect(readString({ field: "hostname", raw: { hostname: "   " } })).toBe(null);
  });

  it("refuses a non-finite number", () => {
    expect(readNumber({ field: "score", raw: { score: Number.NaN } })).toBe(null);
    expect(readNumber({ field: "score", raw: { score: 0 } })).toBe(0);
  });

  it("canonicalises an instant and refuses one it cannot parse", () => {
    expect(readIso({ field: "last_seen", raw: { last_seen: "2026-09-04T01:02:03Z" } })).toBe(
      "2026-09-04T01:02:03.000Z",
    );
    expect(readIso({ field: "last_seen", raw: { last_seen: "not a date" } })).toBe(null);
  });

  it("sorts and deduplicates a string list", () => {
    expect(readStringArray({ field: "groups", raw: { groups: ["b", "a", "b", 4] } })).toEqual(["a", "b"]);
  });
});

describe("projectCrowdstrikeHost", () => {
  const raw = {
    agent_version: "7.20.1",
    device_id: "0000000000000000000000000000c001",
    device_policies: {
      prevention: { applied: true, policy_id: "0000000000000000000000000000f001" },
      sensor_update: { applied: false, policy_id: "0000000000000000000000000000f002" },
    },
    external_ip: "203.0.113.7",
    groups: ["g2", "g1"],
    hostname: "EXAMPLE-LAPTOP-1",
    last_seen: "2026-09-03T22:15:00Z",
    local_ip: "10.0.0.4",
    mac_address: "00-11-22-33-44-55",
    os_version: "Sonoma (14.6)",
    platform_name: "Mac",
    product_type_desc: "Workstation",
    reduced_functionality_mode: "no",
    serial_number: "SERIAL-1",
    status: "normal",
    system_manufacturer: "Example Inc.",
    system_product_name: "ExampleBook Pro",
  };

  it("keeps every cross-atlas join key", () => {
    const host = unwrap(
      projectCrowdstrikeHost({ context: API, hidden: false, loginHistory: null, onlineState: null, raw }),
    );
    expect(host.serialNumber).toBe("SERIAL-1");
    expect(host.hostname).toBe("EXAMPLE-LAPTOP-1");
    expect(host.macAddress).toBe("00-11-22-33-44-55");
  });

  it("drops the network locators the boundary denies", () => {
    const host = unwrap(
      projectCrowdstrikeHost({ context: API, hidden: false, loginHistory: null, onlineState: null, raw }),
    );
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule: the raw host
    // really carries these two addresses, and the projected host does not.
    expect(JSON.stringify(raw)).toContain("203.0.113.7");
    expect(JSON.stringify(raw)).toContain("10.0.0.4");
    expect(JSON.stringify(host)).not.toContain("203.0.113.7");
    expect(JSON.stringify(host)).not.toContain("10.0.0.4");
  });

  it("reads the policy attachment out of device_policies", () => {
    const host = unwrap(
      projectCrowdstrikeHost({ context: API, hidden: false, loginHistory: null, onlineState: null, raw }),
    );
    expect(host.preventionPolicyId).toBe("0000000000000000000000000000f001");
    expect(host.preventionPolicyApplied).toBe(true);
    expect(host.sensorUpdatePolicyApplied).toBe(false);
  });

  it("prefers the login-history account over the host record's own", () => {
    const host = unwrap(
      projectCrowdstrikeHost({
        context: API,
        hidden: false,
        loginHistory: { recent_logins: [{ login_time: "2026-09-03T09:00:00Z", user_name: "example.person" }] },
        onlineState: { state: "online" },
        raw: { ...raw, last_login_user: "stale.person" },
      }),
    );
    expect(host.lastLoginAccount).toBe("example.person");
    expect(host.lastLoginAt).toBe("2026-09-03T09:00:00.000Z");
    expect(host.onlineState).toBe("online");
  });

  it("carries the hidden flag rather than dropping a hidden device", () => {
    const host = unwrap(
      projectCrowdstrikeHost({ context: API, hidden: true, loginHistory: null, onlineState: null, raw }),
    );
    expect(host.hidden).toBe(true);
  });

  it("marks a fresh projection observed and stamps its provenance", () => {
    const host = unwrap(
      projectCrowdstrikeHost({ context: API, hidden: false, loginHistory: null, onlineState: null, raw }),
    );
    expect(host.state).toBe("observed");
    expect(host.source.surface).toBe("falcon-api");
    expect(host.source.deepLinkStatus).toBe("unverified");
    expect(host.source.deepLink).toBe(null);
  });

  it("refuses a record with no device id rather than inventing an identity", () => {
    const problems = unwrapErr(
      projectCrowdstrikeHost({
        context: API,
        hidden: false,
        loginHistory: null,
        onlineState: null,
        raw: { hostname: "X" },
      }),
    );
    expect(problems[0]).toContain("carried no device_id");
  });

  it("names the kind and the missing field as exactly one line", () => {
    const problems = unwrapErr(
      projectCrowdstrikeHost({
        context: API,
        hidden: false,
        loginHistory: null,
        onlineState: null,
        raw: { hostname: "X" },
      }),
    );
    expect(problems).toEqual(["a host record carried no device_id, so it cannot be given a stable identity"]);
  });
});

describe("projectCrowdstrikePolicy", () => {
  it("flattens a prevention policy's two-level settings tree", () => {
    const policy = unwrap(
      projectCrowdstrikePolicy({
        context: API,
        kind: "prevention-policy",
        raw: {
          enabled: true,
          groups: [{ id: "g1" }, { id: "g1" }],
          id: "p1",
          name: "Phase 1",
          prevention_settings: [
            { name: "Malware", settings: [{ id: "AdwarePUP", name: "Adware", value: { enabled: true } }] },
          ],
        },
      }),
    );
    expect(policy.groupIds).toEqual(["g1"]);
    expect(policy.settings).toEqual([
      { category: "Malware", id: "AdwarePUP", name: "Adware", value: '{"enabled":true}' },
    ]);
  });

  it("flattens a sensor-update policy's flat settings object", () => {
    const policy = unwrap(
      projectCrowdstrikePolicy({
        context: API,
        kind: "sensor-update-policy",
        raw: { enabled: false, groups: [], id: "s1", name: "Auto N-1", settings: { build: "7.20", stage: "prod" } },
      }),
    );
    expect(policy.settings.map((setting) => setting.id)).toEqual(["build", "stage"]);
    expect(policy.enabled).toBe(false);
  });
});

describe("projectCrowdstrikeVulnerability", () => {
  it("reads the cve facet a bare read does not return", () => {
    const finding = unwrap(
      projectCrowdstrikeVulnerability({
        context: API,
        raw: {
          aid: "0000000000000000000000000000c001",
          apps: [{ product_name_version: "Example App 1.2", sub_status: "open", vendor_normalized: "example" }],
          cve: {
            base_score: 9.8,
            cisa_info: { is_cisa_kev: true },
            exploit_status: 90,
            exprt_rating: "HIGH",
            id: "CVE-2026-0001",
            severity: "CRITICAL",
          },
          id: "finding-1",
          status: "open",
        },
      }),
    );
    expect(finding.baseScore).toBe(9.8);
    expect(finding.isCisaKev).toBe(true);
    expect(finding.exploitStatus).toBe(90);
    expect(finding.cveId).toBe("CVE-2026-0001");
    expect(finding.apps).toEqual([
      { productNameVersion: "Example App 1.2", subStatus: "open", vendorNormalized: "example" },
    ]);
  });
});

describe("projectCrowdstrikeZeroTrustAssessment", () => {
  it("keys itself by the agent id and reads the nested scores", () => {
    const assessment = unwrap(
      projectCrowdstrikeZeroTrustAssessment({
        context: API,
        raw: {
          aid: "0000000000000000000000000000c001",
          assessment: { os: 88, overall: 91, sensor_config: 95, version: "3.0" },
          modified_time: "2026-09-03T00:00:00Z",
          system_serial_number: "SERIAL-1",
        },
      }),
    );
    expect(assessment.hostAid).toBe("0000000000000000000000000000c001");
    expect(assessment.overallScore).toBe(91);
    expect(assessment.sensorConfigScore).toBe(95);
    expect(assessment.serialNumber).toBe("SERIAL-1");
  });
});

describe("projectCrowdstrikeZeroTrustAudit", () => {
  it("keys the singleton by the tenant id so a re-sync merges", () => {
    const audit = unwrap(
      projectCrowdstrikeZeroTrustAudit({
        context: API,
        raw: {
          average_overall_score: 70.5,
          cid: "0000000000000000000000000000c1d0",
          num_aids: 120,
          platforms: [{ average_overall_score: 90, name: "Mac", num_aids: 100 }],
        },
      }),
    );
    expect(audit.providerId).toBe("0000000000000000000000000000c1d0");
    expect(audit.assessedHostCount).toBe(120);
    expect(audit.platforms).toEqual([{ assessedHostCount: 100, averageOverallScore: 90, name: "Mac" }]);
  });
});

describe("projectCrowdstrikeDetection", () => {
  const raw = {
    agent_id: "0000000000000000000000000000c001",
    cmdline: "/bin/sh -c whoami",
    composite_id: "cid:aid:1",
    created_timestamp: "2026-09-03T10:00:00Z",
    device: { hostname: "EXAMPLE-LAPTOP-1" },
    display_name: "SuspiciousActivity",
    falcon_host_link: "https://falcon.example-cloud.test/activity-v2/detections/cid:aid:1",
    filepath: "/tmp/x",
    objective: "Falcon Detection Method",
    product: "epp",
    severity: 70,
    status: "new",
    tactic: "Discovery",
    technique: "System Owner",
  };

  it("records the provider's OWN deep link as provider-provided", () => {
    const detection = unwrap(projectCrowdstrikeDetection({ context: API, raw }));
    expect(detection.source.deepLink).toBe("https://falcon.example-cloud.test/activity-v2/detections/cid:aid:1");
    expect(detection.source.deepLinkStatus).toBe("provider-provided");
  });

  it("refuses the incident content the boundary denies", () => {
    const detection = unwrap(projectCrowdstrikeDetection({ context: API, raw }));
    // Both halves: the raw detection really carries the command line and the file path it must not store.
    expect(JSON.stringify(raw)).toContain("whoami");
    expect(JSON.stringify(raw)).toContain("/tmp/x");
    expect(JSON.stringify(detection)).not.toContain("whoami");
    expect(JSON.stringify(detection)).not.toContain("/tmp/x");
  });

  it("keeps the posture fields the ISO question asks about", () => {
    const detection = unwrap(projectCrowdstrikeDetection({ context: API, raw }));
    expect(detection.severity).toBe(70);
    expect(detection.tactic).toBe("Discovery");
    expect(detection.hostname).toBe("EXAMPLE-LAPTOP-1");
  });
});

describe("console projections", () => {
  it("marks a landed page's own URL browser-discovered", () => {
    const page = unwrap(
      projectCrowdstrikeConsolePage({
        context: CONSOLE,
        observation: {
          appName: "hosts",
          artifacts: [],
          featureFlags: ["flag-a"],
          finalUrl: "https://falcon.example-cloud.test/host-management/hosts",
          href: "/host-management/hosts",
          outcome: "landed",
          permissions: ["perm-a"],
          statusCode: 200,
          title: "Host Management",
        },
      }),
    );
    expect(page.source.deepLinkStatus).toBe("browser-discovered");
    expect(page.providerId).toBe("/host-management/hosts");
  });

  it("gives a redirected page no deep link at all", () => {
    const page = unwrap(
      projectCrowdstrikeConsolePage({
        context: CONSOLE,
        observation: {
          appName: null,
          artifacts: [],
          featureFlags: [],
          finalUrl: "https://falcon.example-cloud.test/hub/summary",
          href: "/gated/page",
          outcome: "redirected",
          permissions: [],
          statusCode: 200,
          title: "Hub",
        },
      }),
    );
    expect(page.source.deepLink).toBe(null);
    expect(page.source.deepLinkStatus).toBe("unverified");
    expect(page.outcome).toBe("redirected");
  });

  it("stamps a recorded console call as never callable by this installation", () => {
    const request = unwrap(
      projectCrowdstrikeConsoleRequest({
        context: CONSOLE,
        observation: {
          method: "GET",
          observedOnPages: ["/b", "/a"],
          paramNames: ["limit", "filter"],
          pathShape: "/api2/devices/queries/fga-hosts/v1",
          responseFieldPaths: ["resources[]", "meta.pagination.total"],
          statusCodes: [200, 200],
        },
      }),
    );
    expect(request.callability).toBe("browser-observed-only");
    expect(request.observedOnPages).toEqual(["/a", "/b"]);
    expect(request.paramNames).toEqual(["filter", "limit"]);
    expect(request.statusCodes).toEqual([200]);
  });
});

describe("projectCrowdstrikeHostGroup", () => {
  it("falls back to the id when a group has no name", () => {
    const group = unwrap(projectCrowdstrikeHostGroup({ context: API, raw: { id: "g1" } }));
    expect(group.name).toBe("g1");
  });
});
