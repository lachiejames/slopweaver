# The floating note — how it is drawn, and the two measurements that decided its shape

The note is a generated application bundle under `$SLOPWEAVER_HOME/hand-steps/notes/<token>/note.app`, one
per raise and never rewritten, launched with `open -n -a`. Everything that decides anything is pure
(`src/hand/note/panel.ts` with its button band in `band.ts`, `src/hand/note/bundle.ts`,
`src/hand/note/liveness.ts`); `src/hand/note/raise.ts` is the effectful edge that draws, and
`src/hand/note/markers.ts` the one that writes and lists the answer markers a note, a settle or a snooze leaves.

## Why a bundle rather than a process

`no-headless` bans every asynchronous `node:child_process` member outright, with no allowlist and no marker,
so a verb cannot start something that outlives it by spawning. What it CAN do is `execFileSync("open", …)`,
which hands the launch to LaunchServices and returns — the same primitive `src/browser/foreground.ts`
already uses. `open` needs an app to open, so the note is one.

That is not a way around the rule. Rule 2's property is VISIBILITY, and a floating window is the most
visible thing this repository draws: the owner can see it, move it and close it, and it runs no model. NH005 bans a
launchd JOB DEFINITION — a `.plist` carrying `Program` or `ProgramArguments`; an application bundle's
`Info.plist` names its executable with `CFBundleExecutable`, a different key describing a different thing.
`src/__tests__/unit/hand/panel.test.ts` asserts the absence of both banned keys rather than trusting it.

## The two things measured on the owner's machine

**An `NSPanel` is the only surface with all three properties at once.** At `NSFloatingWindowLevel`, with
`NSWindowStyleMaskNonactivatingPanel`, under activation policy `Accessory` and raised with
`orderFrontRegardless`, it floats above cmux, Chrome and Slack and never takes keyboard focus. A
`display dialog` is modal and steals the foreground; a notification is transient; a Chrome app window is the
browser the owner asked to be outside of.

**The buttons carry NO target and NO action, and that is forced.** Written first with `ObjC.registerSubclass`
and `setTarget`/`setAction`, the panel worked when the file was handed straight to `osascript` and **hung
forever** when the identical file was launched through the bundle — which is the only way it ever runs.
Sampling the stuck process:

```text
ObjC.registerSubclass → +[JSOCClosure staticPointerValueWithType:invocationBlock:]
  → ffi_closure_alloc → dlmmap → open_temp_exec_file_dir → mkostemp → openat   (spinning, ~1500 samples)
```

Registering a subclass makes libffi mint a writable-and-executable temp file for its closure trampolines, and
that allocation never completes for the process LaunchServices starts. No window was ever drawn and the
clipboard was never written, while the process burned 73% of a core. So the panel uses
`NSButtonTypePushOnPushOff` and READS `button.state` in the loop it already runs: no ObjC closure is ever
built, and at rest it costs 0.2% of a core.

**The event mask is a literal, because `$.NSEventMaskAny` makes every one of those buttons dead.** Reading
`button.state` only works if the press reaches the button, and under that constant it does not: `NSEventMaskAny` is `NSUIntegerMax`, the JXA bridge hands it back as a double that cannot hold
it, and what arrives at the unsigned parameter matches no event at all — so the panel dequeued **zero**
events for its entire run. The symptom was the later and done buttons doing nothing when pressed.
Measured on the owner's own machine, by synthesizing a click over **Done** with `CGEventPost`
and logging the dequeue count: **0** events under `NSEventMaskAny` and no marker; **5** events, the button
latched and `<id>.done` written under a literal mask. The program spells `0x1FFFFFFFFFFFFF` — `2^53-1`, the
largest SAFE integer — covering bits 0 to 52, every `NSEventType` the installed SDK declares, so nothing is
left sitting in the queue either. Read the top of that range out of the header, not out of this paragraph:

```bash
grep -n 'NSEventTypeMouseCancelled' "$(xcrun --show-sdk-path)/System/Library/Frameworks/AppKit.framework/Headers/NSEvent.h"
```

**That loop pumps `NSApplication`, not `NSRunLoop`, and the difference is a beachball.** The owner hit it first-hand the
first time a note reached the screen: a rainbow cursor when hovering it. A bare `NSRunLoop.runUntilDate` services timers and sources
but never DRAINS the app's event queue, so the window server reads the process as not taking its events and
draws the spinning wait cursor over its window. So the loop calls
`nextEventMatchingMaskUntilDateInModeDequeue` and `sendEvent`, after one `finishLaunching`, keeping the same
`pollSeconds` budget for the button read. The witness is structural rather than a hover, and it is checkable
in one command:

