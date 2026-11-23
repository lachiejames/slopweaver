# 3 · Outbound — what can post, and under which token

Part of [Architecture](../architecture.md).

The typed form, the above-the-fold gate before the door, the voice gate the Slack prose lanes pass at the
door, and the three things the door can answer. The door is drawn at its weakest on purpose: for the Linear,
GitHub and Notion writes drawn, routed means recorded, not content-checked at the door; their checks run before it,
and the outbound privacy check and the dead-host refusal run at each one's write transport after it. A Gmail write
(`gmail draft`, `send`, `label`, `unsubscribe`, not drawn) runs the same two in the Gmail auth client's `fetch`,
strict, a send judged on the draft Gmail holds ([write transports](../security/write-transports.md)).

```mermaid
flowchart TB
  form["A visible session composes a TYPED FORM.<br/>Nobody hand-writes Block Kit<br/>src/outbound/artifact/schema.ts"]
  strict{"An undeclared key,<br/>or a field over its cap?<br/>src/outbound/strictForm.ts"}
  refuse["REFUSED, naming the field. Never<br/>silently dropped or truncated"]

  form --> strict
  strict -->|"yes"| refuse
  strict -->|"no"| lane{"Which lane?"}

  subgraph slack["SLACK — pick a lane, then a guard"]
    direction TB
    card["AS THE BOT — a card<br/>slack-bot-token"]
    park["An as-me draft, PARKED, nothing posted<br/>slopweaver slack draft record<br/>a draft that asks declares --asked-before;<br/>an answered one parks only with proof;<br/>every draft brings receipts or says why not<br/>src/outbound/slack/priorAsk.ts<br/>src/outbound/slack/draftReceipts.ts"]
    drip["AS THE OWNER — a drip in the owner's name<br/>slack-user-token"]
    mutate{"An edit or delete — did slopweaver<br/>post it? Answered by read-back<br/>src/outbound/slack/lifecycleGuards.ts"}
    notours["REFUSED. Only ever its own messages"]

    park -->|"released by slopweaver slack post,<br/>only when --approve is its digest and<br/>a re-asked question gained no answer since"| drip
    mutate -->|"not ours"| notours
  end

  other["Same door, same shape, for the rest:<br/>slopweaver linear issue · slopweaver github pr<br/>slopweaver notion page"]
  fold{"Above the fold: packing and exact voice<br/>rules on bot cards, PR descriptions and<br/>comments, Linear issues, comments and<br/>updates, Notion page leads<br/>src/cli/aboveFoldDoor.ts"}
  foldno["REFUSED before the door,<br/>naming the rule"]

  lane --> card
  lane --> park
  lane --> drip
  lane --> mutate
  lane --> other
  card --> fold
  other --> fold
  fold -->|"an unoverridden match"| foldno

  door["THE ADMIT DOOR — one gated pathway<br/>for every side effect<br/>src/admit/door.ts"]
  fold -->|"clean or overridden"| door
  drip --> door
  mutate -->|"ours"| door

  gates["The gates this caller passed. DEFAULT_GATES is EMPTY;<br/>the Slack lanes drawn add the voice gate, while the<br/>Linear, GitHub and Notion writes drawn add none —<br/>there routed means RECORDED, not content-checked.<br/>A request declaring requiresApproval with no<br/>approval gate in the list is HELD"]
  voice["Exact voice rules for the lane's actor,<br/>over the authored prose only<br/>src/admit/voiceProfileGate.ts"]
  resv["A reservation under a per-key lock<br/>makes the duplicate check atomic<br/>src/outbound/slack/sendReservation.ts"]
  led[("The ledger records the decision<br/>BEFORE the effect runs<br/>src/admit/ledger.ts")]
  verdict{"pass / warn / hold"}
  warn["WARN — nothing sent. A self-correctable<br/>finding carrying an override token"]
  hold["HOLD — the irreversible-harm class.<br/>No token waives it"]
  render["Rendered for its surface; a Slack card's<br/>authored text is rich_text, not mrkdwn<br/>src/outbound/slack/render.ts"]
  wire{"At the transport: raw markup the Slack<br/>wire guard scans for, or a dead Datadog<br/>host with no hatch open?<br/>src/outbound/slack/typedRunsOnly.ts<br/>src/outbound/invalidDatadogHost.ts"}
  wired["REFUSED — the call that would<br/>carry it is never made"]
  sent["SENT — the effect runs only on pass<br/>src/admit/effects.ts"]
  ratchet["slopweaver dev door-coverage fails the build<br/>on any seam that escapes<br/>src/admit/coverage.ts"]

  door --> gates --> verdict
  door --> led
  foldno -.->|"a live refusal appends a<br/>refused row, best effort"| led
  gates --- resv
  gates --- voice
  voice -.->|"an unoverridden match"| warn
  verdict -->|"warn"| warn
  verdict -->|"hold"| hold
  verdict -->|"pass"| render --> wire
  wire -->|"yes"| wired
  wire -->|"no"| sent
  ratchet -.->|"nothing escapes"| door
```
