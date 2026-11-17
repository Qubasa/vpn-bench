import * as echarts from "echarts";
import { createEffect, onCleanup, onMount, on } from "solid-js";
import { EChartsCoreOption, ResizeOpts } from "echarts";
import { JSX } from "solid-js";
import { seriesDataToHtml } from "./dataView";

export interface EChartsProps {
  option: EChartsCoreOption;
  resize?: Omit<ResizeOpts, "width" | "height">;
  style?: JSX.CSSProperties;
  width?: number | "auto";
  height: number | "auto";
  class?: string;
  theme?: string | object;
}

const EXPORT_WIDTH = 800;
const EXPORT_PIXEL_RATIO = 3;
const DOWNLOAD_ICON =
  "path://M4.7,22.9L29.3,45.5L54.7,23.4M4.6,43.6L4.6,58L53.8,58L53.8,43.6M29.2,45.1L29.2,0";

interface Toolbox {
  feature?: Record<string, unknown>;
}

const downloadAtExportSize = (
  chart: echarts.ECharts,
  theme: EChartsProps["theme"],
) => {
  const option = chart.getOption();
  const exporter = echarts.init(document.createElement("div"), theme, {
    width: EXPORT_WIDTH,
    height: chart.getHeight(),
  });
  const legend = (option.legend as object[] | undefined)?.map((entry) => ({
    ...entry,
    type: "plain",
  }));
  exporter.setOption({ ...option, legend, animation: false });
  const url = exporter.getDataURL({
    type: "png",
    pixelRatio: EXPORT_PIXEL_RATIO,
    backgroundColor: "#fff",
    excludeComponents: ["toolbox"],
  });
  exporter.dispose();
  const titles = option.title as { text?: string }[] | undefined;
  const link = document.createElement("a");
  link.href = url;
  link.download = `${titles?.[0]?.text || "chart"}.png`;
  link.click();
};

// Swaps the canvas snapshot for a render at EXPORT_WIDTH so every download
// has the same size whatever the window width, and shows every value of
// boxplot and error bar series in the data view
const overrideFeature = (
  name: string,
  config: unknown,
  download: () => void,
): [string, unknown] => {
  if (name === "saveAsImage") {
    const { title } = (config ?? {}) as { title?: string };
    return [
      "myFixedSizeImage",
      {
        title: title ?? "Save as Image",
        icon: DOWNLOAD_ICON,
        onclick: download,
      },
    ];
  }
  const dataView = (config ?? {}) as { optionToContent?: unknown };
  if (name === "dataView" && !dataView.optionToContent) {
    return [
      name,
      { ...dataView, readOnly: true, optionToContent: seriesDataToHtml },
    ];
  }
  return [name, config];
};

const withToolboxOverrides = (
  option: EChartsCoreOption,
  download: () => void,
): EChartsCoreOption => {
  const toolbox = option.toolbox as Toolbox | undefined;
  if (!toolbox?.feature) {
    return option;
  }
  const feature = Object.fromEntries(
    Object.entries(toolbox.feature).map(([name, config]) =>
      overrideFeature(name, config, download),
    ),
  );
  return { ...option, toolbox: { ...toolbox, feature } };
};

export const Echart = (props: EChartsProps) => {
  let chartRef: HTMLDivElement | undefined;
  let chartInstance: echarts.ECharts | null = null;

  // Single effect with explicit dependency tracking using on()
  createEffect(
    on(
      // Explicitly track only props.option changes
      () => props.option,
      (option) => {
        // Initialize chart on first run if not exists
        if (!chartInstance && chartRef) {
          chartInstance = echarts.init(chartRef, props.theme, {
            width: props.width,
            height: props.height,
            ...props.resize,
          });
        }

        // Update chart with new option (runs on first and subsequent updates)
        if (chartInstance) {
          chartInstance.setOption(
            withToolboxOverrides(option, () => {
              if (chartInstance) {
                downloadAtExportSize(chartInstance, props.theme);
              }
            }),
            {
              notMerge: true,
              lazyUpdate: false,
            },
          );
        }
      },
      // Don't defer - we want this to run on mount
      { defer: false },
    ),
  );

  const fitContainer = () =>
    chartInstance?.resize({ width: props.width, height: props.height });

  createEffect(on(() => props.height, fitContainer, { defer: true }));

  onMount(() => {
    const observer = new ResizeObserver(fitContainer);
    if (chartRef) {
      observer.observe(chartRef);
    }
    onCleanup(() => observer.disconnect());
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (chartInstance) {
      chartInstance.dispose();
      chartInstance = null;
    }
  });

  return <div ref={chartRef} style={{ contain: "inline-size" }}></div>;
};
