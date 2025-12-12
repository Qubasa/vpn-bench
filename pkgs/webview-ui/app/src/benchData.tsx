// benchData.ts
import { IperfTcpReportData } from "@/src/components/IperfTcpCharts";
import { IperfUdpReportData } from "./components/IperfUdpCharts"; // Assuming path relative to benchData.ts
import { ConnectionTimings } from "./components/GeneralDashboard"; // Assuming path relative to benchData.ts
import { QperfData } from "./components/QperfCharts"; // Assuming path relative to benchData.ts
import { HyperfineData } from "./components/HyperfineCharts"; // Assuming path relative to benchData.ts
import { PingData } from "./components/PingCharts"; // Import ping data type
import { RistData } from "./components/RistStreamCharts"; // Import RIST data type

// --- Parallel TCP iperf3 Data Types ---

// Single pair result in parallel TCP test
export interface ParallelTcpPairResult {
  source: string;
  target: string;
  result?: IperfTcpReportData; // Present on success
  error?: string; // Present on failure
  error_type?: string; // Present on failure
}

// Full parallel TCP test data (stored at run level, not machine level)
export interface ParallelTcpReportData {
  pairs: ParallelTcpPairResult[];
}

// --- Interfaces for raw JSON structure ---

export interface CmdOutError {
  stdout: string;
  stderr: string;
  cwd: string;
  command_list: string[];
  returncode: number;
}

export interface ClanError {
  description: string | null;
  msg: string;
  location: string;
}

// Error type for tests that were not run (machine exists but test file missing)
export interface NotRunError {
  reason: string;
}

interface SuccessResponse<T> {
  status: "success";
  data: T;
  meta?: TestMetadata;
}

interface ErrorResponse {
  status: "error";
  error_type: "CmdOut" | "ClanError";
  error: CmdOutError | ClanError;
  meta?: TestMetadata; // Metadata including service_logs on failure
}

type JsonWrapper<T> = SuccessResponse<T> | ErrorResponse;

// --- Result Type Definition ---

// Structure to hold the specific error details within the Result
export interface BenchmarkRunError {
  type: "CmdOut" | "ClanError" | "NotRun";
  details: CmdOutError | ClanError | NotRunError;
  // Optionally add the source file path for better debugging context
  filePath?: string;
}

// Metadata about test execution
export interface TestMetadata {
  duration_seconds: number;
  test_attempts: number;
  vpn_restart_attempts: number;
  service_logs?: string; // Logs collected from target service on failure
  // Extended timing fields for bottleneck analysis
  vpn_restart_duration_seconds?: number;
  connectivity_wait_duration_seconds?: number;
  test_setup_duration_seconds?: number;
  // Source and target machine names for the test
  source?: string; // Machine name where the test client runs
  target?: string; // Machine name where the test server runs
}

// --- Timing Breakdown Interfaces ---

