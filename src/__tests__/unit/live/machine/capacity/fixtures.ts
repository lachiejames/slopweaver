/*
 * The readings every machine-capacity test file shares: the `top`, swap and compressor texts, the healthy gauges a
 * report is built over, the endpoint-sensor and overloaded shapes, the python-heredoc incident's process chain, and the empty
 * dispatch register. Values only — no disk, clock or process is touched.
 */
import type { DispatchBlock } from "../../../../../live/machine/capacityRender.js";
import { parseProcessStatRows } from "../../../../../live/machine/hiddenCpu.js";
import { ENDPOINT_PS_STAT_TEXT, TWO_SAMPLE_TOP_CPU_TEXT } from "../hiddenCpuFixtures.js";

export const SAMPLE_TOP_TEXT = [
  "Processes: 750 total, 4 running, 1 stuck, 745 sleeping, 5598 threads ",
  "2026/08/31 01:12:28",
  "Load Avg: 5.43, 9.74, 14.23 ",
  "CPU usage: 21.59% user, 29.38% sys, 49.2% idle ",
  "SharedLibs: 941M resident, 165M data, 123M linkedit.",
  "MemRegions: 426582 total, 14G resident, 430M private, 2856M shared.",
  "PhysMem: 43G used (5281M wired, 3118M compressor), 3631M unused.",
  "VM: 335T vsize, 6144M framework vsize, 3446701(0) swapins, 4861094(0) swapouts.",
  "Networks: packets: 693696711/690G in, 310373624/191G out.",
  "Disks: 2294360142/15T read, 721240144/6663G written.",
  "",
  "PID    MEM  ",
  "100    19700M",
  "200    500M ",
  "300    880K ",
  "",
].join("\n");

export const SAMPLE_SWAP_TEXT = "vm.swapusage: total = 4096.00M  used = 6348.80M  free = -2252.80M  (encrypted)";

/** A live reading 5 h 46 m after the reboot that followed the panic — 15% of the segments limit. */
export const HEALTHY_COMPRESSOR_TEXT = [
  "vm.compressor.segment.total: 182761",
  "vm.compressor.segment.limit: 1234946",
  "vm.compressor_segment_pages_compressed: 738386",
  "vm.compressor_segment_pages_compressed_limit: 19759136",
  "",
].join("\n");

/** The panic log's own line: "100% of segments limit (BAD) with 49 swapfiles". */
export const PANIC_COMPRESSOR_TEXT = [
  "vm.compressor.segment.total: 1234946",
  "vm.compressor.segment.limit: 1234946",
  "vm.compressor_segment_pages_compressed: 7706063",
  "vm.compressor_segment_pages_compressed_limit: 19759136",
  "",
].join("\n");

/** This device's own core count (`sysctl -n hw.ncpu`) — `3 x 15` = 45, the load hold. */
export const CORES = 15;

/**
 * Every `buildMachineCapacityReport` call in these files that is not about the hold gauge reads a healthy machine,
 * with no supervisor pin recorded.
 */
export const HEALTHY_GAUGES = {
  chairSessionId: undefined,
  compressorText: HEALTHY_COMPRESSOR_TEXT,
  cores: CORES,
  sessions: [],
  swapfileCount: 3,
} as const;

/**
 * The hidden-cpu shape: the Docker VM tops the footprint table while the endpoint sensor and
 * its helpers refuse their stats and the machine is busier than top's rows account for.
 */
export const ENDPOINT_READING = {
  ...HEALTHY_GAUGES,
  comms: [
    { comm: "/System/Library/Frameworks/Virtualization.framework/com.apple.Virtualization.VirtualMachine", pid: 100 },
  ],
  cpuSampleText: TWO_SAMPLE_TOP_CPU_TEXT,
  processes: [
    {
      argv: "/System/Library/Frameworks/Virtualization.framework/com.apple.Virtualization.VirtualMachine",
      pid: 100,
      ppid: 1,
    },
  ],
  statRows: parseProcessStatRows({ text: ENDPOINT_PS_STAT_TEXT }),
  swapText: undefined,
  topText: "Load Avg: 8.38, 8.76, 10.23 \nPID    MEM  \n100    6144M\n",
} as const;

/**
 * A load over the 45 hold with every memory gauge healthy and no CPU sample, so idle is unread and load judges alone.
 * A load1 of 34.84 sits under the hold of 45, so the shape that must hold takes 46.5.
 */
export const OVERLOADED_TOP_TEXT = "Load Avg: 46.5, 30.12, 25.01 \nPID    MEM  \n";

/*
 * The python-heredoc incident's own process chain, ids synthetic: a bot turn's `claude` (registered),
 * its shell, and the `python3 -` heredoc that read the Slack `compact.jsonl` whole — whose argv names nothing
 * the fleet pattern knows.
 */
export const INCIDENT_SESSION = {
  cwd: "/opt/synthetic/slopweaver/.claude/worktrees.noindex/live-bot-loop-a/",
  pid: 88_556,
  sessionId: "d5546c00-0000-4000-8000-000000000000",
};
export const INCIDENT_PROCESSES = [
  { argv: "/opt/synthetic/.local/bin/claude --plugin-dir /opt/synthetic/slopweaver", pid: 88_556, ppid: 1005 },
  { argv: "/bin/zsh -c python3 - <<'EOF'", pid: 98_570, ppid: 88_556 },
  { argv: "Python -", pid: 98_575, ppid: 98_570 },
  { argv: "/System/Library/Frameworks/Metadata.framework/Versions/A/Support/mds", pid: 371, ppid: 1 },
];
export const INCIDENT_COMMS = [
  { comm: "/opt/synthetic/.local/bin/claude", pid: 88_556 },
  {
    comm: "/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python",
    pid: 98_575,
  },
  { comm: "/System/Library/Frameworks/Metadata.framework/Versions/A/Support/mds", pid: 371 },
];
/** `top`'s own order that tick: the heredoc at 21 GB, then mds, then the session's own claude. */
export const INCIDENT_TOP_TEXT = "Load Avg: 9.0, 9.0, 9.0 \nPID    MEM  \n98575  21504M\n371    4700M\n88556  400M\n";

/** An empty register, which is what these cases are about — the reading, not the dispatch fold. */
export const NO_DISPATCH: DispatchBlock = {
  backoffSeconds: 0,
  covering: 0,
  investigations: [],
  investigationsOmitted: 0,
  open: 0,
  subject: "",
};
