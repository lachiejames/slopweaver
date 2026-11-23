# Launcher commands

A child page of the [desktop README](../README.md): two addresses a launcher or a keyboard shortcut runs, one to
open the app and one to open it and start the voice. The policy is `deepLink.ts` (`deepLinkAction`); the effect is
`launch.ts`.

## Why

The app was listed in launchers (Raycast, Spotlight, Launchpad), but nothing started the voice from outside it: the
menu bar's Start voice was the only way in. The need is two commands, open it and open it
and start voice immediately, each bindable to a key or runnable from a launcher.

## The two addresses

| Address              | What it does                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `slopweaver://open`  | Brings the app forward where you left it, as a Dock click does; a cold launch lands on the Queue. |
| `slopweaver://voice` | Starts the voice exactly as the menu bar's Start voice does, launching the app first if needed.   |

`slopweaver://voice` IS the menu bar item (`commandOverlay` with `activate`). The call starts in the voice's own
window over whatever you are working in; the address never raises the console window itself, because starting a call is
no window move (a cold launch's boot still shows the Queue). With the voice's call up or still connecting, a second
press only brings the voice back (`site/components/voice/useShellCommands.ts`); a voice you hid with the X comes back;
while the console window holds the microphone it refuses the second call. A console window still connecting a call of
its own, before it holds a microphone, is not seen, for the menu bar item exactly as for this address. On a cold launch it waits for the boot's tabs and then for the voice's page to listen, so "immediately" is
as soon as the local console serves that page.

Each address is taken exactly as written — nothing after it, not a `/`, `?` or `#` — so a launcher can only ever ask
for one of the two fixed acts.

## Binding them

Any launcher that opens a URL runs them; from a shell, `open 'slopweaver://voice'`.

- **A keyboard shortcut with nothing installed**: in the Shortcuts app, a new shortcut with one **Open URLs**
  action holding the address, then **Add Keyboard Shortcut** in its details.
- **Raycast**: a Quicklink whose link is the address, given a hotkey in Raycast's Extensions settings; Alfred or any
  other launcher through whatever it uses to open a URL.

The address goes to the app LaunchServices holds the scheme for, which `slopweaver desktop install` makes the one
`/Applications/Slopweaver.app` ([note links](note-links.md#least-privilege)). `slopweaver desktop e2e --call --only
launcher-voice` proves a call started this way goes live, hears a caller turn and answers, on a test instance whose own
`open-url` handler is handed the address, never through your own app.

## Least privilege

Opening `slopweaver://voice` requests a call: your microphone and a call on your plan. So the address is narrow — it
carries no page, no prompt and no text, and the app's own pages cannot reach it (`openOutside` hands only `http`,
`https` and `mailto` to the system). It does not bypass macOS's microphone permission, and the call is the one your
menu bar item starts, its glow on screen. Any local process can open it, though, and a browser's "Open Slopweaver?"
prompt is not a boundary to rely on: Chromium remembers a per-site choice and a policy can skip the prompt. A token or a confirmation would defeat a one-key start, so neither is added; the bound is that the address
can only ever ask for the one call.
