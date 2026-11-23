# 4 · Corroboration between the two surfaces is itself an output

Part of [What an atlas must be](../atlas-intent.md).

Not a build-time check that gets discarded. A thing the atlas shows: **the corroboration between API and
browser**, which helped a lot on the first atlas. Hit every endpoint that can be hit to collect data and
map the site, **then corroborate it against what the browser can reach** — drive a browser through the
platform, screenshot every page, and check that against what the API shows. Corroborating across the two
is also how endpoints nobody knew existed get discovered.

**What a disagreement MEANS is the owner's call, and the owner has reserved it until they can see real
ones** (the owner's ruling). The owner wants the instances first — why two surfaces disagree, case by case —
because a disagreement may be evidence the atlas is built wrong rather than evidence the platform is
inconsistent. So the first two-surface atlas owes the owner one card of real, collected instances before anything picks a
winner between the surfaces. Both records are kept regardless: one surface succeeding must never erase
what the other already knew.

**Browser channels are filled, so the card is assemblable.** The Slack atlas (`slopweaver atlas
slack-drive`) briefs a walk of every mapped page in the owner's own Chrome and publishes a generation carrying both
surfaces, and the CrowdStrike, Vanta, Notion, Trelica, Linear, Xero, Clerk and Knock atlases fill a browser
channel of their own. An atlas that does not reports `channels.browser: null` on every entity, a state
it SAYS rather than a silence — ask `slopweaver atlas <platform> coverage` which is which rather
than this paragraph, because a list of names here is the part that goes stale. The first real disagreements
are 40 methods the first-party web client calls that the installed SDK does not declare, plus one method
sent a parameter and two returned response fields the SDK does not declare — read the current list with
`slopweaver atlas slack-drive report`. Linear's own first walk added five root fields its web client selects
that the published GraphQL schema does not declare at all (`slopweaver atlas linear report`).

**The Knock atlas is the sharpest instance of §2, and it is worth naming because it is a THIRD of a
platform's product pages rather than a field or an endpoint.** MEASURED against the dashboard's
own published route table: 19 of the 57 account- and environment-scoped pages a walk visits display
something no operation in EITHER of Knock's two published OpenAPI documents reads. They are not marginal —
the Agents workspace is the first item in the product's own navigation and appears in neither document at
all, and the audit log, the API keys page and the service tokens page are the three surfaces a compliance
question reaches for first. Read the list with `slopweaver atlas knock report`. The bootstrap consequence is
the one worth carrying to the next platform: **the credential that would fill that atlas's API channel can
be obtained through the browser and nowhere else**, because no operation on either API reads a key or a
token. An API-only atlas there cannot even acquire the means to be an API-only atlas.

**The Clerk atlas is the sharpest instance of a whole API rather than a field.** The dashboard talks to `dapi.clerk.com`, which appears in none of the four
documents Clerk publishes; ten of its operations were catalogued on the first pass, alongside six more
first-party calls on other Clerk hosts (`slopweaver atlas clerk report`). An API-only atlas here would have
answered "Clerk offers no way to read that" about a surface the owner's own browser calls whenever the owner
opens the page.

**A disagreement detector parses the client's REQUEST, never the response's keys.** Reading a
GraphQL response's own top-level keys as schema field names is unsound, because a key is the document's
ALIAS — `query { latest: issues { … } }` answers under `data.latest`, which no schema declares. A comparator
built that way manufactures disagreements, which in an instrument whose whole purpose is finding real ones
is worse than having none. The Linear atlas therefore captures the client's REQUEST document and parses it,
at every nesting depth; a request carrying no document is counted and never attributed.

**Three of its first seven "disagreements" were the comparison rather than the platform**, and that is the
transferable lesson rather than the alias mechanics. Two surfaces describe the same field in
their own idiom: the schema knows a field's TYPE and never how many of it a response held, so `nodes.key`
and `nodes[].key` are one field seen twice; and a schema catalogue resolved one level deep cannot speak to a
path three levels down, so calling such a path undeclared says "the schema does not declare this" when the
truth is "this comparison cannot see that far". Any future atlas comparing two surfaces owes the same two
questions: is the thing being matched on the provider's own key rather than an artefact of how one surface
phrased its question, and are both sides describing the same depth?

**The Slack atlas holds no usergroup, person or channel, and is the clearest worked example of the rule
above.** The owner's ruling: the Slack atlas holds the surface map for Slack, because something better suited
already holds all the entities. Slack is the platform where the split falls, because the corpus already holds its channels,
people, usergroups and messages — so the Slack atlas maps the INTERFACE, and an entity kind in it would be
a second, competing copy of something already held better.

The unresolvable-usergroup defect behind the question is fixed on the source the owner named, the corpus. MEASURED:
the complete workspace usergroup population was already in `corpus/structures/slack.jsonl`, and **none of it
resolvable** — every bare `<!subteam^S…>` rendered as the generic `@group`. Nothing was missing from the
store. Nothing READ it, and fetching them a third time into an atlas would have changed nothing at all.

**The lesson, stated so the next atlas does not repeat it: "the atlas does not hold X" and "nothing can
answer X" are different sentences, and reaching for the atlas is the wrong reflex when the second one is
what is true.** The read path is what to check first.

Two cautions belong with the Slack walk's 40 undeclared methods. **The walk covers ONE navigation surface,
not nine**, because the other eight routes redirect on an Enterprise Grid workspace and are recorded as gaps
rather than as reached pages. And a browser-only method is a lead rather than a capability: it says Slack
HOLDS the data, never that an ordinary token can ask for it. Read each atlas's channel state with
`slopweaver atlas <platform> coverage`.
