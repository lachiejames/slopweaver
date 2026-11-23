# `fseventsd-bloated`: the owner's root restart, never during a call

fseventsd once held 10.34 GB at about 110% CPU, and every hook on the machine queued behind it. Only a
restart clears that, and it needs root, so the card puts `sudo killall fseventsd` on the owner's pasteboard (read from
`WATCHED_DAEMONS`, `src/live/machine/daemonWatch.ts`). The line is 2 GiB, above `machine watch`'s 1 GB
investigate line, because this asks for an act with a cost. One card per balloon, keyed by fseventsd's pid: a restart
gives a new pid, and the next pass reads clear and settles the card.

- **Never during a call.** The restart itself stalled configd for about a minute while the new fseventsd rebuilt
  (measured once): watchdogd killed configd and the IPv4 routes dropped for about 370 ms, which dropped
  the owner's call. So while any console holds a live call lease (`src/desktop/callLeases.ts`, the same read the desktop
  install refuses on), the reading is `unmeasurable`. That posts nothing new and settles nothing, so a card already
  up stays, and its `where` says not during a call. A lease listing that could not be read is `unmeasurable` too,
  never "no call".
- **The first read over the line keeps the evidence.** The unified log ages out within hours (one
  balloon's stuck client was unnameable a day later), so that pass writes
  `$SLOPWEAVER_HOME/live/machine/fseventsd-onset/<pid>.log`: fseventsd's own `log show` lines bar the
  `Resolve user group` flood, plus `ps` over every client pid they name. One file per pid, made with an exclusive
  create, and the capture runs during a call too, because it only reads. A failed `log` read or write goes to stderr
  and the next pass retries it; a failed `ps` is written into the capture beside the log and never retaken, because
  a later `ps` describes whatever holds those pids by then. It never changes the reading
  (`src/monitor/fseventsdOnset/`).
- **Not floating.** It was asked for as a hand step on the owner's queue, and every floating monitor cites a ruling asking
  for the note. Fired every `tick open` (`src/supervisor/scratch/tickCapture.ts`).
- **Worse is bytes.** It declares `worsens` on the subject's `footprintBytes`, so its note offers **When it gets
  worse**: the push note stays down until a pass reads the same pid holding strictly more than it did at the owner's press
  ([snoozing](../../hand/reference/snoozing.md)).