// Single operation timing record
export interface OperationTiming {
  name: string;
  duration_seconds: number;
  start_timestamp: number;
  success: boolean;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

// Phase-level timing with nested operations
export interface PhaseTiming {
  phase: string;
  duration_seconds: number;
  start_timestamp: number;
  operations: OperationTiming[];
  metadata?: Record<string, unknown>;
}

// Complete timing breakdown for a benchmark run
export interface TimingBreakdown {
  vpn_name: string;
  total_duration_seconds: number;
  start_timestamp: number;
  end_timestamp: number;
  phases: PhaseTiming[];
}

// Success case for the Result type
export interface Ok<T> {
  ok: true;
  value: T;
  meta?: TestMetadata;
}

// Error case for the Result type
export interface Err {
  ok: false;
  error: BenchmarkRunError;
  meta?: TestMetadata; // Metadata including service_logs on failure
}

/**
 * Represents the outcome of a benchmark task.
 * It can either be Ok (success) containing the data of type T,
 * or Err (failure) containing a BenchmarkRunError.
 */
export type Result<T> = Ok<T> | Err;

/**
 * Represents a machine's benchmark result that can be either success or failure.
 * Used for displaying mixed results in charts (some machines succeeded, some failed).
 */
export interface MixedReport<TData> {
  name: string;
  result: Result<TData>;
}

/**
 * Helper to get error message from a BenchmarkRunError for display
 */
export function getErrorMessage(error: BenchmarkRunError): string {
  if (error.type === "CmdOut") {
    const cmdError = error.details as CmdOutError;
    // Return stderr if available, otherwise stdout, otherwise a generic message
    if (cmdError.stderr.trim()) {
      return cmdError.stderr.trim().slice(0, 500); // Limit length
    }
    if (cmdError.stdout.trim()) {
      return cmdError.stdout.trim().slice(0, 500);
    }
    return `Command failed with exit code ${cmdError.returncode}`;
  } else if (error.type === "NotRun") {
    const notRunError = error.details as NotRunError;
    return notRunError.reason;
  } else {
    const clanError = error.details as ClanError;
    return clanError.msg || clanError.description || "Unknown error";
  }
}

// --- Updated Machine Interface ---

export interface Machine {
  name: string;
  iperf3: {
    // Use the Result type, can be null if the file wasn't found/processed at all
    tcp: Result<IperfTcpReportData> | null;
    udp: Result<IperfUdpReportData> | null;
  };
  qperf: Result<QperfData> | null;
  nixCache: Result<HyperfineData> | null;
  ping: Result<PingData> | null;
  ristStream: Result<RistData> | null;
}

// --- TC Settings Interface ---
export interface TCSettingsData {
  alias: string;
  settings: {
    bandwidth_mbit: number | null;
    latency_ms: number | null;
    jitter_ms: number | null;
    packet_loss_percent: number | null;
    reorder_percent: number | null;
    reorder_correlation: number | null;
  } | null;
}

// --- Run-level data (data that applies to the whole run, not individual machines) ---
export interface RunLevelData {
  machines: Machine[];
  tcSettings: TCSettingsData | null;
  parallelTcp: Result<ParallelTcpReportData> | null; // Parallel TCP test runs all machines at once
}

// --- Updated BenchCategory and BenchData Types ---
export interface BenchCategory {
  name: string; // VPN name (e.g., "Tinc", "Wireguard")
  runs: Record<string, RunLevelData>; // TC profile alias -> run data
}
export type BenchData = BenchCategory[];

// --- Existing GeneralData Interface ---
export interface GeneralData {
  connection_timings?: ConnectionTimings;
  reboot_connection_timings?: ConnectionTimings;
}

// --- Comparison Data Interfaces ---

export interface MetricStats {
  min: number;
  average: number;
  max: number;
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
  };
}

export interface PingComparisonData {
  rtt_min_ms: MetricStats;
  rtt_avg_ms: MetricStats;
  rtt_max_ms: MetricStats;
  rtt_mdev_ms: MetricStats;
  packet_loss_percent: MetricStats;
}

export interface QperfComparisonData {
  total_bandwidth_mbps: MetricStats;
  cpu_usage_percent: MetricStats;
  ttfb_ms: MetricStats;
  conn_time_ms: MetricStats;
}

export interface VideoStreamingComparisonData {
  bitrate_kbps: MetricStats;
  fps: MetricStats;
  dropped_frames: MetricStats;
}

export interface TcpIperfComparisonData {
  sender_throughput_mbps: MetricStats;
  receiver_throughput_mbps: MetricStats;
  retransmits: MetricStats;
}

export interface UdpIperfComparisonData {
  sender_throughput_mbps: MetricStats;
  receiver_throughput_mbps: MetricStats;
  jitter_ms: MetricStats;
  lost_percent: MetricStats;
}

export interface NixCacheComparisonData {
  mean_seconds: MetricStats;
  stddev_seconds: MetricStats;
  min_seconds: MetricStats;
  max_seconds: MetricStats;
}

