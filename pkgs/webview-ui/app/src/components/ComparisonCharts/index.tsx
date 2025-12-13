import { Echart } from "../Echarts";
import { Show } from "solid-js";
import {
  MetricStats,
  VpnComparisonResultMap,
  PingComparisonData,
  QperfComparisonData,
  TcpIperfComparisonData,
  UdpIperfComparisonData,
  VideoStreamingComparisonData,
  NixCacheComparisonData,
  ParallelTcpComparisonData,
  VpnComparisonError,
  CmdOutError,
  ClanError,
} from "@/src/benchData";

// --- Generic Bar Chart Component ---

interface BarChartData {
  name: string;
  value: number;
  min: number;
  max: number;
  isIncomplete?: boolean; // VPN exists but didn't complete this test
  isCrashed?: boolean; // True if benchmark crashed with error, false/undefined if not run
  errorMessage?: string; // Error message for failed VPNs
  machineName?: string; // Machine that failed (if applicable)
}

// Helper to get error message from comparison error
function getComparisonErrorMessage(error: VpnComparisonError): string {
  if (error.error_type === "CmdOut") {
    const cmdError = error.error as CmdOutError;
    if (cmdError.stderr.trim()) {
      return cmdError.stderr.trim().slice(0, 500);
    }
    if (cmdError.stdout.trim()) {
      return cmdError.stdout.trim().slice(0, 500);
    }
    return `Command failed with exit code ${cmdError.returncode}`;
  } else {
    const clanError = error.error as ClanError;
    return clanError.msg || clanError.description || "Unknown error";
  }
}

