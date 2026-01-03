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
  BenchmarkStatsData,
  TimeBreakdownData,
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
    if (cmdError.msg) {
      return cmdError.msg;
    }
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
  labelFormatter: (value: number) => string = (v) => v.toFixed(1),
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
              formatter: (params: { value: number }) =>
                labelFormatter(params.value),
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
  labelFormatter?: (value: number) => string;
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
          props.labelFormatter,
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

// --- Dual Series Bar Chart for Sender/Receiver ---

interface DualBarChartData {
  name: string;
  senderValue: number;
  senderMin: number;
  senderMax: number;
  receiverValue: number;
  receiverMin: number;
  receiverMax: number;
  isIncomplete?: boolean;
  isCrashed?: boolean;
  errorMessage?: string;
  machineName?: string;
}

function metricsToDualBarData<T>(
  vpnMap: VpnComparisonResultMap<T>,
  getSenderMetric: (data: T) => MetricStats,
  getReceiverMetric: (data: T) => MetricStats,
  allVpnNames?: string[],
): DualBarChartData[] {
  const result: DualBarChartData[] = [];

  Object.entries(vpnMap).forEach(([vpnName, entry]) => {
    if (entry.status === "success") {
      const senderMetric = getSenderMetric(entry.data);
      const receiverMetric = getReceiverMetric(entry.data);
      result.push({
        name: vpnName,
        senderValue: senderMetric.average,
        senderMin: senderMetric.min,
        senderMax: senderMetric.max,
        receiverValue: receiverMetric.average,
        receiverMin: receiverMetric.min,
        receiverMax: receiverMetric.max,
        isIncomplete: false,
      });
    } else {
      result.push({
        name: vpnName,
        senderValue: 0,
        senderMin: 0,
        senderMax: 0,
        receiverValue: 0,
        receiverMin: 0,
        receiverMax: 0,
        isIncomplete: true,
        isCrashed: true,
        errorMessage: getComparisonErrorMessage(entry),
        machineName: entry.machine,
      });
    }
  });

  if (allVpnNames) {
    const vpnsInData = new Set(Object.keys(vpnMap));
    allVpnNames.forEach((vpnName) => {
      if (!vpnsInData.has(vpnName)) {
        result.push({
          name: vpnName,
          senderValue: 0,
          senderMin: 0,
          senderMax: 0,
          receiverValue: 0,
          receiverMin: 0,
          receiverMax: 0,
          isIncomplete: true,
          isCrashed: false,
          errorMessage: "Benchmark not run for this VPN",
        });
      }
    });
  }

  return result;
}