```bash
slopweaver hand show <id>
sample $(pgrep -f Resources/panel.js) 2
```

The main thread parks in `-[NSApplication nextEventMatchingMask:untilDate:inMode:dequeue:]` → `_DPSNextEvent`.
A bare run loop parks in `-[NSRunLoop runUntilDate:]` → `__CFRunLoopRun` with no AppKit event frame above
it at all, which is exactly the shape that earns the wait cursor.

## The clipboard line is CHECKED every poll, and clicking the command copies it again

The pasteboard is one shared slot, so a claim written once at launch decays the instant anything else takes
it — a second note, or the owner's own ⌘C — and an unconditional `copied to your clipboard` is then false. So the panel re-checks every poll: still ours reads `on your clipboard · click the
command to copy it again`, else `your clipboard has moved on · click the command to copy it`; a checklist line's
command is checked the same way ([the checklist](checklist.md#on-the-note)). The queue card has a copy button.

**The line is true as of the last poll, not as of this instant, and that residue is kept rather than
chased.** AppKit offers no notification on `changeCount`, so a write landing just after a refresh — or
between the check and the caption's own `setStringValue` — leaves it one poll stale (`POLL_SECONDS`, longer
under an AppKit tracking session), and closing that needs a tighter spin or a second process. Latency is not
the defect this closes: an unchecked claim is wrong for as long as the note stands.

**The token is the count `clearContents` RETURNS, retained only when the write then succeeded — never a
`changeCount` read back afterwards.** A read-back is worse than no check at all: this note writes, another process writes, the read-back adopts THAT
process's count, and every later poll matches it while telling the owner the literal is on the owner's clipboard,
permanently and silently. `setStringForType` returns `false` once ownership has moved on, which is why the
token is conditional; both sides are stringified because a JXA-bridged `NSInteger` does not compare `===`.

**And the count is a PRE-FILTER, never the answer — a match is confirmed against the string itself.** A
mismatch answers "moved on" for free; a match costs one string read, and it has to. Measured on
the owner's machine: a second process calling `setStringForType` with no `clearContents` replaces the contents IN
PLACE and leaves `changeCount` where it was. Reproduce it — clear, write `LITERAL-A`, write `FOREIGN-B` with
no clear, read the count back unchanged and the string back as `FOREIGN-B`:

```bash
osascript -l JavaScript -e "ObjC.import('AppKit'); var b=\$.NSPasteboard.generalPasteboard;
var n=String(b.clearContents); b.setStringForType(\$('LITERAL-A'), \$.NSPasteboardTypeString);
b.setStringForType(\$('FOREIGN-B'), \$.NSPasteboardTypeString);
'token '+n+' now '+b.changeCount+' holding '+b.stringForType(\$.NSPasteboardTypeString).js"
```

**Clicking the command itself copies it, through a transparent button, because a selectable `NSTextField`
did not serve that click here.** Selection needs a field editor and a field editor needs the window to be
key. Measured on this panel — nonactivating, `Accessory` policy, `orderFrontRegardless` — a
synthesized drag across the literal delivered ONE event and highlighted nothing, and ⌘C after it left the
pasteboard on its sentinel. Whether another spelling takes key without activating the app was NOT
established and is not worth chasing: never stealing the owner's focus is the note's reason to exist. An `NSButton`
with `setTransparent(true)` over the literal's frame takes the click and draws no pixel — AppKit documents
that a transparent button still tracks the mouse. A labelled **Copy** sits in the band too, so the band is
(`Open`) · `Copy` · `Not now…` · `Done` at 84pt each, with a 28pt channel `panel.test.ts` asserts.

Reproduce all three halves:

```bash
H=$(mktemp -d)
slopweaver hand post --home "$H" --standalone --blocks --id probe --what "Sign in" --literal "hello" --where "any terminal" \
  --unblocks "a probe" --witness "slopweaver hand done probe --did x"
