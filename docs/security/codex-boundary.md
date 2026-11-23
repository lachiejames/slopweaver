# The Codex boundary (`slopweaver codex`)

Part of [Security & trust](../security.md).

This is the widest boundary in the product, so read it carefully. **Codex can read your whole filesystem,
reach the network, search the web, and write inside its own scratch directory.** The one thing it cannot do
is write to your repository.

- **What leaves the machine, and to whom.** To **OpenAI**: for a planning pass, your task description plus
  whatever Codex chooses to read from the repository while investigating; for a review pass, the complete
  diff you scoped. To **whatever else it decides to fetch**: network access and live web search are enabled,
  so a pass may issue requests to arbitrary hosts and to a search provider while reasoning about your private
  code. That is a deliberate trade — a brain that cannot look anything up is a worse brain — but it means
  OpenAI is not the only destination, and no allowlist bounds the others.
- **A Slack draft pass is SEALED, and sends Slack text.** `slack draft record` runs one pass beside every new
  as-me row ([draft comparison](../console/draft-comparison.md)). To OpenAI it sends the conversation the row
  lands in (a thread's newest forty messages, or a channel's newest twenty, each cut to 2,000 characters), the row's
  destination and purpose, and your voice brief, which is private profile configuration. That thread runs under
  `SEALED_POLICY` (`src/codex/client.ts`): `sandboxMode: "read-only"`, network access OFF and web search
  disabled, so OpenAI is the only destination the thread itself can reach. That bounds the THREAD, not every
  process a pass starts: a globally configured MCP server is still spawned with it (below) and can read the
  routed home, where the session file keeps that Slack text. Its working directory is a throwaway under the
  OS temp root, removed when the pass returns; the sandbox writes nothing into it, so a record killed
  mid-pass leaves only that empty directory behind. Reads are unbounded there as everywhere below, so a tool
  call could read the parked original and anything else the user can. A pass that used any tool, or whose
  activity was not measured, therefore yields no draft (`src/codex/slackDraft.ts` `draftPassReached`), though
  what it read has still reached OpenAI.
- **Authentication** reuses an existing Codex OAuth login. Each pass is routed to one Codex plan the user registered
  with `slopweaver plans add` — a login merely found in `$CODEX_HOME` or `~/.codex` is never a plan — and runs
  against that plan's own `CODEX_HOME`, whose `auth.json` the bundled CLI reads for itself. Slopweaver never presents,
  copies or logs a token from it: `codex signin` opens the file only to report which keys are present and its
  `auth_mode`, extracting no other value (`src/codex/auth.ts`). The environment it hands the SDK is its own
  plus the routed `CODEX_HOME`, with `OPENAI_API_KEY`, `CODEX_API_KEY` and `CODEX_ACCESS_TOKEN` removed, so a
  key exported into your shell cannot outrank the routed login (`codexClientEnvironment`,
  `src/codex/client.ts`). No API key is created or stored.
