import {
  IperfTcpCharts,
  IperfTcpReport, // Assuming IperfTcpReport is the type within the Result array
} from "@/src/components/IperfTcpCharts";
import {
  IperfUdpCharts,
  IperfUdpReport, // Assuming IperfUdpReport is the type within the Result array
} from "@/src/components/IperfUdpCharts";
import { Tabs } from "@kobalte/core/tabs";
import {
  QperfReport, // Assuming QperfReport is the type within the Result array
  QperfChartsDashboard,
} from "@/src/components/QperfCharts";
import "./style.css"; // Ensure this path is correct
import {
  HyperfineCharts,
  HyperfineReport, // Assuming HyperfineReport is the type within the Result array
} from "../HyperfineCharts"; // Ensure this path is correct
import { PingCharts, PingReport } from "@/src/components/PingCharts";
import {
  RistChartsDashboard,
  RistReport,
} from "@/src/components/RistStreamCharts";
import { For, JSX, Show, createSignal, createEffect } from "solid-js";
import { Result, Err, Ok } from "@/src/benchData"; // Assuming Result and BenchmarkRunError are here
// Using the name from your import - ensure this component accepts BenchmarkRunError
import { DisplayClanError } from "@/src/components/ClanError"; // *** USE THE CORRECT COMPONENT NAME AND PATH ***
import { useSearchParams } from "@solidjs/router";

// Define props for the dashboard component
interface VpnDashboardProps {
  // Ensure the generic type T in Result<T> matches what the Chart expects
  tcpReports: Result<IperfTcpReport[]> | null;
  udpReports: Result<IperfUdpReport[]> | null;
  nixCacheReports: Result<HyperfineReport[]> | null;
  qperfReports: Result<QperfReport[]> | null;
  pingReports: Result<PingReport[]> | null;
  ristStreamReports: Result<RistReport[]> | null;
  tcpHeight?: {
    throughput?: number;
    timeSeries?: number;
    cpu?: number;
    retransmits?: number;
  };
  udpHeight?: {
    throughput?: number;
    timeSeries?: number;
    packetLoss?: number;
    jitter?: number;
    cpu?: number;
  };
  pingHeight?: {
    rttBoxplot?: number;
    rttMetrics?: number;
    packetLoss?: number;
    jitter?: number;
  };
  ristStreamHeight?: {
    bitrate?: number;
    fps?: number;
    droppedFrames?: number;
  };
  defaultTab?:
    | "tcp_iperf"
    | "udp_iperf"
    | "qperf"
    | "nix-cache"
    | "ping"
    | "rist-stream";
  tabLabels?: {
    tcp?: string;
    udp?: string;
    qperf?: string;
    nixCache?: string;
    ping?: string;
    ristStream?: string;
  };
  className?: string;
}

// Helper component for consistent "No Data" message
const FallbackMessage = () => (
  <div
    style={{
      background: "#f9f9f9",
      border: "1px solid #e0e0e0",
      "border-radius": "8px",
      padding: "20px",
      "text-align": "center",
      color: "#555",
      "font-size": "16px",
      margin: "1rem 0",
    }}
  >
    <p style={{ margin: 0 }}>
      No benchmark data file found or processed for this category.
    </p>
  </div>
);

