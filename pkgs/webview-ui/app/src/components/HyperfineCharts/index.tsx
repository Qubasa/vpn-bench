import { debug } from "console";
import { Echart } from "../Echarts";

// Define interfaces for hyperfine result data
export interface HyperfineResult {
  command: string;
  mean: number;
  stddev: number;
  median: number;
  user: number;
  system: number;
  min: number;
  max: number;
  times: number[];
  exit_codes: number[];
  parameters: Record<string, string>;
}

export interface HyperfineResults {
  results: HyperfineResult[];
}

interface HyperfineChartsProps {
  data: HyperfineResults;
  title?: string;
  height?: {
    meanTime?: number;
    distribution?: number;
    timeSeries?: number;
    cpuUsage?: number;
  };
}

// Helper function to extract a readable name from command or parameters
const extractName = (result: HyperfineResult): string => {
  // Try to extract from parameters first
  if (result.parameters && result.parameters.url) {
    return result.parameters.url.split("//")[1] || result.parameters.url;
  }

  // Fallback to shortened command
  const command = result.command;
  const parts = command.split(" ");
  if (parts.length > 2) {
    // Try to find meaningful parts like URLs or filenames
    for (const part of parts) {
      if (part.includes("://")) {
        return part.split("//")[1] || part;
      }
    }
  }
  return command.length > 30 ? command.substring(0, 30) + "..." : command;
};

// Mean Execution Time Chart Creator
const createMeanTimeOption = (data: HyperfineResults, title?: string) => {
  const names = data.results.map((result) => extractName(result));
  const means = data.results.map((result) => result.mean);
  const stdDevs = data.results.map((result) => result.stddev);

  return {
    title: {
      text: title || "Mean Execution Time Comparison",
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: { dataIndex: number }[]) {
        const dataIndex = params[0].dataIndex;
        const result = data.results[dataIndex];
        return (
          `<b>${names[dataIndex]}</b><br/>` +
          `Mean: ${result.mean.toFixed(3)}s<br/>` +
          `Median: ${result.median.toFixed(3)}s<br/>` +
          `StdDev: ${result.stddev.toFixed(3)}s<br/>` +
          `Min: ${result.min.toFixed(3)}s<br/>` +
          `Max: ${result.max.toFixed(3)}s`
        );
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
      data: names,
      axisLabel: {
        rotate: 45,
        interval: 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Time (seconds)",
      min: "dataMin",
    },
    series: [
      {
        name: "Mean Execution Time",
        type: "bar",
        data: means,
        itemStyle: {
          color: "#3498db",
        },
        markLine: {
          data: [{ type: "average", name: "Avg" }],
        },
        // Add error bars for standard deviation
        markPoint: {
          symbol: "pin",
          symbolSize: 40,
          data: data.results.map((result, index) => ({
            name: "Best",
            value: result.min.toFixed(3) + "s",
            xAxis: index,
            yAxis: result.min,
            itemStyle: { color: "#2ecc71" },
          })),
        },
        error: {
          show: true,
          width: 5,
          type: "data",
          representation: "line",
          data: stdDevs,
        },
      },
    ],
  };
};

// Box Plot Distribution Chart Creator
const createDistributionOption = (data: HyperfineResults, title?: string) => {
  // Prepare data for boxplot
  const boxData = data.results.map((result) => {
    // Calculate quartiles for box plot
    const sortedTimes = [...result.times].sort((a, b) => a - b);
    const q1Index = Math.floor(sortedTimes.length / 4);
    const q3Index = Math.floor((sortedTimes.length * 3) / 4);

    return [
      result.min, // min
      sortedTimes[q1Index], // Q1
      result.median, // median
      sortedTimes[q3Index], // Q3
      result.max, // max
    ];
  });

  return {
    title: {
      text: title
        ? `${title} - Time Distribution`
        : "Execution Time Distribution",
      left: "center",
    },
    tooltip: {
      trigger: "item",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: {
        componentSubType: string;
        dataIndex: number;
        data: number[];
        name: any;
        value: number;
      }) {
        if (params.componentSubType === "boxplot") {
          return (
            `<b>${extractName(data.results[params.dataIndex])}</b><br/>` +
            `Min: ${params.data[0].toFixed(3)}s<br/>` +
            `Q1: ${params.data[1].toFixed(3)}s<br/>` +
            `Median: ${params.data[2].toFixed(3)}s<br/>` +
            `Q3: ${params.data[3].toFixed(3)}s<br/>` +
            `Max: ${params.data[4].toFixed(3)}s`
          );
        } else {
          return `${params.name}: ${params.value.toFixed(3)}s`;
        }
      },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "15%",
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
      data: data.results.map((result) => extractName(result)),
      axisLabel: {
        rotate: 45,
        interval: 0,
      },
      boundaryGap: true,
      nameGap: 30,
      splitArea: {
        show: false,
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "value",
      name: "Time (seconds)",
      min: "dataMin",
      splitArea: {
        show: true,
      },
    },
    series: [
      {
        name: "Execution Time",
        type: "boxplot",
        data: boxData,
        tooltip: { formatter: "{b}: {c}" },
        itemStyle: {
          color: "#3498db",
        },
      },
      {
        name: "Outliers",
        type: "scatter",
        data: data.results.flatMap((result, idx) => {
          // Calculate Q1, Q3 and IQR for outlier detection
          const sortedTimes = [...result.times].sort((a, b) => a - b);
          const q1 = sortedTimes[Math.floor(sortedTimes.length / 4)];
          const q3 = sortedTimes[Math.floor((sortedTimes.length * 3) / 4)];
          const iqr = q3 - q1;
          const lowerBound = q1 - 1.5 * iqr;
          const upperBound = q3 + 1.5 * iqr;

          return result.times
            .filter((time) => time < lowerBound || time > upperBound)
            .map((time) => [idx, time]);
        }),
        itemStyle: {
          color: "#e74c3c",
        },
      },
    ],
  };
};

// Time Series Chart Creator
const createTimeSeriesOption = (data: HyperfineResults, title?: string) => {
  const names = data.results.map((result) => extractName(result));
  const colorPalette = [
    "#3498db",
    "#2ecc71",
    "#e74c3c",
    "#f39c12",
    "#9b59b6",
    "#1abc9c",
    "#d35400",
    "#34495e",
  ];

  // Find the maximum number of runs across all results
  const maxRuns = Math.max(
    ...data.results.map((result) => result.times.length),
  );
  const xAxisData = Array.from({ length: maxRuns }, (_, i) => `Run ${i + 1}`);

  return {
    title: {
      text: title ? `${title} - Individual Run Times` : "Individual Run Times",
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
      },
    },
    legend: {
      data: names,
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "15%",
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
      data: xAxisData,
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      name: "Time (seconds)",
      min: "dataMin",
    },
    series: data.results.map((result, idx) => ({
      name: names[idx],
      type: "line",
      data: result.times,
      symbolSize: 8,
      emphasis: {
        itemStyle: {
          borderWidth: 2,
        },
      },
      markPoint: {
        data: [
          { type: "min", name: "Min" },
          { type: "max", name: "Max" },
        ],
      },
      markLine: {
        data: [{ type: "average", name: "Average" }],
      },
      color: colorPalette[idx % colorPalette.length],
    })),
  };
};

