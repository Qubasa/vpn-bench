import { Portal, render } from "solid-js/web";
import { Navigate, RouteDefinition, Router } from "@solidjs/router";

import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";

import { Layout } from "./layout/layout";
import { VpnDashboard } from "@/src/components/VpnBenchDashboard";
import { IperfTcpReport } from "@/src/components/IperfTcpCharts";
import { IperfUdpReport } from "./components/IperfUdpCharts";
import { Toaster } from "solid-toast";
import { IconVariant } from "./components/icon";
import { benchData, generalData, GeneralData } from "./benchData";
import { IperfTcpReportData } from "@/src/components/IperfTcpCharts";
import { IperfUdpReportData } from "./components/IperfUdpCharts";
import { GeneralDashboard } from "./components/GeneralDashboard";
import { QperfData, QperfReport } from "./components/QperfCharts";
import { HyperfineData, HyperfineReport } from "./components/HyperfineCharts";

export interface Machine {
  name: string;
  iperf3: {
    tcp: IperfTcpReportData | null;
    udp: IperfUdpReportData | null;
  };
  qperf: QperfData | null;
  nixCache: HyperfineData | null;
}

export interface BenchCategory {
  name: string;
  machines: Machine[];
}

export type BenchData = BenchCategory[];

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

// Function to generate routes from benchData in a more functional style
function generateRoutesFromBenchData(data: BenchData): AppRoute[] {
  return data.map((category) => {
    const path = `/${category.name.toLowerCase().replace(/\s+/g, "_")}`;

    const tcpReports = category.machines
      .map((machine) => {
        if (!machine.iperf3.tcp) {
          console.warn(`No TCP data for ${machine.name}`);
          return null;
        }
        return { name: machine.name, data: machine.iperf3.tcp };
      })
      .filter(Boolean) as IperfTcpReport[];

    const udpReports = category.machines
      .map((machine) => {
        if (!machine.iperf3.udp) {
          console.warn(`No UDP data for ${machine.name}`);
          return null;
        }
        return { name: machine.name, data: machine.iperf3.udp };
      })
      .filter(Boolean) as IperfUdpReport[];

    const qperfReports = category.machines
      .map((machine) => {
        if (!machine.qperf) {
          console.warn(`No Qperf data for ${machine.name}`);
          return null;
        }
        return { name: machine.name, data: machine.qperf };
      })
      .filter(Boolean) as QperfReport[];

    const nixCacheReports = category.machines
      .map((machine) =>
        machine.nixCache
          ? { name: machine.name, data: machine.nixCache }
          : null,
      )
      .filter(Boolean) as HyperfineReport[];

    return {
      path,
      label: category.name,
      component: () => (
        <VpnDashboard
          tcpReports={tcpReports.length ? tcpReports : null}
          udpReports={udpReports.length ? udpReports : null}
          qperfReports={qperfReports.length ? qperfReports : null}
          nixCacheReports={nixCacheReports.length ? nixCacheReports : null}
        />
      ),
      hidden: category.machines.length === 0,
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
export const routes: AppRoute[] = [
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
];

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
