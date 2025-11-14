import { Component, Show } from "solid-js";
/* eslint-disable  @typescript-eslint/no-explicit-any */

import { Echart } from "../Echarts";
import * as echarts from "echarts";

interface SrtPercentiles {
  p25: number;
  p50: number;
  p75: number;
}

interface SrtMetricStats {
  min: number;
  average: number;
  max: number;
  percentiles: SrtPercentiles;
}

export interface SrtData {
  bitrate_kbps: SrtMetricStats;
  fps: SrtMetricStats;
  dropped_frames: SrtMetricStats;
}

export interface SrtReport {
  name: string;
  data: SrtData;
}

type MetricKey = keyof SrtData;

const getMetricStats = (data: SrtData, metric: MetricKey): SrtMetricStats => {
  if (!data || !(metric in data)) {
    console.error(`Metric key "${metric}" not found in SRT data:`, data);
    return {
      min: 0,
      average: 0,
      max: 0,
      percentiles: { p25: 0, p50: 0, p75: 0 },
    };
  }
  return data[metric];
};

const getBoxplotArray = (stats: SrtMetricStats): number[] => {
  return [
    stats.min,
    stats.percentiles.p25,
    stats.percentiles.p50,
    stats.percentiles.p75,
    stats.max,
  ];
};

const processDataForSrtBoxplot = (
  reports: SrtReport[],
  metric: MetricKey,
) => {
  const categories: string[] = [];
  const boxplotData: number[][] = [];
  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getMetricStats(report.data, metric);
    boxplotData.push(getBoxplotArray(stats));
  });
  return { categories, boxplotData };
};

const processDataForSrtBarChart = (
  reports: SrtReport[],
  metric: MetricKey,
) => {
  const categories: string[] = [];
  const barData: number[] = [];
  const fullStatsList: SrtMetricStats[] = [];

  reports.forEach((report) => {
    categories.push(report.name);
    const stats = getMetricStats(report.data, metric);
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

const createSrtBoxplotOption = (
  reports: SrtReport[],
  metric: MetricKey,
  title: string,
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const { categories, boxplotData } = processDataForSrtBoxplot(reports, metric);
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
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 },
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

const createSrtBarChartOption = (
  reports: SrtReport[],
  metric: MetricKey,
  title: string,
): echarts.EChartsOption | null => {
  if (!reports || reports.length === 0) return null;

  const { categories, barData, fullStatsList } = processDataForSrtBarChart(
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
    const stats: SrtMetricStats | undefined = fullStatsList[dataIndex];

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
      left: "center",
      textStyle: { fontWeight: "normal", fontSize: 16 },
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

export interface SrtBoxplotChartProps {
  reports: SrtReport[];
  metric: MetricKey;
  title: string;
  height?: number;
}

export const SrtBoxplotChart: Component<SrtBoxplotChartProps> = (props) => {
  const option = () =>
    createSrtBoxplotOption(props.reports, props.metric, props.title);
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

export interface SrtBarChartProps {
  reports: SrtReport[];
  metric: MetricKey;
  title: string;
  height?: number;
}

export const SrtBarChart: Component<SrtBarChartProps> = (props) => {
  const option = () =>
    createSrtBarChartOption(props.reports, props.metric, props.title);
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

export interface SrtChartsDashboardProps {
  reports: SrtReport[];
  height?: {
    bitrate?: number;
    fps?: number;
    droppedFrames?: number;
  };
}

export const SrtChartsDashboard: Component<SrtChartsDashboardProps> = (
  props,
) => {
  const effectiveHeights = {
    bitrate: props.height?.bitrate ?? 500,
    fps: props.height?.fps ?? 400,
    droppedFrames: props.height?.droppedFrames ?? 400,
  };

  if (!props.reports || props.reports.length === 0) {
    return (
      <div style={{ padding: "20px", color: "red", "text-align": "center" }}>
        No SRT streaming report data provided.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "20px",
        padding: "15px",
        "background-color": "#f7f7f7",
      }}
    >
      {/* Average Bitrate (Bar Chart) */}
      <div
        style={{
          "background-color": "#fff",
          padding: "10px",
          "border-radius": "6px",
          "box-shadow": "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <SrtBarChart
          reports={props.reports}
          metric="bitrate_kbps"
          title="Streaming Bitrate"
          height={effectiveHeights.bitrate}
        />
      </div>

      {/* Row for FPS and Dropped Frames */}
      <div style={{ display: "flex", gap: "20px", "flex-wrap": "wrap" }}>
        {/* Average FPS (Bar Chart) */}
        <div
          style={{
            flex: "1 1 45%",
            "min-width": "300px",
            "background-color": "#fff",
            padding: "10px",
            "border-radius": "6px",
            "box-shadow": "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <SrtBarChart
            reports={props.reports}
            metric="fps"
            title="Frame Rate"
            height={effectiveHeights.fps}
          />
        </div>
        {/* Dropped Frames (Boxplot Chart) */}
        <div
          style={{
            flex: "1 1 45%",
            "min-width": "300px",
            "background-color": "#fff",
            padding: "10px",
            "border-radius": "6px",
            "box-shadow": "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <SrtBoxplotChart
            reports={props.reports}
            metric="dropped_frames"
            title="Dropped Frames"
            height={effectiveHeights.droppedFrames}
          />
        </div>
      </div>
    </div>
  );
};

export default SrtChartsDashboard;
