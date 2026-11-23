# Note links

A child page of the [desktop README](../README.md): a floating note's console link opens in the desktop app, never
your browser — a Queue address in the Queue's one pinned tab, any other page in a new tab. The policy is
`deepLink.ts`; the effect is `launch.ts`; the note's half is `src/hand/note/desktopLink.ts`.

## Why

A briefing link should open a new tab inside the desktop app, never Chrome.
Every note link went through `NSWorkspace.openURL`, which hands an `http://localhost` address to the default browser.

## What it does

The app claims the `slopweaver:` scheme (`build.protocols`), and `slopweaver://open?path=<console path>` opens that
page as a new tab in front; a bare document such as a published page lands in the viewer, as any link's does. A cold
launch's address arrives before `ready` and waits for the boot's tabs.

**The Queue is the one exception, and has one tab.** A path whose pathname is exactly `/queue`, with any query or
hash (a card's `?open=`, a Settings `#settings/…`), goes to the pinned Queue tab and shows it, never a second Queue
tab (`deepLinkTarget`). Otherwise the voice's `browser_open` of the Queue opens a
duplicate, and the next card follows it there, away from the one static tab that never closes. `/queue/`, `/alignment` and every other page still open beside it. A
relaunch drops a saved tab beside the pinned one that this criterion would send to it (`restoredStrip`), so a
duplicate an earlier build saved is gone the first time the app starts on this one.

The note opens a console link through that address with the bundle at `/Applications/Slopweaver.app` directly, once
that bundle's identifier reads `ai.slopweaver.desktop`, the way `browser present`'s `open -a` does, so another app holding the scheme never
receives a console path (`OPEN_LINK_JS`, `src/hand/note/desktopLink.ts`). A verified bundle that fails to launch is
never a fall back to the browser. With no canonical install it opens the link with the app LaunchServices hands the
scheme to, directly, when that is `ai.slopweaver.desktop`, and only with no desktop app at all does the link open in your browser. A backslash in
a link's query or fragment is percent-encoded so the app takes it, and a console link the app still refuses opens
nothing while a desktop app is there. A Slack permalink or a provider page is never a console link and always opens
in the browser.

## Every other opener

Queue cards and briefings open inside the desktop app as deep links, in new tabs generally, never in the
browser. So the same address carries every published page you are sent to. `browser present --page <slug>` (the voice's `open_card`
and `browser_open`) hands it to the canonical installed bundle (`open -a /Applications/Slopweaver.app`,
`src/browser/presentDesktop.ts`) once its `CFBundleIdentifier` reads `ai.slopweaver.desktop`, and tells the voice
which tab it landed in (`desktopOpenNote`, from `src/desktop/deepLink.ts`'s `desktopDeepLinkTab`, which
`desktop/__tests__/unit/deepLink.test.ts` holds to the app's own `deepLinkTarget`). Chrome is taken only
where nothing is at that path; anything else there (a link, a file, a foreign or unreadable identifier) is an error
naming `slopweaver desktop install`, never a fall back. `page publish` prints it on its
second line. A failure toast's "Open in new tab" opens its card as a tab directly. The root side mints it once, in
`src/desktop/deepLink.ts`.

## Least privilege

Only one page shape is taken: one `path` query on the `open` action, a path on the console, never `/voice` and never a
path the app would read as another host. The only other addresses are a launcher's bare `slopweaver://open` and
`slopweaver://voice` ([launcher commands](launcher-commands.md)). Anything else is dropped, and the note never hands the app a link it would
drop, nor any app but this one a console path; `slopweaver desktop install` registers the one copy it installs and
unregisters every other Slopweaver bundle.
