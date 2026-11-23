# Golden-proof capture — a real terminal, recorded with no window at all

A PR's Proof of the solution has to carry evidence a reviewer can see, and for a dependency change the evidence is two
real `yarn why` runs side by side. Retyping the output into a fenced block is not that. This verb runs both
for real and composes one labelled image.

```bash
slopweaver proof yarn-why --dep @datadog/datadog-api-client --before ../staging --after . --out ~/.slopweaver/proof/<pr>/yarn-why.png
```

`--out` is refused inside any git checkout, before a pane is recorded: a proof image belongs under the home or
a scratchpad and reaches the pull request as an attachment, never as a committed file.

`--before` and `--after` are two worktrees. It records a pane per side with [VHS](https://github.com/charmbracelet/vhs),
runs `yarn why` in each, captures both, extracts each side's real resolved-version text, and composes a
labelled before/after PNG.

## Why VHS, and not Terminal.app

The rule is that a proof capture is **invisible** — it must never put a window in front of whatever the
owner is doing. Driving Terminal.app through `osascript` with the window positioned past the display's bounds
cannot work on this macOS: the bounds are **clamped back onto the desktop**. Measured:
`{2000, 2000, 3400, 2900}` was set and read back as `{11, 236, 1512, 861}`:

```bash
osascript -e 'tell application "Terminal" to set bounds of window 1 to {2000, 2000, 3400, 2900}' \
          -e 'tell application "Terminal" to get bounds of window 1'
```

So that path puts a real window on the owner's desktop, and is not tunable. VHS opens no window: it serves a real pty over loopback with `ttyd` and renders the frames in a headless
browser. The only process it adds, confirmed live with `pgrep -fl ttyd` during a run, is
`ttyd --port=<n> --interface 127.0.0.1 … --once --writable bash --noprofile`.

## Three tape properties that are load-bearing

Each was measured against `vhs` 0.11.0 before being encoded, not assumed:

- **The capture is a recorded FRAME, never VHS's own `Screenshot` command.** `Screenshot` is deferred to
  the end of a run and produced by a separate `ffmpeg` pass; when that pass finds nothing to work with, VHS
  still exits 0 having written no file. Measured 7/8 and then 5/6 over repeated identical runs of the same
  tape, and tuning the sleeps around it only moved the rate:

  ```bash
  for i in $(seq 8); do vhs t.tape >/dev/null 2>&1; test -f shot.png || echo MISS; rm -f shot.png; done
  ```

  `Output "<dir>/"` instead writes every frame as it records, so the last `frame-text-NNNNN.png` either
  exists or the run failed — there is no third outcome. `Set Framerate 5` keeps that cheap: the default 50
  spends 27MB of scratch per pane (572 text frames for one `yarn why`) to produce the same image.

- **`Wait` is a real completion signal, not a timer.** A tape whose visible command was
  `sleep 12 && yarn why neverthrow` took 22s wall-clock and captured the finished tree; one with
  `Set WaitTimeout 3s` over `sleep 30` failed with `timeout waiting for "Line" to match >$`. It is why
  nothing needs a sentinel file or sleeps a fixed guess for the command itself.
- **The trailing `Sleep` is what makes the last frame the settled pane.** It holds the finished screen on
  camera after `Wait` returns, so the final frames are all the same completed output rather than a
  mid-redraw one.

The worktree never appears in the tape: `vhs` is run **from** it and the pty inherits its cwd (a tape run
outside a Yarn project fails `proto::detect::failed` instead). That is a requirement rather than a
convenience, because VHS's `Type "…"` does not honour backslash escapes — `Type "echo A\"B'C\\D"` types
`echo A\ B C\\D"` into the pty. Anything that must be interpolated is therefore **refused** unless it is
already tape-safe: the dependency must be a package name, and the frames directory must be absolute and
free of quotes, backslashes and control characters.

## Where it lives

`src/proof/yarnWhy/` — `orchestrate.ts` (the top-level flow), `tape.ts` (the tape, the frame picker and
what they refuse), `vhsExec.ts` (the `vhs` seam), `capture.ts` (write the tape, run it in the worktree,
take the settled frame), `runYarnWhy.ts` and `resolvedVersion.ts` (the text side), `compose.ts` +
`pixels.ts` (the side-by-side image).

Composition is `jimp`, deliberately **not** `sharp`: `package.json` already portals `sharp` to a no-op stub
because it is a native binary that breaks cross-platform installs, and that portal resolves repo-wide. Jimp
has no native dependency and bundles its own bitmap fonts, so it needs nothing beyond `yarn install`.

## What it does NOT do

- **It needs `vhs` on `PATH`** (`brew install vhs`, which brings `ttyd` and `ffmpeg`). There is no fallback
  and it will not silently degrade to one.
- **It captures one side at a time.** Each pane is a whole `vhs` run; with no window to keep out of the
  way, running both at once bought nothing but a second `ttyd` and headless browser on the same machine.
- **It captures; it does not judge.** Nothing here decides whether the before/after difference is good.
- **It is not a general screenshot verb.** The whole flow is shaped around one `yarn why` pane per side —
  see [the pull-requests reference](../skills/github/reference/pull-requests.md) for which proof grade an
  image like this supports.

## A recording: a cassette

A terminal RECORDING is a different deliverable from the still above, and it has its own verb:

```bash
slopweaver proof cassette --tape ~/.slopweaver/proof/<pr>/demo.tape --out ~/.slopweaver/proof/<pr>/demo.mp4 [--cwd <dir>]
```

The session writes the tape's commands; the verb owns the two properties a Proof
cell must not have — a looping GIF with no timeline controls, and fifteen seconds spent typing out a prompt.
Both were tape properties, so `src/proof/cassette/tape.ts` refuses a tape that sets them:

- **The output is one `.mp4`, written by the verb.** A tape naming its own `Output` is refused, because VHS writes
  EVERY output line and a stray `.gif` would still be produced. The `.mp4` is h264/yuv420p and plays inline with a
  scrubber and a duration; `github attach upload` refuses any GIF, which no capture verb writes.
- **It files the capture receipt `github attach` requires.** The verb also writes VHS's text output beside the video
  (`<out>.txt`), strips the container's metadata with ffmpeg, and records the recording's transcript as its frame
  text, so attach scans the words a reader watches scroll past. No transcript means `incomplete` frame text, which
  attach refuses. The transcript output has not yet been measured against a live `vhs`; the strip is measured in
  `src/proof/cassette/finalise.ts`.
- **Typing is 5ms a character, and never slower than 10ms.** VHS's own default is 50ms: one 300-character prompt
  measured 16.2s as a GIF against 2.96s through this verb. A slower `Set TypingSpeed` or `<Command>@<d>` (on `Type`
  or any key), or a `Set PlaybackSpeed` below 1, is refused by line; a faster one is kept. When human-speed typing IS the claim (a debounce, an autocomplete),
  `SLOPWEAVER_ALLOW_SLOW_CASSETTE=1` lets it through. `Source` is refused, since the check cannot read the tape it
  pulls in.

Measured against `vhs` 0.11.0: a `Set TypingSpeed` placed before `Require`, and an `Output` placed
after the last command, both take effect — which is why the verb can prepend one and append the other. Reproduce
the timing with `ffprobe -v error -show_entries format=duration -of compact <file>`. `--out` is refused inside a
git checkout, exactly as `yarn-why`'s is, and `--cwd` is the directory the recorded shell starts in.
