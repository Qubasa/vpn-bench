import { Echart } from "../Echarts";
import { createErrorBarSeries } from "../Echarts/errorBars";
import { formatAxisValue } from "../Echarts/formatters";

// Define interfaces for typing
export interface IperfTcpReportData {
  start: {
    // Added start for completeness, though not used in calc yet
    test_start: {
      bidir: number; // To check if the test was bidirectional
    };
    connecting_to?: {
      host: string;
      port: number;
    };
  };
  end: {
    sum_sent: {
      bits_per_second: number;
      retransmits: number;
      bytes?: number;
      seconds?: number;
    };
    sum_received: {
      bits_per_second: number;
      bytes?: number;
      seconds?: number;
    };
    // Bidirectional reverse direction summaries (only present in --bidir tests)
    sum_sent_bidir_reverse?: {
      bits_per_second: number;
      retransmits: number;
      bytes?: number;
      seconds?: number;
    };
    sum_received_bidir_reverse?: {
      bits_per_second: number;
      bytes?: number;
      seconds?: number;
    };
    // iperf3's own client (host) and server (remote) processes, % of one core
    cpu_utilization_percent: {
      host_total: number;
      remote_total: number;
    };
    streams?: {
      sender: {
        max_snd_cwnd: number;
        max_snd_wnd: number;
        max_rtt: number;
        min_rtt: number;
        mean_rtt: number;
        sender: boolean;
      };
    }[];
  };
  intervals?: {
    sum: {
      start: number;
      end: number;
      bits_per_second: number;
      sender: boolean; // Confirming sum relates to sender=true
    };
    // Add sum_bidir_reverse for bidirectional tests
    sum_bidir_reverse?: {
      start: number;
      end: number;
      bits_per_second: number;
      sender: boolean; // Confirming sum_bidir_reverse relates to sender=false
    };
  }[];
  vpb?: VpbIperfData;
}

// CPU that vpb sampled around the run (absent in older results)
export interface VpbCpuUsage {
  window_seconds: number;
  host_percent: number; // busy share of all cores
  vpn_process_percent: number | null; // VPN daemon, % of one core
}

export interface VpbIperfData {
  cpu?: { client: VpbCpuUsage; server: VpbCpuUsage };
  client_data_mss?: number;
}

// Combined report interface with name and data
export interface IperfTcpReport {
  name: string;
  data: IperfTcpReportData;
}

interface IperfTcpChartsProps {
  reports: IperfTcpReport[];
  height?: {
    throughput?: number;
    timeSeries?: number;
    cpu?: number;
    retransmits?: number;
    rtt?: number;
    maxSendWindow?: number;
  };
}

// Test Summary Banner - shows total data transferred and duration
const IperfTestSummary = (props: { reports: IperfTcpReport[] }) => {
  // Calculate totals from all reports
  const totals = () => {
    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    let maxDuration = 0;

    for (const report of props.reports) {
      const sent = report.data.end.sum_sent;
      const received = report.data.end.sum_received;

      if (sent.bytes) totalBytesSent += sent.bytes;
      if (received.bytes) totalBytesReceived += received.bytes;
      if (sent.seconds && sent.seconds > maxDuration) {
        maxDuration = sent.seconds;
      }
    }

    return {
      bytesSent: totalBytesSent,
      bytesReceived: totalBytesReceived,
      duration: maxDuration,
    };
  };

  const formatBytes = (bytes: number) => {
    const gb = bytes / 1_000_000_000;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / 1_000_000;
    return `${mb.toFixed(2)} MB`;
  };

  const t = totals();

  if (t.duration === 0 && t.bytesSent === 0) return null;

  return (
    <div
      style={{
        background: "#f0f5ff",
        border: "1px solid #adc6ff",
        "border-radius": "6px",
        padding: "12px 16px",
        "margin-bottom": "16px",
        display: "flex",
        "flex-wrap": "wrap",
        gap: "24px",
      }}
    >
      {t.duration > 0 && (
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span style={{ "font-weight": "500", color: "#1890ff" }}>
            Duration:
          </span>
          <span style={{ color: "#333" }}>{t.duration.toFixed(1)}s</span>
        </div>
      )}
      {t.bytesSent > 0 && (
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span style={{ "font-weight": "500", color: "#722ed1" }}>
            Data Sent:
          </span>
          <span style={{ color: "#333" }}>{formatBytes(t.bytesSent)}</span>
        </div>
      )}
      {t.bytesReceived > 0 && (
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span style={{ "font-weight": "500", color: "#13c2c2" }}>
            Data Received:
          </span>
          <span style={{ color: "#333" }}>{formatBytes(t.bytesReceived)}</span>
        </div>
      )}
    </div>
  );
};

