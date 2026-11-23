# The Nx Cloud atlas holds everything reachable, and DECLARES the run history it does not hold

Part of [Atlases](../atlases.md).

Nothing better suited holds this platform's entities, so [atlas-intent.md](../atlas-intent/06-holdings.md) §6's test comes
out the other way from Slack's and Notion's: the organisation, every workspace under it, the reachable route
surface and the HTTP surface all live here. What does NOT live here is a row per pipeline execution, run or
task — those are time-series observations, and §6's one bound is that such a family is enumerated and
declared rather than stored whole. The `family` kind is that sentence as data: each one carries the endpoint
that serves it, the response field NAMES one bounded call returned, and how many records that call saw.

**What a first run measured, and it is not what anyone expected.** Reproduce with
`slopweaver atlas nx-cloud refresh` and `… report`:

- **An account can read a workspace and list ZERO organisations.** Nx Cloud builds `/orgs` from the VCS
  accounts a profile has linked rather than from membership, so an atlas that discovered its scope from that
  list alone would report a fully reachable workspace as none at all. It is raised as a gap by name
  (`roster-omits-reachable-workspace`), and it is why `sync` takes `--org`/`--workspace` once and reads the
  pair back out of the generation afterwards.
- **There is no REST API this installation can reach.** `/api/v1/…` answers 404. What answers is the
  first-party web client's own transport — React Router loader routes under `<path>.data`, encoded as a
  turbo-stream rather than as JSON. §2's ruling settles that this is a usable source: reach is judged
  by whether a call returns. The documented API wants a personal access token or the workspace CI token, and
  the atlas declares that surface `declared-unfilled` rather than leaving a reader to infer there is none.
- **The run list arrives DEFERRED.** One page of it carried 20 runs and 490 tasks inline, and a reader that
  did not await the promise would have recorded the family as empty — a confident wrong answer with no
  witness. `dataRoute.ts` resolves deferred values before anything is measured.
- **The page denominator is the client's OWN route table, not a list written here.** Nx Cloud uses lazy route
  discovery, so `window.__reactRouterManifest` holds only what has been matched — but the client fetches
  `/__manifest` on every navigation, and the walk reads those responses out of the capture it already has. A
  walk of 20 declared routes learned 40 routes the client declares; the 13 it did not open are held as
  entities that say so and carry no screenshot.
- **Two pages this account cannot see are DECLARED rather than absent.** The workspace settings page answers
  403 and the organisation settings path 404. Unlike the single-page apps the sibling walks fight with,
  Nx Cloud returns real HTTP statuses, so reachability is graded on the status rather than on a page title.

**The corroboration is real, which took one fix to the shared browser transport.** The capture hook kept only
`application/json` bodies, so every `.data` call — the platform's entire data transport — was dropped, and a
walk of twenty pages contributed exactly two operations. With `text/x-script` eligible and decoded by the
walk, the same walk found two operations the direct read never knew existed (`achievements.data` and
`workspace-spec-markers.data`) and one endpoint where the two surfaces genuinely disagree about response
fields. `slopweaver atlas nx-cloud report` prints the instances and resolves none of them, which is the
ruling.

**Its credential is the owner's own browser session and nothing else** — read from the owner's Chrome cookie jar per
sync, never stored, never printed. Three mechanisms keep the generation clean of what those payloads also
carry (a Rollbar token, a PostHog key, an Auth0 client id, an avatar URL, an email hash): a closed call
inventory with no method parameter at all, an allowlist projection that names every field kept, and a
pre-write sensitivity gate that REFUSES a whole generation rather than redacting one.
