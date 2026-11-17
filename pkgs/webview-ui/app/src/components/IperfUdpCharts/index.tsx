import { createMemo, Show } from "solid-js";
import type {
  DefaultLabelFormatterCallbackParams,
  TooltipComponentFormatterCallbackParams,
} from "echarts";
import { Echart } from "../Echarts";
import { createErrorBarSeries } from "../Echarts/errorBars";
import { formatAxisValue } from "../Echarts/formatters";
import type { VpbIperfData } from "../IperfTcpCharts";

// Define interfaces for UDP reports based on provided JSON
export interface IperfUdpReportData {
  start?: {
    connected?: {
      socket: number;
      local_host: string;
      local_port: number;
      remote_host: string;
      remote_port: number;
    }[];
    version?: string;
    system_info?: string;
    timestamp?: {
      time: string;
      timesecs: number;
    };
    connecting_to?: {
      host: string;
      port: number;
    };
    cookie?: string;
    target_bitrate?: number;
    fq_rate?: number;
    sock_bufsize?: number;
    sndbuf_actual?: number;
    rcvbuf_actual?: number;
    test_start?: {
      protocol: "UDP";
      num_streams: number;
      blksize: number;
      omit: number;
      duration: number;
      bytes: number;
      blocks: number;
      reverse: number; // 0 or 1
      tos: number;
      target_bitrate: number;
      bidir: number; // 0 or 1
      fqrate: number;
      interval: number;
    };
  };
  end: {
    streams?: {
      // UDP streams often summarized directly in sum_* below
      udp: {
        socket: number;
        start: number;
        end: number;
        seconds: number;
        bytes: number;
        bits_per_second: number;
        jitter_ms: number;
        lost_packets: number;
        packets: number;
        lost_percent: number;
        out_of_order?: number; // Optional, depends on iperf version
        sender: boolean;
      };
    }[];
    // Note: sum_sent/received are client's perspective of primary flow
    // sum_sent_bidir_reverse / sum_received_bidir_reverse are client's perspective of reverse flow
    sum_sent: {
      // Client sending primary direction
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      packets: number;
      sender: boolean; // true
    };
    sum_received: {
      // What server received from client (primary flow) - reported back
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      jitter_ms: number;
      lost_packets: number;
      packets: number;
      lost_percent: number;
      sender: boolean; // false
    };
    sum_sent_bidir_reverse?: {
      // Client sending reverse direction (in --bidir)
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      packets: number;
      sender: boolean; // Usually true in this context relative to reverse flow? Check iperf docs. Let's assume primary sender=true.
    };
    sum_received_bidir_reverse?: {
      // What client received from server (reverse flow)
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      jitter_ms: number;
      lost_packets: number;
      packets: number;
      lost_percent: number;
      sender: boolean; // Usually false in this context.
    };
    // Sum potentially combines flows? Use specific sums above for clarity.
    sum?: {
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      jitter_ms: number;
      lost_packets: number;
      packets: number;
      lost_percent: number;
      sender: boolean;
    };
    sum_bidir_reverse?: {
      // Overall summary for reverse flow
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      jitter_ms: number;
      lost_packets: number;
      packets: number;
      lost_percent: number;
      sender: boolean;
    };
    // iperf3's own client (host) and server (remote) processes, % of one core
    cpu_utilization_percent?: {
      host_total: number;
      host_user: number;
      host_system: number;
      remote_total: number;
      remote_user: number;
      remote_system: number;
    };
  };
  intervals?: {
    streams?: {
      // Per-stream interval data
      socket: number;
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      packets: number;
      jitter_ms?: number; // Often in receiving stream interval
      lost_packets?: number; // Often in receiving stream interval
      lost_percent?: number; // Often in receiving stream interval
      omitted: boolean;
      sender: boolean;
    }[];
    sum: {
      // Summary for primary direction this interval
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number;
      packets: number;
      omitted: boolean;
      sender: boolean; // true
    };
    sum_bidir_reverse?: {
      // Summary for reverse direction this interval
      start: number;
      end: number;
      seconds: number;
      bytes: number;
      bits_per_second: number; // Present in example JSON
      jitter_ms: number;
      lost_packets: number;
      packets: number;
      lost_percent: number;
      omitted: boolean;
      sender: boolean; // false
    };
  }[];
  vpb?: VpbIperfData;
}

