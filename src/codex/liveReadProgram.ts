/**
 * The Tcl program every live Codex exchange runs (`./accountLive.ts`), split from the transport that writes and
 * launches it because it is a program in its own language rather than TypeScript the module decides with.
 */
import { LIVE_MARKER_PREFIX } from "./accountLiveParse.js";

/**
 * The Tcl program. Logic-free about WHAT it runs: argv is `<deadline> <byte cap> <store>... -- <command>...` — the
 * deadline a duration in ms from the program's own start, or `@<epoch ms>`, an INSTANT, when a caller's deadline set
 * it, so `tclsh`'s own start-up is spent from that rather than added to it —
 * the requests arrive in `SLOPWEAVER_CODEX_LIVE_REQUESTS` and the ids whose answers it waits for in
 * `SLOPWEAVER_CODEX_LIVE_ANSWER_IDS`. Per store it opens one non-blocking pipe with that store as `CODEX_HOME`,
 * forwards ONLY the lines answering those ids (tagged `<index>\t`), and ends the store on every answer, on EOF,
 * past the byte cap or past the batch's ONE shared deadline — killing the child and every descendant
 * `pgrep -P` finds EVERY time, because a child that answered both reads and then would not exit outlived the whole
 * read, and an app-server starts any MCP server its `config.toml` declares. Two
 * limits, stated rather than discovered: a process that daemonised away from its parent before the kill is beyond
 * the walk, and where the OS denies `pgrep` a process list (a sandbox can) only the app-server itself is killed.
 * The walk is a loop, never recursion, and runs inside a `catch`, so no depth of tree can stop the kill (Codex
 * review r3: a 1,000-deep chain overran Tcl's recursion limit before `kill` ran), and each pid is killed by its
 * own `kill`, so no argv the tree's size decides can fail with E2BIG and spare the rest. Its pipe is closed
 * BLOCKING, so tclsh reaps the child it just killed: closed non-blocking, Tcl detaches it and the zombie outlives
 * the read until init reaps it, which a Linux CI runner showed as a pid still answering signal 0.
 * Every per-store failure is caught, so one bad store cannot erase another's answer. The deadline binds DURING the
 * launch loop too: `update` after each launch lets an expired deadline kill an earlier store, and a store reached
 * after the deadline is never launched at all.
 */
export const LIVE_READ_PROGRAM = [
  "fconfigure stdout -translation lf -encoding binary",
  "set deadlineArg [lindex $argv 0]",
  "if {[string index $deadlineArg 0] eq {@}} {",
  "  set deadlineAt [string range $deadlineArg 1 end]",
  "} else {",
  "  set deadlineAt [expr {[clock milliseconds] + $deadlineArg}]",
  "}",
  "set capBytes [lindex $argv 1]",
  "set sep [lsearch -exact $argv --]",
  "set stores [lrange $argv 2 [expr {$sep - 1}]]",
  "set command [lrange $argv [expr {$sep + 1}] end]",
  'set requests [split [string trim $env(SLOPWEAVER_CODEX_LIVE_REQUESTS)] "\\n"]',
  'set answerIds [split [string trim $env(SLOPWEAVER_CODEX_LIVE_ANSWER_IDS)] " "]',
  "set wanted [llength $answerIds]",
  'set idPattern [format {"id":(%s)[,\\}]} [join $answerIds |]]',
  "set pending 0",
  "proc descendants {root} {",
  "  set found {}",
  "  set queue [list $root]",
  "  while {[llength $queue] > 0} {",
  "    set parent [lindex $queue 0]",
  "    set queue [lrange $queue 1 end]",
  "    if {[catch {exec pgrep -P $parent} children]} { continue }",
  '    foreach child [split $children "\\n"] { lappend found $child; lappend queue $child }',
  "  }",
  "  return $found",
  "}",
  "proc finish {index} {",
  "  global channels pending",
  "  if {![info exists channels($index)]} { return }",
  "  set channel $channels($index)",
  "  unset channels($index)",
  "  catch {fileevent $channel readable {}}",
  "  set tree {}",
  "  foreach root [pid $channel] { lappend tree $root }",
  "  foreach root [pid $channel] { catch {lappend tree {*}[descendants $root]} }",
  "  foreach target $tree { catch {exec kill -9 $target} }",
  "  catch {fconfigure $channel -blocking 1}",
  "  catch {close $channel}",
  "  incr pending -1",
  "  if {$pending <= 0} { set ::finished 1 }",
  "}",
  "proc mark {index word} {",
  "  global channels",
  "  if {![info exists channels($index)]} { return }",
  `  puts stdout "$index\\t${LIVE_MARKER_PREFIX}$word"`,
  "  finish $index",
  "}",
  "proc readable {index} {",
  "  global channels buffers bytes answered capBytes idPattern wanted",
  "  set channel $channels($index)",
  "  if {[catch {read $channel} chunk]} { mark $index eof; return }",
  "  incr bytes($index) [string length $chunk]",
  "  if {$bytes($index) > $capBytes} { mark $index overflow; return }",
  "  append buffers($index) $chunk",
  '  while {[set newline [string first "\\n" $buffers($index)]] >= 0} {',
  "    set line [string range $buffers($index) 0 [expr {$newline - 1}]]",
  "    set buffers($index) [string range $buffers($index) [expr {$newline + 1}] end]",
  "    if {[regexp $idPattern $line]} {",
  '      puts stdout "$index\\t$line"',
  "      incr answered($index)",
  "      if {$answered($index) >= $wanted} { finish $index; return }",
  "    }",
  "  }",
  "  if {[eof $channel]} { mark $index eof }",
  "}",
  "set index 0",
  "foreach store $stores {",
  "  if {[clock milliseconds] >= $deadlineAt} {",
  `    puts stdout "$index\\t${LIVE_MARKER_PREFIX}deadline"`,
  "    incr index",
  "    continue",
  "  }",
  "  set env(CODEX_HOME) $store",
  "  if {[catch {open |[concat $command [list 2>/dev/null]] r+} channel]} {",
  `    puts stdout "$index\\t${LIVE_MARKER_PREFIX}open"`,
  "  } else {",
  "    set channels($index) $channel",
  '    set buffers($index) ""',
  "    set bytes($index) 0",
  "    set answered($index) 0",
  "    incr pending",
  "    if {[catch {",
  "      fconfigure $channel -blocking 0 -buffering line -translation lf -encoding binary",
  "      foreach request $requests { puts $channel $request }",
  "      flush $channel",
  "      fileevent $channel readable [list readable $index]",
  "      after [expr {max(0, $deadlineAt - [clock milliseconds])}] [list mark $index deadline]",
  "    }]} { mark $index open }",
  "  }",
  "  update",
  "  incr index",
  "}",
  "if {$pending > 0} { vwait ::finished }",
  "flush stdout",
  "exit 0",
  "",
].join("\n");
