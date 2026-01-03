import { EChartsCoreOption } from "echarts";
import { createMemo, Show } from "solid-js";
import { Echart } from "../Echarts";
import { CrossProfileUdpData, UdpHeatmapData, UdpScatterData } from "../../benchData";

// Color palette for VPNs (consistent with other charts)
const VPN_COLORS = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#ea7ccc",
  "#5c4ea7",
  "#66bb6a",
];

// Format TC profile names for display
const formatProfileName = (name: string) =>
  name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());

// Failed test marker color (dark for visibility on light/empty backgrounds)
const FAILED_COLOR = "#555555";

// Simple X symbol (smaller and cleaner)
const X_SYMBOL_PATH = "path://M2 0L6 4L10 0L12 2L8 6L12 10L10 12L6 8L2 12L0 10L4 6L0 2Z";

/**
 * Creates the ECharts option for UDP receiver throughput heatmap.
 * Higher is better (green).
 */
const createThroughputHeatmapOption = (data: UdpHeatmapData): EChartsCoreOption => {
  const vpnNames = Object.keys(data.throughput);

  // Sort by baseline throughput descending (highest first)
  const sortedVpnNames = [...vpnNames].sort(
    (a, b) => (data.throughput[b]?.baseline ?? 0) - (data.throughput[a]?.baseline ?? 0)
  );

  // Build failed markers first (need to know which cells to exclude from heatmap)
  const failedScatterData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    (data.failed[vpn] || []).map((profile) => [
      data.tc_profiles.indexOf(profile),
      vpnIdx,
    ])
  );

  // Create Set of failed cell keys for quick lookup
  const failedCellKeys = new Set(
    failedScatterData.map(([profileIdx, vpnIdx]) => `${profileIdx}-${vpnIdx}`)
  );

  // Build heatmap data, excluding failed cells (so they don't get colored)
  const heatmapData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    data.tc_profiles
      .map((profile, profileIdx) => {
        const key = `${profileIdx}-${vpnIdx}`;
        if (failedCellKeys.has(key)) return null; // Skip failed cells
        return [profileIdx, vpnIdx, data.throughput[vpn]?.[profile] ?? 0];
      })
      .filter((item): item is [number, number, number] => item !== null)
  );

  const hasFailures = failedScatterData.length > 0;

  return {
    title: {
      text: "UDP Receiver Throughput Heatmap",
      subtext: "Higher is better (green)" + (hasFailures ? " | ✕ = Failed" : ""),
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
        const throughput = params.value[2];
        const vpnName = sortedVpnNames[sortedVpnIdx];
        const profile = formatProfileName(data.tc_profiles[profileIdx]);
        return `<strong>${vpnName}</strong><br/>${profile}: ${throughput.toFixed(1)} Mbps`;
      },
    },
    legend: hasFailures ? {
      data: ["Throughput", "Failed"],
      top: 60,
      itemWidth: 14,
      itemHeight: 14,
    } : undefined,
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
        { min: 800, color: "#1a9850" },    // dark green (best)
        { min: 500, max: 800, color: "#66bd63" },
        { min: 200, max: 500, color: "#a6d96a" },
        { min: 100, max: 200, color: "#d9ef8b" },
        { min: 50, max: 100, color: "#ffffbf" },
        { min: 30, max: 50, color: "#fee08b" },
        { min: 15, max: 30, color: "#fdae61" },
        { min: 8, max: 15, color: "#f46d43" },
        { min: 4, max: 8, color: "#d73027" },
        { max: 4, color: "#a50026" },        // dark red (worst)
      ],
    },
    series: [
      {
        name: "Throughput",
        type: "heatmap",
        data: heatmapData,
        label: {
          show: true,
          formatter: (params: { value: [number, number, number] }) => {
            // Hide label for failed cells
            const key = `${params.value[0]}-${params.value[1]}`;
            if (failedCellKeys.has(key)) return "";
            return `${Math.round(params.value[2])}`;
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
      ...(hasFailures ? [{
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
      }] : []),
    ],
  };
};

/**
 * Creates the ECharts option for CPU usage heatmap.
 * Lower is better (green = low CPU).
 */
const createCpuHeatmapOption = (data: UdpHeatmapData): EChartsCoreOption => {
  const vpnNames = Object.keys(data.cpu);

  // Sort by baseline CPU ascending (lowest first = best)
  const sortedVpnNames = [...vpnNames].sort(
    (a, b) => (data.cpu[a]?.baseline ?? 100) - (data.cpu[b]?.baseline ?? 100)
  );

  // Build failed markers first (need to know which cells to exclude from heatmap)
  const failedScatterData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    (data.failed[vpn] || []).map((profile) => [
      data.tc_profiles.indexOf(profile),
      vpnIdx,
    ])
  );

  // Create Set of failed cell keys for quick lookup
  const failedCellKeys = new Set(
    failedScatterData.map(([profileIdx, vpnIdx]) => `${profileIdx}-${vpnIdx}`)
  );

  // Build heatmap data, excluding failed cells (so they don't get colored)
  const heatmapData = sortedVpnNames.flatMap((vpn, vpnIdx) =>
    data.tc_profiles
      .map((profile, profileIdx) => {
        const key = `${profileIdx}-${vpnIdx}`;
        if (failedCellKeys.has(key)) return null; // Skip failed cells
        return [profileIdx, vpnIdx, data.cpu[vpn]?.[profile] ?? 0];
      })
      .filter((item): item is [number, number, number] => item !== null)
  );

  const hasFailures = failedScatterData.length > 0;

  return {
    title: {
      text: "UDP CPU Usage Heatmap",
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
        const cpu = params.value[2];
        const vpnName = sortedVpnNames[sortedVpnIdx];
        const profile = formatProfileName(data.tc_profiles[profileIdx]);
        return `<strong>${vpnName}</strong><br/>${profile}: ${cpu.toFixed(1)}%`;
      },
    },
    legend: hasFailures ? {
      data: ["CPU Usage", "Failed"],
      top: 60,
      itemWidth: 14,
      itemHeight: 14,
    } : undefined,
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
        // Inverted: low CPU = green (good), high CPU = red (bad)
        { max: 10, color: "#1a9850" },       // dark green (best: <10%)
        { min: 10, max: 20, color: "#66bd63" },
        { min: 20, max: 30, color: "#a6d96a" },
        { min: 30, max: 40, color: "#d9ef8b" },
        { min: 40, max: 50, color: "#ffffbf" },
        { min: 50, max: 60, color: "#fee08b" },
        { min: 60, max: 70, color: "#fdae61" },
        { min: 70, max: 80, color: "#f46d43" },
        { min: 80, max: 90, color: "#d73027" },
        { min: 90, color: "#a50026" },       // dark red (worst: >90%)
      ],
    },
    series: [
      {
        name: "CPU Usage",
        type: "heatmap",
        data: heatmapData,
        label: {
          show: true,
          formatter: (params: { value: [number, number, number] }) => {
            // Hide label for failed cells
            const key = `${params.value[0]}-${params.value[1]}`;
            if (failedCellKeys.has(key)) return "";
            return `${Math.round(params.value[2])}%`;
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
      ...(hasFailures ? [{
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
      }] : []),
    ],
  };
};

/**
 * Creates the ECharts option for Small Multiples scatter plots showing
 * throughput vs payload size across TC profiles (one plot per profile).
 * Point size represents received bytes.
 */
const createSmallMultiplesScatterOption = (data: UdpScatterData): EChartsCoreOption => {
  // Calculate received bytes range for symbol size normalization
  // Data structure: [throughput, payload_size, received_bytes_gb, vpn_idx, profile_idx]
  const receivedValues = data.data.map((d) => d[2]);
  const minReceived = Math.min(...receivedValues);
  const maxReceived = Math.max(...receivedValues);
  const receivedRange = maxReceived - minReceived || 1;

  // Normalize received bytes to symbol size (10-40 pixels)
  const normalizeReceived = (received: number) => {
    const normalized = (received - minReceived) / receivedRange;
    return 10 + normalized * 30;
  };

  // Create grid layout - 4 plots horizontally
  const gridWidth = 20;
  const gridGap = 3;
  const gridStart = 8;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grids: any[] = data.tc_profiles.map((_, i) => ({
    left: `${gridStart + i * (gridWidth + gridGap)}%`,
    width: `${gridWidth}%`,
    top: 120,
    bottom: 60,
  }));

  // Create titles for each subplot
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const titles: any[] = [
    {
      text: "UDP Performance by Network Condition",
      subtext: "Throughput vs Payload Size (bubble size = Received Bytes)",
      left: "center",
      top: 0,
    },
    ...data.tc_profiles.map((profile, i) => ({
      text: formatProfileName(profile),
      left: `${gridStart + i * (gridWidth + gridGap) + gridWidth / 2}%`,
      top: 95,
      textAlign: "center",
      textStyle: {
        fontSize: 14,
        fontWeight: "bold",
      },
    })),
  ];

  // Create X axes (Payload Size) - one per grid
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xAxes: any[] = data.tc_profiles.map((_, i) => ({
    type: "value",
    name: "Payload Size (bytes)",
    nameLocation: "middle",
    nameGap: 25,
    gridIndex: i,
    min: 0,
    axisLabel: {
      fontSize: 10,
    },
  }));

  // Create Y axes (Throughput) - one per grid
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yAxes: any[] = data.tc_profiles.map((_, i) => ({
    type: "value",
    name: i === 0 ? "Throughput (Mbps)" : "",
    nameLocation: "middle",
    nameGap: 45,
    gridIndex: i,
    min: 0,
    axisLabel: {
      fontSize: 10,
    },
  }));

  // Create scatter series - one per VPN per profile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const series: any[] = [];

  data.vpn_names.forEach((vpnName, vpnIdx) => {
    data.tc_profiles.forEach((_, profileIdx) => {
      // Find data point for this VPN and profile
      // Data: [throughput, payload_size, received_bytes_gb, vpn_idx, profile_idx]
      const point = data.data.find(
        (d) => Math.round(d[3]) === vpnIdx && Math.round(d[4]) === profileIdx
      );

      if (point) {
        const [throughput, payloadSize, receivedGb] = point;
        series.push({
          type: "scatter",
          name: vpnName,
          xAxisIndex: profileIdx,
          yAxisIndex: profileIdx,
          data: [[payloadSize, throughput, receivedGb, vpnName]],
          symbolSize: normalizeReceived(receivedGb),
          itemStyle: {
            color: VPN_COLORS[vpnIdx % VPN_COLORS.length],
            opacity: 0.8,
            borderWidth: 1,
            borderColor: "rgba(255, 255, 255, 0.8)",
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
        });
      }
    });
  });

  return {
    title: titles,
    toolbox: {
      feature: {
        saveAsImage: { title: "Download Chart" },
        dataView: { show: true, readOnly: true, title: "View Data" },
      },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: { value: [number, number, number, string]; seriesName: string }) => {
        const [payloadSize, throughput, receivedGb, vpnName] = params.value;
        return (
          `<strong>${vpnName}</strong><br/>` +
          `Throughput: ${throughput.toFixed(1)} Mbps<br/>` +
          `Payload Size: ${payloadSize.toFixed(0)} bytes<br/>` +
          `Received: ${receivedGb.toFixed(2)} GB`
        );
      },
    },
    legend: {
      data: data.vpn_names,
      top: 55,
      type: "scroll",
      selectedMode: "multiple",
    },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    series: series,
  };
};

export interface UdpCrossProfileChartsProps {
  data: CrossProfileUdpData;
}

/**
 * Renders UDP cross-profile charts (throughput heatmap, CPU heatmap, and scatter plot)
 */
export const UdpCrossProfileCharts = (props: UdpCrossProfileChartsProps) => {
  // Memoize chart options
  const throughputHeatmapOption = createMemo(() =>
    createThroughputHeatmapOption(props.data.heatmap)
  );
  const cpuHeatmapOption = createMemo(() =>
    createCpuHeatmapOption(props.data.heatmap)
  );
  const scatterOption = createMemo(() =>
    createSmallMultiplesScatterOption(props.data.scatter)
  );

  // Check if data is available
  const hasData = () => Object.keys(props.data.heatmap.throughput).length > 0;

  return (
    <Show when={hasData()}>
      <div class="flex flex-col gap-8">
        <div class="space-y-4">
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={throughputHeatmapOption()} height={500} />
          </div>
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={cpuHeatmapOption()} height={500} />
          </div>
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={scatterOption()} height={480} />
          </div>
        </div>
      </div>
    </Show>
  );
};

export default UdpCrossProfileCharts;