export interface ParallelTcpComparisonData {
  total_throughput_mbps: MetricStats;
  avg_throughput_mbps: MetricStats;
  total_retransmits: MetricStats;
}

// Maps VPN name to its comparison data
export type VpnComparisonMap<T> = Record<string, T>;

// VPN comparison entry that can be success or error
export interface VpnComparisonSuccess<T> {
  status: "success";
  data: T;
}

export interface VpnComparisonError {
  status: "error";
  error_type: "CmdOut" | "ClanError";
  error: CmdOutError | ClanError;
  machine?: string;
}

export type VpnComparisonEntry<T> =
  | VpnComparisonSuccess<T>
  | VpnComparisonError;

// Maps VPN name to its comparison entry (can be success or error)
export type VpnComparisonResultMap<T> = Record<string, VpnComparisonEntry<T>>;

export interface ComparisonRunData {
  ping?: VpnComparisonResultMap<PingComparisonData>;
  qperf?: VpnComparisonResultMap<QperfComparisonData>;
  videoStreaming?: VpnComparisonResultMap<VideoStreamingComparisonData>;
  tcpIperf?: VpnComparisonResultMap<TcpIperfComparisonData>;
  udpIperf?: VpnComparisonResultMap<UdpIperfComparisonData>;
  nixCache?: VpnComparisonResultMap<NixCacheComparisonData>;
  parallelTcp?: VpnComparisonResultMap<ParallelTcpComparisonData>;
  // Connection timings are stored as VPN -> machine -> time string
  connectionTimings?: ConnectionTimings;
  rebootConnectionTimings?: ConnectionTimings;
  // TC settings for this profile
  tcSettings?: TCSettingsData | null;
}

// Maps run alias (TC profile) to comparison data
export type ComparisonData = Record<string, ComparisonRunData>;

// --- Data Generation Logic ---

const benchFiles = import.meta.glob("@/bench/**/*.json", { eager: true });

if (Object.keys(benchFiles).length === 0) {
  console.warn("No benchmark JSON files found in '@/bench/**'.");
}

// Helper to load TC settings for a specific VPN/run combination
function loadTCSettings(
  benchFiles: Record<string, unknown>,
  vpnName: string,
  runAlias: string,
): TCSettingsData | null {
  // Search for the tc_settings.json file in benchFiles
  for (const [path, rawModule] of Object.entries(benchFiles)) {
    if (path.includes(`/${vpnName}/${runAlias}/tc_settings.json`)) {
      if (rawModule && typeof rawModule === "object" && "alias" in rawModule) {
        return rawModule as TCSettingsData;
      }
    }
  }

  return null;
}

// Helper to load TC settings for a run alias from any VPN (all VPNs share the same TC settings per profile)
function loadTCSettingsForRunAlias(
  benchFiles: Record<string, unknown>,
  runAlias: string,
): TCSettingsData | null {
  // Search for any tc_settings.json file with this run alias
  for (const [path, rawModule] of Object.entries(benchFiles)) {
    if (
      path.includes(`/${runAlias}/tc_settings.json`) &&
      !path.includes("/General/")
    ) {
      if (rawModule && typeof rawModule === "object" && "alias" in rawModule) {
        return rawModule as TCSettingsData;
      }
    }
  }

  return null;
}

