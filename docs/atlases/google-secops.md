# The Google SecOps atlas reads one Chronicle instance, and nothing it holds can write

Part of [Atlases](../atlases.md).

It answers what the Google Security Operations instance is configured to do — which detection rules exist,
which feeds ingest what, which data tables, reference lists, watchlists and dashboards stand behind them —
so a vulnerability or detection question can name the rule rather than guess at one. It is READ-ONLY for
good: the owner ruled that nothing here ever writes to SecOps, neither through the API nor through the
browser. That ruling is held by three things a change would have to break, not by intent.

**The scope cannot approve a write.** The door asks for `chronicle.readonly` and `userinfo.email`, and
nothing else, through a THIRD Desktop-app OAuth client of its own (`google-secops-client-id`). Google
merges granted scopes over the (client, account) pair, so sharing the user-data or Admin client would put
this grant's scope on a token that already holds others; `connect` refuses an id equal to either (owner
pick: least privilege on our own setup). `cloud-platform` is never requested — it would reach
the 18 GETs `chronicle.readonly` does not, and it would also reach every write.

**The transport sends only a GET, and only to the instance's own host.** `src/live/googleSecops/transport.ts`
types its method as `GET` alone, builds every URL as `https://<location>-chronicle.googleapis.com/v1/<instance>/…`
from the instance resource name in `google-secops-instance`, and refuses a dot segment, an encoded one, an
empty segment, an absolute or protocol-relative path, any API version but `v1` and any query key but
`pageSize`/`pageToken` before a request exists. An instance custom method (`:listAll…`) must resolve to
the instance itself plus that one suffix, never a path below it.
`readOnlyRail.test.ts` scans every file in the door for a non-GET method and for any other origin.

**The inventory says what is never called.** The v1 surface is pinned at the googleapis
commit `generated/protoLock.ts` records: 92 methods, 39 GETs. Of those, 21 accept
`chronicle.readonly` and 18 only `cloud-platform` — `ListRules`, `GetInstance`, the reference lists,
data-access labels and scopes, and watchlists among them, so those kinds stay permission-blocked under
this grant rather than being read under a wider one. The 48 mutating methods and the 5 POST-shaped
queries are excluded by the descriptor and never called. Reproduce the pin:

```bash
yarn tsx tools/generateGoogleSecopsSurfaces.ts --fetch /tmp/google-secops-specs
```

**Two values are names, never stored.** A reference list's or data table's ENTRIES and a feed's
credentials are excluded: the entries are the organisation's own allow and block lists, and a feed's
secret material is a credential of another system.

## Connecting

The client pair and the instance are three entries in `$SLOPWEAVER_HOME/secrets/`, then one consent:

```bash
slopweaver secrets set google-secops-client-id
slopweaver secrets set google-secops-client-secret
slopweaver secrets set google-secops-instance
slopweaver atlas google-secops connect
slopweaver atlas google-secops connect --status
```

`--status` prints the granted scopes from the grant on disk, and when the refresh token lapses if the OAuth
client's consent screen is in Testing; `--revoke` withdraws the grant at Google
and deletes the file. Which Chronicle IAM role the consenting account holds decides what the readonly
scope actually returns; a list it refuses answers 403, and the fill records that as a permission boundary.

## Filling

```bash
slopweaver atlas google-secops fill
slopweaver atlas google-secops coverage
```

`fill` calls six lists under the grant — data tables, native and featured dashboards, feeds, findings
refinements and their deployments — page by page to a bound of ten, and publishes one generation. The
other fifteen readonly GETs are left uncalled, each with its reason in `src/atlas/googleSecops/fill/plan.ts`:
a Get the list already covers, a data table's rows, Google's ingestion catalogue, and rule execution
errors, which would read as the rule inventory this grant cannot list. So the surface counts 6 of 39 reached.

Every response passes a strict boundary per endpoint built from the pinned protos, so a field Google adds
or renames fails that list by name instead of reading as success. What is kept is an allowlist per family,
never the item: a feed keeps its state, log type, source type and the NAME of its settings field — never
the settings, which is where several V2 source types keep a readable secret — a data table its column
names, size and rule count, and a dashboard its name and type, never its charts or queries.

A list that answers 403 stamps its kind `permissionBlocked` naming the IAM role that would open it. The
five kinds every GET of which needs `cloud-platform` — instance, reference lists, watchlists, data access
and rules — are published `permissionBlocked` without a call. Any other failure leaves the kind
unacquired, and the kit refuses to publish a never-read empty kind beside real ones.

MEASURED on the first fill: several lists answered — native dashboards, findings
refinements and their deployments, while data tables were empty — and permission refusals (403) showed both
whole-kind and partial-kind blocking: `ListFeeds` names `chronicle.feeds.list`, and
`ListFeaturedContentNativeDashboards` is refused too. So `feed` is dark for
the required IAM role and `dashboard` is only partly read; re-run `fill` once the role carries those permissions.
