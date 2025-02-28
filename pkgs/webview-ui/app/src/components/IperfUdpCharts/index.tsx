import { Echart } from "../Echarts";

// Define interfaces for UDP reports
interface IperfUdpReportData {
  end: {
    sum_sent: {
      bits_per_second: number;
      bytes: number;
      packets: number;
    };
    sum_received: {
      bits_per_second: number;
      bytes: number;
      jitter_ms: number;
      lost_packets: number;
      packets: number;
      lost_percent: number;
    };
    cpu_utilization_percent: {
      host_total: number;
      remote_total: number;
    };
  };
  intervals?: Array<{
    sum: {
      start: number;
      end: number;
      bits_per_second: number;
      packets: number;
    };
    sum_bidir_reverse?: {
      jitter_ms: number;
      lost_packets: number;
      packets: number;
      lost_percent: number;
    };
  }>;
}

interface IperfUdpReport {
  name: string;
  data: IperfUdpReportData;
}

interface IperfUdpChartsProps {
  reports: IperfUdpReport[];
  height?: {
    throughput?: number;
    timeSeries?: number;
    packetLoss?: number;
    jitter?: number;
    cpu?: number;
  };
}

// Throughput Chart Creator for UDP
const createUdpThroughputOption = (reports: IperfUdpReport[]) => {
  return {
    title: {
      text: "UDP Throughput Comparison (Mbps)",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: any) {
        return `${params[0].name}: ${params[0].value.toFixed(2)} Mbps`;
      },
    },
    legend: {
      data: ["Sent", "Received"],
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
        restore: {},
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "Mbps",
    },
    series: [
      {
        name: "Sent",
        type: "bar",
        data: reports.map(
          (report) => report.data.end.sum_sent.bits_per_second / 1000000,
        ),
        color: "#3498db",
      },
      {
        name: "Received",
        type: "bar",
        data: reports.map(
          (report) => report.data.end.sum_received.bits_per_second / 1000000,
        ),
        color: "#2ecc71",
      },
    ],
  };
};

// Packet Loss Chart Creator
const createPacketLossOption = (reports: IperfUdpReport[]) => {
  return {
    title: {
      text: "UDP Packet Loss (%)",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: any) {
        return `${params[0].name}: ${params[0].value.toFixed(2)}%`;
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
        restore: {},
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "Packet Loss (%)",
      max: 100,
    },
    series: [
      {
        name: "Packet Loss",
        type: "bar",
        data: reports.map(
          (report) => report.data.end.sum_received.lost_percent,
        ),
        color: "#e74c3c",
        label: {
          show: true,
          position: "top",
          formatter: "{c}%",
        },
      },
    ],
  };
};

// Jitter Chart Creator
const createJitterOption = (reports: IperfUdpReport[]) => {
  return {
    title: {
      text: "UDP Jitter (ms)",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: any) {
        return `${params[0].name}: ${params[0].value.toFixed(4)} ms`;
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
        restore: {},
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "Jitter (ms)",
    },
    series: [
      {
        name: "Jitter",
        type: "bar",
        data: reports.map((report) => report.data.end.sum_received.jitter_ms),
        color: "#9b59b6",
        label: {
          show: true,
          position: "top",
          formatter: "{c} ms",
        },
      },
    ],
  };
};

// CPU Utilization Chart Creator for UDP
const createUdpCpuOption = (reports: IperfUdpReport[]) => {
  return {
    title: {
      text: "CPU Utilization (%)",
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
        restore: {},
      },
    },
    xAxis: {
      type: "category",
      data: reports.map((report) => report.name),
    },
    yAxis: {
      type: "value",
      name: "Percentage (%)",
    },
    series: [
      {
        name: "Host CPU",
        type: "bar",
        data: reports.map(
          (report) => report.data.end.cpu_utilization_percent.host_total,
        ),
        color: "#9b59b6",
      },
      {
        name: "Remote CPU",
        type: "bar",
        data: reports.map(
          (report) => report.data.end.cpu_utilization_percent.remote_total,
        ),
        color: "#e74c3c",
      },
    ],
  };
};