export interface IperfUdpReport {
  name: string;
  data: IperfUdpReportData;
}

interface IperfUdpChartsProps {
  reports: IperfUdpReport[];
  height?: {
    // Optional height overrides for specific charts
    throughput?: number;
    timeSeries?: number;
    packetLoss?: number;
    jitter?: number;
    cpu?: number;
  };
}

type UdpReceiverSummary = IperfUdpReportData["end"]["sum_received"];
type UdpInterval = NonNullable<IperfUdpReportData["intervals"]>[number];
type UdpIntervalReceiver = NonNullable<UdpInterval["sum_bidir_reverse"]>;

// Receiver side of the measured flow, the reverse flow only in --bidir runs
const udpReceiverSummary = (
  data: IperfUdpReportData,
): UdpReceiverSummary | undefined =>
  data.start?.test_start?.bidir === 1
    ? data.end?.sum_received_bidir_reverse
    : data.end?.sum_received;

// iperf3 reports per-interval receiver data only for the reverse flow of --bidir runs
const udpIntervalReceiver = (
  data: IperfUdpReportData,
  interval: UdpInterval,
): UdpIntervalReceiver | undefined =>
  data.start?.test_start?.bidir === 1 ? interval.sum_bidir_reverse : undefined;

const toMbps = (bitsPerSecond: number | undefined): number | null =>
  bitsPerSecond == null ? null : bitsPerSecond / 1_000_000;

const formatBytes = (bytes: number) => {
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1_000_000;
  return `${mb.toFixed(2)} MB`;
};

const udpTotals = (reports: IperfUdpReport[]) => {
  let bytesSent = 0;
  let bytesReceived = 0;
  let duration = 0;
  let payloadSize: number | undefined;

  for (const report of reports) {
    const sent = report.data.end?.sum_sent;
    bytesSent += sent?.bytes ?? 0;
    bytesReceived += udpReceiverSummary(report.data)?.bytes ?? 0;
    duration = Math.max(duration, sent?.seconds ?? 0);
    payloadSize ??= report.data.start?.test_start?.blksize;
  }

  return { bytesSent, bytesReceived, duration, payloadSize };
};

const SummaryItem = (props: {
  label: string;
  color: string;
  value: string;
}) => (
  <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
    <span style={{ "font-weight": "500", color: props.color }}>
      {props.label}
    </span>
    <span style={{ color: "#333" }}>{props.value}</span>
  </div>
);

// Test Summary Banner - shows total data transferred and duration
const IperfUdpTestSummary = (props: { reports: IperfUdpReport[] }) => {
  const totals = createMemo(() => udpTotals(props.reports));

  return (
    <Show when={totals().duration > 0 || totals().bytesSent > 0}>
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
        <Show when={totals().duration > 0}>
          <SummaryItem
            label="Duration:"
            color="#1890ff"
            value={`${totals().duration.toFixed(1)}s`}
          />
        </Show>
        <Show when={totals().bytesSent > 0}>
          <SummaryItem
            label="Data Sent:"
            color="#722ed1"
            value={formatBytes(totals().bytesSent)}
          />
        </Show>
        <Show when={totals().bytesReceived > 0}>
          <SummaryItem
            label="Data Received:"
            color="#13c2c2"
            value={formatBytes(totals().bytesReceived)}
          />
        </Show>
        <Show when={totals().payloadSize}>
          {(size) => (
            <SummaryItem
              label="Payload Size:"
              color="#fa8c16"
              value={`${size()} bytes`}
            />
          )}
        </Show>
      </div>
    </Show>
  );
};

interface MbpsRange {
  min: number;
  max: number;
}

interface UdpThroughputStats {
  name: string;
  avgSentMbps: number | null;
  sentRange: MbpsRange | null;
  avgRecvMbps: number | null;
  recvRange: MbpsRange | null;
}

