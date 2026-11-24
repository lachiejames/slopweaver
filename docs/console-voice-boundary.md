# The console-voice boundary, in detail

The detail behind [security/voice-boundary.md § The console-voice boundary](security/voice-boundary.md#the-console-voice-boundary-slopweaver-talk):
who pays for a call and how it runs, and what code the voice can read. The parent keeps the index; this page
does not restate it.

## Who pays, and how a call runs

- **The owner's ChatGPT plan pays, and nothing else does.** The owner's ruling, after the platform account's
  credits ran out mid-call: the voice runs on the owner's ChatGPT plan, and the fleet uses ChatGPT plans for
  everything, with no platform.openai usage. **Which plan pays is the register row a Codex seat would take** (`src/codex/seatDecision.ts`, the owner's ruling): never a paused, usage-limit or monthly-spend row, with no override; a Claude-only install refuses in one line (`src/talk/planRoute.ts`).
  So a call is minted the way Codex CLI's own `/voice` mints one, and **a plan that refuses is a refusal the call widget shows** — no second model, voice or bill is tried. A
  DEFINITIVE refusal — anything that fails before `thread/realtime/start` is written (no plan login, a child
  that could not start or died, a handshake step that timed out), or an error answering it — is shown in its
  own words, cut at 2,000 characters and saying so. A timeout, an exit or a missing SDP AFTER that request was
  written is AMBIGUOUS, since a plan session may exist, and the page says so and to try again
  (`site/lib/talkPlanCall.ts`, `site/lib/talkOffer.ts`).
- **A Codex thread on this machine is the delegate, and five things follow from it.**
  **(1) The process.** The console server starts ONE `codex app-server` child for the call
  (`site/lib/talkPlanLaunch.ts`): the vendored executable, never a `codex` on `PATH`; an environment with every
  OpenAI credential variable removed (`CREDENTIAL_KEYS`, `src/codex/client.ts`), so an exported key can never
  outrank the plan, and `account/read` must then report a `chatgpt` login or the mint is refused; a fresh empty
  working directory, removed when it exits; nothing detached. It holds the routed row's login (`CODEX_HOME`, set after
  the scrub) — a home [the Codex boundary](security/codex-boundary.md#the-codex-boundary-slopweaver-codex) also spends — and the handshake is
  `thread/start` then `thread/realtime/start` at protocol v3 with the browser's SDP offer
  (`src/talk/planSession.ts`). **(2) What the delegate keeps.** The thread is started ephemeral, read-only
  sandbox, approval `never`, no project docs, no bundled skills, with the owner's Codex hooks, plugins, memories, shell
  and MCP servers disabled (each configured server replaced by an inert stub) and the ChatGPT app's browser
  surface switched off. The sandbox, approval, web search and browser-off come from
  `src/codex/capabilities.ts`, the one module the review passes read them from too. Measured, what remains
  beside Talk's own tools is Codex's code-mode `exec`/`wait` (required — without it the dynamic tools vanish),
  `request_user_input`, `apply_patch` under the read-only sandbox, MCP resource listing with no server, a
  clock, `collaboration.*` (not removable) and a **live web search**, the same egress the parent's `web_search` sentence
  names. Talk's own tools reach the page as `item/tool/call` requests and run through the page's routes and
  the relay gate. **(3) The data channel.** Codex, not this console, mints the session, so no
  `allowed_client_events` list is this console's to set; the page instead sends nothing on the channel at all —
  no `session.update`, no instruction — and answers tools over localhost to the child. The page's text enters the
  session one way only: what the owner typed or pasted into the Messenger box during the call, with the one line naming a
  file the owner attached there (`site/lib/messengerAttachment.ts`, never the file's bytes), posted to
  `/api/talk/typed-in` and appended verbatim as a `user` item (`thread/realtime/appendText`, `PlanCall.typeIn`) — the owner's
  turn, exactly as the owner's speech would be, never inside a developer message; if the voice is silent `typedInKickMs`
  later, the fixed `TYPED_IN_KICK_TEXT` follows as a `developer` item telling it to answer
  ([why](console/typed-and-voice-one-conversation.md)). Every other write into
  the session is a sentence the server owns — four as `thread/realtime/appendSpeech`: one rotated
  "on it" a second into a hand-off with the voice silent (`ackSpeech`), which stops nothing (a turn running on past it
  gets no more words: the server sends the page a `progress` event 15 s after the voice last spoke and every 30 s
  after, and the page plays its working sound, writing nothing into the session); a rotated "having a look" line, or "finding it" for a lookup the owner asked for ("bring up that card", "can you find it"),
  (`lookSpeech`, `/api/talk/call/<id>/look`) the moment the owner's turn asks for one and is handed off, which the page decides
  from the owner's transcribed words (`site/lib/lookAck.ts`) and posts as a body of `{ ask: "look" | "find" }`, nothing else
  — refused while a nudge, a commentary message or a finished turn's answer is still to be said, so it never queues
  behind one; a meeting line (`meetingSpeech`, `/api/talk/call/<id>/meeting-due`) naming a meeting of the owner's that
  starts within two minutes or started within ten, read by the server itself with `talk meeting-due` — the page's post
  carries only the notice ids it has shown and the meetings the owner said the owner has had or will not go to (`meeting_skip`),
  which only ever leave a meeting out ([why](console/voice-notices-meetings.md)) — said once per meeting, after a clear floor before its start and, from
  its start, cutting in while the owner talks, held only by another of the server's own writes in flight and stopping nothing.
  Its title is calendar data the voice's `calendar list` read already crosses ([voice boundary](security/voice-boundary.md));
  the join link and the tagged briefing's link never enter the session, only the page's pill; and a drift line
  (`driftSpeech`, `/api/talk/call/<id>/drift`) naming the plan the owner stated and the application the owner has been in past the
  dwell — the page's post carries only that label, that name, the minutes and a notice id, never a window title — said
  once per notice, only on a clear floor ([why](console/voice-notices-drift.md)); and an ISO nudge (`isoNudgeSpeech`,
  `/api/talk/call/<id>/iso-nudge`) naming one ISO card waiting on the owner once the owner has been off ISO in work hours past the
  dwell, at most twice a stretch, the same way ([why](console/voice-nudges-iso.md)). And `thread/realtime/appendText` with role `developer`, which the voice reads and is never spoken:
  the owner's nudge, only on the owner's press (`/api/talk/call/<id>/nudge`, empty body), the fixed `NUDGE_TEXT` — `NUDGE_STOPPED_TEXT`
  then `turn/interrupt` for each Codex turn of the call's own thread running at the press, or `NUDGE_OWED_TEXT` when
  the voice was transcribed after the owner — telling it to answer the owner's last words, or carry on from them, which the session
  already holds, refused while a tool call waits on the page; the fixed `RESUME_TEXT` (`/api/talk/call/<id>/resume`, empty body) telling it only to acknowledge the owner while the console starts the thinking model's turn with `RESUME_TURN_TEXT`, which the page posts
  5 s into a silence after the owner's words that nothing answered, or 2 s when they end on the owner's code word "over"
  (`site/lib/overWord.ts`), not on a wait or a trailing "umm" of the owner's (`site/lib/waitAsk.ts`), and once per silence — refused under every condition the look line is, plus a Codex turn
  or tool call still running ([why](console/walk-silences.md#the-page-resumes-an-unanswered-steer)); and the same
  kind of developer message for a Slack send the owner asked for that was held or failed, never one that went (`sendOutcomeText`,
  `/api/talk/call/<id>/send-outcome`), its words the server's, the page's post carrying only which send, whose
  outcome the server reads itself and whose reason or error the message quotes as data — once per send, refused while anyone talks or other
  speech holds the floor ([why](console/voice-says-what-became-of-a-send.md)). A Queue count the app does not show,
  or a PR number nothing on the call said first, is never handed back to the voice: the page posts
  only numbers, closed keys or the act (`/api/talk/call/<id>/count-grounding`, `/claim-grounding`) and the server
  keeps an entry it renders itself; a done claim nothing grounds, or fleet work the voice promised as its own
  (`site/lib/talkFleetPromises.ts`), is also owed one fixed `appendSpeech` correction once the owner is not talking (`site/lib/talkPlanCompletionCorrection.ts`), and a steer-risk line that could be heard as
  done is said as `STEER_RISK_PLAIN_SPEECH` ([why](console/voice-holds-to-the-record.md)). Into the delegated Codex THREAD it writes
  two things the model did not ask for: the frame that same
  look ask took, by `turn/steer` into the running turn beside the fixed `LOOK_FRAME_TEXT`
  (`/api/talk/call/<id>/frame`, [why](console/voice-sees-the-owners-screen.md)) — the page's post carries the picture and
  no words; it goes into the newest turn running, or the first to start within 1 s, and with neither the console
  starts that turn itself, one `turn/start` on the call's own thread whose whole input is the frame and
  `LOOK_FRAME_TEXT`; and
  the call's completed speech that turn has not had, by `turn/steer` into the turn named (`/api/talk/call/<id>/spoken-record`),
  the owner's words and the voice's as one escaped JSON array between fixed delimiters, quoted data the prompt says never
  instructs it, beside the draft of the Queue post card the owner's newest words began over in its own delimited block
  ([why](console/voice-holds-to-the-record.md#the-cards-draft-rides-the-same-steer)), and the server's own
  `SLOPWEAVER_VOICE_PROVENANCE` block: every line the console had the voice say, with why, and every kept grounding
  ([why](console/voice-says-only-what-was-asked.md)). The thread's token counts come back the same way, over localhost into the local call file, and go nowhere else. The relay gate reads the v3 `input_transcript.added` fragments as your words. **(4) Mute is the
  microphone track only**: no `session.input_audio.mute` exists on v3, so the model is still in the call and
  can finish a turn you began. **(5) Shutdown.** Hang-up stops locally AND tells the server, which sends
  `thread/realtime/stop` and kills the child; a page stream absent for 30 s (a closed tab), 90 minutes of
  call (the console's own ceiling, not OpenAI's — [calls](console/voice-context-and-calls.md)), or the console server exiting each kill it too (`PLAN_CALL_LIMITS`, `site/lib/planCallContract.ts`), the
  last with a synchronous SIGKILL, so a child deaf to SIGTERM cannot outlive the server — a hang-up, quit or any other catchable ending signal included, which would otherwise end Node with no `exit` event, and an interrupt or SIGTERM too, stopped at once because Next's own cleanup waits for every open response, the call's attached event stream among them, before it exits (`site/lib/talkCallRegistry.ts`); the windows left are the uncatchable ones, a SIGKILL of the server and a fault or native abort where no JavaScript runs, where the child sees only its stdin close; a page that goes away
  while the handshake runs stops it there (`site/lib/talkPlanLaunch.ts`). Before the ceiling, the SAME visible page
  closes a long call in a pause once its words are on disk and opens a successor, silent unless the owner's last words
  went unanswered, a new plan call with its own child, one at a time (`site/lib/callRollover.ts`). A live call that drops on a reason the owner did not ask for — the ceiling among them, when no
  pause came — is reopened by that page until it is back, as a new plan call with its own child
  (`site/lib/callReconnect.ts`); the owner's hang-up and an absent page stay terminal, and a page opened again never reconnects
  on its own. A tool no
  page claims within 15 s is answered as undelivered in the server's own fixed sentence (measured on one call: every
  claim reached a swapped-out console instead, and each turn sat silent until the owner spoke), and one claimed but never
  answered is answered as a failure two minutes after its claim, so the thread never waits forever; a tool call
  replayed under a fresh request id, or made by any thread but the call's own, is refused rather than run. The page claims each
  tool call before running it (`/claim`), so one the server has already settled — timed out while its event sat in a buffer,
  or answered before a reload replayed it — is dropped rather than run, as is one whose claim came back a whole two-minute wait after it was asked. The server answers only a claimed call with the page's words, so an answer that skipped the claim, and the page's gate log with it, is refused; the one exception is a failure, which the page sends when a claim or answer post was lost, and the server settles an unclaimed call with its own fixed sentence rather than the page's, so the thread goes on at once instead of waiting out the 15 s (measured on a starved console answering 503s); and every claim and answer names the id its page minted, a claimed call answered only under its claimant's, so a failure from a page whose claim was lost never settles one another page is running; a request reusing a waiting call's id is dropped, so that id is answered once, by the call already waiting. The claim is the one point the server decides a tool runs: one granted while the call was live authorises that run even when the call ends before the page hears the grant, exactly as a tool already running when the call ends does, and its answer is then refused. A grant permits a run and never obliges one: the page still drops it on a hang-up it has already seen, which is always safe, as the server answers a dropped call as a failure at its wait.
  Rule 2 recognises this one spawn by its call shape (`no-headless` NH008): it is held for exactly the life of
  a call you opened and can hang up.

## The code the voice can read

- **The code the voice can read is bounded, and says what it cannot see.** `talk code` reads only TRACKED
  files in the serving checkout, searches literally rather than by pattern, and carries a per-file and a
  total byte budget with an explicit `truncated` marker and a continuation offset rather than a silent
  cut. It fails CLOSED when the checkout root will not resolve or when enumeration fails — an unreadable
  checkout is a refusal, never an empty one. Untracked files are invisible to it, and the verb says so in
  its own output rather than leaving you to infer it.

  **Containment compares SEGMENTS, never a string prefix.** `relative()` answering `..config/settings.ts`
  means a directory literally called `..config`, sitting inside the root — only `..` alone, or `..` and a
  separator, is a step out. Measured in a checkout tracking that exact file, before the test
  was segment-wise: `talk code read` answered "resolves outside the checkout root" and `talk code find`
  counted the file as an alias it had skipped. Neither was true, and the bound the message claimed to be
  enforcing was not the one doing the refusing.

  **A tracked PATH is not the same as bounded BYTES, which is why the alias checks are named here.** The
  requested path is `lstat`ed before resolution, so a tracked name that is a symlink to an untracked file
  inside the checkout is refused rather than followed; a symlinked parent directory is refused on the walk
  up to the root; and a hard link is refused on `nlink > 1` (`src/lib/pathContainment.ts`), because a
  tracked name hard-linked to a file outside the checkout is contained and regular and still serves outside
  bytes. Reads bind to the opened descriptor, so the two checks a descriptor can carry — is this a regular
  file, and is its link count one — are re-made against what was actually opened, in
  `refuseAliasedDescriptor` (`src/talk/checkout.ts`), which both readers call. Those two arms are exported
  and tested DIRECTLY rather than through a reader: reaching them through one needs a writer to swap the
  file inside the window between `lstat` and `open`, which no test can schedule, so what a test builds is
  the condition itself — a real hard link, opened, and its own `fstat` handed over.

  **That is not enough on its own, and the open refuses to follow a symlinked leaf for the reason.** A Codex
  review scheduled a replacement inside the window between validation and open —
  a tracked ordinary file swapped for a symlink to a file outside the checkout — which a following open
  reads, because `fstat` on the swapped-in target reports a perfectly ordinary regular file with
  `nlink == 1`. No check on the descriptor can see that. Both readers open with `O_NOFOLLOW`, which is atomic
  because the kernel makes it. **The residue this bullet does not claim to close** is a parent
  DIRECTORY swapped underneath between the ancestor walk and the open: `O_NOFOLLOW` governs the final
  component only.

  **A name is checked against what the DIRECTORY lists, not against what a lookup resolves.** Every other
  check here asks the filesystem about a path, and so inherits the filesystem's own idea of which names are
  the same name. On a case-insensitive volume — the macOS default — `open`, `lstat` and `fstat` all resolve
  `Tracked.ts` onto an entry really called `tracked.ts`: a regular file, `nlink == 1`, no symlink anywhere.
  A Codex review reproduced it with `core.ignoreCase=false`, where git lists
  `Tracked.ts` as tracked and `tracked.ts` as untracked, and both readers served the untracked file. So
  every component of a path is required to appear VERBATIM in its parent's `readdir` listing — the only
  call that reports a name as the directory spells it rather than as a lookup folds it. A search pays one
  listing per directory, not per file.

  **Both readers make those checks, through one function, because splitting them is what broke it.** They
  live in `refuseAliasedPath` (`src/talk/checkout.ts`) and `talk code read` and `talk code find` each call
  it. Only the read half did, until a Codex review reproduced the gap against the
  shipped verb: a tracked name symlinked to a file outside the checkout came back from `find` as an
  ordinary hit, quoting the outside file's line, while `read` refused the identical name. A search reports
  what it refused as `aliasSkipped`, beside `binarySkipped`, rather than as an absence of matches.

  **A filename is BYTES, so a tracked name is kept only when its string RE-ENCODES to exactly those
  bytes.** Two Codex reviews found the same idea twice. First: `git
ls-files` output was decoded as UTF-8, so an index entry holding the byte `0xff` came back as the string
  `bad-�.ts` — the name of a real, ordinary, UNTRACKED file sitting beside it. Then, after a fatal
  decoder closed that: `TextDecoder` STRIPS a leading U+FEFF and raises nothing, so a tracked
  `﻿secret.ts` decoded to `secret.ts`, the name of the untracked file beside IT. Both times two
  different filenames became one string and membership passed for a file git had never heard of.

  So the criterion is the round trip, not the decoder's options: decode, re-encode, compare bytes, and drop
  a name no string can carry — reporting HOW MANY were dropped rather than leaving the checkout looking
  smaller than it is. Dropping is what the voice can honour: a name reaching a model over JSON is a
  JavaScript string either way, so no tool call could ever have named such a file unambiguously. A name
  that round-trips is kept and stays readable under its own exact name, BOM and all.

## Any file on this machine

The owner's ruling: the voice is as capable as any Claude session, so it reads what a
Claude session reads — a published page under `~/.slopweaver/pages`, a handover, `~/Downloads`, an untracked file —
and that **what it reads crosses to OpenAI is the owner's pick**. `file_read` and `file_list` run `slopweaver talk file`
(`src/cli/commands/talk/fileRun.ts`). They are reads, not a shell: the voice thread still runs with Codex's own
shell, exec, browser and computer-use tools off, so everything it reads passes through the one verb below and
through the relay gate, which counts its result as third-party text like any other read.

- **One class stays on the machine: a credential.** A credential store — the `secrets/` and hygiene denylist
  of every Slopweaver home (the one in use, the default and each `~/.slopweaver*`), `~/.ssh`, `~/.gnupg`,
  `~/.aws`, `~/.kube`, `~/.config/gh`, Pulumi's, Terraform's and Git's credential files, `~/.supabase`,
  `~/.vault-token`, sops' age keys, the login file under every `~/.codex*` and `~/.claude*` home, a keychain and
  the rest listed in `src/talk/localPath.ts` — and a credential-named file anywhere (`.env` or `.envrc`, alone
  or followed by `.`, `-`, `_`, `~`, a space, a digit or `(` and anything — `.env.local`, `.env-prod`, `.env~`,
  `.env2`, `.env(1)` — bar the
  template names, `*.env`, `*.envrc`, any `hygiene-denylist*` copy, `*.pem`, `*.p12`, `id_ed25519`) are refused.
  The check runs on the path as asked AND on where it resolves, folded for case and Unicode, by segment, so
  neither a symlink into `secrets/` nor `~/.SSH` gets past it. Then it runs by IDENTITY: the resolved path and
  every directory above it are compared by `(dev, ino)` against each store, so a second spelling of the same
  directory — macOS's `/System/Volumes/Data/Users/…` — is refused too; so is a copy beside a store whose name
  is the store's followed by `.`, `-`, `_`, `~`, a space, a digit or `(` (`secrets.old`, `secrets copy`,
  `secrets2`, `.netrc~`, `.netrc(1)`, `~/.aws.bak`) and everything inside one, and a
  file with a second hard link is compared by inode
  against an index of every store, built once per call (`src/talk/storeLinks.ts`). A refusal prints the
  `talk-file-credential` hatch; setting it lifts the path refusal, never the masking.
- **A credential inside an ordinary file is masked where it stands** (`src/talk/fileRedaction.ts`). Each shape
  is matched in the single-line form written here — `src/talk/credentialShapes.ts` holds the patterns and its
  tests pin them — and a form not written here is a residue:
  - token shapes, by these prefixes only — a provider format not listed is a residue: Slack (`xox?-`,
    `xapp-`, a `hooks.slack.com` webhook), GitHub (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`),
    Linear (`lin_api_`, `lin_oauth_`), Notion (`ntn_`, `secret_`), GitLab (`glpat-`, `glrt-`, `gldt-`,
    `glptt-`, `glft-`, `glimt-`, `glsoat-`, `glcbt-`, `gloas-`), Hugging Face (`hf_`), Pulumi (`pul-`),
    Supabase (`sbp_`, `sb_secret_`), Vault (`hvs.`, `hvb.`, `hvr.`), age (`AGE-SECRET-KEY-1`,
    `AGE-SECRET-KEY-PQ-1`), SendGrid (`SG.`), Tailscale (`tskey-`), DigitalOcean (`dop_v1_`, `doo_v1_`,
    `dor_v1_`), Sentry (`sntrys_`, `sntryu_`, `sntry_`, `sntrs_`, `sntru_`), Atlassian (`ATATT`), Telegram
    (`<digits>:AA`), Anthropic (`sk-ant-`), OpenAI (`sk-proj-`, `sk-svcacct-`, `sk-admin-`, `sk-None-`, and
    `sk-` with an alphanumeric body), Stripe (`sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`), a webhook
    secret (`whsec_`), AWS (`AKIA`/`ASIA` key ids, Bedrock's `ABSK` and `bedrock-api-key-`), Google
    (`AIza`, `ya29.`, `1//0`, `GOCSPX-`), npm (`npm_`), 1Password (`ops_`), a `Bearer` token, a bare 32-hex
    key, a JWT, a PEM private-key block;
  - an `Authorization:` line or `"Authorization"` key under any scheme or none (a credential with no scheme
    and another word after it on its line is masked only when it holds a digit), and a HAR
    `{"name":"Authorization","value":…}` or Postman `{"key":"Authorization","value":…}` pair, in that order;
  - a secret-named `KEY=value` or `name=value` anywhere on a line;
  - a secret-named `key: value` wherever the key opens (a YAML line, list item or flow map, a `grep -n` hit, a
    quoted reply), its value on that line, on the next, or in a block scalar whose header is `|` or `>` with
    an optional anchor, tag or comment;
  - a quoted value after a secret-named key or an UPPER_CASE `*_KEY`, quoted or not (`:`, `=`, `:=`, `=>`;
    double, single, backtick or triple quotes, behind Python's `b`/`r`/`u`/`f` or bash's `$`, escaped quotes
    and YAML's `''` included);
  - a secret-named XML element's text (a namespace prefix, attributes, a CDATA section or a first-child
    `<Value>` included), and .NET's `value=`;
  - on the command's own line: any `--token|--password|--passphrase|--secret|--api-key <value>` flag, the short
    password flag of `mysql`, `sshpass`, `docker login`, `redis-cli`, `sqlcmd`, `az login`, `mongo`,
    `ldapsearch`, `zip`, `unzip` and `ssh-keygen`, joined to its value or not (`mysql`'s joined only: a
    spaced word after its `-p` is the database name), `openssl`'s `-k <value>` and
    `-passin pass:`, `keytool`'s `-storepass`, `sqlplus user/password`, and `curl -u`'s password, an empty
    user included;
  - a URL's password (`scheme://user:password@host`, a user holding `@` included), and every denylist string
    of every home.

  A key name is up to 80 characters either side of its secret word. A value is masked to its end however
  long: a quoted key or flag value to its closing quote, a `key:` or spaced `key = ` opening a line, or opening
  a transcript row's content, to the line's end (`passphrase: correct horse battery staple`; in a row, its
  escaped line break), a mid-line `name=value` to the next space, quote, `&`, `;`, `,` or `)`, an
  `Authorization` credential to the next space, quote or comma, any other to the next space or quote. A
  `key:` or `--flag` value is masked from 4 characters, an `Authorization` credential from 8. What leads up to
  a value — a user name, a scheme, an option list, a line prefix, the space before it — is bounded in every
  pattern, and past a bound the value is sent. The full set of bounds is the code's (`src/talk/credentialShapes.ts`,
  `src/talk/linePrefixes.ts`); Residues names the ones review has measured. Matching runs over the text as it stands and again with each of up to four levels of JSON
  escaping undone, so a config quoted into a transcript's JSONL is masked too; each of those again with every
  line's number, `grep -n`/`-A` prefix, reply `>` and diff marker taken off, so the numbered copy a Claude Code
  transcript keeps of a Read file, a grep's context lines and a patch's `+` lines are masked too; and over 264 KiB of context before the window and 8 KiB after it, so **a window
  whose edge cuts a credential masks it**, and a secret block scalar paged across windows is still masked
  while its key line is in reach. A secret-named `key: value` whose value reads as a type, a call or a
  bare name is kept in a source file only. Then the hygiene gate's own scan runs over the finished
  window, and **a window it still flags is withheld whole** — the masker is loose on purpose, the gate is the
  fail-closed check behind it.

- **The read is bounded and cannot hang.** A window is at most 10 KiB, cut after its last line break where it
  has one, so its answer fits the page's 24 KiB tool cap, and a larger file is paged with `nextFrom`
  (`DEFAULT_CODE_BUDGET`, `src/cli/commands/talk/args.ts`). Only a regular file is read, opened non-blocking and without following a leaf symlink, and the
  descriptor must be the inode that was checked, so a FIFO, device or swapped file is refused rather than
  blocking the call. A NUL byte means binary, refused — unless the file's own first bytes name a PNG, JPEG or
  WebP (`src/talk/imageSniff.ts`; the name is never consulted).
- **A page's window carries its outline.** An `.html`/`.htm` file up to 256 KiB is read whole once, as both
  the window's masking context and the source of `outline`: up to 16 `<h1>`–`<h3>` headings, each with the
  byte `from` it opens at, every heading masked on its own and the whole outline dropped if the gate still
  flags one (`src/talk/pageOutline.ts`). Only the headings cross beyond the window, so a question about a
  section the window does not hold is one `from` away. Measured on a call: one window from byte
  7,800 of the code-ownership briefing ended before its options at 44,613, and the voice answered the owner's question
  about proposals from the table describing today's settings.
- **A picture crosses as pixels, and only as pixels.** The owner's bug report from a call: reading a
  PNG is the same as reading the owner's shared screen. A sniffed picture up to 16 MiB is read whole, after every path
  refusal above, and goes base64 only as far as the console page, which draws it onto a canvas fitted to what
  the provider looks at and re-encodes a WebP under the same budget as a `read_screen` frame
  (`site/components/voice/fileImageGrab.ts`). So its EXIF, PNG text chunks and anything else riding in the
  file stay on this machine. **Nothing in pixels is masked**: a credential visible IN a picture crosses, exactly
  as one on a shared screen does.

**Residues, named.** Masking is by shape: a short flag on a tool not named above or on a `\`-continued line, a
`<Value>` that is not its element's first child, `.envbak` (read, its contents masked), the part of an unquoted
value after a quote inside it, a value shorter than its minimum, a URL password past 256 characters, a short
flag more than 200 characters after its command, a `curl -u` user past 64 or more than 8 spaces after `-u`, a
`sqlplus` user past 64 or behind more than 4 options, a URL user past 256 or a URL scheme past 31, a block
scalar header with more than two anchors or tags or one past 80 characters, a line prefix deeper than the
stripper takes (more than 8 reply `>`, a `grep` path past 256, a line number past 9 digits), an `Authorization` scheme past 31, XML attributes past 256, an XML
namespace prefix past 40, more than 256 whitespace characters before an XML value, a block scalar's body past
200 lines, and a credential with no
recognisable shape and no secret-named key or flag beside it — a bare password on a line of its own, a bare 40-hex key (the length of a git commit id, left
readable on purpose), a value under a key whose name says nothing (`value: x`) — is sent; the part of any value
inside the window is unmasked when the value's key sits more than 8 KiB before the window; and in a source file a
secret-named `key: Value;` or `{ password: pw }` is kept as source, and JSON escaped five times deep is not
undone. Masking errs long: in a JSON-escaped row a value that does not open a line runs on through an escaped
line break to the next space, since cutting it at a backslash would leak the tail of a secret holding one. Seventeen adversarial review
passes each found shapes the one before missed, so treat the shape list as a floor. The refusal list names where credentials are
conventionally kept; one kept somewhere unconventional is read like any file. The hatch is read from the
console process's environment, so a console started with `SLOPWEAVER_ALLOW_TALK_FILE_CREDENTIAL=1` lifts every
path refusal for every call it serves until it restarts. macOS privacy protection (Documents, Desktop,
Downloads, Mail) is enforced on the console process, not here: a path it blocks answers with that setting
named, and granting it is the owner's act.
