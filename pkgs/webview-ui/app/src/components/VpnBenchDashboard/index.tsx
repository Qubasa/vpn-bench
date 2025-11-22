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
  QperfData,
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
import {
  Result,
  Err,
  Ok,
  MixedReport,
  getErrorMessage,
  TestMetadata,
} from "@/src/benchData"; // Assuming Result and BenchmarkRunError are here
// Using the name from your import - ensure this component accepts BenchmarkRunError
import { DisplayClanError } from "@/src/components/ClanError"; // *** USE THE CORRECT COMPONENT NAME AND PATH ***
import { useSearchParams } from "@solidjs/router";
import { getVpnInfo, getDefaultVpnInfo, VpnInfoData } from "@/src/vpnInfo";

// Define props for the dashboard component
interface VpnDashboardProps {
  // VPN name for displaying info
  vpnName: string;
  // Ensure the generic type T in Result<T> matches what the Chart expects
  tcpReports: Result<IperfTcpReport[]> | null;
  udpReports: Result<IperfUdpReport[]> | null;
  nixCacheReports: Result<HyperfineReport[]> | null;
  // Qperf uses mixed reports to show both successful and crashed machines
  qperfReports: MixedReport<QperfData>[] | null;
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
    | "info"
    | "tcp_iperf"
    | "udp_iperf"
    | "qperf"
    | "nix-cache"
    | "ping"
    | "rist-stream";
  tabLabels?: {
    info?: string;
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

// Helper to format duration
const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
};

// Metadata display component
interface MetadataDisplayProps {
  meta?: TestMetadata;
  machineName?: string;
}

const MetadataDisplay = (props: MetadataDisplayProps) => {
  return (
    <Show when={props.meta}>
      {(meta) => (
        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "12px",
            padding: "12px 16px",
            background: "#f8f9fa",
            "border-radius": "8px",
            "margin-bottom": "16px",
            "font-size": "13px",
            "align-items": "center",
          }}
        >
          <Show when={props.machineName}>
            <span
              style={{
                "font-weight": "600",
                color: "#333",
                "margin-right": "8px",
              }}
            >
              {props.machineName}
            </span>
          </Show>

          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "4px",
              color: "#555",
            }}
          >
            <span style={{ opacity: "0.7" }}>⏱</span>
            <span>Duration: {formatDuration(meta().duration_seconds)}</span>
          </div>

          <Show when={meta().test_attempts > 1}>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "4px",
                color: meta().test_attempts > 2 ? "#e67700" : "#555",
              }}
            >
              <span style={{ opacity: "0.7" }}>🔄</span>
              <span>Test attempts: {meta().test_attempts}</span>
            </div>
          </Show>

          <Show when={meta().vpn_restart_attempts > 0}>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "4px",
                color:
                  meta().vpn_restart_attempts > meta().test_attempts
                    ? "#e67700"
                    : "#555",
              }}
            >
              <span style={{ opacity: "0.7" }}>🔌</span>
              <span>VPN restarts: {meta().vpn_restart_attempts}</span>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
};

// Metadata display for MixedReport arrays (shows per-machine metadata)
interface MixedReportMetadataDisplayProps {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  mixedReports: MixedReport<any>[];
}

const MixedReportMetadataDisplay = (props: MixedReportMetadataDisplayProps) => {
  // Get all successful results with metadata
  const reportsWithMeta = () =>
    props.mixedReports.filter((r) => r.result.ok && (r.result as Ok<any>).meta);

  return (
    <Show when={reportsWithMeta().length > 0}>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
          "margin-bottom": "16px",
        }}
      >
        <div
          style={{
            "font-size": "14px",
            "font-weight": "600",
            color: "#333",
            "margin-bottom": "4px",
          }}
        >
          Test Execution Metadata
        </div>
        <For each={reportsWithMeta()}>
          {(report) => (
            <MetadataDisplay
              meta={(report.result as Ok<any>).meta}
              machineName={report.name}
            />
          )}
        </For>
      </div>
    </Show>
  );
};

