import {
  IperfTcpCharts,
  IperfTcpReport,
} from "@/src/components/IperfTcpCharts";
import {
  IperfUdpCharts,
  IperfUdpReport,
} from "@/src/components/IperfUdpCharts";
import { Tabs } from "@kobalte/core/tabs";
import { createSignal } from "solid-js";
import "./style.css";

// Define props for the dashboard component
interface IperfDashboardProps {
  tcpReports: IperfTcpReport[];
  udpReports: IperfUdpReport[];
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
  };
  className?: string;
}

export const IperfDashboard = (props: IperfDashboardProps) => {
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

  const tabLabels = props.tabLabels || {
    tcp: "TCP Performance",
    udp: "UDP Performance",
  };

  const defaultTab = props.defaultTab || "tcp_iperf";

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
        <Tabs.Indicator class="tabs__indicator" />
      </Tabs.List>

      <Tabs.Content class="tabs__content" value="tcp_iperf">
        <IperfTcpCharts reports={props.tcpReports} height={tcpHeight} />
      </Tabs.Content>

      <Tabs.Content class="tabs__content" value="udp_iperf">
        <IperfUdpCharts reports={props.udpReports} height={udpHeight} />
      </Tabs.Content>
    </Tabs>
  );
};
