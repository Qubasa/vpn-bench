import { Show, createMemo } from "solid-js";
import { ComparisonData } from "@/src/benchData";
import { ConnectionTimingsChart } from "../GeneralDashboard";
import "../VpnBenchDashboard/style.css";

interface ConnectionTimesDashboardProps {
  comparisonData?: ComparisonData;
}

// Helper component for consistent "No Data" message
const FallbackMessage = (props: { message?: string }) => (
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
      {props.message ||
        "No connection timing data available. Run benchmarks to generate timing data."}
    </p>
  </div>
);

export const ConnectionTimesDashboard = (
  props: ConnectionTimesDashboardProps,
) => {
  // Get baseline profile data (connection times are only relevant for baseline)
  const baselineData = createMemo(
    () => props.comparisonData?.baseline ?? undefined,
  );

  return (
    <div>
      {/* Connection Timings Charts */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
        <Show
          when={baselineData()?.connectionTimings}
          fallback={
            <FallbackMessage message="No bootstrap connection timing data available." />
          }
        >
          {(timings) => (
            <ConnectionTimingsChart
              report={timings()}
              title="Bootstrap Connection Times"
            />
          )}
        </Show>
        <Show when={baselineData()?.rebootConnectionTimings}>
          {(timings) => (
            <ConnectionTimingsChart
              report={timings()}
              title="Reboot Connection Times"
            />
          )}
        </Show>
      </div>
    </div>
  );
};
