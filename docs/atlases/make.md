# The Make atlas reads every scenario, and nothing it holds can change or run one

Part of [Atlases](../atlases.md).

Make (make.com) is where some of the organisation's automations live, and two of them are why this atlas
exists: whatever links Vanta and KnowBe4, and the IT offboarding automation. Neither can be found from
Slack or GitHub. So the atlas holds **every entity the owner's token can read**: the organisation, its
teams and folders, every scenario with its schedule, the connections and webhooks those scenarios run on,
and each scenario's newest 20 runs.

**Read-only is a property of the client, not a promise in the docs.** `src/atlas/make/client.ts` subclasses
the official `@makehq/sdk` and overrides the one `fetch` every endpoint calls. The override refuses before a
request is built in three cases: any method but GET, any URL that is not a path on the configured zone, and
any protocol but https. `client.test.ts` calls the SDK's real `scenarios.run`, `scenarios.create` and
`connections.delete` and watches each one refused. `readOnlyRail.test.ts` fails if any other file under
`src/` imports the SDK, so there is no second, unrailed client.

**Its denominator is Make's own census.** The pinned SDK ships `MakeTools`: 203 tools, 92 annotated
`readOnlyHint`. `exists` is 92 and `reached` is the 8 the fill calls. `descriptor.test.ts` recomputes both
from the installed package. One caveat: 1.6.20 marks `functions_check` read-only while scoping it
`functions:write`. So 92 is Make's annotation, not an audit of 92 GETs.

**The scenario table is the page.** `slopweaver atlas make render` draws a "Scenarios" table under "From the
platform", with one row per scenario:

- **What it does:** the scenario's own description, then the apps its modules call in flow order.
- **Schedule and state:** when it runs, and whether it is on.
- **Provenance:** who created it, who last edited it, and its team.
- **Newest run:** how the latest kept run ended.

The asked-for "who owns it" is not a column, because **Make records no owner**. It records a creator, a last
editor and a team, and the table says so above its rows rather than relabelling provenance as ownership.

**The credential is the owner's, minted by hand.** The fill reads two `0600` files under
`$SLOPWEAVER_HOME/secrets/`:

- `make-api-token`: minted in Make via avatar → Profile → API → Add token, with exactly
  `organizations:read`, `teams:read`, `scenarios:read`, `connections:read` and `hooks:read` ticked.
- `make-zone`: the host in the Make URL, held to the six zones Make publishes.

With either file absent, `atlas make fill` exits 3 and prints those steps. It never mints a token.

**What it deliberately does not hold:**

- Every mutation and every run.
- A blueprint's module configuration: mapper, parameters, metadata and filters. Only the order of module
  identifiers is kept.
- An execution's detail or outputs.
- A connection's metadata and uid.
- A hook's URL, which is the capability to start its scenario.
- Private per-user spaces, which `teams.list` is not asked for.

**The allowlist bounds the store, and redaction bounds what a kept string can carry.** `store.ts` refuses
to write or serve a kind file whose detail holds any field its kind's schema does not keep, so a file
edited on disk is refused, not printed. A kept string is as a Make user typed it, so the token is stripped
from every one (`redact.ts`): the token a fill ran with as it reads, and the token configured now as the
store is written and read. A zone error never echoes what the zone file held.

The kept fields are validated per kind (`details.ts`), not yet held to a strict all-keys boundary. Make's
real shapes need a live answer to pin. That is the open `strict-response-boundaries-not-live-calibrated` gap on the organisation, and
the first live fill closes it.
