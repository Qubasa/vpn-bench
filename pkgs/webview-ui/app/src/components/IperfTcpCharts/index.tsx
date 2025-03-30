import { Echart } from "../Echarts";

// Define interfaces for typing
export interface IperfTcpReportData {
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
// RTT Boxplot Chart Creator
const createRttOption = (reports: IperfTcpReport[]) => {
  // Prepare data for boxplot format
  const boxplotData = reports.map((report) => {
    if (report.data.end.streams && report.data.end.streams.length > 0) {
      const stream = report.data.end.streams.find((data) => data.sender.sender);

      if (stream == undefined) {
        throw new Error("No sender data found in report");
      }

      // With only min, mean, and max values available, we need to create
      // a simplified boxplot representation
      const min = stream.sender.min_rtt;
      const mean = stream.sender.mean_rtt;
      const max = stream.sender.max_rtt;

      // Create artificial quartiles based on available data
      // Q1 is halfway between min and mean
      // Q3 is halfway between mean and max
      const q1 = min + (mean - min) / 2;
      const q3 = mean + (max - mean) / 2;

      // Return boxplot data in format [min, q1, mean, q3, max]
      return [min, q1, mean, q3, max];
    }
    return [0, 0, 0, 0, 0]; // Default if no data
  });

  return {
    title: {
      text: "Round Trip Time (RTT) Distribution",
    },
    tooltip: {
      trigger: "item",
      formatter: function (params: {
        name: string;
        data: [number, number, number, number, number];
      }) {
        // Format tooltip to show min, mean, max explicitly
        const data = params.data;
        return `${params.name}<br/>
                Min RTT: ${data[0]} ms<br/>
                Mean RTT: ${data[2]} ms<br/>
                Max RTT: ${data[4]} ms`;
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
      splitArea: {
        show: false,
      },
      axisLabel: {
        show: true,
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "value",
      name: "RTT (ms)",
      splitArea: {
        show: true,
      },
    },
    series: [
      {
        name: "RTT Values",
        type: "boxplot",
        data: boxplotData,
        tooltip: { formatter: "{b}: {c}" },
        itemStyle: {
          borderColor: "#3498db", // Blue border
        },
        boxWidth: [40, 70], // Width of the box plot
        emphasis: {
          itemStyle: {
            borderColor: "#1a6fb0", // Darker blue on hover
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
      text: "TCP Window Size",
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

// Individual chart components remain the same
export const IperfRttChart = ({
  reports,
  height = 500,
}: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return <Echart option={createRttOption(reports)} height={height} />;
};

export const IperfMaxSendWindowChart = ({
  reports,
  height = 500,
}: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return <Echart option={createMaxSendWindowOption(reports)} height={height} />;
};

// Throughput Chart Creator
const createThroughputOption = (reports: IperfTcpReport[]) => {
  return {
    title: {
      text: "Total Throughput",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: { name: string; value: number }[]) {
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
        data: reports.map((report) =>
          (report.data.end.sum_sent.bits_per_second / 1000000).toFixed(1),
        ),
        color: "#3498db",
        label: {
          show: true,
          position: "top",
          formatter: "{c} Mbps",
        },
      },
      {
        name: "Received",
        type: "bar",
        data: reports.map((report) =>
          (report.data.end.sum_received.bits_per_second / 1000000).toFixed(1),
        ),
        color: "#2ecc71",
        label: {
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
      text: "CPU Utilization",
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
      text: "TCP Retransmits",
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
    const throughputData = report.data.intervals.map(
      (interval) => interval.sum.bits_per_second / 1000000,
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

// Individual chart components
export const IperfThroughputChart = ({
  reports,
  height = 500,
}: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return <Echart option={createThroughputOption(reports)} height={height} />;
};

export const IperfTimeSeriesChart = ({
  reports,
  height = 700,
}: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return <Echart option={createTimeSeriesOption(reports)} height={height} />;
};

export const IperfCpuChart = ({
  reports,
  height = 500,
}: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return <Echart option={createCpuOption(reports)} height={height} />;
};

export const IperfRetransmitsChart = ({
  reports,
  height = 500,
}: {
  reports: IperfTcpReport[];
  height?: number;
}) => {
  return <Echart option={createRetransmitsOption(reports)} height={height} />;
};

// Combined dashboard component
export const IperfTcpCharts = ({
  reports,
  height = {
    throughput: 500,
    timeSeries: 700,
    cpu: 500,
    retransmits: 500,
    rtt: 500,
    maxSendWindow: 500,
  },
}: IperfTcpChartsProps) => {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <IperfThroughputChart reports={reports} height={height.throughput} />
      <IperfTimeSeriesChart reports={reports} height={height.timeSeries} />

      <div style={{ display: "flex", gap: "20px" }}>
        <div style={{ flex: 1 }}>
          <IperfCpuChart reports={reports} height={height.cpu} />
        </div>
        <div style={{ flex: 1 }}>
          <IperfRetransmitsChart
            reports={reports}
            height={height.retransmits}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px" }}>
        <div style={{ flex: 1 }}>
          <IperfRttChart reports={reports} height={height.rtt} />
        </div>
        <div style={{ flex: 1 }}>
          <IperfMaxSendWindowChart
            reports={reports}
            height={height.maxSendWindow}
          />
        </div>
      </div>
    </div>
  );
};

// Example usage
/*
import luna_tcp_iperf3 from "@/bench/NoVPN/0_luna/tcp_iperf3.json";
import milo_tcp_iperf3 from "@/bench/NoVPN/1_milo/tcp_iperf3.json";

export const TestComponent = () => {
  const reports = [
    { name: "milo", data: milo_tcp_iperf3 },
    { name: "luna", data: luna_tcp_iperf3 }
  ];
  
  return (
    <IperfDashboard 
      reports={reports} 
      height={{
        throughput: 500,
        timeSeries: 700,
        cpu: 500,
        retransmits: 500
      }}
    />
  );
};
*/
