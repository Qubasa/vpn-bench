import { Component, Show } from "solid-js";
/* eslint-disable  @typescript-eslint/no-explicit-any */


// Assuming Echart component is correctly imported and works with echarts options
import { Echart } from "../Echarts";
import * as echarts from "echarts";


interface QperfPercentiles {
  p25: number;
  p50: number;
  p75: number;
}

// Interface for the full stats of a single metric
interface QperfMetricStats {
  min: number;
  average: number;
  max: number;
  percentiles: QperfPercentiles;
}

// Interface for the main qperf benchmark data object
export interface QperfData {
  total_bandwidth_mbps: QperfMetricStats;
  cpu_usage_percent: QperfMetricStats;
  ttfb_ms: QperfMetricStats;
  conn_time_ms: QperfMetricStats;
}

// Interface for each machine's qperf report (remains the same)
export interface QperfReport {
  name: string;
  data: QperfData;
}

// --- Utility Types and Functions ---

// Define the supported metrics using keys from QperfData
type MetricKey = keyof QperfData; // Use keys directly

// Helper function to extract the appropriate full metric stats object
const getMetricStats = (
  data: QperfData,
  metric: MetricKey,
): QperfMetricStats => {
  // Check if the metric key exists in the data to avoid runtime errors
  if (!data || !(metric in data)) {
     console.error(`Metric key "${metric}" not found in qperf data:`, data);
     // Return a default structure to prevent downstream errors
      return { min: 0, average: 0, max: 0, percentiles: { p25: 0, p50: 0, p75: 0 } };
  }
  return data[metric];
};

// Calculate a five-number summary array for boxplot using actual min/max
const getBoxplotArray = (stats: QperfMetricStats): number[] => {
  // Format: [min, q1 (p25), median (p50), q3 (p75), max]
  return [
    stats.min,
    stats.percentiles.p25,
    stats.percentiles.p50,
    stats.percentiles.p75,
    stats.max,
  ];
};

// Process data for Boxplot (unchanged logic, uses updated helpers)
const processDataForQperfBoxplot = (
  reports: QperfReport[],
  metric: MetricKey,
) => {
  const categories: string[] = [];
  const boxplotData: number[][] = [];
  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getMetricStats(report.data, metric); // Get full stats
    boxplotData.push(getBoxplotArray(stats)); // Use actual min/max
  });
  return { categories, boxplotData };
};

// Process data for Bar Chart (Modified to use Average)
const processDataForQperfBarChart = (
  reports: QperfReport[],
  metric: MetricKey,
) => {
  const categories: string[] = [];
  const barData: number[] = []; // Will store average values
   const fullStatsList: QperfMetricStats[] = []; // Store full stats for tooltip

  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getMetricStats(report.data, metric);
    barData.push(stats.average); // Use the average value for the bar height
    fullStatsList.push(stats); // Keep stats for later use (tooltip)
  });
  return { categories, barData, fullStatsList };
};

// --- Color Palette and Styling (Unchanged) ---
const machineColorPalette = [
  "#3366FF", "#FF5733", "#33CC99", "#9966FF", "#FFCC33",
  "#FF6699", "#00CCCC", "#CC6633", "#6699CC", "#99CC33",
];
const getMachineColor = (machineIndex: number): string => {
  return machineColorPalette[machineIndex % machineColorPalette.length];
};
// getMachineColorScheme remains the same


// --- ECharts Option Creation Functions (Updated) ---