pbpaste                                   # => hello, so no registerSubclass hang swallowed the copy
screencapture -x /tmp/n.png               # => the note, top right
printf 'something else' | pbcopy          # the line flips within POLL_SECONDS
# click the command, then Done
ls "$H"/hand-steps/dismiss/               # => probe.done
slopweaver hand list --home "$H"          # => the step no longer listed as waiting
```

## A step's details fold behind one row the owner opens

The fleet-health note needs a drop-down showing everything failing, when it failed and why. A step's `details` (`src/hand/details.ts`) draw as a **▸ Details (N)** row under the
footer; clicking it — a transparent overlay, exactly as the literal's — grows the panel downward, top edge kept,
and shows each line as an entry, its reason as wrapped prose, in a region that scrolls under a height cap
([the layout](the-note-layout.md#the-opened-details-region-entries-and-a-scroll-cap)). Folded is the default and
the fit ignores them, so they never grow the collapsed note. The SCHEMA caps them (12 lines, 320
characters each) and REFUSES past either, so a poster composes inside the caps: rule 7's shape, never truncated
into a list that reads whole and is not.

## The note is FITTED to the display, and that is its own story

Any field can grow the panel past the screen and carry the button band off it, which is "the buttons do
nothing" by a second route. How every row is levelled to fit, what is never clamped, and the measurements
behind both: [fitting the note](the-note-layout.md).

## Open, and notes that stack

A step carrying `--url` draws a filled blue **Open** first. One note is up per step, and several steps' notes
stack, cascaded so every title stays readable, whichever verb raised them. Why the button is a layer, the liveness
protocol, the cascade, what was measured and the stated residue: [Open and notes that
stack](the-note-open-and-liveness.md).

## `-n` is not optional garnish

Without it, `open` resolves the bundle ID, sees a note already running and merely ACTIVATES it — so a second
step posted while a first note is up draws nothing at all, silently. Measured the same day: `open -a` against
a running note left the pasteboard untouched and no window appeared; `open -n -a` drew it.

## The injection boundary is ONE `JSON.stringify`

A step carries a literal the owner is about to paste — a key, a command, a token — chosen by whatever recorded the
step. The program is a CONSTANT; the only thing composed per step is a single `const STEP = <json>;` line, so
nothing a step says is ever concatenated into syntax. The test asserts the emitted line exactly, with a
literal carrying a quote, a newline and a `});`, and asserts those bytes appear on no other line.

## The owner's click becomes a row, through a file

The panel has no CLI of its own and must not hard-code a path to a worktree that gets removed constantly. So
**Done** writes `<home>/hand-steps/dismiss/<id>.done` and a snooze answer writes `<id>.snooze-<choice>`, and
every verb that reads the register reconciles first (`src/hand/reconcile.ts`). A `done` marker appends a
settling row quoting the marker's own stamp; a snooze marker writes no row. That asymmetry is the rule: a
register that treated a note taken down as finished work would report work that never happened. **Not now…**
is the snooze band, never a bare dismiss; on a monitor's card it ends in **More…**, whose `<id>.mute-kind` and
`<id>.when-worse` the reconcile never reads — the monitor lane records them: [snoozing](snoozing.md).

The panel also closes itself when a marker for its step appears from anywhere — which is how `hand done` in a
terminal takes down a note that is still floating. While rapid triage is on, a note also carries **Pause timer** and
**Triage off**, each press a file the shell hands the voice (`src/hand/note/triage.ts`, [triage](../../../docs/console/voice-triage-pass.md)).

## Where the fleet-actor refusal ends

Measured, it is a **tell, not a fence**. The criterion is a
determiner plus one of five nouns (`session`, `fleet`, `bot`, `agent`, `supervisor`), or `slopweaver` plus a
modal — so `Slopweaver will rebase the branch` is refused and `Slopweaver rebases the branch` is not, and
`Codex reviews the diff` names no noun in the set at all.

The escape is the wider half of the two: `ownHandAction`'s imperative arm fires on ANY sentence opening with
one of its verbs, and it runs BEFORE the fleet check, so `Push the branch the bot already rebased` passes on
its first word. Both are the design rather than a gap to close quietly — a false refusal costs a session the
ability to file a step the owner really does have to take, a false pass costs one junk row the owner can see and `hand
done` clears. Widening the noun set is cheap and safe; widening the escape is neither. Reproduce either end:

```bash
slopweaver hand post --standalone --blocks --id fleet-actor --what "Slopweaver rebases the branch, so the fix can land" --unblocks y --witness z --quiet --no-address "repro" --home "$(mktemp -d)"
```
