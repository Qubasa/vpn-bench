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
import { For, JSX, Show } from "solid-js";
import { Result, Err, Ok } from "@/src/benchData"; // Assuming Result and BenchmarkRunError are here
// Using the name from your import - ensure this component accepts BenchmarkRunError
import { DisplayClanError } from "@/src/components/ClanError"; // *** USE THE CORRECT COMPONENT NAME AND PATH ***

// Define props for the dashboard component
interface VpnDashboardProps {
  // Ensure the generic type T in Result<T> matches what the Chart expects
  tcpReports: Result<IperfTcpReport[]> | null;
  udpReports: Result<IperfUdpReport[]> | null;
  nixCacheReports: Result<HyperfineReport[]> | null;
  qperfReports: Result<QperfReport[]> | null;
  pingReports: Result<PingReport[]> | null;
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
  defaultTab?: "tcp_iperf" | "udp_iperf" | "qperf" | "nix-cache" | "ping"; // Added missing types
  tabLabels?: {
    tcp?: string;
    udp?: string;
    qperf?: string;
    nixCache?: string; // Added nixCache label
    ping?: string;
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
  const tabLabels = {
    tcp: props.tabLabels?.tcp || "TCP Performance",
    udp: props.tabLabels?.udp || "UDP Performance",
    qperf: props.tabLabels?.qperf || "HTTP3 Performance",
    nixCache: props.tabLabels?.nixCache || "Nix Cache", // Default label for nix-cache
    ping: props.tabLabels?.ping || "Ping Latency",
  };
  const defaultTab = props.defaultTab || "tcp_iperf";

  // --- Content Rendering Logic ---
  // We'll use functions or direct JSX with <Show> for clarity

  const renderTcpContent = () => (
    <Show when={props.tcpReports} fallback={<FallbackMessage />}>
      {(
        reportResult, // reportResult is guaranteed non-null Result here
      ) => (
        <Show
          when={reportResult().ok}
          fallback={<DisplayClanError error={(reportResult() as Err).error} />} // Render error on failure
        >
          {/* Render chart on success, passing the actual data array */}
          <IperfTcpCharts
            reports={(reportResult() as Ok<IperfTcpReport[]>).value}
            height={tcpHeight}
          />
        </Show>
      )}
    </Show>
  );

  const renderUdpContent = () => (
    <Show when={props.udpReports} fallback={<FallbackMessage />}>
      {(reportResult) => (
        <Show
          when={reportResult().ok}
          fallback={<DisplayClanError error={(reportResult() as Err).error} />}
        >
          <IperfUdpCharts
            reports={(reportResult() as Ok<IperfUdpReport[]>).value}
            height={udpHeight}
          />
        </Show>
      )}
    </Show>
  );

  const renderQperfContent = () => (
    <Show when={props.qperfReports} fallback={<FallbackMessage />}>
      {(reportResult) => (
        <Show
          when={reportResult().ok}
          fallback={<DisplayClanError error={(reportResult() as Err).error} />}
        >
          <QperfChartsDashboard
            reports={(reportResult() as Ok<QperfReport[]>).value}
          />
        </Show>
      )}
    </Show>
  );

  const renderNixCacheContent = () => (
    <Show when={props.nixCacheReports} fallback={<FallbackMessage />}>
      {(reportResult) => (
        <Show
          when={reportResult().ok}
          fallback={<DisplayClanError error={(reportResult() as Err).error} />}
        >
          <HyperfineCharts
            reports={(reportResult() as Ok<HyperfineReport[]>).value}
          />
        </Show>
      )}
    </Show>
  );

  const renderPingContent = () => (
    <Show when={props.pingReports} fallback={<FallbackMessage />}>
      {(reportResult) => (
        <Show
          when={reportResult().ok}
          fallback={<DisplayClanError error={(reportResult() as Err).error} />}
        >
          <PingCharts
            reports={(reportResult() as Ok<PingReport[]>).value}
            height={pingHeight}
          />
        </Show>
      )}
    </Show>
  );

  // Removed the `tabs` array as content is now handled directly in <Tabs.Content>

  return (
    <Tabs
      aria-label="Network Performance Tests"
      class={props.className || "tabs"} // Apply custom or default class
      defaultValue={defaultTab}
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
        {/* You might conditionally render triggers if a whole category could be missing */}
        {/* e.g., <Show when={props.tcpReports || props.udpReports}><Tabs.Trigger ...></Show> */}
        <Tabs.Indicator class="tabs__indicator" />
      </Tabs.List>

      {/* Use the render functions or inline logic within Tabs.Content */}
      <Tabs.Content class="tabs__content" value="tcp_iperf">
        {renderTcpContent()}
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="udp_iperf">
        {renderUdpContent()}
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="qperf">
        {renderQperfContent()}
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="nix-cache">
        {renderNixCacheContent()}
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="ping">
        {renderPingContent()}
      </Tabs.Content>
    </Tabs>
  );
};
