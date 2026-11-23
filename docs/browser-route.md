# The browser route: the owner's real Chrome, and nothing else

**The owner's ruling.** No separate Chrome profile: the fleet drives the owner's real Chrome, so the owner never
has to think about it, because the bot cannot act as the owner without the owner's browser. A private profile is
a security boundary in name only — any session could already act as the owner on any page in the real browser.
That real browser is the only one the owner wants used for anything: end-to-end tests, ad-hoc Playwright
scripts, and atlases.

The evidence behind it: a Cloudflare Turnstile `600010` in a launched Chromium, a blank 2FA page in the
real-Chrome profile, a sign-out between binaries, and two hours of the owner's time.

## The rule

**No process this repository starts may launch a browser, attach to one, or keep a profile directory.** A
browser leg either reads the owner's real Chrome's own state, or it is carried out in the owner's real Chrome by the visible
session and judged here. Machine-enforced by `no-private-browser-profile` in `yarn lint` — no allowlist, no
exemption marker.

**A session's own shell does not launch one either.** The `slopweaver browser` verbs are the one browser path; the
`PreToolUse` hook refuses a raw launch with exit 2 (`src/admit/browserLaunchCommand.ts`): `open -a`/`-b` naming a
browser or `open <url>`, a Playwright CLI (`npx @playwright/cli`, `playwright open`, `--extension`, `--cdp`), a
browser binary run directly, debugging flags included, and `osascript` telling a browser. Each of those exited 0
before it. Its hatch, `SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1`, is its own: `SLOPWEAVER_ALLOW_RAW` and
`SLOPWEAVER_ALLOW_BASH` do not open it ([hook limits](./hooks/browser-memory-and-limits.md)).

**A Codex this repository starts does not launch one either.** The ChatGPT app writes `~/.codex/config.toml`
and turns on its own browser and computer-use tools there; a seat booted on it spawned `cua-repl`, which
launched a second Chrome that aborted beside the owner's and put a crash dialog in front of the owner ten times in one day. Every Codex process Slopweaver starts — a visible seat, an SDK pass, the console voice's plan call, the
account read — carries `-c` overrides switching those plugins and the `node_repl` server off
(`src/codex/browserSurface.ts`, where the one spelling that works is measured; a pass and the voice take
them through `src/codex/capabilities.ts`). The app's config is left alone: it is the owner's, and the app rewrites it.
Every launch that starts a thread — a visible seat, each thread of a `codex plan`/`review` pass or a turn eval — then reads its home's
effective server list with the same overrides, in the directory it will run in (a trusted project adds its
own `.codex/config.toml`), through the same binary it will run (PATH's `codex` for a
seat, the SDK's vendored CLI for a pass, `src/codex/vendoredCli.ts`), and REFUSES when one could still start a browser, or when the list cannot be read (`src/codex/browserDoor.ts`, hatch
`codex-browser-door`, `SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR=1`) — the case of the app shipping the same runtime under a new name.
A pass's own SHELL is the other route: plan and review prompts say never to launch a desktop app, a browser or
`open`, which for a browser is an instruction rather than a fence; an Electron it starts runs as Node
(`src/codex/electronSurface.ts`, after a review pass's Electron crashed in front of the owner).

- [Claude in Chrome is RETIRED](./browser-route/retirement-and-aim.md)
  - [The aim is a rail too](./browser-route/retirement-and-aim.md#the-aim-is-a-rail-too)
- [Show the target before firing at it](./browser-route/target-proof-and-playwright.md)
  - [Playwright IS the transport, and it reaches the owner's real Chrome](./browser-route/target-proof-and-playwright.md#playwright-is-the-transport-and-it-reaches-the-owners-real-chrome)
- [What is still unproven, stated rather than assumed](./browser-route/proof-and-capture-verbs.md)
  - [Two mechanisms replaced four private-profile lanes](./browser-route/proof-and-capture-verbs.md#two-mechanisms-replaced-four-private-profile-lanes)
  - [`slopweaver browser shot` is the screenshot route](./browser-route/proof-and-capture-verbs.md#slopweaver-browser-shot-is-the-screenshot-route)
  - [`slopweaver slack shot` — the one doored provider with a capture verb of its own](./browser-route/proof-and-capture-verbs.md#slopweaver-slack-shot--the-one-doored-provider-with-a-capture-verb-of-its-own)
- [What a brief can and cannot ask for, MEASURED](./browser-route/brief-profile-and-walks.md)
  - [The profile is PINNED, not inherited](./browser-route/brief-profile-and-walks.md#the-profile-is-pinned-not-inherited)
  - [The connect page gets its own window, and its tab closes on every ending](./browser-route/brief-profile-and-walks.md#the-connect-page-gets-its-own-window-and-its-tab-closes-on-every-ending)
  - [One walk at a time, and each bound to its own origins](./browser-route/brief-profile-and-walks.md#one-walk-at-a-time-and-each-bound-to-its-own-origins)
  - [Which profile](./browser-route/brief-profile-and-walks.md#which-profile)
- [A surface with no address: what the Notion settings arms cost and bought](./browser-route/provider-arms.md)
  - [A page list with no document: what the Datadog console arms cost and bought](./browser-route/provider-arms.md#a-page-list-with-no-document-what-the-datadog-console-arms-cost-and-bought)
  - [A shared call with no API: what the Fathom share arm reads](./browser-route/provider-arms.md#a-shared-call-with-no-api-what-the-fathom-share-arm-reads)
  - [What this did NOT change](./browser-route/provider-arms.md#what-this-did-not-change)
- [Two categories of doored provider, and what a write costs on each](./browser-route/doored-provider-writes.md)
  - [And then all five moved](./browser-route/doored-provider-writes.md#and-then-all-five-moved)
  - [And then a write to Vanta became a real verb](./browser-route/doored-provider-writes.md#and-then-a-write-to-vanta-became-a-real-verb)
  - [And then the default was ruled](./browser-route/doored-provider-writes.md#and-then-the-default-was-ruled)
- [Read the screenshot you just took](./browser-route/screenshot-reading-and-retirement.md)
  - [Reading the shot is what makes looking again possible](./browser-route/screenshot-reading-and-retirement.md#reading-the-shot-is-what-makes-looking-again-possible)
  - [Every walk, not the three that were touched first](./browser-route/screenshot-reading-and-retirement.md#every-walk-not-the-three-that-were-touched-first)
  - [What was retired, and what it cost](./browser-route/screenshot-reading-and-retirement.md#what-was-retired-and-what-it-cost)
  - [The new access this took](./browser-route/screenshot-reading-and-retirement.md#the-new-access-this-took)
- [A Datadog or GitHub sign-in is the fleet's — owner ruling](./browser-route/fleet-sign-in.md)
  - [The card gate](./browser-route/fleet-sign-in.md#the-card-gate)
