import { EChartsCoreOption } from "echarts";
import { createMemo, Show } from "solid-js";
import { Echart } from "../Echarts";
import { Bar3DData, Scatter3DData, CrossProfileTcpData } from "../../benchData";

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

/**
 * Creates the ECharts option for the heatmap showing throughput
 * across VPNs and TC profiles.
 */
const createThroughputHeatmapOption = (
  data: Bar3DData,
  title: string,
): EChartsCoreOption => {
  // Find baseline profile index
  const baselineIdx = data.tc_profiles.indexOf("baseline");

  // Get baseline throughput for each VPN and create sorted order (high to low)
  const vpnBaselineThroughput = data.vpn_names.map((vpnName, vpnIdx) => {
    const baselineData = data.throughput_data.find(
      (d) => d[0] === vpnIdx && d[1] === baselineIdx,
    );
    return {
      originalIdx: vpnIdx,
      name: vpnName,
      baseline: baselineData ? baselineData[2] : 0,
    };
  });

  // Sort by baseline throughput descending (highest first)
  vpnBaselineThroughput.sort((a, b) => b.baseline - a.baseline);

  // Create mapping from original index to sorted index
  const sortedVpnNames = vpnBaselineThroughput.map((v) => v.name);
  const originalToSorted = new Map(
    vpnBaselineThroughput.map((v, sortedIdx) => [v.originalIdx, sortedIdx]),
  );

  // Transform data: [vpn_idx, profile_idx, throughput] -> [profile_idx, sorted_vpn_idx, throughput]
  // So X-axis is TC profiles, Y-axis is VPN names (sorted by baseline)
  const heatmapData = data.throughput_data.map(
    ([vpnIdx, profileIdx, value]) => [
      profileIdx,
      originalToSorted.get(vpnIdx) ?? vpnIdx,
      value,
    ],
  );

  // Format TC profile names for display
  const formatProfileName = (name: string) =>
    name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  return {
    title: {
      text: `${title} Throughput Heatmap`,
      subtext: "Higher is better (green)",
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
      formatter: (params: { value: [number, number, number] }) => {
        const profileIdx = params.value[0];
        const sortedVpnIdx = params.value[1];
        const throughput = params.value[2];
        const vpnName = sortedVpnNames[sortedVpnIdx];
        const profile = formatProfileName(data.tc_profiles[profileIdx]);
        return `<strong>${vpnName}</strong><br/>${profile}: ${throughput.toFixed(1)} Mbps`;
      },
    },
    grid: {
      top: 80,
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
      pieces: [
        { min: 800, color: "#1a9850" }, // dark green (best)
        { min: 500, max: 800, color: "#66bd63" }, // green
        { min: 200, max: 500, color: "#a6d96a" }, // light green
        { min: 100, max: 200, color: "#d9ef8b" }, // yellow-green
        { min: 50, max: 100, color: "#ffffbf" }, // light yellow
        { min: 30, max: 50, color: "#fee08b" }, // yellow-orange (41)
        { min: 15, max: 30, color: "#fdae61" }, // orange (17, 30)
        { min: 8, max: 15, color: "#f46d43" }, // orange-red (8, 9, 12)
        { min: 4, max: 8, color: "#d73027" }, // red (4, 5, 6)
        { max: 4, color: "#a50026" }, // dark red (1, 2, 3)
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
    ],
  };
};

/**
 * Creates the ECharts option for Small Multiples scatter plots showing
 * throughput vs window size across TC profiles (one plot per profile).
 * Point size represents congestion window (cwnd).
 */
const createSmallMultiplesScatterOption = (
  data: Scatter3DData,
  title: string,
): EChartsCoreOption => {
  // Format TC profile names for display
  const formatProfileName = (name: string) =>
    name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  // Calculate cwnd range for symbol size normalization
  // Data structure: [throughput, window_size_kb, cwnd_kb, vpn_idx, profile_idx]
  const cwndValues = data.data.map((d) => d[2]);
  const minCwnd = Math.min(...cwndValues);
  const maxCwnd = Math.max(...cwndValues);
  const cwndRange = maxCwnd - minCwnd || 1;

  // Normalize cwnd to symbol size (10-40 pixels)
  const normalizeCwnd = (cwnd: number) => {
    const normalized = (cwnd - minCwnd) / cwndRange;
    return 10 + normalized * 30;
  };

  // Create grid layout - 4 plots horizontally
  const gridWidth = 20; // percentage
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
      text: `${title} Window Metrics by Network Condition`,
      subtext: "Throughput vs Window Size (bubble size = Congestion Window)",
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

  // Create X axes (Window Size) - one per grid
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xAxes: any[] = data.tc_profiles.map((_, i) => ({
    type: "value",
    name: "Window Size (KB)",
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
      // Data: [throughput, window_size_kb, cwnd_kb, vpn_idx, profile_idx]
      const point = data.data.find(
        (d) => Math.round(d[3]) === vpnIdx && Math.round(d[4]) === profileIdx,
      );

      if (point) {
        const [throughput, windowSize, cwnd] = point;
        series.push({
          type: "scatter",
          name: vpnName,
          xAxisIndex: profileIdx,
          yAxisIndex: profileIdx,
          data: [[windowSize, throughput, cwnd, vpnName]],
          symbolSize: normalizeCwnd(cwnd),
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
      formatter: (params: {
        value: [number, number, number, string];
        seriesName: string;
      }) => {
        const [windowSize, throughput, cwnd, vpnName] = params.value;
        return (
          `<strong>${vpnName}</strong><br/>` +
          `Throughput: ${throughput.toFixed(1)} Mbps<br/>` +
          `Window Size: ${windowSize.toFixed(0)} KB<br/>` +
          `Congestion Window: ${cwnd.toFixed(0)} KB`
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

export interface TcpCrossProfileChartsProps {
  data: CrossProfileTcpData;
}

/**
 * Renders TCP cross-profile charts (heatmap and scatter plot)
 */
export const TcpCrossProfileCharts = (props: TcpCrossProfileChartsProps) => {
  // Memoize chart options for TCP
  const tcpHeatmapOption = createMemo(() =>
    createThroughputHeatmapOption(props.data.tcp.bar3d, "TCP"),
  );
  const tcpScatterOption = createMemo(() =>
    createSmallMultiplesScatterOption(props.data.tcp.scatter3d, "TCP"),
  );

  // Check if data is available
  const hasTcpData = () => props.data.tcp.bar3d.throughput_data.length > 0;

  return (
    <Show when={hasTcpData()}>
      <div class="flex flex-col gap-8">
        <div class="space-y-4">
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={tcpHeatmapOption()} height={500} />
          </div>
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={tcpScatterOption()} height={480} />
          </div>
        </div>
      </div>
    </Show>
  );
};

/**
 * Renders Parallel TCP cross-profile charts (heatmap and scatter plot)
 */
export const ParallelTcpCrossProfileCharts = (
  props: TcpCrossProfileChartsProps,
) => {
  // Memoize chart options for Parallel TCP
  const parallelHeatmapOption = createMemo(() =>
    createThroughputHeatmapOption(
      props.data.parallel_tcp.bar3d,
      "Parallel TCP",
    ),
  );
  const parallelScatterOption = createMemo(() =>
    createSmallMultiplesScatterOption(
      props.data.parallel_tcp.scatter3d,
      "Parallel TCP",
    ),
  );

  // Check if data is available
  const hasParallelData = () =>
    props.data.parallel_tcp.bar3d.throughput_data.length > 0;

  return (
    <Show when={hasParallelData()}>
      <div class="flex flex-col gap-8">
        <div class="space-y-4">
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={parallelHeatmapOption()} height={500} />
          </div>
          <div class="rounded-lg bg-white p-4 shadow-md">
            <Echart option={parallelScatterOption()} height={480} />
          </div>
        </div>
      </div>
    </Show>
  );
};

export default TcpCrossProfileCharts;
