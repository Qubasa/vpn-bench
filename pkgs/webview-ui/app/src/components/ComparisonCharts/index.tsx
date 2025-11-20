import { Echart } from "../Echarts";
import { Show } from "solid-js";
import {
  MetricStats,
  VpnComparisonMap,
  PingComparisonData,
  QperfComparisonData,
  TcpIperfComparisonData,
  UdpIperfComparisonData,
  VideoStreamingComparisonData,
} from "@/src/benchData";

// --- Generic Bar Chart Component ---

interface BarChartData {
  name: string;
  value: number;
  min: number;
  max: number;
}

const createBarChartOption = (
  data: BarChartData[],
  title: string,
  yAxisLabel: string,
  color = "#1890ff",
) => {
  // Sort by value for better visualization
  const sortedData = [...data].sort((a, b) => b.value - a.value);

  return {
    title: {
      text: title,
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (
        params: { name: string; value: number; dataIndex: number }[],
      ) {
        const item = params[0];
        const originalData = sortedData[item.dataIndex];
        return `${item.name}<br/>
                Average: ${originalData.value.toFixed(2)}<br/>
                Min: ${originalData.min.toFixed(2)}<br/>
                Max: ${originalData.max.toFixed(2)}`;
      },
    },
    grid: {
      left: "15%",
      right: "10%",
      bottom: "15%",
      top: "15%",
    },
    xAxis: {
      type: "category",
      data: sortedData.map((d) => d.name),
      axisLabel: {
        rotate: 45,
        interval: 0,
      },
    },
    yAxis: {
      type: "value",
      name: yAxisLabel,
      nameLocation: "middle",
      nameGap: 50,
    },
    series: [
      {
        name: title,
        type: "bar",
        data: sortedData.map((d) => d.value),
        itemStyle: {
          color: color,
        },
        // Add error bars for min/max
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: {
            color: "#999",
          },
        },
      },
    ],
  };
};

export const ComparisonBarChart = (props: {
  data: BarChartData[];
  title: string;
  yAxisLabel: string;
  height?: number;
  color?: string;
}) => {
  return (
    <Show when={props.data.length > 0} fallback={<div>No data available</div>}>
      <Echart
        option={createBarChartOption(
          props.data,
          props.title,
          props.yAxisLabel,
          props.color,
        )}
        height={props.height ?? 400}
      />
    </Show>
  );
};

// --- Helper function to convert VPN comparison map to bar chart data ---

function metricToBarData<T>(
  vpnMap: VpnComparisonMap<T>,
  getMetric: (data: T) => MetricStats,
): BarChartData[] {
  return Object.entries(vpnMap).map(([vpnName, data]) => {
    const metric = getMetric(data);
    return {
      name: vpnName,
      value: metric.average,
      min: metric.min,
      max: metric.max,
    };
  });
}

// --- TCP Performance Comparison Charts ---

export const TcpThroughputComparisonChart = (props: {
  data: VpnComparisonMap<TcpIperfComparisonData>;
  height?: number;
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.sender_throughput_mbps);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="TCP Throughput (Sender)"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
    />
  );
};

export const TcpReceiverThroughputComparisonChart = (props: {
  data: VpnComparisonMap<TcpIperfComparisonData>;
  height?: number;
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.receiver_throughput_mbps);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="TCP Throughput (Receiver)"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#1890ff"
    />
  );
};

export const TcpRetransmitsComparisonChart = (props: {
  data: VpnComparisonMap<TcpIperfComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.retransmits);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="TCP Retransmits"
      yAxisLabel="Retransmits"
      height={props.height ?? 400}
      color="#ff4d4f"
    />
  );
};

// --- UDP Performance Comparison Charts ---

export const UdpThroughputComparisonChart = (props: {
  data: VpnComparisonMap<UdpIperfComparisonData>;
  height?: number;
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.sender_throughput_mbps);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="UDP Throughput"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
    />
  );
};

export const UdpJitterComparisonChart = (props: {
  data: VpnComparisonMap<UdpIperfComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.jitter_ms);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="UDP Jitter"
      yAxisLabel="Jitter (ms)"
      height={props.height ?? 400}
      color="#faad14"
    />
  );
};

export const UdpPacketLossComparisonChart = (props: {
  data: VpnComparisonMap<UdpIperfComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.lost_percent);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="UDP Packet Loss"
      yAxisLabel="Loss (%)"
      height={props.height ?? 400}
      color="#ff4d4f"
    />
  );
};

