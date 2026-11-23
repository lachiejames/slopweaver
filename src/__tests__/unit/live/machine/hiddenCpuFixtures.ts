/**
 * Readings for `src/live/machine/hiddenCpu.ts`, shared by its own tests and `capacity/`'s — a plain
 * module, not a `*.test.ts`, so importing it never registers a second copy of anyone's tests.
 */

/**
 * A REDUCED `top -l 2 -s 1 -stats pid,cpu` report: the load and CPU usage numbers are from a capture
 * on this device, the tables are cut to a few rows with each `Processes: N total` set to match (top's own total
 * always equals its table's row count), and pid 4242 is added to stand for a paged-out process that top still
 * lists. The first sample's rows read zero, as top's always do; the endpoint sensor is absent from both.
 */
export const TWO_SAMPLE_TOP_CPU_TEXT = [
  "Processes: 2 total, 1 running, 1 sleeping, 6091 threads ",
  "2026/09/13 06:40:00",
  "Load Avg: 8.38, 8.76, 10.23 ",
  "CPU usage: 27.23% user, 16.19% sys, 56.57% idle ",
  "",
  "PID    %CPU",
  "56035  0.0 ",
  "540    0.0 ",
  "Processes: 4 total, 2 running, 2 sleeping, 6087 threads ",
  "2026/09/13 06:40:01",
  "Load Avg: 8.38, 8.76, 10.23 ",
  "CPU usage: 25.47% user, 10.17% sys, 64.35% idle ",
  "",
  "PID    %CPU",
  "56035  153.1",
  "540    89.6",
  "371    15.6",
  "4242   0.0",
  "",
].join("\n");

/**
 * `ps -ax -o pid=,rss=,stat=,comm=` rows: the endpoint-sensor, MDM-agent and launchd rows are from the same capture;
 * pid 400 is a synthetic lower-pid endpoint-sensor helper, 1490/1500 are synthetic zombies, and 4242 is a synthetic
 * stopped, paged-out process that reads rss 0 but which top's table carries.
 */
export const ENDPOINT_PS_STAT_TEXT = [
  "    1  21024 Ss   /sbin/launchd",
  "  400      0 ?s   /Applications/Endpoint.app/Contents/PlugIns/Scan.bundle/Contents/XPCServices/ScanService.xpc/Contents/MacOS/ScanService",
  "  553      0 ?s   /Library/SystemExtensions/755420E1-1D6C-49FC-88B4-87B48D604B40/com.example.endpoint.Agent.systemextension/Contents/MacOS/com.example.endpoint.Agent",
  "  554  11376 Ss   /Library/SystemExtensions/81200CCC-D8D8-4C5F-B3F8-B5790344AEB7/com.example.mdm-agent.EndpointSecurity.systemextension/Contents/MacOS/com.example.mdm-agent.EndpointSecurity",
  "  602      0 ?s   /Applications/Endpoint.app/Contents/PlugIns/StaticAnalysis.bundle/Contents/XPCServices/PredictService.xpc/Contents/MacOS/PredictService",
  " 1416      0 ?    /Applications/Endpoint.app/Contents/Library/LaunchServices/Endpoint Notifications.app/Contents/MacOS/Endpoint Notifications",
  " 1490      0 Z    <defunct>",
  " 1500      0 Z+   /bin/zsh",
  " 4242      0 T    /tmp/sleeper",
  "",
].join("\n");
