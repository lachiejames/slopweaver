import { describe, expect, it } from "vitest";

import { censusBriefLines, censusServiceMatches, commandRunsDatadog } from "../../../route/censusReading.js";

/** Service volumes shaped like the installed census: several products per service, awkward names included. */
const manifest = {
  services: [
    { events: 100, product: "logs" as const, service: "jobs-api" },
    { events: 50, product: "spans" as const, service: "jobs-api" },
    { events: 90, product: "logs" as const, service: "core-api" },
    { events: 5, product: "logs" as const, service: "sso" },
    { events: 7, product: "logs" as const, service: "acme" },
    { events: 3, product: "logs" as const, service: "job-etl-16-sync-crm-contacts-pubsub" },
    { events: 2, product: "logs" as const, service: "acme-nightly-job-sync-ledger" },
    { events: 2, product: "logs" as const, service: "acme-nightly-job-audit-ledger-fields" },
    { events: 1, product: "logs" as const, service: "client-portal-api" },
    { events: 1, product: "logs" as const, service: "prod-eu-client-portal-api" },
  ],
};

describe("censusServiceMatches", () => {
  it("names a service written whole, summing its volume across products", () => {
    const reading = censusServiceMatches({ manifest, question: "why is jobs-api throwing errors?" });
    expect(reading.matches).toEqual([{ events: 150, service: "jobs-api", token: "jobs-api" }]);
  });

  it("orders several named services by how much they emit", () => {
    const reading = censusServiceMatches({ manifest, question: "core-api and jobs-api latency" });
    expect(reading.matches.map((match) => match.service)).toEqual(["jobs-api", "core-api"]);
  });

  it("never matches by containment, so `processor` does not name `sso`", () => {
    const reading = censusServiceMatches({ manifest, question: "who owns the payment processor rollout" });
    expect(reading.matches).toEqual([]);
  });

  it("ignores a service whose whole name is an ordinary word in a question", () => {
    const reading = censusServiceMatches({ manifest, question: "what does acme do about onboarding" });
    expect(reading.matches).toEqual([]);
  });

  it("names a service from a hyphenated run of its own segments", () => {
    const reading = censusServiceMatches({ manifest, question: "is the job sync-ledger still running" });
    expect(reading.matches.map((match) => match.service)).toEqual(["acme-nightly-job-sync-ledger"]);
  });

  // The review pass that found this measured `support`, `rewrite`, `generic`, `invoice`, `location`,
  // `storage`, `contacts` and `knowledge` each naming exactly one real service on the installed census, so
  // "who can I ask for support on this?" made Datadog REQUIRED and demoted the world model to optional.
  it("never matches ONE segment of a service name, however distinctive it looks", () => {
    const ordinary = [
      "are crm contacts syncing",
      "who can I ask for support on this?",
      "can you rewrite that paragraph for me?",
      "that wording is too generic",
      "what did we decide about the portal and ledger",
      "which api is slow",
    ];
    const matched = ordinary.filter((question) => censusServiceMatches({ manifest, question }).matches.length > 0);

    expect(matched).toEqual([]);
  });

  it("names nothing from an empty census", () => {
    const reading = censusServiceMatches({ manifest: { services: [] }, question: "jobs-api errors" });
    expect(reading).toEqual({ matches: [] });
  });
});

describe("censusBriefLines", () => {
  it("prints nothing when the question named no service", () => {
    expect(censusBriefLines({ ageLine: "Datadog census built 1.0h ago", reading: { matches: [] } })).toEqual([]);
  });

  it("names the services, the census age and the next reads for the most-emitting one", () => {
    const reading = censusServiceMatches({ manifest, question: "core-api and jobs-api latency" });
    const lines = censusBriefLines({ ageLine: "Datadog census built 1.0h ago", reading });
    expect(lines[1]).toBe('  - jobs-api (from "jobs-api") — 150 event(s) in the census window');
    expect(lines[3]).toBe("  Datadog census built 1.0h ago");
    expect(lines[4]).toBe(
      "  next: slopweaver datadog logs 'service:jobs-api status:error' --from 24h --by __dd.log_identity.raw_msg_fingerprint",
    );
  });

  it("folds matches past five into one line rather than listing them", () => {
    const many = {
      matches: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].map((service) => ({ events: 1, service, token: service })),
    };
    const lines = censusBriefLines({ ageLine: "age", reading: many });
    expect(lines).toContain("  - and 2 more service(s)");
  });
});

describe("commandRunsDatadog", () => {
  it("recognises a Datadog verb and the Datadog atlas, and nothing else", () => {
    expect(commandRunsDatadog({ command: ["/bin/slopweaver", "datadog", "probe", "--json"] })).toBe(true);
    expect(commandRunsDatadog({ command: ["slopweaver", "atlas", "datadog", "read"] })).toBe(true);
    expect(commandRunsDatadog({ command: ["slopweaver", "atlas", "hex", "read"] })).toBe(false);
    expect(commandRunsDatadog({ command: [] })).toBe(false);
  });
});
