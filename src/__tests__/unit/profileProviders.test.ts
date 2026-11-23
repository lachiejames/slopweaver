/**
 * The per-provider sections of `profile.json`, parsed on their own: each defaults to an install that configured
 * nothing, and refuses a hand-edit it cannot trust with a `profile.json <field>` message.
 */
import { describe, expect, it } from "vitest";

import { datadogSchema, githubSchema, linearSchema, REPOSITORY_TITLE_SHAPES } from "../../profileProviders.js";

describe("linearSchema", () => {
  it("states no team key until one is named", () => {
    expect(linearSchema.parse({})).toStrictEqual({ teamKeys: [] });
  });

  it("keeps uppercase keys", () => {
    expect(linearSchema.parse({ teamKeys: ["ABC", "DEF"] })).toStrictEqual({ teamKeys: ["ABC", "DEF"] });
  });

  // The team-key scan reads `[A-Z]+` alone, so a digit-bearing key was never refused to forgive.
  it("refuses a lowercase key, and a digit-bearing one the team-key scan never reads", () => {
    const parsed = linearSchema.safeParse({ teamKeys: ["abc", "SUP2"] });
    expect(parsed.error!.issues.map((issue) => issue.message)).toStrictEqual([
      "profile.json linear.teamKeys entries must be uppercase letters alone",
      "profile.json linear.teamKeys entries must be uppercase letters alone",
    ]);
  });

  it("refuses a key named twice", () => {
    const parsed = linearSchema.safeParse({ teamKeys: ["ABC", "ABC"] });
    expect(parsed.error!.issues.map((issue) => issue.message)).toStrictEqual([
      "profile.json linear.teamKeys must not contain duplicates",
    ]);
  });
});

describe("githubSchema", () => {
  it("offers exactly the title shapes the code has a rule for", () => {
    expect(REPOSITORY_TITLE_SHAPES).toStrictEqual(["ticketed"]);
  });

  it("holds no repository to a shape until one is named", () => {
    expect(githubSchema.parse({})).toStrictEqual({ titleShapes: {} });
  });

  it("refuses a key that is not a lowercase owner/repo", () => {
    const parsed = githubSchema.safeParse({ titleShapes: { "Acme/Admin": "ticketed" } });
    expect(parsed.error!.issues.map((issue) => issue.message)).toStrictEqual([
      "profile.json github.titleShapes keys must be lowercase owner/repo",
    ]);
  });
});

describe("datadogSchema", () => {
  it("defaults to no tags and no metrics producers", () => {
    expect(datadogSchema.parse({})).toStrictEqual({ iacManagedTags: [], metricsProducers: {} });
  });

  it("accepts a declared producer, its secrets defaulting to none", () => {
    const parsed = datadogSchema.parse({
      metricsProducers: { "daily-delivery": { checkout: "/work/acme-metrics", command: ["node", "produce.js"] } },
    });
    expect(parsed.metricsProducers).toStrictEqual({
      "daily-delivery": { checkout: "/work/acme-metrics", command: ["node", "produce.js"], secrets: {} },
    });
  });

  it.each([
    [
      "a relative checkout",
      { "daily-delivery": { checkout: "acme-metrics", command: ["node"] } },
      "profile.json datadog.metricsProducers.<name>.checkout must be an absolute path",
    ],
    [
      "an empty command",
      { "daily-delivery": { checkout: "/work/acme-metrics", command: [] } },
      "profile.json datadog.metricsProducers.<name>.command must name at least the executable",
    ],
    [
      "a producer name that is not lowercase",
      { DailyDelivery: { checkout: "/work/acme-metrics", command: ["node"] } },
      "profile.json datadog.metricsProducers keys must be lowercase producer names",
    ],
    [
      "a secret handed under a name no environment allows",
      { "daily-delivery": { checkout: "/work/acme-metrics", command: ["node"], secrets: { "1BAD": "linear-token" } } },
      "profile.json datadog.metricsProducers.<name>.secrets keys must be environment variable names",
    ],
    [
      "a secret value that is a path rather than a secret name",
      { "daily-delivery": { checkout: "/work/acme-metrics", command: ["node"], secrets: { TOKEN: "../id_rsa" } } },
      "profile.json datadog.metricsProducers.<name>.secrets values must be secret names",
    ],
  ])("refuses %s", (_label, metricsProducers, message) => {
    const parsed = datadogSchema.safeParse({ metricsProducers });
    expect(parsed.error!.issues.map((issue) => issue.message)).toStrictEqual([message]);
  });
});
