/**
 * What this atlas deliberately does NOT hold, and — for the voluminous families — the difference between
 * not looking and looking without storing every row.
 *
 * ## A voluminous family is a DISPOSITION, not an exclusion
 *
 * Owner's ruling, `docs/atlas-intent/06-holdings.md`: a highly voluminous surface is enumerated and DECLARED rather
 * than stored whole. Its existence is atlas content; its every row is not. An atlas that simply dropped
 * such a family would answer "WorkOS has no audit log", which is false, and an atlas that stored it whole
 * would be publishing a time series into a file meant to stay greppable.
 *
 * The criterion, applied per operation rather than per product area: a family is voluminous when its
 * records are **time-series OBSERVATIONS** — emitted by the platform rather than created by a person,
 * unbounded, growing with the clock, and identified by an INSTANT rather than by a name somebody chose.
 * Configuration is the complement. WorkOS cuts on this INSIDE a single product area, which is exactly why
 * the criterion has to be applied per operation: `GET /audit_logs/actions` returns the action schemas
 * somebody authored — configuration, listable, and reachable — while `POST /audit_logs/exports` and the
 * event stream behind it return observations, one row per thing that happened. Same product, same URL
 * prefix, opposite dispositions.
 *
 * ## And the refusals, which are real
 *
 * This atlas never sends an authenticated write, and it never stores a secret value. Both are stated here
 * rather than assumed, because "the code does not currently do it" and "the code cannot do it" are
 * different promises and only the second is worth writing down.
 */

import type { AtlasExclusion } from "../kit/contract.js";

/** Every family this atlas declines to store whole, and why. */
export const WORKOS_EXCLUSIONS: readonly AtlasExclusion[] = [
  {
    because:
      "audit log events" +
      " — " +
      "one row per thing that happened in the tenant, identified by an instant and growing with the clock — " +
      "the textbook time-series observation. Every route that emits or exports them is recorded as an " +
      "`operation` entity so a reader learns the surface exists and can query it live; no row is ever " +
      "published into a kind file",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause:
        "one row per thing that happened in the tenant, identified by an instant and growing with the clock",
      wouldBeMeasuredBy: "the audit-log export for one organisation over a fixed window, counting rows returned",
    },
  },
  {
    because:
      "the platform event feed" +
      " — " +
      "`GET /events` is WorkOS's own change stream, cursor-paged and unbounded. The audit log's ACTION " +
      "schemas are configuration and are reachable; the stream of events under them is not stored",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause: "`GET /events` is WorkOS's own change stream, cursor-paged and unbounded",
      wouldBeMeasuredBy: "`GET /events` paged over a fixed window, counting rows returned",
    },
  },
  {
    because:
      "directory user and group membership rows" +
      " — " +
      "a SCIM directory can carry tens of thousands of provisioned users, and they are the identity " +
      "provider's records rather than WorkOS's own configuration. The DIRECTORIES are held in full — what " +
      "is configured, against which organisation, in what state — and the rows they sync are enumerated " +
      "through their routes rather than mirrored",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause:
        "directory user and group membership rows are the identity provider's records, provisioned by SCIM traffic rather than authored in WorkOS",
      wouldBeMeasuredBy: "`GET /directory_users` paged to exhaustion for the largest directory",
    },
  },
  {
    because:
      "every authenticated write" +
      " — " +
      "this atlas only ever reads. Each write route is still recorded as an `operation` entity with " +
      "`writes: true`, because knowing the write surface EXISTS is atlas content; the probe sends no body " +
      "and no credential, and the content reader is GET-only, so calling one is unreachable rather than " +
      "merely unused",
    ground: "never-acted",
  },
  {
    because:
      "the value of any API key, client secret, session token, SAML certificate or Vault entry" +
      " — " +
      "a credential's existence, name and scope are surface; its value is a credential. There is no schema " +
      "in `model.ts` with anywhere to put one, the API-keys dashboard page is declared and its screenshot " +
      "is a picture of the list rather than of a revealed value, and the Vault routes are mapped as routes " +
      "and never read",
    ground: "secret-material",
  },
  {
    because:
      "any environment other than the one this atlas's key is scoped to" +
      " — " +
      "a WorkOS secret key is minted per environment, so the content half sees exactly one and is blind to " +
      "every sibling. That is a declared ceiling rather than a silence — the coverage cells carry " +
      "`api-key-environment`, and the `/environments` dashboard page is declared so a reader knows where " +
      "the rest of them are listed",
    ground: "claim-not-made",
  },
];
