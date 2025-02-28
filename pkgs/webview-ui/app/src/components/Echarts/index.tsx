import * as echarts from "echarts";
import { createEffect, createSignal } from "solid-js";
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
  const [perfChart, setPerfChart] = createSignal<echarts.ECharts | null>(null);

  createEffect(() => {
    setPerfChart(
      echarts.init(chartRef, props.theme, {
        width: props.width,
        height: props.height,
        ...props.resize,
      }),
    );
  });

  createEffect(() => {
    perfChart()?.setOption(props.option);
  });

  return <div ref={chartRef}></div>;
};