const createBarChartOption = (
  data: BarChartData[],
  title: string,
  yAxisLabel: string,
  color = "#1890ff",
  higherIsBetter?: boolean,
) => {
  // Sort by value for better visualization (incomplete items at end)
  const sortedData = [...data].sort((a, b) => {
    // Put incomplete items at the end
    if (a.isIncomplete && !b.isIncomplete) return 1;
    if (!a.isIncomplete && b.isIncomplete) return -1;
    return b.value - a.value;
  });

  // Calculate placeholder height for incomplete items
  const maxValue = Math.max(
    ...sortedData.filter((d) => !d.isIncomplete).map((d) => d.value),
    100,
  );
  const incompleteBarHeight = maxValue * 0.3;

  // Determine the subtitle based on metric direction
  const subtext =
    higherIsBetter !== undefined
      ? higherIsBetter
        ? "Higher is better"
        : "Lower is better"
      : undefined;

  return {
    title: {
      text: title,
      subtext: subtext,
      left: "center",
      subtextStyle: {
        color: "#888",
        fontSize: 12,
      },
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
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

        if (originalData.isIncomplete) {
          if (originalData.isCrashed) {
            // Crashed benchmark - show error details
            const machineInfo = originalData.machineName
              ? `<div style="font-size: 11px; color: #888; margin-top: 2px;">Machine: ${originalData.machineName}</div>`
              : "";
            const errorInfo = originalData.errorMessage
              ? `<div style="font-size: 12px; color: #666; margin-top: 4px; white-space: pre-wrap; word-break: break-word;">${originalData.errorMessage}</div>`
              : `<div style="font-size: 12px; color: #666; margin-top: 4px;">Benchmark crashed during execution</div>`;

            return `<div style="padding: 8px; max-width: 400px;">
                      <div style="font-weight: bold; color: #d32f2f;">
                        ⚠️ ${item.name} - CRASHED
                      </div>
                      ${machineInfo}
                      ${errorInfo}
                    </div>`;
          } else {
            // Not run benchmark - show neutral message
            return `<div style="padding: 8px; max-width: 400px;">
                      <div style="font-weight: bold; color: #666;">
                        ⊘ ${item.name} - NOT RUN
                      </div>
                      <div style="font-size: 12px; color: #888; margin-top: 4px;">
                        ${originalData.errorMessage || "Benchmark was not executed for this VPN"}
                      </div>
                    </div>`;
          }
        }

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
        data: sortedData.map((d) => {
          if (d.isIncomplete) {
            if (d.isCrashed) {
              // Crashed VPN - red-tinted diagonal pattern with warning icon
              return {
                value: incompleteBarHeight,
                itemStyle: {
                  color: {
                    type: "pattern",
                    image: (() => {
                      const canvas = document.createElement("canvas");
                      canvas.width = 10;
                      canvas.height = 10;
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        ctx.fillStyle = "#ffebee"; // Light red background
                        ctx.fillRect(0, 0, 10, 10);
                        ctx.strokeStyle = "#d32f2f"; // Red diagonal lines
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(0, 10);
                        ctx.lineTo(10, 0);
                        ctx.stroke();
                      }
                      return canvas;
                    })(),
                    repeat: "repeat",
                  },
                  borderColor: "#d32f2f",
                  borderWidth: 2,
                },
                label: {
                  show: true,
                  position: "top",
                  formatter: "⚠️",
                  fontSize: 14,
                },
              };
            } else {
              // Not run VPN - gray horizontal dashed pattern with N/A label
              return {
                value: incompleteBarHeight,
                itemStyle: {
                  color: {
                    type: "pattern",
                    image: (() => {
                      const canvas = document.createElement("canvas");
                      canvas.width = 10;
                      canvas.height = 10;
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        ctx.fillStyle = "#f5f5f5"; // Light gray background
                        ctx.fillRect(0, 0, 10, 10);
                        ctx.strokeStyle = "#9e9e9e"; // Gray horizontal dashed lines
                        ctx.lineWidth = 2;
                        ctx.setLineDash([3, 3]);
                        ctx.beginPath();
                        ctx.moveTo(0, 5);
                        ctx.lineTo(10, 5);
                        ctx.stroke();
                      }
                      return canvas;
                    })(),
                    repeat: "repeat",
                  },
                  borderColor: "#9e9e9e",
                  borderWidth: 2,
                  borderType: "dashed",
                },
                label: {
                  show: true,
                  position: "top",
                  formatter: "N/A",
                  fontSize: 11,
                  color: "#666",
                  fontWeight: "bold",
                },
              };
            }
          }
          // Normal VPN
          return {
            value: d.value,
            itemStyle: {
              color: color,
            },
            label: {
              show: true,
              position: "top",
              formatter: (params: { value: number }) => params.value.toFixed(1),
              color: "#555",
              fontSize: 10,
            },
          };
        }),
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
  higherIsBetter?: boolean;
}) => {
  return (
    <Show when={props.data.length > 0} fallback={<div>No data available</div>}>
      <Echart
        option={createBarChartOption(
          props.data,
          props.title,
          props.yAxisLabel,
          props.color,
          props.higherIsBetter,
        )}
        height={props.height ?? 400}
      />
    </Show>
  );
};

// --- Helper function to convert VPN comparison map to bar chart data ---

function metricToBarData<T>(
  vpnMap: VpnComparisonResultMap<T>,
  getMetric: (data: T) => MetricStats,
  allVpnNames?: string[],
): BarChartData[] {
  const result: BarChartData[] = [];

  // Process VPNs in the comparison data
  Object.entries(vpnMap).forEach(([vpnName, entry]) => {
    if (entry.status === "success") {
      // VPN completed successfully
      const metric = getMetric(entry.data);
      result.push({
        name: vpnName,
        value: metric.average,
        min: metric.min,
        max: metric.max,
        isIncomplete: false,
      });
    } else {
      // VPN failed/crashed - show error information
      result.push({
        name: vpnName,
        value: 0,
        min: 0,
        max: 0,
        isIncomplete: true,
        isCrashed: true,
        errorMessage: getComparisonErrorMessage(entry),
        machineName: entry.machine,
      });
    }
  });

  // Add VPNs that are completely missing from comparison data (not even attempted)
  if (allVpnNames) {
    const vpnsInData = new Set(Object.keys(vpnMap));
    allVpnNames.forEach((vpnName) => {
      if (!vpnsInData.has(vpnName)) {
        result.push({
          name: vpnName,
          value: 0,
          min: 0,
          max: 0,
          isIncomplete: true,
          isCrashed: false, // Not crashed, just not run
          errorMessage: "Benchmark not run for this VPN",
        });
      }
    });
  }

  return result;
}

