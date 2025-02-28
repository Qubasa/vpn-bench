/* @refresh reload */
import { Portal, render } from "solid-js/web";
import { Navigate, RouteDefinition, Router } from "@solidjs/router";

import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";

import { Layout } from "./layout/layout";
import { IperfDashboard } from "@/src/components/VpnBenchDashboard";

import { Toaster } from "solid-toast";
import { IconVariant } from "./components/icon";
import { benchData, BenchData, IperfReport } from "./benchData";

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
    const tcpReports: IperfReport[] = [];
    const udpReports: IperfReport[] = [];

    // Process each machine's data
    category.machines.forEach((machine) => {
      machine.iperf3.forEach((iperfData) => {
        if (iperfData.type === "tcp") {
          tcpReports.push({
            name: machine.name.replace(/^\d+_/, ""), // Remove leading numbers and underscore
            data: iperfData.data,
          });
        } else if (iperfData.type === "udp") {
          udpReports.push({
            name: machine.name.replace(/^\d+_/, ""), // Remove leading numbers and underscore
            data: iperfData.data,
          });
        }
      });
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
  root!,
);
