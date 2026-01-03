import { EChartsCoreOption } from "echarts";
import { createMemo, Show } from "solid-js";
import { Echart } from "../Echarts";
import { CrossProfilePingData, PingHeatmapData } from "../../benchData";

// Format TC profile names for display
const formatProfileName = (name: string) =>
  name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

// Failed test marker color (dark for visibility on light/empty backgrounds)
const FAILED_COLOR = "#555555";

// Simple X symbol (smaller and cleaner)
const X_SYMBOL_PATH =
  "path://M2 0L6 4L10 0L12 2L8 6L12 10L10 12L6 8L2 12L0 10L4 6L0 2Z";

/**
 * Creates the ECharts option for RTT (latency) heatmap.
 * Lower is better (green = low latency).
 */
const createRttHeatmapOption = (data: PingHeatmapData): EChartsCoreOption => {
  const vpnNames = Object.keys(data.rtt);

  // Sort by baseline RTT ascending (lowest first = best)
  const sortedVpnNames = [...vpnNames].sort(
    (a, b) => (data.rtt[a]?.baseline ?? 1000) - (data.rtt[b]?.baseline ?? 1000),
  );

  // Build failed markers first (need to know which cells to exclude from heatmap)
  const failedScatterData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    (data.failed[vpn] || []).map((profile) => [
      data.tc_profiles.indexOf(profile),
      vpnIdx,
    ]),
  );

  // Create Set of failed cell keys for quick lookup
  const failedCellKeys = new Set(
    failedScatterData.map(([profileIdx, vpnIdx]) => `${profileIdx}-${vpnIdx}`),
  );

  // Build heatmap data, excluding failed cells (so they don't get colored)
  const heatmapData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    data.tc_profiles
      .map((profile, profileIdx) => {
        const key = `${profileIdx}-${vpnIdx}`;
        if (failedCellKeys.has(key)) return null; // Skip failed cells
        return [profileIdx, vpnIdx, data.rtt[vpn]?.[profile] ?? 0];
      })
      .filter((item): item is [number, number, number] => item !== null),
  );

  const hasFailures = failedScatterData.length > 0;

  return {
    title: {
      text: "Ping Average RTT Heatmap",
      subtext: "Lower is better (green)" + (hasFailures ? " | ✕ = Failed" : ""),
      left: "center",
    },
    toolbox: {
      feature: {
        saveAsImage: { title: "Download Chart" },
        dataView: { show: true, readOnly: true, title: "View Data" },
      },
    },
    tooltip: {
      position: "top",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        // Handle failed marker tooltip
        if (params.seriesName === "Failed") {
          const profileIdx = params.value[0];
          const sortedVpnIdx = params.value[1];
          const vpnName = sortedVpnNames[sortedVpnIdx];
          const profile = formatProfileName(data.tc_profiles[profileIdx]);
          return `<strong>${vpnName}</strong><br/>${profile}: <span style="color: #d73027">Test Failed</span>`;
        }
        // Handle heatmap tooltip
        const profileIdx = params.value[0];
        const sortedVpnIdx = params.value[1];
        const rtt = params.value[2];
        const vpnName = sortedVpnNames[sortedVpnIdx];
        const profile = formatProfileName(data.tc_profiles[profileIdx]);
        return `<strong>${vpnName}</strong><br/>${profile}: ${rtt.toFixed(2)} ms`;
      },
    },
    legend: hasFailures
      ? {
          data: ["RTT", "Failed"],
          top: 60,
          itemWidth: 14,
          itemHeight: 14,
        }
      : undefined,
    grid: {
      top: hasFailures ? 100 : 80,
      bottom: 60,
      left: 120,
      right: 100,
    },
    xAxis: {
      type: "category",
      data: data.tc_profiles.map(formatProfileName),
      splitArea: {
        show: true,
      },
      axisLabel: {
        rotate: 30,
      },
    },
    yAxis: {
      type: "category",
      data: sortedVpnNames,
      splitArea: {
        show: true,
      },
    },
    visualMap: {
      type: "piecewise",
      splitNumber: 10,
      orient: "vertical",
      right: 10,
      top: "center",
      text: ["High", "Low"],
      seriesIndex: 0,
      pieces: [
        // Inverted: low RTT = green (good), high RTT = red (bad)
        { max: 1, color: "#1a9850" }, // dark green (best: <1ms)
        { min: 1, max: 2, color: "#66bd63" },
        { min: 2, max: 5, color: "#a6d96a" },
        { min: 5, max: 10, color: "#d9ef8b" },
        { min: 10, max: 20, color: "#ffffbf" },
        { min: 20, max: 30, color: "#fee08b" },
        { min: 30, max: 40, color: "#fdae61" },
        { min: 40, max: 50, color: "#f46d43" },
        { min: 50, max: 100, color: "#d73027" },
        { min: 100, color: "#a50026" }, // dark red (worst: >100ms)
      ],
    },
    series: [
      {
        name: "RTT",
        type: "heatmap",
        data: heatmapData,
        label: {
          show: true,
          formatter: (params: { value: [number, number, number] }) => {
            // Hide label for failed cells
            const key = `${params.value[0]}-${params.value[1]}`;
            if (failedCellKeys.has(key)) return "";
            const value = params.value[2];
            return value < 10 ? value.toFixed(1) : Math.round(value).toString();
          },
          fontSize: 10,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
      // Failed test markers as scatter overlay
      ...(hasFailures
        ? [
            {
              name: "Failed",
              type: "scatter",
              data: failedScatterData,
              symbol: X_SYMBOL_PATH,
              symbolSize: 14,
              itemStyle: {
                color: FAILED_COLOR,
              },
              label: {
                show: false,
              },
              z: 10,
            },
          ]
        : []),
    ],
  };
};