// --- Ping Comparison Charts ---

export const PingLatencyComparisonChart = (props: {
  data: VpnComparisonMap<PingComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.rtt_avg_ms);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Average RTT"
      yAxisLabel="RTT (ms)"
      height={props.height ?? 400}
      color="#1890ff"
    />
  );
};

export const PingJitterComparisonChart = (props: {
  data: VpnComparisonMap<PingComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.rtt_mdev_ms);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="RTT Jitter (mdev)"
      yAxisLabel="Jitter (ms)"
      height={props.height ?? 400}
      color="#faad14"
    />
  );
};

export const PingPacketLossComparisonChart = (props: {
  data: VpnComparisonMap<PingComparisonData>;
  height?: number;
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.packet_loss_percent);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Packet Loss"
      yAxisLabel="Loss (%)"
      height={props.height ?? 400}
      color="#ff4d4f"
    />
  );
};

// --- QUIC/Qperf Comparison Charts ---

export const QperfBandwidthComparisonChart = (props: {
  data: VpnComparisonMap<QperfComparisonData>;
  height?: number;
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.total_bandwidth_mbps);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="QUIC Bandwidth"
      yAxisLabel="Bandwidth (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
    />
  );
};

export const QperfTtfbComparisonChart = (props: {
  data: VpnComparisonMap<QperfComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.ttfb_ms);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Time to First Byte"
      yAxisLabel="TTFB (ms)"
      height={props.height ?? 400}
      color="#1890ff"
    />
  );
};

export const QperfCpuComparisonChart = (props: {
  data: VpnComparisonMap<QperfComparisonData>;
  height?: number;
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.cpu_usage_percent);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="CPU Usage"
      yAxisLabel="CPU (%)"
      height={props.height ?? 400}
      color="#faad14"
    />
  );
};

// --- Video Streaming Comparison Charts ---

export const VideoStreamingBitrateComparisonChart = (props: {
  data: VpnComparisonMap<VideoStreamingComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.bitrate_kbps);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Video Streaming Bitrate"
      yAxisLabel="Bitrate (kbps)"
      height={props.height ?? 400}
      color="#52c41a"
    />
  );
};

export const VideoStreamingFpsComparisonChart = (props: {
  data: VpnComparisonMap<VideoStreamingComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.fps);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Video Streaming FPS"
      yAxisLabel="FPS"
      height={props.height ?? 400}
      color="#1890ff"
    />
  );
};

export const VideoStreamingDroppedFramesComparisonChart = (props: {
  data: VpnComparisonMap<VideoStreamingComparisonData>;
  height?: number;
}) => {
  const chartData = () => metricToBarData(props.data, (d) => d.dropped_frames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Dropped Frames"
      yAxisLabel="Frames"
      height={props.height ?? 400}
      color="#ff4d4f"
    />
  );
};

// --- Combined Dashboard Sections ---

export const TcpComparisonSection = (props: {
  data: VpnComparisonMap<TcpIperfComparisonData>;
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <TcpThroughputComparisonChart data={props.data} />
      <TcpReceiverThroughputComparisonChart data={props.data} />
      <TcpRetransmitsComparisonChart data={props.data} />
    </div>
  );
};

export const UdpComparisonSection = (props: {
  data: VpnComparisonMap<UdpIperfComparisonData>;
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <UdpThroughputComparisonChart data={props.data} />
      <UdpJitterComparisonChart data={props.data} />
      <UdpPacketLossComparisonChart data={props.data} />
    </div>
  );
};

export const PingComparisonSection = (props: {
  data: VpnComparisonMap<PingComparisonData>;
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <PingLatencyComparisonChart data={props.data} />
      <PingJitterComparisonChart data={props.data} />
      <PingPacketLossComparisonChart data={props.data} />
    </div>
  );
};

export const QperfComparisonSection = (props: {
  data: VpnComparisonMap<QperfComparisonData>;
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <QperfBandwidthComparisonChart data={props.data} />
      <QperfTtfbComparisonChart data={props.data} />
      <QperfCpuComparisonChart data={props.data} />
    </div>
  );
};

export const VideoStreamingComparisonSection = (props: {
  data: VpnComparisonMap<VideoStreamingComparisonData>;
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <VideoStreamingBitrateComparisonChart data={props.data} />
      <VideoStreamingFpsComparisonChart data={props.data} />
      <VideoStreamingDroppedFramesComparisonChart data={props.data} />
    </div>
  );
};