// VPN Info Display Component
const VpnInfoDisplay = (props: { vpnInfo: VpnInfoData }) => (
  <div
    style={{
      background: "#ffffff",
      "border-radius": "12px",
      padding: "24px",
      margin: "1rem 0",
    }}
  >
    <h2
      style={{
        margin: "0 0 16px 0",
        "font-size": "28px",
        "font-weight": "700",
        color: "#1a1a1a",
      }}
    >
      {props.vpnInfo.name}
    </h2>

    <p
      style={{
        color: "#4a4a4a",
        "line-height": "1.6",
        "font-size": "16px",
        margin: "0 0 24px 0",
      }}
    >
      {props.vpnInfo.description}
    </p>

    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "16px",
        "margin-bottom": "24px",
      }}
    >
      <Show when={props.vpnInfo.website}>
        <div
          style={{
            background: "#f5f5f5",
            padding: "12px 16px",
            "border-radius": "8px",
          }}
        >
          <div
            style={{
              "font-size": "12px",
              "font-weight": "600",
              color: "#666",
              "text-transform": "uppercase",
              "margin-bottom": "4px",
            }}
          >
            Website
          </div>
          <a
            href={props.vpnInfo.website}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#0066cc",
              "text-decoration": "none",
              "font-size": "14px",
            }}
          >
            {props.vpnInfo.website}
          </a>
        </div>
      </Show>

      <div
        style={{
          background: "#f5f5f5",
          padding: "12px 16px",
          "border-radius": "8px",
        }}
      >
        <div
          style={{
            "font-size": "12px",
            "font-weight": "600",
            color: "#666",
            "text-transform": "uppercase",
            "margin-bottom": "4px",
          }}
        >
          Protocol
        </div>
        <div style={{ "font-size": "14px", color: "#333" }}>
          {props.vpnInfo.protocol}
        </div>
      </div>

      <div
        style={{
          background: "#f5f5f5",
          padding: "12px 16px",
          "border-radius": "8px",
        }}
      >
        <div
          style={{
            "font-size": "12px",
            "font-weight": "600",
            color: "#666",
            "text-transform": "uppercase",
            "margin-bottom": "4px",
          }}
        >
          Encryption
        </div>
        <div style={{ "font-size": "14px", color: "#333" }}>
          {props.vpnInfo.encryption}
        </div>
      </div>
    </div>

    <Show when={props.vpnInfo.features.length > 0}>
      <div style={{ "margin-bottom": "24px" }}>
        <h3
          style={{
            "font-size": "18px",
            "font-weight": "600",
            color: "#1a1a1a",
            margin: "0 0 12px 0",
          }}
        >
          Key Features
        </h3>
        <ul
          style={{
            margin: "0",
            padding: "0 0 0 20px",
            color: "#4a4a4a",
            "line-height": "1.8",
          }}
        >
          <For each={props.vpnInfo.features}>
            {(feature) => <li style={{ "margin-bottom": "4px" }}>{feature}</li>}
          </For>
        </ul>
      </div>
    </Show>

    <Show when={props.vpnInfo.useCases.length > 0}>
      <div>
        <h3
          style={{
            "font-size": "18px",
            "font-weight": "600",
            color: "#1a1a1a",
            margin: "0 0 12px 0",
          }}
        >
          Common Use Cases
        </h3>
        <ul
          style={{
            margin: "0",
            padding: "0 0 0 20px",
            color: "#4a4a4a",
            "line-height": "1.8",
          }}
        >
          <For each={props.vpnInfo.useCases}>
            {(useCase) => <li style={{ "margin-bottom": "4px" }}>{useCase}</li>}
          </For>
        </ul>
      </div>
    </Show>
  </div>
);

export const VpnDashboard = (props: VpnDashboardProps) => {
  // Get URL search params for state sync
  const [searchParams, setSearchParams] = useSearchParams();

  // Valid tab values
  const validTabs = [
    "info",
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
      : props.defaultTab || "info";

  // Get VPN info
  const vpnInfo = () =>
    getVpnInfo(props.vpnName) || getDefaultVpnInfo(props.vpnName);

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
    info: props.tabLabels?.info || "Overview",
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
        <Tabs.Trigger class="tabs__trigger" value="info">
          {tabLabels.info}
        </Tabs.Trigger>
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
      <Tabs.Content class="tabs__content" value="info">
        <VpnInfoDisplay vpnInfo={vpnInfo()} />
      </Tabs.Content>

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
          {(mixedReports) => (
            <>
              <MixedReportMetadataDisplay mixedReports={mixedReports()} />
              <QperfChartsDashboard mixedReports={mixedReports()} />
            </>
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
