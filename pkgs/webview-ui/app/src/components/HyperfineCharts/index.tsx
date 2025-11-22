import { Echart } from "../Echarts";

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

export interface HyperfineData {
  results: HyperfineResult[];
}

export interface HyperfineReport {
  name: string;
  data: HyperfineData;
}

interface HyperfineChartsProps {
  reports: HyperfineReport[];
  title?: string;
  height?: {
    meanTime?: number;
    distribution?: number;
    timeSeries?: number;
    cpuUsage?: number;
  };
}

// Mean Execution Time Chart Creator
const createMeanTimeOption = (reports: HyperfineReport[], title?: string) => {
  // Use original names for data mapping but formatted names for display
  const displayNames = reports.map((report) => report.name);
  const originalNames = reports.map((report) => report.name);
  const means = reports.map((report) => report.data.results[0].mean);
  const stdDevs = reports.map((report) => report.data.results[0].stddev);

  return {
    title: {
      text: title || "Mean Execution Time",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: { dataIndex: number }[]) {
        const dataIndex = params[0].dataIndex;
        const result = reports[dataIndex].data.results[0];
        return (
          `<b>${originalNames[dataIndex]}</b><br/>` +
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
      },
    },
    xAxis: {
      type: "category",
      data: displayNames,
      axisLabel: {
        rotate: 45,
        interval: 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Time (seconds)",
      min: 0, // Always start from 0

      axisLabel: {
        formatter: "{value}s",
      },
      splitLine: {
        show: true,
      },
    },
    series: [
      {
        name: "Mean Execution Time",
        type: "bar",
        data: means.map((mean, index) => ({
          value: mean.toFixed(2),
          itemStyle: {
            color: colorPalette[index % colorPalette.length],
          },
          // Add label on top of each bar
          label: {
            show: true,
            position: "top",
            formatter: "{c}s",
          },
        })),
        // Ensure no automatic markLines interfere with the bars
        markLine: {
          silent: true,
          data: [
            {
              type: "average",
              name: "Avg",
              lineStyle: { type: "dashed", width: 1 },
              label: { position: "end" },
            },
          ],
        },
      },
    ],
  };
};

// Time Series Chart Creator
const createTimeSeriesOption = (reports: HyperfineReport[], title?: string) => {
  // Use original names for data mapping but formatted names for display
  const originalNames = reports.map((report) => report.name);

  // Find the maximum number of runs across all results
  const maxRuns = Math.max(
    ...reports.map((report) => report.data.results[0].times.length),
  );
  const xAxisData = Array.from({ length: maxRuns }, (_, i) => `Run ${i + 1}`);

  return {
    title: {
      text: title ? `${title} - Individual Run Times` : "Individual Run Times",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
      },
    },
    legend: {
      data: originalNames,
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
      min: 0, // Always start from 0
    },
    series: reports.map((report, idx) => ({
      name: originalNames[idx],
      type: "line",
      data: report.data.results[0].times.map((time) => time.toFixed(2)),
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

      color: colorPalette[idx % colorPalette.length],
    })),
  };
};

// Individual chart components - using props pattern for SolidJS reactivity
export const HyperfineMeanTimeChart = (props: {
  reports: HyperfineReport[];
  title?: string;
  height?: number;
}) => {
  return (
    <Echart
      option={createMeanTimeOption(props.reports, props.title)}
      height={props.height || 400}
    />
  );
};

export const HyperfineTimeSeriesChart = (props: {
  reports: HyperfineReport[];
  title?: string;
  height?: number;
}) => {
  return (
    <Echart
      option={createTimeSeriesOption(props.reports, props.title)}
      height={props.height || 400}
    />
  );
};

// Combined dashboard component - using props pattern for SolidJS reactivity
export const HyperfineCharts = (props: HyperfineChartsProps) => {
  // Create reactive getters for height values with defaults
  const height = () => ({
    meanTime: props.height?.meanTime || 400,
    distribution: props.height?.distribution || 400,
    timeSeries: props.height?.timeSeries || 500,
    cpuUsage: props.height?.cpuUsage || 400,
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <div style={{ flex: 1 }}>
        <HyperfineMeanTimeChart
          reports={props.reports}
          title={props.title}
          height={height().meanTime}
        />
      </div>
      <div style={{ flex: 1 }}>
        <HyperfineTimeSeriesChart
          reports={props.reports}
          title={props.title}
          height={height().timeSeries}
        />
      </div>
    </div>
  );
};