// Create ECharts option object for Boxplot (Tooltip Updated)
const createQperfBoxplotOption = (
  reports: QperfReport[],
  metric: MetricKey,
  title: string,
): echarts.EChartsOption | null => { // Return type can be EChartsOption or null
  if (!reports || reports.length === 0) return null;

  const { categories, boxplotData } = processDataForQperfBoxplot(reports, metric);
   if (categories.length === 0) return null; // No data to plot

  // Define label and tooltip formatting based on the metric being plotted
  let yAxisName = "";
  let unitSymbol = "";
  // Use a switch for clarity and exhaustiveness check if needed
  switch (metric) {
      case "total_bandwidth_mbps":
          yAxisName = "Megabits per second (Mbps)"; unitSymbol = " Mbps"; break;
      case "cpu_usage_percent":
          yAxisName = "Percentage (%)"; unitSymbol = "%"; break;
      case "ttfb_ms":
          yAxisName = "Milliseconds (ms)"; unitSymbol = " ms"; break;
      case "conn_time_ms":
          yAxisName = "Milliseconds (ms)"; unitSymbol = " ms"; break;
      default: // Should not happen with MetricKey type
          yAxisName = ""; unitSymbol = "";
  }

  // Custom tooltip formatter using actual data
  const tooltipFormatter = (params: any) => { // Use any or define specific ECharts param type
    if (params.componentType !== 'series' || params.seriesType !== 'boxplot') return '';
    const dataIndex = params.dataIndex; // Index corresponding to the report/category
    const categoryName = categories[dataIndex];
    const machineColor = getMachineColor(dataIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    // params.value should contain the [min, q1, median, q3, max] array
    const data: number[] = params.value;

    if (!data || data.length !== 5) return 'Data error';

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${categoryName}</div>
              <div>${colorBox} Max: <strong>${data[4].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q3 (P75): <strong>${data[3].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Median (P50): <strong>${data[2].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q1 (P25): <strong>${data[1].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Min: <strong>${data[0].toFixed(2)}${unitSymbol}</strong></div>
            </div>`;
  };

  // Create one boxplot series
  const seriesData: echarts.BoxplotSeriesOption[] = [
    {
      name: title, // Add series name for clarity
      type: "boxplot",
      data: boxplotData.map((data, index) => ({
        value: data,
        itemStyle: {
          borderWidth: 1.5,
          borderColor: getMachineColor(index),
          // Optional: Add fill color if desired
          // color: getMachineColor(index) + '33', // Example: Transparent fill
        },
        emphasis: {
          itemStyle: {
             borderWidth: 2.5,
             borderColor: getMachineColor(index),
             shadowColor: 'rgba(0, 0, 0, 0.3)',
             shadowBlur: 5
          }
        },
      })),
      boxWidth: [8, 40], // Min/max box width
      animationDelay: (idx: number) => idx * 50,
    },
  ];

  return { // Explicitly returning EChartsOption type
    title: {
      text: title,
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 }, // Adjusted style
      padding: [10, 0, 10, 0],
    },
    tooltip: {
      trigger: "item", // Trigger on the boxplot item
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.95)", // Slightly less transparent
      borderColor: '#ccc',
      borderWidth: 1,
      textStyle: { color: "#333" },
      extraCssText: "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);", // Updated shadow
      confine: true, // Keep tooltip within chart bounds
    },
    animation: true,
    toolbox: {
      feature: {
        saveAsImage: { title: 'Save Image' },
        dataView: { show: true, readOnly: false, title: 'View Data' },
      },
       orient: 'vertical', right: 10, top: 'center'
    },
    grid: {
      left: "10%", right: "12%", // Adjusted grid
      bottom: "10%", top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: true,
      nameGap: 25, // Adjust gap
      axisLabel: {
          interval: 0, // Show all labels
          rotate: reports.length > 6 ? 30 : 0, // Rotate if many reports
          fontSize: 11, // Smaller font size for labels
      },
      axisTick: { alignWithLabel: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameLocation: 'middle', // Center name
      nameGap: 40, // Adjust gap based on label length
      nameTextStyle: { fontWeight: "bold", fontSize: 13 },
      min: 0,
      // Dynamically adjust max based on data, ensuring some headroom
      max: (value: { max: number }) => value.max + (value.max * 0.1),
      splitArea: { show: false }, // Cleaner background
      splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }, // Subtle split lines
      axisLabel: {
        formatter: (value: number) => value.toFixed(metric === 'cpu_usage_percent' ? 1 : 2), // Less decimals for CPU %
        fontSize: 11,
      },
    },
    series: seriesData,
  };
};


// Create ECharts option object for Bar Chart (Average & Updated Tooltip)
const createQperfBarChartOption = (
  reports: QperfReport[],
  metric: MetricKey,
  title: string,
): echarts.EChartsOption | null => {
   if (!reports || reports.length === 0) return null;

  // Use the updated processing function
  const { categories, barData, fullStatsList } = processDataForQperfBarChart(reports, metric);
  if (categories.length === 0) return null;

  // Define label and tooltip formatting
  let yAxisName = "";
  let unitSymbol = "";
  let chartTitle = title; // Base title
   switch (metric) {
      case "total_bandwidth_mbps":
          yAxisName = "Megabits per second (Mbps)"; unitSymbol = " Mbps"; chartTitle = "Average Total Bandwidth"; break;
      case "cpu_usage_percent":
          yAxisName = "Percentage (%)"; unitSymbol = "%"; chartTitle = "Average CPU Usage"; break;
      // Add other cases if bar charts are used for them
      default: yAxisName = ""; unitSymbol = "";
   }

  // Custom tooltip formatter showing actual Min, Average, Max
  const tooltipFormatter = (params: any) => { // Use any or specific ECharts param type
    if (params.componentType !== 'series' || params.seriesType !== 'bar') return '';
    const dataIndex = params.dataIndex;
    const categoryName = categories[dataIndex];
    const machineColor = getMachineColor(dataIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    // Get the full stats stored during data processing
    const stats: QperfMetricStats | undefined = fullStatsList[dataIndex];

    if (!stats) return 'Data error';

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${categoryName}</div>
              <div>${colorBox} Average: <strong>${stats.average.toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Min: <small>${stats.min.toFixed(2)}${unitSymbol}</small></div>
              <div>${colorBox} Max: <small>${stats.max.toFixed(2)}${unitSymbol}</small></div>
              <div><small>(P25: ${stats.percentiles.p25.toFixed(2)}, P50: ${stats.percentiles.p50.toFixed(2)}, P75: ${stats.percentiles.p75.toFixed(2)})</small></div>
            </div>`;
  };

  return { // Explicitly returning EChartsOption type
    title: {
      text: chartTitle, // Use updated title
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 },
      padding: [10, 0, 10, 0],
    },
    tooltip: {
      trigger: "item", // Trigger on the bar item
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: '#ccc',
      borderWidth: 1,
      textStyle: { color: "#333" },
      extraCssText: "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);",
      confine: true,
    },
    animation: true,
     toolbox: {
      feature: {
        saveAsImage: { title: 'Save Image' },
        dataView: { show: true, readOnly: false, title: 'View Data' },
      },
       orient: 'vertical', right: 10, top: 'center'
    },
    grid: {
      left: "10%", right: "12%", bottom: "10%", top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: {
          interval: 0, rotate: reports.length > 6 ? 30 : 0, fontSize: 11
      },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameLocation: 'middle', nameGap: 40,
      nameTextStyle: { fontWeight: "bold", fontSize: 13 },
      min: 0,
      max: metric === "cpu_usage_percent" ? 100 : undefined, // Keep max 100 for CPU
      axisLabel: {
         formatter: (value: number) => value.toFixed(metric === 'cpu_usage_percent' ? 1 : 2), fontSize: 11
      },
      splitLine: { lineStyle: { type: 'dashed', color: '#eee' } },
    },
    series: [
      {
        name: chartTitle, // Series name matches title
        type: "bar",
        // Data is now the average value
        data: barData.map((avgValue, index) => ({
          value: avgValue,
          itemStyle: {
            color: getMachineColor(index),
            borderRadius: [3, 3, 0, 0], // Slight border radius
          },
          emphasis: {
            itemStyle: {
              // Use a slightly darker shade on hover
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                   { offset: 0, color: getMachineColor(index) + 'E0' }, // Darker top
                   { offset: 1, color: getMachineColor(index) + 'B0' }  // Darker bottom
               ])
            },
          },
        })),
        barWidth: "40%", // Adjust bar width
        label: {
          show: true,
          position: "top",
          formatter: (params: any) => parseFloat(params.value).toFixed(1), // Show average on top
          color: "#555", // Label color
          fontSize: 10,
        },
      },
    ],
  };
};

// --- SolidJS Components (Wrapper Components Unchanged) ---

export interface QperfBoxplotChartProps {
  reports: QperfReport[];
  metric: MetricKey;
  title: string;
  height?: number;
}

export const QperfBoxplotChart: Component<QperfBoxplotChartProps> = (props) => {
  // Use reactive computation if props can change, otherwise direct call is fine
  const option = () => createQperfBoxplotOption(props.reports, props.metric, props.title);
  // Provide a fallback message if option is null
  return (
      <Show when={option()} fallback={<div style={{ height: `${props.height || 500}px`, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#888' }}>Data unavailable for {props.title}.</div>}>
           {(opt) => <Echart option={opt()} height={props.height || 500} />}
      </Show>
  );
};

export interface QperfBarChartProps {
  reports: QperfReport[];
  metric: MetricKey;
  title: string; // Base title, will be adjusted in create function
  height?: number;
}

export const QperfBarChart: Component<QperfBarChartProps> = (props) => {
   // Use reactive computation
  const option = () => createQperfBarChartOption(props.reports, props.metric, props.title);
   return (
      <Show when={option()} fallback={<div style={{ height: `${props.height || 500}px`, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#888' }}>Data unavailable for {props.title}.</div>}>
           {(opt) => <Echart option={opt()} height={props.height || 500} />}
      </Show>
  );
};

// --- Main Dashboard Component (Structure Unchanged, uses updated charts) ---

export interface QperfChartsDashboardProps {
  reports: QperfReport[];
  height?: { // Optional height overrides
    totalBandwidth?: number;
    cpuUsage?: number;
    ttfb?: number;
    connTime?: number;
  };
}

export const QperfChartsDashboard: Component<QperfChartsDashboardProps> = (props) => {
  // Set default heights safely
  const effectiveHeights = {
    totalBandwidth: props.height?.totalBandwidth ?? 500,
    cpuUsage: props.height?.cpuUsage ?? 400, // Adjusted default
    ttfb: props.height?.ttfb ?? 400,         // Adjusted default
    connTime: props.height?.connTime ?? 450, // Adjusted default
  };

  // Basic check for reports
  if (!props.reports || props.reports.length === 0) {
      return <div style={{ padding: '20px', color: 'red', 'text-align': 'center' }}>No qperf report data provided.</div>;
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "20px", // Reduced gap slightly
        padding: "15px", // Reduced padding
        "background-color": "#f7f7f7", // Slightly lighter background
      }}
    >
      {/* Average Total Bandwidth (Bar Chart) */}
      <div style={{ "background-color": "#fff", padding: "10px", "border-radius": "6px", "box-shadow": "0 1px 3px rgba(0,0,0,0.05)" }}>
        <QperfBarChart
          reports={props.reports}
          metric="total_bandwidth_mbps"
          title="Total Bandwidth" // Base title, creator adds "Average"
          height={effectiveHeights.totalBandwidth}
        />
      </div>

       {/* Row for CPU (Bar) and TTFB (Boxplot) */}
      <div style={{ display: "flex", gap: "20px", "flex-wrap": "wrap" }}> {/* Allow wrapping */}
         {/* Average CPU Usage (Bar Chart) */}
        <div style={{ flex: "1 1 45%", "min-width": "300px", "background-color": "#fff", padding: "10px", "border-radius": "6px", "box-shadow": "0 1px 3px rgba(0,0,0,0.05)" }}>
          <QperfBarChart
            reports={props.reports}
            metric="cpu_usage_percent"
            title="CPU Usage" // Base title
            height={effectiveHeights.cpuUsage}
          />
        </div>
        {/* TTFB (Boxplot Chart) */}
        <div style={{ flex: "1 1 45%", "min-width": "300px", "background-color": "#fff", padding: "10px", "border-radius": "6px", "box-shadow": "0 1px 3px rgba(0,0,0,0.05)" }}>
          <QperfBoxplotChart
            reports={props.reports}
            metric="ttfb_ms"
            title="Time to First Byte (TTFB)" // More descriptive title
            height={effectiveHeights.ttfb}
          />
        </div>
      </div>

      {/* Connection Time (Boxplot Chart) */}
      <div style={{ "background-color": "#fff", padding: "10px", "border-radius": "6px", "box-shadow": "0 1px 3px rgba(0,0,0,0.05)" }}>
        <QperfBoxplotChart
          reports={props.reports}
          metric="conn_time_ms"
          title="Connection Establishment Time" // More descriptive title
          height={effectiveHeights.connTime}
        />
      </div>
    </div>
  );
};

export default QperfChartsDashboard;