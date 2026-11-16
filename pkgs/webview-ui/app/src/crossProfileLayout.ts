/** Category axis labels for profile names, one word per line so every column fits. */
export const profileAxisLabel = {
  interval: 0,
  formatter: (name: string) => name.replaceAll(" ", "\n"),
};

const COLUMNS = 3;
const HEADER = 95;
const TITLE_GAP = 25;
const PLOT_HEIGHT = 300;
const AXIS_SPACE = 60;
const ROW_HEIGHT = TITLE_GAP + PLOT_HEIGHT + AXIS_SPACE;
const LEFT_PERCENT = 8;
const WIDTH_PERCENT = 25;
const GAP_PERCENT = 6;

export interface SmallMultiplesLayout {
  height: number;
  grids: {
    left: string;
    width: string;
    top: number;
    height: number;
    containLabel: boolean;
  }[];
  titles: { left: string; top: number }[];
  /** Whether the plot starts a row and so carries the y-axis name. */
  rowStarts: boolean[];
}

/**
 * Places one plot per profile in rows of three below the chart title and legend.
 *
 * Args:
 *   count: Number of plots.
 *
 * Returns:
 *   Chart height in pixels, and per plot its grid, subplot title position and row start.
 */
export const smallMultiplesLayout = (count: number): SmallMultiplesLayout => {
  const rows = Math.max(1, Math.ceil(count / COLUMNS));
  const cells = Array.from({ length: count }, (_, i) => ({
    left: LEFT_PERCENT + (i % COLUMNS) * (WIDTH_PERCENT + GAP_PERCENT),
    top: HEADER + Math.floor(i / COLUMNS) * ROW_HEIGHT,
  }));
  return {
    height: HEADER + rows * ROW_HEIGHT,
    grids: cells.map((cell) => ({
      left: `${cell.left}%`,
      width: `${WIDTH_PERCENT}%`,
      top: cell.top + TITLE_GAP,
      height: PLOT_HEIGHT,
      containLabel: true,
    })),
    titles: cells.map((cell) => ({
      left: `${cell.left + WIDTH_PERCENT / 2}%`,
      top: cell.top,
    })),
    rowStarts: cells.map((_, i) => i % COLUMNS === 0),
  };
};