const createDualBarChartOption = (
  data: DualBarChartData[],
  title: string,
  yAxisLabel: string,
  firstColor = "#52c41a",
  secondColor = "#1890ff",
  firstLabel = "Sender",
  secondLabel = "Receiver",
  labelFormatter: (value: number) => string = (v) => v.toFixed(1),
) => {
  // Sort by average of both values for better visualization (incomplete items at end)
  const sortedData = [...data].sort((a, b) => {
    if (a.isIncomplete && !b.isIncomplete) return 1;
    if (!a.isIncomplete && b.isIncomplete) return -1;
    const aAvg = (a.senderValue + a.receiverValue) / 2;
    const bAvg = (b.senderValue + b.receiverValue) / 2;
    return bAvg - aAvg;
  });

  const maxValue = Math.max(
    ...sortedData
      .filter((d) => !d.isIncomplete)
      .flatMap((d) => [d.senderValue, d.receiverValue]),
    100,
  );
  const incompleteBarHeight = maxValue * 0.3;

  return {
    title: {
      text: title,
      subtext: "Higher is better",
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: function (params: any) {
        const tooltipParams = Array.isArray(params) ? params : [params];
        if (!tooltipParams || tooltipParams.length === 0) return "";
        const dataIndex = tooltipParams[0].dataIndex;
        const item = sortedData[dataIndex];

        if (item.isIncomplete) {
          if (item.isCrashed) {
            const machineInfo = item.machineName
              ? `<div style="font-size: 11px; color: #888; margin-top: 2px;">Machine: ${item.machineName}</div>`
              : "";
            const errorInfo = item.errorMessage
              ? `<div style="font-size: 12px; color: #666; margin-top: 4px; white-space: pre-wrap; word-break: break-word;">${item.errorMessage}</div>`
              : `<div style="font-size: 12px; color: #666; margin-top: 4px;">Benchmark crashed during execution</div>`;
            return `<div style="padding: 8px; max-width: 400px;">
                      <div style="font-weight: bold; color: #d32f2f;">⚠️ ${item.name} - CRASHED</div>
                      ${machineInfo}${errorInfo}
                    </div>`;
          } else {
            return `<div style="padding: 8px; max-width: 400px;">
                      <div style="font-weight: bold; color: #666;">⊘ ${item.name} - NOT RUN</div>
                      <div style="font-size: 12px; color: #888; margin-top: 4px;">
                        ${item.errorMessage || "Benchmark was not executed for this VPN"}
                      </div>
                    </div>`;
          }
        }

        let tooltipText = `<b>${item.name}</b><br/>`;
        tooltipText += `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${firstColor};margin-right:5px;"></span>`;
        tooltipText += `${firstLabel}: ${item.senderValue.toFixed(2)} (Min: ${item.senderMin.toFixed(2)}, Max: ${item.senderMax.toFixed(2)})<br/>`;
        tooltipText += `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${secondColor};margin-right:5px;"></span>`;
        tooltipText += `${secondLabel}: ${item.receiverValue.toFixed(2)} (Min: ${item.receiverMin.toFixed(2)}, Max: ${item.receiverMax.toFixed(2)})`;
        return tooltipText;
      },
    },
    legend: {
      data: [firstLabel, secondLabel],
      top: 50,
    },
    grid: {
      left: "15%",
      right: "10%",
      bottom: "50px",
      top: "20%",
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
        name: firstLabel,
        type: "bar",
        color: firstColor,
        data: sortedData.map((d) => {
          if (d.isIncomplete) {
            return {
              value: incompleteBarHeight,
              itemStyle: {
                color: d.isCrashed ? "#ffebee" : "#f5f5f5",
                borderColor: d.isCrashed ? "#d32f2f" : "#9e9e9e",
                borderWidth: 2,
              },
            };
          }
          return {
            value: d.senderValue,
            itemStyle: { color: firstColor },
          };
        }),
        label: {
          show: true,
          position: "top",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter: (params: any) => {
            const item = sortedData[params.dataIndex];
            if (item.isIncomplete) return item.isCrashed ? "⚠️" : "N/A";
            return labelFormatter(params.value);
          },
          fontSize: 10,
        },
      },
      {
        name: secondLabel,
        type: "bar",
        color: secondColor,
        data: sortedData.map((d) => {
          if (d.isIncomplete) {
            return {
              value: incompleteBarHeight,
              itemStyle: {
                color: d.isCrashed ? "#ffebee" : "#f5f5f5",
                borderColor: d.isCrashed ? "#d32f2f" : "#9e9e9e",
                borderWidth: 2,
              },
            };
          }
          return {
            value: d.receiverValue,
            itemStyle: { color: secondColor },
          };
        }),
        label: {
          show: true,
          position: "top",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter: (params: any) => {
            const item = sortedData[params.dataIndex];
            if (item.isIncomplete) return "";
            return labelFormatter(params.value);
          },
          fontSize: 10,
        },
      },
    ],
  };
};

export const DualComparisonBarChart = (props: {
  data: DualBarChartData[];
  title: string;
  yAxisLabel: string;
  height?: number;
  firstColor?: string;
  secondColor?: string;
  firstLabel?: string;
  secondLabel?: string;
  labelFormatter?: (value: number) => string;
}) => {
  return (
    <Show when={props.data.length > 0} fallback={<div>No data available</div>}>
      <Echart
        option={createDualBarChartOption(
          props.data,
          props.title,
          props.yAxisLabel,
          props.firstColor,
          props.secondColor,
          props.firstLabel,
          props.secondLabel,
          props.labelFormatter,
        )}
        height={props.height ?? 400}
      />
    </Show>
  );
};

// --- TCP Performance Comparison Charts ---

export const TcpThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => d.sender_throughput_mbps,
      (d) => d.receiver_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="TCP Throughput"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      firstColor="#52c41a"
      secondColor="#1890ff"
      labelFormatter={(v) => v.toFixed(0)}
    />
  );
};

export const TcpRetransmitsComparisonChart = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.retransmit_percent, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="TCP Retransmit Rate"
      yAxisLabel="Retransmit Rate (%)"
      height={props.height ?? 400}
      color="#ff4d4f"
      higherIsBetter={false}
      labelFormatter={(v) => v.toFixed(2) + "%"}
    />
  );
};

export const TcpWindowSizeComparisonChart = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => ({
        ...d.max_snd_wnd_bytes,
        average: d.max_snd_wnd_bytes.average / 1024, // Convert to KB
        min: d.max_snd_wnd_bytes.min / 1024,
        max: d.max_snd_wnd_bytes.max / 1024,
      }),
      (d) => ({
        ...d.max_snd_cwnd_bytes,
        average: d.max_snd_cwnd_bytes.average / 1024,
        min: d.max_snd_cwnd_bytes.min / 1024,
        max: d.max_snd_cwnd_bytes.max / 1024,
      }),
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="Max TCP Window Size"
      yAxisLabel="Size (KB)"
      height={props.height ?? 400}
      firstColor="#f39c12"
      secondColor="#9b59b6"
      firstLabel="Send Window"
      secondLabel="Congestion Window"
      labelFormatter={(v) => v.toFixed(0)}
    />
  );
};

