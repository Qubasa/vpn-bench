import { Echart } from "../Echarts";

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
    };
    sum_received: {
      bits_per_second: number;
    };
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
// RTT Boxplot Chart Creator - USING ONLY MIN/MEAN/MAX for data
const createRttOption = (reports: IperfTcpReport[]) => {
  const boxplotData = reports.map((report) => {
    if (report.data.end.streams && report.data.end.streams.length > 0) {
      const stream = report.data.end.streams.find((data) => data.sender.sender);

      if (stream?.sender.mean_rtt != null) {
        const min = stream.sender.min_rtt;
        const mean = stream.sender.mean_rtt; // Use the provided mean
        const max = stream.sender.max_rtt;

        // *** MODIFIED DATA ARRAY ***
        // Provide data as [min, mean, mean, mean, max]
        // This places the mean where q1, median, and q3 are expected,
        // effectively collapsing the 'box' to a line at the mean.
        // The whiskers will still show min and max correctly.
        return [min, mean, mean, mean, max];
        // *** END MODIFIED DATA ARRAY ***
      } else {
        console.warn(
          "Sender stream found but missing RTT data in report:",
          report.name,
        );
        const receiverStream = report.data.end.streams.find(
          (data) => !data.sender.sender,
        );
        if (receiverStream?.sender.mean_rtt != null) {
          const min = receiverStream.sender.min_rtt;
          const mean = receiverStream.sender.mean_rtt;
          const max = receiverStream.sender.max_rtt;
          return [min, mean, mean, mean, max]; // Apply same logic
        } else {
          console.warn(
            "Receiver stream also missing RTT data in report:",
            report.name,
          );
          return [0, 0, 0, 0, 0];
        }
      }
    }
    console.warn("No streams found in end data for report:", report.name);
    return [0, 0, 0, 0, 0];
  });

  return {
    title: {
      text: "Round Trip Time (RTT)", // Simplified title
    },
    tooltip: {
      trigger: "item",
      formatter: function (params: {
        name: string;
        data: [number, number, number, number, number];
        marker: string;
      }) {
        const boxData = params.data;
        const factor = 1000; // Convert µs to ms

        // Indices still correspond to [min, q1(mean), median(mean), q3(mean), max]
        const minMs = (boxData[0] / factor).toFixed(2);
        const meanMs = (boxData[2] / factor).toFixed(2); // Mean is at index 2
        const maxMs = (boxData[4] / factor).toFixed(2);

        return `${params.marker}${params.name}<br/>
                Min RTT: ${minMs} µs<br/>
                Mean RTT: ${meanMs} µs<br/>
                Max RTT: ${maxMs} µs`;
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
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
      boundaryGap: true,
      nameGap: 30,
      splitArea: { show: false },
      axisLabel: { show: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "RTT (µs)",
      axisLabel: {
        // Format axis labels to show ms for better readability
        formatter: (value: number) => `${(value / 1000).toFixed(1)} µs`,
      },
      splitArea: { show: true },
    },
    series: [
      {
        name: "RTT Values (µs)",
        type: "boxplot",
        data: boxplotData,
        // Tooltip formatting is now handled by the main tooltip config above
        itemStyle: {
          borderColor: "#3498db",
        },
        boxWidth: [40, 70],
        emphasis: {
          itemStyle: {
            borderColor: "#1a6fb0",
          },
        },
      },
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
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    legend: {
      data: ["Max Send Window", "Max Congestion Window"],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
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
  const avgSentMbps = reportData.end.sum_sent.bits_per_second / 1000000;
  // Use sum_received for the overall average received rate as reported by iperf
  const avgRecvMbps = reportData.end.sum_received.bits_per_second / 1000000;

  let minSentMbps = avgSentMbps;
  let maxSentMbps = avgSentMbps;
  let minRecvMbps = avgRecvMbps;
  let maxRecvMbps = avgRecvMbps;

  const isBidir = reportData.start?.test_start?.bidir === 1;

  if (reportData.intervals && reportData.intervals.length > 0) {
    const sentRates = reportData.intervals.map(
      (interval) => interval.sum.bits_per_second / 1000000,
    );
    minSentMbps = Math.min(...sentRates);
    maxSentMbps = Math.max(...sentRates);

    // For received rates, use sum_bidir_reverse if available (bidirectional test)
    // Otherwise, if it was a reverse test (-R flag), the 'sum' would represent received data.
    // For a standard *non-bidir*, *non-reverse* test, interval received data isn't typically in the client's JSON 'sum'.
    // We rely on the provided JSON structure having sum_bidir_reverse for the received part in bidir tests.
    if (isBidir && reportData.intervals.every((i) => i.sum_bidir_reverse)) {
      const recvRates = reportData.intervals.map((interval) => {
        if (interval.sum_bidir_reverse) {
          return interval.sum_bidir_reverse.bits_per_second / 1000000; // Use non-null assertion as we checked
        } else {
          throw new Error("sum_bidir_reverse is missing in intervals");
        }
      });
      minRecvMbps = Math.min(...recvRates);
      maxRecvMbps = Math.max(...recvRates);
    } else if (!isBidir /* && isReverseTest - need flag info */) {
      // Handle calculation if it was a reverse-only test if needed
      // For now, we'll stick to the average if interval data isn't clear for received
      minRecvMbps = avgRecvMbps;
      maxRecvMbps = avgRecvMbps;
    } else {
      // Default to average if not bidir with sum_bidir_reverse
      minRecvMbps = avgRecvMbps;
      maxRecvMbps = avgRecvMbps;
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

// Throughput Chart Creator - MODIFIED
const createThroughputOption = (reports: IperfTcpReport[]) => {
  // Pre-calculate stats for easier access in tooltip
  const throughputStats = reports.map((report) => ({
    name: report.name,
    stats: getThroughputStats(report.data),
  }));

  return {
    title: {
      text: "Average Throughput", // Updated title
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

        // Find sent and received data in params based on seriesName
        const sentParam = params.find((p) => p.seriesName === "Average Sent");
        const recvParam = params.find(
          (p) => p.seriesName === "Average Received",
        );

        if (sentParam) {
          tooltipText += `${sentParam.marker} Avg Sent: ${reportStat.stats.avgSentMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Min Sent: ${reportStat.stats.minSentMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Max Sent: ${reportStat.stats.maxSentMbps.toFixed(1)} Mbps<br/>`;
        }
        if (recvParam) {
          tooltipText += `${recvParam.marker} Avg Recv: ${reportStat.stats.avgRecvMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Min Recv: ${reportStat.stats.minRecvMbps.toFixed(1)} Mbps<br/>`;
          tooltipText += `&nbsp;&nbsp;&nbsp;Max Recv: ${reportStat.stats.maxRecvMbps.toFixed(1)} Mbps`;
        }

        return tooltipText;
      },
    },
    legend: {
      data: ["Average Sent", "Average Received"], // Updated legend labels
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
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
      axisLabel: {
        formatter: "{value}", // Keep simple number format for Mbps
      },
    },
    series: [
      {
        name: "Average Sent", // Updated series name
        type: "bar",
        data: throughputStats.map((item) => item.stats.avgSentMbps.toFixed(1)), // Plot average
        color: "#3498db",
        label: {
          // Label still shows the average value on the bar
          show: true,
          position: "top",
          formatter: "{c} Mbps",
        },
      },
      {
        name: "Average Received", // Updated series name
        type: "bar",
        data: throughputStats.map((item) => item.stats.avgRecvMbps.toFixed(1)), // Plot average
        color: "#2ecc71",
        label: {
          // Label still shows the average value on the bar
          show: true,
          position: "top",
          formatter: "{c} Mbps",
        },
      },
    ],
  };
};
// CPU Utilization Chart Creator
const createCpuOption = (reports: IperfTcpReport[]) => {
  return {
    title: {
      text: "Average CPU Utilization",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    legend: {
      data: ["Host CPU", "Remote CPU"],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
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
      name: "Percentage (%)",
      max: 100,
    },
    series: [
      {
        name: "Host CPU",
        type: "bar",
        data: reports.map((report) =>
          report.data.end.cpu_utilization_percent.host_total.toFixed(1),
        ),
        color: "#9b59b6",
        label: {
          show: true,
          position: "top",
          formatter: "{c} %",
        },
      },
      {
        name: "Remote CPU",
        type: "bar",
        data: reports.map((report) =>
          report.data.end.cpu_utilization_percent.remote_total.toFixed(1),
        ),
        color: "#e74c3c",
        label: {
          show: true,
          position: "top",
          formatter: "{c} %",
        },
      },
    ],
  };
};

// Retransmits Chart Creator
const createRetransmitsOption = (reports: IperfTcpReport[]) => {
  return {
    title: {
      text: "Total TCP Retransmits",
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
    },
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: reports.map((report) => report.name),
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
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
      <IperfThroughputChart
        reports={props.reports}
        height={height().throughput}
      />
      <IperfTimeSeriesChart
        reports={props.reports}
        height={height().timeSeries}
      />

      <div style={{ display: "flex", gap: "20px" }}>
        <div style={{ flex: 1 }}>
          <IperfCpuChart reports={props.reports} height={height().cpu} />
        </div>
        <div style={{ flex: 1 }}>
          <IperfRetransmitsChart
            reports={props.reports}
            height={height().retransmits}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px" }}>
        <div style={{ flex: 1 }}>
          <IperfRttChart reports={props.reports} height={height().rtt} />
        </div>
        <div style={{ flex: 1 }}>
          <IperfMaxSendWindowChart
            reports={props.reports}
            height={height().maxSendWindow}
          />
        </div>
      </div>
    </div>
  );
};
