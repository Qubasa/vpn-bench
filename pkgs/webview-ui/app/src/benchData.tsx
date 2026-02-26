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
  msg: string | null;
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
    // Return msg if available, then stderr, then stdout, otherwise a generic message
    if (cmdError.msg) {
      return cmdError.msg;
    }
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

// Kernel profile metadata (loaded from kernel_profile.json)
export interface KernelProfileMetadata {
  name: string;
  services: string[];
  description: string;
}

// Maps kernel profile alias to benchmark data for that profile
export type KernelProfileBenchData = Record<string, BenchData>;

// Maps alias (e.g., "04.01.2026") to kernel profile data
export type AllBenchData = Record<string, KernelProfileBenchData>;

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
  // Static encoding metrics (for metadata display)
  bitrate_kbps: MetricStats;
  fps: MetricStats;
  dropped_frames: MetricStats;
  // Dynamic network metrics (for plots)
  quality: MetricStats;
  rtt_ms: MetricStats;
  packets_recovered: MetricStats;
  packets_dropped: MetricStats;
}

export interface TcpIperfComparisonData {
  sender_throughput_mbps: MetricStats;
  receiver_throughput_mbps: MetricStats;
  retransmits: MetricStats;
  retransmit_percent: MetricStats;
  max_snd_cwnd_bytes: MetricStats;
  max_snd_wnd_bytes: MetricStats;
  total_bytes_sent: MetricStats;
  total_bytes_received: MetricStats;
  duration_seconds: MetricStats;
}

export interface UdpIperfComparisonData {
  sender_throughput_mbps: MetricStats;
  receiver_throughput_mbps: MetricStats;
  jitter_ms: MetricStats;
  lost_percent: MetricStats;
  total_bytes_sent: MetricStats;
  total_bytes_received: MetricStats;
  duration_seconds: MetricStats;
  blksize_bytes: MetricStats; // UDP payload/datagram size
  host_cpu_percent: MetricStats; // Host CPU utilization
  remote_cpu_percent: MetricStats; // Remote CPU utilization
}

export interface NixCacheComparisonData {
  mean_seconds: MetricStats;
  stddev_seconds: MetricStats;
  min_seconds: MetricStats;
  max_seconds: MetricStats;
}

export interface ParallelTcpComparisonData {
  sender_throughput_mbps: MetricStats;
  receiver_throughput_mbps: MetricStats;
  total_retransmits: MetricStats;
  retransmit_percent: MetricStats;
  max_snd_cwnd_bytes: MetricStats;
  max_snd_wnd_bytes: MetricStats;
  total_bytes_sent: MetricStats;
  total_bytes_received: MetricStats;
  duration_seconds: MetricStats;
}

export interface TimingComparisonData {
  total_duration_seconds: MetricStats;
  vpn_installation_seconds: MetricStats;
  benchmarking_seconds: MetricStats;
}

export interface BenchmarkStatsData {
  // Per-test durations in seconds
  tcp_test_duration_seconds: MetricStats;
  udp_test_duration_seconds: MetricStats;
  parallel_tcp_test_duration_seconds: MetricStats;
  ping_test_duration_seconds: MetricStats;
  qperf_test_duration_seconds: MetricStats;
  video_test_duration_seconds: MetricStats;
  nix_cache_test_duration_seconds: MetricStats;
  // Per-test retry counts (test_attempts - 1, summed across machines)
  tcp_retries: number;
  udp_retries: number;
  parallel_tcp_retries: number;
  ping_retries: number;
  qperf_retries: number;
  video_retries: number;
  nix_cache_retries: number;
  // Failure statistics
  total_tests: number;
  successful_tests: number;
  failed_tests: number;
  success_rate_percent: number;
}

// Aggregated time breakdown for pie chart visualization
export interface TimeBreakdownData {
  vpn_installation_seconds: number;
  tc_stabilization_seconds: number;
  test_execution_seconds: number;
  vpn_restart_seconds: number;
  connectivity_wait_seconds: number;
  other_overhead_seconds: number;
  total_seconds: number;
}

// --- Hardware Comparison Data ---

export interface CpuInfo {
  architecture: string;
  vendor_name: string;
  model: number;
  cores: number;
  siblings: number;
  cache_kb: number;
  bogo: number;
  features: string[];
  bugs: string[];
}

export interface MemoryInfo {
  total_bytes: number;
  total_gb: number;
}

export interface NetworkController {
  vendor: string;
  device: string;
  model: string;
  driver: string;
  unix_device_name: string;
}

export interface NetworkInterface {
  model: string;
  driver: string;
  unix_device_name: string;
}

export interface MachineHardware {
  machine_name: string;
  cpu: CpuInfo;
  memory: MemoryInfo;
  network_controllers: NetworkController[];
  network_interfaces: NetworkInterface[];
}

export interface HardwareComparisonData {
  machines: MachineHardware[];
}

// --- Cross-Profile TCP Visualization Data ---

