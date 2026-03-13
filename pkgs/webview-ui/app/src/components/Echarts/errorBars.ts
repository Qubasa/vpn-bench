import type {
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  CustomSeriesRenderItemReturn,
} from "echarts";

export interface ErrorBarDataPoint {
  min: number;
  max: number;
}

/**
 * Creates an ECharts custom series that renders error bar whiskers
 * (vertical line with horizontal caps) for each data point,
 * with optional labels positioned above the top cap.
 *
 * @param data - Array of min/max values per category. Use null to skip a category.
 * @param options - Configuration for positioning, styling, and labels.
 */
export function createErrorBarSeries(
  data: (ErrorBarDataPoint | null)[],
  options?: {
    color?: string;
    capWidth?: number;
    /** For grouped bars: 0-based index of the bar this error bar belongs to */
    barIndex?: number;
    /** Total number of bar series in the chart */
    totalBars?: number;
    /** Labels to render above the top cap of each error bar */
    labels?: {
      values: (string | null)[];
      color?: string;
      fontSize?: number;
    };
  },
) {
  const color = options?.color ?? "#666";
  const capHalfWidth = (options?.capWidth ?? 6) / 2;
  const barIndex = options?.barIndex ?? 0;
  const totalBars = options?.totalBars ?? 1;
  const labels = options?.labels;

  // Encode: dimension 0 = category index, 1 = min, 2 = max
  // When labels are provided, keep points even when min === max (to render label above bar)
  const seriesData = data
    .map((d, i) => {
      if (!d) return null;
      if (d.min === d.max && !labels) return null;
      return [i, d.min, d.max];
    })
    .filter((d): d is number[] => d !== null);

  return {
    type: "custom" as const,
    name: `_errorBar_${barIndex}`,
    data: seriesData,
    z: 10,
    silent: true,
    renderItem: (
      _params: CustomSeriesRenderItemParams,
      api: CustomSeriesRenderItemAPI,
    ): CustomSeriesRenderItemReturn => {
      const categoryIndex = api.value(0) as number;
      const min = api.value(1) as number;
      const max = api.value(2) as number;

      const categoryWidth = (api.size!([1, 0]) as number[])[0];

      // Calculate x offset for grouped bars.
      // ECharts defaults: barCategoryGap ~20%, barGap ~30%.
      let xOffset = 0;
      if (totalBars > 1) {
        const availableWidth = categoryWidth * 0.8;
        const barWidth = availableWidth / (totalBars + (totalBars - 1) * 0.3);
        const totalBarsWidth =
          totalBars * barWidth + (totalBars - 1) * barWidth * 0.3;
        xOffset =
          -totalBarsWidth / 2 + barIndex * barWidth * 1.3 + barWidth / 2;
      }

      const coordTop = api.coord!([categoryIndex, max]);
      const coordBottom = api.coord!([categoryIndex, min]);

      const x = coordTop[0] + xOffset;
      const yTop = coordTop[1];
      const yBottom = coordBottom[1];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const children: any[] = [];

      // Only render whiskers if there's a range
      if (min !== max) {
        children.push(
          {
            type: "line",
            shape: { x1: x, y1: yTop, x2: x, y2: yBottom },
            style: { stroke: color, lineWidth: 1.5 },
          },
          {
            type: "line",
            shape: {
              x1: x - capHalfWidth,
              y1: yTop,
              x2: x + capHalfWidth,
              y2: yTop,
            },
            style: { stroke: color, lineWidth: 1.5 },
          },
          {
            type: "line",
            shape: {
              x1: x - capHalfWidth,
              y1: yBottom,
              x2: x + capHalfWidth,
              y2: yBottom,
            },
            style: { stroke: color, lineWidth: 1.5 },
          },
        );
      }

      // Render label above the top cap (or above the bar if no whiskers)
      if (labels) {
        const labelText = labels.values[categoryIndex];
        if (labelText) {
          children.push({
            type: "text",
            x: x,
            y: yTop - 6,
            style: {
              text: labelText,
              textAlign: "center",
              textVerticalAlign: "bottom",
              fill: labels.color ?? "#555",
              fontSize: labels.fontSize ?? 10,
            },
          });
        }
      }

      return {
        type: "group",
        children,
      };
    },
  };
}
