# The Microsoft 365 / Entra atlas maps the largest surface here, and has read no tenant

Part of [Atlases](../atlases.md).

Nothing else in this installation holds the directory this organisation actually runs on, so by
[atlas-intent.md](../atlas-intent/06-holdings.md) §6's own test this atlas holds **everything reachable for identity and
configuration, entities included** — the opposite disposition to Slack's and Notion's. Two facts about it are
easy to read backwards, so both are stated rather than implied.

**It is the largest of the seventeen, and the number is measured rather than asserted.** MEASURED
against the pinned commit (reproduce with `slopweaver atlas microsoft365 sync --json`): **11,493 paths,
17,777 operations, 9,378 of them `GET`, over 70 resource roots and 5,127 component schemas.** Of those,
7,069 are reachable configuration, 2,397 are voluminous, and 8,311 are mutations this atlas will never call
and still records — a map that omitted the writes would answer "Graph offers no way to do that", which is
false. The published generation is about 77 MB under `$SLOPWEAVER_HOME`.

**Its live surface is empty, and that is the whole distance between this and the atlas the platform deserves.**
There is no Entra application registration on this installation, so `graph-api` is `declared-unfilled`, every
kind carries a `not-configured` cell for it, and a permanent `graph-credential-absent` gap says so per kind.
The filled surface is `compiled`: a public specification, pinned to an immutable `msgraph-metadata` commit and
digest-verified before it is parsed. **Reading a compiled operation as a capability is the single most
available mistake with this atlas** — the specification declaring an endpoint says nothing whatever about
whether this tenant's credential may call it, which is why the two are different CHANNELS with different
visibility ceilings rather than one surface.

**The voluminous disposition is applied per OPERATION, and it cuts through a family rather than along it.**
`src/atlas/microsoft365/dispositions.ts` is the reviewed rule set and every row carries the rule that decided
it, so a surprising classification traces to one line. The pairs that make the criterion concrete:
`GET /auditLogs/signIns` is voluminous while `GET /auditLogs/signIns/$count` is kept, because a count IS the
enumeration; `GET /users/{user-id}/messages` is voluminous while `GET /users/{user-id}/mailFolders` is the
folder list a person authored; `GET /security/secureScores` is a daily series while
`GET /security/secureScoreControlProfiles` is the catalogue it scores. A rule stated as a list of product
areas expresses none of those, and a sync raises a `disposition-rule-never-fired` gap for any reviewed rule
that matched nothing — a dead rule reads as considered judgement and is not one.

**74 admin-console pages across seven consoles are DECLARED and none has been visited.** The list never
shrinks (the owner's ruling): an unreachable route becomes a gap against the page, never a deletion from
`browserPages.ts`. Two things a walk will have to handle are written down before they are discovered — the
Entra, Intune and Microsoft 365 consoles route in the URL FRAGMENT, so HTTP status cannot grade reachability
there at all (the shape that made the first Notion walk report twenty-one reached pages that were all one
not-found shell), and the SharePoint console's origin embeds the organisation's own name, so its three pages
resolve their root at run time and the name is written nowhere in this repository.