export const TcpTotalDataComparisonChart = (props: {
  data: VpnComparisonResultMap<TcpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => ({
        ...d.total_bytes_sent,
        average: d.total_bytes_sent.average / 1_000_000_000, // Convert to GB
        min: d.total_bytes_sent.min / 1_000_000_000,
        max: d.total_bytes_sent.max / 1_000_000_000,
      }),
      (d) => ({
        ...d.total_bytes_received,
        average: d.total_bytes_received.average / 1_000_000_000,
        min: d.total_bytes_received.min / 1_000_000_000,
        max: d.total_bytes_received.max / 1_000_000_000,
      }),
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="Total Data Transferred"
      yAxisLabel="Data (GB)"
      height={props.height ?? 400}
      firstColor="#722ed1"
      secondColor="#13c2c2"
      firstLabel="Sent"
      secondLabel="Received"
    />
  );
};

// --- Helper to get test duration from comparison data ---

function getTestDuration<T extends { duration_seconds: MetricStats }>(
  data: VpnComparisonResultMap<T>,
): number | null {
  for (const entry of Object.values(data)) {
    if (entry.status === "success") {
      return entry.data.duration_seconds.average;
    }
  }
  return null;
}

// --- Test Info Banner Component ---

const TestInfoBanner = (props: { durationSeconds: number | null }) => {
  if (props.durationSeconds === null) return null;

  return (
    <div
      style={{
        background: "#f0f5ff",
        border: "1px solid #adc6ff",
        "border-radius": "6px",
        padding: "12px 16px",
        "margin-bottom": "16px",
        display: "flex",
        "align-items": "center",
        gap: "8px",
      }}
    >
      <span style={{ "font-weight": "500", color: "#1890ff" }}>Run Time:</span>
      <span style={{ color: "#333" }}>{props.durationSeconds.toFixed(1)}s</span>
    </div>
  );
};

// --- UDP Performance Comparison Charts ---

export const UdpThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<UdpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => d.sender_throughput_mbps,
      (d) => d.receiver_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="UDP Throughput"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      firstColor="#52c41a"
      secondColor="#1890ff"
      labelFormatter={(v) => v.toFixed(0)}
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
      labelFormatter={(v) => v.toFixed(2) + "%"}
    />
  );
};

export const UdpTotalDataComparisonChart = (props: {
  data: VpnComparisonResultMap<UdpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => ({
        ...d.total_bytes_sent,
        average: d.total_bytes_sent.average / 1_000_000_000, // Convert to GB
        min: d.total_bytes_sent.min / 1_000_000_000,
        max: d.total_bytes_sent.max / 1_000_000_000,
      }),
      (d) => ({
        ...d.total_bytes_received,
        average: d.total_bytes_received.average / 1_000_000_000,
        min: d.total_bytes_received.min / 1_000_000_000,
        max: d.total_bytes_received.max / 1_000_000_000,
      }),
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="Total Data Transferred"
      yAxisLabel="Data (GB)"
      height={props.height ?? 400}
      firstColor="#722ed1"
      secondColor="#13c2c2"
      firstLabel="Sent"
      secondLabel="Received"
    />
  );
};

export const UdpPacketSizeComparisonChart = (props: {
  data: VpnComparisonResultMap<UdpIperfComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.blksize_bytes, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="UDP Payload Size"
      yAxisLabel="Bytes"
      height={props.height ?? 400}
      color="#fa8c16"
      labelFormatter={(v) => `${v.toFixed(0)} B`}
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
      labelFormatter={(v) => v.toFixed(2) + "%"}
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
      title="QUIC Bandwidth"
      yAxisLabel="Bandwidth (Mbps)"
      height={props.height ?? 400}
      color="#52c41a"
      higherIsBetter={true}
      labelFormatter={(v) => v.toFixed(0)}
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
      labelFormatter={(v) => v.toFixed(2) + "%"}
    />
  );
};

// --- Video Streaming Comparison Charts ---

