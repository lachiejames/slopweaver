# Environment first: walking the doctor's probes with them

How step 1 reads `slopweaver doctor --deep --json` and turns each probe into a choice. The rules are in
[SKILL.md](../SKILL.md): onboarding never stops on a red probe, and the Datadog agent and the zsh profile are
never Slopweaver requirements. The probes themselves live in `src/environment/`. `doctor` is the authority on what
they say, so read its output and do not restate it.

## Reading the report

`doctor` exits **3** when any probe is `fatal`, and **0** otherwise. Both exits mean the same thing here:
parse the JSON on stdout. Capture stdout and the exit status separately, and never treat exit 3 as a
failed command. The block that matters:

```json
"environment": {
  "deep": true,
  "fatal": 1,
  "warnings": 2,
  "unchecked": 0,
  "probes": [
    { "id": "git", "scope": "slopweaver", "verdict": "fatal", "says": "…", "fix": "…", "withoutFix": "…" }
  ]
}
```

- **`fatal`**: Slopweaver cannot run past this one. Recommend the fix first, and say plainly what continuing
  costs. If they continue anyway, continue.
- **`warning`**: Slopweaver degrades rather than stops. Offer the fix, and name what keeps working.
- **`unchecked`**: the evidence was not gathered. Under `--deep` this is only the Node floor failing to
  parse, so say that and move on. Never present an unchecked probe as a miss.
- **`scope: "dev-environment"`** (`zsh-profile`, `datadog-agent`): this organisation's developer
  health. Say "not something Slopweaver needs" in the same sentence as the finding.
- **`supabase-cli` and `docker`**: the local store's two prerequisites, so step 9 depends on them. The CLI's fix
  is `yarn install` in the checkout, which installs the version `package.json` pins; no Homebrew. A
  `supabase` elsewhere on `PATH` is named and never used, and `yarn store:*` clears the launcher's
  `SUPABASE_CLI_BINARY_OVERRIDE` so no environment can swap the binary. Docker is `fatal` (a hard requirement);
  its fix is an app they install by hand, walked in § Docker below.

## Docker: install Docker Desktop, set the binding first, and a floor rather than a pin

Assume nothing about Docker: a first-time installer may never have had it. The store is containers, so this is
the one prerequisite onboarding has to talk them through.

- **`docker` is `fatal`** (neither the app nor a CLI): recommend installing
  [Docker Desktop](https://www.docker.com/products/docker-desktop), the runtime
  [hardening the local store](../../../docs/security/local-store-hardening.md) can prove loopback on. Another
  runtime (colima, OrbStack) runs the store too, but its own settings apply and step 9b's routing check stays
  not proven there. They open the app once, which starts the daemon; then re-run `doctor`.
- **`docker` is `ok` on a CLI with no app**: say what the probe says, that nothing checked a runtime serves it.
  `docker version` answers that in one command.
- **Then, still before step 9, recommend Port binding behavior set to local only** (`local-only-port-binding` in
  Docker's [settings reference](https://docs.docker.com/enterprise/security/hardened-desktop/settings-management/settings-reference/)).
  Now rather than at 9b because the setting governs containers created AFTER it changes: set before the first
  `supabase start` and the store's ports are born on loopback, with no stop-and-recreate. Name the setting, not
  a menu path ([why](securing-the-store.md#1--ports-on-loopback)). It is a recommendation, never a gate; step
  9b checks it live whichever they chose.
- **Version: a floor, not a pin.** Docker Desktop cannot usefully be pinned, by Docker's own
  [release FAQ](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/releases/): "The install commands
  don't take a version number", builds older than six months from the latest are not downloadable (a `403`),
  releases ship weekly, and Pro and Team support covers the latest version only. One version across an
  organisation is the job of "your IT administrator's endpoint management software". So Slopweaver states a
  FLOOR: **4.88.0 or later**, the release whose `docker ps` reports loopback bindings accurately
  ([release notes](https://docs.docker.com/desktop/release-notes/)), which 9b's check reads. Recommend leaving
  "Automatically check for updates" on: turning it off (`disableUpdate` in the settings reference) freezes
  them below fixes Docker ships only on the latest. The Supabase CLI is what Slopweaver pins, in `package.json`.

## Offering the choice, one probe at a time

For each probe that is not `ok`, in the order `doctor` printed them (what stops Slopweaver comes first), give
three short things in one message:

1. **What is true**: its `says`.
2. **Recommended: fix it now**: its `fix`. A fix that is a command, such as `proto install node 24.21.0` or
   `gh auth login`, is one you can run for them once they say yes. A fix that needs their hands, such as
   installing an app or a browser login, is a step you describe.
3. **Or continue anyway**: its `withoutFix`, which is the cost in plain words.

Take whatever they pick and do not argue for the fix a second time. After any fixes, re-run `slopweaver
doctor --deep --json` once and report what changed. Then go on to `slopweaver init` whatever the result.

## Why `--deep` here and not elsewhere

The free run starts no subprocess and opens no socket. `--deep` adds three probes that cost one each:
`gh auth token`, a knock on the cmux control socket, and an interactive `zsh -i -c exit`, which runs their
whole profile. Onboarding runs once, so it pays for all three. The cost table is in `src/environment/gather.ts`.