export function generateBenchData(): BenchData {
  const categories: Record<string, BenchCategory> = {};

  Object.entries(benchFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");

    // New structure: @/bench/<VPN>/<RUN_ALIAS>/<MACHINE>/<FILE>
    // Old structure: @/bench/<VPN>/<MACHINE>/<FILE>
    // We support both for backward compatibility

    let categoryName: string;
    let benchRunAlias: string;
    let machineName: string;
    let fileName: string;

    if (pathParts.length >= 6) {
      // New structure with 4-level depth
      categoryName = pathParts[pathParts.length - 4];
      benchRunAlias = pathParts[pathParts.length - 3];
      machineName = pathParts[pathParts.length - 2];
      fileName = pathParts[pathParts.length - 1];
    } else if (pathParts.length >= 5) {
      // Old structure with 3-level depth (backward compatibility)
      categoryName = pathParts[pathParts.length - 3];
      benchRunAlias = "default"; // Use default alias for old structure
      machineName = pathParts[pathParts.length - 2];
      fileName = pathParts[pathParts.length - 1];
    } else {
      return;
    }

    if (categoryName === "General") {
      return;
    }

    // Filter out connection timing files and tc_settings
    if (
      fileName === "connection_timings.json" ||
      fileName === "reboot_connection_timings.json" ||
      fileName === "tc_settings.json"
    ) {
      return;
    }

    // Handle run-level files (parallel_tcp_iperf3.json is at run level, not machine level)
    // Path: @/bench/<VPN>/<RUN_ALIAS>/parallel_tcp_iperf3.json (5 parts)
    if (pathParts.length === 5 && fileName === "parallel_tcp_iperf3.json") {
      const vpnName = pathParts[pathParts.length - 3];
      const runAlias = pathParts[pathParts.length - 2];

      if (vpnName === "General") {
        return;
      }

      if (
        !rawModule ||
        typeof rawModule !== "object" ||
        !("status" in rawModule)
      ) {
        return;
      }

      /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
      const moduleData = rawModule as JsonWrapper<any>;

      /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
      let generatedResult: Result<any>;

      if (moduleData.status === "success") {
        generatedResult = {
          ok: true,
          value: moduleData.data,
          meta: moduleData.meta,
        };
      } else if (moduleData.status === "error") {
        const errorDetails: BenchmarkRunError = {
          type: moduleData.error_type,
          details: moduleData.error,
          filePath: path,
        };
        generatedResult = {
          ok: false,
          error: errorDetails,
          meta: moduleData.meta,
        };
      } else {
        return;
      }

      // Initialize category if needed
      if (!categories[vpnName]) {
        categories[vpnName] = { name: vpnName, runs: {} };
      }

      // Initialize run if needed
      if (!categories[vpnName].runs[runAlias]) {
        const tcSettings = loadTCSettings(benchFiles, vpnName, runAlias);
        categories[vpnName].runs[runAlias] = {
          machines: [],
          tcSettings,
          parallelTcp: null,
        };
      }

      // Assign parallel TCP result
      categories[vpnName].runs[runAlias].parallelTcp =
        generatedResult as Result<ParallelTcpReportData>;
      return;
    }

    if (!categoryName || !machineName || !fileName) {
      return;
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as JsonWrapper<any>; // Use 'any' for data type initially

    // --- Create Result object (Ok or Err) ---
    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    let generatedResult: Result<any>; // Use 'any' here, specific type applied during assignment

    if (moduleData.status === "success") {
      // Create an Ok result, value type depends on the file
      // Include metadata if present
      generatedResult = {
        ok: true,
        value: moduleData.data,
        meta: moduleData.meta,
      };
    } else if (moduleData.status === "error") {
      // Create an Err result
      const errorDetails: BenchmarkRunError = {
        type: moduleData.error_type,
        details: moduleData.error,
        filePath: path, // Include path for context
      };
      // Include metadata (which may contain service_logs) for error results
      generatedResult = {
        ok: false,
        error: errorDetails,
        meta: moduleData.meta,
      };
    } else {
      return; // Skip if status is neither 'success' nor 'error'
    }

    // --- Find or Create Category (VPN), Run, and Machine ---
    // Group by VPN name first
    if (!categories[categoryName]) {
      categories[categoryName] = { name: categoryName, runs: {} };
    }

    // Ensure the run alias exists
    if (!categories[categoryName].runs[benchRunAlias]) {
      // Load TC settings for this run (will be loaded once per VPN/run combination)
      const tcSettings = loadTCSettings(
        benchFiles,
        categoryName,
        benchRunAlias,
      );
      categories[categoryName].runs[benchRunAlias] = {
        machines: [],
        tcSettings,
        parallelTcp: null,
      };
    }

    // Find or create machine within this run
    let machine = categories[categoryName].runs[benchRunAlias].machines.find(
      (m) => m.name === machineName,
    );
    if (!machine) {
      machine = {
        name: machineName,
        // Initialize Result fields to null
        iperf3: { tcp: null, udp: null },
        qperf: null,
        nixCache: null,
        ping: null,
        ristStream: null,
      };
      categories[categoryName].runs[benchRunAlias].machines.push(machine);
    }

    // --- Assign the generated Result to the correct machine field ---
    // The type assertion ensures the generatedResult (Ok<any> | Err) matches the expected Result<SpecificType>
    if (fileName === "tcp_iperf3.json") {
      machine.iperf3.tcp = generatedResult as Result<IperfTcpReportData>;
    } else if (fileName === "udp_iperf3.json") {
      machine.iperf3.udp = generatedResult as Result<IperfUdpReportData>;
    } else if (fileName === "qperf.json") {
      machine.qperf = generatedResult as Result<QperfData>;
    } else if (fileName === "nix_cache.json") {
      machine.nixCache = generatedResult as Result<HyperfineData>;
    } else if (fileName === "ping.json") {
      machine.ping = generatedResult as Result<PingData>;
    } else if (fileName === "rist_stream.json") {
      machine.ristStream = generatedResult as Result<RistData>;
    }
    // Add more else if blocks for other potential benchmark file types
  });

  // --- Fill in "Not Run" results for machines that exist but are missing tests ---
  // This helps visualize when a benchmark run was incomplete
  const createNotRunResult = (machineName: string): Err => ({
    ok: false,
    error: {
      type: "NotRun",
      details: {
        reason: `Test not run for ${machineName} (benchmark may have stopped before this test)`,
      },
    },
  });

  // For each category (VPN)
  Object.values(categories).forEach((category) => {
    // For each run (TC profile)
    Object.values(category.runs).forEach((run) => {
      // For each machine
      run.machines.forEach((machine) => {
        // Check if the machine has at least one test result
        const hasAnyData =
          machine.iperf3.tcp !== null ||
          machine.iperf3.udp !== null ||
          machine.qperf !== null ||
          machine.nixCache !== null ||
          machine.ping !== null ||
          machine.ristStream !== null;

        if (hasAnyData) {
          // Fill in missing tests with "Not Run" results
          if (machine.iperf3.tcp === null) {
            machine.iperf3.tcp = createNotRunResult(machine.name);
          }
          if (machine.iperf3.udp === null) {
            machine.iperf3.udp = createNotRunResult(machine.name);
          }
          if (machine.qperf === null) {
            machine.qperf = createNotRunResult(machine.name);
          }
          if (machine.nixCache === null) {
            machine.nixCache = createNotRunResult(machine.name);
          }
          if (machine.ping === null) {
            machine.ping = createNotRunResult(machine.name);
          }
          if (machine.ristStream === null) {
            machine.ristStream = createNotRunResult(machine.name);
          }
        }
      });
    });
  });

  return Object.values(categories);
}

