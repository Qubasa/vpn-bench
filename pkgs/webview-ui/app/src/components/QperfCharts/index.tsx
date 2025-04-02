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
const getPercentilesByMetric = (
  data: QperfData,
  metric: MetricKey,
): QperfPercentiles => {
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
const processDataForQperfBoxplot = (
  reports: QperfReport[],
  metric: MetricKey,
) => {
  const categories: string[] = [];
  const boxplotData: number[][] = [];

  reports.forEach((report) => {
    categories.push(report.name);
    const perc = getPercentilesByMetric(report.data, metric);
    boxplotData.push(getBoxplotArray(perc));
  });

  return { categories, boxplotData };
};

// Get color scheme based on metric type

// Define a color palette for machines to ensure consistency across charts
const machineColorPalette = [
  "#3366FF", // blue
  "#FF5733", // orange/red
  "#33CC99", // green
  "#9966FF", // purple
  "#FFCC33", // yellow
  "#FF6699", // pink
  "#00CCCC", // teal
  "#CC6633", // brown
  "#6699CC", // slate blue
  "#99CC33", // lime
];

// Get a consistent color for a machine based on its position in the reports array
const getMachineColor = (machineIndex: number) => {
  return machineColorPalette[machineIndex % machineColorPalette.length];
};

// Get machine-specific color styling
const getMachineColorScheme = (machineIndex: number) => {
  const baseColor = getMachineColor(machineIndex);
  return {
    color: baseColor,
    borderColor: baseColor,
    fillColor: new Function(
      "params",
      `return new echarts.graphic.LinearGradient(0, 0, 0, 1, [{offset: 0, color: "${baseColor}70"}, {offset: 1, color: "${baseColor}30"}])`,
    ),
    emphasis: {
      borderColor: baseColor,
      borderWidth: 2,
      shadowBlur: 10,
      shadowColor: `${baseColor}80`,
      color: new Function(
        "params",
        `return new echarts.graphic.LinearGradient(0, 0, 0, 1, [{offset: 0, color: "${baseColor}90"}, {offset: 1, color: "${baseColor}50"}])`,
      ),
    },
  };
};

// Create the ECharts option object for the boxplot.
// The tooltip formatter and axis label are customized based on the chosen metric.
const createQperfBoxplotOption = (
  reports: QperfReport[],
  metric: MetricKey,
  title: string,
) => {
  const { categories, boxplotData } = processDataForQperfBoxplot(
    reports,
    metric,
  );

  // Define label and tooltip formatting based on the metric being plotted
  let yAxisName = "";
  let unitSymbol = "";

  if (metric === "total_bandwidth") {
    yAxisName = "Megabits per second (Mbps)";
    unitSymbol = " Mbps";
  } else if (metric === "cpu_usage") {
    yAxisName = "Percentage (%)";
    unitSymbol = "%";
  } else if (metric === "ttfb") {
    yAxisName = "Miliseconds (ms)";
    unitSymbol = " ms";
  } else if (metric === "conn_time") {
    yAxisName = "Milliseconds (ms)";
    unitSymbol = " ms";
  }

  // Custom tooltip formatter using x-axis categories
  const tooltipFormatter = function (params: {
    data: { value: number[] };
    dataIndex: number;
  }) {
    const machineIndex = params.dataIndex;
    const machineColor = getMachineColor(machineIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    const data = params.data.value;

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${categories[machineIndex]}</div>
              <div>${colorBox} Min: <strong>${data[0].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q1: <strong>${data[1].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Median: <strong>${data[2].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q3: <strong>${data[3].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Max: <strong>${data[4].toFixed(2)}${unitSymbol}</strong></div>
            </div>`;
  };

  // Create one boxplot series with each data item corresponding to a machine.
  const seriesData = [
    {
      type: "boxplot",
      data: boxplotData.map((data, index) => {
        const colorScheme = getMachineColorScheme(index);
        return {
          value: data,
          itemStyle: {
            borderWidth: 2,
            borderColor: colorScheme.borderColor,
          },
          emphasis: {
            itemStyle: colorScheme.emphasis,
          },
          boxWidth: [8, 50],
        };
      }),
      animationDelay: (idx: number) => idx * 50,
    },
  ];

  const result = {
    title: {
      text: title,
      left: "center",
      textStyle: {
        fontWeight: "bold",
        fontSize: 16,
        fontFamily: "Arial, Helvetica, sans-serif",
      },
      padding: [10, 0, 20, 0],
    },
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.9)",
      borderWidth: 1,
      textStyle: {
        color: "#333",
      },
      extraCssText: "box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);",
    },
    animation: true,
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    grid: {
      left: "10%",
      right: "10%",
      bottom: "15%",
      top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: true,
      nameGap: 30,
      axisLabel: {
        show: true,
        margin: 15,
        fontSize: 12,
      },
      axisTick: {
        alignWithLabel: true,
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameTextStyle: {
        fontWeight: "bold",
        padding: [0, 0, 0, 40],
        fontSize: 13,
      },
      min: 0, // Always start from 0 for all metrics
      max:
        metric === "ttfb"
          ? Math.max(...boxplotData.map((item) => item[4])) * 1.1 // Add 10% headroom for TTFB
          : undefined,
      splitArea: {
        show: true,
        areaStyle: {
          color: ["rgba(250,250,250,0.3)", "rgba(240,240,240,0.3)"],
        },
      },
      axisLabel: {
        formatter: (value: number) => value.toFixed(2),
        fontSize: 12,
      },
    },
    series: seriesData,
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
  const option = createQperfBoxplotOption(
    props.reports,
    props.metric,
    props.title,
  );
  return <Echart option={option} height={props.height || 500} />;
};
const processDataForQperfBarChart = (
  reports: QperfReport[],
  metric: MetricKey,
) => {
  const categories: string[] = [];
  const barData: number[] = [];

  reports.forEach((report) => {
    categories.push(report.name);
    const perc = getPercentilesByMetric(report.data, metric);
    // Use the median (p50) value for the bar chart
    barData.push(perc.p50);
  });

  return { categories, barData };
};
// Create the ECharts option object for a bar chart
const createQperfBarChartOption = (
  reports: QperfReport[],
  metric: MetricKey,
  title: string,
) => {
  const { categories } = processDataForQperfBarChart(reports, metric);

  // Define label and tooltip formatting based on the metric being plotted
  let yAxisName = "";
  let unitSymbol = "";

  if (metric === "total_bandwidth") {
    yAxisName = "Megabits per second (Mbps)";
    unitSymbol = " Mbps";
  } else if (metric === "cpu_usage") {
    yAxisName = "Percentage (%)";
    unitSymbol = "%";
  }

  // Custom tooltip formatter that uses the machine-specific color and shows min, median and max
  const tooltipFormatter = function (params: {
    dataIndex: number;
    name: string;
    value: number;
    data: { custom: { min: number; median: number; max: number } };
  }) {
    const machineIndex = params.dataIndex;
    const machineColor = getMachineColor(machineIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    const { min, median, max } = params.data.custom;

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${params.name}</div>
              <div>${colorBox} Min: <strong>${min.toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Median: <strong>${median.toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Max: <strong>${max.toFixed(2)}${unitSymbol}</strong></div>
            </div>`;
  };

  const result = {
    title: {
      text: title,
      left: "center",
      textStyle: {
        fontWeight: "bold",
        fontSize: 16,
        fontFamily: "Arial, Helvetica, sans-serif",
      },
      padding: [10, 0, 20, 0],
    },
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.9)",
      borderWidth: 1,
      textStyle: {
        color: "#333",
      },
      extraCssText: "box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);",
    },
    animation: true,
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    grid: {
      left: "10%",
      right: "10%",
      bottom: "15%",
      top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: {
        show: true,
        interval: 0,
        rotate: categories.length > 5 ? 45 : 0,
        margin: 15,
        fontSize: 12,
      },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameTextStyle: {
        fontWeight: "bold",
        padding: [0, 0, 0, 40],
        fontSize: 13,
      },
      min: 0, // Always start from 0 for bar charts
      max: metric === "cpu_usage" ? 100 : undefined, // Set max to 100 for CPU usage
      axisLabel: {
        formatter: (value: number) => value.toFixed(2),
        fontSize: 12,
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: ["rgba(250,250,250,0.3)", "rgba(240,240,240,0.3)"],
        },
      },
    },
    series: [
      {
        type: "bar",
        data: reports.map((report, index) => {
          const perc = getPercentilesByMetric(report.data, metric);
          // Calculate min and max with an assumption similar to boxplots
          const min = perc.p25 * 0.9;
          const median = perc.p50;
          const max = perc.p75 * 1.1;
          return {
            value: median,
            custom: { min, median, max },
            itemStyle: {
              color: getMachineColor(index),
              borderRadius: [5, 5, 0, 0],
            },
            emphasis: {
              itemStyle: {
                color: getMachineColor(index) + "dd",
                borderWidth: 1,
                shadowBlur: 10,
                shadowColor: getMachineColor(index) + "80",
              },
            },
          };
        }),
        barWidth: "50%",
        label: {
          show: true,
          position: "top",
          formatter: (params: { value: number }) => params.value.toFixed(1),
          color: "#666",
          fontSize: 10,
        },
      },
    ],
  };

  return result;
};

// Bar chart component
export interface QperfBarChartProps {
  reports: QperfReport[];
  metric: MetricKey;
  title: string;
  height?: number;
}

export const QperfBarChart: Component<QperfBarChartProps> = (props) => {
  const option = createQperfBarChartOption(
    props.reports,
    props.metric,
    props.title,
  );
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
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "30px",
        padding: "20px",
        "background-color": "#f9f9f9",
        "border-radius": "10px",
      }}
    >
      <div
        style={{
          "background-color": "#fff",
          padding: "15px",
          "border-radius": "8px",
          "box-shadow": "0 0 10px rgba(0,0,0,0.05)",
        }}
      >
        <QperfBarChart
          reports={reports}
          metric="total_bandwidth"
          title="Total Bandwidth"
          height={height.totalBandwidth}
        />
      </div>
      <div style={{ display: "flex", gap: "30px" }}>
        <div
          style={{
            flex: 1,
            "background-color": "#fff",
            padding: "15px",
            "border-radius": "8px",
            "box-shadow": "0 0 10px rgba(0,0,0,0.05)",
          }}
        >
          <QperfBarChart
            reports={reports}
            metric="cpu_usage"
            title="CPU Usage"
            height={height.cpuUsage}
          />
        </div>
        <div
          style={{
            flex: 1,
            "background-color": "#fff",
            padding: "15px",
            "border-radius": "8px",
            "box-shadow": "0 0 10px rgba(0,0,0,0.05)",
          }}
        >
          <QperfBoxplotChart
            reports={reports}
            metric="ttfb"
            title="TTFB"
            height={height.ttfb}
          />
        </div>
      </div>
      <div
        style={{
          "background-color": "#fff",
          padding: "15px",
          "border-radius": "8px",
          "box-shadow": "0 0 10px rgba(0,0,0,0.05)",
        }}
      >
        <QperfBoxplotChart
          reports={reports}
          metric="conn_time"
          title="Connection Time"
          height={height.connTime}
        />
      </div>
    </div>
  );
};

export default QperfChartsDashboard;