// RTT Bar Chart Creator - shows mean RTT with min/max error bars
const createRttOption = (reports: IperfTcpReport[]) => {
  const rttData = reports.map((report) => {
    if (report.data.end.streams && report.data.end.streams.length > 0) {
      const stream = report.data.end.streams.find((data) => data.sender.sender);
      if (stream?.sender.mean_rtt != null) {
        return {
          mean: stream.sender.mean_rtt / 1000, // Convert µs to ms
          min: stream.sender.min_rtt / 1000,
          max: stream.sender.max_rtt / 1000,
        };
      }
      const receiverStream = report.data.end.streams.find(
        (data) => !data.sender.sender,
      );
      if (receiverStream?.sender.mean_rtt != null) {
        return {
          mean: receiverStream.sender.mean_rtt / 1000,
          min: receiverStream.sender.min_rtt / 1000,
          max: receiverStream.sender.max_rtt / 1000,
        };
      }
    }
    return { mean: 0, min: 0, max: 0 };
  });

  const formatRttLabel = (ms: number) =>
    ms < 1 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(1)} ms`;

  return {
    title: {
      text: "Round Trip Time (RTT)",
      subtext: "Lower is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (
        params: { name: string; dataIndex: number; marker: string }[],
      ) => {
        if (!params || params.length === 0) return "";
        const idx = params[0].dataIndex;
        const d = rttData[idx];
        return `${params[0].marker}${params[0].name}<br/>
                Mean RTT: ${formatRttLabel(d.mean)}<br/>
                Min RTT: ${formatRttLabel(d.min)}<br/>
                Max RTT: ${formatRttLabel(d.max)}`;
      },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "RTT (ms)",
      axisLabel: { formatter: formatAxisValue },
      max: (value: { max: number }) => {
        const errorMax = Math.max(...rttData.map((d) => d.max), 0);
        return Math.max(value.max, errorMax) * 1.1 || undefined;
      },
    },
    series: [
      {
        name: "Mean RTT",
        type: "bar",
        data: rttData.map((d) => d.mean.toFixed(2)),
        color: "#3498db",
        label: { show: false },
      },
      createErrorBarSeries(
        rttData.map((d) => ({ min: d.min, max: d.max })),
        {
          labels: {
            values: rttData.map((d) => formatRttLabel(d.mean)),
          },
        },
      ),
    ],
  };
};

// Also update the Max Send Window Chart to use boxplot
const createMaxSendWindowOption = (reports: IperfTcpReport[]) => {
  // Create separate series data for both window metrics
  const sndWndData = reports.map((report) => {
    if (report.data.end.streams && report.data.end.streams.length > 0) {
      return report.data.end.streams[0].sender.max_snd_wnd;
    }
    return 0;
  });

  const cwndData = reports.map((report) => {
    if (report.data.end.streams && report.data.end.streams.length > 0) {
      return report.data.end.streams[0].sender.max_snd_cwnd;
    }
    return 0;
  });

  return {
    title: {
      text: "Max TCP Window Size",
      subtext: "Higher is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    legend: {
      data: ["Max Send Window", "Max Congestion Window"],
      top: 50,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "Bytes",
      axisLabel: {
        formatter: function (value: number) {
          // Format large numbers with K/M/G suffixes
          if (value >= 1000000000) {
            return (value / 1000000000).toFixed(1) + " G";
          } else if (value >= 1000000) {
            return (value / 1000000).toFixed(1) + " M";
          } else if (value >= 1000) {
            return (value / 1000).toFixed(1) + " K";
          }
          return value;
        },
      },
    },
    series: [
      {
        name: "Max Send Window",
        type: "bar",
        data: sndWndData,
        color: "#f39c12", // Orange
        label: {
          show: true,
          position: "top",
          formatter: function (params: { name: string; value: number }) {
            const value = params.value;
            if (value >= 1000000000) {
              return (value / 1000000000).toFixed(1) + " G";
            } else if (value >= 1000000) {
              return (value / 1000000).toFixed(1) + " M";
            } else if (value >= 1000) {
              return (value / 1000).toFixed(1) + " K";
            }
            return value;
          },
        },
      },
      {
        name: "Max Congestion Window",
        type: "bar",
        data: cwndData,
        color: "#9b59b6", // Purple
        label: {
          show: true,
          position: "top",
          formatter: function (params: { name: string; value: number }) {
            const value = params.value;
            if (value >= 1000000000) {
              return (value / 1000000000).toFixed(1) + " G";
            } else if (value >= 1000000) {
              return (value / 1000000).toFixed(1) + " M";
            } else if (value >= 1000) {
              return (value / 1000).toFixed(1) + " K";
            }
            return value;
          },
        },
      },
    ],
  };
};

// Individual chart components - using props pattern for SolidJS reactivity
export const IperfRttChart = (props: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return (
    <Echart
      option={createRttOption(props.reports)}
      height={props.height || 500}
    />
  );
};

export const IperfMaxSendWindowChart = (props: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return (
    <Echart
      option={createMaxSendWindowOption(props.reports)}
      height={props.height || 500}
    />
  );
};

// Helper function to calculate Min/Avg/Max throughput from intervals
const getThroughputStats = (reportData: IperfTcpReportData) => {
  const isBidir = reportData.start?.test_start?.bidir === 1;

  const avgSentMbps = reportData.end.sum_sent.bits_per_second / 1000000;

  // In bidir mode, end.sum_received is the forward direction's received confirmation.
  // The actual reverse direction average is in end.sum_received_bidir_reverse.
  const avgRecvMbps =
    isBidir && reportData.end.sum_received_bidir_reverse
      ? reportData.end.sum_received_bidir_reverse.bits_per_second / 1000000
      : reportData.end.sum_received.bits_per_second / 1000000;

  let minSentMbps = avgSentMbps;
  let maxSentMbps = avgSentMbps;
  let minRecvMbps = avgRecvMbps;
  let maxRecvMbps = avgRecvMbps;

  if (reportData.intervals && reportData.intervals.length > 0) {
    const sentRates = reportData.intervals.map(
      (interval) => interval.sum.bits_per_second / 1000000,
    );
    minSentMbps = Math.min(...sentRates);
    maxSentMbps = Math.max(...sentRates);

    // For bidir tests, interval recv rates come from sum_bidir_reverse
    if (isBidir && reportData.intervals.every((i) => i.sum_bidir_reverse)) {
      const recvRates = reportData.intervals.map((interval) => {
        if (interval.sum_bidir_reverse) {
          return interval.sum_bidir_reverse.bits_per_second / 1000000;
        } else {
          throw new Error("sum_bidir_reverse is missing in intervals");
        }
      });
      minRecvMbps = Math.min(...recvRates);
      maxRecvMbps = Math.max(...recvRates);
    }
  }

  return {
    avgSentMbps,
    minSentMbps,
    maxSentMbps,
    avgRecvMbps,
    minRecvMbps,
    maxRecvMbps,
  };
};

// --bidir runs both directions at once: sum_sent is client→server, the
// bidir_reverse summaries are server→client.
const CLIENT_TO_SERVER = "Client → Server";
const SERVER_TO_CLIENT = "Server → Client";

// Throughput Chart Creator
const createThroughputOption = (reports: IperfTcpReport[]) => {
  // Pre-calculate stats for easier access in tooltip
  const throughputStats = reports.map((report) => ({
    name: report.name,
    stats: getThroughputStats(report.data),
  }));

  return {
    title: {
      text: "Average Throughput", // Updated title
      subtext: "Higher is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: (
        params: {
          marker: string;
          name: string;
          dataIndex: number;
          seriesName: string;
          value: number;
        }[],
      ): string => {
        // Use 'any' for simplicity or define specific ECharts param type
        if (!params || params.length === 0) {
          return "";
        }
        const reportIndex = params[0].dataIndex;
        const reportStat = throughputStats[reportIndex];
        if (!reportStat) return "";

        let tooltipText = `${reportStat.name}<br/>`;

        const sentParam = params.find((p) => p.seriesName === CLIENT_TO_SERVER);
        const recvParam = params.find((p) => p.seriesName === SERVER_TO_CLIENT);

        if (sentParam) {
          tooltipText += `${sentParam.marker} ${CLIENT_TO_SERVER} avg: ${reportStat.stats.avgSentMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Min: ${reportStat.stats.minSentMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Max: ${reportStat.stats.maxSentMbps.toFixed(1)} Mbps<br/>`;
        }
        if (recvParam) {
          tooltipText += `${recvParam.marker} ${SERVER_TO_CLIENT} avg: ${reportStat.stats.avgRecvMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Min: ${reportStat.stats.minRecvMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Max: ${reportStat.stats.maxRecvMbps.toFixed(1)} Mbps`;
        }

        return tooltipText;
      },
    },
    legend: {
      data: [CLIENT_TO_SERVER, SERVER_TO_CLIENT],
      top: 50,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "Mbps",
      max: (value: { max: number }) => {
        const errorMax = Math.max(
          ...throughputStats.map((s) =>
            Math.max(s.stats.maxSentMbps, s.stats.maxRecvMbps),
          ),
        );
        return Math.ceil(Math.max(value.max, errorMax) * 1.1);
      },
      axisLabel: {
        formatter: formatAxisValue,
      },
    },
    series: [
      {
        name: CLIENT_TO_SERVER,
        type: "bar",
        data: throughputStats.map((item) => item.stats.avgSentMbps.toFixed(1)), // Plot average
        color: "#3498db",
        label: { show: false },
      },
      {
        name: SERVER_TO_CLIENT,
        type: "bar",
        data: throughputStats.map((item) => item.stats.avgRecvMbps.toFixed(1)), // Plot average
        color: "#2ecc71",
        label: { show: false },
      },
      createErrorBarSeries(
        throughputStats.map((item) => ({
          min: item.stats.minSentMbps,
          max: item.stats.maxSentMbps,
        })),
        {
          barIndex: 0,
          totalBars: 2,
          labels: {
            values: throughputStats.map(
              (item) => `${item.stats.avgSentMbps.toFixed(1)} Mbps`,
            ),
          },
        },
      ),
      createErrorBarSeries(
        throughputStats.map((item) => ({
          min: item.stats.minRecvMbps,
          max: item.stats.maxRecvMbps,
        })),
        {
          barIndex: 1,
          totalBars: 2,
          labels: {
            values: throughputStats.map(
              (item) => `${item.stats.avgRecvMbps.toFixed(1)} Mbps`,
            ),
          },
        },
      ),
    ],
  };
};
// Per-process CPU chart (all series in % of one core)
const createCpuOption = (reports: IperfTcpReport[]) => {
  const percentLabel = { show: true, position: "top", formatter: "{c} %" };
  const vpnPercent = (
    report: IperfTcpReport,
    side: "client" | "server",
  ): string | null =>
    report.data.vpb?.cpu?.[side].vpn_process_percent?.toFixed(1) ?? null;
  const hasVpnCpu = reports.some(
    (report) =>
      vpnPercent(report, "client") !== null ||
      vpnPercent(report, "server") !== null,
  );
  const vpnSeries = hasVpnCpu
    ? [
        {
          name: "VPN Client",
          type: "bar",
          data: reports.map((report) => vpnPercent(report, "client")),
          color: "#2c3e50",
          label: percentLabel,
        },
        {
          name: "VPN Server",
          type: "bar",
          data: reports.map((report) => vpnPercent(report, "server")),
          color: "#7f8c8d",
          label: percentLabel,
        },
      ]
    : [];
  const iperf3Series = [
    {
      name: "iperf3 Client",
      type: "bar",
      data: reports.map((report) =>
        report.data.end.cpu_utilization_percent.host_total.toFixed(1),
      ),
      color: "#9b59b6",
      label: percentLabel,
    },
    {
      name: "iperf3 Server",
      type: "bar",
      data: reports.map((report) =>
        report.data.end.cpu_utilization_percent.remote_total.toFixed(1),
      ),
      color: "#e74c3c",
      label: percentLabel,
    },
  ];
  const series = [...vpnSeries, ...iperf3Series];
  return {
    title: {
      text: "Average Process CPU",
      subtext: hasVpnCpu
        ? "Lower is better"
        : "Lower is better | VPN process not measured (kernel datapath or older result)",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    legend: {
      data: series.map((s) => s.name),
      top: 50,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "% of one core",
      axisLabel: { formatter: formatAxisValue },
    },
    series,
  };
};

// Retransmits Chart Creator
const createRetransmitsOption = (reports: IperfTcpReport[]) => {
  return {
    title: {
      text: "Total TCP Retransmits",
      subtext: "Lower is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "Count",
      axisLabel: { formatter: formatAxisValue },
    },
    series: [
      {
        name: "Retransmits",
        type: "bar",
        data: reports.map((report) => report.data.end.sum_sent.retransmits),
        color: "#f39c12",
        label: {
          show: true,
          position: "top",
          formatter: "{c}",
        },
      },
    ],
  };
};

// Time Series Chart Creator
const createTimeSeriesOption = (reports: IperfTcpReport[]) => {
  // Get all intervals from all reports
  const allTimeStamps: string[] = [];
  const seriesData: {
    name: string;
    type: string;
    data: number[];
    color: string;
  }[] = [];

  // Generate colors dynamically based on number of reports
  const colorPalette = [
    "#3498db",
    "#2ecc71",
    "#e74c3c",
    "#f39c12",
    "#9b59b6",
    "#1abc9c",
    "#d35400",
    "#34495e",
    "#16a085",
    "#c0392b",
  ];

  // Process each report's intervals
  reports.forEach((report, index) => {
    if (!report.data.intervals || report.data.intervals.length === 0) {
      return;
    }

    // Extract time points from this report
    const reportTimeStamps = report.data.intervals.map((interval) =>
      interval.sum.end.toFixed(1),
    );

    // Combine with master list
    reportTimeStamps.forEach((stamp) => {
      if (!allTimeStamps.includes(stamp)) {
        allTimeStamps.push(stamp);
      }
    });

    // Create series data for this report
    const throughputData = report.data.intervals.map((interval) =>
      parseFloat((interval.sum.bits_per_second / 1000000).toFixed(1)),
    );

    seriesData.push({
      name: report.name,
      type: "line",
      data: throughputData,
      color: colorPalette[index % colorPalette.length],
    });
  });

  // Sort timestamps numerically
  allTimeStamps.sort((a, b) => parseFloat(a) - parseFloat(b));

  return {
    title: {
      text: "Throughput Over Time",
      subtext: "Higher is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: reports.map((report) => report.name),
      top: 50,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    xAxis: {
      type: "category",
      name: "Time (seconds)",
      nameLocation: "middle",
      nameGap: 30,
      data: allTimeStamps,
    },
    yAxis: {
      type: "value",
      name: "Throughput (Mbps)",
      axisLabel: { formatter: formatAxisValue },
    },
    series: seriesData,
  };
};

// Individual chart components - using props pattern for SolidJS reactivity
export const IperfThroughputChart = (props: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return (
    <Echart
      option={createThroughputOption(props.reports)}
      height={props.height || 500}
    />
  );
};

export const IperfTimeSeriesChart = (props: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return (
    <Echart
      option={createTimeSeriesOption(props.reports)}
      height={props.height || 700}
    />
  );
};

export const IperfCpuChart = (props: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return (
    <Echart
      option={createCpuOption(props.reports)}
      height={props.height || 500}
    />
  );
};

export const IperfRetransmitsChart = (props: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return (
    <Echart
      option={createRetransmitsOption(props.reports)}
      height={props.height || 500}
    />
  );
};

// Combined dashboard component - using props pattern for SolidJS reactivity
export const IperfTcpCharts = (props: IperfTcpChartsProps) => {
  // Create reactive getters for height values with defaults
  const height = () => ({
    throughput: props.height?.throughput || 500,
    timeSeries: props.height?.timeSeries || 700,
    cpu: props.height?.cpu || 500,
    retransmits: props.height?.retransmits || 500,
    rtt: props.height?.rtt || 500,
    maxSendWindow: props.height?.maxSendWindow || 500,
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <IperfTestSummary reports={props.reports} />
      <IperfThroughputChart
        reports={props.reports}
        height={height().throughput}
      />
      <IperfTimeSeriesChart
        reports={props.reports}
        height={height().timeSeries}
      />

      <div class="flex flex-col gap-5 lg:flex-row">
        <div class="flex-1">
          <IperfCpuChart reports={props.reports} height={height().cpu} />
        </div>
        <div class="flex-1">
          <IperfRetransmitsChart
            reports={props.reports}
            height={height().retransmits}
          />
        </div>
      </div>

      <div class="flex flex-col gap-5 lg:flex-row">
        <div class="flex-1">
          <IperfRttChart reports={props.reports} height={height().rtt} />
        </div>
        <div class="flex-1">
          <IperfMaxSendWindowChart
            reports={props.reports}
            height={height().maxSendWindow}
          />
        </div>
      </div>
    </div>
  );
};
