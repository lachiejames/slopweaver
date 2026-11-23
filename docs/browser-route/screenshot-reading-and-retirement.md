# Read the screenshot you just took

Part of [The browser route: the owner's real Chrome, and nothing else](../browser-route.md).

The other half of the same ruling, and the one with a number behind it. The owner opened the
CrowdStrike console artifacts (`~/.slopweaver/atlas/crowdstrike/artifacts/console`) personally and found most
of the screenshots were loading spinners — what happens when nobody reads the screenshot that was taken.

**MEASURED across the captured PNG population: a substantial cluster of the
CrowdStrike console captures was the same loading-spinner frame, and one Xero page was uniformly
blank.** A walk reports `artifactsWritten` and a spinner is a written artifact, so every count said the walk
had gone fine.

`isUnrenderedScreenshot` (`src/atlas/kit/browserWalk.ts`) is that read made mechanical: a capture is graded
on its compressed density — bytes per pixel, read from the file's own IHDR — before it may be credited as a
picture. The distribution is **bimodal** and the threshold sits in the gap: every unrendered capture lies in the
lower cluster and the next real capture is separated from it by a clear gap. Every
unrendered capture was opened and confirmed blank, and nothing that had rendered fell below the line. Reproduce
the whole distribution with the command in that constant's own comment.

A page that fails the grade is a **named gap** rather than a silence — `unrenderedPages` on the walk result,
raising `console-page-unphotographed`, and `unphotographed` on a GitHub admin page's own row.

## Reading the shot is what makes looking again possible

Grading and stopping there would have turned 97 spinners into 97 gaps, which is a truer atlas and not a
better one. `visitPhotographed` (same module) is the acting half: a capture that fails the grade is
photographed AGAIN after `RENDER_RETRY_SETTLE_MS`, and only a page that spins through both looks becomes a
gap carrying `UNRENDERED_SCREENSHOT_BECAUSE`. Ten seconds is a policy choice stated as one — every walk's own
`settleMs` is tuned for a page that renders, and these are exactly the pages that did not manage it in that
budget. Only a page that already failed pays it.

Three cases are deliberately not retried, each because a second look cannot answer them: a visit that failed
has no capture to grade, a capture with no screenshot at all is a different gap the walk already records, and
a retry that trips over one bad address keeps the FIRST capture rather than throwing away its response
observations. A retry that loses the SESSION propagates, because every page after it is doomed too —
`isWalkStoppingError` in `src/browser/pageTransport.ts` is that distinction, which six walks had each spelled
out for themselves.

## Every walk, not the three that were touched first

The class is wider than any one walk, so the grade sits on every path that writes a page photograph: the shared engine (`kit/pageWalk.ts` through `kit/pageScreenshot.ts`, which is Xero's), CrowdStrike, GitHub, Linear,
Notion, nx Cloud and Trelica. The document-driven route (`kit/walkVerb.ts`, GraphQL Hive and WorkOS) grades
too and cannot retry — a visible session took the picture and there is no transport here to take another — so
an unrendered file is skipped and NAMED, and the page falls to reached-but-not-photographed rather than being
published as evidence of a surface nobody can see.

## What was retired, and what it cost

| lane                | was                                                                                                                                  | is                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `github attach`     | `attach login` / `attach import`, a `0700` `github-web-profile`, and `github-web-session.json` at `0600` — a live credential at rest | cookies read from the owner's own Chrome per call; two sub-verbs, `upload` and `status`                                          |
| `datadog shot`      | a headless Chromium on `datadog-web-profile`, plus `shot login` / `shot status` / `--cdp`                                            | `shot monitor` captures through the relay into the owner's Chrome; `shot explorer` prints the plan; `shot file` grades           |
| `notion verify`     | a visible Chromium on `notion-web-profile` with a `--login` wait                                                                     | with no `--observation` it prints the brief; with one it judges the measurement                                                  |
| `atlas slack-drive` | a visible Chromium on `slack-web-profile` walking the workspace                                                                      | `plan` prints the brief; `sync --session` publishes from the walk document; `refresh` is the unattended API half plus that brief |

Two costs, named rather than discovered:

- **`attach upload` cannot heal a signed-out browser itself.** It refuses in one line naming the exact
  action and publishes `needs-owner-login` so the block is visible where the owner reads. In exchange, the cause of
  the incident that behaviour was built for — a captured session ageing out in a profile nobody looks at —
  cannot occur at all.
- **`notion verify`'s measurement is a PAGE SCRIPT, and no `slopweaver browser` verb runs one**: a caller
  picks a declared relay operation, never code. So that step of its brief rides `browser/brief.ts`'s
  `no-verb-yet` arm and names what would close it — a declared operation beside
  `src/browser/notionSettingsSnippet.ts`. The screenshot half is reachable: `browser shot` photographs a
  `read-before-write` provider, which Notion is (`src/cli/commands/notion/verifyRun.ts`).

## The new access this took

Reading Chrome's cookie jar means asking the OS keyring for `Chrome Safe Storage`, which prompts once per
binary. **That is a genuinely new access**, it was not named in the ruling, and it is stated here rather than
buried. What it buys is the removal of a credential at rest — the session file it replaced held the same
cookies and sat on disk indefinitely. What it costs is the ability to decrypt any cookie in that profile;
the code narrows to one origin per call, returns nothing else, and VERIFIES the 32-byte host digest Chrome
embeds in each plaintext rather than stripping it, so a value bound to another site cannot be assembled into
a header for this one. No cookie value is ever printed, logged, synced or written.
