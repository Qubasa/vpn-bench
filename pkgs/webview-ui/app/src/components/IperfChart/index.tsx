import { Echart } from "../Echarts";

// Define interfaces for typing
interface IperfReportData {
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
  };
  intervals?: Array<{
    sum: {
      start: number;
      end: number;
      bits_per_second: number;
    };
  }>;
}

// Combined report interface with name and data
interface IperfReport {
  name: string;
  data: IperfReportData;
}

interface IperfDashboardProps {
  reports: IperfReport[];
  height?: {
    throughput?: number;
    timeSeries?: number;
    cpu?: number;
    retransmits?: number;
  };
}

// Throughput Chart Creator
const createThroughputOption = (reports: IperfReport[]) => {
  return {
    title: {
      text: "Throughput Comparison (Mbps)",
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
      data: reports.map(report => report.name),
    },
    yAxis: {
      type: "value",
      name: "Mbps",
    },
    series: [
      {
        name: "Sent",
        type: "bar",
        data: reports.map(report => report.data.end.sum_sent.bits_per_second / 1000000),
        color: "#3498db",
      },
      {
        name: "Received",
        type: "bar",
        data: reports.map(report => report.data.end.sum_received.bits_per_second / 1000000),
        color: "#2ecc71",
      },
    ],
  };
};

// CPU Utilization Chart Creator
const createCpuOption = (reports: IperfReport[]) => {
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
      data: reports.map(report => report.name),
    },
    yAxis: {
      type: "value",
      name: "Percentage (%)",
    },
    series: [
      {
        name: "Host CPU",
        type: "bar",
        data: reports.map(report => report.data.end.cpu_utilization_percent.host_total),
        color: "#9b59b6",
      },
      {
        name: "Remote CPU",
        type: "bar",
        data: reports.map(report => report.data.end.cpu_utilization_percent.remote_total),
        color: "#e74c3c",
      },
    ],
  };
};

// Retransmits Chart Creator
const createRetransmitsOption = (reports: IperfReport[]) => {
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
        restore: {},
      },
    },
    xAxis: {
      type: "category",
      data: reports.map(report => report.name),
    },
    yAxis: {
      type: "value",
      name: "Count",
    },
    series: [
      {
        name: "Retransmits",
        type: "bar",
        data: reports.map(report => report.data.end.sum_sent.retransmits),
        color: "#f39c12",
      },
    ],
  };
};

// Time Series Chart Creator
const createTimeSeriesOption = (reports: IperfReport[]) => {
  // Get all intervals from all reports
  const allTimeStamps: string[] = [];
  const seriesData: Array<{
    name: string;
    type: string;
    data: number[];
    color: string;
  }> = [];

  // Generate colors dynamically based on number of reports
  const colorPalette = [
    "#3498db", "#2ecc71", "#e74c3c", "#f39c12", "#9b59b6", 
    "#1abc9c", "#d35400", "#34495e", "#16a085", "#c0392b"
  ];

  // Process each report's intervals
  reports.forEach((report, index) => {
    if (!report.data.intervals || report.data.intervals.length === 0) {
      return;
    }

    // Extract time points from this report
    const reportTimeStamps = report.data.intervals.map(interval => 
      interval.sum.end.toFixed(1)
    );
    
    // Combine with master list
    reportTimeStamps.forEach(stamp => {
      if (!allTimeStamps.includes(stamp)) {
        allTimeStamps.push(stamp);
      }
    });

    // Create series data for this report
    const throughputData = report.data.intervals.map(interval => 
      interval.sum.bits_per_second / 1000000
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
      data: reports.map(report => report.name),
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
  height = 500 
}: { 
  reports: IperfReport[]; 
  height?: number; 
}) => {
  return <Echart option={createThroughputOption(reports)} height={height} />;
};

export const IperfTimeSeriesChart = ({ 
  reports, 
  height = 700 
}: { 
  reports: IperfReport[]; 
  height?: number; 
}) => {
  return <Echart option={createTimeSeriesOption(reports)} height={height} />;
};

export const IperfCpuChart = ({ 
  reports, 
  height = 500 
}: { 
  reports: IperfReport[]; 
  height?: number; 
}) => {
  return <Echart option={createCpuOption(reports)} height={height} />;
};

export const IperfRetransmitsChart = ({ 
  reports, 
  height = 500 
}: { 
  reports: IperfReport[]; 
  height?: number; 
}) => {
  return <Echart option={createRetransmitsOption(reports)} height={height} />;
};

// Combined dashboard component
export const IperfDashboard = ({ 
  reports, 
  height = {
    throughput: 500,
    timeSeries: 700,
    cpu: 500,
    retransmits: 500
  } 
}: IperfDashboardProps) => {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <IperfThroughputChart 
        reports={reports} 
        height={height.throughput} 
      />
      <IperfTimeSeriesChart 
        reports={reports} 
        height={height.timeSeries} 
      />
      <div style={{ display: "flex", gap: "20px" }}>
        <div style={{ flex: 1 }}>
          <IperfCpuChart 
            reports={reports} 
            height={height.cpu} 
          />
        </div>
        <div style={{ flex: 1 }}>
          <IperfRetransmitsChart 
            reports={reports} 
            height={height.retransmits} 
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