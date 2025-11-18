import * as echarts from "echarts";
import { createEffect, onCleanup, on } from "solid-js";
import { EChartsCoreOption, ResizeOpts } from "echarts";
import { JSX } from "solid-js";

export interface EChartsProps {
  option: EChartsCoreOption;
  resize?: Omit<ResizeOpts, "width" | "height">;
  style?: JSX.CSSProperties;
  width?: number | "auto";
  height: number | "auto";
  class?: string;
  theme?: string | object;
}

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
          chartInstance.setOption(option, {
            notMerge: true,
            lazyUpdate: false,
          });
        }
      },
      // Don't defer - we want this to run on mount
      { defer: false },
    ),
  );

  // Cleanup on unmount
  onCleanup(() => {
    if (chartInstance) {
      chartInstance.dispose();
      chartInstance = null;
    }
  });

  return <div ref={chartRef}></div>;
};