export interface Bar3DData {
  vpn_names: string[];
  tc_profiles: string[];
  throughput_data: [number, number, number][]; // [vpn_idx, profile_idx, throughput_mbps]
}

export interface Scatter3DData {
  dimensions: string[];
  vpn_names: string[];
  tc_profiles: string[];
  data: number[][]; // [throughput, window_size_kb, cwnd_kb, vpn_idx, profile_idx]
}

export interface TcpSectionData {
  bar3d: Bar3DData;
  scatter3d: Scatter3DData;
}

export interface CrossProfileTcpData {
  tcp: TcpSectionData;
  parallel_tcp: TcpSectionData;
}

// --- Cross-Profile UDP Visualization Data ---

export interface UdpHeatmapData {
  tc_profiles: string[]; // Keep for ordered iteration
  throughput: Record<string, Record<string, number>>; // {vpn: {profile: receiver_throughput_mbps}}
  cpu: Record<string, Record<string, number>>; // {vpn: {profile: host_cpu_percent}}
  failed: Record<string, string[]>; // {vpn: [failed_profiles]}
}

export interface UdpScatterData {
  dimensions: string[];
  vpn_names: string[];
  tc_profiles: string[];
  data: number[][]; // [throughput, payload_size, received_bytes_gb, vpn_idx, profile_idx]
}

export interface CrossProfileUdpData {
  heatmap: UdpHeatmapData;
  scatter: UdpScatterData;
}

// --- Cross-Profile Ping Visualization Data ---

export interface PingHeatmapData {
  tc_profiles: string[]; // Keep for ordered iteration
  rtt: Record<string, Record<string, number>>; // {vpn: {profile: rtt_avg_ms}}
  packet_loss: Record<string, Record<string, number>>; // {vpn: {profile: packet_loss_percent}}
  failed: Record<string, string[]>; // {vpn: [failed_profiles]}
}

export interface CrossProfilePingData {
  heatmap: PingHeatmapData;
}

// --- Cross-Profile QUIC/Qperf Visualization Data ---

export interface QperfHeatmapData {
  tc_profiles: string[]; // Keep for ordered iteration
  bandwidth: Record<string, Record<string, number>>; // {vpn: {profile: total_bandwidth_mbps}}
  cpu: Record<string, Record<string, number>>; // {vpn: {profile: cpu_usage_percent}}
  failed: Record<string, string[]>; // {vpn: [failed_profiles]}
}

export interface CrossProfileQperfData {
  heatmap: QperfHeatmapData;
}

// --- Cross-Profile Video Streaming (RIST) Visualization Data ---

export interface VideoStreamingHeatmapData {
  tc_profiles: string[]; // Keep for ordered iteration
  quality: Record<string, Record<string, number>>; // {vpn: {profile: quality_percent}}
  rtt_ms: Record<string, Record<string, number>>; // {vpn: {profile: rtt_ms}}
  failed: Record<string, string[]>; // {vpn: [failed_profiles]}
}

export interface CrossProfileVideoStreamingData {
  heatmap: VideoStreamingHeatmapData;
}

// --- Cross-Profile Nix Cache Visualization Data ---

export interface NixCacheHeatmapData {
  tc_profiles: string[]; // Keep for ordered iteration
  mean_seconds: Record<string, Record<string, number>>; // {vpn: {profile: seconds}}
  failed: Record<string, string[]>; // {vpn: [failed_profiles]}
}

export interface CrossProfileNixCacheData {
  heatmap: NixCacheHeatmapData;
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
  timingComparison?: VpnComparisonResultMap<TimingComparisonData>;
  benchmarkStats?: VpnComparisonResultMap<BenchmarkStatsData>;
  // Aggregated time breakdown for pie chart
  timeBreakdown?: { status: string; data: TimeBreakdownData };
  // Connection timings are stored as VPN -> machine -> time string
  connectionTimings?: ConnectionTimings;
  rebootConnectionTimings?: ConnectionTimings;
  // TC settings for this profile
  tcSettings?: TCSettingsData | null;
}

// Maps run alias (TC profile) to comparison data
export type ComparisonData = Record<string, ComparisonRunData>;

// Maps kernel profile alias to comparison data for that profile
export type KernelProfileComparisonData = Record<string, ComparisonData>;

// Maps alias (e.g., "04.01.2026") to kernel profile comparison data
export type AllComparisonData = Record<string, KernelProfileComparisonData>;

// --- Timing Breakdown Data for Total Runtime Display ---

// Maps VPN name to its timing breakdown for a specific profile
export type VpnTimingMap = Record<string, TimingBreakdown>;

// Maps run alias (TC profile) to VPN timing data
export type ProfileTimingData = Record<string, VpnTimingMap>;

// Maps alias → kernel profile → metadata
export type AllKernelProfileMetadata = Record<
  string,
  Record<string, KernelProfileMetadata>
>;

// --- Data Generation Logic ---

const benchFiles = import.meta.glob("@/bench/**/*.json", { eager: true });