const rangeOf = (values: (number | null)[]): MbpsRange | null => {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return null;
  return { min: Math.min(...present), max: Math.max(...present) };
};

const getUdpThroughputStats = (report: IperfUdpReport): UdpThroughputStats => {
  const data = report.data;
  const intervals = data.intervals ?? [];
  return {
    name: report.name ?? "Unknown Report",
    avgSentMbps: toMbps(data.end?.sum_sent?.bits_per_second),
    sentRange: rangeOf(
      intervals.map((interval) => toMbps(interval.sum?.bits_per_second)),
    ),
    avgRecvMbps: toMbps(udpReceiverSummary(data)?.bits_per_second),
    recvRange: rangeOf(
      intervals.map((interval) =>
        toMbps(udpIntervalReceiver(data, interval)?.bits_per_second),
      ),
    ),
  };
};

const SENT_SERIES = "Average Sent";
const RECV_SERIES = "Average Received";
const SENT_COLOR = "#3498db";
const RECV_COLOR = "#2ecc71";

const formatMbps = (value: number | null) =>
  value == null ? "n/a" : `${value.toFixed(1)} Mbps`;

const rangeNote = (avg: number | null, range: MbpsRange | null) =>
  range && (range.min !== avg || range.max !== avg)
    ? `&nbsp;&nbsp;&nbsp;<small>Min: ${range.min.toFixed(1)} Mbps | Max: ${range.max.toFixed(1)} Mbps</small><br/>`
    : "";

const throughputTooltip = (
  stats: UdpThroughputStats[],
  params: TooltipComponentFormatterCallbackParams,
) => {
  const list = Array.isArray(params) ? params : [params];
  const first = list[0];
  const item = first ? stats[first.dataIndex] : undefined;
  if (!item) return "";
  const marker = (seriesName: string) => {
    const found = list.find((p) => p.seriesName === seriesName)?.marker;
    return typeof found === "string" ? found : "";
  };
  return [
    `<b>${item.name}</b><br/>`,
    `${marker(SENT_SERIES)} Avg Sent: ${formatMbps(item.avgSentMbps)}<br/>`,
    rangeNote(item.avgSentMbps, item.sentRange),
    `${marker(RECV_SERIES)} Avg Recv: ${formatMbps(item.avgRecvMbps)}<br/>`,
    rangeNote(item.avgRecvMbps, item.recvRange),
  ]
    .join("")
    .replace(/<br\/>$/, "");
};

const throughputErrorBars = (
  stats: UdpThroughputStats[],
  avg: (item: UdpThroughputStats) => number | null,
  range: (item: UdpThroughputStats) => MbpsRange | null,
  barIndex: number,
) => ({
  ...createErrorBarSeries(
    stats.map((item) => {
      const value = avg(item);
      return range(item) ?? (value == null ? null : { min: value, max: value });
    }),
    {
      barIndex,
      totalBars: 2,
      labels: {
        values: stats.map((item) => {
          const value = avg(item);
          return value == null ? null : formatMbps(value);
        }),
      },
    },
  ),
  yAxisIndex: barIndex,
});

const throughputAxis = (name: string, color: string, showSplit: boolean) => ({
  type: "value" as const,
  name,
  min: 0,
  boundaryGap: [0, "10%"] as [number, string],
  axisLine: { show: true, lineStyle: { color } },
  axisLabel: { formatter: formatAxisValue },
  splitLine: { show: showSplit },
});

