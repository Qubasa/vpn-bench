import { Portal, render } from "solid-js/web";
import { Navigate, RouteDefinition, Router } from "@solidjs/router";

import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";

import { Layout } from "./layout/layout";
import { VpnDashboard } from "@/src/components/VpnBenchDashboard";
import {
  IperfTcpReport,
  IperfTcpReportData,
} from "@/src/components/IperfTcpCharts";
import {
  IperfUdpReport,
  IperfUdpReportData,
} from "./components/IperfUdpCharts";
import { Toaster } from "solid-toast";
import { IconVariant } from "./components/icon";
import {
  benchData,
  generalData,
  GeneralData,
  BenchData,
  Err,
  Machine,
  Ok,
  Result,
} from "./benchData";
import { GeneralDashboard } from "./components/GeneralDashboard";
import { QperfData, QperfReport } from "./components/QperfCharts";
import { HyperfineData, HyperfineReport } from "./components/HyperfineCharts";
import { PingData, PingReport } from "./components/PingCharts";

export const client = new QueryClient();

const root = document.getElementById("app");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  );
}

if (import.meta.env.DEV) {
  console.log("Development mode");
  // Load the debugger in development mode
  await import("solid-devtools");
}

export type AppRoute = Omit<RouteDefinition, "children"> & {
  label: string;
  icon?: IconVariant;
  children?: AppRoute[];
  hidden?: boolean;
};

// Helper function to process results for a specific benchmark type across machines
function processCategoryReports<TData, TReport>(
  machines: Machine[],
  // Function to access the specific Result object on a machine
  accessor: (m: Machine) => Result<TData> | null,
  // Function to map successful data and machine name to the final report structure
  reportMapper: (name: string, data: TData) => TReport,
): Result<TReport[]> | null {
  // Get results along with machine names, filtering out machines where the result is null
  const machineResults = machines
    .map((m) => ({ name: m.name, result: accessor(m) }))
    .filter((mr) => mr.result !== null) as {
    name: string;
    result: Result<TData>;
  }[]; // Ensure result is not null here

  // 1. Handle case where no machines had data for this benchmark
  if (machineResults.length === 0) {
    return null;
  }

  // 2. Check for any errors among the results
  const errors = machineResults.filter((mr) => !mr.result.ok);
  if (errors.length > 0) {
    // Return the first encountered error as the representative error for the category
    // The error structure from the first failed machine is preserved
    return errors[0].result as Err; // Type assertion is safe here
  }

  // 3. If no errors, all results are Ok. Aggregate successful data.
  const successData: TReport[] = machineResults.map((mr) => {
    // We know result is Ok here due to the error check above
    const successResult = mr.result as Ok<TData>;
    return reportMapper(mr.name, successResult.value);
  });

  // Return an Ok result containing the array of successfully mapped reports
  return { ok: true, value: successData };
}

// Function to generate routes from benchData, passing aggregated Results
function generateRoutesFromBenchData(data: BenchData): AppRoute[] {
  return data.map((category) => {
    const path = `/${category.name.toLowerCase().replace(/\s+/g, "_")}`;

    // Process TCP reports for the category
    const aggregatedTcpResult = processCategoryReports<
      IperfTcpReportData,
      IperfTcpReport
    >(
      category.machines,
      (m) => m.iperf3.tcp,
      (name, data) => ({ name, data }), // Assuming IperfTcpReport = { name: string, data: IperfTcpReportData }
    );

    // Process UDP reports
    const aggregatedUdpResult = processCategoryReports<
      IperfUdpReportData,
      IperfUdpReport
    >(
      category.machines,
      (m) => m.iperf3.udp,
      (name, data) => ({ name, data }), // Assuming IperfUdpReport = { name: string, data: IperfUdpReportData }
    );

    // Process Qperf reports
    const aggregatedQperfResult = processCategoryReports<
      QperfData,
      QperfReport
    >(
      category.machines,
      (m) => m.qperf,
      (name, data) => ({ name, data }), // Assuming QperfReport = { name: string, data: QperfData }
    );

    // Process Nix Cache reports
    const aggregatedNixCacheResult = processCategoryReports<
      HyperfineData,
      HyperfineReport
    >(
      category.machines,
      (m) => m.nixCache,
      (name, data) => ({ name, data }), // Assuming HyperfineReport = { name: string, data: HyperfineData }
    );

    // Process Ping reports
    const aggregatedPingResult = processCategoryReports<PingData, PingReport>(
      category.machines,
      (m) => m.ping,
      (name, data) => ({ name, data }), // Assuming PingReport = { name: string, data: PingData }
    );

    return {
      path,
      label: category.name,
      component: () => (
        <VpnDashboard
          // Pass the aggregated Result objects (or null) directly
          tcpReports={aggregatedTcpResult}
          udpReports={aggregatedUdpResult}
          qperfReports={aggregatedQperfResult}
          nixCacheReports={aggregatedNixCacheResult}
          pingReports={aggregatedPingResult}
        />
      ),
      // Hide route if category has no machines (or potentially if *all* results are null?)
      hidden: category.machines.length === 0,
      // Example: Only show route if at least one benchmark type has *some* data (not null result)
      // hidden: !aggregatedTcpResult && !aggregatedUdpResult && !aggregatedQperfResult && !aggregatedNixCacheResult,
    };
  });
}

function generateAppRouteFromGeneralData(
  data: GeneralData | undefined,
): AppRoute[] {
  if (!data) {
    return [];
  }
  return [
    {
      path: "/general",
      label: "General",
      component: () => (
        <GeneralDashboard
          bootstrap_connection_timings={data.connection_timings}
          reboot_connection_timings={data.reboot_connection_timings}
        />
      ),
    },
  ];
}

// Generate routes from benchData
export const routes: AppRoute[] =
  benchData.length > 0
    ? [
        {
          path: "/",
          label: "",
          hidden: true,
          component: () => (
            <Navigate
              href={`/${benchData[0].name.toLowerCase().replace(/\s+/g, "_")}`}
            />
          ),
        },
        ...generateRoutesFromBenchData(benchData),
        ...generateAppRouteFromGeneralData(generalData),
      ]
    : [];

render(
  () => (
    <>
      <Portal mount={document.body}>
        <Toaster position="top-right" containerClassName="z-[9999]" />
      </Portal>
      <QueryClientProvider client={client}>
        <Router root={Layout}>{routes}</Router>
      </QueryClientProvider>
    </>
  ),
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  root!,
);
