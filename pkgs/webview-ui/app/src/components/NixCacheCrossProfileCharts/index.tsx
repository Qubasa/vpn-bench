import { EChartsCoreOption } from "echarts";
import { createMemo, Show } from "solid-js";
import { Echart } from "../Echarts";
import { CrossProfileNixCacheData, NixCacheHeatmapData } from "../../benchData";

// Format TC profile names for display
const formatProfileName = (name: string) =>
  name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

// Failed test marker color (dark for visibility on light/empty backgrounds)
const FAILED_COLOR = "#555555";

// Simple X symbol (smaller and cleaner)
const X_SYMBOL_PATH =
  "path://M2 0L6 4L10 0L12 2L8 6L12 10L10 12L6 8L2 12L0 10L4 6L0 2Z";

/**
 * Creates the ECharts option for Download Time heatmap.
 * Lower is better (green = fast download).
 */
const createDownloadTimeHeatmapOption = (
  data: NixCacheHeatmapData,
): EChartsCoreOption => {
  const vpnNames = Object.keys(data.mean_seconds);

  // Sort by baseline download time ascending (lowest first = best)
  const sortedVpnNames = [...vpnNames].sort(
    (a, b) =>
      (data.mean_seconds[a]?.baseline ?? 10000) -
      (data.mean_seconds[b]?.baseline ?? 10000),
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
        return [profileIdx, vpnIdx, data.mean_seconds[vpn]?.[profile] ?? 0];
      })
      .filter((item): item is [number, number, number] => item !== null),
  );

  const hasFailures = failedScatterData.length > 0;

  return {
    title: {
      text: "Nix Cache Download Time Heatmap",
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
        const seconds = params.value[2];
        const vpnName = sortedVpnNames[sortedVpnIdx];
        const profile = formatProfileName(data.tc_profiles[profileIdx]);
        return `<strong>${vpnName}</strong><br/>${profile}: ${seconds.toFixed(2)}s`;
      },
    },
    legend: hasFailures
      ? {
          data: ["Download Time", "Failed"],
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
        // Lower time = green (good), higher time = red (bad)
        { max: 5, color: "#1a9850" }, // dark green (best: <5s)
        { min: 5, max: 10, color: "#66bd63" },
        { min: 10, max: 20, color: "#a6d96a" },
        { min: 20, max: 30, color: "#d9ef8b" },
        { min: 30, max: 45, color: "#ffffbf" },
        { min: 45, max: 60, color: "#fee08b" },
        { min: 60, max: 90, color: "#fdae61" },
        { min: 90, max: 120, color: "#f46d43" },
        { min: 120, max: 180, color: "#d73027" },
        { min: 180, color: "#a50026" }, // dark red (worst: >180s/3min)
      ],
    },
    series: [
      {
        name: "Download Time",
        type: "heatmap",
        data: heatmapData,
        label: {
          show: true,
          formatter: (params: { value: [number, number, number] }) => {
            const value = params.value[2];
            if (value < 10) return value.toFixed(1);
            return Math.round(value).toString();
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

export interface NixCacheCrossProfileChartsProps {
  data: CrossProfileNixCacheData;
}

/**
 * Renders Nix Cache cross-profile charts (Download Time heatmap)
 */
export const NixCacheCrossProfileCharts = (
  props: NixCacheCrossProfileChartsProps,
) => {
  // Memoize chart options
  const downloadTimeHeatmapOption = createMemo(() =>
    createDownloadTimeHeatmapOption(props.data.heatmap),
  );

  // Check if data is available
  const hasData = () => Object.keys(props.data.heatmap.mean_seconds).length > 0;

  return (
    <Show when={hasData()}>
      <div class="flex flex-col gap-8">
        <div class="space-y-4">
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={downloadTimeHeatmapOption()} height={500} />
          </div>
        </div>
      </div>
    </Show>
  );
};

export default NixCacheCrossProfileCharts;
