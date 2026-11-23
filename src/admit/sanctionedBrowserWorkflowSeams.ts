/**
 * The sanctioned seams of the browser relay and the verbs that write beside it: the Playwright transports and their snippets, the walk and shot verbs, the Git push primitives, and the proposal, briefing and handover writers.
 *
 * One part of the sanctioned-seam catalogue: `./sanctionedSeams.ts` spreads it into `SANCTIONED_SEAMS`, which stays
 * the one table `./coverage.ts` reads, so a module is still sanctioned in exactly one place. A new row goes in the
 * part whose theme its module belongs to, and a part nearing 300 code lines splits again.
 */

/** The sanctioned seams of this part, keyed by repo-relative path. */
export const BROWSER_WORKFLOW_SEAMS = {
  // The Falcon console walk's transport. `read-only-tool` for the same reason as onepassword/opCli.ts, and
  // for two more that are this lane's own. The argv is never supplied by a caller: it is a fixed
  // `attach`/`run-code` invocation of `playwright-core`'s own terminal client, and the only thing that
  // varies is a page-visit snippet this module writes from a constant in its own source. That snippet
  // NAVIGATES and observes — it performs no click, no form submission and no request replay — so nothing it
  // does changes a byte in the Falcon tenant. Its file writes are the snippet, a client shim and a
  // screenshot, all inside a temp directory this module makes and removes, plus PNGs under
  // $SLOPWEAVER_HOME/atlas/crowdstrike. It launches no browser and keeps no profile: it is a CLIENT of the
  // Chrome the owner is already running (docs/browser-route.md, docs/browser-route/target-proof-and-playwright.md).
  "src/browser/playwrightCli.ts": "read-only-tool",
  // The relay's shared plumbing — lease, attach, one snippet, clean up — extracted from playwrightCli.ts so
  // a SECOND, governed operation could exist beside the page visit. It is the one file on
  // this install that can type into the owner's browser, so it is `door-internal` rather than
  // `read-only-tool`, and the distinction is the honest one rather than a formality: the old classification
  // was justified in its own comment by the sentence "that snippet NAVIGATES and observes — it performs no
  // click, no form submission and no request replay", and that is no longer true of this module. Inheriting
  // it would have made the gate lie.
  //
  // What keeps it door-internal rather than open: the thing that varies is a CLOSED `RelayOperation` union
  // this module dispatches on, and the only caller that can ask for a write arm is
  // `write vanta edit-policy-draft`, which has been through `throughDoor` with an approval digest over the
  // exact substitution. The two Notion settings arms are read arms and change nothing
  // about that sentence — browser/notionSettings.ts below carries their own argument. Its own writes are the snippet, a client shim and a screenshot, all inside a temp
  // directory it makes and removes. It launches no browser: it is a CLIENT of the Chrome the owner is
  // already running (docs/browser-route.md, docs/browser-route/target-proof-and-playwright.md). An earlier shape of it took the page-visit builder as an
  // injected CALLBACK, which let a caller supply snippet source and would have made this row false — a
  // review pass found it before it landed, and `browser/pageVisitSnippet.ts` carries the account.
  "src/browser/relaySession.ts": "door-internal",
  // The layer directly above it: running ONE operation through a session, the reconnect that re-addresses a
  // page after a dropped relay, and the leased ordering above both. `door-internal` for exactly the reasons
  // the row above states and for no new one — it dispatches the SAME closed `RelayOperation` union, reaches
  // no provider of its own, and its one direct seam is writing that operation's snippet into the scratch
  // directory `relaySession.ts` made and removes. A reconnect re-runs `ensureAttached`, which is that
  // module's own attach and not a second way into the owner's browser.
  "src/browser/relayRun.ts": "door-internal",
  // The page-visit snippet itself: a pure builder, no seam of its own beyond being the source of the one
  // read-only operation. Classified beside the module that runs it.
  "src/browser/pageVisitSnippet.ts": "read-only-tool",
  // The Vanta policy-editor transport. `door-internal` for the same reason as relaySession.ts above: it is
  // reachable only from `write vanta edit-policy-draft`, whose door request declares `external-write` and
  // whose approval gate HOLDS unless `--approve` carries the digest of that exact substitution against that
  // exact draft. Its own direct seam is the temp scratch its session owns.
  "src/browser/vantaPolicyEditor.ts": "door-internal",
  // The read-only half of the policy-VERSION route, plus the write arm `write vanta upload-policy-version`
  // drives. Same class as the editor transport above, and for the same reason: the only caller of its write
  // arm is that verb's `throughDoor`, and the arm refuses any plan that does not hash to the digest the door
  // admitted. Its observe arm clicks a disclosure and nothing else.
  "src/browser/vantaPolicyVersion.ts": "door-internal",
  // `browser shot`'s own writes: the caller's --out PNG and its parent, plus the throwaway scratch directory
  // the transport is handed and this file removes on every exit path. Nothing here reaches a provider — the
  // capture itself goes through playwrightCli.ts above, already classified read-only-tool — and the verb
  // refuses outright any host whose door replaces its web client (src/cli/commands/browser/shotCore.ts).
  "src/cli/commands/browser/shotRun.ts": "local-state",
  // The DEFAULT `browser shot` profile: the same --out PNG, the raw
  // capture beside it, the scratch directory it removes, and the capture record under
  // $SLOPWEAVER_HOME/visual-evidence/captures. The browser leg goes through browser/evidenceCapture.ts
  // below; nothing here reaches a provider.
  "src/cli/commands/browser/shotEvidenceRun.ts": "local-state",
  // `browser annotate`'s own writes: the --out PNG and its `<out>.image-record.json` form, written atomically,
  // and one `rmSync` of an older run's form at that same path before the PNG is replaced. It drives no browser
  // and reaches no provider: it reads a PNG already on disk and draws on it.
  "src/cli/commands/browser/annotateRun.ts": "local-state",
  // `browser redact` and `browser terminal-shot`: the --out PNG and its parent, written atomically, then the capture
  // record under $SLOPWEAVER_HOME/visual-evidence/captures, and one `rmSync` of that PNG when the record cannot be
  // filed, so no picture is left that nothing could attach. Neither drives a browser nor reaches a provider.
  "src/cli/commands/browser/redactRun.ts": "local-state",
  "src/cli/commands/browser/terminalShotRun.ts": "local-state",
  // `browser console-shot`: three children run to completion under an allowlisted environment with a throwaway
  // HOME and state home (this checkout's CLI build, its console build, and Playwright Test over the console lane's
  // fixtures, which create and drop a throwaway database), inside a temp directory it makes and removes on every
  // path. Then the --out PNG, written atomically beside its target and moved into place, and the capture record
  // under $SLOPWEAVER_HOME/visual-evidence/captures, withdrawn when the move fails. Its browser is Playwright's own
  // headless Chromium with no profile, never the owner's Chrome, and nothing here reaches a provider.
  "src/cli/commands/browser/consoleShotRun.ts": "local-state",
  "src/cli/commands/browser/consoleShotPlace.ts": "local-state",
  // The evidence-capture transport: the fourth closed relay operation, run through relaySession.ts, whose
  // only writes are removing the PNG the snippet was told to produce once its bytes are in memory. It
  // navigates, observes a source-owned target, scrolls to frame it, and photographs the viewport — no
  // click, no typed text, no caller-supplied selector — so it is a read-only tool exactly as
  // playwrightCli.ts is, and for the same reasons.
  "src/browser/evidenceCapture.ts": "read-only-tool",
  // The Notion settings transport, and the one row here whose class needed an argument rather than a
  // precedent. It CLICKS, so it cannot inherit playwrightCli.ts's classification above — that row is
  // justified in its own comment by the sentence "no click, no form submission and no request replay", and
  // relaySession.ts already refused to inherit it once for the same reason. It has no write arm either, so
  // vantaPolicyEditor.ts's door-internal reasoning — "reachable only from a verb that went through
  // throughDoor with an approval digest" — describes nothing here.
  //
  // `read-only-tool` on a DIFFERENT argument, stated so a later reader can check it rather than assume it:
  // the modal is opened by two disclosure clicks (the workspace switcher, then the `Settings` item matched
  // inside what that switcher opened, against a closed name list in browser/notionSettingsSnippet.ts), and
  // the only other thing either arm may press is a `role="tab"` that the settings click itself brought into
  // existence. Notion's destructive controls — Delete workspace, Remove member, the billing upgrade — are
  // BUTTONS on a panel, so they are not members of the set a tab selection draws from at all. That is a
  // structural property of the candidate set rather than a promise about names, which is what makes it
  // checkable. Its own writes are the snippet, a client shim and a screenshot, all inside a temp directory
  // relaySession.ts makes and removes. It launches no browser (docs/browser-route.md).
  "src/browser/notionSettings.ts": "read-only-tool",
  // The two Notion settings snippets: pure builders, no seam of their own. Classified beside the module
  // that runs them, exactly as pageVisitSnippet.ts is.
  "src/browser/notionSettingsSnippet.ts": "read-only-tool",
  // The Datadog monitor backtest transport (`datadog shot monitor`). It CLICKS, so like notionSettings.ts
  // above it cannot inherit playwrightCli.ts's "no click" argument, and it has no write arm. `read-only-tool`
  // on this argument: both clicks land on the backtest's own TIME control — the `Time range picker` input,
  // then the `Past 1 Week` preset matched by exact text in what that picker opened — and the snippet presses
  // no key, fills no field and contains no Save; beyond them it only scrolls the marked panel into view
  // before photographing the viewport. Moving the window changes what the console evaluates the
  // draft over in the relay's own tab, which is closed afterwards; no monitor field changes. Its own writes
  // are the PNG the snippet was told to produce, read into memory and removed on every exit path, inside the
  // scratch directory its caller made.
  "src/browser/datadogMonitorBacktest.ts": "read-only-tool",
  // Its snippet: a pure builder, no seam of its own. Classified beside the module that runs it.
  "src/browser/datadogMonitorBacktestSnippet.ts": "read-only-tool",
  // `browser sign-in`'s look ledger: one `0600` JSONL row per look appended to
  // `$SLOPWEAVER_HOME/ledgers/sign-in-probes.jsonl`, and its `0700` parent. Local machine state exclusively —
  // provider, verdict, the page's origin and path, and why. It reaches no provider; the look itself is the relay's.
  "src/browser/signInProbeStore.ts": "local-state",
  // `slack shot`'s own writes, and the same three as the row above for the same reasons: the caller's --out
  // PNG and its parent, plus the throwaway scratch directory the transport is handed and this file removes
  // in a `finally`. It is a READ of Slack rather than a write to it — the transport's closed call set is
  // navigate-and-photograph, so no click, no typed text and no page script is available to it at any price
  // — and it exists because the fold is drawn by the CLIENT, which no Slack API can be asked about. Rule 3's
  // own answer applies: a slopweaver verb driving the owner's browser IS the door, and `browser shot` still refuses
  // Slack by name so this stays the only route. See src/cli/commands/slack/shotCore.ts.
  "src/cli/commands/slack/shotRun.ts": "local-state",
  // `slack saved`'s own primitives only mint and remove its scratch directory; the read itself crosses the
  // already-sanctioned read-only Playwright transport, with no screenshot asked for.
  "src/cli/commands/slack/savedRun.ts": "local-state",
  // The terminal client every interaction verb dispatches through: the same `execFileSync` invocation of
  // `playwright-core`'s own CLI that `playwrightCli.ts` above makes, against a NAMED session. Unlike that
  // one it can be asked to click and type, so it is not read-only — but the judgement about whether it may
  // is taken in `src/browser/action.ts` and the external write is routed in `actionRun.ts`, below. Its OWN
  // direct seams are all local: a client shim and a `.playwright` marker inside a session workspace it is
  // handed, and a child process. It launches no browser and keeps no profile (docs/browser-route.md), and
  // what the click it can make then changes is accounted for at the verb, exactly as `cookieJar.ts` accounts
  // for the upload its cookies authorise.
  "src/browser/terminalClient.ts": "local-state",
  // `browser open`/`read`/`act`/`close`'s own writes: the session directory under the home, the observation
  // files the reads file, and the after-picture each action photographs. The ACT itself — the one thing here
  // that changes a page signed in as the owner — goes through `throughDoor` with `effect: "external-write"`, which
  // is what makes this verb family responsible for it now the Claude-in-Chrome hook no longer watches it. So its own seams are local and its one external effect is routed,
  // which is the same shape `shotRun.ts` above has with a narrower verb.
  "src/cli/commands/browser/actionRun.ts": "local-state",
  // `browser inspect`, the console voice's one look: the session directory it makes under the home and
  // removes on every exit path. It opens, reads and closes through the same terminal client as `browser
  // open`, has no action vocabulary at all, and opens only a host the browser register names
  // (src/browser/inspect.ts), so nothing here writes to a page or reaches a provider but by reading it.
  "src/cli/commands/browser/inspectRun.ts": "local-state",
  // `hand post`'s look at its own `--url`, `browser inspect`'s sequence run before a note goes up: the session
  // directory it makes under the home and removes on every exit path. It goes to the address, reads it with one
  // `eval` and one viewport screenshot, and lets go — no action vocabulary, so nothing here writes to a page.
  "src/cli/commands/hand/pageLookRun.ts": "local-state",
  // `talk verb`, the console voice's gateway to the read verbs a seat runs: one `spawn` of THIS SAME CLI with
  // an argv `src/talk/modelReads.ts` resolved from its closed list — reads only, no path, home, wait or write
  // flag — each of which passes its own door. It writes nothing and reaches no provider itself.
  "src/cli/commands/talk/verbRun.ts": "local-state",
  // The console-origin gate's one question: is the checkout a console serves from a main worktree, by one
  // `git rev-parse --show-toplevel --git-dir --git-common-dir`, a literal argv. It writes nothing and reaches no
  // provider; only the directory varies.
  "src/cli/commands/talk/consoleOrigin.ts": "read-only-tool",
  // The plumbing those verbs and `browser scroll` share: reaching a live session, and taking one LOOK at
  // the page it is on. Its only seam is the observation file a read files when the client printed its
  // snapshot inline rather than naming a file — the same write that sat inside `actionRun.ts` above before
  // the two verbs started sharing it, and local for the same reason. Nothing here can change a page: the
  // look is a `snapshot` and a viewport `screenshot`, and every interaction is routed at its own verb.
  "src/cli/commands/browser/sessionShell.ts": "local-state",
  // `browser scroll`'s own writes: one picture per screen inside the session's workspace, and the session
  // record. The WHEEL is write-capable (`src/browser/action.ts` says why a wheel fires the page's own
  // handlers), so the walk itself goes through `throughDoor` with `effect: "external-write"` — one row for
  // the whole walk rather than one per screen, exactly as `actionRun.ts` takes one row per action.
  "src/cli/commands/browser/scrollRun.ts": "local-state",
  // `crowdstrike walk`'s own mkdir: the artifacts directory under $SLOPWEAVER_HOME/atlas/crowdstrike that
  // the transport writes screenshots into. The generation itself publishes through atlas/kit/store.ts.
  "src/cli/commands/crowdstrike/walkRun.ts": "local-state",
  // `atlas github walk`'s own mkdir: the artifacts directory under $SLOPWEAVER_HOME/atlas/github that the
  // transport writes admin-page screenshots into. Same shape and same reason as the CrowdStrike row above —
  // the generation itself publishes through atlas/kit/store.ts, and the atlas never writes to GitHub.
  "src/cli/commands/githubAtlas/walkRun.ts": "local-state",
  // `gmail draft --board`'s in-flight claim under `$SLOPWEAVER_HOME/live/gmail/board-drafts`: created with O_EXCL and
  // unlinked when the press ends. A lock file on this machine; the draft itself goes through the door.
  "src/cli/commands/gmail/boardDraftClaim.ts": "local-state",
  // `spend forward`'s one-draft-per-receipt claim under `$SLOPWEAVER_HOME/spend/forwards`: created with O_EXCL,
  // rewritten with the draft id, unlinked when nothing was drafted. The draft itself goes through the door.
  "src/cli/commands/spend/forwardClaim.ts": "local-state",
  // Writes the 0600 ChatGPT session file under secrets/ and removes the paste it was imported from.
  "src/cli/commands/chatgpt/session.ts": "local-state",
  "src/cli/commands/vanta/walkRun.ts": "local-state",
  // `write vanta edit-policy-draft`'s own mkdir: the transport's scratch directory under
  // $SLOPWEAVER_HOME/atlas/vanta. Local state — the MUTATION itself goes through `throughDoor` in the same
  // file, and this is only where the verb's own evidence screenshots land.
  "src/cli/commands/vanta/policyDraftRun.ts": "local-state",
  // `write vanta upload-policy-version`'s own writes are the rendered PDF and its scratch directory, both
  // under `$SLOPWEAVER_HOME/atlas/vanta/_policy-version`. The Vanta write itself is the door-routed browser
  // arm, exactly as `policyDraftRun.ts` above: the file is written BEFORE the door so the approval digest
  // can cover bytes that already exist.
  "src/cli/commands/vanta/policyUploadRun.ts": "local-state",
  // `atlas vanta policy-versions` writes only its own screenshot scratch directory under the atlas. The
  // page read it performs is door-routed as an `external-read`.
  "src/cli/commands/vanta/policyVersionRun.ts": "local-state",
  // `policy render`'s PDF writer. The verb reaches no provider at all: it reads a markdown file the operator
  // named and writes a PDF where the operator asked, which is why its manifest row is `effect: none`.
  "src/cli/commands/policy/run.ts": "local-state",
  // `policy diff`'s three output files, written into the directory the operator names. It reads the atlas
  // already on disk and a git blob through `git show`; publishing the page and sending the post are other verbs.
  "src/cli/commands/policy/diffRun.ts": "local-state",
  // `atlas vanta shot`'s own mkdir: the same artifacts directory under $SLOPWEAVER_HOME/atlas/vanta that
  // the walk above writes into. It photographs one named control and publishes through atlas/kit/store.ts;
  // Vanta's write surface is the `write vanta` verbs, which are doored, and the atlas never reaches it.
  "src/cli/commands/vanta/shotRun.ts": "local-state",
  // `atlas notion walk`'s own mkdir: the transport's scratch directory under $SLOPWEAVER_HOME/atlas/notion.
  // Same shape as the two above — the generation publishes through atlas/kit/store.ts.
  "src/cli/commands/notionAtlas/walkRun.ts": "local-state",
  // `atlas trelica walk`'s own mkdir: the transport's scratch directory under $SLOPWEAVER_HOME/atlas/trelica.
  // Same shape as the three above — the generation publishes through atlas/kit/store.ts.
  "src/cli/commands/trelicaAtlas/walkRun.ts": "local-state",
  // Writes one page screenshot under the atlas's own directory in $SLOPWEAVER_HOME, then READS it back to
  // prove the bytes on disk are the ones that were captured. Every walking atlas's writer, shared: local
  // state, and no external effect at all.
  "src/atlas/kit/artifactWriter.ts": "local-state",
  // `atlas aether walk`'s own mkdir: the transport's scratch directory under $SLOPWEAVER_HOME/atlas/aether.
  // Same shape as the other walking atlases — the generation publishes through atlas/kit/store.ts, and the
  // atlas never writes to Aether (the walk navigates and photographs, holding no cookie).
  "src/cli/commands/atlas/aether/walkRun.ts": "local-state",
  // Makes the transport's scratch directory under the calling atlas's own $SLOPWEAVER_HOME generation
  // directory. Every walking atlas's attach, shared: local state, and it launches no browser — it attaches
  // to the one the owner is already running (docs/browser-route.md, docs/browser-route/target-proof-and-playwright.md).
  "src/atlas/kit/walkTransport.ts": "local-state",
  // `atlas xero walk`'s own mkdir: the artifacts directory under $SLOPWEAVER_HOME/atlas/xero that the
  // transport writes screenshots into. Same shape as the walking atlases above — local state, no external
  // effect, and the generation itself publishes through atlas/kit/store.ts.
  "src/cli/commands/xeroAtlas/walkRun.ts": "local-state",
  // `atlas jumpcloud walk`'s own mkdir: the artifacts directory under $SLOPWEAVER_HOME/atlas/jumpcloud/console that
  // the transport writes screenshots into. Same shape as the walking atlases above — local state, no external
  // effect, and the console generation publishes through atlas/kit/store.ts.
  "src/cli/commands/atlas/jumpcloud/walkRun.ts": "local-state",
  // `atlas clerk walk`'s own mkdir: the artifacts directory under $SLOPWEAVER_HOME/atlas/clerk that the
  // transport writes dashboard screenshots into. Same shape as the walking atlases above — local state, no
  // external effect, and the generation itself publishes through atlas/kit/store.ts. Clerk has no
  // `slopweaver` door of its own to route around: the verb IS the door (rule 3, docs/browser-route/provider-arms.md), and
  // the walk only ever navigates a declared page list and observes.
  "src/cli/commands/clerkAtlas/walkRun.ts": "local-state",
  // Removes the `.sql` and snapshot of a migration two branches both generated, and rewrites drizzle's own
  // journal beside them. Local state only, and bounded to the repository's `supabase/migrations/` — it
  // reaches no provider, and the one thing it deletes is a file the generator will re-emit from the schema.
  // The journal itself is replaced through `writeFileAtomic`; only the discarded migrations are `rmSync`.
  "src/cli/commands/dev/drizzleRebase.ts": "local-state",
  "src/cli/commands/dev/manifest.ts": "local-state",
  "src/cli/commands/distil/answer.ts": "local-state",
  // Writes the silver digest JSON + gold markdown once every batch in the plan is cached. Local state only
  // (under $SLOPWEAVER_HOME/corpus) — moved here from the pre-rewrite `distil/run.ts` when the model call it
  // used to follow was replaced by `distil brief`/`distil answer` (rule 2: no spawned model, anywhere).
  // `distil brief` rebuilds gold + silver from a COMPLETE cache, so it writes the same derived files
  // `answer` does and for the same reason: the cache can be complete while the derived files are absent.
  // Local state under $SLOPWEAVER_HOME, no external effect.
  "src/cli/commands/distil/brief.ts": "local-state",
  // The governed Git push transport. Its read-only Git probes establish the checked-out branch, default
  // branch and exact remote SHA; its ONE write process is created only inside `throughDoor`, and the manifest
  // independently declares `github push` as a routed external write. Sanctioning the primitive here records
  // that measured seam rather than weakening the registry-side door check.
  "src/cli/commands/github/pushRun.ts": "door-internal",
  // The Git primitives `pushRun.ts` above is sanctioned for: the read-only probes and the ONE push process,
  // which is still created only inside `throughDoor`. They lived in `pushRun.ts` under that same sanction
  // until the carry gate needed them without a module cycle (`./stackCarryRun.ts` has to push, and
  // `pushRun.ts` has to call the carry gate); only their address changed, exactly as with
  // `prePushGateRun.ts` below.
  "src/cli/commands/github/pushPrimitives.ts": "door-internal",
  // The git process edges `pushPrimitives.ts` above runs through, `readGit` and `writeGit`, split out when
  // bounding them pushed that file past the size ratchet. The write process is still created only inside
  // `throughDoor`. Only their address changed, exactly as with `prePushGateRun.ts` below.
  "src/admit/gitTransport.ts": "door-internal",
  // The pre-push gate edge `./githubPush.ts`'s `pushAndVerify` calls (wired in by `pushPrimitives.ts`) before
  // any transport: two read-only Git probes locating the hook the way git does, and one spawn of that LOCAL
  // hook. It reaches nothing external — the push it precedes is the routed write; it lived inside `pushRun.ts`
  // under that same sanction until the file-size ratchet moved it here, and only its address changed.
  "src/cli/commands/github/prePushGateRun.ts": "door-internal",
  // `github pr update --pull`'s writer: saves the editable authoring file it reads the live description into.
  // A local file at a caller-named path (`--out`, or `pr-<number>.md` in the CWD) — never an external
  // provider write, and never routed through `throughDoor`, which is reserved for the GitHub/Slack/Linear
  // write itself. Same class as `route/evaluate.ts` below: a CLI command file writing local state directly.
  // Lives in `prDeps.ts` (the injectable edges `run.ts` and its siblings share), split out of `run.ts` itself
  // to keep that file under this repo's own line ceiling.
  "src/cli/commands/github/prDeps.ts": "local-state",
  // `github vuln body --out <path>` writes ONE file: the compiled pull-request form, at the path the caller
  // named. The verb reaches GitHub only on `list`/`get`, both pure reads, and this write never leaves the
  // machine — the form still has to go through `github stack push` to reach anything external.
  "src/cli/commands/github/vulnRun.ts": "local-state",
  // The proposal intake store: one JSON record per proposal under $SLOPWEAVER_HOME/proposals. Local state
  // exactly like the briefs directory beside it — it holds the questions a stakeholder still owes and the
  // page a proposal published to, and never touches a provider. The Notion write is a separate verb.
  "src/outbound/proposal/intakeStore.ts": "local-state",
  // The proposal register store: one append-only event journal per proposal under
  // $SLOPWEAVER_HOME/proposals/register. Same class as the intake store immediately above it — local state
  // only, never a provider write. `proposal publish`/`sync` append to it; the Notion/Slack writes themselves
  // are separate, door-routed verbs this store never calls.
  "src/outbound/proposal/register/store.ts": "local-state",
  // `proposal draft --out`'s writer: saves the rendered golden markdown to a caller-named local path, so the
  // draft can be read and edited before it is published. Never an external provider write; the Notion write
  // is a separate verb that routes through the door itself. Same class as `github/run.ts` above.
  "src/cli/commands/proposal/run.ts": "local-state",
  // `sop draft --out`'s writer: saves the rendered SOP markdown to a caller-named local path, so the draft
  // can be read and edited before it is published. Exactly the class of `proposal/run.ts` immediately above
  // — never an external provider write. `sop publish` sends nothing itself either; it hands the bytes to
  // `notion page`, which routes through the door on its own.
  "src/cli/commands/sop/run.ts": "local-state",
  // `briefing render --out`'s writer: saves the rendered fleet-briefing page to a caller-named local path,
  // so it can be read and published. Exactly the class of `proposal/run.ts` above — never a provider write;
  // the PUBLISH is the operator handing the file to the artifact host, outside this process entirely.
  "src/cli/commands/briefing/renderRun.ts": "local-state",
  // `briefing archive`'s writer: rewrites the caller-named form file in place and writes the overflow beside
  // it. Both paths are the caller's own scratch; reaches no provider.
  "src/cli/commands/briefing/archiveRun.ts": "local-state",
  // `session-start page --out`'s writer: saves the rendered ranked-list page to a caller-named local path,
  // for exactly the reason `briefing/renderRun.ts` immediately above does. The ranking it renders was read
  // by a separate `session-start --json` run; this verb reaches no provider at all.
  // The shared Git ancestry / private-fetch-ref primitive `stack sync` and every base-freshness check
  // (`push`, `stack push`) build on. Its one direct seam is a `merge-base --is-ancestor` boolean
  // probe with no write mode — exactly the class `pushRun.ts`'s own Git probes are. Every actual write these
  // callers perform still runs through the injected `GithubPushDeps.writeGit`, sanctioned above via
  // `pushRun.ts`, and only inside `throughDoor`.
  "src/cli/commands/github/gitAncestry.ts": "door-internal",
  // `route evaluate`'s baseline writer — a local eval report, never an external provider write. Same class
  // as `distil/brief.ts`/`distil/answer.ts` above: a CLI command file writing local state directly.
  "src/cli/commands/route/evaluate.ts": "local-state",
  // `handover lint --fix`'s writer — defaults a missing `artifact:` into a hand-authored doc's own
  // front-matter, in place. The doc lives under $SLOPWEAVER_HOME/handovers (or wherever `--doc` points, still
  // a local file), never a provider write. Same class as `route/evaluate.ts` above.
  "src/cli/commands/handover/lintRun.ts": "local-state",
  // `handover register`'s writer — a new ask row, a markdown file under `$SLOPWEAVER_HOME/handovers` (or
  // wherever `--dir` points, still a local file), created with `wx` under the board-wide tag lock, never a
  // provider write. Exactly the class above.
  "src/cli/commands/handover/registerWrite.ts": "local-state",
  // `handover settle`'s writer, the other end of the row above — splices the settlement into an existing
  // row's own front-matter, in the same local directory. Same class, and it may also reap a dead run, which
  // writes only that run's journal under the same home.
  "src/cli/commands/handover/settleRowRun.ts": "local-state",
  // `handover rule`'s writer — the owner's ruling spliced into a finding row's own front-matter, the same
  // markdown file under `$SLOPWEAVER_HOME/handovers` that `settle` edits. Never a provider write.
  "src/cli/commands/handover/ruleRun.ts": "local-state",
  // `handover pause`'s and `handover unpause`'s writer — `status:`, `pausedOn:` and `pausedSince:` written
  // into a row's own front-matter, the same markdown file under `$SLOPWEAVER_HOME/handovers` that `settle`
  // and `rule` edit. A pause says the work waits on a PERSON; nothing about it reaches that person, or any
  // provider, so this is exactly the class above.
  "src/cli/commands/handover/pauseRun.ts": "local-state",
  // `handover set-repo`'s writer — `repo:` added to a row's own front-matter, the same markdown file under
  // `$SLOPWEAVER_HOME/handovers` that `settle` and `pause` edit. It names a checkout on this machine and
  // reaches no provider, so this is exactly the class above.
  "src/cli/commands/handover/setRepoRun.ts": "local-state",
  // `handover recheck`'s writer — `trunkRecheckedIso:`, `trunkRechecked:` and `trunkRecheckedSha:` in a finding
  // row's own front-matter, the same markdown file `set-repo` edits. It reads the row's local checkout and reaches
  // no provider, so this is exactly the class above.
  "src/cli/commands/handover/recheckRun.ts": "local-state",
  // `handover set-workspace`'s writer — `workspace:` and `workspaceBecause:` in a row's own front-matter, the same
  // markdown file `set-repo` edits. A classification the console reads, reaching no provider: the class above.
  "src/cli/commands/handover/setWorkspaceWrite.ts": "local-state",
  // `handover set-priority`'s writer — `priority:` with `priorityBecause:` or `priorityFrom:` in a row's own
  // front-matter, the same markdown file `set-workspace` edits. A ranking the board and the Queue read, reaching no
  // provider: the class above.
  "src/cli/commands/handover/setPriorityRun.ts": "local-state",
  // Writes only $SLOPWEAVER_HOME/skill-reminders.json — the class-2 sanctioned-verb-guard's per-session
  // dedup marker for "governed verb used without its owning skill loaded" (see `cli/skillReminder.ts`).
  // Advisory local state, never an external write: the reminder itself is printed to stderr, and the
  // verb's own exit code is never affected by this file existing, being stale, or failing to write.
  "src/cli/skillReminderEffects.ts": "local-state",
  // The stale-seat advisory's shell: read-only `git` probes of the RUNNING checkout (`rev-parse`,
  // `symbolic-ref`, `rev-list --count`, `diff --name-only` against an ALREADY-FETCHED ref — it never
  // fetches). It writes no file: which sessions saw the notice is the store's `stale-seat-notices` row, reached
  // through `staleSeatNotices.ts`'s port. Advisory local state that reaches no provider, and whose failure to be
  // recorded costs one extra notice rather than a failed verb.
  "src/cli/staleSeatEffects.ts": "local-state",
} as const satisfies Readonly<Record<string, "door-internal" | "local-state" | "read-only-tool">>;
