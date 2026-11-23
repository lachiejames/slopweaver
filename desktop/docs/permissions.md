# The permissions guide

A child page of the [desktop README](../README.md): how a fresh Mac is walked through the three macOS permissions
the voice needs, why System Audio Recording is one of them, and the optional mouse and keyboard control step. Which permissions a page may use at all is
`permissionsShell.ts`; reinstalling, and when an install clears the grants, is [the skill](../../skills/desktop/SKILL.md).

## One floating window, three steps

A first install otherwise meets Screen Recording and the microphone with no guide. The guide
(`permissionGuide*.ts`, applied by `permissionGuideShell.ts`) walks them in order: the microphone, System Audio
Recording, then Screen Recording. A floating window at the top-right, beside System Settings, shows an animated
System Settings — a pointer to the app's row, the row lit, its switch pressed on — with numbered steps and one
button: Allow (macOS's own prompt, never asked yet) or the exact Privacy & Security page (refused).

It ticks a switch off as it turns on, re-reading macOS while it is up, and offers Reopen once a visited switch
still reads off, never during a call and never for System Audio Recording. It raises itself as the installed app opens with a
permission off you have not said Not now to, from the menu bar's "Turn on …" item, and the moment the voice meets a
refusal. A management profile's permission gets no button. Automation of cmux stays the fleet note's own step.

## Mouse and keyboard control is an optional fourth step, off by default

The app's mouse and keyboard control stays OFF until the owner turns it on, offered as a consent step.
It is macOS's Accessibility permission, and no voice call needs it, so it is never counted missing: it raises no
guide at launch, names itself in no "Turn on …" item, and never changes the headline (`inputControlConsent.ts`).

The guide draws it as a grey row tagged Optional, and offers it only once the three voice permissions are on:
"Turn on mouse & keyboard control", or Not now. Not now is remembered (`inputControlConsent` in `state.json`) and
the offer stays quiet until the owner reopens it from the menu bar's "Mouse & keyboard control…" item. Accepting is the
one press that may raise macOS's own prompt (`isTrustedAccessibilityClient(true)`); every other read passes `false`,
which never prompts. Accepted but not yet trusted, the step opens the Accessibility page in Privacy & Security.
It reads On only once the owner accepted AND macOS trusts the app: a trust macOS already holds, from an earlier
install or a switch turned on by hand, is never the owner's yes, so it still offers before they answer and stays
Not now after they decline.

## System Audio Recording is asked before any call needs it

macOS's coreaudiod asks "System Audio Recording Only" (`kTCCServiceAudioCapture`) of an app the first
time its audio starts and on every change of the default device, synchronously: until it is answered, every app's
audio on the Mac waits. Asked mid-call, on a switch of headphones, it stalled the call's audio. No Chromium or Electron
switch owns the ask, so it cannot be turned off; it can only be answered first. The guide walks it second, on Screen
Recording's own Settings page (`Privacy_ScreenCapture`, its "System Audio Recording Only" list).

Electron 44 cannot read or ask it. `native/SystemAudioPermission.swift` does, through TCC's private
`TCCAccessPreflight` (never prompts) and `TCCAccessRequest` (raises the prompt); TCC answers for the app that
spawned it. `yarn native:build` compiles it with `xcrun swiftc`, and both `yarn start` and `yarn app` run that
first; the packaged app carries it at `Contents/MacOS/slopweaver-system-audio`, and `desktop install` refuses a
build without it. `systemAudioPermission.ts` decides where it is and which of its answers are a status;
`systemAudioPermissionShell.ts` runs it with no shell. A read the helper fails shows the step as not known, with
the reason, never as on. Allow is pressed once per run: a request that had no answer in five minutes stops its
helper but may leave macOS's prompt up, so the step then offers the Settings page instead of a second prompt.

Residue, named: the SPI is private, so a macOS release may change it, and the read then fails visibly rather than
passing. Never run the helper's `request` without you at the Mac — an unanswered prompt stalls the whole Mac's
audio until it is answered or `tccd` is restarted.

## The window-picker bypass prompt comes back every 30 days

Listing the screens through `desktopCapturer.getSources` (`nativeCaptureShell.ts`, `permissionAskShell.ts`,
`permissionsShell.ts`) makes macOS ask whether the app may "bypass the system private window picker and directly
access your screen and audio". Observed on macOS, not established by this source tree: it is its own consent, so
the Screen Recording switch can already be on; `replayd` keeps the answer per bundle id in
`~/Library/Group Containers/group.com.apple.replayd/ScreenCaptureApprovals.plist` and asks again once it is 30 days
old (`kScreenCapturePrivacyHintPolicy`, 2592000 seconds by default); and the prompt offers no permanent choice.
Every install keeps the one bundle id (`BUNDLE_ID`, `src/desktop/installPlan.ts`), so a reinstall does not restart
that clock. cmux captures too, and asks on its own record and its own clock. Allow holds
for the 30 days, and nothing in the app extends it.