- **The account-usage read** (`src/codex/accountLive.ts`) launches each registered store's own `codex
app-server` under its own `CODEX_HOME` and asks it two questions, `account/read` and
  `account/rateLimits/read`. OpenAI learns that the store's login looked at its own account; the answer
  (the signed-in address, the plan type, the limit windows, any unused free resets) stays on the machine,
  and only the address is ever written, onto that store's register row, by `plans sync-accounts`. The CLI
  reads its own `auth.json`; Slopweaver never opens it. A store with nothing signed in is reported as such,
  with the `CODEX_HOME=<dir> codex login` line to run, because signing in is always yours to do. The binary
  is the vendored Codex CLI; `SLOPWEAVER_CODEX_APP_SERVER` points it at another executable, which is how the
  subprocess tests substitute a fake and never a way to reach a different service.
- **The reset redemption** (`slopweaver codex reset`) is the one account WRITE: the same app-server, one
  `account/rateLimitResetCredit/consume` carrying a locally minted idempotency key and, if named, the
  provider's own credit id. It spends a free reset the account already holds and nothing else — no purchase,
  no plan change — and it goes through the door, so every attempt is on the ledger beside its key in
  `$SLOPWEAVER_HOME/codex-reset/claims.jsonl`. The chair's tick runs it as `--at-limit`, which only claims on a
  registered plan already at the register's pause bar (99% by default), once per account.
- **The write boundary is the workspace, and it is the only sandbox guarantee.** Every thread is
  started with `sandboxMode: "workspace-write"`, `networkAccessEnabled: true`, live web search, an empty
  `additionalDirectories`, and `approvalPolicy: "never"` — re-applied identically on `resumeThread`, and the
  approval, sandbox and web search read from `src/codex/capabilities.ts`, the one source the console voice's
  read-only delegate reads them from too. The
  working directory is a **per-pass scratch directory** under `$SLOPWEAVER_HOME/orchestration`, never your
  repository. Codex may write freely inside that scratch directory and nowhere else, because the repository
  is neither the workspace nor an additional directory. Measured: from a scratch workspace a
  pass read the repository successfully and a write into the repository was refused, with the file absent
  from disk afterwards. It is a repeatable, opt-in, paid check —
  `CODEX_ACCEPTANCE=1 CODEX_ACCEPTANCE_PLAN=<alias> yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/codex/acceptance.test.ts`
  — run against BOTH `startThread` and `resumeThread`, because a transport can silently drop the sandbox flag
  on resume alone. It spends a registered, unpaused Codex plan from your plan register, never an
  unregistered ambient `~/.codex` login (a row naming that directory pays only because you registered it, as a
  production pass would); with the alias unnamed, the register must hold exactly one unpaused
  Codex plan.
- **A pass cannot open a window, and an Electron it starts runs as Node.** The sandbox denies the WindowServer,
  so an app bundle a pass launches aborts in `NSApplication` init and macOS puts a crash alert in front of you:
  two did once, when a review pass ran a stock Electron to test a navigation event. Every pass carries
  `shell_environment_policy.set.ELECTRON_RUN_AS_NODE="1"`, so an Electron its shell starts never registers as an
  app, and both pass prompts say never to launch a desktop app. Before each pass thread starts, a sandboxed
  `printenv` with the pass's own binary, home, directory and overrides must print `1`, or the thread is refused
  (`codex-electron-guard`, `SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD=1`): a routed home whose `shell_environment_policy.include_only` omits the variable would
  otherwise drop it silently. The limit: a browser, `open` or any other app bundle ignores the variable, as does a
  command that scrubs its own environment; for those the prompt is the only control. The console voice's
  delegate has no shell tool at all. Measurement and repro: `src/codex/electronSurface.ts`.
- **Reads are NOT bounded.** `sandboxMode` governs writes. Codex can read files anywhere it
  has filesystem permission, including well outside the working directory. This is not a least-privilege
  read boundary and must not be described as one.
- **Sandboxing protects your filesystem, not your privacy.** With the network open that gap is wider, not
  narrower.
- **`approvalPolicy: "never"` is a safety control, not a convenience.** Measured with a real MCP server
  exposing a mutating tool: under _both_ `read-only` and `workspace-write` the tool dispatch was cancelled
  and nothing was written. The sandbox is not what blocks MCP — the approval policy is. It must never be
  relaxed on the assumption that the sandbox holds that line.
- **A globally configured MCP server is still STARTED.** Slopweaver cannot prevent that: if
  the routed home's `config.toml` declares an MCP server, Codex launches its process and lists its tools. Tool
  _dispatch_ is blocked, but a hostile server can act at startup, independently of anything Slopweaver
  decides. Note also that `mcp_servers = {}` as a config override does **not** disable this — measured —
  so it is deliberately not used and not claimed as a control.
- **Codex keeps its own session files** under the routed home's `sessions/` so threads can be resumed.
  Prompts and diffs therefore also persist locally, in that plan home.
- **Scratch directories are owner-only, and spent once the pass finishes.** Alongside each artifact directory
  sits a `<id>.scratch` directory at mode `0700` — the workspace that pass wrote into. Its contents are
  whatever Codex chose to write, so treat it as untrusted output. It persists after the run until
  `slopweaver home reclaim` removes it, which it does only once the sibling `artifact.md` exists; the
  artifact's writable-roots line may then name a path that is gone.
- **The artifact discloses the policy it ran under**, including the sandbox mode, network access, web search
  and the exact writable roots. Those are what was REQUESTED; the SDK reports neither the sandbox actually
  applied nor the model actually selected.
- **Artifacts are owner-only.** Each pass writes one immutable `artifact.md` in an exclusively-created
  directory under `$SLOPWEAVER_HOME/orchestration`, mode `0700` for directories and `0600` for files. They
  are deliberately never written into the repository, where they would dirty the very diff under review and
  could be committed by accident.
