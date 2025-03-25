import { Component } from "solid-js";
import { Echart } from "../Echarts";

// Define interface for percentile data
interface QperfPercentiles {
  p25: number;
  p50: number;
  p75: number;
}

// Define interface for qperf benchmark data
export interface QperfData {
  total_bandwidth_mbps_percentiles: QperfPercentiles;
  cpu_usage_percent_percentiles: QperfPercentiles;
  ttfb_ms_percentiles: QperfPercentiles;
  conn_time_ms_percentiles: QperfPercentiles;
}

// Define interface for each machine's qperf report
export interface QperfReport {
  name: string;
  data: QperfData;
}

// Define the supported metrics
type MetricKey = "total_bandwidth" | "cpu_usage" | "ttfb" | "conn_time";

// Helper function to extract the appropriate percentiles based on the metric key
const getPercentilesByMetric = (data: QperfData, metric: MetricKey): QperfPercentiles => {
  switch (metric) {
    case "total_bandwidth":
      return data.total_bandwidth_mbps_percentiles;
    case "cpu_usage":
      return data.cpu_usage_percent_percentiles;
    case "ttfb":
      return data.ttfb_ms_percentiles;
    case "conn_time":
      return data.conn_time_ms_percentiles;
    default:
      throw new Error("Invalid metric");
  }
};

// Calculate a five-number summary for the boxplot using the provided percentiles.
// We use an assumption: min = p25 * 0.9 and max = p75 * 1.1.
const getBoxplotArray = (perc: QperfPercentiles): number[] => {
  const min = perc.p25 * 0.9;
  const max = perc.p75 * 1.1;
  return [min, perc.p25, perc.p50, perc.p75, max];
};

// Process an array of qperf reports into the categories and boxplot data format expected by ECharts.
const processDataForQperfBoxplot = (reports: QperfReport[], metric: MetricKey) => {
  const categories: string[] = [];
  const boxplotData: number[][] = [];
  
  reports.forEach((report) => {
    categories.push(report.name);
    const perc = getPercentilesByMetric(report.data, metric);
    boxplotData.push(getBoxplotArray(perc));
  });
  
  return { categories, boxplotData };
};

// Create the ECharts option object for the boxplot.
// The tooltip formatter and axis label are customized based on the chosen metric.
const createQperfBoxplotOption = (reports: QperfReport[], metric: MetricKey, title: string) => {
  const { categories, boxplotData } = processDataForQperfBoxplot(reports, metric);

  // Define label and tooltip formatting based on the metric being plotted
  let yAxisName = "";
  let tooltipFormatter: (params: { seriesIndex: number; name: string; data: number[]; }) => string = () => "";

  if (metric === "total_bandwidth") {
    yAxisName = "Bandwidth (Mbps)";
    tooltipFormatter = function (params) {
      const data = params.data;
      return `${params.name}<br/>
              Min: ${data[0].toFixed(2)} Mbps<br/>
              Q1: ${data[1].toFixed(2)} Mbps<br/>
              Median: ${data[2].toFixed(2)} Mbps<br/>
              Q3: ${data[3].toFixed(2)} Mbps<br/>
              Max: ${data[4].toFixed(2)} Mbps`;
    };
  } else if (metric === "cpu_usage") {
    yAxisName = "CPU Usage (%)";
    tooltipFormatter = function (params) {
      const data = params.data;
      return `${params.name}<br/>
              Min: ${data[0].toFixed(2)}%<br/>
              Q1: ${data[1].toFixed(2)}%<br/>
              Median: ${data[2].toFixed(2)}%<br/>
              Q3: ${data[3].toFixed(2)}%<br/>
              Max: ${data[4].toFixed(2)}%`;
    };
  } else if (metric === "ttfb") {
    yAxisName = "TTFB (ms)";
    tooltipFormatter = function (params) {
      const data = params.data;
      return `${params.name}<br/>
              Min: ${data[0].toFixed(2)} ms<br/>
              Q1: ${data[1].toFixed(2)} ms<br/>
              Median: ${data[2].toFixed(2)} ms<br/>
              Q3: ${data[3].toFixed(2)} ms<br/>
              Max: ${data[4].toFixed(2)} ms`;
    };
  } else if (metric === "conn_time") {
    yAxisName = "Connection Time (ms)";
    tooltipFormatter = function (params) {
      const data = params.data;
      return `${params.name}<br/>
              Min: ${data[0].toFixed(2)} ms<br/>
              Q1: ${data[1].toFixed(2)} ms<br/>
              Median: ${data[2].toFixed(2)} ms<br/>
              Q3: ${data[3].toFixed(2)} ms<br/>
              Max: ${data[4].toFixed(2)} ms`;
    };
  }

  const result = {
    title: {
      text: title,
      left: "center",
    },
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
    },
    grid: {
      left: "10%",
      right: "10%",
      bottom: "15%",
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: true,
      nameGap: 30,
      axisLabel: {
        show: true,
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      min: metric === "ttfb" ? Math.min(...boxplotData.map(item => item[0])) : undefined,
      max: metric === "ttfb" ? Math.max(...boxplotData.map(item => item[4])) : undefined,
      splitArea: {
        show: true,
      },
      axisLabel: {
        formatter: (value: number) => value.toFixed(2),
      },
    },
    series: [
      {
        name: title,
        type: "boxplot",
        data: boxplotData,
        tooltip: { trigger: "item" },
        itemStyle: {
          borderWidth: 2,
          borderColor: "#1890ff",
        },
      },
    ],
  };

  return result;
};

export interface QperfBoxplotChartProps {
  // Array of machine reports with qperf benchmark data
  reports: QperfReport[];
  // Metric to be plotted – one of total_bandwidth, cpu_usage, ttfb, or conn_time.
  metric: MetricKey;
  title: string;
  height?: number;
}

// This SolidJS component wraps the Apache ECharts component.
// It passes in the option generated by createQperfBoxplotOption for the given qperf reports.
export const QperfBoxplotChart: Component<QperfBoxplotChartProps> = (props) => {
  const option = createQperfBoxplotOption(props.reports, props.metric, props.title);
  return <Echart option={option} height={props.height || 500} />;
};


export interface QperfChartsDashboardProps {
  reports: QperfReport[];
  height?: {
  totalBandwidth?: number;
  cpuUsage?: number;
  ttfb?: number;
  connTime?: number;
  };
}

export const QperfChartsDashboard: Component<QperfChartsDashboardProps> = ({
  reports,
  height = {
  totalBandwidth: 500,
  cpuUsage: 500,
  ttfb: 500,
  connTime: 500,
  },
  }) => {
  return (
  <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
  <QperfBoxplotChart
       reports={reports}
       metric="total_bandwidth"
       title="Total Bandwidth (Mbps)"
       height={height.totalBandwidth}
     />
  <div style={{ display: "flex", gap: "20px" }}>
  <div style={{ flex: 1 }}>
  <QperfBoxplotChart
           reports={reports}
           metric="cpu_usage"
           title="CPU Usage (%)"
           height={height.cpuUsage}
         />
  </div>
  <div style={{ flex: 1 }}>
  <QperfBoxplotChart
           reports={reports}
           metric="ttfb"
           title="TTFB (ms)"
           height={height.ttfb}
         />
  </div>
  </div>
  <QperfBoxplotChart
       reports={reports}
       metric="conn_time"
       title="Connection Time (ms)"
       height={height.connTime}
     />
  </div>
  );
};

export default QperfChartsDashboard;