// CPU Usage Chart Creator
const createCpuUsageOption = (data: HyperfineResults, title?: string) => {
  const names = data.results.map((result) => extractName(result));

  return {
    title: {
      text: title ? `${title} - CPU Usage` : "CPU Usage",
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: { dataIndex: number }[]) {
        const dataIndex = params[0].dataIndex;
        const result = data.results[dataIndex];
        const totalCpu = result.user + result.system;
        return (
          `<b>${names[dataIndex]}</b><br/>` +
          `User CPU: ${result.user.toFixed(2)}s (${((result.user / totalCpu) * 100).toFixed(1)}%)<br/>` +
          `System CPU: ${result.system.toFixed(2)}s (${((result.system / totalCpu) * 100).toFixed(1)}%)<br/>` +
          `Total CPU: ${totalCpu.toFixed(2)}s<br/>` +
          `Mean execution: ${result.mean.toFixed(2)}s`
        );
      },
    },
    legend: {
      data: ["User CPU", "System CPU"],
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "15%",
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
      data: names,
      axisLabel: {
        rotate: 45,
        interval: 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Time (seconds)",
    },
    series: [
      {
        name: "User CPU",
        type: "bar",
        stack: "total",
        data: data.results.map((result) => result.user),
        color: "#3498db",
      },
      {
        name: "System CPU",
        type: "bar",
        stack: "total",
        data: data.results.map((result) => result.system),
        color: "#e74c3c",
      },
    ],
  };
};

// Individual chart components
export const HyperfineMeanTimeChart = ({
  data,
  title,
  height = 400,
}: {
  data: HyperfineResults;
  title?: string;
  height?: number;
}) => {

  return <Echart option={createMeanTimeOption(data, title)} height={height} />;
};

export const HyperfineDistributionChart = ({
  data,
  title,
  height = 400,
}: {
  data: HyperfineResults;
  title?: string;
  height?: number;
}) => {
  return (
    <Echart option={createDistributionOption(data, title)} height={height} />
  );
};

export const HyperfineTimeSeriesChart = ({
  data,
  title,
  height = 400,
}: {
  data: HyperfineResults;
  title?: string;
  height?: number;
}) => {
  return (
    <Echart option={createTimeSeriesOption(data, title)} height={height} />
  );
};

export const HyperfineCpuUsageChart = ({
  data,
  title,
  height = 400,
}: {
  data: HyperfineResults;
  title?: string;
  height?: number;
}) => {
  return <Echart option={createCpuUsageOption(data, title)} height={height} />;
};

// Combined dashboard component
export const HyperfineCharts = ({
  data,
  title,
  height = {
    meanTime: 400,
    distribution: 400,
    timeSeries: 500,
    cpuUsage: 400,
  },
}: HyperfineChartsProps) => {


  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <div style={{ flex: 1 }}>
      <HyperfineMeanTimeChart
        data={data}
        title={title}
        height={height.meanTime}
      />
      </div>
      <div style={{ flex: 1 }}>
      <HyperfineDistributionChart
        data={data}
        title={title}
        height={height.distribution}
      />
      </div>
      <div style={{ flex: 1 }}>
      <HyperfineTimeSeriesChart
        data={data}
        title={title}
        height={height.timeSeries}
      />
      </div>
      <div style={{ flex: 1 }}>
      <HyperfineCpuUsageChart
        data={data}
        title={title}
        height={height.cpuUsage}
      />
      </div>
    </div>
  );
};

// Example usage
/*
import hyperfineResults from "@/bench/hyperfine/nix-copy-results.json";

export const BenchmarkViewer = () => {
  return (
    <HyperfineCharts 
      data={hyperfineResults} 
      title="Nix Copy Performance Comparison"
      height={{
        meanTime: 400,
        distribution: 400,
        timeSeries: 500,
        cpuUsage: 400
      }}
    />
  );
};
*/
