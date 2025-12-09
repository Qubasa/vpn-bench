import { Show } from "solid-js";
import { Echart } from "../Echarts";

// Define interfaces for typing
interface MetricStats {
  min: number;
  average: number;
  max: number;
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
  };
}

export interface PingData {
  rtt_min_ms: MetricStats;
  rtt_avg_ms: MetricStats;
  rtt_max_ms: MetricStats;
  rtt_mdev_ms: MetricStats;
  packet_loss_percent: MetricStats;
}

// Combined report interface with name and data
export interface PingReport {
  name: string;
  data: PingData;
}

interface PingChartsProps {
  reports: PingReport[];
  height?: {
    rttBoxplot?: number;
    rttMetrics?: number;
    packetLoss?: number;
    jitter?: number;
  };
}

// RTT Boxplot Chart - showing distribution of RTT metrics
const createRttBoxplotOption = (reports: PingReport[]) => {
  const boxplotData = reports.map((report) => {
    const avgMetric = report.data.rtt_avg_ms;
    // Create boxplot from percentiles: [min, p25, p50, p75, max]
    return [
      avgMetric.min,
      avgMetric.percentiles.p25,
      avgMetric.percentiles.p50,
      avgMetric.percentiles.p75,
      avgMetric.max,
    ];
  });

  const categoryNames = reports.map((r) => r.name);

  return {
    title: {
      text: "Round Trip Time Distribution (Average RTT)",
    },
    tooltip: {
      trigger: "item",
      formatter: function (params: {
        name: string;
        data: [number, number, number, number, number];
        marker: string;
      }) {
        const boxData = params.data;
        return `${params.marker}${params.name}<br/>
                Min: ${boxData[0].toFixed(3)} ms<br/>
                P25: ${boxData[1].toFixed(3)} ms<br/>
                Median: ${boxData[2].toFixed(3)} ms<br/>
                P75: ${boxData[3].toFixed(3)} ms<br/>
                Max: ${boxData[4].toFixed(3)} ms`;
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
      data: categoryNames,
      axisLabel: {
        rotate: 45,
      },
    },
    yAxis: {
      type: "value",
      name: "RTT (ms)",
    },
    series: [
      {
        name: "RTT Distribution",
        type: "boxplot",
        data: boxplotData,
      },
    ],
  };
};

// RTT Metrics Comparison Chart - comparing min/avg/max/mdev across VPNs
const createRttMetricsOption = (reports: PingReport[]) => {
  const categoryNames = reports.map((r) => r.name);

  const rttMinData = reports.map((r) => r.data.rtt_min_ms.average.toFixed(3));
  const rttAvgData = reports.map((r) => r.data.rtt_avg_ms.average.toFixed(3));
  const rttMaxData = reports.map((r) => r.data.rtt_max_ms.average.toFixed(3));
  const rttMdevData = reports.map((r) => r.data.rtt_mdev_ms.average.toFixed(3));

  return {
    title: {
      text: "RTT Metrics Comparison",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    legend: {
      data: ["Min RTT", "Avg RTT", "Max RTT", "Jitter (mdev)"],
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
      data: categoryNames,
      axisLabel: {
        rotate: 45,
      },
    },
    yAxis: {
      type: "value",
      name: "RTT (ms)",
    },
    series: [
      {
        name: "Min RTT",
        type: "bar",
        data: rttMinData,
      },
      {
        name: "Avg RTT",
        type: "bar",
        data: rttAvgData,
      },
      {
        name: "Max RTT",
        type: "bar",
        data: rttMaxData,
      },
      {
        name: "Jitter (mdev)",
        type: "bar",
        data: rttMdevData,
      },
    ],
  };
};

// Packet Loss Chart
const createPacketLossOption = (reports: PingReport[]) => {
  const categoryNames = reports.map((r) => r.name);
  const packetLossData = reports.map((r) =>
    r.data.packet_loss_percent.average.toFixed(2),
  );

  return {
    title: {
      text: "Packet Loss Percentage",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (
        params: { name: string; value: string; marker: string }[],
      ) {
        const point = params[0];
        return `${point.marker}${point.name}<br/>Packet Loss: ${point.value}%`;
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
      data: categoryNames,
      axisLabel: {
        rotate: 45,
      },
    },
    yAxis: {
      type: "value",
      name: "Packet Loss (%)",
      min: 0,
    },
    series: [
      {
        name: "Packet Loss",
        type: "bar",
        data: packetLossData,
        itemStyle: {
          color: "#ff6b6b",
        },
      },
    ],
  };
};

// Jitter (mdev) Chart - dedicated chart for jitter analysis
const createJitterOption = (reports: PingReport[]) => {
  const boxplotData = reports.map((report) => {
    const jitterMetric = report.data.rtt_mdev_ms;
    // Create boxplot from percentiles: [min, p25, p50, p75, max]
    return [
      jitterMetric.min,
      jitterMetric.percentiles.p25,
      jitterMetric.percentiles.p50,
      jitterMetric.percentiles.p75,
      jitterMetric.max,
    ];
  });

  const categoryNames = reports.map((r) => r.name);

  return {
    title: {
      text: "Jitter Distribution (RTT Standard Deviation)",
    },
    tooltip: {
      trigger: "item",
      formatter: function (params: {
        name: string;
        data: [number, number, number, number, number];
        marker: string;
      }) {
        const boxData = params.data;
        return `${params.marker}${params.name}<br/>
                Min: ${boxData[0].toFixed(3)} ms<br/>
                P25: ${boxData[1].toFixed(3)} ms<br/>
                Median: ${boxData[2].toFixed(3)} ms<br/>
                P75: ${boxData[3].toFixed(3)} ms<br/>
                Max: ${boxData[4].toFixed(3)} ms`;
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
      data: categoryNames,
      axisLabel: {
        rotate: 45,
      },
    },
    yAxis: {
      type: "value",
      name: "Jitter (ms)",
    },
    series: [
      {
        name: "Jitter Distribution",
        type: "boxplot",
        data: boxplotData,
      },
    ],
  };
};

export const PingCharts = (props: PingChartsProps) => {
  const height = {
    rttBoxplot: props.height?.rttBoxplot || 400,
    rttMetrics: props.height?.rttMetrics || 400,
    packetLoss: props.height?.packetLoss || 400,
    jitter: props.height?.jitter || 400,
  };

  // Check if we have valid data
  const hasData = () => props.reports && props.reports.length > 0;

  return (
    <Show
      when={hasData()}
      fallback={
        <div
          style={{
            background: "#f9f9f9",
            border: "1px solid #e0e0e0",
            "border-radius": "8px",
            padding: "20px",
            "text-align": "center",
            color: "#555",
            "font-size": "16px",
            margin: "1rem 0",
          }}
        >
          <p style={{ margin: 0 }}>
            No ping latency data available. Run the benchmark to generate ping
            data.
          </p>
        </div>
      }
    >
      <div>
        <Echart
          option={createRttBoxplotOption(props.reports)}
          height={height.rttBoxplot}
        />
        <Echart
          option={createRttMetricsOption(props.reports)}
          height={height.rttMetrics}
        />
        <Echart
          option={createJitterOption(props.reports)}
          height={height.jitter}
        />
        <Echart
          option={createPacketLossOption(props.reports)}
          height={height.packetLoss}
        />
      </div>
    </Show>
  );
};