// --- TCP Performance Comparison Charts ---

export const TcpThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(
      props.data,
      (d) => d.sender_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <ComparisonBarChart
      data={chartData()}
      title="TCP Throughput (Sender)"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
      higherIsBetter={true}
    />
  );
};

export const TcpReceiverThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(
      props.data,
      (d) => d.receiver_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <ComparisonBarChart
      data={chartData()}
      title="TCP Throughput (Receiver)"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#1890ff"
      higherIsBetter={true}
    />
  );
};

export const TcpRetransmitsComparisonChart = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.retransmits, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="TCP Retransmits"
      yAxisLabel="Retransmits"
      height={props.height ?? 400}
      color="#ff4d4f"
      higherIsBetter={false}
    />
  );
};

// --- UDP Performance Comparison Charts ---

export const UdpThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<UdpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(
      props.data,
      (d) => d.sender_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <ComparisonBarChart
      data={chartData()}
      title="UDP Throughput"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
      higherIsBetter={true}
    />
  );
};

export const UdpJitterComparisonChart = (props: {
  data: VpnComparisonResultMap<UdpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.jitter_ms, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="UDP Jitter"
      yAxisLabel="Jitter (ms)"
      height={props.height ?? 400}
      color="#faad14"
      higherIsBetter={false}
    />
  );
};

export const UdpPacketLossComparisonChart = (props: {
  data: VpnComparisonResultMap<UdpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.lost_percent, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="UDP Packet Loss"
      yAxisLabel="Loss (%)"
      height={props.height ?? 400}
      color="#ff4d4f"
      higherIsBetter={false}
    />
  );
};

// --- Ping Comparison Charts ---

export const PingLatencyComparisonChart = (props: {
  data: VpnComparisonResultMap<PingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.rtt_avg_ms, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Average RTT"
      yAxisLabel="RTT (ms)"
      height={props.height ?? 400}
      color="#1890ff"
      higherIsBetter={false}
    />
  );
};

export const PingJitterComparisonChart = (props: {
  data: VpnComparisonResultMap<PingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.rtt_mdev_ms, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="RTT Jitter (mdev)"
      yAxisLabel="Jitter (ms)"
      height={props.height ?? 400}
      color="#faad14"
      higherIsBetter={false}
    />
  );
};

export const PingPacketLossComparisonChart = (props: {
  data: VpnComparisonResultMap<PingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(
      props.data,
      (d) => d.packet_loss_percent,
      props.allVpnNames,
    );
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Packet Loss"
      yAxisLabel="Loss (%)"
      height={props.height ?? 400}
      color="#ff4d4f"
      higherIsBetter={false}
    />
  );
};

// --- QUIC/Qperf Comparison Charts ---

export const QperfBandwidthComparisonChart = (props: {
  data: VpnComparisonResultMap<QperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(
      props.data,
      (d) => d.total_bandwidth_mbps,
      props.allVpnNames,
    );
  return (
    <ComparisonBarChart
      data={chartData()}
      title="HTTP3 Bandwidth"
      yAxisLabel="Bandwidth (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
      higherIsBetter={true}
    />
  );
};

export const QperfTtfbComparisonChart = (props: {
  data: VpnComparisonResultMap<QperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.ttfb_ms, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Time to First Byte"
      yAxisLabel="TTFB (ms)"
      height={props.height ?? 400}
      color="#1890ff"
      higherIsBetter={false}
    />
  );
};

export const QperfCpuComparisonChart = (props: {
  data: VpnComparisonResultMap<QperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.cpu_usage_percent, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="CPU Usage"
      yAxisLabel="CPU (%)"
      height={props.height ?? 400}
      color="#faad14"
      higherIsBetter={false}
    />
  );
};

// --- Video Streaming Comparison Charts ---

export const VideoStreamingBitrateComparisonChart = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.bitrate_kbps, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Video Streaming Bitrate"
      yAxisLabel="Bitrate (kbps)"
      height={props.height ?? 400}
      color="#52c41a"
      higherIsBetter={true}
    />
  );
};