// Sender and receiver rates differ by orders of magnitude, so each gets its own axis
const createUdpThroughputOption = (
  reports: IperfUdpReport[],
): echarts.EChartsOption | null => {
  const stats = reports.map(getUdpThroughputStats);
  const hasData = stats.some(
    (item) => item.avgSentMbps != null || item.avgRecvMbps != null,
  );
  if (!hasData) return null;

  return {
    title: {
      text: "Average Throughput",
      subtext: "Higher is better | Sent and received use separate axes",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: TooltipComponentFormatterCallbackParams) =>
        throughputTooltip(stats, params),
      confine: true,
    },
    legend: { data: [SENT_SERIES, RECV_SERIES], bottom: 10 },
    grid: {
      left: "3%",
      right: "6%",
      bottom: "40px",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: { title: "Save Image" },
        dataView: { show: true, readOnly: false, title: "View Data" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    xAxis: {
      type: "category",
      data: stats.map((item) => item.name),
      axisLabel: { interval: 0, rotate: reports.length > 5 ? 30 : 0 },
    },
    yAxis: [
      throughputAxis("Sent (Mbps)", SENT_COLOR, true),
      throughputAxis("Received (Mbps)", RECV_COLOR, false),
    ],
    series: [
      {
        name: SENT_SERIES,
        type: "bar",
        yAxisIndex: 0,
        data: stats.map((item) => item.avgSentMbps),
        color: SENT_COLOR,
        emphasis: { focus: "series" },
      },
      {
        name: RECV_SERIES,
        type: "bar",
        yAxisIndex: 1,
        data: stats.map((item) => item.avgRecvMbps),
        color: RECV_COLOR,
        emphasis: { focus: "series" },
      },
      throughputErrorBars(
        stats,
        (item) => item.avgSentMbps,
        (item) => item.sentRange,
        0,
      ),
      throughputErrorBars(
        stats,
        (item) => item.avgRecvMbps,
        (item) => item.recvRange,
        1,
      ),
    ],
  };
};

interface ReceiverMetricSpec {
  key: "lost_percent" | "jitter_ms";
  title: string;
  seriesName: string;
  axisName: string;
  unit: string;
  digits: number;
  color: string;
  axisMax?: number;
}

// Bar chart of one receiver-side summary metric, missing values stay absent
const createReceiverMetricOption = (
  reports: IperfUdpReport[],
  spec: ReceiverMetricSpec,
): echarts.EChartsOption | null => {
  const points = reports
    .map((report) => ({
      name: report.name ?? "Unknown Report",
      value: udpReceiverSummary(report.data)?.[spec.key] ?? null,
    }))
    .sort(
      (a, b) => (a.value ?? Number.MAX_VALUE) - (b.value ?? Number.MAX_VALUE),
    );
  if (points.every((point) => point.value == null)) return null;

  const format = (value: unknown) =>
    typeof value === "number"
      ? `${value.toFixed(spec.digits)}${spec.unit}`
      : "n/a";

  return {
    title: {
      text: spec.title,
      subtext: "Lower is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const param = Array.isArray(params) ? params[0] : params;
        return param ? `${param.name}: ${format(param.value)}` : "";
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
        saveAsImage: { title: "Save Image" },
        dataView: { show: true, readOnly: false, title: "View Data" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    xAxis: {
      type: "category",
      data: points.map((point) => point.name),
      axisLabel: { interval: 0, rotate: reports.length > 5 ? 30 : 0 },
    },
    yAxis: {
      type: "value",
      name: spec.axisName,
      min: 0,
      max: spec.axisMax,
      axisLabel: { formatter: formatAxisValue },
      nameTextStyle: { align: "left" },
    },
    series: [
      {
        name: spec.seriesName,
        type: "bar",
        data: points.map((point) => point.value),
        color: spec.color,
        label: {
          show: true,
          position: "top",
          formatter: (param: DefaultLabelFormatterCallbackParams) =>
            format(param.value),
          fontSize: 10,
        },
        emphasis: { focus: "series" },
      },
    ],
  };
};

const createPacketLossOption = (reports: IperfUdpReport[]) =>
  createReceiverMetricOption(reports, {
    key: "lost_percent",
    title: "Overall Packet Loss (Receiver)",
    seriesName: "Packet Loss",
    axisName: "Packet Loss (%)",
    unit: "%",
    digits: 2,
    color: "#e74c3c",
    axisMax: 100,
  });

const createJitterOption = (reports: IperfUdpReport[]) =>
  createReceiverMetricOption(reports, {
    key: "jitter_ms",
    title: "Average Jitter (Receiver)",
    seriesName: "Jitter",
    axisName: "Jitter (ms)",
    unit: " ms",
    digits: 3,
    color: "#9b59b6",
  });

// CPU Utilization Chart Creator for UDP
const createUdpCpuOption = (
  reports: IperfUdpReport[],
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const hasCpuData = reports.some((r) => r.data?.end?.cpu_utilization_percent);
  if (!hasCpuData) {
    console.warn("CPU utilization data missing in all UDP reports.");
    return null; // Return null if no CPU data is available
  }

  // Sort by total CPU usage (ascending - lower is better)
  const sortedReports = [...reports].sort((a, b) => {
    const aCpu =
      (a.data?.end?.cpu_utilization_percent?.host_total ?? 0) +
      (a.data?.end?.cpu_utilization_percent?.remote_total ?? 0);
    const bCpu =
      (b.data?.end?.cpu_utilization_percent?.host_total ?? 0) +
      (b.data?.end?.cpu_utilization_percent?.remote_total ?? 0);
    return aCpu - bCpu;
  });

  const vpnPercent = (
    report: IperfUdpReport,
    side: "client" | "server",
  ): string | null =>
    report.data?.vpb?.cpu?.[side].vpn_process_percent?.toFixed(1) ?? null;
  const hasVpnCpu = sortedReports.some(
    (report) =>
      vpnPercent(report, "client") !== null ||
      vpnPercent(report, "server") !== null,
  );
  const barLabel = {
    show: true,
    position: "top" as const,
    formatter: "{c} %",
    fontSize: 10,
  };
  const vpnSeries: echarts.SeriesOption[] = hasVpnCpu
    ? [
        {
          name: "VPN Client",
          type: "bar",
          data: sortedReports.map((report) => vpnPercent(report, "client")),
          color: "#2c3e50",
          label: barLabel,
          emphasis: { focus: "series" },
        },
        {
          name: "VPN Server",
          type: "bar",
          data: sortedReports.map((report) => vpnPercent(report, "server")),
          color: "#7f8c8d",
          label: barLabel,
          emphasis: { focus: "series" },
        },
      ]
    : [];
  const series: echarts.SeriesOption[] = [
    ...vpnSeries,
    {
      name: "iperf3 Client",
      type: "bar",
      data: sortedReports.map((report) =>
        (report.data?.end?.cpu_utilization_percent?.host_total ?? 0).toFixed(1),
      ),
      color: "#f39c12",
      label: barLabel,
      emphasis: { focus: "series" },
    },
    {
      name: "iperf3 Server",
      type: "bar",
      data: sortedReports.map((report) =>
        (report.data?.end?.cpu_utilization_percent?.remote_total ?? 0).toFixed(
          1,
        ),
      ),
      color: "#16a085",
      label: barLabel,
      emphasis: { focus: "series" },
    },
  ];

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
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: series.map((s) => String(s.name)),
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "40px", // Adjust grid bottom
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: { title: "Save Image" },
        dataView: { show: true, readOnly: false, title: "View Data" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    xAxis: {
      type: "category",
      data: sortedReports.map((report) => report.name ?? "Unknown Report"),
      axisLabel: {
        interval: 0,
        rotate: reports.length > 5 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
      name: "% of one core",
      max: (value) => Math.max(100, Math.ceil(value.max / 20) * 20), // Adjust max dynamically but ensure at least 100
      min: 0,
      axisLabel: { formatter: formatAxisValue },
      nameTextStyle: { align: "left" },
    },
    series,
  };
};

interface UdpIntervalSeries {
  name: string;
  throughput: Map<string, number | null>;
  loss: Map<string, number | null>;
  jitter: Map<string, number | null>;
}

const collectIntervalSeries = (report: IperfUdpReport): UdpIntervalSeries => {
  const series: UdpIntervalSeries = {
    name: report.name ?? "Unknown Report",
    throughput: new Map(),
    loss: new Map(),
    jitter: new Map(),
  };
  for (const interval of report.data?.intervals ?? []) {
    const time = interval.sum?.end?.toFixed(2);
    if (time == null) continue;
    const receiver = udpIntervalReceiver(report.data, interval);
    series.throughput.set(time, toMbps(interval.sum?.bits_per_second));
    series.loss.set(time, receiver?.lost_percent ?? null);
    series.jitter.set(time, receiver?.jitter_ms ?? null);
  }
  return series;
};

const TIME_SERIES_COLORS = [
  "#3498db",
  "#e74c3c",
  "#9b59b6",
  "#2ecc71",
  "#f39c12",
  "#1abc9c",
  "#d35400",
  "#34495e",
];

const lineSeries = (
  name: string,
  data: (number | null)[],
  color: string,
  yAxisIndex: number,
  dashed = false,
): echarts.LineSeriesOption[] =>
  data.some((value) => value !== null)
    ? [
        {
          name,
          type: "line",
          data,
          color,
          symbol: "none",
          yAxisIndex,
          lineStyle: dashed ? { type: "dashed" } : undefined,
          emphasis: { focus: "series" },
        },
      ]
    : [];

const buildTimeSeries = (
  collected: UdpIntervalSeries[],
  times: string[],
): echarts.LineSeriesOption[] =>
  collected.flatMap((series, index) => {
    const color = (offset: number) =>
      TIME_SERIES_COLORS[(index * 3 + offset) % TIME_SERIES_COLORS.length];
    const align = (values: Map<string, number | null>) =>
      times.map((time) => values.get(time) ?? null);
    return [
      ...lineSeries(
        `${series.name} Throughput`,
        align(series.throughput),
        color(0),
        0,
      ),
      ...lineSeries(`${series.name} Pkt Loss`, align(series.loss), color(1), 1),
      ...lineSeries(
        `${series.name} Jitter`,
        align(series.jitter),
        color(2),
        1,
        true,
      ),
    ];
  });

const timeSeriesAxes = (hasReceiver: boolean) => {
  const throughputAxis = {
    type: "value" as const,
    name: "Throughput (Mbps)",
    position: "left" as const,
    axisLine: { show: true, lineStyle: { color: TIME_SERIES_COLORS[0] } },
    axisLabel: { formatter: formatAxisValue },
    nameTextStyle: { align: "left" as const },
    min: 0,
  };
  const receiverAxis = {
    type: "value" as const,
    name: "Loss (%) / Jitter (ms)",
    position: "right" as const,
    axisLine: { show: true, lineStyle: { color: TIME_SERIES_COLORS[1] } },
    axisLabel: { formatter: formatAxisValue },
    nameTextStyle: { align: "right" as const },
    min: 0,
    splitLine: { show: false },
  };
  return hasReceiver ? [throughputAxis, receiverAxis] : [throughputAxis];
};

// Loss and jitter get their own axis only when the runs carry per-interval receiver data
const createUdpTimeSeriesOption = (
  reports: IperfUdpReport[],
): echarts.EChartsOption | null => {
  const collected = reports.map(collectIntervalSeries);
  const times = Array.from(
    new Set(collected.flatMap((series) => [...series.throughput.keys()])),
  ).sort((a, b) => parseFloat(a) - parseFloat(b));
  const series = buildTimeSeries(collected, times);
  if (series.length === 0) return null;
  const hasReceiver = series.some((item) => item.yAxisIndex === 1);

  return {
    title: {
      text: "Performance Over Time",
      subtext: hasReceiver
        ? "Higher throughput / Lower loss & jitter is better"
        : "Sender throughput | Higher is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? value.toFixed(2) : "n/a",
      confine: true,
    },
    legend: {
      data: series.map((item) => String(item.name)),
      type: "scroll",
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "60px",
      top: "15%",
      containLabel: true,
    },
    toolbox: {
      feature: { saveAsImage: { title: "Save Image" } },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    xAxis: {
      type: "category",
      name: "Time (s)",
      nameLocation: "middle",
      nameGap: 25,
      boundaryGap: false,
      data: times,
      axisLabel: { formatter: "{value}s" },
    },
    yAxis: timeSeriesAxes(hasReceiver),
    series,
    dataZoom: [
      { type: "inside", filterMode: "filter" },
      {
        show: true,
        type: "slider",
        filterMode: "filter",
        bottom: 35,
        height: 15,
      },
    ],
  };
};

// --- Individual chart components for UDP ---

const UnavailableBox = (props: { height: number; message: string }) => (
  <div
    style={{
      height: props.height + "px",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      border: "1px dashed #ccc",
      margin: "10px 0",
      color: "#888",
    }}
  >
    {props.message}
  </div>
);

const UdpChart = (props: {
  option: echarts.EChartsOption | null;
  height: number;
  fallback: string;
}) => (
  <Show
    when={props.option}
    fallback={<UnavailableBox height={props.height} message={props.fallback} />}
  >
    {(option) => <Echart option={option()} height={props.height} />}
  </Show>
);

interface UdpChartProps {
  reports: IperfUdpReport[];
  height?: number;
}

export const IperfUdpThroughputChart = (props: UdpChartProps) => (
  <UdpChart
    option={createUdpThroughputOption(props.reports)}
    height={props.height ?? 500}
    fallback="Throughput data unavailable."
  />
);
export const IperfUdpPacketLossChart = (props: UdpChartProps) => (
  <UdpChart
    option={createPacketLossOption(props.reports)}
    height={props.height ?? 500}
    fallback="Packet loss data unavailable."
  />
);
export const IperfUdpJitterChart = (props: UdpChartProps) => (
  <UdpChart
    option={createJitterOption(props.reports)}
    height={props.height ?? 500}
    fallback="Jitter data unavailable."
  />
);
export const IperfUdpTimeSeriesChart = (props: UdpChartProps) => (
  <UdpChart
    option={createUdpTimeSeriesOption(props.reports)}
    height={props.height ?? 700}
    fallback="Time series data unavailable or incomplete."
  />
);
export const IperfUdpCpuChart = (props: UdpChartProps) => (
  <UdpChart
    option={createUdpCpuOption(props.reports)}
    height={props.height ?? 500}
    fallback="CPU data unavailable in reports."
  />
);

// --- Combined dashboard component for UDP ---

const NoUdpData = () => (
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
      No UDP performance data available. Run the benchmark to generate iperf UDP
      data.
    </p>
  </div>
);

export const IperfUdpCharts = (props: IperfUdpChartsProps) => {
  const height = () => ({
    throughput: props.height?.throughput ?? 450,
    timeSeries: props.height?.timeSeries ?? 600,
    packetLoss: props.height?.packetLoss ?? 400,
    jitter: props.height?.jitter ?? 400,
    cpu: props.height?.cpu ?? 400,
  });
  const hasIntervalData = () =>
    props.reports.some((r) => (r.data?.intervals?.length ?? 0) > 0);
  const hasCpuData = () =>
    props.reports.some((r) => r.data?.end?.cpu_utilization_percent);

  return (
    <Show when={props.reports.length > 0} fallback={<NoUdpData />}>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "25px",
          padding: "10px",
        }}
      >
        <IperfUdpTestSummary reports={props.reports} />
        <IperfUdpThroughputChart
          reports={props.reports}
          height={height().throughput}
        />
        <Show
          when={hasIntervalData()}
          fallback={
            <UnavailableBox
              height={height().timeSeries}
              message="Time series chart requires interval data, which is missing or empty in all reports."
            />
          }
        >
          <IperfUdpTimeSeriesChart
            reports={props.reports}
            height={height().timeSeries}
          />
        </Show>
        <div class="flex flex-col gap-5 lg:flex-row lg:justify-center">
          <div class="flex-1 lg:max-w-[500px]">
            <IperfUdpPacketLossChart
              reports={props.reports}
              height={height().packetLoss}
            />
          </div>
          <div class="flex-1 lg:max-w-[500px]">
            <IperfUdpJitterChart
              reports={props.reports}
              height={height().jitter}
            />
          </div>
        </div>
        <Show
          when={hasCpuData()}
          fallback={
            <div
              style={{
                "text-align": "center",
                color: "#888",
                margin: "10px 0",
              }}
            >
              CPU utilization data not available in these reports.
            </div>
          }
        >
          <div style={{ display: "flex", "justify-content": "center" }}>
            <div style={{ width: "100%", "max-width": "600px" }}>
              <IperfUdpCpuChart reports={props.reports} height={height().cpu} />
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};