// --- Generate and Log Data ---
export const benchData = generateBenchData();
console.log("Bench data:", benchData);

// --- General Data Handling (remains unchanged as it wasn't requested to use Result) ---
const generalFiles = import.meta.glob("@/bench/General/**/*.json", {
  eager: true,
});

export function generateGeneralData(): GeneralData | undefined {
  const result: GeneralData = {}; // Initialize as empty object
  Object.entries(generalFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    if (pathParts.length < 4) {
      console.warn(
        `Skipping general file with unexpected path structure: ${path}`,
      );
      return; // Skip malformed paths
    }
    const fileName = pathParts[pathParts.length - 1]; // Get the last part as filename
    // Validate the imported module structure
    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      console.warn(
        `Skipping general file with unexpected content format (missing 'status'): ${path}`,
        rawModule,
      );
      return; // Skip files that don't match the expected wrapper structure
    }
    // Assume rawModule has the Success/Error structure
    const moduleData = rawModule as JsonWrapper<ConnectionTimings>; // Specific type here
    let actualData: ConnectionTimings | null = null;
    if (moduleData.status === "success") {
      actualData = moduleData.data;
    } else if (moduleData.status === "error") {
      console.warn(
        `General data retrieval failed for ${path}: Type=${moduleData.error_type}`,
        moduleData.error,
      );
      // actualData remains null
    } else {
      console.warn(
        /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
        `Skipping general file with unknown status '${(moduleData as any).status}': ${path}`,
      );
      return;
    }
    // Assign data if successful
    if (actualData !== null) {
      if (fileName === "connection_timings.json") {
        result.connection_timings = actualData;
      } else if (fileName === "reboot_connection_timings.json") {
        result.reboot_connection_timings = actualData;
      }
    }
  });
  // Return result only if it contains some data, otherwise return undefined
  return Object.keys(result).length > 0 ? result : undefined;
}

