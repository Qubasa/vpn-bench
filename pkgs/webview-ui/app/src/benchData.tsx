// benchData.ts
// This uses Vite's import.meta.glob to dynamically import all JSON files from benchmark folders

import { BenchCategory } from "@/src/index";
import { IperfTcpReportData } from "@/src/components/IperfTcpCharts";
import { IperfUdpReportData } from "./components/IperfUdpCharts";
import { ConnectionTimings } from "./components/GeneralDashboard";
import { QperfData } from "./components/QperfCharts";
import { HyperfineData } from "./components/HyperfineCharts";

type BenchData = BenchCategory[];

// Use import.meta.glob to get all JSON files from the bench directory
const benchFiles = import.meta.glob("@/bench/**/*.json", { eager: true });

// Throw an error if benchFiles is empty
if (Object.keys(benchFiles).length === 0) {
  throw new Error("No benchmark files found.");
}

// Process the files and build the data structure
export function generateBenchData(): BenchData {
  const categories: Record<string, BenchCategory> = {};

  // Process each file path
  Object.entries(benchFiles).forEach(([path, module]) => {
    // Parse the path to extract category, machine, and file type
    // Example path: /src/bench/NoVPN/0_luna/tcp_iperf3.json
    const pathParts = path.split("/");

    // Extract relevant parts
    const categoryName = pathParts[2]; // "NoVPN"

    if (categoryName === "General") {
      return;
    }

    const machineName = pathParts[3]; // "0_luna"
    console.log("Machine name:", machineName);
    const fileName = pathParts[4]; // "tcp_iperf3.json" or "udp_iperf3.json"

    // Skip if any part is missing
    if (!categoryName || !machineName || !fileName) return;

    // Create category if it doesn't exist
    if (!categories[categoryName]) {
      categories[categoryName] = {
        name: categoryName,
        machines: [],
      };
    }

    // Find machine or create if it doesn't exist
    let machine = categories[categoryName].machines.find(
      (m) => m.name === machineName,
    );

    // If machine doesn't exist, create it
    if (!machine) {
      machine = {
        name: machineName,
        iperf3: { tcp: null, udp: null },
        qperf: null,
        nixCache: null,
      };
      categories[categoryName].machines.push(machine);
    }

    // Filter out the default field in module objects
    const filteredModule = Object.fromEntries(
      Object.entries(module as IperfTcpReportData).filter(
        ([key]) => key !== "default",
      ),
    );

    if (fileName === "tcp_iperf3.json") {
      machine.iperf3.tcp = filteredModule as IperfTcpReportData;
    } else if (fileName === "udp_iperf3.json") {
      machine.iperf3.udp = filteredModule as IperfUdpReportData;
    }

    if (fileName === "qperf.json") {
      machine.qperf = filteredModule as QperfData;
    } else if (fileName === "nix-cache.json") {
      machine.nixCache = filteredModule as HyperfineData;
    }
  });

  // Convert the categories object to an array
  return Object.values(categories);
}

// Generate the benchmark data
export const benchData = generateBenchData();
console.log("Bench data:", benchData);

const generalFiles = import.meta.glob("@/bench/General/**/*.json", {
  eager: true,
});

export interface GeneralData {
  connection_timings?: ConnectionTimings;
  reboot_connection_timings?: ConnectionTimings;
}

export function generateGeneralData(): GeneralData | undefined {
  let result: GeneralData | undefined;

  // Process each file path
  Object.entries(generalFiles).forEach(([path, module]) => {
    const pathParts = path.split("/");

    const fileName = pathParts[3];
    console.log("File name:", fileName);

    if (fileName === "connection_timings.json") {
      const filteredConnectionTimings = Object.fromEntries(
        Object.entries(module as ConnectionTimings).filter(
          ([key]) => key !== "default",
        ),
      );
      if (result) {
        result.connection_timings = filteredConnectionTimings;
      } else {
        result = { connection_timings: filteredConnectionTimings };
      }
    } else if (fileName === "reboot_connection_timings.json") {
      const filteredConnectionTimings = Object.fromEntries(
        Object.entries(module as ConnectionTimings).filter(
          ([key]) => key !== "default",
        ),
      );
      if (result) {
        result.reboot_connection_timings = filteredConnectionTimings;
      } else {
        result = { reboot_connection_timings: filteredConnectionTimings };
      }
    }
  });

  return result;
}
export const generalData = generateGeneralData();
console.log("General data:", generalData);
