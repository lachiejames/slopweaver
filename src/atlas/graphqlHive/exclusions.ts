/**
 * What this atlas deliberately does NOT hold, and — for the voluminous families — the difference between
 * not looking and looking without storing every row.
 *
 * ## A voluminous family is a DISPOSITION, not an exclusion
 *
 * Owner's ruling, `docs/atlas-intent/06-holdings.md`: a highly voluminous surface is enumerated and DECLARED rather
 * than stored whole. Its existence is atlas content; its every row is not. An atlas that simply dropped
 * such a family would answer "Hive has no usage analytics", which is false, and an atlas that stored it
 * whole would be publishing a time series into a file meant to stay greppable.
 *
 * The criterion, applied per operation rather than per product area: a family is voluminous when its
 * records are **time-series OBSERVATIONS** — emitted by the platform rather than created by a person,
 * unbounded, growing with the clock, and identified by an INSTANT rather than by a name somebody chose.
 * Configuration is the complement. Hive cuts cleanly on this and it is worth stating why, because the two
 * halves sit inside one product: a target's *composed schema* is configuration — somebody published it, it
 * has an id, and there is exactly one current one — while that same target's *operation usage* is
 * observations, one row per request the gateway saw. The first is held in full, SDL included. The second is
 * enumerated and never stored.
 *
 * ## And one exclusion that is a real refusal
 *
 * This atlas never sends a mutation. Hive's schema declares plenty — creating a target, issuing a token,
 * deleting a project — and every one of them is recorded as an `operation` entity, because knowing the
 * write surface EXISTS is atlas content. Calling one is not something any verb here can do: the content
 * query is a constant in `registryRead.ts` and no caller supplies a document.
 */

import type { AtlasExclusion } from "../kit/contract.js";

/** Every family this atlas declines to store whole, and why. */
export const HIVE_EXCLUSIONS: readonly AtlasExclusion[] = [
  {
    because:
      "operation usage statistics" +
      " — " +
      "one row per request the gateway observed, identified by an instant and growing with the clock — the " +
      "textbook time-series observation. The operations that expose it are recorded as `operation` entities " +
      "so a reader learns the surface exists and can query it live; no row is ever published into a kind file",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause: "one row per request the gateway observed, identified by an instant and growing with traffic",
      wouldBeMeasuredBy: "the usage query for one target over a fixed window, reading its total",
    },
  },
  {
    because:
      "schema check history" +
      " — " +
      "every proposed change ever submitted against a target, unbounded and append-only. The CURRENT policy " +
      "that decides those checks is configuration and is reachable; the stream of past verdicts is not stored",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause: "every proposed change ever submitted against a target, append-only and unbounded",
      wouldBeMeasuredBy: "the schema-check listing for one target paged to exhaustion",
    },
  },
  {
    because:
      "schema version history" +
      " — " +
      "the append-only log of every publish. The LATEST VALID version is held in full, SDL included, because " +
      "that is the typed surface a consumer actually needs; the versions behind it are enumerable and are not " +
      "published one row each",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause:
        "the append-only log of every publish, which grows with every deploy rather than with anything a person maintains",
      wouldBeMeasuredBy: "the schema-version listing for one target paged to exhaustion",
    },
  },
  {
    because:
      "organisation audit log" +
      " — " +
      "platform-emitted events identified by an instant — the same class, and the same treatment",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause: "platform-emitted organisation events identified by an instant",
      wouldBeMeasuredBy: "the audit-log export for one organisation over a fixed window, counting rows returned",
    },
  },
  {
    because:
      "every mutation" +
      " — " +
      "this atlas only ever reads. Each mutation is still recorded as an `operation` entity, because the " +
      "write surface existing is a fact a reader needs; the content query is a constant and no caller " +
      "supplies a document, so calling one is unreachable rather than merely unused",
    ground: "never-acted",
  },
  {
    because:
      "the secret half of any registry, CDN or organisation access token" +
      " — " +
      "a token's existence, name and scope are surface; its value is a credential. The console page that " +
      "issues them is a declared page and its screenshot is a picture of the list, never of a revealed value",
    ground: "secret-material",
  },
];
