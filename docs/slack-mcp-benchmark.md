# Slack writes: this door versus the official Slack MCP server

The comparison the owner asked for alongside channel and canvas creation, written against the official Slack MCP as the `slack@claude-plugins-official` plugin **1.2.0** ships it — a REMOTE
server at `https://mcp.slack.com/mcp`, not an npm stdio one. No channel name, message, person or workspace
appears below.

**Read the sourcing caveat before the tables.** `docs/notion-mcp-benchmark.md` measured its side by starting
the real server and reading its own `tools/list`. That is not reproducible here and the difference is
stated rather than papered over:

- The Slack MCP is remote and OAuth-gated, so enumerating it means authenticating a client against the
  workspace — which is reaching a doored provider outside the door, and rule 3 refuses it.
- Every one of its write tools is in `permissions.deny` on this machine, so they cannot be called at all.

So the MCP column below is enumerated from two sources that CAN be read: the plugin's own shipped skill
files, and the owner's `permissions.deny` list, which names the write tools one at a time. Both are
evidence; neither is a live `tools/list`, and the byte-count row the Notion file carries is therefore
**absent here rather than estimated**. Reproduce what is reproducible:

```bash
# the MCP side, as shipped — names only
grep -rioh 'slack_[a-z_]*' ~/.claude/plugins/cache/claude-plugins-official/slack/1.2.0/
# this side
slopweaver catalog list --json | jq '[.[] | select(.noun=="slack")]'
for v in $(slopweaver catalog list --json | jq -r '.[]|select(.noun=="slack")|.verb'); do slopweaver slack "$v" --help; done | wc -c
```

## The surface

| Measure                                 | Slack MCP 1.2.0 (enumerated)    | `slopweaver slack` (measured) |
| --------------------------------------- | ------------------------------- | ----------------------------: |
| Tools / verbs named                     | 13                              |                            15 |
| Of those, ones that can WRITE           | 6                               |                             9 |
| Bytes of surface description            | not measurable here — see above |                    **17,360** |
| …and how much is loaded to do one thing | all of it, up front             |              one verb's usage |

The "all of it, up front" cell is a property of MCP rather than of this server: a tool list is loaded into
the model's context before the model has decided what it is doing. The Notion file measured what that costs
(76 KB against 5.5 KB). Here the shape is the same and the number is not in hand.

## Capability, act by act

| Act                            | Slack MCP tool                                                                                          | This door                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| post a message                 | `slack_send_message`                                                                                    | `slack post` / `slack reply`    |
| save a draft                   | `slack_send_message_draft`                                                                              | — (no draft verb)               |
| schedule a message             | `slack_schedule_message`                                                                                | — (no scheduled send)           |
| react                          | `slack_add_reaction`                                                                                    | `slack poll` seeds ballots      |
| create a canvas                | `slack_create_canvas`                                                                                   | `slack canvas create`           |
| update a canvas                | `slack_update_canvas`                                                                                   | `slack canvas replace`          |
| **create a channel**           | **no tool exists**                                                                                      | `slack channel create`          |
| **open a DM or group DM**      | **no tool exists**                                                                                      | `slack dm open`                 |
| **archive a channel**          | **no tool exists**                                                                                      | `slack channel archive`         |
| **invite people to a channel** | **no tool exists**                                                                                      | `slack channel create --invite` |
| **delete a canvas**            | **no tool exists**                                                                                      | `slack canvas delete`           |
| edit or delete a message       | no tool exists                                                                                          | `slack edit` / `slack delete`   |
| read a thread / channel        | `slack_read_thread`, `slack_read_channel`                                                               | `slack read-thread`             |
| search                         | `slack_search_public`, `slack_search_public_and_private`, `slack_search_channels`, `slack_search_users` | the corpus, plus `slack probe`  |
| read a file or canvas          | no tool exists                                                                                          | `slack read-file`               |

**Two of the three things the owner asked for have no MCP equivalent at all.** For channel creation and
group-DM opening the benchmark is a capability gap, not a comparison. **Where the MCP genuinely wins**:
`slack_send_message_draft` and `slack_schedule_message` have no counterpart here, and its four search tools
reach live Slack search directly where this door mostly answers from the corpus. State that rather than
claiming parity.

## Canvases: the one overlap, and what the door adds

Both surfaces reach `canvases.create` / `canvases.edit`. The difference is entirely what happens around the
call.

- **Refusals before the network.** An empty body, a blank title, a title past Slack's 255 and a
  same-destination repeat inside 24 hours are each refused BY NAME. Every one of those prevents a real
  artefact: Slack accepts a blank canvas and mints a blank document, which is what an unreadable
  `--markdown` path looks like from the outside.
- **A repeat is a SECOND document, and only one of the two surfaces knows it.** MEASURED against the live
  API: two `conversations.canvases.create` calls for one conversation answered `ok: true` with
  two different ids, both independently deletable. There is no
  per-conversation uniqueness to lean on. So the door's create is at-most-once at the transport AND gated by
  the duplicate-send reservation at the verb. An MCP tool's retry behaviour is not ours to know.
- **A dry run that states the disclosure.** `--dry-run` prints the endpoint, the body size and, for a
  channel canvas, `EVERYONE IN <channel> could read it the moment it exists`. There is no preview step in
  the MCP tool.
- **The ledger.** Every mutation is admitted by `throughDoor` and recorded with its lane, destination and
  the body's SIZE — never the prose. Six MCP write tools reachable directly from a model leave no such
  record, which is the reason rule 3 exists rather than a nice-to-have.

## Channels: what the door refuses that nothing else would

There is no MCP column here, so this is the door against a raw `conversations.create`:

- **A name Slack would silently rewrite is REFUSED**, with the canonical form named. Slack does not reject
  `Design Review` — it stores `design-review` — and a channel can never be deleted, only archived, with the
  name taken forever. A wrong name is a permanent artefact plus every downstream reference pointing at
  nothing.
- **Every invitee resolves before the channel exists.** One unresolvable key refuses the whole create.
- **A failed describe step is a PARTIAL SUCCESS, not a failure.** The channel is real by then; the verb says
  so, names what is unfinished, and does NOT retract it — retracting would be a second irreversible act
  taken on the operator's behalf.
- **`conversations.invite` reports a failure WITHOUT naming who.** MEASURED: with `force: true`, a bad id
  came back as `{"ok": false, "error": "org_user_not_in_team"}` — no `user` field, contrary to Slack's own
  reference. The outcome carries an `unattributed` arm and the report says "Slack refused N invite(s)
  without saying which person — open the channel and check" rather than claiming everybody landed.

## What this file does NOT claim

- **Not a live `tools/list`.** See the caveat at the top. The tool NAMES are enumerated from the shipped
  plugin and the owner's deny list; the count could be short if the server exposes a tool neither source
  names. Treat "no tool exists" as "no tool appears in either enumerated source", and re-run the
  reproduction if that matters to a decision.
- **Not a byte-count comparison.** The Notion file's 14× context figure has no counterpart here, because the
  MCP half cannot be enumerated without authenticating outside the door.
- **Not a latency benchmark.** Both reach the same rate-limited Slack Web API. The interesting figure is
  calls-per-act, and the sections above give it directly.
- **Not a claim that the MCP server is wrong.** It is a faithful transport of Slack's API and it reaches
  drafts, scheduling and live search that this door does not. The comparison is about where policy lives.
