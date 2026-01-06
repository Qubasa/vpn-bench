import { Portal, render } from "solid-js/web";
import {
  Navigate,
  RouteDefinition,
  Router,
  useSearchParams,
} from "@solidjs/router";
import { createSignal, For, createMemo } from "solid-js";
import { Tabs } from "@kobalte/core/tabs";

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
  comparisonData,
  BenchData,
  ComparisonData,
  Err,
  Machine,
  Ok,
  Result,
  MixedReport,
} from "./benchData";
import { GeneralDashboard } from "./components/GeneralDashboard";
import { ConnectionTimesDashboard } from "./components/ConnectionTimesDashboard";
import { TcpCrossProfileDashboard } from "./components/TcpCrossProfileDashboard";
import { QperfData, QperfReport } from "./components/QperfCharts";
import { HyperfineData, HyperfineReport } from "./components/HyperfineCharts";
import { PingData, PingReport } from "./components/PingCharts";
import { RistData, RistReport } from "./components/RistStreamCharts";
import { TCSettingsData } from "./benchData";
import { AliasProvider } from "./AliasContext";
import { getVpnOverview } from "./vpnOverviews";
import { FeatureMatrixPage } from "./components/FeatureMatrixPage";
import { HardwarePage } from "./components/HardwarePage";

export const client = new QueryClient();

// Logical ordering for TC profiles (from no impairment to severe)
export const TC_PROFILE_ORDER = [
  "baseline",
  "low_impairment",
  "medium_impairment",
  "high_impairment",
];

