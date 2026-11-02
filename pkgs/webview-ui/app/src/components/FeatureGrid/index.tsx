import { For } from "solid-js";
import { type FeatureMatrix, resolveGrid } from "./matrix";
import { CELL_STYLES, GRID } from "./spec";

export const FeatureGrid = (props: { matrix: FeatureMatrix }) => {
  const matrix = props.matrix;
  const groups = resolveGrid(matrix, GRID);
  const columns = groups.flatMap((group) => group.columns);

  return (
    <section class="mb-10 max-w-full overflow-x-auto">
      <h2 class="mb-1 text-xl font-semibold">Trade-offs at a glance</h2>
      <p class="mb-4 max-w-3xl text-sm text-gray-600">
        Every tile is read from the matching row of the feature matrix below.
        Hover a header or tile for the full row name.
      </p>
      <div
        class="inline-grid gap-1 text-xs"
        style={{
          "grid-template-columns": `max-content repeat(${columns.length}, 2.75rem)`,
        }}
      >
        <div />
        <For each={groups}>
          {(group) => (
            <div
              class="mx-1 border-b-2 border-gray-400 pb-1 text-center font-semibold"
              style={{ "grid-column": `span ${group.columns.length}` }}
            >
              {group.title}
            </div>
          )}
        </For>
        <div />
        <For each={columns}>
          {(column) => (
            <div class="flex items-end justify-center pb-1" title={column.feature}>
              <span style={{ "writing-mode": "vertical-rl", transform: "rotate(180deg)" }}>
                {column.label}
              </span>
            </div>
          )}
        </For>
        <For each={matrix.vpns}>
          {(vpn, row) => (
            <>
              <div class="self-center pr-2 text-right text-sm font-semibold">{vpn}</div>
              <For each={columns}>
                {(column) => {
                  const style = CELL_STYLES[column.cells[row()]];
                  return (
                    <div
                      class={`flex h-7 items-center justify-center rounded ${style.class}`}
                      title={`${vpn} · ${column.feature}: ${style.label}`}
                    >
                      {style.symbol}
                    </div>
                  );
                }}
              </For>
            </>
          )}
        </For>
      </div>
      <ul class="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
        <For each={Object.values(CELL_STYLES)}>
          {(style) => (
            <li class="flex items-center gap-1">
              <span class={`flex size-4 items-center justify-center rounded ${style.class}`}>
                {style.symbol}
              </span>
              {style.label}
            </li>
          )}
        </For>
      </ul>
    </section>
  );
};
