import { Show } from "solid-js";
import type { CellSource } from "@/src/analysisData";
import type { Cell } from "./matrix";
import { CELL_STYLES } from "./spec";

interface MatrixCellProps {
  cell: Cell;
  /** `<vpn> · <feature>`, shown on hover with the cell's value. */
  label: string;
  source?: CellSource;
}

/** A matrix tile; with a source, a link to the evidence at the analyzed revision. */
export const MatrixCell = (props: MatrixCellProps) => {
  const style = () => CELL_STYLES[props.cell];
  const tile = () =>
    `flex h-7 items-center justify-center rounded ${style().class}`;
  const title = () => `${props.label}: ${style().label}`;
  return (
    <Show
      when={props.source}
      fallback={
        <div class={tile()} title={title()}>
          {style().symbol}
        </div>
      }
    >
      {(source) => (
        <a
          class={`${tile()} hover:ring-2 hover:ring-gray-700`}
          href={source().url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${title()}\nSource: ${source().citation}`}
        >
          {style().symbol}
        </a>
      )}
    </Show>
  );
};
