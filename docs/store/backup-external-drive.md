# A backup destination on an external drive

Part of [the backup](backup.md).

**A destination on an external drive is pinned to that drive.** Anything under `/Volumes/<name>/` is written
only while the volume mounted there carries the UUID recorded for exactly that root, in
`backups/store/destination-pin.json` — one pin per destination on a drive, so each drive on the list is held to
its own (`src/store/backup/volumePin.ts`, `volumePins.ts`). Without the pin, the write is refused before anything
is made. The reason: a stale empty folder at `/Volumes/<name>` is indistinguishable from the drive by path, and a
recursive `mkdir` would put the whole backup on the boot disk.

**Setting it.** `store backup --set-destination <address>` or `--add-destination <address>` refuses when nothing
is mounted there. It writes the pin before making the folder, and if a later step fails it puts the earlier pin
bytes back and removes the empty folders it made, each only while its device and inode still match.
`--remove-destination` drops that root's pin with it. `--create-master-password` writes the wrap to every
reachable destination through its own door, held to each pin; a drive that is out is named and gets its wrap
from the next backup, which writes it before any object. With no destination reachable it refuses, since a
password whose wrap landed nowhere opens nothing.

**A night the drive is out.** The backup is staged here once, every other destination is still written, and
`last.json` records `drive-not-plugged-in` for that destination alone. `--status` prints `DRIVE NOT PLUGGED IN`
and the drive's own `last written <instant>` line, and stays green while another destination was written and none
failed; with every destination on the list out, it is red. `--sweep-only` sends the drive what it missed once it
is back (with the drive still out, it skips it, and with every drive out it sends nothing and exits 0). A drive
ejected mid-run that leaves a whole staging is recorded the same way.

**Every write is checked again.** Before every operation the drive's device, the device under the exact path
touched and the volume UUID are read again, so a drive pulled or replaced mid-run, or a volume mounted inside the
drive, fails the next write rather than taking it (`pinnedTransport.ts`). The same check runs right after the
root's folder is made, and a run that fails it removes what it made (`madeFolders.ts`). A listing never crosses
onto a volume mounted inside the destination (`LOCAL_MOUNT_CROSSED`), so nothing there reads as already held. A
root reached through a link is placed by where it really lands. A different drive under the same name is refused.

**Reads need no pin.** `recover`, `rehearse` and `restore` read the drive as they find it, so a new Mac recovers
straight off the drive ([a new machine](new-machine.md)).
