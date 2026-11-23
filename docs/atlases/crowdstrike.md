# The CrowdStrike atlas changes nothing, as a property of the CREDENTIAL rather than of the code

Part of [Atlases](../atlases.md).

Falcon grants an API client **Read and Write per API, independently**, so the one this installation holds
carries Read on every grantable scope and Write on none. That is stronger than any allowlist a reviewer has
to trust: a bug in this repository cannot write to the tenant, because the token it holds is not permitted
to. Read-only is then carried a second and third time anyway, so no single mistake defeats all of them:

1. **A closed call inventory** (`atlas/crowdstrike/inventory.ts`) — a caller names a CALL ID and the URL is
   built from the table, so there is no argument that reaches an endpoint the table does not list. Every
   admitted row carries its own `whyRead` justification, which a reviewer checks against the table.
2. **A field allowlist** (`atlas/crowdstrike/privacy.ts` + `projection.ts`) — every provider field is read
   through one accessor that consults the denial list first, so a field CrowdStrike adds next month is not
   stored because nobody excluded it.
3. **Strict schemas** (`atlas/crowdstrike/entities.ts`) — anything that got past both fails to parse, and the
   kind file is a discriminated union, so a detection cannot be written into `hosts.jsonl`.

**The HTTP verb decides nothing here**, and a review property that said "only GET" would be false: Falcon
reads batches of entities by POSTing their ids, and `POST /devices/combined/devices/login-history/v1`
returns login history and changes nothing. Read-only is decided by the endpoint allowlist and the
credential's scopes.

**Both surfaces are filled.** The API surface is the scoped OAuth2 client; the browser surface is the
console walked in the owner's own Chrome through the Playwright Extension relay `playwright-core` already
ships ([browser-route](../browser-route/target-proof-and-playwright.md#playwright-is-the-transport-and-it-reaches-the-owners-real-chrome)) — nothing launches a browser, supplies a user-data directory, or
opens a second profile ([the rule](../browser-route.md#the-rule)). The walk's denominator is the console's own published sitemap rather than a page
list written here, so a declared page the walk could not reach is a gap the atlas can NAME.

**What it deliberately does not hold:** every write operation on both surfaces; NGSIEM log data wholesale;
the bearer the console holds in memory for its own `/api2` surface; response VALUES from console traffic —
what is stored is the method, the path shape and the field NAMES a response carried; and the command lines,
file paths and network locators that detections and host records also carry.
