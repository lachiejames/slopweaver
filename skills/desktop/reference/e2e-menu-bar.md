# A test instance's own menu bar icon — `desktop e2e --menu-bar`

A child page of [`desktop e2e`](e2e.md). The local layer of desktop proof carries a test-mode menu
bar icon under its own name, so a run on the owner's Mac is never mistaken for their app.

```bash
slopweaver desktop e2e --app <candidate> --menu-bar --only queue   # one walk, its own icon beside the owner's
```

- **Only when asked.** A test instance draws no menu bar icon. `--menu-bar` adds
  `--slopweaver-desktop-e2e-menu-bar` beside `--slopweaver-desktop-e2e=<dir>` (`desktop/src/e2eMode.ts`), for the
  walk and every call scenario's launch and relaunch alike. The switch alone, given twice, or given a value, is
  refused at boot, and a malformed launch draws nothing.
- **Named Slopweaver Test everywhere it shows** (`desktop/src/trayPresentation.ts`): `Slopweaver Test` beside the
  icon, its tooltip led by `Slopweaver Test · `, its first line `Test instance · <build>`, its last item
  `Quit Slopweaver Test`. The menu is the owner's, less what a test instance never started: no fleet line, no Open
  Sessions, no permissions items, no triage (`desktop/src/trayMenu.ts`). The owner's own icon is never replaced or hidden.
- **Refused on a bundle that cannot draw it.** A bundle without `SlopweaverDesktopE2EMenuBarProtocol` 1 in its
  `Info.plist` is refused `UNSUPPORTED_MENU_BAR_BUILD` before anything launches (`src/cli/commands/desktop/e2eBundle.ts`),
  rather than walked with no icon. The base `SlopweaverDesktopE2EProtocol` stays at 2.
- **Not clicked yet.** No step presses the native menu, and Playwright cannot reach it. Clicking it is a follow-up;
  until then the icon is checked by eye on the running instance.
