interface AxisOption {
  type?: string;
  name?: string;
  data?: unknown[];
}

interface SeriesOption {
  type?: string;
  name?: string;
  data?: unknown[];
  xAxisIndex?: number;
  yAxisIndex?: number;
}

interface ChartOption {
  series?: SeriesOption[];
  xAxis?: AxisOption[];
  yAxis?: AxisOption[];
}

interface Axes {
  x?: AxisOption;
  y?: AxisOption;
}

interface Table {
  title: string;
  header: string[];
  rows: string[][];
}

const BOX_COLUMNS = ["Min", "Q1", "Median", "Q3", "Max"];
const ERROR_BAR_PREFIX = "_errorBar_";
const CELL_STYLE = "border:1px solid #ccc;padding:2px 8px;text-align:left";
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ENTITIES[char]);

const unwrap = (item: unknown) =>
  typeof item === "object" && item !== null && "value" in item
    ? item.value
    : item;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const formatValue = (value: unknown): string => {
  const plain = unwrap(value);
  if (plain === null || plain === undefined || plain === "-") return "";
  return String(plain);
};

const formatOnAxis = (axis: AxisOption | undefined, raw: unknown): string => {
  if (axis?.type === "category" && typeof raw === "number") {
    return formatValue(axis.data?.[raw] ?? raw);
  }
  if (
    axis?.type === "time" &&
    (typeof raw === "number" || typeof raw === "string")
  ) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? formatValue(raw) : date.toISOString();
  }
  return formatValue(raw);
};

const categoryAxis = ({ x, y }: Axes) => {
  if (x?.type === "category") return x;
  if (y?.type === "category") return y;
  return undefined;
};

const categoryHeader = (axes: Axes) => categoryAxis(axes)?.name || "Category";

const valueHeader = (axes: Axes) => {
  const valueAxis = categoryAxis(axes) === axes.x ? axes.y : axes.x;
  return valueAxis?.name || "Value";
};

const categoryLabel = (axes: Axes, item: unknown, index: number) => {
  const axis = categoryAxis(axes);
  if (axis) return formatOnAxis(axis, index);
  if (typeof item === "object" && item !== null && "name" in item) {
    return formatValue(item.name);
  }
  return String(index);
};

const boxplotRow = (axes: Axes, item: unknown, index: number) => {
  const value = asArray(unwrap(item));
  const stats = value.slice(-BOX_COLUMNS.length);
  const label =
    value.length > BOX_COLUMNS.length
      ? formatOnAxis(categoryAxis(axes), value[0])
      : categoryLabel(axes, item, index);
  return [label, ...BOX_COLUMNS.map((_, dim) => formatValue(stats[dim]))];
};

const boxplotTable = (series: SeriesOption, axes: Axes): Table => ({
  title: series.name || "Box plot",
  header: [categoryHeader(axes), ...BOX_COLUMNS],
  rows: (series.data ?? []).map((item, index) => boxplotRow(axes, item, index)),
});

const errorBarTitle = (name: string, allSeries: SeriesOption[]) => {
  const barIndex = Number(name.slice(ERROR_BAR_PREFIX.length));
  const bar = allSeries.filter((entry) => entry.type === "bar")[barIndex];
  return bar?.name ? `${bar.name} (range)` : "Error bars";
};

const errorBarTable = (
  series: SeriesOption,
  axes: Axes,
  title: string,
): Table => ({
  title,
  header: [categoryHeader(axes), "Low", "High"],
  rows: (series.data ?? []).map((item) => {
    const [category, low, high] = asArray(unwrap(item));
    return [
      formatOnAxis(categoryAxis(axes) ?? axes.x, category),
      formatValue(low),
      formatValue(high),
    ];
  }),
});

const dimensionHeader = (axes: Axes, dim: number) => {
  if (dim === 0) return axes.x?.name || "X";
  if (dim === 1) return axes.y?.name || "Y";
  return dim === 2 ? "Value" : `Value ${dim - 1}`;
};

const formatDimension = (axes: Axes, raw: unknown, dim: number) => {
  if (dim === 0) return formatOnAxis(axes.x, raw);
  if (dim === 1) return formatOnAxis(axes.y, raw);
  return formatValue(raw);
};

const arrayTable = (series: SeriesOption, axes: Axes): Table => {
  const values = (series.data ?? []).map((item) => asArray(unwrap(item)));
  const width = values.reduce((max, value) => Math.max(max, value.length), 0);
  const dims = Array.from({ length: width }, (_, dim) => dim);
  return {
    title: series.name || "Series",
    header: dims.map((dim) => dimensionHeader(axes, dim)),
    rows: values.map((value) =>
      dims.map((dim) => formatDimension(axes, value[dim], dim)),
    ),
  };
};

const scalarTable = (series: SeriesOption, axes: Axes): Table => ({
  title: series.name || "Series",
  header: [categoryHeader(axes), valueHeader(axes)],
  rows: (series.data ?? []).map((item, index) => [
    categoryLabel(axes, item, index),
    formatValue(unwrap(item)),
  ]),
});

const seriesTable = (series: SeriesOption, chart: ChartOption): Table => {
  const axes = {
    x: chart.xAxis?.[series.xAxisIndex ?? 0],
    y: chart.yAxis?.[series.yAxisIndex ?? 0],
  };
  if (series.type === "boxplot") return boxplotTable(series, axes);
  if (series.name?.startsWith(ERROR_BAR_PREFIX)) {
    const title = errorBarTitle(series.name, chart.series ?? []);
    return errorBarTable(series, axes, title);
  }
  const hasArrays = (series.data ?? []).some((item) =>
    Array.isArray(unwrap(item)),
  );
  return hasArrays ? arrayTable(series, axes) : scalarTable(series, axes);
};

const renderCells = (cells: string[], tag: "th" | "td") =>
  cells
    .map((cell) => `<${tag} style="${CELL_STYLE}">${escapeHtml(cell)}</${tag}>`)
    .join("");

const renderTable = ({ title, header, rows }: Table) => {
  const head = `<tr>${renderCells(header, "th")}</tr>`;
  const body = rows.map((row) => `<tr>${renderCells(row, "td")}</tr>`);
  return (
    `<h5 style="margin:12px 0 4px">${escapeHtml(title)}</h5>` +
    `<table style="border-collapse:collapse;font-size:12px">` +
    `<thead>${head}</thead><tbody>${body.join("")}</tbody></table>`
  );
};

export const seriesDataToHtml = (option: unknown): string => {
  const chart = option as ChartOption;
  const tables = (chart.series ?? [])
    .filter((series) => (series.data?.length ?? 0) > 0)
    .map((series) => renderTable(seriesTable(series, chart)));
  return `<div style="padding:0 20px">${tables.join("")}</div>`;
};