if (Object.keys(benchFiles).length === 0) {
  console.warn("No benchmark JSON files found in '@/bench/**'.");
}

// Helper to load TC settings for a specific alias/kernel profile/VPN/run combination
function loadTCSettings(
  benchFiles: Record<string, unknown>,
  alias: string,
  kernelProfile: string,
  vpnName: string,
  runAlias: string,
): TCSettingsData | null {
  // Path: @/bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<RUN_ALIAS>/tc_settings.json
  for (const [path, rawModule] of Object.entries(benchFiles)) {
    if (
      path.includes(
        `/${alias}/${kernelProfile}/${vpnName}/${runAlias}/tc_settings.json`,
      )
    ) {
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
  alias: string,
  kernelProfile: string,
  runAlias: string,
): TCSettingsData | null {
  // Path: @/bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<RUN_ALIAS>/tc_settings.json
  for (const [path, rawModule] of Object.entries(benchFiles)) {
    if (
      path.includes(`/${alias}/${kernelProfile}/`) &&
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

export function generateBenchData(): AllBenchData {
  // Maps alias -> kernel profile -> VPN name -> BenchCategory
  const aliasData: Record<
    string,
    Record<string, Record<string, BenchCategory>>
  > = {};

  Object.entries(benchFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");

    // New structure: /bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<RUN_ALIAS>/<MACHINE>/<FILE> (8 parts with leading empty)
    // Run-level: /bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<RUN_ALIAS>/parallel_tcp_iperf3.json (7 parts with leading empty)

    let alias: string;
    let kernelProfile: string;
    let categoryName: string;
    let benchRunAlias: string;
    let machineName: string;
    let fileName: string;

    if (pathParts.length >= 8) {
      // Machine-level file: @/bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<RUN_ALIAS>/<MACHINE>/<FILE>
      alias = pathParts[pathParts.length - 6];
      kernelProfile = pathParts[pathParts.length - 5];
      categoryName = pathParts[pathParts.length - 4];
      benchRunAlias = pathParts[pathParts.length - 3];
      machineName = pathParts[pathParts.length - 2];
      fileName = pathParts[pathParts.length - 1];
    } else if (pathParts.length === 7) {
      // Run-level file: @/bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<RUN_ALIAS>/<FILE>
      alias = pathParts[pathParts.length - 5];
      kernelProfile = pathParts[pathParts.length - 4];
      categoryName = pathParts[pathParts.length - 3];
      benchRunAlias = pathParts[pathParts.length - 2];
      machineName = "";
      fileName = pathParts[pathParts.length - 1];
    } else {
      return;
    }

    if (categoryName === "General") {
      return;
    }

    // Filter out metadata and non-benchmark files
    if (
      fileName === "connection_timings.json" ||
      fileName === "reboot_connection_timings.json" ||
      fileName === "tc_settings.json" ||
      fileName === "timing_breakdown.json" ||
      fileName === "kernel_profile.json" ||
      fileName === "layout.json"
    ) {
      return;
    }

    // Handle run-level files (parallel_tcp_iperf3.json is at run level, not machine level)
    if (pathParts.length === 7 && fileName === "parallel_tcp_iperf3.json") {
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

      // Initialize alias if needed
      if (!aliasData[alias]) {
        aliasData[alias] = {};
      }

      // Initialize kernel profile if needed
      if (!aliasData[alias][kernelProfile]) {
        aliasData[alias][kernelProfile] = {};
      }

      // Initialize category if needed
      if (!aliasData[alias][kernelProfile][categoryName]) {
        aliasData[alias][kernelProfile][categoryName] = {
          name: categoryName,
          runs: {},
        };
      }

      // Initialize run if needed
      if (!aliasData[alias][kernelProfile][categoryName].runs[benchRunAlias]) {
        const tcSettings = loadTCSettings(
          benchFiles,
          alias,
          kernelProfile,
          categoryName,
          benchRunAlias,
        );
        aliasData[alias][kernelProfile][categoryName].runs[benchRunAlias] = {
          machines: [],
          tcSettings,
          parallelTcp: null,
        };
      }

      // Assign parallel TCP result
      aliasData[alias][kernelProfile][categoryName].runs[
        benchRunAlias
      ].parallelTcp = generatedResult as Result<ParallelTcpReportData>;
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

    // Initialize alias if needed
    if (!aliasData[alias]) {
      aliasData[alias] = {};
    }

    // Initialize kernel profile if needed
    if (!aliasData[alias][kernelProfile]) {
      aliasData[alias][kernelProfile] = {};
    }

    // Initialize category if needed
    if (!aliasData[alias][kernelProfile][categoryName]) {
      aliasData[alias][kernelProfile][categoryName] = {
        name: categoryName,
        runs: {},
      };
    }

    // Ensure the run alias exists
    if (!aliasData[alias][kernelProfile][categoryName].runs[benchRunAlias]) {
      const tcSettings = loadTCSettings(
        benchFiles,
        alias,
        kernelProfile,
        categoryName,
        benchRunAlias,
      );
      aliasData[alias][kernelProfile][categoryName].runs[benchRunAlias] = {
        machines: [],
        tcSettings,
        parallelTcp: null,
      };
    }

    // Find or create machine within this run
    let machine = aliasData[alias][kernelProfile][categoryName].runs[
      benchRunAlias
    ].machines.find((m) => m.name === machineName);
    if (!machine) {
      machine = {
        name: machineName,
        iperf3: { tcp: null, udp: null },
        qperf: null,
        nixCache: null,
        ping: null,
        ristStream: null,
      };
      aliasData[alias][kernelProfile][categoryName].runs[
        benchRunAlias
      ].machines.push(machine);
    }

    // Assign the generated Result to the correct machine field
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
  });

  // Fill in "Not Run" results for machines that exist but are missing tests
  const createNotRunResult = (machineName: string): Err => ({
    ok: false,
    error: {
      type: "NotRun",
      details: {
        reason: `Test not run for ${machineName} (benchmark may have stopped before this test)`,
      },
    },
  });

  // For each alias
  Object.values(aliasData).forEach((kernelProfiles) => {
    // For each kernel profile
    Object.values(kernelProfiles).forEach((categories) => {
      // For each category (VPN)
      Object.values(categories).forEach((category) => {
        // For each run (TC profile)
        Object.values(category.runs).forEach((run) => {
          // For each machine
          run.machines.forEach((machine) => {
            const hasAnyData =
              machine.iperf3.tcp !== null ||
              machine.iperf3.udp !== null ||
              machine.qperf !== null ||
              machine.nixCache !== null ||
              machine.ping !== null ||
              machine.ristStream !== null;

            if (hasAnyData) {
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
    });
  });

  // Convert to AllBenchData format: alias -> kernelProfile -> BenchData (array of categories)
  const result: AllBenchData = {};
  for (const [alias, kernelProfiles] of Object.entries(aliasData)) {
    result[alias] = {};
    for (const [kp, categories] of Object.entries(kernelProfiles)) {
      result[alias][kp] = Object.values(categories);
    }
  }
  return result;
}

// --- Generate and Log Data ---
export const allBenchData = generateBenchData();

// Helper to get available aliases sorted by date (newest first)
export function getAvailableAliases(): string[] {
  const aliases = Object.keys(allBenchData);
  return aliases.sort((a, b) => {
    // Try to parse as DD.MM.YYYY date format
    const parseDate = (s: string): Date | null => {
      const parts = s.split(".");
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          return new Date(year, month - 1, day);
        }
      }
      return null;
    };
    const dateA = parseDate(a);
    const dateB = parseDate(b);
    // Sort dates descending (newest first)
    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }
    // Dates come before non-dates
    if (dateA) return -1;
    if (dateB) return 1;
    // Non-dates sorted alphabetically
    return a.localeCompare(b);
  });
}

// Get available kernel profiles for a given alias
export function getAvailableKernelProfiles(alias?: string): string[] {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allBenchData[targetAlias];
  if (!kpData) return [];
  // Sort so "baseline" comes first
  return Object.keys(kpData).sort((a, b) => {
    if (a === "baseline") return -1;
    if (b === "baseline") return 1;
    return a.localeCompare(b);
  });
}

// Get data for a specific alias and kernel profile
export function getBenchDataForAlias(
  alias?: string,
  kernelProfile?: string,
): BenchData {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allBenchData[targetAlias];
  if (!kpData) return [];
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || [];
}

// Get all unique VPN names across all aliases and kernel profiles
export function getAllVpnNames(): string[] {
  const names = new Set<string>();
  for (const kpData of Object.values(allBenchData)) {
    for (const categories of Object.values(kpData)) {
      for (const category of categories) {
        names.add(category.name);
      }
    }
  }
  return [...names].sort();
}

// Backward compatible export: use first available alias and kernel profile
export const benchData = getBenchDataForAlias();

// --- Kernel Profile Metadata Loading ---

const kernelProfileFiles = import.meta.glob(
  "@/bench/**/kernel_profile.json",
  { eager: true },
);

export function loadAllKernelProfileMetadata(): AllKernelProfileMetadata {
  const result: AllKernelProfileMetadata = {};

  Object.entries(kernelProfileFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    // Path: @/bench/<ALIAS>/<KERNEL_PROFILE>/kernel_profile.json
    if (pathParts.length < 4) return;

    const kernelProfile = pathParts[pathParts.length - 2];
    const alias = pathParts[pathParts.length - 3];

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("name" in rawModule)
    ) {
      return;
    }

    if (!result[alias]) {
      result[alias] = {};
    }

    result[alias][kernelProfile] = rawModule as KernelProfileMetadata;
  });

  return result;
}

export const allKernelProfileMetadata = loadAllKernelProfileMetadata();
console.log("Kernel profile metadata:", allKernelProfileMetadata);

// --- General Data Handling ---
// Note: General data is now per-alias/kernel-profile at @/bench/<ALIAS>/<KERNEL_PROFILE>/General/
const generalFiles = import.meta.glob("@/bench/**/General/**/*.json", {
  eager: true,
});

export function generateGeneralData(): GeneralData | undefined {
  const result: GeneralData = {};
  Object.entries(generalFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    if (pathParts.length < 4) {
      console.warn(
        `Skipping general file with unexpected path structure: ${path}`,
      );
      return;
    }
    const fileName = pathParts[pathParts.length - 1];
    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      console.warn(
        `Skipping general file with unexpected content format (missing 'status'): ${path}`,
        rawModule,
      );
      return;
    }
    const moduleData = rawModule as JsonWrapper<ConnectionTimings>;
    let actualData: ConnectionTimings | null = null;
    if (moduleData.status === "success") {
      actualData = moduleData.data;
    } else if (moduleData.status === "error") {
      console.warn(
        `General data retrieval failed for ${path}: Type=${moduleData.error_type}`,
        moduleData.error,
      );
    } else {
      console.warn(
        /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
        `Skipping general file with unknown status '${(moduleData as any).status}': ${path}`,
      );
      return;
    }
    if (actualData !== null) {
      if (fileName === "connection_timings.json") {
        result.connection_timings = actualData;
      } else if (fileName === "reboot_connection_timings.json") {
        result.reboot_connection_timings = actualData;
      }
    }
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

export const generalData = generateGeneralData();
console.log("General data:", generalData);

// --- Comparison Data Loading ---

const comparisonFiles = import.meta.glob(
  "@/bench/**/General/comparison/**/*.json",
  {
    eager: true,
  },
);

export function generateComparisonData(): AllComparisonData {
  const result: AllComparisonData = {};

  Object.entries(comparisonFiles).forEach(([path, rawModule]) => {
    // Path format: @/bench/<ALIAS>/<KERNEL_PROFILE>/General/comparison/<run_alias>/<benchmark>.json
    const pathParts = path.split("/");

    // Find the "General" index to determine alias and kernel profile
    const generalIndex = pathParts.indexOf("General");
    if (generalIndex < 2 || pathParts.length < generalIndex + 4) {
      console.warn(`Skipping comparison file with unexpected path: ${path}`);
      return;
    }

    const kernelProfile = pathParts[generalIndex - 1];
    const alias = pathParts[generalIndex - 2];
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

    // Initialize alias if needed
    if (!result[alias]) {
      result[alias] = {};
    }

    // Initialize kernel profile if needed
    if (!result[alias][kernelProfile]) {
      result[alias][kernelProfile] = {};
    }

    // Initialize run alias if needed
    if (!result[alias][kernelProfile][runAlias]) {
      result[alias][kernelProfile][runAlias] = {
        tcSettings: loadTCSettingsForRunAlias(
          benchFiles,
          alias,
          kernelProfile,
          runAlias,
        ),
      };
    }

    // Assign data based on file name
    if (fileName === "ping.json") {
      result[alias][kernelProfile][runAlias].ping =
        moduleData.data as VpnComparisonResultMap<PingComparisonData>;
    } else if (fileName === "qperf.json") {
      result[alias][kernelProfile][runAlias].qperf =
        moduleData.data as VpnComparisonResultMap<QperfComparisonData>;
    } else if (fileName === "video_streaming.json") {
      result[alias][kernelProfile][runAlias].videoStreaming =
        moduleData.data as VpnComparisonResultMap<VideoStreamingComparisonData>;
    } else if (fileName === "tcp_iperf3.json") {
      result[alias][kernelProfile][runAlias].tcpIperf =
        moduleData.data as VpnComparisonResultMap<TcpIperfComparisonData>;
    } else if (fileName === "udp_iperf3.json") {
      result[alias][kernelProfile][runAlias].udpIperf =
        moduleData.data as VpnComparisonResultMap<UdpIperfComparisonData>;
    } else if (fileName === "nix_cache.json") {
      result[alias][kernelProfile][runAlias].nixCache =
        moduleData.data as VpnComparisonResultMap<NixCacheComparisonData>;
    } else if (fileName === "parallel_tcp_iperf3.json") {
      result[alias][kernelProfile][runAlias].parallelTcp =
        moduleData.data as VpnComparisonResultMap<ParallelTcpComparisonData>;
    } else if (fileName === "timing_comparison.json") {
      result[alias][kernelProfile][runAlias].timingComparison =
        moduleData.data as VpnComparisonResultMap<TimingComparisonData>;
    } else if (fileName === "benchmark_stats.json") {
      result[alias][kernelProfile][runAlias].benchmarkStats =
        moduleData.data as VpnComparisonResultMap<BenchmarkStatsData>;
    } else if (fileName === "time_breakdown.json") {
      result[alias][kernelProfile][runAlias].timeBreakdown = moduleData as {
        status: string;
        data: TimeBreakdownData;
      };
    } else if (fileName === "connection_timings.json") {
      result[alias][kernelProfile][runAlias].connectionTimings =
        moduleData.data as ConnectionTimings;
    } else if (fileName === "reboot_connection_timings.json") {
      result[alias][kernelProfile][runAlias].rebootConnectionTimings =
        moduleData.data as ConnectionTimings;
    }
  });

  return result;
}

export const allComparisonData = generateComparisonData();
console.log("All comparison data:", allComparisonData);

// Get comparison data for a specific alias and kernel profile
export function getComparisonDataForAlias(
  alias?: string,
  kernelProfile?: string,
): ComparisonData {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allComparisonData[targetAlias];
  if (!kpData) return {};
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || {};
}

// Backward compatible export: use first available alias and kernel profile
export const comparisonData = getComparisonDataForAlias();

// --- Timing Breakdown Loading ---

const timingFiles = import.meta.glob("@/bench/**/timing_breakdown.json", {
  eager: true,
});

export function generateTimingData(): ProfileTimingData {
  const result: ProfileTimingData = {};

  Object.entries(timingFiles).forEach(([path, rawModule]) => {
    // Path format: @/bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<run_alias>/timing_breakdown.json
    const pathParts = path.split("/");

    if (pathParts.length < 5) {
      return;
    }

    // Skip General folder
    if (path.includes("/General/")) {
      return;
    }

    const fileName = pathParts[pathParts.length - 1];
    if (fileName !== "timing_breakdown.json") {
      return;
    }

    // Path: @/bench/<ALIAS>/<KERNEL_PROFILE>/<VPN>/<RUN_ALIAS>/timing_breakdown.json
    const vpnName = pathParts[pathParts.length - 3];
    const runAlias = pathParts[pathParts.length - 2];

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("total_duration_seconds" in rawModule)
    ) {
      return;
    }

    const timingData = rawModule as TimingBreakdown;

    // Initialize run alias if needed
    if (!result[runAlias]) {
      result[runAlias] = {};
    }

    result[runAlias][vpnName] = timingData;
  });

  return result;
}

export const timingData = generateTimingData();
console.log("Timing data:", timingData);

// Helper function to calculate total runtime for a profile
export function getTotalRuntimeForProfile(
  timingMap: VpnTimingMap | undefined,
): number | null {
  if (!timingMap || Object.keys(timingMap).length === 0) {
    return null;
  }

  let total = 0;
  for (const vpnTiming of Object.values(timingMap)) {
    total += vpnTiming.total_duration_seconds;
  }
  return total;
}

// --- Cross-Profile TCP Data Loading ---

const crossProfileTcpFiles = import.meta.glob(
  "@/bench/**/General/comparison/cross_profile_tcp.json",
  { eager: true },
);

// Maps kernel profile to cross-profile TCP data
export type KernelProfileCrossProfileTcpData = Record<
  string,
  CrossProfileTcpData | null
>;
// Maps alias to kernel profile cross-profile TCP data
export type AllCrossProfileTcpData = Record<
  string,
  KernelProfileCrossProfileTcpData
>;

export function loadAllCrossProfileTcpData(): AllCrossProfileTcpData {
  const result: AllCrossProfileTcpData = {};

  Object.entries(crossProfileTcpFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    const generalIndex = pathParts.indexOf("General");
    if (generalIndex < 2) return;
    const kernelProfile = pathParts[generalIndex - 1];
    const alias = pathParts[generalIndex - 2];

    if (!result[alias]) {
      result[alias] = {};
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      result[alias][kernelProfile] = null;
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as { status: string; data?: any };

    if (moduleData.status !== "success" || !moduleData.data) {
      result[alias][kernelProfile] = null;
      return;
    }

    result[alias][kernelProfile] = moduleData.data as CrossProfileTcpData;
  });

  return result;
}

export const allCrossProfileTcpData = loadAllCrossProfileTcpData();
console.log("All cross-profile TCP data:", allCrossProfileTcpData);

// Backward compatible: get first alias and kernel profile data
export const crossProfileTcpData =
  getCrossProfileTcpDataForAlias(getAvailableAliases()[0]);

export function getCrossProfileTcpDataForAlias(
  alias?: string,
  kernelProfile?: string,
): CrossProfileTcpData | null {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allCrossProfileTcpData[targetAlias];
  if (!kpData) return null;
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || null;
}

// --- Cross-Profile UDP Data Loading ---

const crossProfileUdpFiles = import.meta.glob(
  "@/bench/**/General/comparison/cross_profile_udp.json",
  { eager: true },
);

export type KernelProfileCrossProfileUdpData = Record<
  string,
  CrossProfileUdpData | null
>;
export type AllCrossProfileUdpData = Record<
  string,
  KernelProfileCrossProfileUdpData
>;

export function loadAllCrossProfileUdpData(): AllCrossProfileUdpData {
  const result: AllCrossProfileUdpData = {};

  Object.entries(crossProfileUdpFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    const generalIndex = pathParts.indexOf("General");
    if (generalIndex < 2) return;
    const kernelProfile = pathParts[generalIndex - 1];
    const alias = pathParts[generalIndex - 2];

    if (!result[alias]) {
      result[alias] = {};
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      result[alias][kernelProfile] = null;
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as { status: string; data?: any };

    if (moduleData.status !== "success" || !moduleData.data) {
      result[alias][kernelProfile] = null;
      return;
    }

    result[alias][kernelProfile] = moduleData.data as CrossProfileUdpData;
  });

  return result;
}

export const allCrossProfileUdpData = loadAllCrossProfileUdpData();
console.log("All cross-profile UDP data:", allCrossProfileUdpData);

// Backward compatible: get first alias and kernel profile data
export const crossProfileUdpData =
  getCrossProfileUdpDataForAlias(getAvailableAliases()[0]);

export function getCrossProfileUdpDataForAlias(
  alias?: string,
  kernelProfile?: string,
): CrossProfileUdpData | null {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allCrossProfileUdpData[targetAlias];
  if (!kpData) return null;
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || null;
}

// --- Cross-Profile Ping Data Loading ---

const crossProfilePingFiles = import.meta.glob(
  "@/bench/**/General/comparison/cross_profile_ping.json",
  { eager: true },
);

export type KernelProfileCrossProfilePingData = Record<
  string,
  CrossProfilePingData | null
>;
export type AllCrossProfilePingData = Record<
  string,
  KernelProfileCrossProfilePingData
>;

export function loadAllCrossProfilePingData(): AllCrossProfilePingData {
  const result: AllCrossProfilePingData = {};

  Object.entries(crossProfilePingFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    const generalIndex = pathParts.indexOf("General");
    if (generalIndex < 2) return;
    const kernelProfile = pathParts[generalIndex - 1];
    const alias = pathParts[generalIndex - 2];

    if (!result[alias]) {
      result[alias] = {};
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      result[alias][kernelProfile] = null;
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as { status: string; data?: any };

    if (moduleData.status !== "success" || !moduleData.data) {
      result[alias][kernelProfile] = null;
      return;
    }

    result[alias][kernelProfile] = moduleData.data as CrossProfilePingData;
  });

  return result;
}

export const allCrossProfilePingData = loadAllCrossProfilePingData();
console.log("All cross-profile Ping data:", allCrossProfilePingData);

export const crossProfilePingData = getCrossProfilePingDataForAlias(
  getAvailableAliases()[0],
);

export function getCrossProfilePingDataForAlias(
  alias?: string,
  kernelProfile?: string,
): CrossProfilePingData | null {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allCrossProfilePingData[targetAlias];
  if (!kpData) return null;
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || null;
}

// --- Cross-Profile QUIC/Qperf Data Loading ---

const crossProfileQperfFiles = import.meta.glob(
  "@/bench/**/General/comparison/cross_profile_qperf.json",
  { eager: true },
);

export type KernelProfileCrossProfileQperfData = Record<
  string,
  CrossProfileQperfData | null
>;
export type AllCrossProfileQperfData = Record<
  string,
  KernelProfileCrossProfileQperfData
>;

export function loadAllCrossProfileQperfData(): AllCrossProfileQperfData {
  const result: AllCrossProfileQperfData = {};

  Object.entries(crossProfileQperfFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    const generalIndex = pathParts.indexOf("General");
    if (generalIndex < 2) return;
    const kernelProfile = pathParts[generalIndex - 1];
    const alias = pathParts[generalIndex - 2];

    if (!result[alias]) {
      result[alias] = {};
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      result[alias][kernelProfile] = null;
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as { status: string; data?: any };

    if (moduleData.status !== "success" || !moduleData.data) {
      result[alias][kernelProfile] = null;
      return;
    }

    result[alias][kernelProfile] = moduleData.data as CrossProfileQperfData;
  });

  return result;
}

export const allCrossProfileQperfData = loadAllCrossProfileQperfData();
console.log("All cross-profile QUIC data:", allCrossProfileQperfData);

export const crossProfileQperfData = getCrossProfileQperfDataForAlias(
  getAvailableAliases()[0],
);

export function getCrossProfileQperfDataForAlias(
  alias?: string,
  kernelProfile?: string,
): CrossProfileQperfData | null {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allCrossProfileQperfData[targetAlias];
  if (!kpData) return null;
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || null;
}

// --- Cross-Profile Video Streaming Data Loading ---

const crossProfileVideoStreamingFiles = import.meta.glob(
  "@/bench/**/General/comparison/cross_profile_video_streaming.json",
  { eager: true },
);

export type KernelProfileCrossProfileVideoStreamingData = Record<
  string,
  CrossProfileVideoStreamingData | null
>;
export type AllCrossProfileVideoStreamingData = Record<
  string,
  KernelProfileCrossProfileVideoStreamingData
>;

export function loadAllCrossProfileVideoStreamingData(): AllCrossProfileVideoStreamingData {
  const result: AllCrossProfileVideoStreamingData = {};

  Object.entries(crossProfileVideoStreamingFiles).forEach(
    ([path, rawModule]) => {
      const pathParts = path.split("/");
      const generalIndex = pathParts.indexOf("General");
      if (generalIndex < 2) return;
      const kernelProfile = pathParts[generalIndex - 1];
      const alias = pathParts[generalIndex - 2];

      if (!result[alias]) {
        result[alias] = {};
      }

      if (
        !rawModule ||
        typeof rawModule !== "object" ||
        !("status" in rawModule)
      ) {
        result[alias][kernelProfile] = null;
        return;
      }

      /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
      const moduleData = rawModule as { status: string; data?: any };

      if (moduleData.status !== "success" || !moduleData.data) {
        result[alias][kernelProfile] = null;
        return;
      }

      result[alias][kernelProfile] =
        moduleData.data as CrossProfileVideoStreamingData;
    },
  );

  return result;
}

export const allCrossProfileVideoStreamingData =
  loadAllCrossProfileVideoStreamingData();
console.log(
  "All cross-profile Video Streaming data:",
  allCrossProfileVideoStreamingData,
);

export const crossProfileVideoStreamingData =
  getCrossProfileVideoStreamingDataForAlias(getAvailableAliases()[0]);

export function getCrossProfileVideoStreamingDataForAlias(
  alias?: string,
  kernelProfile?: string,
): CrossProfileVideoStreamingData | null {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allCrossProfileVideoStreamingData[targetAlias];
  if (!kpData) return null;
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || null;
}

// --- Cross-Profile Nix Cache Data Loading ---

const crossProfileNixCacheFiles = import.meta.glob(
  "@/bench/**/General/comparison/cross_profile_nix_cache.json",
  { eager: true },
);

export type KernelProfileCrossProfileNixCacheData = Record<
  string,
  CrossProfileNixCacheData | null
>;
export type AllCrossProfileNixCacheData = Record<
  string,
  KernelProfileCrossProfileNixCacheData
>;

export function loadAllCrossProfileNixCacheData(): AllCrossProfileNixCacheData {
  const result: AllCrossProfileNixCacheData = {};

  Object.entries(crossProfileNixCacheFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    const generalIndex = pathParts.indexOf("General");
    if (generalIndex < 2) return;
    const kernelProfile = pathParts[generalIndex - 1];
    const alias = pathParts[generalIndex - 2];

    if (!result[alias]) {
      result[alias] = {};
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      result[alias][kernelProfile] = null;
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as { status: string; data?: any };

    if (moduleData.status !== "success" || !moduleData.data) {
      result[alias][kernelProfile] = null;
      return;
    }

    result[alias][kernelProfile] = moduleData.data as CrossProfileNixCacheData;
  });

  return result;
}

export const allCrossProfileNixCacheData = loadAllCrossProfileNixCacheData();
console.log("All cross-profile Nix Cache data:", allCrossProfileNixCacheData);

export const crossProfileNixCacheData = getCrossProfileNixCacheDataForAlias(
  getAvailableAliases()[0],
);

export function getCrossProfileNixCacheDataForAlias(
  alias?: string,
  kernelProfile?: string,
): CrossProfileNixCacheData | null {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allCrossProfileNixCacheData[targetAlias];
  if (!kpData) return null;
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || null;
}

// --- Hardware Comparison Data Loading ---

const hardwareFiles = import.meta.glob("@/bench/**/General/hardware.json", {
  eager: true,
});

export type KernelProfileHardwareData = Record<
  string,
  HardwareComparisonData | null
>;
export type AllHardwareData = Record<string, KernelProfileHardwareData>;

export function loadAllHardwareData(): AllHardwareData {
  const result: AllHardwareData = {};

  Object.entries(hardwareFiles).forEach(([path, rawModule]) => {
    const pathParts = path.split("/");
    const generalIndex = pathParts.indexOf("General");
    if (generalIndex < 2) return;
    const kernelProfile = pathParts[generalIndex - 1];
    const alias = pathParts[generalIndex - 2];

    if (!result[alias]) {
      result[alias] = {};
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      result[alias][kernelProfile] = null;
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as { status: string; data?: any };

    if (moduleData.status !== "success" || !moduleData.data) {
      result[alias][kernelProfile] = null;
      return;
    }

    result[alias][kernelProfile] = moduleData.data as HardwareComparisonData;
  });

  return result;
}

export const allHardwareData = loadAllHardwareData();
console.log("All hardware data:", allHardwareData);

export function getHardwareDataForAlias(
  alias?: string,
  kernelProfile?: string,
): HardwareComparisonData | null {
  const aliases = getAvailableAliases();
  const targetAlias = alias || aliases[0] || "";
  const kpData = allHardwareData[targetAlias];
  if (!kpData) return null;
  const kps = getAvailableKernelProfiles(targetAlias);
  const targetKp = kernelProfile || kps[0] || "baseline";
  return kpData[targetKp] || null;
}

export const hardwareData = getHardwareDataForAlias();