/**
 * Creates the ECharts option for packet loss heatmap.
 * Lower is better (green = no loss).
 */
const createPacketLossHeatmapOption = (
  data: PingHeatmapData,
): EChartsCoreOption => {
  const vpnNames = Object.keys(data.packet_loss);

  // Sort by baseline packet loss ascending (lowest first = best)
  const sortedVpnNames = [...vpnNames].sort(
    (a, b) =>
      (data.packet_loss[a]?.baseline ?? 100) -
      (data.packet_loss[b]?.baseline ?? 100),
  );

  // Build failed markers first (need to know which cells to exclude from heatmap)
  const failedScatterData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    (data.failed[vpn] || []).map((profile) => [
      data.tc_profiles.indexOf(profile),
      vpnIdx,
    ]),
  );

  // Create Set of failed cell keys for quick lookup
  const failedCellKeys = new Set(
    failedScatterData.map(([profileIdx, vpnIdx]) => `${profileIdx}-${vpnIdx}`),
  );

  // Build heatmap data, excluding failed cells (so they don't get colored)
  const heatmapData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    data.tc_profiles
      .map((profile, profileIdx) => {
        const key = `${profileIdx}-${vpnIdx}`;
        if (failedCellKeys.has(key)) return null; // Skip failed cells
        return [profileIdx, vpnIdx, data.packet_loss[vpn]?.[profile] ?? 0];
      })
      .filter((item): item is [number, number, number] => item !== null),
  );

  const hasFailures = failedScatterData.length > 0;

  return {
    title: {
      text: "Ping Packet Loss Heatmap",
      subtext:
        "Lower is better (green = 0% loss)" +
        (hasFailures ? " | ✕ = Failed" : ""),
      left: "center",
    },
    toolbox: {
      feature: {
        saveAsImage: { title: "Download Chart" },
        dataView: { show: true, readOnly: true, title: "View Data" },
      },
    },
    tooltip: {
      position: "top",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        // Handle failed marker tooltip
        if (params.seriesName === "Failed") {
          const profileIdx = params.value[0];
          const sortedVpnIdx = params.value[1];
          const vpnName = sortedVpnNames[sortedVpnIdx];
          const profile = formatProfileName(data.tc_profiles[profileIdx]);
          return `<strong>${vpnName}</strong><br/>${profile}: <span style="color: #d73027">Test Failed</span>`;
        }
        // Handle heatmap tooltip
        const profileIdx = params.value[0];
        const sortedVpnIdx = params.value[1];
        const loss = params.value[2];
        const vpnName = sortedVpnNames[sortedVpnIdx];
        const profile = formatProfileName(data.tc_profiles[profileIdx]);
        return `<strong>${vpnName}</strong><br/>${profile}: ${loss.toFixed(2)}%`;
      },
    },
    legend: hasFailures
      ? {
          data: ["Packet Loss", "Failed"],
          top: 60,
          itemWidth: 14,
          itemHeight: 14,
        }
      : undefined,
    grid: {
      top: hasFailures ? 100 : 80,
      bottom: 60,
      left: 120,
      right: 100,
    },
    xAxis: {
      type: "category",
      data: data.tc_profiles.map(formatProfileName),
      splitArea: {
        show: true,
      },
      axisLabel: {
        rotate: 30,
      },
    },
    yAxis: {
      type: "category",
      data: sortedVpnNames,
      splitArea: {
        show: true,
      },
    },
    visualMap: {
      type: "piecewise",
      splitNumber: 8,
      orient: "vertical",
      right: 10,
      top: "center",
      text: ["High", "Low"],
      seriesIndex: 0,
      pieces: [
        // Inverted: 0% loss = dark green (best), high loss = red (bad)
        { max: 0.01, color: "#1a9850" }, // dark green (best: ~0%)
        { min: 0.01, max: 1, color: "#66bd63" },
        { min: 1, max: 2, color: "#a6d96a" },
        { min: 2, max: 5, color: "#d9ef8b" },
        { min: 5, max: 10, color: "#fee08b" },
        { min: 10, max: 20, color: "#fdae61" },
        { min: 20, max: 50, color: "#f46d43" },
        { min: 50, color: "#a50026" }, // dark red (worst: >50%)
      ],
    },
    series: [
      {
        name: "Packet Loss",
        type: "heatmap",
        data: heatmapData,
        label: {
          show: true,
          formatter: (params: { value: [number, number, number] }) => {
            const value = params.value[2];
            if (value === 0) return "0";
            return value < 1 ? value.toFixed(2) : value.toFixed(1);
          },
          fontSize: 10,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
      // Failed test markers as scatter overlay
      ...(hasFailures
        ? [
            {
              name: "Failed",
              type: "scatter",
              data: failedScatterData,
              symbol: X_SYMBOL_PATH,
              symbolSize: 14,
              itemStyle: {
                color: FAILED_COLOR,
              },
              label: {
                show: false,
              },
              z: 10,
            },
          ]
        : []),
    ],
  };
};

export interface PingCrossProfileChartsProps {
  data: CrossProfilePingData;
}

/**
 * Renders Ping cross-profile charts (RTT heatmap and Packet Loss heatmap)
 */
export const PingCrossProfileCharts = (props: PingCrossProfileChartsProps) => {
  // Memoize chart options
  const rttHeatmapOption = createMemo(() =>
    createRttHeatmapOption(props.data.heatmap),
  );
  const packetLossHeatmapOption = createMemo(() =>
    createPacketLossHeatmapOption(props.data.heatmap),
  );

  // Check if data is available
  const hasData = () => Object.keys(props.data.heatmap.rtt).length > 0;

  return (
    <Show when={hasData()}>
      <div class="flex flex-col gap-8">
        <div class="space-y-4">
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={rttHeatmapOption()} height={500} />
          </div>
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={packetLossHeatmapOption()} height={500} />
          </div>
        </div>
      </div>
    </Show>
  );
};

export default PingCrossProfileCharts;
