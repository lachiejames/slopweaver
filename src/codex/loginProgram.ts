/**
 * The Tcl program a Codex Connect runs (`./loginExchange.ts`): it holds ONE `codex app-server` open through a
 * ChatGPT sign-in, the way `./liveReadProgram.ts` holds one through an account read, and for the same reason —
 * the app-server exits on stdin EOF, and `no-headless` NH001 bans the asynchronous child that would hold it open.
 *
 * argv is `<deadline ms> <cancel marker> <sign-in page file> <byte cap> <opener> -- <command>...`, the app-server's
 * `CODEX_HOME` is the caller's environment, and every JSON line it sends arrives by environment variable, so the
 * protocol's vocabulary is decided in TypeScript and this program only sequences it:
 *
 * 1. send the handshake and `account/login/start`; on its answer (`start`), take the sign-in page and the login id;
 * 2. refuse a page that is not under `SLOPWEAVER_CODEX_LOGIN_URL_PREFIX` or holds a character outside a URL's own
 *    set (`!url`), else write it to the page file (`0600`) and run the opener on it as ONE argument (`!browser` when
 *    that fails) — `exec` with a list never reaches a shell;
 * 3. wait for `account/login/completed` (`completed`); on success send `account/read` and wait for its answer
 *    (`account`);
 * 4. every 500ms, look for the cancel marker: before the page exists that ends the attempt (`!cancelled`); after, it
 *    sends `account/login/cancel` (`cancelsent`) and ends on its answer or the completion that follows.
 *
 * Every end — an answer, EOF (`!eof`), the byte cap (`!overflow`), the deadline (`!deadline`) — kills the app-server
 * and every descendant `pgrep -P` finds, and closes its pipe BLOCKING so the child is reaped; the reasons are
 * `./liveReadProgram.ts`'s, measured there. The app-server's callback listener dies with it, so the fixed callback
 * port is free again for the next attempt.
 *
 * Each line it prints is `<tag>\t<the provider's own line>`, or a `!<word>` marker; `./loginExchangeParse.ts` reads
 * them. Written with `String.raw` so every backslash below is Tcl's, not JavaScript's.
 */

/** The program. */
export const LOGIN_PROGRAM = String.raw`fconfigure stdout -translation lf -encoding binary
set deadlineAt [expr {[clock milliseconds] + [lindex $argv 0]}]
set cancelPath [lindex $argv 1]
set urlPath [lindex $argv 2]
set capBytes [lindex $argv 3]
set opener [lindex $argv 4]
set sep [lsearch -exact $argv --]
set command [lrange $argv [expr {$sep + 1}] end]
set state starting
set loginId ""
set buffer ""
set bytes 0
proc descendants {root} {
  set found {}
  set queue [list $root]
  while {[llength $queue] > 0} {
    set parent [lindex $queue 0]
    set queue [lrange $queue 1 end]
    if {[catch {exec pgrep -P $parent} children]} { continue }
    foreach child [split $children "\n"] { lappend found $child; lappend queue $child }
  }
  return $found
}
proc finish {} {
  global channel
  if {![info exists channel]} { set ::finished 1; return }
  set held $channel
  unset channel
  catch {fileevent $held readable {}}
  set tree {}
  foreach root [pid $held] { lappend tree $root }
  foreach root [pid $held] { catch {lappend tree {*}[descendants $root]} }
  foreach target $tree { catch {exec kill -9 $target} }
  catch {fconfigure $held -blocking 1}
  catch {close $held}
  set ::finished 1
}
proc emit {tag line} {
  puts stdout "$tag\t$line"
  flush stdout
}
proc mark {word} {
  global channel
  if {![info exists channel]} { return }
  puts stdout "!$word"
  finish
}
proc send {line} {
  global channel
  puts $channel $line
  flush $channel
}
proc openPage {url} {
  global urlPath opener env
  if {[string first $env(SLOPWEAVER_CODEX_LOGIN_URL_PREFIX) $url] != 0} { return url }
  if {![regexp {^[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$} $url]} { return url }
  if {[catch {
    set file [open $urlPath {WRONLY CREAT TRUNC} 0600]
    puts $file $url
    close $file
  }]} { return pagefile }
  if {[catch {exec $opener $url}]} { return browser }
  return ""
}
proc onLine {line} {
  global state loginId env
  if {$state eq "starting" && [regexp {"id":\s*2\s*[,\}]} $line]} {
    emit start $line
    if {![regexp {"authUrl":\s*"([^"\\]+)"} $line -> url]} { finish; return }
    if {![regexp {"loginId":\s*"([A-Za-z0-9-]+)"} $line -> loginId]} { finish; return }
    set refused [openPage $url]
    if {$refused ne ""} { mark $refused; return }
    set state waiting
    emit opened ""
    return
  }
  if {[regexp {"method":\s*"account/login/completed"} $line] && $state in {waiting cancelling}} {
    emit completed $line
    if {$state eq "waiting" && [regexp {"success":\s*true} $line]} {
      set state account
      send $env(SLOPWEAVER_CODEX_LOGIN_ACCOUNT)
      return
    }
    finish
    return
  }
  if {$state eq "account" && [regexp {"id":\s*3\s*[,\}]} $line]} { emit account $line; finish; return }
  if {$state eq "cancelling" && [regexp {"id":\s*4\s*[,\}]} $line]} { emit cancelanswer $line; finish; return }
}
proc readable {} {
  global channel buffer bytes capBytes
  if {![info exists channel]} { return }
  if {[catch {read $channel} chunk]} { mark eof; return }
  incr bytes [string length $chunk]
  if {$bytes > $capBytes} { mark overflow; return }
  append buffer $chunk
  while {[info exists channel] && [set newline [string first "\n" $buffer]] >= 0} {
    set line [string range $buffer 0 [expr {$newline - 1}]]
    set buffer [string range $buffer [expr {$newline + 1}] end]
    onLine $line
  }
  if {[info exists channel] && [eof $channel]} { mark eof }
}
proc pollCancel {} {
  global channel state cancelPath loginId env
  if {![info exists channel]} { return }
  if {[file exists $cancelPath]} {
    if {$state eq "starting"} { mark cancelled; return }
    if {$state eq "waiting"} {
      set state cancelling
      emit cancelsent ""
      send [format $env(SLOPWEAVER_CODEX_LOGIN_CANCEL) $loginId]
      after 10000 [list mark cancelquiet]
    }
  }
  after 500 pollCancel
}
if {[catch {open |[concat $command [list 2>/dev/null]] r+} channel]} {
  unset channel
  puts stdout "!open"
  flush stdout
  exit 0
}
if {[catch {
  fconfigure $channel -blocking 0 -buffering line -translation lf -encoding binary
  foreach request [split [string trim $env(SLOPWEAVER_CODEX_LOGIN_START)] "\n"] { send $request }
  fileevent $channel readable readable
  after [expr {max(0, $deadlineAt - [clock milliseconds])}] [list mark deadline]
  after 500 pollCancel
}]} { mark open }
if {[info exists channel]} { vwait ::finished }
flush stdout
exit 0
`;
