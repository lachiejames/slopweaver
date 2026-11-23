/**
 * The escape-hatch rows for the BROWSER SURFACE — the Datadog site guard, the four rails over what one
 * action is allowed to point at, and the Codex browser guards. The retired Claude-in-Chrome door has no row:
 * its refusal has no override.
 *
 * ## Why these are a file and not a section
 *
 * `./registry.ts` composes its register from one category file per surface, and this is one of them: what a
 * browser leg may TOUCH. `ESCAPE_HATCHES` spreads this array in, so there is exactly ONE register, and
 * `src/devLint/escapeHatch.ts` reads that array rather than any file's text.
 *
 * Add a row for a new browser rail HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the browser surface, in register order. */
export const BROWSER_HATCHES = [
  // Opening US1's app.datadoghq.com instead of the install's own regional console is a common mistake, so it is
  // banned. The `command` is a default each caller replaces with what it actually refused (`browser open`,
  // `open <url>`).
  {
    caught:
      "the address is a Datadog console on a site other than this install's DD_SITE, or a derived host no site serves (app.us3.datadoghq.com), and Datadog sites are separate orgs — the wrong one shows a sign-in wall or an empty org, never an error",
    command: "opening a Datadog console page",
    exceptions: [
      "the page belongs to a second Datadog organisation on another site that this install genuinely has an account in",
      "DD_SITE itself is what is wrong, and the page is being opened once to confirm which site the org lives on",
    ],
    id: "datadog-site",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_DATADOG_SITE" },
    lane: "ambient",
    reader: "src/datadog/siteGuard.ts",
    standing: "proposed",
  },
  // The hatch on the per-page read-only rail: a hard error on a click on a page decided to be read-only,
  // with an escape hatch.
  //
  // The key is a COMMAND rather than an env suffix, and the lane is `ambient` rather than `journalled`, and
  // the two facts are not in tension — they are how this register already spells "a recorded, expiring
  // waiver that is not an outbound send". The `journalled` lane is scoped to the 19 OUTBOUND rows and
  // nothing else, and `src/devLint/escapeHatch.ts` pins that set, so a browser rail moved into it
  // would widen a taxonomy the owner drew deliberately. What the command itself writes is still a grant that names
  // the session, carries a typed reason, expires in thirty minutes and covers ONE page —
  // `src/browser/breakGlass.ts`'s `activeBrowserPageWaiver` will not read a grant that names no page at all,
  // so the session-wide waiver beside it cannot reach this rule by accident.
  {
    caught: "this page is registered read-only, and the interaction can change a page",
    command: "slopweaver browser act on a read-only page",
    exceptions: [
      "the owner asked for this exact change on this exact page in this ask",
      "the page's own read-only rule is wrong and you are about to correct the register",
      "Google's account chooser on a Datadog or GitHub sign-in, and the target is the row `browser sign-in` named " +
        "for the owner's work account",
    ],
    id: "browser-page-read-only",
    key: {
      incantation: 'slopweaver browser break-glass --page <url> --reason "<why this page, this once>"',
      kind: "command",
    },
    lane: "ambient",
    reader: "src/browser/action.ts",
    standing: "proposed",
  },
  // The two halves of a Slack incident, hatched: assert focus before a blind keystroke, and refuse a raw
  // selector. Both refuse an AIM rather than a page, so neither is `browser-page-read-only`:
  // that row's `--page` waiver is about where you are, and these are about what you are pointing at.
  {
    caught:
      "`--do type` and `--do press` carry no element, so the characters go wherever the cursor is, and this one has not established where that is",
    command: "slopweaver browser act --do type|press",
    exceptions: [
      "the keystroke is page-level rather than field-level — Escape to close a modal, a keyboard shortcut — so no element holds the cursor and none should",
      "the field really does hold the cursor and the page describes it in a way the snapshot gives no ref for, and the after-picture is what you will check instead",
    ],
    id: "browser-blind-keystroke",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_BLIND_KEYSTROKE" },
    lane: "ambient",
    reader: "src/browser/actionExecutor.ts",
    standing: "proposed",
  },
  {
    caught:
      "the element was named with a CSS selector rather than a ref out of a snapshot, and a selector that matches two elements resolves to one of them with nothing to say which",
    command: "slopweaver browser act --target <selector>",
    exceptions: [
      "the element genuinely has no accessibility ref — a closed shadow root — and the selector is one you have verified matches exactly one node",
      "the page rewrites its snapshot faster than a read can be cited, so every ref is stale by the time it is used",
    ],
    id: "browser-raw-selector",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_BROWSER_RAW_SELECTOR" },
    lane: "ambient",
    reader: "src/browser/actionExecutor.ts",
    standing: "proposed",
  },
  // `--focus` defaults on, and some conditions hard fail with an escape hatch (good judgement can override).
  // This is that hard fail. The whole point is that the picture shows what is about to be touched, so
  // a picture that does NOT contain the target is evidence-shaped and empty, and printing a warning beside
  // it leaves the reader to notice. It refuses instead, and the fourth line leaves the judgement with the
  // caller.
  {
    caught:
      "the target was scrolled for but did not end up wholly inside the viewport, so the picture taken to show what is about to be touched does not contain it",
    command: "slopweaver browser act",
    exceptions: [
      "the element is taller than the viewport itself — a long table, a whole panel — so no scroll could ever frame all of it, and the part you are aiming at IS in the picture",
      "the page renders the element inside its own scroll region that a document scroll cannot reach, and you have read the picture and can see the target in it",
    ],
    id: "browser-offscreen-target",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_BROWSER_OFFSCREEN_TARGET" },
    lane: "ambient",
    reader: "src/browser/actionExecutor.ts",
    standing: "proposed",
  },
  // Rule 3 bans a LAUNCHED browser. A Codex seat on a home the ChatGPT app configured spawned its cua-repl,
  // which launched a second Chrome that crashed in front of the owner ten times. Every seat and pass
  // switches the known servers off (`codex/browserSurface.ts`); this row is the refusal for one that list does
  // not know by name yet, found on the home's effective server list before a thread can start.
  {
    caught:
      "the Codex home this launch would run on still starts an MCP server that can launch a browser after every browser-off override the launch carries, or its server list could not be read to say it does not, and rule 3 bans a launched browser — a second Chrome aborts beside the owner's and puts a crash dialog in front of them",
    command: "a Codex thread launch (a visible seat, or a codex plan/review pass)",
    exceptions: [
      "the server named is not a browser at all and matched the classifier on a path or environment key it merely shares with one",
      "the listing failed for a reason that is not the home's configuration — the `codex` CLI mid-upgrade, say — and you have read that home's config yourself",
      "the Chrome the owner runs is closed and the owner asked for this Codex to drive a browser of its own",
    ],
    id: "codex-browser-door",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_CODEX_BROWSER_DOOR" },
    lane: "ambient",
    reader: "src/codex/browserDoor.ts",
    standing: "proposed",
  },
  // Rule 3 bans a launched browser from a SESSION'S SHELL too. Measured through the installed hook:
  // `npx @playwright/cli open --extension`, `open -a 'Google Chrome' <url>` and a Chrome binary run with a
  // remote-debugging port each exited 0. The `command` is a default the walk replaces with what it refused.
  // AMBIENT: it refuses a local command before anything is launched. `SLOPWEAVER_ALLOW_RAW` and
  // `SLOPWEAVER_ALLOW_BASH` never open it, and it opens neither.
  {
    caught:
      "it launches or drives a browser outside the slopweaver browser verbs, and rule 3 makes those verbs the one browser door — a raw launch reaches a signed-in browser with no read-before-write register, no profile pin and no screenshot of what it did",
    command: "a raw browser launch",
    exceptions: [
      "you are proving this refusal, or the verb that replaces it, and the command is fed to the hook as a payload rather than run",
      "the slopweaver browser verbs themselves are what is broken, the owner asked for this one launch to diagnose them, and nothing is signed in on the page it opens",
    ],
    id: "browser-launch",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_BROWSER_LAUNCH" },
    lane: "ambient",
    reader: "src/admit/browserLaunchCommand.ts",
    standing: "proposed",
  },
  // A review pass's shell started a stock Electron; the sandbox denied it the WindowServer, it
  // aborted, and the crash alert took focus from the owner's Messenger mid-call. Every pass sets ELECTRON_RUN_AS_NODE=1
  // (`codex/electronSurface.ts`); this row is the refusal for a home whose shell policy drops it.
  {
    caught:
      "a shell this Codex pass would run does not see ELECTRON_RUN_AS_NODE=1 after every override the pass carries, or that environment could not be read to say it does, so an Electron the pass starts would abort in the sandbox and put a crash alert in front of the owner",
    command: "a codex plan/review pass thread launch",
    exceptions: [
      "the home's shell_environment_policy.include_only is deliberate and you have read that this pass cannot reach an Electron binary at all",
      "the sandboxed read failed for a reason that is not the home's configuration — the `codex` CLI mid-upgrade, say — and you have read that home's config yourself",
    ],
    id: "codex-electron-guard",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD" },
    lane: "ambient",
    reader: "src/codex/electronGuard.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