export const VpnDashboard = (props: VpnDashboardProps) => {
  // Get URL search params for state sync
  const [searchParams, setSearchParams] = useSearchParams();

  // Valid tab values
  const validTabs = [
    "tcp_iperf",
    "udp_iperf",
    "qperf",
    "nix-cache",
    "ping",
    "rist-stream",
  ] as const;

  type ValidTab = (typeof validTabs)[number];

  // Initialize from URL or prop or default
  const initialTab =
    searchParams.tab && validTabs.includes(searchParams.tab as ValidTab)
      ? searchParams.tab
      : props.defaultTab || "tcp_iperf";

  const [selectedTab, setSelectedTab] = createSignal(initialTab);

  // Handler that updates both local state AND URL
  const handleTabChange = (newTab: string) => {
    setSelectedTab(newTab);
    setSearchParams({ tab: newTab }); // Updates URL without reload
  };

  // Sync with URL changes (e.g., browser back/forward)
  createEffect(() => {
    const urlTab = searchParams.tab;
    if (urlTab && validTabs.includes(urlTab as ValidTab)) {
      setSelectedTab(urlTab);
    }
  });

  // Default values remain mostly the same
  const tcpHeight =
    props.tcpHeight ||
    {
      /* ... defaults ... */
    };
  const udpHeight =
    props.udpHeight ||
    {
      /* ... defaults ... */
    };
  const pingHeight =
    props.pingHeight ||
    {
      /* ... defaults ... */
    };
  const ristStreamHeight =
    props.ristStreamHeight ||
    {
      /* ... defaults ... */
    };
  const tabLabels = {
    tcp: props.tabLabels?.tcp || "TCP Performance",
    udp: props.tabLabels?.udp || "UDP Performance",
    qperf: props.tabLabels?.qperf || "HTTP3 Performance",
    nixCache: props.tabLabels?.nixCache || "Nix Cache",
    ping: props.tabLabels?.ping || "Ping Latency",
    ristStream: props.tabLabels?.ristStream || "Video Streaming",
  };

  return (
    <Tabs
      aria-label="Network Performance Tests"
      class={props.className || "tabs"} // Apply custom or default class
      value={selectedTab()}
      onChange={handleTabChange}
    >
      <Tabs.List class="tabs__list">
        {/* Conditionally render triggers if the corresponding report prop might be null
            or always render them and let the content handle the null/error state */}
        {/* Option 1: Always render triggers */}
        <Tabs.Trigger class="tabs__trigger" value="tcp_iperf">
          {tabLabels.tcp}
        </Tabs.Trigger>
        <Tabs.Trigger class="tabs__trigger" value="udp_iperf">
          {tabLabels.udp}
        </Tabs.Trigger>
        <Tabs.Trigger class="tabs__trigger" value="qperf">
          {tabLabels.qperf}
        </Tabs.Trigger>
        <Tabs.Trigger class="tabs__trigger" value="nix-cache">
          {tabLabels.nixCache}
        </Tabs.Trigger>
        <Tabs.Trigger class="tabs__trigger" value="ping">
          {tabLabels.ping}
        </Tabs.Trigger>
        <Tabs.Trigger class="tabs__trigger" value="rist-stream">
          {tabLabels.ristStream}
        </Tabs.Trigger>
        {/* You might conditionally render triggers if a whole category could be missing */}
        {/* e.g., <Show when={props.tcpReports || props.udpReports}><Tabs.Trigger ...></Show> */}
        <Tabs.Indicator class="tabs__indicator" />
      </Tabs.List>

      {/* Direct JSX in Tabs.Content for proper reactivity */}
      <Tabs.Content class="tabs__content" value="tcp_iperf">
        <Show when={props.tcpReports} fallback={<FallbackMessage />}>
          {(reportResult) => (
            <Show
              when={reportResult().ok}
              fallback={
                <DisplayClanError error={(reportResult() as Err).error} />
              }
            >
              <IperfTcpCharts
                reports={(reportResult() as Ok<IperfTcpReport[]>).value}
                height={tcpHeight}
              />
            </Show>
          )}
        </Show>
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="udp_iperf">
        <Show when={props.udpReports} fallback={<FallbackMessage />}>
          {(reportResult) => (
            <Show
              when={reportResult().ok}
              fallback={
                <DisplayClanError error={(reportResult() as Err).error} />
              }
            >
              <IperfUdpCharts
                reports={(reportResult() as Ok<IperfUdpReport[]>).value}
                height={udpHeight}
              />
            </Show>
          )}
        </Show>
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="qperf">
        <Show when={props.qperfReports} fallback={<FallbackMessage />}>
          {(reportResult) => (
            <Show
              when={reportResult().ok}
              fallback={
                <DisplayClanError error={(reportResult() as Err).error} />
              }
            >
              <QperfChartsDashboard
                reports={(reportResult() as Ok<QperfReport[]>).value}
              />
            </Show>
          )}
        </Show>
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="nix-cache">
        <Show when={props.nixCacheReports} fallback={<FallbackMessage />}>
          {(reportResult) => (
            <Show
              when={reportResult().ok}
              fallback={
                <DisplayClanError error={(reportResult() as Err).error} />
              }
            >
              <HyperfineCharts
                reports={(reportResult() as Ok<HyperfineReport[]>).value}
              />
            </Show>
          )}
        </Show>
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="ping">
        <Show when={props.pingReports} fallback={<FallbackMessage />}>
          {(reportResult) => (
            <Show
              when={reportResult().ok}
              fallback={
                <DisplayClanError error={(reportResult() as Err).error} />
              }
            >
              <PingCharts
                reports={(reportResult() as Ok<PingReport[]>).value}
                height={pingHeight}
              />
            </Show>
          )}
        </Show>
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="rist-stream">
        <Show when={props.ristStreamReports} fallback={<FallbackMessage />}>
          {(reportResult) => (
            <Show
              when={reportResult().ok}
              fallback={
                <DisplayClanError error={(reportResult() as Err).error} />
              }
            >
              <RistChartsDashboard
                reports={(reportResult() as Ok<RistReport[]>).value}
                height={ristStreamHeight}
              />
            </Show>
          )}
        </Show>
      </Tabs.Content>
    </Tabs>
  );
};