// Metadata info box for static encoding settings
const VideoStreamingMetadataBox = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
}) => {
  // Extract encoding metadata from the first successful VPN result
  const metadata = () => {
    for (const entry of Object.values(props.data)) {
      if (entry.status === "success") {
        return {
          bitrate: entry.data.bitrate_kbps?.average ?? 0,
          fps: entry.data.fps?.average ?? 0,
          droppedFrames: entry.data.dropped_frames?.average ?? 0,
        };
      }
    }
    return null;
  };

  const data = metadata();
  if (!data) return null;

  return (
    <div
      style={{
        background: "#f6ffed",
        border: "1px solid #b7eb8f",
        "border-radius": "6px",
        padding: "12px 16px",
        "margin-bottom": "16px",
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <span style={{ "font-weight": "500", color: "#52c41a" }}>
          Target Bitrate:
        </span>
        <span style={{ color: "#333" }}>{data.bitrate.toFixed(0)} kbps</span>
      </div>
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <span style={{ "font-weight": "500", color: "#52c41a" }}>
          Target FPS:
        </span>
        <span style={{ color: "#333" }}>{data.fps.toFixed(0)} fps</span>
      </div>
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <span style={{ "font-weight": "500", color: "#52c41a" }}>
          Encoding Overhead:
        </span>
        <span style={{ color: "#333" }}>
          {data.droppedFrames.toFixed(0)} frames
        </span>
      </div>
    </div>
  );
};

// Dynamic network metric charts
export const VideoStreamingQualityChart = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.quality, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="RIST Quality"
      yAxisLabel="Quality (%)"
      height={props.height ?? 400}
      color="#52c41a"
      higherIsBetter={true}
    />
  );
};

export const VideoStreamingRttChart = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.rtt_ms, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="RIST Round Trip Time"
      yAxisLabel="RTT (ms)"
      height={props.height ?? 400}
      color="#1890ff"
      higherIsBetter={false}
    />
  );
};

export const VideoStreamingPacketsRecoveredChart = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.packets_recovered, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Packets Recovered"
      yAxisLabel="Packets"
      height={props.height ?? 400}
      color="#faad14"
      higherIsBetter={false}
    />
  );
};

export const VideoStreamingPacketsDroppedChart = (props: {
  data: VpnComparisonResultMap<VideoStreamingComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.packets_dropped, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Packets Dropped"
      yAxisLabel="Packets"
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
  const duration = () => getTestDuration(props.data);
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "20px",
      }}
    >
      <TestInfoBanner durationSeconds={duration()} />
      <TcpThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <TcpTotalDataComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <TcpRetransmitsComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <TcpWindowSizeComparisonChart
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
  const duration = () => getTestDuration(props.data);
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "20px",
      }}
    >
      <TestInfoBanner durationSeconds={duration()} />
      <UdpThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <UdpTotalDataComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <UdpPacketSizeComparisonChart
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
        display: "flex",
        "flex-direction": "column",
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
        display: "flex",
        "flex-direction": "column",
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
        display: "flex",
        "flex-direction": "column",
        gap: "20px",
      }}
    >
      <VideoStreamingMetadataBox data={props.data} />
      <VideoStreamingQualityChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <VideoStreamingRttChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <VideoStreamingPacketsRecoveredChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <VideoStreamingPacketsDroppedChart
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
    <NixCacheMeanTimeComparisonChart
      data={props.data}
      allVpnNames={props.allVpnNames}
    />
  );
};

// --- Parallel TCP Comparison Charts ---

export const ParallelTcpThroughputComparisonChart = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => d.sender_throughput_mbps,
      (d) => d.receiver_throughput_mbps,
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="Parallel TCP Throughput"
      yAxisLabel="Throughput (Mbps)"
      height={props.height ?? 400}
      firstColor="#52c41a"
      secondColor="#1890ff"
      labelFormatter={(v) => v.toFixed(0)}
    />
  );
};

export const ParallelTcpRetransmitsComparisonChart = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricToBarData(props.data, (d) => d.retransmit_percent, props.allVpnNames);
  return (
    <ComparisonBarChart
      data={chartData()}
      title="Parallel TCP Retransmit Rate"
      yAxisLabel="Retransmit Rate (%)"
      height={props.height ?? 400}
      color="#fa8c16"
      higherIsBetter={false}
      labelFormatter={(v) => v.toFixed(2) + "%"}
    />
  );
};

export const ParallelTcpWindowSizeComparisonChart = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => ({
        ...d.max_snd_wnd_bytes,
        average: d.max_snd_wnd_bytes.average / 1024, // Convert to KB
        min: d.max_snd_wnd_bytes.min / 1024,
        max: d.max_snd_wnd_bytes.max / 1024,
      }),
      (d) => ({
        ...d.max_snd_cwnd_bytes,
        average: d.max_snd_cwnd_bytes.average / 1024,
        min: d.max_snd_cwnd_bytes.min / 1024,
        max: d.max_snd_cwnd_bytes.max / 1024,
      }),
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="Parallel TCP Max Window Size"
      yAxisLabel="Size (KB)"
      height={props.height ?? 400}
      firstColor="#f39c12"
      secondColor="#9b59b6"
      firstLabel="Send Window"
      secondLabel="Congestion Window"
      labelFormatter={(v) => v.toFixed(0)}
    />
  );
};

