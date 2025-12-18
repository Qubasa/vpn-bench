import { Component, Show } from "solid-js";
/* eslint-disable  @typescript-eslint/no-explicit-any */

import { Echart } from "../Echarts";
import * as echarts from "echarts";

interface RistPercentiles {
  p25: number;
  p50: number;
  p75: number;
}

interface RistMetricStats {
  min: number;
  average: number;
  max: number;
  percentiles: RistPercentiles;
}

// Encoding stats from ffmpeg sender
interface RistEncodingData {
  bitrate_kbps: RistMetricStats;
  fps: RistMetricStats;
  dropped_frames: RistMetricStats;
}

// Network stats from ristreceiver
interface RistNetworkData {
  packets_dropped: RistMetricStats;
  packets_recovered: RistMetricStats;
  rtt_ms: RistMetricStats;
  quality: RistMetricStats;
  bitrate_bps: RistMetricStats;
}

// Combined data structure
export interface RistData {
  encoding: RistEncodingData;
  network: RistNetworkData;
}

export interface RistReport {
  name: string;
  data: RistData;
}

type EncodingMetricKey = keyof RistEncodingData;
type NetworkMetricKey = keyof RistNetworkData;

const defaultMetricStats: RistMetricStats = {
  min: 0,
  average: 0,
  max: 0,
  percentiles: { p25: 0, p50: 0, p75: 0 },
};

const getEncodingMetricStats = (
  data: RistData,
  metric: EncodingMetricKey,
): RistMetricStats => {
  if (!data?.encoding || !(metric in data.encoding)) {
    console.error(
      `Encoding metric key "${metric}" not found in RIST data:`,
      data,
    );
    return defaultMetricStats;
  }
  return data.encoding[metric];
};

const getNetworkMetricStats = (
  data: RistData,
  metric: NetworkMetricKey,
): RistMetricStats => {
  if (!data?.network || !(metric in data.network)) {
    console.error(
      `Network metric key "${metric}" not found in RIST data:`,
      data,
    );
    return defaultMetricStats;
  }
  return data.network[metric];
};

const getBoxplotArray = (stats: RistMetricStats): number[] => {
  return [
    stats.min,
    stats.percentiles.p25,
    stats.percentiles.p50,
    stats.percentiles.p75,
    stats.max,
  ];
};

const processEncodingDataForBoxplot = (
  reports: RistReport[],
  metric: EncodingMetricKey,
) => {
  const categories: string[] = [];
  const boxplotData: number[][] = [];
  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getEncodingMetricStats(report.data, metric);
    boxplotData.push(getBoxplotArray(stats));
  });
  return { categories, boxplotData };
};

const processEncodingDataForBarChart = (
  reports: RistReport[],
  metric: EncodingMetricKey,
) => {
  const categories: string[] = [];
  const barData: number[] = [];
  const fullStatsList: RistMetricStats[] = [];

  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getEncodingMetricStats(report.data, metric);
    barData.push(stats.average);
    fullStatsList.push(stats);
  });
  return { categories, barData, fullStatsList };
};

const processNetworkDataForBoxplot = (
  reports: RistReport[],
  metric: NetworkMetricKey,
) => {
  const categories: string[] = [];
  const boxplotData: number[][] = [];
  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getNetworkMetricStats(report.data, metric);
    boxplotData.push(getBoxplotArray(stats));
  });
  return { categories, boxplotData };
};

const processNetworkDataForBarChart = (
  reports: RistReport[],
  metric: NetworkMetricKey,
) => {
  const categories: string[] = [];
  const barData: number[] = [];
  const fullStatsList: RistMetricStats[] = [];

  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getNetworkMetricStats(report.data, metric);
    barData.push(stats.average);
    fullStatsList.push(stats);
  });
  return { categories, barData, fullStatsList };
};

const machineColorPalette = [
  "#3366FF",
  "#FF5733",
  "#33CC99",
  "#9966FF",
  "#FFCC33",
  "#FF6699",
  "#00CCCC",
  "#CC6633",
  "#6699CC",
  "#99CC33",
];

const getMachineColor = (machineIndex: number): string => {
  return machineColorPalette[machineIndex % machineColorPalette.length];
};

// Helper to get subtitle based on metric direction
const getEncodingMetricSubtext = (metric: EncodingMetricKey): string => {
  // Dropped frames: Lower is better; Bitrate/FPS: Higher is better
  return metric === "dropped_frames" ? "Lower is better" : "Higher is better";
};

