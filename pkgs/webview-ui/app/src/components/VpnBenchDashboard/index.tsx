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
import { HyperfineCharts, HyperfineResults } from "../HyperfineCharts";
import { For, JSX } from "solid-js";


// Define props for the dashboard component
interface IperfDashboardProps {
  tcpReports: IperfTcpReport[];
  udpReports: IperfUdpReport[];
  nixCacheReports: HyperfineResults;
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
  qperfReports: QperfReport[];
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
    content: JSX.Element;
  }

  const defaultTab = props.defaultTab || "tcp_iperf";

  const tabs: TabConfig[] = [
    {
      value: "tcp_iperf",
      label: tabLabels.tcp,
      content: <IperfTcpCharts reports={props.tcpReports} height={tcpHeight} />,
    },
    {
      value: "udp_iperf",
      label: tabLabels.udp,
      content: <IperfUdpCharts reports={props.udpReports} height={udpHeight} />,
    },
    {
      value: "qperf",
      label: tabLabels.qperf,
      content: <QperfChartsDashboard reports={props.qperfReports} />,
    },
    {
      value: "nix-cache",
      label: "Nix Cache Performance",
      content: <HyperfineCharts data={props.nixCacheReports} />,
    }
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
        <IperfTcpCharts reports={props.tcpReports} height={tcpHeight} />
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="udp_iperf">
        <IperfUdpCharts reports={props.udpReports} height={udpHeight} />
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="qperf">
        <QperfChartsDashboard reports={props.qperfReports} />
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="nix-cache">
        <HyperfineCharts data={props.nixCacheReports} />
      </Tabs.Content>
    </Tabs>
  );
};