export const ParallelTcpTotalDataComparisonChart = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () =>
    metricsToDualBarData(
      props.data,
      (d) => ({
        ...d.total_bytes_sent,
        average: d.total_bytes_sent.average / 1_000_000_000, // Convert to GB
        min: d.total_bytes_sent.min / 1_000_000_000,
        max: d.total_bytes_sent.max / 1_000_000_000,
      }),
      (d) => ({
        ...d.total_bytes_received,
        average: d.total_bytes_received.average / 1_000_000_000,
        min: d.total_bytes_received.min / 1_000_000_000,
        max: d.total_bytes_received.max / 1_000_000_000,
      }),
      props.allVpnNames,
    );
  return (
    <DualComparisonBarChart
      data={chartData()}
      title="Total Data Transferred"
      yAxisLabel="Data (GB)"
      height={props.height ?? 400}
      firstColor="#722ed1"
      secondColor="#13c2c2"
      firstLabel="Sent"
      secondLabel="Received"
    />
  );
};

export const ParallelTcpComparisonSection = (props: {
  data: VpnComparisonResultMap<ParallelTcpComparisonData>;
  allVpnNames?: string[];
}) => {
  const duration = () => getTestDuration(props.data);
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "20px",
      }}
    >
      <TestInfoBanner durationSeconds={duration()} />
      <ParallelTcpThroughputComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <ParallelTcpTotalDataComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <ParallelTcpRetransmitsComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <ParallelTcpWindowSizeComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
    </div>
  );
};

// --- Benchmark Stats Charts ---

interface SimpleBarData {
  vpnName: string;
  value: number;
  hasError: boolean;
}

// Helper to extract simple numeric values from benchmark stats
const statsToBarData = (
  data: VpnComparisonResultMap<BenchmarkStatsData>,
  extractor: (d: BenchmarkStatsData) => number,
  allVpnNames?: string[],
): SimpleBarData[] => {
  const vpnNames = allVpnNames ?? Object.keys(data);
  return vpnNames.map((vpn) => {
    const entry = data[vpn];
    if (!entry || entry.status !== "success") {
      return { vpnName: vpn, value: 0, hasError: true };
    }
    const value = extractor(entry.data);
    return { vpnName: vpn, value, hasError: false };
  });
};

