import { Echart } from "../Echarts";
import { Show } from "solid-js";

export type ConnectionData = Record<string, string>;

export type ConnectionTimings = Record<string, ConnectionData>;

// Convert time string (H:MM:SS.MS) to milliseconds
const timeToMs = (timeStr: string) => {
  if (!timeStr || typeof timeStr !== "string") {
    return NaN; // Will be filtered out later
  }

  try {
    const parts = timeStr.split(":");
    if (parts.length !== 3) {
      return NaN;
    }

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      return NaN;
    }

    return (hours * 60 * 60 + minutes * 60 + seconds) * 1000;
  } catch (e) {
    return NaN;
  }
};

// Process data for boxplot visualization
const processDataForBoxplot = (report: ConnectionTimings) => {
  const services = Object.keys(report);
  const boxplotData = [];
  const categories = [];

  for (const service of services) {
    // Get time values and ensure we have valid data
    const timeValues = Object.values(report[service]);
    if (timeValues.length === 0) {
      continue; // Skip empty services
    }

    // Convert and filter out any invalid times
    const timings = timeValues
      .map((time) => {
        try {
          return timeToMs(time);
        } catch (e) {
          console.warn(`Invalid time format for service ${service}:`, time);
          return null;
        }
      })
      .filter(
        (time) => time !== null && !isNaN(time) && isFinite(time),
      ) as number[];

    // Skip if we don't have valid timings
    if (timings.length === 0) {
      console.warn(`No valid timing data for service ${service}`);
      continue;
    }

    // Sort for calculations
    timings.sort((a, b) => a - b);

    // Calculate boxplot statistics safely
    const min = timings[0];
    const max = timings[timings.length - 1];

    let median;
    if (timings.length === 1) {
      median = timings[0];
    } else if (timings.length % 2 === 0) {
      median =
        (timings[timings.length / 2 - 1] + timings[timings.length / 2]) / 2;
    } else {
      median = timings[Math.floor(timings.length / 2)];
    }

    // Q1 and Q3 calculation with better handling of small datasets
    let q1, q3;
    if (timings.length <= 2) {
      q1 = min;
      q3 = max;
    } else {
      q1 = timings[Math.floor(timings.length / 4)];
      q3 = timings[Math.floor((3 * timings.length) / 4)];
    }

    boxplotData.push([min, q1, median, q3, max]);
    categories.push(service);
  }

  return { boxplotData, categories };
};

const createConnectionTimingsOption = (
  report: ConnectionTimings,
  title: string,
) => {
  const { boxplotData, categories } = processDataForBoxplot(report);

  // Add raw data points as scatter plot
  const scatterData: (string | number)[][] = [];
  for (let i = 0; i < categories.length; i++) {
    const service = categories[i];
    const nodeData = report[service];

    Object.entries(nodeData).forEach(([node, timeStr]) => {
      try {
        const ms = timeToMs(timeStr);
        if (!isNaN(ms) && isFinite(ms)) {
          scatterData.push([i, ms, node]); // [category index, value, node name]
        }
      } catch (e) {
        console.warn(`Could not process node ${node} for service ${service}`);
      }
    });
  }

  return {
    title: {
      text: title,
      left: "center",
    },
    tooltip: {
      trigger: "item",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: {
        seriesIndex: number;
        name: string;
        data: number[];
      }) {
        if (params.seriesIndex === 0) {
          // Boxplot tooltip
          return `${params.name}<br/>
                 Min: ${(params.data[0] / 1000).toFixed(2)}s<br/>
                 Q1: ${(params.data[1] / 1000).toFixed(2)}s<br/>
                 Median: ${(params.data[2] / 1000).toFixed(2)}s<br/>
                 Q3: ${(params.data[3] / 1000).toFixed(2)}s<br/>
                 Max: ${(params.data[4] / 1000).toFixed(2)}s`;
        } else {
          // Scatter tooltip
          return `${categories[params.data[0]]}<br/>
                 Node: ${params.data[2]}<br/>
                 Time: ${(params.data[1] / 1000).toFixed(2)}s`;
        }
      },
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
      name: "Time (seconds)",
      splitArea: {
        show: true,
      },
      axisLabel: {
        formatter: function (value: number) {
          return (value / 1000).toFixed(1) + "s";
        },
      },
    },
    series: [
      {
        name: "Connection Times",
        type: "boxplot",
        data: boxplotData,
        tooltip: { trigger: "item" },
        itemStyle: {
          borderWidth: 2,
          borderColor: "#1890ff",
        },
      },
      {
        name: "Nodes",
        type: "scatter",
        data: scatterData,
        symbolSize: 10,
        itemStyle: {
          color: "#ff5722",
        },
      },
    ],
  };
};

export const ConnectionTimingsChart = ({
  report,
  height = 700,
  title,
}: {
  report: ConnectionTimings;
  height?: number;
  title: string;
}) => {
  return (
    <Echart
      option={createConnectionTimingsOption(report, title)}
      height={height}
    />
  );
};

interface GeneralDashboardProps {
  bootstrap_connection_timings: ConnectionTimings | undefined;
  reboot_connection_timings: ConnectionTimings | undefined;
}

export const GeneralDashboard = ({
  bootstrap_connection_timings,
  reboot_connection_timings,
}: GeneralDashboardProps) => {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <Show when={bootstrap_connection_timings}>
        {(timings) => (
          <ConnectionTimingsChart
            report={timings()}
            height={700}
            title="Bootstrap Connection Times"
          />
        )}
      </Show>
      <Show when={reboot_connection_timings}>
        {(timings) => (
          <ConnectionTimingsChart
            report={timings()}
            height={700}
            title="Reboot Connection Times"
          />
        )}
      </Show>
    </div>
  );
};
