/** The GitHub integration's manifest — strings, its atlas row and `import()` thunks only. */
import { GITHUB_ATLAS_REGISTRATION } from "../../atlas/github/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The github row of the integration registry. */
export const GITHUB_INTEGRATION = {
  browserWrite: {
    ordinal: 1,
    row: {
      door: "slopweaver github read / checks / pr / comment / thread",
      hosts: ["github.com", "githubusercontent.com"],
      policy: "read-before-write",
      provider: "GitHub",
    },
  },
  corpus: {
    allSourcesSweep: true,
    alwaysPrivate: false,
    containerScoped: true,
    identityRoster: true,
    ordinal: 0,
    progressPhase: true,
    resyncDemand: false,
    upfrontTokenGate: false,
  },
  features: {
    atlas: GITHUB_ATLAS_REGISTRATION,
    connect: async () => (await import("../../connect/github.js")).classifyGithub,
    ingest: async () => (await import("../../corpus/github/fetch.js")).collectSearchHits,
    read: async () => (await import("../../live/github/read.js")).parseGithubReadAddress,
    write: async () => (await import("../../corpus/github/write.js")).makeGithubWriteApi,
  },
  id: "github",
  name: "GitHub",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        // A PREFLIGHT, deliberately not the question — the same call the `drive` row makes and for the same
        // reason. `github read` takes one object URL and `github search` takes GitHub's own query syntax, so a
        // materialised question would either be refused as a URL or AND every word of a sentence into a filter
        // that matches nothing and reads as absence. Turning a question into a URL or a search term is the
        // visible session's judgement; this row's job is to be SEEN, and to say where to look and how.
        command: ["slopweaver", "connect", "github", "--check"],
        coverage: {
          detail:
            "whether this install's GitHub credential reaches the provider, and the exact scopes it holds. The " +
            "READING is the separate act: `slopweaver github read <object-url>` is ONE named issue, pull request " +
            "or discussion as the provider has it now, and `slopweaver github search <term> --repo <owner/name>` " +
            "passes GitHub's own syntax (`is:pr`, `label:x`) through — `--complete` refuses a relevance-ordered " +
            "sample rather than handing one back as the whole set. `github checks` is CI and `github vuln` is " +
            "Dependabot. None of them consults history",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from GitHub when the planned command runs", kind: "live" },
        id: "github-live",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: [
          "pr",
          "pull request",
          "pull requests",
          "issue",
          "issues",
          "repo",
          "repository",
          "commit",
          "commits",
          "review",
          "reviews",
          "github",
        ],
        truthMode: "current",
        what: "the current state of one named GitHub issue, pull request or discussion, and the workspace search that finds one",
      },
      ordinal: 15,
    },
  ],
  sharedRead: true,
} as const satisfies IntegrationManifest;
