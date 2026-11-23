/**
 * What the GitHub atlas declares about itself — including the one thing it can never claim.
 *
 * ## Its subject is the SURFACE MAP, and the exclusions are where that is enforced
 *
 * The owner's per-platform criterion — `docs/atlas-intent/06-holdings.md`: does something better
 * suited already hold this platform's entities? Yes for GitHub, as it is for Slack, so the atlas holds the
 * surface map and the first exclusion below is not a limitation but the atlas's purpose stated as a
 * boundary. Every pull request, issue, discussion, review, comment and commit belongs to
 * `src/corpus/github`, and an atlas that copied them would be two sources of truth for one thing.
 *
 * No coverage cell here is `held-elsewhere`, and that is the criterion applied rather than skipped. The
 * sibling Notion atlas DOES use that state, and the difference between the two is worth stating because a
 * reader will otherwise take this one for an omission: a Notion page is both a SURFACE and an ENTITY, so
 * that atlas must declare the kind in order to map it and then say the contents live elsewhere. GitHub's
 * entities are not surfaces — a pull request is not a page this atlas maps, it is a record the corpus holds
 * — so there is no kind here to mark. What the corpus holds is named in `excludes` instead, which is where a
 * reader looks for what an atlas deliberately does not hold.
 *
 * ## Both API surfaces are `filled`; the browser surface says exactly what it is
 *
 * Claim 7 — the browser is the FALLBACK, not the first reach — is why the browser half here carries the
 * admin PAGES and not a second copy of anything the API answers: a settings page is not API-reachable, and
 * an endpoint the walk observed that the API also serves is a corroboration record rather than a second
 * fetch path to maintain.
 *
 * `rest-openapi` is compiled from GitHub's own published description with no network call — 1,114 declared
 * routes, measured against the description shipping with this build (reproduce by running the
 * `rest-operation` projection over `@octokit/openapi-types`). `rest-live` is the scoped token reading what
 * each setting is set to. `github-web` is the owner's real Chrome, walked through the Playwright relay,
 * photographing each admin page and recording what GitHub's own client asked for while it rendered.
 *
 * A FOURTH surface, `graphql-schema`, is declared and NOT filled. That is a state this atlas says about
 * itself rather than a silence: GitHub's GraphQL API is a second reachable surface with its own fields, and
 * an atlas that simply did not mention it would let a reader take the REST half for the whole API.
 *
 * ## The claim the browser half deliberately does not make
 *
 * CrowdStrike's walk is judged against Falcon's own published sitemap, so "pages landed of pages published" is a
 * ratio a reader can check. **GitHub publishes no authenticated settings sitemap.** Searched across its REST
 * description, its GraphQL schema documentation and its API root; none was found, and that is a scoped
 * negative finding rather than proof none exists. So this walk is judged against the navigation GitHub
 * RENDERED to this principal at this moment — a frontier, not a manifest — and the atlas says so every
 * generation through a permanently open `browser-denominator-unproven` gap.
 *
 * `filled` therefore means POPULATED, never that every reachable admin page was found. Those are different
 * claims and conflating them is how a walk reports coverage it never earned.
 *
 * ## `visibilityScope` is a claim boundary, not a disclaimer
 *
 * It states what "complete" can ever mean for this credential. Two things bound it permanently. GitHub
 * answers 403 for an unpermissioned token, an unaccepted SSO authorisation, a non-owner role and a feature
 * the plan does not include — so what this atlas holds is what THIS principal may see, and a setting it
 * could not read is recorded as unreadable rather than absent. And the browser half sees exactly what the
 * owner's own signed-in session sees, which is the same bound arrived at a second way.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { GITHUB_KINDS, GITHUB_PLATFORM } from "./model.js";

/** What "complete" can ever mean for this account's access. */
export const GITHUB_VISIBILITY_SCOPE =
  "the organisations and repositories one GitHub token can reach, bounded by that token's own permissions, its SSO authorisation and the account's plan, plus the settings pages the owner's own signed-in Chrome session can open";

