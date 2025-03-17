import { Portal, render } from "solid-js/web";
import { Navigate, RouteDefinition, Router } from "@solidjs/router";

import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";

import { Layout } from "./layout/layout";
import { IperfDashboard } from "@/src/components/VpnBenchDashboard";
import { IperfTcpReport } from "@/src/components/IperfTcpCharts";
import { IperfUdpReport } from "./components/IperfUdpCharts";
import { Toaster } from "solid-toast";
import { IconVariant } from "./components/icon";
import { benchData, generalData, GeneralData } from "./benchData";
import { IperfTcpReportData } from "@/src/components/IperfTcpCharts";
import { IperfUdpReportData } from "./components/IperfUdpCharts";
import { GeneralDashboard } from "./components/GeneralDashboard";
export interface Machine {
  name: string;
  iperf3: {
    tcp: IperfTcpReportData | null;
    udp: IperfUdpReportData | null;
  };
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

// Function to generate routes from benchData
function generateRoutesFromBenchData(data: BenchData): AppRoute[] {
  return data.map((category) => {
    // Convert category name to URL-friendly path
    const path = `/${category.name.toLowerCase().replace(/\s+/g, "_")}`;

    // Group machines by type
    const tcpReports: IperfTcpReport[] = [];
    const udpReports: IperfUdpReport[] = [];

    // Process each machine's data
    category.machines.forEach((machine) => {
      if (machine.iperf3.tcp) {
        tcpReports.push({
          name: machine.name,
          data: machine.iperf3.tcp,
        });
      } else {
        console.warn(`No TCP data for ${machine.name}`);
      }

      if (machine.iperf3.udp) {
        udpReports.push({
          name: machine.name,
          data: machine.iperf3.udp,
        });
      } else {
        console.warn(`No UDP data for ${machine.name}`);
      }
    });

    // Return route config with IperfDashboard component
    return {
      path,
      label: category.name,
      component: () => (
        <IperfDashboard tcpReports={tcpReports} udpReports={udpReports} />
      ),
      hidden: category.machines.length === 0, // Hide if no machines
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