const getNetworkMetricSubtext = (metric: NetworkMetricKey): string => {
  // Lower is better: packets_dropped, rtt_ms
  // Higher is better: quality, packets_recovered (shows recovery effectiveness)
  switch (metric) {
    case "packets_dropped":
    case "rtt_ms":
      return "Lower is better";
    case "quality":
    case "packets_recovered":
    case "bitrate_bps":
      return "Higher is better";
    default:
      return "";
  }
};

const createEncodingBoxplotOption = (
  reports: RistReport[],
  metric: EncodingMetricKey,
  title: string,
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const { categories, boxplotData } = processEncodingDataForBoxplot(
    reports,
    metric,
  );
  if (categories.length === 0) return null;

  let yAxisName = "";
  let unitSymbol = "";
  switch (metric) {
    case "bitrate_kbps":
      yAxisName = "Kilobits per second (kbps)";
      unitSymbol = " kbps";
      break;
    case "fps":
      yAxisName = "Frames per second";
      unitSymbol = " fps";
      break;
    case "dropped_frames":
      yAxisName = "Number of frames";
      unitSymbol = " frames";
      break;
    default:
      yAxisName = "";
      unitSymbol = "";
  }

  const tooltipFormatter = (params: any) => {
    if (params.componentType !== "series" || params.seriesType !== "boxplot")
      return "";
    const dataIndex = params.dataIndex;
    const categoryName = categories[dataIndex];
    const machineColor = getMachineColor(dataIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    const data: number[] = params.value;

    if (!data || data.length !== 6) return "Data error";

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${categoryName}</div>
              <div>${colorBox} Max: <strong>${data[4].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q3 (P75): <strong>${data[3].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Median (P50): <strong>${data[2].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q1 (P25): <strong>${data[1].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Min: <strong>${data[0].toFixed(2)}${unitSymbol}</strong></div>
            </div>`;
  };

  const seriesData: echarts.BoxplotSeriesOption[] = [
    {
      name: title,
      type: "boxplot",
      data: boxplotData.map((data, index) => ({
        value: data,
        itemStyle: {
          borderWidth: 1.5,
          borderColor: getMachineColor(index),
        },
        emphasis: {
          itemStyle: {
            borderWidth: 2.5,
            borderColor: getMachineColor(index),
            shadowColor: "rgba(0, 0, 0, 0.3)",
            shadowBlur: 5,
          },
        },
      })),
      boxWidth: [8, 40],
      animationDelay: (idx: number) => idx * 50,
    },
  ];

  return {
    title: {
      text: title,
      subtext: getEncodingMetricSubtext(metric),
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 },
      subtextStyle: { color: "#888", fontSize: 12 },
      padding: [10, 0, 10, 0],
    },
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#ccc",
      borderWidth: 1,
      textStyle: { color: "#333" },
      extraCssText: "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);",
      confine: true,
    },
    animation: true,
    toolbox: {
      feature: {
        saveAsImage: { title: "Save Image" },
        dataView: { show: true, readOnly: false, title: "View Data" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    grid: {
      left: "10%",
      right: "12%",
      bottom: "10%",
      top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: true,
      nameGap: 25,
      axisLabel: {
        interval: 0,
        rotate: reports.length > 6 ? 30 : 0,
        fontSize: 11,
      },
      axisTick: { alignWithLabel: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameLocation: "middle",
      nameGap: 40,
      nameTextStyle: { fontWeight: "bold", fontSize: 13 },
      min: 0,
      max: (value: { max: number }) => value.max + value.max * 0.1,
      splitArea: { show: false },
      splitLine: { lineStyle: { type: "dashed", color: "#eee" } },
      axisLabel: {
        formatter: (value: number) => value.toFixed(2),
        fontSize: 11,
      },
    },
    series: seriesData,
  };
};

const createEncodingBarChartOption = (
  reports: RistReport[],
  metric: EncodingMetricKey,
  title: string,
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const { categories, barData, fullStatsList } = processEncodingDataForBarChart(
    reports,
    metric,
  );
  if (categories.length === 0) return null;

  let yAxisName = "";
  let unitSymbol = "";
  let chartTitle = title;
  switch (metric) {
    case "bitrate_kbps":
      yAxisName = "Kilobits per second (kbps)";
      unitSymbol = " kbps";
      chartTitle = "Average Bitrate";
      break;
    case "fps":
      yAxisName = "Frames per second";
      unitSymbol = " fps";
      chartTitle = "Average FPS";
      break;
    case "dropped_frames":
      yAxisName = "Number of frames";
      unitSymbol = " frames";
      chartTitle = "Average Dropped Frames";
      break;
    default:
      yAxisName = "";
      unitSymbol = "";
  }

  const tooltipFormatter = (params: any) => {
    if (params.componentType !== "series" || params.seriesType !== "bar")
      return "";
    const dataIndex = params.dataIndex;
    const categoryName = categories[dataIndex];
    const machineColor = getMachineColor(dataIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    const stats: RistMetricStats | undefined = fullStatsList[dataIndex];

    if (!stats) return "Data error";

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${categoryName}</div>
              <div>${colorBox} Average: <strong>${stats.average.toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Min: <small>${stats.min.toFixed(2)}${unitSymbol}</small></div>
              <div>${colorBox} Max: <small>${stats.max.toFixed(2)}${unitSymbol}</small></div>
              <div><small>(P25: ${stats.percentiles.p25.toFixed(2)}, P50: ${stats.percentiles.p50.toFixed(2)}, P75: ${stats.percentiles.p75.toFixed(2)})</small></div>
            </div>`;
  };

  return {
    title: {
      text: chartTitle,
      subtext: getEncodingMetricSubtext(metric),
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 },
      subtextStyle: { color: "#888", fontSize: 12 },
      padding: [10, 0, 10, 0],
    },
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#ccc",
      borderWidth: 1,
      textStyle: { color: "#333" },
      extraCssText: "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);",
      confine: true,
    },
    animation: true,
    toolbox: {
      feature: {
        saveAsImage: { title: "Save Image" },
        dataView: { show: true, readOnly: false, title: "View Data" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    grid: {
      left: "10%",
      right: "12%",
      bottom: "10%",
      top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: {
        interval: 0,
        rotate: reports.length > 6 ? 30 : 0,
        fontSize: 11,
      },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameLocation: "middle",
      nameGap: 40,
      nameTextStyle: { fontWeight: "bold", fontSize: 13 },
      min: 0,
      axisLabel: {
        formatter: (value: number) => value.toFixed(2),
        fontSize: 11,
      },
      splitLine: { lineStyle: { type: "dashed", color: "#eee" } },
    },
    series: [
      {
        name: chartTitle,
        type: "bar",
        data: barData.map((avgValue, index) => ({
          value: avgValue,
          itemStyle: {
            color: getMachineColor(index),
            borderRadius: [3, 3, 0, 0],
          },
          emphasis: {
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: getMachineColor(index) + "E0" },
                { offset: 1, color: getMachineColor(index) + "B0" },
              ]),
            },
          },
        })),
        barWidth: "40%",
        label: {
          show: true,
          position: "top",
          formatter: (params: any) => parseFloat(params.value).toFixed(1),
          color: "#555",
          fontSize: 10,
        },
      },
    ],
  };
};

const createNetworkBoxplotOption = (
  reports: RistReport[],
  metric: NetworkMetricKey,
  title: string,
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const { categories, boxplotData } = processNetworkDataForBoxplot(
    reports,
    metric,
  );
  if (categories.length === 0) return null;

  let yAxisName = "";
  let unitSymbol = "";
  switch (metric) {
    case "rtt_ms":
      yAxisName = "Milliseconds (ms)";
      unitSymbol = " ms";
      break;
    case "quality":
      yAxisName = "Quality (0-100)";
      unitSymbol = "";
      break;
    case "packets_dropped":
    case "packets_recovered":
      yAxisName = "Number of packets";
      unitSymbol = " pkts";
      break;
    case "bitrate_bps":
      yAxisName = "Bits per second (bps)";
      unitSymbol = " bps";
      break;
    default:
      yAxisName = "";
      unitSymbol = "";
  }

  const tooltipFormatter = (params: any) => {
    if (params.componentType !== "series" || params.seriesType !== "boxplot")
      return "";
    const dataIndex = params.dataIndex;
    const categoryName = categories[dataIndex];
    const machineColor = getMachineColor(dataIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    const data: number[] = params.value;

    if (!data || data.length !== 6) return "Data error";

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${categoryName}</div>
              <div>${colorBox} Max: <strong>${data[4].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q3 (P75): <strong>${data[3].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Median (P50): <strong>${data[2].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Q1 (P25): <strong>${data[1].toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Min: <strong>${data[0].toFixed(2)}${unitSymbol}</strong></div>
            </div>`;
  };

  const seriesData: echarts.BoxplotSeriesOption[] = [
    {
      name: title,
      type: "boxplot",
      data: boxplotData.map((data, index) => ({
        value: data,
        itemStyle: {
          borderWidth: 1.5,
          borderColor: getMachineColor(index),
        },
        emphasis: {
          itemStyle: {
            borderWidth: 2.5,
            borderColor: getMachineColor(index),
            shadowColor: "rgba(0, 0, 0, 0.3)",
            shadowBlur: 5,
          },
        },
      })),
      boxWidth: [8, 40],
      animationDelay: (idx: number) => idx * 50,
    },
  ];

  return {
    title: {
      text: title,
      subtext: getNetworkMetricSubtext(metric),
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 },
      subtextStyle: { color: "#888", fontSize: 12 },
      padding: [10, 0, 10, 0],
    },
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#ccc",
      borderWidth: 1,
      textStyle: { color: "#333" },
      extraCssText: "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);",
      confine: true,
    },
    animation: true,
    toolbox: {
      feature: {
        saveAsImage: { title: "Save Image" },
        dataView: { show: true, readOnly: false, title: "View Data" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    grid: {
      left: "10%",
      right: "12%",
      bottom: "10%",
      top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: true,
      nameGap: 25,
      axisLabel: {
        interval: 0,
        rotate: reports.length > 6 ? 30 : 0,
        fontSize: 11,
      },
      axisTick: { alignWithLabel: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameLocation: "middle",
      nameGap: 40,
      nameTextStyle: { fontWeight: "bold", fontSize: 13 },
      min: 0,
      max: (value: { max: number }) => value.max + value.max * 0.1,
      splitArea: { show: false },
      splitLine: { lineStyle: { type: "dashed", color: "#eee" } },
      axisLabel: {
        formatter: (value: number) => value.toFixed(2),
        fontSize: 11,
      },
    },
    series: seriesData,
  };
};

const createNetworkBarChartOption = (
  reports: RistReport[],
  metric: NetworkMetricKey,
  title: string,
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const { categories, barData, fullStatsList } = processNetworkDataForBarChart(
    reports,
    metric,
  );
  if (categories.length === 0) return null;

  let yAxisName = "";
  let unitSymbol = "";
  let chartTitle = title;
  switch (metric) {
    case "rtt_ms":
      yAxisName = "Milliseconds (ms)";
      unitSymbol = " ms";
      chartTitle = "Average RTT";
      break;
    case "quality":
      yAxisName = "Quality (0-100)";
      unitSymbol = "";
      chartTitle = "Average Quality";
      break;
    case "packets_dropped":
      yAxisName = "Number of packets";
      unitSymbol = " pkts";
      chartTitle = "Average Packets Dropped";
      break;
    case "packets_recovered":
      yAxisName = "Number of packets";
      unitSymbol = " pkts";
      chartTitle = "Average Packets Recovered";
      break;
    case "bitrate_bps":
      yAxisName = "Bits per second (bps)";
      unitSymbol = " bps";
      chartTitle = "Average Network Bitrate";
      break;
    default:
      yAxisName = "";
      unitSymbol = "";
  }

  const tooltipFormatter = (params: any) => {
    if (params.componentType !== "series" || params.seriesType !== "bar")
      return "";
    const dataIndex = params.dataIndex;
    const categoryName = categories[dataIndex];
    const machineColor = getMachineColor(dataIndex);
    const colorBox = `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${machineColor}"></span>`;
    const stats: RistMetricStats | undefined = fullStatsList[dataIndex];

    if (!stats) return "Data error";

    return `<div style="padding: 5px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1)">
              <div style="font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 5px">${categoryName}</div>
              <div>${colorBox} Average: <strong>${stats.average.toFixed(2)}${unitSymbol}</strong></div>
              <div>${colorBox} Min: <small>${stats.min.toFixed(2)}${unitSymbol}</small></div>
              <div>${colorBox} Max: <small>${stats.max.toFixed(2)}${unitSymbol}</small></div>
              <div><small>(P25: ${stats.percentiles.p25.toFixed(2)}, P50: ${stats.percentiles.p50.toFixed(2)}, P75: ${stats.percentiles.p75.toFixed(2)})</small></div>
            </div>`;
  };

  return {
    title: {
      text: chartTitle,
      subtext: getNetworkMetricSubtext(metric),
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 },
      subtextStyle: { color: "#888", fontSize: 12 },
      padding: [10, 0, 10, 0],
    },
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#ccc",
      borderWidth: 1,
      textStyle: { color: "#333" },
      extraCssText: "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);",
      confine: true,
    },
    animation: true,
    toolbox: {
      feature: {
        saveAsImage: { title: "Save Image" },
        dataView: { show: true, readOnly: false, title: "View Data" },
      },
      orient: "vertical",
      right: 10,
      top: "center",
    },
    grid: {
      left: "10%",
      right: "12%",
      bottom: "10%",
      top: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: {
        interval: 0,
        rotate: reports.length > 6 ? 30 : 0,
        fontSize: 11,
      },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameLocation: "middle",
      nameGap: 40,
      nameTextStyle: { fontWeight: "bold", fontSize: 13 },
      min: 0,
      axisLabel: {
        formatter: (value: number) => value.toFixed(2),
        fontSize: 11,
      },
      splitLine: { lineStyle: { type: "dashed", color: "#eee" } },
    },
    series: [
      {
        name: chartTitle,
        type: "bar",
        data: barData.map((avgValue, index) => ({
          value: avgValue,
          itemStyle: {
            color: getMachineColor(index),
            borderRadius: [3, 3, 0, 0],
          },
          emphasis: {
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: getMachineColor(index) + "E0" },
                { offset: 1, color: getMachineColor(index) + "B0" },
              ]),
            },
          },
        })),
        barWidth: "40%",
        label: {
          show: true,
          position: "top",
          formatter: (params: any) => parseFloat(params.value).toFixed(1),
          color: "#555",
          fontSize: 10,
        },
      },
    ],
  };
};

export interface EncodingBoxplotChartProps {
  reports: RistReport[];
  metric: EncodingMetricKey;
  title: string;
  height?: number;
}

export const EncodingBoxplotChart: Component<EncodingBoxplotChartProps> = (
  props,
) => {
  const option = () =>
    createEncodingBoxplotOption(props.reports, props.metric, props.title);
  return (
    <Show
      when={option()}
      fallback={
        <div
          style={{
            height: `${props.height || 500}px`,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "#888",
          }}
        >
          Data unavailable for {props.title}.
        </div>
      }
    >
      {(opt) => <Echart option={opt()} height={props.height || 500} />}
    </Show>
  );
};

export interface EncodingBarChartProps {
  reports: RistReport[];
  metric: EncodingMetricKey;
  title: string;
  height?: number;
}

export const EncodingBarChart: Component<EncodingBarChartProps> = (props) => {
  const option = () =>
    createEncodingBarChartOption(props.reports, props.metric, props.title);
  return (
    <Show
      when={option()}
      fallback={
        <div
          style={{
            height: `${props.height || 500}px`,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "#888",
          }}
        >
          Data unavailable for {props.title}.
        </div>
      }
    >
      {(opt) => <Echart option={opt()} height={props.height || 500} />}
    </Show>
  );
};

export interface NetworkBoxplotChartProps {
  reports: RistReport[];
  metric: NetworkMetricKey;
  title: string;
  height?: number;
}

export const NetworkBoxplotChart: Component<NetworkBoxplotChartProps> = (
  props,
) => {
  const option = () =>
    createNetworkBoxplotOption(props.reports, props.metric, props.title);
  return (
    <Show
      when={option()}
      fallback={
        <div
          style={{
            height: `${props.height || 500}px`,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "#888",
          }}
        >
          Data unavailable for {props.title}.
        </div>
      }
    >
      {(opt) => <Echart option={opt()} height={props.height || 500} />}
    </Show>
  );
};

export interface NetworkBarChartProps {
  reports: RistReport[];
  metric: NetworkMetricKey;
  title: string;
  height?: number;
}

export const NetworkBarChart: Component<NetworkBarChartProps> = (props) => {
  const option = () =>
    createNetworkBarChartOption(props.reports, props.metric, props.title);
  return (
    <Show
      when={option()}
      fallback={
        <div
          style={{
            height: `${props.height || 500}px`,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "#888",
          }}
        >
          Data unavailable for {props.title}.
        </div>
      }
    >
      {(opt) => <Echart option={opt()} height={props.height || 500} />}
    </Show>
  );
};

export interface RistChartsDashboardProps {
  reports: RistReport[];
  height?: {
    bitrate?: number;
    fps?: number;
    droppedFrames?: number;
    rtt?: number;
    quality?: number;
    packetsDropped?: number;
    packetsRecovered?: number;
  };
}

// Helper component for consistent "No Data" message
const FallbackMessage = () => (
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
      No RIST streaming data available. Run the benchmark to generate data.
    </p>
  </div>
);

const SectionHeader: Component<{ title: string }> = (props) => (
  <h2
    style={{
      "font-size": "1.2rem",
      "font-weight": "600",
      color: "#333",
      "margin-bottom": "15px",
      "padding-bottom": "8px",
      "border-bottom": "2px solid #3366FF",
    }}
  >
    {props.title}
  </h2>
);

const ChartCard: Component<{
  children: any;
  flex?: string;
  minWidth?: string;
}> = (props) => (
  <div
    style={{
      flex: props.flex ?? "1",
      "min-width": props.minWidth ?? "300px",
      "background-color": "#fff",
      padding: "10px",
      "border-radius": "6px",
      "box-shadow": "0 1px 3px rgba(0,0,0,0.05)",
    }}
  >
    {props.children}
  </div>
);

export const RistChartsDashboard: Component<RistChartsDashboardProps> = (
  props,
) => {
  const effectiveHeights = {
    bitrate: props.height?.bitrate ?? 400,
    fps: props.height?.fps ?? 350,
    droppedFrames: props.height?.droppedFrames ?? 350,
    rtt: props.height?.rtt ?? 350,
    quality: props.height?.quality ?? 350,
    packetsDropped: props.height?.packetsDropped ?? 350,
    packetsRecovered: props.height?.packetsRecovered ?? 350,
  };

  if (!props.reports || props.reports.length === 0) {
    return <FallbackMessage />;
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "30px",
        padding: "15px",
        "background-color": "#f7f7f7",
      }}
    >
      {/* Encoding Stats Section */}
      <section>
        <SectionHeader title="Encoding Stats (FFmpeg Sender)" />
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "15px",
          }}
        >
          {/* Bitrate Chart */}
          <ChartCard>
            <EncodingBarChart
              reports={props.reports}
              metric="bitrate_kbps"
              title="Streaming Bitrate"
              height={effectiveHeights.bitrate}
            />
          </ChartCard>

          {/* Row for FPS and Dropped Frames */}
          <div style={{ display: "flex", gap: "15px", "flex-wrap": "wrap" }}>
            <ChartCard flex="1 1 45%">
              <EncodingBarChart
                reports={props.reports}
                metric="fps"
                title="Frame Rate"
                height={effectiveHeights.fps}
              />
            </ChartCard>
            <ChartCard flex="1 1 45%">
              <EncodingBoxplotChart
                reports={props.reports}
                metric="dropped_frames"
                title="Dropped Frames"
                height={effectiveHeights.droppedFrames}
              />
            </ChartCard>
          </div>
        </div>
      </section>

      {/* Network Stats Section */}
      <section>
        <SectionHeader title="Network Stats (RIST Receiver)" />
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "15px",
          }}
        >
          {/* Row for RTT and Quality */}
          <div style={{ display: "flex", gap: "15px", "flex-wrap": "wrap" }}>
            <ChartCard flex="1 1 45%">
              <NetworkBoxplotChart
                reports={props.reports}
                metric="rtt_ms"
                title="Round Trip Time"
                height={effectiveHeights.rtt}
              />
            </ChartCard>
            <ChartCard flex="1 1 45%">
              <NetworkBarChart
                reports={props.reports}
                metric="quality"
                title="Connection Quality"
                height={effectiveHeights.quality}
              />
            </ChartCard>
          </div>

          {/* Row for Packet Stats */}
          <div style={{ display: "flex", gap: "15px", "flex-wrap": "wrap" }}>
            <ChartCard flex="1 1 45%">
              <NetworkBarChart
                reports={props.reports}
                metric="packets_dropped"
                title="Packets Dropped"
                height={effectiveHeights.packetsDropped}
              />
            </ChartCard>
            <ChartCard flex="1 1 45%">
              <NetworkBarChart
                reports={props.reports}
                metric="packets_recovered"
                title="Packets Recovered (ARQ)"
                height={effectiveHeights.packetsRecovered}
              />
            </ChartCard>
          </div>
        </div>
      </section>
    </div>
  );
};

export default RistChartsDashboard;