// Time Series Chart Creator for UDP
const createUdpTimeSeriesOption = (reports: IperfUdpReport[]) => {
  // Get all intervals from all reports
  const allTimeStamps: string[] = [];
  const seriesData: Array<{
    name: string;
    type: string;
    data: number[];
    color: string;
  }> = [];

  const packetLossSeries: Array<{
    name: string;
    type: string;
    data: number[];
    color: string;
    yAxisIndex: number;
  }> = [];

  // Generate colors
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

    // Create throughput series data for this report
    const throughputData = report.data.intervals.map(
      (interval) => interval.sum.bits_per_second / 1000000,
    );

    seriesData.push({
      name: `${report.name} Throughput`,
      type: "line",
      data: throughputData,
      color: colorPalette[index % colorPalette.length],
    });

    // Create packet loss series if available
    const packetLossData = report.data.intervals.map(
      (interval) => interval.sum_bidir_reverse?.lost_percent || 0,
    );

    packetLossSeries.push({
      name: `${report.name} Packet Loss`,
      type: "line",
      data: packetLossData,
      color: colorPalette[(index + 5) % colorPalette.length],
      yAxisIndex: 1,
    });
  });

  // Sort timestamps numerically
  allTimeStamps.sort((a, b) => parseFloat(a) - parseFloat(b));

  return {
    title: {
      text: "UDP Performance Over Time",
    },
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: [
        ...seriesData.map((s) => s.name),
        ...packetLossSeries.map((s) => s.name),
      ],
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
        restore: {},
      },
    },
    xAxis: {
      type: "category",
      name: "Time (seconds)",
      nameLocation: "middle",
      nameGap: 30,
      data: allTimeStamps,
    },
    yAxis: [
      {
        type: "value",
        name: "Throughput (Mbps)",
        position: "left",
      },
      {
        type: "value",
        name: "Packet Loss (%)",
        position: "right",
        max: 100,
        axisLine: {
          lineStyle: {
            color: "#e74c3c",
          },
        },
        axisLabel: {
          formatter: "{value}%",
        },
      },
    ],
    series: [...seriesData, ...packetLossSeries],
  };
};

// Individual chart components for UDP
export const IperfUdpThroughputChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  return <Echart option={createUdpThroughputOption(reports)} height={height} />;
};

export const IperfUdpPacketLossChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  return <Echart option={createPacketLossOption(reports)} height={height} />;
};

export const IperfUdpJitterChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  return <Echart option={createJitterOption(reports)} height={height} />;
};

export const IperfUdpTimeSeriesChart = ({
  reports,
  height = 700,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  return <Echart option={createUdpTimeSeriesOption(reports)} height={height} />;
};

export const IperfUdpCpuChart = ({
  reports,
  height = 500,
}: {
  reports: IperfUdpReport[];
  height?: number;
}) => {
  return <Echart option={createUdpCpuOption(reports)} height={height} />;
};

// Combined dashboard component for UDP
export const IperfUdpCharts = ({
  reports,
  height = {
    throughput: 500,
    timeSeries: 700,
    packetLoss: 500,
    jitter: 500,
    cpu: 500,
  },
}: IperfUdpChartsProps) => {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <IperfUdpThroughputChart reports={reports} height={height.throughput} />
      <IperfUdpTimeSeriesChart reports={reports} height={height.timeSeries} />
      <div style={{ display: "flex", gap: "20px" }}>
        <div style={{ flex: 1 }}>
          <IperfUdpPacketLossChart
            reports={reports}
            height={height.packetLoss}
          />
        </div>
        <div style={{ flex: 1 }}>
          <IperfUdpJitterChart reports={reports} height={height.jitter} />
        </div>
      </div>
      <IperfUdpCpuChart reports={reports} height={height.cpu} />
    </div>
  );
};