export const generalData = generateGeneralData();
console.log("General data:", generalData);

// --- Comparison Data Loading ---

const comparisonFiles = import.meta.glob(
  "@/bench/General/comparison/**/*.json",
  {
    eager: true,
  },
);

export function generateComparisonData(): ComparisonData {
  const result: ComparisonData = {};

  Object.entries(comparisonFiles).forEach(([path, rawModule]) => {
    // Path format: @/bench/General/comparison/<run_alias>/<benchmark>.json
    const pathParts = path.split("/");
    if (pathParts.length < 6) {
      console.warn(`Skipping comparison file with unexpected path: ${path}`);
      return;
    }

    const runAlias = pathParts[pathParts.length - 2];
    const fileName = pathParts[pathParts.length - 1];

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      console.warn(`Skipping comparison file with unexpected format: ${path}`);
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as { status: string; data?: any };

    if (moduleData.status !== "success" || !moduleData.data) {
      console.warn(`Comparison data retrieval failed for ${path}`);
      return;
    }

    // Initialize run alias if needed
    if (!result[runAlias]) {
      result[runAlias] = {
        tcSettings: loadTCSettingsForRunAlias(benchFiles, runAlias),
      };
    }

    // Assign data based on file name
    if (fileName === "ping.json") {
      result[runAlias].ping =
        moduleData.data as VpnComparisonResultMap<PingComparisonData>;
    } else if (fileName === "qperf.json") {
      result[runAlias].qperf =
        moduleData.data as VpnComparisonResultMap<QperfComparisonData>;
    } else if (fileName === "video_streaming.json") {
      result[runAlias].videoStreaming =
        moduleData.data as VpnComparisonResultMap<VideoStreamingComparisonData>;
    } else if (fileName === "tcp_iperf3.json") {
      result[runAlias].tcpIperf =
        moduleData.data as VpnComparisonResultMap<TcpIperfComparisonData>;
    } else if (fileName === "udp_iperf3.json") {
      result[runAlias].udpIperf =
        moduleData.data as VpnComparisonResultMap<UdpIperfComparisonData>;
    } else if (fileName === "nix_cache.json") {
      result[runAlias].nixCache =
        moduleData.data as VpnComparisonResultMap<NixCacheComparisonData>;
    } else if (fileName === "parallel_tcp_iperf3.json") {
      result[runAlias].parallelTcp =
        moduleData.data as VpnComparisonResultMap<ParallelTcpComparisonData>;
    } else if (fileName === "connection_timings.json") {
      result[runAlias].connectionTimings = moduleData.data as ConnectionTimings;
    } else if (fileName === "reboot_connection_timings.json") {
      result[runAlias].rebootConnectionTimings =
        moduleData.data as ConnectionTimings;
    }
  });

  return result;
}

export const comparisonData = generateComparisonData();
console.log("Comparison data:", comparisonData);