/** GitHub's atlas, as it declares itself. */
export const GITHUB_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "read-before-write",
  excludes: [
    {
      because:
        "every entity the corpus already holds — pull requests, issues, discussions, releases, reviews, review threads, comments, commits, workflow runs, deployments, audit events and webhook deliveries. This atlas maps the PLACE those live in and never copies them; `src/corpus/github` is the only writer of that half, and duplicating it would give one fact two sources of truth",
      ground: "held-elsewhere",
      holder: "`src/corpus/github`, the only writer of that half of the world model",
    },
    {
      because:
        "organisation members, teams and repositories as objects. They are corpus entities, and a setting that refers to one — a ruleset's bypass actor, an environment's reviewer, an app installation's repository selection — stores only its opaque provider id. A repository's own configuration — its settings document, description, topics and the label SET its issues and pull requests draw from — is held here, because that is what a reproduction of the repository is given; which label sits on which issue stays the corpus's",
      ground: "held-elsewhere",
      holder: "`src/corpus/github`, which holds members, teams and repositories as corpus entities",
    },
    {
      because:
        "the VALUE of any secret or variable, at organisation, repository or environment scope. Neither schema has a field one could be written into, which is a stronger statement than a redaction pass: GitHub never returns a secret's value, and a variable's value is dropped at the projection because a variable is routinely where an operator puts what a secret felt heavy for",
      ground: "secret-material",
    },
    {
      because:
        "every token, key and signature — personal access tokens, OAuth tokens, app installation tokens, app private keys, client secrets, webhook signing secrets, the Playwright extension consent token, and the browser session's own cookies and storage. A webhook's destination is reduced to an origin and a path SHAPE before storage, because a webhook URL routinely carries its own credential in its path",
      ground: "secret-material",
    },
    {
      because:
        "code-scanning alerts, Dependabot alerts and security advisories. Whether scanning is ON is a settings fact this atlas holds; a finding is an entity and is not this atlas's question",
      ground: "not-fetched",
      wouldBeClosedBy:
        "a kind that HOLDS them, which is a different act from reading them. MEASURED against `lachiejames/slopweaver`: `slopweaver github alert list --repo <r>` returns code-scanning alerts and `slopweaver github vuln list --repo <r>` returns Dependabot alerts, so this installation REACHES both families through the door already — it stores neither, and reachability is a separate fact from holding",
    },
    {
      because:
        "private repository contents of every kind — files, diffs, patches, commit bodies, workflow definitions, CODEOWNERS, Actions logs and artifacts, and Pages output",
      ground: "payload-not-map",
    },
    {
      because:
        "response VALUES from GitHub's own web client. What is stored is the method, the path shape, the parameter names and the response field NAMES a call carried — enough to say what the client asks for, never a copy of what it was told",
      ground: "names-not-values",
    },
    {
      because:
        "every write operation on both surfaces. The REST operations GitHub declares as mutating are ENUMERATED — an atlas must know a write exists — and none is ever invoked, and the browser walk navigates without clicking anything at all",
      ground: "never-acted",
    },
    {
      because:
        "the CONTENTS of anything GitHub's GraphQL API returns. The schema itself is declared as a surface below rather than excluded — see `graphql-schema`'s `unfilledBecause` — because it is a real second API with its own reachable fields, and an atlas that silently omitted it would claim a completeness it has not earned",
      ground: "held-elsewhere",
      holder: "`src/corpus/github` for the entities, and this atlas's own `graphql-schema` surface for the schema",
    },
  ],
  kinds: [...GITHUB_KINDS],
  platform: GITHUB_PLATFORM,
  question:
    "what can be asked of GitHub, what every organisation and repository setting is currently set to, what can reach the code that is not a person, and which admin page a human opens to see each of those",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas github sync",
  surfaces: [
    {
      denominator: {
        because:
          "GitHub publishes no catalogue of its `rest-openapi` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "rest-openapi",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "GitHub publishes no catalogue of its `rest-live` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "rest-live",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "GitHub publishes no catalogue of its `graphql-schema` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "graphql-schema",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "GitHub publishes its GraphQL schema for download and also answers introspection, so this surface is acquirable and simply has not been acquired by this build. It is declared rather than omitted because the kit's own rule is that an unfilled surface must be a thing the atlas SAYS about itself: leaving it out would let a reader take the REST surfaces for the whole API. Tracked as the `graphql-surface-unfilled` gap",
    },
    {
      denominator: {
        because:
          "GitHub publishes no catalogue of its `github-web` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "github-web",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope: GITHUB_VISIBILITY_SCOPE,
};