export function sortTcProfiles(profiles: string[]): string[] {
  return [...profiles].sort((a, b) => {
    const aIndex = TC_PROFILE_ORDER.indexOf(a);
    const bIndex = TC_PROFILE_ORDER.indexOf(b);
    // Known profiles sorted by order, unknown profiles go at the end alphabetically
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

// TC Settings Display Component
function TCSettingsDisplay(props: { tcSettings: TCSettingsData | null }) {
  // Values are already totals from Python (doubled there for additive metrics)
  const getTotalLatency = () => props.tcSettings?.settings?.latency_ms ?? null;
  const getTotalJitter = () => props.tcSettings?.settings?.jitter_ms ?? null;
  const getTotalPacketLoss = () =>
    props.tcSettings?.settings?.packet_loss_percent ?? null;
  const getTotalReorder = () =>
    props.tcSettings?.settings?.reorder_percent ?? null;

  // Check if any settings are applied
  const hasSettings = () =>
    props.tcSettings?.settings &&
    (props.tcSettings.settings.latency_ms != null ||
      props.tcSettings.settings.jitter_ms != null ||
      props.tcSettings.settings.packet_loss_percent != null ||
      props.tcSettings.settings.reorder_percent != null ||
      props.tcSettings.settings.bandwidth_mbit != null);

  return (
    <div class="mb-6 rounded-lg border-2 border-secondary-200 bg-secondary-50 p-4">
      <h3 class="mb-2 text-lg font-semibold text-secondary-900">
        Network Conditions
      </h3>
      {hasSettings() ? (
        <>
          <p class="text-xs italic text-secondary-500">
            Total round-trip impairment (half applied to each endpoint)
          </p>
          <div class="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {getTotalLatency() !== null && (
              <div class="rounded bg-white p-2">
                <div class="font-medium text-secondary-600">Latency</div>
                <div class="text-lg font-semibold text-secondary-900">
                  {getTotalLatency()}ms
                </div>
              </div>
            )}
            {getTotalJitter() !== null && (
              <div class="rounded bg-white p-2">
                <div class="font-medium text-secondary-600">Jitter</div>
                <div class="text-lg font-semibold text-secondary-900">
                  {getTotalJitter()}ms
                </div>
              </div>
            )}
            {getTotalPacketLoss() !== null && (
              <div class="rounded bg-white p-2">
                <div class="font-medium text-secondary-600">Packet Loss</div>
                <div class="text-lg font-semibold text-secondary-900">
                  {getTotalPacketLoss()}%
                </div>
              </div>
            )}
            {getTotalReorder() !== null && (
              <div class="rounded bg-white p-2">
                <div class="font-medium text-secondary-600">Reordering</div>
                <div class="text-lg font-semibold text-secondary-900">
                  {getTotalReorder()}%
                </div>
              </div>
            )}
            {props.tcSettings?.settings?.bandwidth_mbit != null && (
              <div class="rounded bg-white p-2">
                <div class="font-medium text-secondary-600">Bandwidth</div>
                <div class="text-lg font-semibold text-secondary-900">
                  {props.tcSettings.settings.bandwidth_mbit} Mbit/s
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <p class="text-base text-secondary-700">
          No network impairment applied
        </p>
      )}
    </div>
  );
}

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
  category?: "vpn" | "analysis";
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

  // Get metadata from the first successful result (all machines should have similar metadata)
  const firstSuccessResult = machineResults[0].result as Ok<TData>;
  const metadata = firstSuccessResult.meta;

  // Return an Ok result containing the array of successfully mapped reports, preserving metadata
  return { ok: true, value: successData, meta: metadata };
}

// Helper function to process results keeping both success and error states for mixed display
function processCategoryReportsMixed<TData>(
  machines: Machine[],
  // Function to access the specific Result object on a machine
  accessor: (m: Machine) => Result<TData> | null,
): MixedReport<TData>[] | null {
  // Get results along with machine names, filtering out machines where the result is null
  const machineResults = machines
    .map((m) => ({ name: m.name, result: accessor(m) }))
    .filter((mr) => mr.result !== null) as MixedReport<TData>[];

  // Handle case where no machines had data for this benchmark
  if (machineResults.length === 0) {
    return null;
  }

  return machineResults;
}

// Wrapper component that handles TC profile selection
function VpnDashboardWithProfiles(props: { category: BenchData[0] }) {
  // Get the list of TC profile aliases, sorted in logical order
  const runAliases = sortTcProfiles(Object.keys(props.category.runs));

  // Get URL search params for state sync
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize from URL or fallback to first run
  const initialRun =
    searchParams.profile && runAliases.includes(searchParams.profile)
      ? searchParams.profile
      : runAliases[0] || "baseline";

  const [selectedRun, setSelectedRun] = createSignal(initialRun);

  // Handler that updates both local state AND URL
  const handleRunChange = (newRun: string) => {
    setSelectedRun(newRun);
    setSearchParams({ profile: newRun }); // Updates URL without reload
  };

  // Get machines and TC settings for the currently selected run
  const getCurrentRun = () => props.category.runs[selectedRun()];
  const getCurrentMachines = () => getCurrentRun()?.machines || [];
  const getCurrentTCSettings = () => getCurrentRun()?.tcSettings || null;

  // Process reports for the selected run's machines (memoized for reactivity)
  const reportsForCurrentRun = createMemo(() => {
    const machines = getCurrentMachines();
    const run = getCurrentRun();

    return {
      tcp: processCategoryReportsMixed<IperfTcpReportData>(
        machines,
        (m) => m.iperf3.tcp,
      ),
      udp: processCategoryReportsMixed<IperfUdpReportData>(
        machines,
        (m) => m.iperf3.udp,
      ),
      // Parallel TCP is at run level, not machine level
      parallelTcp: run?.parallelTcp || null,
      qperf: processCategoryReportsMixed<QperfData>(machines, (m) => m.qperf),
      nixCache: processCategoryReportsMixed<HyperfineData>(
        machines,
        (m) => m.nixCache,
      ),
      ping: processCategoryReportsMixed<PingData>(machines, (m) => m.ping),
      ristStream: processCategoryReportsMixed<RistData>(
        machines,
        (m) => m.ristStream,
      ),
    };
  });

  return (
    <div>
      {/* TC Profile Tabs - only show if there are multiple profiles */}
      {runAliases.length > 1 ? (
        <Tabs
          value={selectedRun()}
          onChange={handleRunChange}
          class="tc-profile-tabs"
        >
          <Tabs.List class="tc-profile-tabs__list">
            <For each={runAliases}>
              {(alias) => (
                <Tabs.Trigger class="tc-profile-tabs__trigger" value={alias}>
                  {alias
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                </Tabs.Trigger>
              )}
            </For>
            <Tabs.Indicator class="tc-profile-tabs__indicator" />
          </Tabs.List>
        </Tabs>
      ) : null}

      {/* Display TC settings for current profile */}
      <TCSettingsDisplay tcSettings={getCurrentTCSettings()} />

      {/* Render VpnDashboard with reports from selected run */}
      <VpnDashboard
        vpnName={props.category.name}
        overviewMarkdown={getVpnOverview(props.category.name) ?? undefined}
        tcpReports={reportsForCurrentRun().tcp}
        udpReports={reportsForCurrentRun().udp}
        parallelTcpReport={reportsForCurrentRun().parallelTcp}
        qperfReports={reportsForCurrentRun().qperf}
        nixCacheReports={reportsForCurrentRun().nixCache}
        pingReports={reportsForCurrentRun().ping}
        ristStreamReports={reportsForCurrentRun().ristStream}
        defaultTab={
          searchParams.tab as
            | "info"
            | "tcp_iperf"
            | "udp_iperf"
            | "parallel_tcp"
            | "qperf"
            | "nix-cache"
            | "ping"
            | "rist-stream"
            | undefined
        }
      />
    </div>
  );
}

// Function to generate routes from benchData, passing aggregated Results
function generateRoutesFromBenchData(data: BenchData): AppRoute[] {
  return data.map((category) => {
    const path = `/${category.name.toLowerCase().replace(/\s+/g, "_")}`;

    // Check if category has any runs
    const hasRuns = Object.keys(category.runs).length > 0;

    return {
      path,
      label: category.name,
      component: () => <VpnDashboardWithProfiles category={category} />,
      // Hide route if category has no runs
      hidden: !hasRuns,
      category: "vpn" as const,
    };
  });
}

function generateAppRouteFromGeneralData(
  comparison: ComparisonData,
): AppRoute[] {
  if (Object.keys(comparison).length === 0) {
    return [];
  }

  // Get all VPN names from benchData to show incomplete VPNs
  const allVpnNames = benchData.map((category) => category.name);

  return [
    {
      path: "/overview",
      label: "Across VPNs",
      component: () => (
        <GeneralDashboard
          comparisonData={comparison}
          allVpnNames={allVpnNames}
        />
      ),
      category: "analysis" as const,
    },
  ];
}

function generateConnectionTimesRoute(comparison: ComparisonData): AppRoute[] {
  if (Object.keys(comparison).length === 0) {
    return [];
  }

  return [
    {
      path: "/connection-times",
      label: "Connection Times",
      component: () => <ConnectionTimesDashboard comparisonData={comparison} />,
      category: "analysis" as const,
    },
  ];
}

function generateCrossProfileRoute(): AppRoute[] {
  return [
    {
      path: "/cross-profile",
      label: "Across Impairments",
      component: () => <TcpCrossProfileDashboard />,
      category: "analysis" as const,
    },
  ];
}

function generateFeatureMatrixRoute(): AppRoute[] {
  return [
    {
      path: "/feature-matrix",
      label: "Feature Matrix",
      component: () => <FeatureMatrixPage />,
      category: "analysis" as const,
    },
  ];
}

function generateHardwareRoute(): AppRoute[] {
  return [
    {
      path: "/hardware",
      label: "Hardware",
      component: () => <HardwarePage />,
      category: "analysis" as const,
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
        ...generateAppRouteFromGeneralData(comparisonData),
        ...generateConnectionTimesRoute(comparisonData),
        ...generateCrossProfileRoute(),
        ...generateFeatureMatrixRoute(),
        ...generateHardwareRoute(),
      ]
    : [];

render(
  () => (
    <>
      <Portal mount={document.body}>
        <Toaster position="top-right" containerClassName="z-[9999]" />
      </Portal>
      <AliasProvider>
        <QueryClientProvider client={client}>
          <Router root={Layout}>{routes}</Router>
        </QueryClientProvider>
      </AliasProvider>
    </>
  ),
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  root!,
);
