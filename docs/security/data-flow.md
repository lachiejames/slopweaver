# Data flow

Part of [Security & trust](../security.md).

All world-model processing is local. Your world model — bronze, silver and gold on disk, and the Postgres
store they load into — lives on your machine, and nothing uploads it wholesale: `slopweaver store backup` writes the subset item 13
names, encrypted, into a local directory. There is no embedding cache and no model on the
machine: embeddings, pgvector and every locally-built index are banned, so
nothing downloads model weights. The list below names every kind of traffic that touches the network. The
per-provider detail is not restated here: `slopweaver secrets status --all` names every integration
credential `$SLOPWEAVER_HOME/secrets/` can hold — a Claude or Codex plan's login lives in that plan's own
home instead (item 3, [Credentials](credentials.md#credentials)) — and `slopweaver atlas` names every platform an atlas
reads: two indexes to read beside this list, neither of them the whole of it on its own.

1. **Source reads you authorise** — `refresh` calls the **GitHub, Slack, Linear and Notion** APIs, and the
   **Gmail, Google Calendar and Fathom** ones when you name them, to read the history you point it at, over
   your own credentials (see [Credentials](credentials.md#credentials)). These are reads. Each source is opt-in: bare
   `refresh` is GitHub-only, other sources need `--source <id>` or `--all-sources`, and `--all-sources`
   still leaves out Gmail, Calendar and Fathom, which each need their own `--source`. `--source chatgpt` calls
   nothing: it reads your downloaded [ChatGPT export](chatgpt-conversation-boundary.md) whole, unwindowed.

   **The read is windowed.** The default backfill is 90 days for Slack, Linear and Notion and 7 for GitHub,
   extended forward from a watermark on each run. So the corpus holds a rolling window of recent work, not
   your team's archive, and the sensitivity of what is on disk is bounded by the window you chose. Widening
   it is explicit — `--lookback-days`, `--since`, or `--all`, which additionally requires
   `--accept-full-history` in org mode.

   **One Slack read is NOT windowed, and it is narrow by construction instead.** `org-health read`, run by the
   supervisor's tick, reads the ONE incident channel the profile names (`orgHealth.incidentChannelId`) from its
   first message, because incident.io edits an announcement in place and a reopened incident can sit a month
   deep. It reads that channel's history plus the threads of open or week-old incidents, at most 3 pages and 10
   threads. It keeps only refs, titles, statuses and the latest update in the store's `org_health_incident` row,
   plus each incident's phase, severity and paging instant in `org_health_sighting` beside it, and writes nothing
   into the corpus ([org-health](../../skills/monitor/reference/org-health.md)).

   **The Linear read is the widest of the four, and it is worth stating rather than leaving for someone to
   discover.** It is one authorised read over one key, and within the window it takes in:

   - **archived work.** `includeArchived: true` goes everywhere the schema accepts it, so closed, cancelled
     and archived issues, projects, documents, cycles and workflow states are captured. On one control window
     78% of the issues were invisible without it. Archived work is still your org's work, and "archived" does
     not mean "not ingested".
   - **customer needs**, which carry verbatim CUSTOMER prose — not internal discussion about a customer, but
     what the customer said, and there are a lot of them in a real workspace.
   - **external users** — non-member commenters, WITH their email addresses, written to the member store so a
     customer contact can be joined to the comments they left.
   - **per-issue activity history** — who changed what, when, in the
     `$SLOPWEAVER_HOME/corpus/history/` store. This is an audit trail of your teammates' actions. It is
     event-logged rather than bitemporal: it records that a description was edited, never the old text.
   - **`Issue.branchName`**, which embeds a team key and a slugified title.

   All of it stays local, under `$SLOPWEAVER_HOME`, on the same terms as the rest of the corpus. The run
   output is correspondingly sensitive, which is why
   `refresh --numbers-only` exists: it withholds every identifying string from the progress stream and summary,
   leaving counts and shape, for a capture you intend to paste somewhere public. The committed hygiene gate
   scans tracked FILES; it cannot scan your terminal.

2. **Visible agent-session calls you already make** — `store read`, `distil` and `turn` never start a model themselves: no
   Slopweaver process may spawn one, and no subprocess transport exists. Each writes a
   **brief** — pinned evidence, rendered as a prompt — that you read and compose from inside the Claude Code or Codex
   session you already have open; the matching verb (`store collect`, `distil answer`, `turn answer`) then
   grounds and renders exactly what you wrote against the evidence it pinned. So this egress is nothing
   beyond the session you're already running: same account and the same data boundary you already accepted
   by using that host. No separate API key.
3. **A one-token probe of each Claude plan's budget** — the `slopweaver claude` verbs that route between
   plans (`claude gauge`, `claude route`, `claude watch`, `claude signin`, and `claude token` or `claude mint`
   when it stores a new token) and the plan pick inside `cmux spawn` read a plan's remaining budget from the rate-limit
   headers Anthropic attaches to any reply. The probe they send is the smallest real request there is
   (`src/claude/gaugeProbe.ts`): the prompt `hi`, one output token, to `api.anthropic.com`, over that plan's
   own credential — its Claude Code OAuth login or its setup token, and for `claude token` the candidate
   token before it is stored. It carries none of your data and holds no key of its own, and only the reply's
   status, headers and body `usage` token counters are read; the reply's content is discarded. The sign-ins themselves (`claude signin`, `claude mint`) go to Anthropic's own
   sign-in page carrying the plan's address as a pre-fill, the same `login_hint` `claude auth login --email`
   sends. `claude mint` reads the minted token off a screen log at `0600` in a `0700` directory under the home,
   deletes it when it finishes, and never prints it. `claude reset` and `claude spend` send the same probe to bind
   a sign-in to the plan, then account calls to `api.anthropic.com` over it: a read of its free resets, with
   `--claim` one POST naming the grant and a request id, and a read of its monthly spend, recorded locally. None
   carries your data; the plan's organisation id is in the claim's URL and never printed or journalled.
4. **Slack messages you send** — the `slack` verbs write to Slack: as a bot, or **as you**. See
   [The write path](slack-write-path.md#the-write-path-slack) below.
5. **Threads you read by link** — `slack read-thread <permalink>` calls `conversations.replies`, resolves any
   Block Kit `slack_file` reference with `files.info`, and then downloads each readable attachment over your
   Slack token. Two things about it are worth stating plainly rather than leaving to be discovered:

   - **Its output is UNREDACTED, and it is meant for the visible agent host.** Unlike the corpus — which scrubs emails and
     long digit runs on write — this verb prints the real message text, because reasoning about the actual
     thread is the entire point. The named use is reading it inside a Claude Code or Codex session, so the
     content enters that conversation and therefore leaves your machine with it, under egress 2. That is an
     accepted trade, not an oversight; if a thread is too sensitive to send to that host, do not read it here.
   - **It retains the attachments on disk.** Every image, PDF and document it fetches is written under
     `$SLOPWEAVER_HOME/live/slack/thread-files`, owner-only (`0700` directories, `0600` files), and is not
     cleaned up automatically. They are real Slack files, unredacted, and they persist until you delete them.

   It writes nothing to Slack and nothing into the corpus — `refresh` remains bronze's only writer.

   `slack saved` reads your own Later list, which no published API reaches: it opens `/later` in your own
   Chrome through the Playwright relay and keeps, in memory, the `saved.list` response your client fetched.
   It prints pointers (conversation, `ts`, state, permalink), never text, writes none of the list to disk and nothing to Slack,
   and its output enters the agent host under egress 2 ([saved](../../skills/slack/reference/saved.md)). `slack channel-view <channel-id>`, the console's channel hover window, reads one live history page and each picture's Slack PREVIEW, keeping the previews unredacted and owner-only under `$SLOPWEAVER_HOME/live/slack/channel-media` like `thread-files`; from the console it reaches only your localhost browser, and run in a session its output enters the agent host under egress 2 ([channel-view](../../skills/slack/reference/channel-view.md)).

6. **Linear writes you make** — every `linear` write verb (issues, comments, relations, projects,
   milestones, initiatives, status updates and attachment uploads) writes over the same `linear-token` that
   reads them; [linear-write-surface.md](../linear-write-surface.md) lists them. Two properties are worth
   stating rather than assuming. Under a personal API key Linear attributes every write to **you**, the
   key's owner, not to an application — so an issue slopweaver files is indistinguishable from one you
   typed, and "only edit what slopweaver created" is enforced by LOCAL ledgers under
   `$SLOPWEAVER_HOME/ledgers/linear-*`, never by the object itself, with one named exception:
   `linear issue update --fields-only`, which changes an existing issue's state, priority, labels or
   assignee without that ownership record and never sends a description. And a create's id is chosen by the
   caller and derived from the content, so re-running the same intent reuses the id and cannot file a
   second ticket.
7. **Branches and pull requests you write** — `github push` sends the checked-out pull-request branch over
   the repository's configured Git transport. It cannot express an arbitrary refspec, refuses the remote
   default branch, and an explicitly requested force-with-lease is pinned to the target SHA read immediately
   before the door. The pre-push hook remains visible, and success is reported only after the remote ref reads
   back at the local SHA. The `github pr` verbs create and update pull requests over the same
   `github-token` that reads them. A personal token makes GitHub attribute every write to **you**, so a pull
   request slopweaver opened is indistinguishable from one you opened by hand. So "did slopweaver open this?"
   is unanswerable, and no local ledger is the ownership authority; **"is this pull request authored by the
   account this token belongs to?" is one API call**, and that is the authorisation check. It
   compares immutable numeric user ids, never logins. A pull request authored by anybody else is refused, and
   the refusal names `SLOPWEAVER_ALLOW_FOREIGN_PR=1` — single-run, logged loudly when used.
   Authorship is authorisation and nothing more. **Body safety is a separate property**, and it is what stops
   a description being wiped: a partial `--edit` may only proceed from a form that exactly describes the
   description currently on GitHub — either the ledger's cached form or the live description parsed back into
   a form, each accepted only when re-rendering it reproduces the live bytes. When neither is available the
   edit is refused, because there would be nothing to merge into. Bytes a THIRD PARTY appended after that
   description — a bot's release notes, a human's footer — are carried through opaquely and re-appended
   verbatim, so nobody else's content is destroyed by an edit that was never about it; a trailing region
   carrying slopweaver's own markup is refused instead of preserved, because two proof anchors in one body
   is a gold-comparison failure.
   A complete `--form` may replace any description you authored; it prints the diff of what would be discarded
   and takes `SLOPWEAVER_ALLOW_PR_REPLACE=1`, as GitHub keeps no body history — unless the local ledger proves the
   live title and body are this door's last confirmed write. That key never releases a screenshot or run link a
   settled ask of the owner's named the pull request for: dropping one takes the journalled `pr-evidence-loss` grant, on every update mode.
   The ledger under `$SLOPWEAVER_HOME/ledgers/github-prs` has two jobs: at-most-once on CREATE, and the stored form as a cache. Unlike
   Linear, GitHub assigns the id only AFTER creation, so that duplicate guard keys on the branch locus (base
   repository + base ref + head ref, with a fork's head qualified as `owner:ref` so it cannot share a key with
   a same-named branch) rather than on a caller-chosen id; a renamed repository leaves that address to a successor,
   so a record carries the node id too (`src/outbound/github/prLedger.ts`). `update` never changes code — only the
   title and the description — and re-reads the pull request just before writing: a one-round-trip window.
8. **Media you attach to a pull request** — `github attach upload` sends a local image or video to
   **GitHub's own user-attachments host**, and it is the one write in this product that does not use a token.
   Three things about it are worth stating rather than leaving to be found:

   - **It authenticates with a cookied browser session, not `github-token`.** There is no published API for
     attaching media to a comment; these are the web application's own internal endpoints and they do not
     accept token auth. The session is read out of **your own Chrome**, at the moment of the call
     ([browser-route](../browser-route.md), [its cookie read](../browser-route/proof-and-capture-verbs.md#two-mechanisms-replaced-four-private-profile-lanes)),
     which retired every dedicated browser profile in this product ([what it retired](../browser-route/screenshot-reading-and-retirement.md#what-was-retired-and-what-it-cost)). Record which of your profiles once (`slopweaver browser profile --set <directory>`); after
     that there is no login step, nothing to keep alive, and nothing to re-capture.
   - **Nothing lands on disk.** No session file and no browser profile directory is kept under
     `$SLOPWEAVER_HOME` — a stored `storageState` would be a live credential at rest, signed in as you on every
     repository you can reach. The store's `browser-profile` row holds a profile DIRECTORY NAME and nothing
     else. The jar is re-read per call, only github.com cookies are assembled into the header, and no cookie
     value is ever printed, logged, synced or written.
   - **What it does take is a keychain read.** Chrome encrypts its cookie values with a key stored in the OS
     keyring, so reading the jar means asking macOS for `Chrome Safe Storage` — which prompts you, once, per
     binary. That access is stated here rather than buried: it grants the ability to decrypt any cookie in that profile, and the code narrows to
     one origin per call and returns nothing else. The decrypted plaintext carries a 32-byte digest of the
     row's own host, which is VERIFIED rather than stripped, so a value bound to a different site cannot be
     assembled into a header for this one.
   - **`upload` cannot fix a signed-out browser for you**, and a signed-out browser is unlikely: it reads
     the browser you use all day rather than a profile nobody looks at.
     When it does happen, it refuses in one line naming the exact action in your own window, and publishes
     `needs-owner-login` on the supervisor stream so the block is visible where you read (doctrine rule 6);
     `attach status` publishes `login-captured` to clear it. Neither event carries a cookie — only which
     profile it was about.
   - **Reaching a SAML-protected org needs more than being signed in.** Org SSO authorisation is a separate
     grant from the GitHub session, so your browser can be perfectly signed in and still see nothing in that
     organisation. The fleet presses that prompt in your work Chrome with `browser sign-in --provider github
--org <org>`, and cards you only for a step its look finds yours.
   - **The bytes go to Amazon S3, not to github.com.** GitHub answers the policy request with a presigned
     POST to its own asset bucket, and the file itself is transferred there directly. The upload is
     `acl: private`, and the resulting `user-attachments` URL is served by GitHub, but the byte transfer
     genuinely leaves for a third-party host GitHub nominates at call time.
   - **The asset outlives the pull request and is not scoped to it.** A `user-attachments` URL is not
     access-controlled by the repository it was filed against; anyone with the link can fetch it. Do not
     attach anything you would not paste into a public issue.

9. **Mail you read, and mail you send** — the `gmail` verbs call **Google**, which is a destination nothing
   else in this product reaches. `gmail connect` sends a browser consent round trip to
   `accounts.google.com` and an authorisation code to `oauth2.googleapis.com`; every other verb calls
   `gmail.googleapis.com` over the resulting grant. Most are reads, one of them (`gmail attachment`) saves an
   attachment's bytes on this machine, four change your own mailbox, and
   **one — `gmail send` — reaches a third party**: it puts content in front of a person who did not ask this
   machine for anything, as a calendar write does by mailing its attendees (item 16). See
   [The mail boundary](mail-boundary.md#the-mail-boundary-gmail), which is stated separately because mail is the most
   sensitive content the product handles. The `outlook` verbs are the same shape against **Microsoft**
   (`login.microsoftonline.com`, `graph.microsoft.com`), `outlook send` held the same way ([§ Outlook](mail-boundary.md#outlook-the-same-boundary-against-microsoft)).
10. **Files you read out of Drive** — the `drive` verbs call **Google** too, on their own separate grant.
    `drive connect` sends a browser consent round trip to `accounts.google.com` and an authorisation code to
    `oauth2.googleapis.com`; every other verb calls `www.googleapis.com` over the resulting grant. **Every
    one of them is a read** — no verb in this noun can create, rename, move, share or delete anything, though
    `drive connect --grant write` can put two write scopes on the grant, `drive.file` and `documents`, for the
    write verbs that are the named next step. See [The Drive boundary](drive-boundary.md#the-drive-boundary-drive).
11. **Codex passes you explicitly run** — `slopweaver codex plan` and `codex review` send your task, the
    repository reads Codex chooses, and review diffs to OpenAI. This is where your source leaves the machine.
12. **Whatever a Codex pass decides to fetch** — those passes run with network access and live web search
    enabled, so a pass may reach hosts nobody listed while reasoning about your private code. It is one of
    the two egresses with no fixed destination; the voice's web search (item 15) is the other. Both are covered in
    [The Codex boundary](codex-boundary.md#the-codex-boundary-slopweaver-codex).
    `codex route`, `codex status`, `codex quota` and `plans sync-accounts` also ask each registered store's
    own `codex app-server` two READ questions, `account/read` and `account/rateLimits/read`: which account
    it is signed into and what its usage limits read now. They carry no repository content and start no
    model (`src/codex/accountLive.ts`). `plans usage`, behind the desktop menu bar's plan lines, asks none of them and reads only what is already recorded, in the install's own store (always local; a remote store URL is refused with no hatch) and its files (`src/plans/planUsageRead.ts`).
13. **The backup `slopweaver store backup` writes** — NOT a network egress. It writes your own corpus and
    store, encrypted, into the local directory the install configures (a local
    path, no cloud). The copy has to survive this one: the local Supabase lives on
    one laptop, and losing it loses everything. A destination on the home's own device survives a corrupted
    store but not a lost disk, so `store backup --check` says when the two share a device, and an external
    volume is how the copy leaves this disk.
    What is written: the backed-up FILES (`corpus/bronze`, `corpus/members`, `corpus/history`,
    `corpus/attachments`, `corpus/bodies` — the last two are the provider file bytes and parsed page bodies that
    bronze records name by digest rather than carry, so they are attachments to records this backup already
    holds and not a new class of data — plus `knowledge`, and `atlas`: every atlas file outside a platform's
    `_sensitive/`, its screenshots and PDFs included, the media the store's atlas rows point at but do not hold),
    a `pg_dump` of the store's own `public`, `drizzle` and `storage` schemas, the Supabase Storage
    volume's objects, Vault's secrets (opened, then sealed at once), and **the CREDENTIALS, encrypted** —
    see the next paragraph. Nothing is REDACTED, because a backup you cannot restore from is not one.
    Instead, every object is encrypted (AES-256-GCM) under a random backup key in the login Keychain, read
    with no prompt while it is unlocked. That defends the destination, not code running as this user
    ([the key and its trade](../store/backup-key-and-vault.md)). The key also leaves the machine WRAPPED:
    `<project>/keys/<fingerprint>.wrap`, the key under scrypt and AES-256-GCM keyed by the master password
    below, sits in plaintext beside the backups, so another Mac opens them with that password alone.

    **The credentials ride the backup, encrypted under ONE master password the operator keeps in their
    password manager.** There is exactly one password, and it is
    fleet-generated: `slopweaver store backup --create-master-password` draws 128 random bits and hands them
    over through the clipboard only, never printed. So `$SLOPWEAVER_HOME/secrets/` is collected into one
    artefact, `secrets.enc`, encrypted with AES-256-GCM under a key derived by scrypt from that password
    (`src/store/backup/secretsCrypto.ts`), and written beside the other objects. **The password is
    this bundle's own control** — no key file holds it, and the backup key encrypts the bundle a second
    time like every other object. Slopweaver never reads it from the password manager: `store restore` and
    `store recover` read it from a no-echo prompt or piped stdin, never from argv.

    **What this is and is not protection against.** It defends a DESTINATION compromise: somebody who
    reaches these objects without reaching this laptop gets ciphertext. It does not defend a machine compromise,
    and nothing here pretends to — the password is a `0600` file in the very directory it encrypts,
    because every token it protects is already sitting there in plaintext, so holding it elsewhere would
    buy nothing while stopping the unattended 03:00 run from encrypting anything at all. The password is
    excluded from the bundle it encrypts; `store recover` writes the pasted value back. A backup taken before
    one was ever set carries `secrets: null` in its manifest and the verb says so on every run, in both directions — the absence is printed as loudly as the presence,
    because a leg that goes quiet when it does not run is discovered at recovery time. It writes when
    `slopweaver store backup` runs — by hand, or daily once `slopweaver store backup-register` has written the
    row and a scheduler session runs it; a `--local-only` backup stages in the home and writes nothing to the
    destination. See
    [The backup, and what it actually carries](../store/backup.md#the-backup-and-what-it-actually-carries).

14. **The Socket Mode connection `listen` holds open** — `slopweaver listen` opens an OUTBOUND websocket to
    Slack over an app-level token and holds it until you stop the process. It is the only long-lived
    connection a slopweaver process holds to a host off this machine — the console voice's (item 15) is held
    by the desktop app's voice window — and the only path by which something outside your machine can trigger a turn
    — `listen` captures the tag, prints it, and posts a capture-time acknowledgement to the thread; the
    ANSWER is a deliberate later step in a visible session, [described below](slack-inbound.md). With a peer
    bot named in the profile it also keeps the messages of every thread that tags that bot, as local `witness`
    lines, posting nothing. No port is opened and nothing inbound is accepted. See
    [The inbound path](slack-inbound.md#the-inbound-path-listen).

15. **Everything you say to the console voice, and everything it reads to answer you** — the
    second opt-in OpenAI egress, and the only one that carries your VOICE. It runs on your ChatGPT plan and
    nothing else: a local `codex app-server` thread opens the realtime session, after which **the desktop app's voice window
    holds a direct WebRTC connection to OpenAI** and the audio never passes through a slopweaver process at all. Your
    microphone, the model's synthesised speech, the session instructions, the tool list, and — because the voice
    answers questions about this machine — every tool RESULT it returns: board rows, the card you have open,
    queue drafts, excerpts of your own source, a bounded window of your conversation with the supervisor,
    a phrase search of your last day of supervisor turns, recalled knowledge claims, a row's origin with your
    quoted words,
    and one frame of your screen per `read_screen` call or look you ask for in words, taken by the desktop
    app, the only place a call runs. Its Codex thread
    keeps a live web search, so a query it writes goes on from OpenAI to the public web. Unlike the Codex passes it starts only on your press, and
    it is torn down when you stop it or leave the console — what that teardown does
    and does not prove is stated in full in
    [The console-voice boundary](voice-boundary.md#the-console-voice-boundary-slopweaver-talk). What the thread
    did and read stays on this machine only, in `talk/threads/` — masked, and never imported into your store or
    backup ([what a conversation leaves](voice-relays-and-retention.md)).

16. **Every other provider a door or an atlas reaches** — most over a credential `slopweaver secrets status`
    names, some over your own signed-in Chrome, and a few that read only a platform's public API reference over
    none at all. The READS are Fathom's API and share pages, the owner's ChatGPT account that `chatgpt list` lists,
    `chatgpt live-sync` reads whole and `chatgpt conversation` reads a chat of by id ([boundary](chatgpt-conversation-boundary.md)), Linear's attachment host, and every platform
    `slopweaver atlas` lists — Vanta, Datadog, Hex, Cloudflare, CrowdStrike, 1Password, WorkOS, JumpCloud,
    Google Admin and the rest — each read into `$SLOPWEAVER_HOME`. The WRITES are fewer, and each goes through the door: `calendar` bookings, edits and
    cancellations, which Google mails to every attendee
    ([The calendar boundary](calendar-boundary.md#the-calendar-boundary-calendar)); Notion page and file writes; the
    `write vanta` verbs, each held for your approval digest; `datadog submit` and `datadog hmi --enable`; `datadog monitor update|delete`, each held for your
    approval digest; and Cloudflare Email Routing
    rules, written by `alias provision` and `alias catch-all`.

Slopweaver adds no telemetry, has no account and no server of its own. It makes no claim about the
telemetry of the provider services you route calls through.

**The console's `ai` dependency is not an egress.** The work console renders with the Vercel AI SDK's UI layer
(`ai`, AI Elements, Streamdown) for its TYPES and COMPONENTS only: no provider package is installed and nothing
calls `streamText` or any model, so the list above is unchanged by it. The markdown those components render —
a session's own transcript, on `/fleet/session/<id>` — could name a remote image, and a rendered `<img>` is a
request the browser makes on its own; so every remote-media element (`img`, `video`, `audio`, `iframe`,
`source`, `picture`, `object`, `embed`) is dropped before render (`site/lib/markdownSafety.ts`), and a link
stays a link you choose to follow. A static shields.io badge in a pull request body is the one picture drawn, and
it is drawn from the words and colour in its own address, never fetched (`site/lib/githubMarkdown.ts`).