export const VideoStreamingFpsComparisonChart = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.fps, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Video Streaming FPS"
      yAxisLabel="FPS"
      height={props.height ?? 400}
      color="#1890ff"
      higherIsBetter={true}
    />
  );
};

export const VideoStreamingDroppedFramesComparisonChart = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.dropped_frames, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Dropped Frames"
      yAxisLabel="Frames"
      height={props.height ?? 400}
      color="#ff4d4f"
      higherIsBetter={false}
    />
  );
};

// --- Combined Dashboard Sections ---

export const TcpComparisonSection = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <TcpThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <TcpReceiverThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <TcpRetransmitsComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};

export const UdpComparisonSection = (props: {
  data: VpnComparisonResultMap<UdpIperfComparisonData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <UdpThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <UdpJitterComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <UdpPacketLossComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};

export const PingComparisonSection = (props: {
  data: VpnComparisonResultMap<PingComparisonData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <PingLatencyComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <PingJitterComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <PingPacketLossComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};

export const QperfComparisonSection = (props: {
  data: VpnComparisonResultMap<QperfComparisonData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <QperfBandwidthComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <QperfTtfbComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <QperfCpuComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};

export const VideoStreamingComparisonSection = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <VideoStreamingBitrateComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <VideoStreamingFpsComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <VideoStreamingDroppedFramesComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};

// --- Nix Cache Comparison Charts ---

export const NixCacheMeanTimeComparisonChart = (props: {
  data: VpnComparisonResultMap<NixCacheComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.mean_seconds, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Nix Cache Mean Download Time"
      yAxisLabel="Time (seconds)"
      height={props.height ?? 400}
      color="#722ed1"
      higherIsBetter={false}
    />
  );
};

export const NixCacheMinTimeComparisonChart = (props: {
  data: VpnComparisonResultMap<NixCacheComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.min_seconds, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Nix Cache Min Download Time"
      yAxisLabel="Time (seconds)"
      height={props.height ?? 400}
      color="#13c2c2"
      higherIsBetter={false}
    />
  );
};

export const NixCacheMaxTimeComparisonChart = (props: {
  data: VpnComparisonResultMap<NixCacheComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.max_seconds, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Nix Cache Max Download Time"
      yAxisLabel="Time (seconds)"
      height={props.height ?? 400}
      color="#eb2f96"
      higherIsBetter={false}
    />
  );
};

export const NixCacheComparisonSection = (props: {
  data: VpnComparisonResultMap<NixCacheComparisonData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <NixCacheMeanTimeComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <NixCacheMinTimeComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <NixCacheMaxTimeComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};

// --- Parallel TCP Comparison Charts ---

export const ParallelTcpTotalThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(
      props.data,
      (d) => d.total_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Parallel TCP Total Throughput"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
      higherIsBetter={true}
    />
  );
};

export const ParallelTcpAvgThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(
      props.data,
      (d) => d.avg_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Parallel TCP Average Throughput per Pair"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      color="#1890ff"
      higherIsBetter={true}
    />
  );
};

export const ParallelTcpRetransmitsComparisonChart = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.total_retransmits, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Parallel TCP Total Retransmits"
      yAxisLabel="Retransmits"
      height={props.height ?? 400}
      color="#fa8c16"
      higherIsBetter={false}
    />
  );
};

export const ParallelTcpComparisonSection = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "1fr 1fr",
        gap: "20px",
      }}
    >
      <ParallelTcpTotalThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <ParallelTcpAvgThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <ParallelTcpRetransmitsComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};
