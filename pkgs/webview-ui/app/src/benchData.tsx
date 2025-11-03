// benchData.ts
import { IperfTcpReportData } from "@/src/components/IperfTcpCharts";
import { IperfUdpReportData } from "./components/IperfUdpCharts"; // Assuming path relative to benchData.ts
import { ConnectionTimings } from "./components/GeneralDashboard"; // Assuming path relative to benchData.ts
import { QperfData } from "./components/QperfCharts"; // Assuming path relative to benchData.ts
import { HyperfineData } from "./components/HyperfineCharts"; // Assuming path relative to benchData.ts
import { PingData } from "./components/PingCharts"; // Import ping data type

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

interface SuccessResponse<T> {
  status: "success";
  data: T;
}

interface ErrorResponse {
  status: "error";
  error_type: "CmdOut" | "ClanError";
  error: CmdOutError | ClanError;
}

type JsonWrapper<T> = SuccessResponse<T> | ErrorResponse;

// --- Result Type Definition ---

// Structure to hold the specific error details within the Result
export interface BenchmarkRunError {
  type: "CmdOut" | "ClanError";
  details: CmdOutError | ClanError;
  // Optionally add the source file path for better debugging context
  filePath?: string;
}

// Success case for the Result type
export interface Ok<T> {
  ok: true;
  value: T;
}

// Error case for the Result type
export interface Err {
  ok: false;
  error: BenchmarkRunError;
}

/**
 * Represents the outcome of a benchmark task.
 * It can either be Ok (success) containing the data of type T,
 * or Err (failure) containing a BenchmarkRunError.
 */
export type Result<T> = Ok<T> | Err;

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
}

// --- TC Settings Interface ---
export interface TCSettingsData {
  alias: string;
  description: string;
  settings: {
    bandwidth_mbit: number | null;
    latency_ms: number | null;
    jitter_ms: number | null;
    packet_loss_percent: number | null;
    reorder_percent: number | null;
    reorder_correlation: number | null;
  } | null;
}

// --- Updated BenchCategory and BenchData Types ---
export interface BenchCategory {
  name: string; // VPN name (e.g., "Tinc", "Wireguard")
  runs: Record<
    string,
    { machines: Machine[]; tcSettings: TCSettingsData | null }
  >; // TC profile alias -> machines and TC settings
}
export type BenchData = BenchCategory[];

// --- Existing GeneralData Interface ---
export interface GeneralData {
  connection_timings?: ConnectionTimings;
  reboot_connection_timings?: ConnectionTimings;
}

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
  const tcSettingsPath = `@/bench/${vpnName}/${runAlias}/tc_settings.json`;

  // Search for the tc_settings.json file in benchFiles
  for (const [path, rawModule] of Object.entries(benchFiles)) {
    if (path.includes(`/${vpnName}/${runAlias}/tc_settings.json`)) {
      if (rawModule && typeof rawModule === "object" && "alias" in rawModule) {
        return rawModule as TCSettingsData;
      }
    }
  }

  console.warn(`TC settings not found for ${vpnName}/${runAlias}`);
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
      console.warn(`Skipping file with unexpected path structure: ${path}`);
      return;
    }

    if (categoryName === "General") {
      return;
    }

    if (!categoryName || !machineName || !fileName) {
      console.warn(`Skipping file with missing path components: ${path}`);
      return;
    }

    if (
      !rawModule ||
      typeof rawModule !== "object" ||
      !("status" in rawModule)
    ) {
      console.warn(
        `Skipping file with unexpected content format (missing 'status'): ${path}`,
        rawModule,
      );
      return;
    }

    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    const moduleData = rawModule as JsonWrapper<any>; // Use 'any' for data type initially

    // --- Create Result object (Ok or Err) ---
    /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
    let generatedResult: Result<any>; // Use 'any' here, specific type applied during assignment

    if (moduleData.status === "success") {
      // Create an Ok result, value type depends on the file
      generatedResult = { ok: true, value: moduleData.data };
    } else if (moduleData.status === "error") {
      // Create an Err result
      console.warn(
        `Benchmark run failed for ${path}: Type=${moduleData.error_type}`,
        moduleData.error,
      );
      const errorDetails: BenchmarkRunError = {
        type: moduleData.error_type,
        details: moduleData.error,
        filePath: path, // Include path for context
      };
      generatedResult = { ok: false, error: errorDetails };
    } else {
      console.warn(
        /* eslint-disable-next-line "@typescript-eslint/no-explicit-any" */
        `Skipping file with unknown status '${(moduleData as any).status}': ${path}`,
      );
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
    }
    // Add more else if blocks for other potential benchmark file types
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
