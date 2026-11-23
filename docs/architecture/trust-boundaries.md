# 8 · Trust boundaries

Part of [Architecture](../architecture.md).

What lives on the machine, what comes in, and every egress named one by one — including the two OpenAI
boundaries, Codex and the console voice, that can carry your source code, and the two with no fixed
destination at all: what a Codex pass fetches, and what the voice's thinking model searches for.

```mermaid
flowchart TB
  subgraph inb["INBOUND — reads you authorise, over your own credentials"]
    direction TB
    src1["GitHub, Slack, Linear, Notion — and Gmail,<br/>Calendar and Fathom only when named.<br/>Windowed, and opt-in per source.<br/>ChatGPT: a downloaded export, no call"]
    src2["ONE outbound websocket — the only long-lived<br/>connection this machine's verbs hold, and with the<br/>console voice one of two ways something outside<br/>can start a turn. No port is opened"]
    src4["THE ATLASES — Vanta, Datadog, Hex, Cloudflare<br/>and the rest: what each platform holds, read<br/>over the credential it names — or none, for a<br/>public API reference<br/>src/atlas"]
  end

  subgraph machine["YOUR MACHINE — the world model lives under $SLOPWEAVER_HOME, and its backup uploads nothing"]
    direction TB
    corpus[("bronze, silver, gold, the local Postgres store,<br/>the door ledger, the run journals,<br/>the held-reply queue, the atlases<br/>src/stateHome.ts")]
    bak["THE STORE BACKUP uploads nothing — corpus files,<br/>a store dump and your secrets, each encrypted, into<br/>directories you name: a folder on this machine, a<br/>pinned external drive. A cloud address is refused; a<br/>folder something else carries off — a network<br/>share, a synced cloud folder — takes the copy with<br/>it, and nothing checks for one<br/>slopweaver store backup · src/store/backup"]
    pg["Search runs IN YOUR POSTGRES — tsvector and\ntrigram, no key, no data leaving<br/>src/store"]
    sec["Tokens at 0600, from a no-echo prompt,<br/>never through argv, never committed<br/>src/secrets"]
    hyg["A hygiene gate fails the build on SECRET<br/>classes, and on forbidden identifiers at<br/>refuse; local secret literals live in an uncommitted denylist<br/>src/hygiene"]
  end

  gap["WHAT NONE OF THIS BUYS YOU: the door proves a<br/>write was routed and RECORDED, and checks only<br/>what that lane adds to an EMPTY default list —<br/>voice and duplicate checks on Slack, an approval<br/>hold on mail, invites and Vanta, mostly nothing<br/>elsewhere<br/>src/admit/door.ts"]

  subgraph out["EGRESS — each one named, each explicit per invocation"]
    direction TB
    e1["THE VISIBLE AGENT SESSION you already<br/>have open. No separate key. Slopweaver's<br/>own model calls are the voice below and<br/>a one-token probe · slopweaver claude gauge"]
    e2["SLACK — a card under the bot token, or a<br/>drip under your own user token. It can only<br/>edit or delete what it posted"]
    e3["LINEAR, GITHUB, NOTION, GMAIL, CALENDAR writes,<br/>and Vanta, Datadog and Cloudflare Email Routing<br/>ones. A personal token means the provider<br/>attributes them to YOU, indistinguishable<br/>from your own"]
    e4["CODEX — your task, the repository reads it<br/>chooses, and the diff, to OpenAI. This is<br/>where source leaves<br/>slopweaver codex review · src/codex"]
    e5["WHATEVER A CODEX PASS FETCHES. Network and<br/>web search are on, so this and the voice's<br/>web search are the two egresses with<br/>no fixed destination"]
    e6["THE CONSOLE VOICE — your microphone, and what it<br/>reads to answer: code excerpts, board rows, the<br/>supervisor chat, a shared screen — to OpenAI,<br/>per session, straight from the browser, paid<br/>by the owner's ChatGPT plan through a codex app-server<br/>held for the call. Its<br/>thinking model searches the public web<br/>through OpenAI. It runs<br/>both ways: the model's relay call puts a row on<br/>the board and can type a line into the supervisor<br/>slopweaver talk offer · src/talk"]
  end

  bar["THE LINE THE CODEX PASSES CANNOT CROSS: the repository is<br/>neither their working directory nor a writable root. That<br/>sandbox protects your filesystem, and is documented as<br/>explicitly NOT protecting your privacy"]

  inb --> machine --> out
  machine --> gap
  out --> bar
```
