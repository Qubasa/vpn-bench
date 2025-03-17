import { Echart } from "../Echarts";
import { Show } from "solid-js";

export type ConnectionData = Record<string, string>;

export type ConnectionTimings = Record<string, ConnectionData>;

// Convert time string (H:MM:SS.MS) to milliseconds
const timeToMs = (timeStr: string) => {
  const parts = timeStr.split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);

  return (hours * 60 * 60 + minutes * 60 + seconds) * 1000;
};

// Process data for boxplot visualization
const processDataForBoxplot = (report: ConnectionTimings) => {
  const services = Object.keys(report);
  const boxplotData = [];
  const categories = [];

  for (const service of services) {
    if (service === "default") {
      continue;
    }
    const timings = Object.values(report[service]).map((time) =>
      timeToMs(time),
    );

    // For boxplot we need: [min, Q1, median, Q3, max]
    timings.sort((a, b) => a - b);
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    const median =
      timings.length % 2 === 0
        ? (timings[timings.length / 2 - 1] + timings[timings.length / 2]) / 2
        : timings[Math.floor(timings.length / 2)];

    // Simple Q1 and Q3 calculation
    const q1 =
      timings.length > 1 ? timings[Math.floor(timings.length / 4)] : min;
    const q3 =
      timings.length > 1 ? timings[Math.floor((3 * timings.length) / 4)] : max;

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
      const ms = timeToMs(timeStr);
      scatterData.push([i, ms, node]); // [category index, value, node name]
    });
  }
  console.log(scatterData);
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
        <ConnectionTimingsChart
          report={bootstrap_connection_timings!}
          height={700}
          title="Bootstrap Connection Times"
        />
      </Show>
      {/* <Show when={reboot_connection_timings}>
        <ConnectionTimingsChart
          report={reboot_connection_timings!}
          height={700}
          title="Reboot Connection Times"
        />
      </Show> */}
    </div>
  );
};
