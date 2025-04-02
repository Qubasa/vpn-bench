import {
  IperfTcpCharts,
  IperfTcpReport,
} from "@/src/components/IperfTcpCharts";
import {
  IperfUdpCharts,
  IperfUdpReport,
} from "@/src/components/IperfUdpCharts";
import { Tabs } from "@kobalte/core/tabs";
import {
  QperfReport,
  QperfChartsDashboard,
} from "@/src/components/QperfCharts";
import "./style.css";
import { HyperfineCharts, HyperfineReport } from "../HyperfineCharts";
import { For, JSX } from "solid-js";

// Define props for the dashboard component
interface IperfDashboardProps {
  tcpReports: IperfTcpReport[] | null;
  udpReports: IperfUdpReport[] | null;
  nixCacheReports: HyperfineReport[] | null;
  qperfReports: QperfReport[] | null;
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
  defaultTab?: "tcp_iperf" | "udp_iperf";
  tabLabels?: {
    tcp?: string;
    udp?: string;
    qperf?: string;
  };
  className?: string;
}
export const VpnDashboard = (props: IperfDashboardProps) => {
  // Default values
  const tcpHeight = props.tcpHeight || {
    throughput: 500,
    timeSeries: 700,
    cpu: 500,
    retransmits: 500,
  };

  const udpHeight = props.udpHeight || {
    throughput: 500,
    timeSeries: 700,
    packetLoss: 500,
    jitter: 500,
    cpu: 500,
  };

  const tabLabels = {
    tcp: props.tabLabels?.tcp || "TCP Performance",
    udp: props.tabLabels?.udp || "UDP Performance",
    qperf: props.tabLabels?.qperf || "HTTP3 Performance",
  };

  interface TabConfig {
    value: string;
    label: string;
    // content is a JSX.Element
    content: JSX.Element;
  }

  const defaultTab = props.defaultTab || "tcp_iperf";
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
        No data available. Please run the benchmark to see the performance
        results.
      </p>
    </div>
  );

  const tabs: TabConfig[] = [
    {
      value: "tcp_iperf",
      label: tabLabels.tcp,
      content: props.tcpReports ? (
        <IperfTcpCharts reports={props.tcpReports} height={tcpHeight} />
      ) : (
        <FallbackMessage />
      ),
    },
    {
      value: "udp_iperf",
      label: tabLabels.udp,
      content: props.udpReports ? (
        <IperfUdpCharts reports={props.udpReports} height={udpHeight} />
      ) : (
        <FallbackMessage />
      ),
    },
    {
      value: "qperf",
      label: tabLabels.qperf,
      content: props.qperfReports ? (
        <QperfChartsDashboard reports={props.qperfReports} />
      ) : (
        <FallbackMessage />
      ),
    },
    {
      value: "nix-cache",
      label: "Nix Cache Performance",
      content: props.nixCacheReports ? (
        <HyperfineCharts reports={props.nixCacheReports} />
      ) : (
        <FallbackMessage />
      ),
    },
  ];

  return (
    <Tabs
      aria-label="Network Performance Tests"
      class={props.className || "tabs"}
      defaultValue={defaultTab}
    >
      <Tabs.List class="tabs__list">
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
          Nix Cache
        </Tabs.Trigger>
        <Tabs.Indicator class="tabs__indicator" />
      </Tabs.List>

      <Tabs.Content class="tabs__content" value="tcp_iperf">
        {props.tcpReports ? (
          <IperfTcpCharts reports={props.tcpReports} height={tcpHeight} />
        ) : (
          <FallbackMessage />
        )}
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="udp_iperf">
        {props.udpReports ? (
          <IperfUdpCharts reports={props.udpReports} height={udpHeight} />
        ) : (
          <FallbackMessage />
        )}
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="qperf">
        {props.qperfReports ? (
          <QperfChartsDashboard reports={props.qperfReports} />
        ) : (
          <FallbackMessage />
        )}
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="nix-cache">
        {props.nixCacheReports ? (
          <HyperfineCharts reports={props.nixCacheReports} />
        ) : (
          <FallbackMessage />
        )}
      </Tabs.Content>
    </Tabs>
  );
};