export const TestDurationComparisonChart = (props: {
  data: VpnComparisonResultMap<BenchmarkStatsData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  // Create a stacked bar chart showing all test type durations, sorted by total duration
  const chartData = () => {
    const vpnNames = props.allVpnNames ?? Object.keys(props.data);

    // Build data for each VPN with total duration for sorting
    const vpnData = vpnNames.map((vpn) => {
      const entry = props.data[vpn];
      if (entry?.status === "success") {
        const tcp = entry.data.tcp_test_duration_seconds.average;
        const udp = entry.data.udp_test_duration_seconds.average;
        const parallelTcp =
          entry.data.parallel_tcp_test_duration_seconds.average;
        const ping = entry.data.ping_test_duration_seconds.average;
        const qperf = entry.data.qperf_test_duration_seconds.average;
        const video = entry.data.video_test_duration_seconds.average;
        const nixCache = entry.data.nix_cache_test_duration_seconds.average;
        const total = tcp + udp + parallelTcp + ping + qperf + video + nixCache;
        return {
          vpn,
          tcp,
          udp,
          parallelTcp,
          ping,
          qperf,
          video,
          nixCache,
          total,
        };
      } else {
        return {
          vpn,
          tcp: 0,
          udp: 0,
          parallelTcp: 0,
          ping: 0,
          qperf: 0,
          video: 0,
          nixCache: 0,
          total: 0,
        };
      }
    });

    // Sort by total duration descending
    vpnData.sort((a, b) => b.total - a.total);

    // Calculate grand total across all VPNs
    const grandTotal = vpnData.reduce((sum, d) => sum + d.total, 0);

    return {
      vpnNames: vpnData.map((d) => d.vpn),
      tcpData: vpnData.map((d) => d.tcp),
      udpData: vpnData.map((d) => d.udp),
      parallelTcpData: vpnData.map((d) => d.parallelTcp),
      pingData: vpnData.map((d) => d.ping),
      qperfData: vpnData.map((d) => d.qperf),
      videoData: vpnData.map((d) => d.video),
      nixCacheData: vpnData.map((d) => d.nixCache),
      grandTotalHours: grandTotal / 3600,
    };
  };

  // Check if a series has any non-zero values
  const hasData = (arr: number[]) => arr.some((v) => v > 0);

  const option = () => {
    const data = chartData();

    // Build series array, only including tests with data
    const series: {
      name: string;
      type: string;
      stack: string;
      data: number[];
      itemStyle: { color: string };
    }[] = [];
    const legendData: string[] = [];

    if (hasData(data.tcpData)) {
      series.push({
        name: "TCP",
        type: "bar",
        stack: "duration",
        data: data.tcpData,
        itemStyle: { color: "#1890ff" },
      });
      legendData.push("TCP");
    }
    if (hasData(data.udpData)) {
      series.push({
        name: "UDP",
        type: "bar",
        stack: "duration",
        data: data.udpData,
        itemStyle: { color: "#52c41a" },
      });
      legendData.push("UDP");
    }
    if (hasData(data.parallelTcpData)) {
      series.push({
        name: "Parallel TCP",
        type: "bar",
        stack: "duration",
        data: data.parallelTcpData,
        itemStyle: { color: "#722ed1" },
      });
      legendData.push("Parallel TCP");
    }
    if (hasData(data.pingData)) {
      series.push({
        name: "Ping",
        type: "bar",
        stack: "duration",
        data: data.pingData,
        itemStyle: { color: "#fa8c16" },
      });
      legendData.push("Ping");
    }
    if (hasData(data.qperfData)) {
      series.push({
        name: "QUIC",
        type: "bar",
        stack: "duration",
        data: data.qperfData,
        itemStyle: { color: "#13c2c2" },
      });
      legendData.push("QUIC");
    }
    if (hasData(data.videoData)) {
      series.push({
        name: "Video",
        type: "bar",
        stack: "duration",
        data: data.videoData,
        itemStyle: { color: "#eb2f96" },
      });
      legendData.push("Video");
    }
    if (hasData(data.nixCacheData)) {
      series.push({
        name: "Nix Cache",
        type: "bar",
        stack: "duration",
        data: data.nixCacheData,
        itemStyle: { color: "#faad14" },
      });
      legendData.push("Nix Cache");
    }

    return {
      title: {
        text: "Average Test Duration per Machine",
        subtext: "Lower is better",
        left: "center",
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (
          params: { name: string; seriesName: string; value: number }[],
        ) => {
          const vpn = params[0]?.name || "";
          const lines = params
            .filter((p) => p.value > 0)
            .map(
              (p: { seriesName: string; value: number }) =>
                `${p.seriesName}: ${p.value.toFixed(1)}s`,
            );
          return `${vpn}<br/>${lines.join("<br/>")}`;
        },
      },
      legend: {
        top: 45,
        data: legendData,
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        top: 100,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: data.vpnNames,
        axisLabel: { rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "Duration (seconds)",
      },
      series,
    };
  };

  return (
    <div>
      <div
        style={{
          "text-align": "center",
          "margin-bottom": "0.5rem",
          "font-size": "1rem",
          color: "#4b5563",
        }}
      >
        Total:{" "}
        <strong style={{ color: "#059669" }}>
          {chartData().grandTotalHours.toFixed(2)} hours
        </strong>
      </div>
      <Echart option={option()} height={props.height ?? 400} />
    </div>
  );
};

export const SuccessRateComparisonChart = (props: {
  data: VpnComparisonResultMap<BenchmarkStatsData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () => {
    const rawData = statsToBarData(
      props.data,
      (d) => d.success_rate_percent,
      props.allVpnNames,
    );
    // Sort by success rate descending, round to 1 decimal
    return rawData
      .map((d) => ({ ...d, value: Math.round(d.value * 10) / 10 }))
      .sort((a, b) => b.value - a.value);
  };

  // Custom chart since success rate is a percentage (0-100)
  const option = () => {
    const data = chartData();
    const vpnNames = data.map((d) => d.vpnName);
    const colors = data.map((d) => {
      if (d.hasError) return "#d9d9d9";
      if (d.value >= 90) return "#52c41a"; // Green for high success
      if (d.value >= 70) return "#faad14"; // Yellow for medium
      return "#ff4d4f"; // Red for low
    });

    return {
      title: {
        text: "Benchmark Success Rate",
        subtext: "Higher is better",
        left: "center",
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          return `${p.name}: ${Math.round(p.value)}%`;
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        top: 80,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: vpnNames,
        axisLabel: { rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "Success Rate (%)",
        nameGap: 40,
        min: 0,
        max: 100,
      },
      series: [
        {
          type: "bar",
          data: data.map((d, i) => ({
            value: d.value,
            itemStyle: { color: colors[i] },
          })),
          label: {
            show: true,
            position: "top",
            formatter: (params: { value: number }) =>
              `${Math.round(params.value)}%`,
          },
        },
      ],
    };
  };

  return (
    <div>
      <Echart option={option()} height={props.height ?? 400} />
    </div>
  );
};

export const FailureCountComparisonChart = (props: {
  data: VpnComparisonResultMap<BenchmarkStatsData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  const chartData = () => {
    const vpnNames = props.allVpnNames ?? Object.keys(props.data);
    const successData: number[] = [];
    const failedData: number[] = [];

    vpnNames.forEach((vpn) => {
      const entry = props.data[vpn];
      if (entry?.status === "success") {
        successData.push(entry.data.successful_tests);
        failedData.push(entry.data.failed_tests);
      } else {
        successData.push(0);
        failedData.push(0);
      }
    });

    return { vpnNames, successData, failedData };
  };

  const option = () => {
    const data = chartData();
    return {
      title: {
        text: "Test Results by VPN",
        subtext: "More successes is better",
        left: "center",
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      legend: {
        top: 45,
        data: ["Successful", "Failed"],
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        top: 80,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: data.vpnNames,
        axisLabel: { rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "Number of Tests",
      },
      series: [
        {
          name: "Successful",
          type: "bar",
          stack: "tests",
          data: data.successData,
          itemStyle: { color: "#52c41a" },
        },
        {
          name: "Failed",
          type: "bar",
          stack: "tests",
          data: data.failedData,
          itemStyle: { color: "#ff4d4f" },
        },
      ],
    };
  };

  return (
    <div>
      <Echart option={option()} height={props.height ?? 400} />
    </div>
  );
};

export const RetryComparisonChart = (props: {
  data: VpnComparisonResultMap<BenchmarkStatsData>;
  height?: number;
  allVpnNames?: string[];
}) => {
  // Create a stacked bar chart showing retries per VPN, segmented by test type
  const chartData = () => {
    const vpnNames = props.allVpnNames ?? Object.keys(props.data);

    // Build data for each VPN with individual retry counts
    const vpnData = vpnNames.map((vpn) => {
      const entry = props.data[vpn];
      if (entry?.status === "success") {
        const tcp = entry.data.tcp_retries ?? 0;
        const udp = entry.data.udp_retries ?? 0;
        const parallelTcp = entry.data.parallel_tcp_retries ?? 0;
        const ping = entry.data.ping_retries ?? 0;
        const qperf = entry.data.qperf_retries ?? 0;
        const video = entry.data.video_retries ?? 0;
        const nixCache = entry.data.nix_cache_retries ?? 0;
        const total = tcp + udp + parallelTcp + ping + qperf + video + nixCache;
        return {
          vpn,
          tcp,
          udp,
          parallelTcp,
          ping,
          qperf,
          video,
          nixCache,
          total,
        };
      } else {
        return {
          vpn,
          tcp: 0,
          udp: 0,
          parallelTcp: 0,
          ping: 0,
          qperf: 0,
          video: 0,
          nixCache: 0,
          total: 0,
        };
      }
    });

    // Sort by total retries descending
    vpnData.sort((a, b) => b.total - a.total);

    // Calculate grand total
    const grandTotal = vpnData.reduce((sum, d) => sum + d.total, 0);

    return {
      vpnNames: vpnData.map((d) => d.vpn),
      tcpData: vpnData.map((d) => d.tcp),
      udpData: vpnData.map((d) => d.udp),
      parallelTcpData: vpnData.map((d) => d.parallelTcp),
      pingData: vpnData.map((d) => d.ping),
      qperfData: vpnData.map((d) => d.qperf),
      videoData: vpnData.map((d) => d.video),
      nixCacheData: vpnData.map((d) => d.nixCache),
      grandTotal,
    };
  };

  // Check if a series has any non-zero values
  const hasData = (arr: number[]) => arr.some((v) => v > 0);

  const option = () => {
    const data = chartData();

    // Build series array, only including tests with retries
    const series: {
      name: string;
      type: string;
      stack: string;
      data: number[];
      itemStyle: { color: string };
    }[] = [];
    const legendData: string[] = [];

    if (hasData(data.tcpData)) {
      series.push({
        name: "TCP",
        type: "bar",
        stack: "retries",
        data: data.tcpData,
        itemStyle: { color: "#1890ff" },
      });
      legendData.push("TCP");
    }
    if (hasData(data.udpData)) {
      series.push({
        name: "UDP",
        type: "bar",
        stack: "retries",
        data: data.udpData,
        itemStyle: { color: "#52c41a" },
      });
      legendData.push("UDP");
    }
    if (hasData(data.parallelTcpData)) {
      series.push({
        name: "Parallel TCP",
        type: "bar",
        stack: "retries",
        data: data.parallelTcpData,
        itemStyle: { color: "#722ed1" },
      });
      legendData.push("Parallel TCP");
    }
    if (hasData(data.pingData)) {
      series.push({
        name: "Ping",
        type: "bar",
        stack: "retries",
        data: data.pingData,
        itemStyle: { color: "#fa8c16" },
      });
      legendData.push("Ping");
    }
    if (hasData(data.qperfData)) {
      series.push({
        name: "QUIC",
        type: "bar",
        stack: "retries",
        data: data.qperfData,
        itemStyle: { color: "#13c2c2" },
      });
      legendData.push("QUIC");
    }
    if (hasData(data.videoData)) {
      series.push({
        name: "Video",
        type: "bar",
        stack: "retries",
        data: data.videoData,
        itemStyle: { color: "#eb2f96" },
      });
      legendData.push("Video");
    }
    if (hasData(data.nixCacheData)) {
      series.push({
        name: "Nix Cache",
        type: "bar",
        stack: "retries",
        data: data.nixCacheData,
        itemStyle: { color: "#faad14" },
      });
      legendData.push("Nix Cache");
    }

    return {
      title: {
        text: "Test Retries by VPN",
        subtext: `Lower is better (Total: ${data.grandTotal} retries)`,
        left: "center",
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (
          params: { name: string; seriesName: string; value: number }[],
        ) => {
          const vpn = params[0]?.name || "";
          const lines = params
            .filter((p) => p.value > 0)
            .map((p) => `${p.seriesName}: ${p.value}`);
          const total = params.reduce((sum, p) => sum + p.value, 0);
          return `${vpn}<br/>${lines.join("<br/>")}<br/><strong>Total: ${total}</strong>`;
        },
      },
      legend: {
        top: 45,
        data: legendData,
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        top: 100,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: data.vpnNames,
        axisLabel: { rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "Number of Retries",
        minInterval: 1,
      },
      series,
    };
  };

  return (
    <div>
      <Echart option={option()} height={props.height ?? 400} />
    </div>
  );
};

export const BenchmarkStatsSection = (props: {
  data: VpnComparisonResultMap<BenchmarkStatsData>;
  allVpnNames?: string[];
}) => {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "20px",
      }}
    >
      <SuccessRateComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <TestDurationComparisonChart
        data={props.data}
        allVpnNames={props.allVpnNames}
      />
      <RetryComparisonChart data={props.data} allVpnNames={props.allVpnNames} />
    </div>
  );
};

// --- Time Breakdown Pie Chart ---

export const TimeBreakdownPieChart = (props: {
  data: TimeBreakdownData;
  height?: number;
}) => {
  const chartData = () => {
    const d = props.data;
    return [
      {
        name: "VPN Installation",
        value: d.vpn_installation_seconds ?? 0,
        color: "#1890ff",
      },
      {
        name: "TC Stabilization",
        value: d.tc_stabilization_seconds ?? 0,
        color: "#722ed1",
      },
      {
        name: "Test Execution",
        value: d.test_execution_seconds ?? 0,
        color: "#52c41a",
      },
      {
        name: "VPN Restarts",
        value: d.vpn_restart_seconds ?? 0,
        color: "#eb2f96",
      },
      {
        name: "Connectivity Waits",
        value: d.connectivity_wait_seconds ?? 0,
        color: "#fa8c16",
      },
      {
        name: "Other Overhead",
        value: d.other_overhead_seconds ?? 0,
        color: "#8c8c8c",
      },
    ].filter((item) => item.value > 0 && !isNaN(item.value));
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0m";
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  // Don't render if no valid data
  const hasValidData = () => chartData().length > 0;

  const option = () => ({
    title: {
      text: "Total Time Breakdown",
      subtext: `Total: ${formatTime(props.data.total_seconds)}`,
      left: "center",
      top: 0,
    },
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}: ${formatTime(params.value)} (${params.percent.toFixed(1)}%)`,
    },
    legend: {
      orient: "vertical",
      left: "left",
      top: "middle",
    },
    series: [
      {
        type: "pie",
        radius: ["35%", "60%"],
        center: ["55%", "55%"],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: "#fff", borderWidth: 2 },
        label: {
          show: true,
          formatter: (params: { name: string; percent: number }) =>
            `${params.name}\n${params.percent.toFixed(1)}%`,
        },
        data: chartData().map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: d.color },
        })),
      },
    ],
  });

  return (
    <Show when={hasValidData()} fallback={null}>
      <Echart option={option()} height={props.height ?? 400} />
    </Show>
  );
};
