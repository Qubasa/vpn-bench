import { Echart } from "../Echarts"; // Assuming Echart component handles rendering
/* eslint-disable  @typescript-eslint/no-explicit-any */

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
    cpu_utilization_percent?: {
      // Make optional as it might be missing
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

// --- Helper Function for UDP Throughput Stats ---
const getUdpThroughputStats = (reportData: IperfUdpReportData) => {
  // Averages from the 'end' summary (Client's perspective)
  // Avg Sent: What the client sent (primary direction)
  const avgSentMbps =
    (reportData.end?.sum_sent?.bits_per_second ?? 0) / 1000000;
  // Avg Received: What the client received (reverse direction in --bidir)
  const avgRecvMbps =
    (reportData.end?.sum_received_bidir_reverse?.bits_per_second ?? 0) /
    1000000;

  let minSentMbps = avgSentMbps;
  let maxSentMbps = avgSentMbps;
  let minRecvMbps = avgRecvMbps;
  let maxRecvMbps = avgRecvMbps;

  // Calculate Min/Max from intervals if available
  if (reportData.intervals && reportData.intervals.length > 0) {
    // Sent: Use intervals[].sum.bits_per_second
    const validSentIntervals = reportData.intervals.filter(
      (i) => i.sum?.bits_per_second != null,
    );
    if (validSentIntervals.length > 0) {
      const sentRates = validSentIntervals.map(
        (interval) => interval.sum.bits_per_second / 1000000,
      );
      minSentMbps = Math.min(...sentRates);
      maxSentMbps = Math.max(...sentRates);
    }

    // Received: Use intervals[].sum_bidir_reverse.bits_per_second
    const validRecvIntervals = reportData.intervals.filter(
      (i) => i.sum_bidir_reverse?.bits_per_second != null,
    );
    if (validRecvIntervals.length > 0) {
      const recvRates = validRecvIntervals.map((interval) => {
        if (interval.sum_bidir_reverse) {
          return interval.sum_bidir_reverse.bits_per_second / 1000000; // Use non-null assertion as we checked
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

// --- Chart Creation Functions (Modified & Completed) ---

// Throughput Chart Creator for UDP
const createUdpThroughputOption = (
  reports: IperfUdpReport[],
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const throughputStats = reports.map((report) => ({
    name: report.name ?? "Unknown Report",
    stats: getUdpThroughputStats(report.data),
  }));

  // Check if there's any meaningful data to plot
  const hasData = throughputStats.some(
    (item) => item.stats.avgSentMbps > 0 || item.stats.avgRecvMbps > 0,
  );
  if (!hasData) return null;

  interface EchartTooltipParam {
    marker: string;
    name: string;
    dataIndex: number;
    seriesName: string;
    value: number;
  }

  type EchartTooltipFormatterParams = EchartTooltipParam | EchartTooltipParam[];

  return {
    title: {
      text: "Average Throughput",
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any): string => {
        const tooltipParams = Array.isArray(params) ? params : [params];
        if (!tooltipParams || tooltipParams.length === 0) return "";
        const reportIndex = tooltipParams[0].dataIndex;
        const reportStat = throughputStats[reportIndex];
        if (!reportStat) return "";

        let tooltipText = `<b>${reportStat.name}</b><br/>`;
        const sentParam = tooltipParams.find(
          (p: any) => p.seriesName === "Average Sent",
        );
        const recvParam = tooltipParams.find(
          (p: any) => p.seriesName === "Average Received",
        );
        if (sentParam) {
          tooltipText += `${sentParam.marker ?? ""} Avg Sent: ${reportStat.stats.avgSentMbps.toFixed(
            1,
          )} Mbps<br/>`;
          if (
            reportStat.stats.minSentMbps !== reportStat.stats.avgSentMbps ||
            reportStat.stats.maxSentMbps !== reportStat.stats.avgSentMbps
          ) {
            tooltipText += `&nbsp;&nbsp;&nbsp;<small>Min: ${reportStat.stats.minSentMbps.toFixed(
              1,
            )} Mbps | Max: ${reportStat.stats.maxSentMbps.toFixed(1)} Mbps</small><br/>`;
          }
        }
        if (recvParam) {
          tooltipText += `${recvParam.marker ?? ""} Avg Recv: ${reportStat.stats.avgRecvMbps.toFixed(
            1,
          )} Mbps<br/>`;
          if (
            reportStat.stats.minRecvMbps !== reportStat.stats.avgRecvMbps ||
            reportStat.stats.maxRecvMbps !== reportStat.stats.avgRecvMbps
          ) {
            tooltipText += `&nbsp;&nbsp;&nbsp;<small>Min: ${reportStat.stats.minRecvMbps.toFixed(
              1,
            )} Mbps | Max: ${reportStat.stats.maxRecvMbps.toFixed(1)} Mbps</small>`;
          }
        }
        if (tooltipText.endsWith("<br/>")) {
          tooltipText = tooltipText.substring(0, tooltipText.length - 5);
        }
        return tooltipText;
      },
      confine: true,
    },
    legend: {
      data: ["Average Sent", "Average Received"],
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "40px",
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
      data: throughputStats.map((item) => item.name),
      axisLabel: {
        interval: 0,
        rotate: reports.length > 5 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Mbps",
      axisLabel: { formatter: "{value}" },
      nameTextStyle: {
        align: "left",
      },
    },
    series: [
      {
        name: "Average Sent",
        type: "bar",
        data: throughputStats.map((item) =>
          (item?.stats?.avgSentMbps ?? 0).toFixed(1),
        ),
        color: "#3498db",
        label: {
          show: true,
          position: "top",
          formatter: "{c} Mbps",
          fontSize: 10,
        },
        emphasis: { focus: "series" },
      },
      {
        name: "Average Received",
        type: "bar",
        data: throughputStats.map((item) =>
          (item?.stats?.avgRecvMbps ?? 0).toFixed(1),
        ),
        color: "#2ecc71",
        label: {
          show: true,
          position: "top",
          formatter: "{c} Mbps",
          fontSize: 10,
        },
        emphasis: { focus: "series" },
      },
    ],
  };
};

// Packet Loss Chart Creator
const createPacketLossOption = (
  reports: IperfUdpReport[],
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  // Plot loss for the reverse direction (client receiving) as it's often paired with jitter
  const lossData = reports.map((report) => ({
    name: report.name ?? "Unknown Report",
    // Use sum_received_bidir_reverse for client-received loss in bidir test
    value: (
      report.data?.end?.sum_received_bidir_reverse?.lost_percent ?? 0
    ).toFixed(1),
  }));

  const hasData = lossData.some((item) => parseFloat(item.value) > 0);
  // Don't return null even if loss is 0, showing 0% loss is informative

  return {
    title: {
      text: "Overall Packet Loss (Reverse Direction)", // Clarified Title
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: function (params) {
        const tooltipParams = Array.isArray(params) ? params : [params];
        if (!tooltipParams || tooltipParams.length === 0) return "";
        const value = tooltipParams[0].value;
        const name = tooltipParams[0].name;
        return `${name}: ${value}%`;
      },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
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
      data: lossData.map((item) => item.name),
      axisLabel: {
        interval: 0,
        rotate: reports.length > 5 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Packet Loss (%)",
      max: 100,
      min: 0,
      nameTextStyle: { align: "left" },
    },
    series: [
      {
        name: "Packet Loss",
        type: "bar",
        data: lossData.map((item) => item.value),
        color: "#e74c3c",
        label: {
          show: true,
          position: "top",
          formatter: "{c}%",
          fontSize: 10,
        },
        emphasis: { focus: "series" },
      },
    ],
  };
};

// Jitter Chart Creator
const createJitterOption = (
  reports: IperfUdpReport[],
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  // Plot jitter for the reverse direction (client receiving)
  const jitterData = reports.map((report) => ({
    name: report.name ?? "Unknown Report",
    // Use sum_received_bidir_reverse for client-received jitter in bidir test
    value: (
      report.data?.end?.sum_received_bidir_reverse?.jitter_ms ?? 0
    ).toFixed(3),
  }));

  const hasData = jitterData.some((item) => parseFloat(item.value) > 0);
  // Don't return null if jitter is 0, showing 0ms is informative

  return {
    title: {
      text: "Average Jitter (Reverse Direction)", // Clarified Title
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any): string => {
        const tooltipParams = Array.isArray(params) ? params : [params];
        if (!tooltipParams || tooltipParams.length === 0) return "";
        const value = tooltipParams[0].value;
        const name = tooltipParams[0].name;
        return `${name}: ${value} ms`;
      },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
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
      data: jitterData.map((item) => item.name),
      axisLabel: {
        interval: 0,
        rotate: reports.length > 5 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Jitter (ms)",
      axisLabel: { formatter: "{value} ms" },
      nameTextStyle: { align: "left" },
    },
    series: [
      {
        name: "Jitter",
        type: "bar",
        data: jitterData.map((item) => item.value),
        color: "#9b59b6",
        label: {
          show: true,
          position: "top",
          formatter: "{c} ms",
          fontSize: 10,
        },
        emphasis: { focus: "series" },
      },
    ],
  };
};

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

  const cpuData = reports.map((report) => ({
    name: report.name ?? "Unknown Report",
    host: (report.data?.end?.cpu_utilization_percent?.host_total ?? 0).toFixed(
      1,
    ),
    remote: (
      report.data?.end?.cpu_utilization_percent?.remote_total ?? 0
    ).toFixed(1),
  }));

  return {
    title: {
      text: "Average CPU Utilization", // Clarified Title
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: ["Host CPU", "Remote CPU"],
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "40px", // Adjust grid bottom
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
      data: cpuData.map((item) => item.name),
      axisLabel: {
        interval: 0,
        rotate: reports.length > 5 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Percentage (%)",
      max: (value) => Math.max(100, Math.ceil(value.max / 20) * 20), // Adjust max dynamically but ensure at least 100
      min: 0,
      nameTextStyle: { align: "left" },
    },
    series: [
      {
        name: "Host CPU",
        type: "bar",
        data: cpuData.map((item) => item.host),
        color: "#f39c12", // Changed color
        label: {
          show: true,
          position: "top",
          formatter: "{c} %",
          fontSize: 10,
        },
        emphasis: { focus: "series" },
      },
      {
        name: "Remote CPU",
        type: "bar",
        data: cpuData.map((item) => item.remote),
        color: "#16a085", // Changed color
        label: {
          show: true,
          position: "top",
          formatter: "{c} %",
          fontSize: 10,
        },
        emphasis: { focus: "series" },
      },
    ],
  };
};

// Time Series Chart Creator for UDP
const createUdpTimeSeriesOption = (
  reports: IperfUdpReport[],
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const allTimeStampsSet = new Set<string>();
  const seriesCollection: {
    reportName: string;
    throughput: { time: string; value: number | null }[];
    packetLoss: { time: string; value: number | null }[];
    jitter: { time: string; value: number | null }[];
  }[] = [];

  reports.forEach((report) => {
    if (!report.data?.intervals || report.data.intervals.length === 0) {
      console.warn(`Report ${report.name ?? "Unknown"} has no interval data.`);
      return; // Skip this report if no intervals
    }

    const currentReportSeries = {
      reportName: report.name ?? "Unknown Report",
      throughput: [] as { time: string; value: number | null }[],
      packetLoss: [] as { time: string; value: number | null }[],
      jitter: [] as { time: string; value: number | null }[],
    };

    report.data.intervals.forEach((interval) => {
      const timestamp = interval.sum?.end?.toFixed(2); // Use 2 decimal places for time
      if (timestamp == null) return;

      allTimeStampsSet.add(timestamp);

      // Primary Throughput (Client Sending)
      const throughputVal =
        interval.sum?.bits_per_second != null
          ? interval.sum.bits_per_second / 1000000
          : null;
      currentReportSeries.throughput.push({
        time: timestamp,
        value: throughputVal,
      });

      // Reverse Direction Packet Loss (Client Receiving)
      const lossVal =
        interval.sum_bidir_reverse?.lost_percent != null
          ? interval.sum_bidir_reverse.lost_percent
          : null;
      currentReportSeries.packetLoss.push({ time: timestamp, value: lossVal });

      // Reverse Direction Jitter (Client Receiving)
      const jitterVal =
        interval.sum_bidir_reverse?.jitter_ms != null
          ? interval.sum_bidir_reverse.jitter_ms
          : null;
      currentReportSeries.jitter.push({ time: timestamp, value: jitterVal });
    });
    seriesCollection.push(currentReportSeries);
  });

  if (seriesCollection.length === 0 || allTimeStampsSet.size === 0) {
    console.warn(
      "No valid interval data found across all UDP reports for time series.",
    );
    return null; // Return null if no data to plot
  }

  const allTimeStamps = Array.from(allTimeStampsSet).sort(
    (a, b) => parseFloat(a) - parseFloat(b),
  );

  const finalSeries: any[] = [];
  const colorPalette = [
    "#3498db",
    "#e74c3c",
    "#9b59b6",
    "#2ecc71",
    "#f39c12",
    "#1abc9c",
    "#d35400",
    "#34495e",
  ];
  let colorIndex = 0;

  seriesCollection.forEach((reportSeries) => {
    const throughputMap = new Map(
      reportSeries.throughput.map((item) => [item.time, item.value]),
    );
    const lossMap = new Map(
      reportSeries.packetLoss.map((item) => [item.time, item.value]),
    );
    const jitterMap = new Map(
      reportSeries.jitter.map((item) => [item.time, item.value]),
    );

    const alignedThroughput = allTimeStamps.map(
      (ts) => throughputMap.get(ts) ?? null,
    );
    const alignedLoss = allTimeStamps.map((ts) => lossMap.get(ts) ?? null);
    const alignedJitter = allTimeStamps.map((ts) => jitterMap.get(ts) ?? null);

    // Only add series if they contain at least one non-null data point
    if (alignedThroughput.some((d) => d !== null)) {
      finalSeries.push({
        name: `${reportSeries.reportName} Throughput`,
        type: "line",
        data: alignedThroughput,
        color: colorPalette[colorIndex % colorPalette.length],
        symbol: "none", // Hide data point markers for cleaner lines
        yAxisIndex: 0, // Use the first Y axis (Throughput)
        emphasis: { focus: "series" },
      });
    }
    if (alignedLoss.some((d) => d !== null)) {
      finalSeries.push({
        name: `${reportSeries.reportName} Pkt Loss`, // Shorter legend name
        type: "line",
        data: alignedLoss,
        color: colorPalette[(colorIndex + 1) % colorPalette.length],
        symbol: "none",
        yAxisIndex: 1, // Use the second Y axis (Loss/Jitter)
        emphasis: { focus: "series" },
      });
    }
    if (alignedJitter.some((d) => d !== null)) {
      finalSeries.push({
        name: `${reportSeries.reportName} Jitter`,
        type: "line",
        data: alignedJitter,
        color: colorPalette[(colorIndex + 2) % colorPalette.length],
        symbol: "none",
        yAxisIndex: 1, // Use the second Y axis (Loss/Jitter)
        lineStyle: { type: "dashed" }, // Differentiate jitter line
        emphasis: { focus: "series" },
      });
    }
    colorIndex += 3; // Increment color index for next report
  });

  if (finalSeries.length === 0) {
    console.warn(
      "No valid series data to plot for time series after alignment.",
    );
    return null;
  }

  return {
    title: {
      text: "Performance Over Time",
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number"
          ? value.toFixed(2)
          : value != null
            ? String(value)
            : "N/A", // Ensure a string is returned
      confine: true,
    },
    legend: {
      data: finalSeries.map((s) => s.name),
      type: "scroll", // Allow scrolling if many legends
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "60px", // Adjust for potentially larger legend
      containLabel: true,
    },
    toolbox: {
      feature: {
        saveAsImage: { title: "Save Image" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    xAxis: {
      type: "category",
      name: "Time (s)",
      nameLocation: "middle",
      nameGap: 25,
      boundaryGap: false, // Line charts often look better without boundary gap
      data: allTimeStamps,
      axisLabel: { formatter: "{value}s" },
    },
    yAxis: [
      {
        type: "value",
        name: "Throughput (Mbps)",
        position: "left",
        axisLine: { show: true, lineStyle: { color: colorPalette[0] } }, // Match first throughput color
        axisLabel: { formatter: "{value}" },
        nameTextStyle: { align: "left" },
        min: 0, // Ensure throughput starts at 0
      },
      {
        type: "value",
        name: "Loss (%) / Jitter (ms)",
        position: "right",
        axisLine: { show: true, lineStyle: { color: colorPalette[1] } }, // Match first loss color
        axisLabel: { formatter: "{value}" },
        nameTextStyle: { align: "right" },
        min: 0, // Ensure loss/jitter starts at 0
        splitLine: { show: false }, // Avoid splitting lines from both axes overlapping
      },
    ],
    series: finalSeries,
    dataZoom: [
      // Add data zoom functionality
      {
        type: "inside", // Allow zooming inside the chart area
        filterMode: "filter", // Or 'weakFilter'
      },
      {
        show: true, // Show the slider zoom control
        type: "slider",
        filterMode: "filter",
        bottom: 35, // Position below legend
        height: 15,
      },
    ],
  };
};

// --- Individual chart components for UDP ---

export const IperfUdpThroughputChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  const options = createUdpThroughputOption(reports);
  return options ? (
    <Echart option={options} height={height} />
  ) : (
    <div
      style={{
        height: height + "px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        border: "1px dashed #ccc",
        margin: "10px 0",
      }}
    >
      Throughput data unavailable.
    </div>
  );
};
export const IperfUdpPacketLossChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  const options = createPacketLossOption(reports);
  return options ? (
    <Echart option={options} height={height} />
  ) : (
    <div
      style={{
        height: height + "px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        border: "1px dashed #ccc",
        margin: "10px 0",
      }}
    >
      Packet loss data unavailable.
    </div>
  );
};
export const IperfUdpJitterChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  const options = createJitterOption(reports);
  return options ? (
    <Echart option={options} height={height} />
  ) : (
    <div
      style={{
        height: height + "px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        border: "1px dashed #ccc",
        margin: "10px 0",
      }}
    >
      Jitter data unavailable.
    </div>
  );
};
export const IperfUdpTimeSeriesChart = ({
  reports,
  height = 700,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  const options = createUdpTimeSeriesOption(reports);
  return options ? (
    <Echart option={options} height={height} />
  ) : (
    <div
      style={{
        height: height + "px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        border: "1px dashed #ccc",
        margin: "10px 0",
      }}
    >
      Time series data unavailable or incomplete.
    </div>
  );
};
export const IperfUdpCpuChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  const options = createUdpCpuOption(reports);
  return options ? (
    <Echart option={options} height={height} />
  ) : (
    <div
      style={{
        height: height + "px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        border: "1px dashed #ccc",
        margin: "10px 0",
      }}
    >
      CPU data unavailable in reports.
    </div>
  );
};

// --- Combined dashboard component for UDP ---

export const IperfUdpCharts = ({
  reports,
  height = {
    // Default heights (can be overridden by props)
    throughput: 450, // Adjusted defaults slightly
    timeSeries: 600,
    packetLoss: 400,
    jitter: 400,
    cpu: 400,
  },
}: IperfUdpChartsProps) => {
  // Basic check for reports array
  if (!reports || reports.length === 0) {
    return (
      <div style={{ padding: "20px", color: "red" }}>
        No UDP reports provided.
      </div>
    );
  }

  // Check if essential 'end' data exists in at least one report
  // Specifically check fields used by the core charts (throughput, loss, jitter)
  const hasEssentialEndData = reports.some(
    (r) =>
      r.data?.end?.sum_sent?.bits_per_second != null &&
      r.data?.end?.sum_received_bidir_reverse?.lost_percent != null && // Using reverse flow loss for the chart
      r.data?.end?.sum_received_bidir_reverse?.jitter_ms != null, // Using reverse flow jitter for the chart
  );
  if (!hasEssentialEndData && reports.length > 0) {
    // Check only if reports exist
    // Provide a more informative message if possible
    console.warn(
      "UDP reports might be missing essential summary data (e.g., sum_sent, sum_received_bidir_reverse loss/jitter). Charts might be empty or incomplete.",
    );
    // Don't return here yet, let individual charts handle missing data
  }

  // Check specifically for interval data needed by TimeSeries
  const hasIntervalData = reports.some(
    (r) => r.data?.intervals && r.data.intervals.length > 0,
  );
  // Check for CPU data
  const hasCpuData = reports.some((r) => r.data?.end?.cpu_utilization_percent);

  // Prepare effective heights using defaults and props override
  const effectiveHeights = {
    throughput: height.throughput ?? 450,
    timeSeries: height.timeSeries ?? 600,
    packetLoss: height.packetLoss ?? 400,
    jitter: height.jitter ?? 400,
    cpu: height.cpu ?? 400,
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "25px",
        padding: "10px",
      }}
    >
      {/* Throughput */}
      <IperfUdpThroughputChart
        reports={reports}
        height={effectiveHeights.throughput}
      />

      {/* Time Series - Conditionally render */}
      {hasIntervalData ? (
        <IperfUdpTimeSeriesChart
          reports={reports}
          height={effectiveHeights.timeSeries}
        />
      ) : (
        <div
          style={{
            height: effectiveHeights.timeSeries + "px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            border: "1px dashed #ccc",
            margin: "10px 0",
            color: "#888",
          }}
        >
          Time series chart requires interval data, which is missing or empty in
          all reports.
        </div>
      )}

      {/* Packet Loss & Jitter Row */}
      <div
        style={{
          display: "flex",
          gap: "20px",
          "flex-wrap": "wrap",
          "justify-content": "center",
        }}
      >
        <div style={{ flex: 1, "min-width": "350px", "max-width": "500px" }}>
          {" "}
          {/* Adjusted flex basis */}
          <IperfUdpPacketLossChart
            reports={reports}
            height={effectiveHeights.packetLoss}
          />
        </div>
        <div style={{ flex: 1, "min-width": "350px", "max-width": "500px" }}>
          {" "}
          {/* Adjusted flex basis */}
          <IperfUdpJitterChart
            reports={reports}
            height={effectiveHeights.jitter}
          />
        </div>
      </div>

      {/* CPU - Conditionally render */}
      {hasCpuData ? (
        // Center the CPU chart if it's the only one in the last row conceptually
        <div style={{ display: "flex", "justify-content": "center" }}>
          <div style={{ width: "100%", "max-width": "600px" }}>
            {" "}
            {/* Control max width */}
            <IperfUdpCpuChart reports={reports} height={effectiveHeights.cpu} />
          </div>
        </div>
      ) : (
        <div
          style={{ "text-align": "center", color: "#888", margin: "10px 0" }}
        >
          CPU utilization data not available in these reports.
        </div>
      )}
    </div>
  );
};
