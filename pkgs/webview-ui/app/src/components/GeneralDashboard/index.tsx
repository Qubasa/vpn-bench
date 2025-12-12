import { Echart } from "../Echarts";
import { Show, createSignal, createEffect, createMemo, For } from "solid-js";
import { ComparisonData, TCSettingsData } from "@/src/benchData";
import { Tabs } from "@kobalte/core/tabs";
import {
  TcpComparisonSection,
  UdpComparisonSection,
  PingComparisonSection,
  QperfComparisonSection,
  VideoStreamingComparisonSection,
  NixCacheComparisonSection,
  ParallelTcpComparisonSection,
} from "../ComparisonCharts";
import { useSearchParams } from "@solidjs/router";
import "../VpnBenchDashboard/style.css";

export type ConnectionData = Record<string, string>;

// ConnectionTimings structure: VPN name -> machine name -> time string
// Each TC profile has its own file, so no profile nesting needed here
export type ConnectionTimings = Record<string, ConnectionData>;

// Convert time string (H:MM:SS.MS) to milliseconds
const timeToMs = (timeStr: string) => {
  if (!timeStr || typeof timeStr !== "string") {
    return NaN; // Will be filtered out later
  }

  try {
    const parts = timeStr.split(":");
    if (parts.length !== 3) {
      return NaN;
    }

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      return NaN;
    }

    return (hours * 60 * 60 + minutes * 60 + seconds) * 1000;
  } catch (e) {
    return NaN;
  }
};

// Process data for boxplot visualization
const processDataForBoxplot = (report: ConnectionTimings) => {
  const services = Object.keys(report);
  const boxplotData = [];
  const categories = [];

  for (const service of services) {
    const machineData = report[service];

    // Get time values and ensure we have valid data
    const timeValues = Object.values(machineData);
    if (timeValues.length === 0) {
      continue; // Skip empty services
    }

    // Convert and filter out any invalid times
    const timings = timeValues
      .map((time) => {
        try {
          return timeToMs(time);
        } catch (e) {
          console.warn(`Invalid time format for service ${service}:`, time);
          return null;
        }
      })
      .filter(
        (time) => time !== null && !isNaN(time) && isFinite(time),
      ) as number[];

    // Skip if we don't have valid timings
    if (timings.length === 0) {
      console.warn(`No valid timing data for service ${service}`);
      continue;
    }

    // Sort for calculations
    timings.sort((a, b) => a - b);

    // Calculate boxplot statistics safely
    const min = timings[0];
    const max = timings[timings.length - 1];

    let median;
    if (timings.length === 1) {
      median = timings[0];
    } else if (timings.length % 2 === 0) {
      median =
        (timings[timings.length / 2 - 1] + timings[timings.length / 2]) / 2;
    } else {
      median = timings[Math.floor(timings.length / 2)];
    }

    // Q1 and Q3 calculation with better handling of small datasets
    let q1, q3;
    if (timings.length <= 2) {
      q1 = min;
      q3 = max;
    } else {
      q1 = timings[Math.floor(timings.length / 4)];
      q3 = timings[Math.floor((3 * timings.length) / 4)];
    }

    boxplotData.push([min, q1, median, q3, max]);
    categories.push(service);
  }

  return { boxplotData, categories };
};

const createConnectionTimingsOption = (
  report: ConnectionTimings,
  title: string,
) => {
  const { boxplotData, categories } = processDataForBoxplot(report);

  // Add raw data points as scatter plot
  const scatterData: (string | number)[][] = [];
  for (let i = 0; i < categories.length; i++) {
    const service = categories[i];
    const nodeData = report[service];

    Object.entries(nodeData).forEach(([node, timeStr]) => {
      try {
        const ms = timeToMs(timeStr);
        if (!isNaN(ms) && isFinite(ms)) {
          scatterData.push([i, ms, node]); // [category index, value, node name]
        }
      } catch (e) {
        console.warn(`Could not process node ${node} for service ${service}`);
      }
    });
  }

  // Create markPoint data for max values on top of each boxplot
  const maxMarkPoints = boxplotData.map((data, index) => ({
    xAxis: index,
    yAxis: data[4], // max value is at index 4
    value: data[4],
  }));

  return {
    title: {
      text: title,
      subtext: "Lower is better",
      left: "center",
      subtextStyle: { color: "#888", fontSize: 12 },
    },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { show: true, readOnly: false },
      },
    },
    tooltip: {
      trigger: "item",
      axisPointer: {
        type: "shadow",
      },
      formatter: function (params: {
        seriesIndex: number;
        name: string;
        data: number[];
      }) {
        if (params.seriesIndex === 0) {
          // Boxplot tooltip
          return `${params.name}<br/>
                 Min: ${(params.data[0] / 1000).toFixed(2)}s<br/>
                 Q1: ${(params.data[1] / 1000).toFixed(2)}s<br/>
                 Median: ${(params.data[2] / 1000).toFixed(2)}s<br/>
                 Q3: ${(params.data[3] / 1000).toFixed(2)}s<br/>
                 Max: ${(params.data[4] / 1000).toFixed(2)}s`;
        } else {
          // Scatter tooltip
          return `${categories[params.data[0]]}<br/>
                 Node: ${params.data[2]}<br/>
                 Time: ${(params.data[1] / 1000).toFixed(2)}s`;
        }
      },
    },
    grid: {
      left: "10%",
      right: "10%",
      bottom: "15%",
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: true,
      nameGap: 30,
      splitArea: {
        show: false,
      },
      axisLabel: {
        show: true,
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "value",
      name: "Time (seconds)",
      splitArea: {
        show: true,
      },
      axisLabel: {
        formatter: function (value: number) {
          return (value / 1000).toFixed(1) + "s";
        },
      },
    },
    series: [
      {
        name: "Connection Times",
        type: "boxplot",
        data: boxplotData,
        tooltip: { trigger: "item" },
        itemStyle: {
          borderWidth: 2,
          borderColor: "#1890ff",
        },
        markPoint: {
          data: maxMarkPoints,
          symbol: "circle",
          symbolSize: 1,
          label: {
            show: true,
            position: "top",
            formatter: function (params: { value: number }) {
              return (params.value / 1000).toFixed(2) + "s";
            },
            fontSize: 11,
            color: "#333",
          },
        },
      },
      {
        name: "Nodes",
        type: "scatter",
        data: scatterData,
        symbolSize: 10,
        itemStyle: {
          color: "#ff5722",
        },
      },
    ],
  };
};

export const ConnectionTimingsChart = (props: {
  report: ConnectionTimings;
  height?: number;
  title: string;
}) => {
  return (
    <Echart
      option={createConnectionTimingsOption(props.report, props.title)}
      height={props.height ?? 700}
    />
  );
};

interface GeneralDashboardProps {
  comparisonData?: ComparisonData;
  allVpnNames?: string[]; // All VPN names from benchData to show incomplete VPNs
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
        "No comparison data available. Run 'vpn-bench compare' to generate comparison data."}
    </p>
  </div>
);

// TC Settings Display Component for showing network conditions
const TCSettingsDisplay = (props: {
  tcSettings: TCSettingsData | null | undefined;
}) => {
  const getTotalLatency = () => props.tcSettings?.settings?.latency_ms ?? null;
  const getTotalJitter = () => props.tcSettings?.settings?.jitter_ms ?? null;
  const getTotalPacketLoss = () =>
    props.tcSettings?.settings?.packet_loss_percent ?? null;
  const getTotalReorder = () =>
    props.tcSettings?.settings?.reorder_percent ?? null;

  const hasSettings = () =>
    props.tcSettings?.settings &&
    (props.tcSettings.settings.latency_ms != null ||
      props.tcSettings.settings.jitter_ms != null ||
      props.tcSettings.settings.packet_loss_percent != null ||
      props.tcSettings.settings.reorder_percent != null ||
      props.tcSettings.settings.bandwidth_mbit != null);

  return (
    <div
      style={{
        "margin-bottom": "1.5rem",
        "border-radius": "0.5rem",
        border: "2px solid #e5e7eb",
        "background-color": "#f9fafb",
        padding: "1rem",
      }}
    >
      <h3
        style={{
          "margin-bottom": "0.5rem",
          "font-size": "1.125rem",
          "font-weight": "600",
          color: "#111827",
        }}
      >
        Network Conditions
      </h3>
      {hasSettings() ? (
        <>
          <p
            style={{
              "font-size": "0.75rem",
              "font-style": "italic",
              color: "#6b7280",
            }}
          >
            Total round-trip impairment (half applied to each endpoint)
          </p>
          <div
            style={{
              "margin-top": "0.75rem",
              display: "grid",
              "grid-template-columns": "repeat(auto-fit, minmax(100px, 1fr))",
              gap: "0.75rem",
              "font-size": "0.875rem",
            }}
          >
            {getTotalLatency() !== null && (
              <div
                style={{
                  "border-radius": "0.25rem",
                  "background-color": "white",
                  padding: "0.5rem",
                }}
              >
                <div style={{ "font-weight": "500", color: "#4b5563" }}>
                  Latency
                </div>
                <div
                  style={{
                    "font-size": "1.125rem",
                    "font-weight": "600",
                    color: "#111827",
                  }}
                >
                  {getTotalLatency()}ms
                </div>
              </div>
            )}
            {getTotalJitter() !== null && (
              <div
                style={{
                  "border-radius": "0.25rem",
                  "background-color": "white",
                  padding: "0.5rem",
                }}
              >
                <div style={{ "font-weight": "500", color: "#4b5563" }}>
                  Jitter
                </div>
                <div
                  style={{
                    "font-size": "1.125rem",
                    "font-weight": "600",
                    color: "#111827",
                  }}
                >
                  {getTotalJitter()}ms
                </div>
              </div>
            )}
            {getTotalPacketLoss() !== null && (
              <div
                style={{
                  "border-radius": "0.25rem",
                  "background-color": "white",
                  padding: "0.5rem",
                }}
              >
                <div style={{ "font-weight": "500", color: "#4b5563" }}>
                  Packet Loss
                </div>
                <div
                  style={{
                    "font-size": "1.125rem",
                    "font-weight": "600",
                    color: "#111827",
                  }}
                >
                  {getTotalPacketLoss()}%
                </div>
              </div>
            )}
            {getTotalReorder() !== null && (
              <div
                style={{
                  "border-radius": "0.25rem",
                  "background-color": "white",
                  padding: "0.5rem",
                }}
              >
                <div style={{ "font-weight": "500", color: "#4b5563" }}>
                  Reordering
                </div>
                <div
                  style={{
                    "font-size": "1.125rem",
                    "font-weight": "600",
                    color: "#111827",
                  }}
                >
                  {getTotalReorder()}%
                </div>
              </div>
            )}
            {props.tcSettings?.settings?.bandwidth_mbit != null && (
              <div
                style={{
                  "border-radius": "0.25rem",
                  "background-color": "white",
                  padding: "0.5rem",
                }}
              >
                <div style={{ "font-weight": "500", color: "#4b5563" }}>
                  Bandwidth
                </div>
                <div
                  style={{
                    "font-size": "1.125rem",
                    "font-weight": "600",
                    color: "#111827",
                  }}
                >
                  {props.tcSettings.settings.bandwidth_mbit} Mbit/s
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <p style={{ "font-size": "1rem", color: "#374151" }}>
          No network impairment applied
        </p>
      )}
    </div>
  );
};

export const GeneralDashboard = (props: GeneralDashboardProps) => {
  // Get URL search params for state sync
  const [searchParams, setSearchParams] = useSearchParams();

  // Get TC profile aliases from comparison data
  const runAliases = createMemo(() =>
    props.comparisonData ? Object.keys(props.comparisonData) : [],
  );

  // Initialize profile from URL or fallback to "baseline"
  const initialProfile =
    searchParams.profile && runAliases().includes(searchParams.profile)
      ? searchParams.profile
      : runAliases().includes("baseline")
        ? "baseline"
        : runAliases()[0] || "";

  const [selectedProfile, setSelectedProfile] = createSignal(initialProfile);

  // Handler for profile change
  const handleProfileChange = (newProfile: string) => {
    setSelectedProfile(newProfile);
    setSearchParams({ profile: newProfile, tab: searchParams.tab });
  };

  // Get current profile's data (memoized)
  const currentProfileData = createMemo(() =>
    props.comparisonData && selectedProfile()
      ? props.comparisonData[selectedProfile()]
      : undefined,
  );

  // Valid tab values
  const validTabs = [
    "connection-times",
    "tcp-comparison",
    "udp-comparison",
    "ping-comparison",
    "qperf-comparison",
    "video-comparison",
    "nix-cache-comparison",
    "parallel-tcp-comparison",
  ] as const;

  type ValidTab = (typeof validTabs)[number];

  // Initialize from URL or default
  const initialTab =
    searchParams.tab && validTabs.includes(searchParams.tab as ValidTab)
      ? searchParams.tab
      : "connection-times";

  const [selectedTab, setSelectedTab] = createSignal(initialTab);

  // Handler that updates both local state AND URL
  const handleTabChange = (newTab: string) => {
    setSelectedTab(newTab);
    setSearchParams({ profile: searchParams.profile, tab: newTab });
  };

  // Sync with URL changes (e.g., browser back/forward)
  createEffect(() => {
    const urlTab = searchParams.tab;
    if (urlTab && validTabs.includes(urlTab as ValidTab)) {
      setSelectedTab(urlTab);
    }
    const urlProfile = searchParams.profile;
    if (urlProfile && runAliases().includes(urlProfile)) {
      setSelectedProfile(urlProfile);
    }
  });

  return (
    <div>
      {/* TC Profile Selector */}
      <Show when={runAliases().length > 1}>
        <Tabs
          value={selectedProfile()}
          onChange={handleProfileChange}
          class="tc-profile-tabs"
        >
          <Tabs.List class="tc-profile-tabs__list">
            <For each={runAliases()}>
              {(alias) => (
                <Tabs.Trigger class="tc-profile-tabs__trigger" value={alias}>
                  {alias
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                </Tabs.Trigger>
              )}
            </For>
            <Tabs.Indicator class="tc-profile-tabs__indicator" />
          </Tabs.List>
        </Tabs>
      </Show>

      {/* Display TC settings for current profile */}
      <TCSettingsDisplay tcSettings={currentProfileData()?.tcSettings} />

      {/* Benchmark Type Tabs */}
      <Tabs
        aria-label="VPN Comparison Dashboard"
        class="tabs"
        value={selectedTab()}
        onChange={handleTabChange}
      >
        <Tabs.List class="tabs__list">
          <Tabs.Trigger class="tabs__trigger" value="connection-times">
            Connection Times
          </Tabs.Trigger>
          <Tabs.Trigger class="tabs__trigger" value="tcp-comparison">
            TCP Performance
          </Tabs.Trigger>
          <Tabs.Trigger class="tabs__trigger" value="udp-comparison">
            UDP Performance
          </Tabs.Trigger>
          <Tabs.Trigger class="tabs__trigger" value="ping-comparison">
            Ping Latency
          </Tabs.Trigger>
          <Tabs.Trigger class="tabs__trigger" value="qperf-comparison">
            HTTP3 Performance
          </Tabs.Trigger>
          <Tabs.Trigger class="tabs__trigger" value="video-comparison">
            Video Streaming
          </Tabs.Trigger>
          <Tabs.Trigger class="tabs__trigger" value="nix-cache-comparison">
            Nix Cache
          </Tabs.Trigger>
          <Tabs.Trigger class="tabs__trigger" value="parallel-tcp-comparison">
            Parallel TCP
          </Tabs.Trigger>
          <Tabs.Indicator class="tabs__indicator" />
        </Tabs.List>

        <Tabs.Content class="tabs__content" value="connection-times">
          <div
            style={{ display: "flex", "flex-direction": "column", gap: "20px" }}
          >
            <Show
              when={currentProfileData()?.connectionTimings}
              fallback={
                <FallbackMessage message="No bootstrap connection timing data available." />
              }
            >
              {(timings) => (
                <ConnectionTimingsChart
                  report={timings()}
                  height={700}
                  title="Bootstrap Connection Times"
                />
              )}
            </Show>
            <Show when={currentProfileData()?.rebootConnectionTimings}>
              {(timings) => (
                <ConnectionTimingsChart
                  report={timings()}
                  height={700}
                  title="Reboot Connection Times"
                />
              )}
            </Show>
          </div>
        </Tabs.Content>

        <Tabs.Content class="tabs__content" value="tcp-comparison">
          <Show
            when={currentProfileData()?.tcpIperf}
            fallback={<FallbackMessage />}
          >
            {(data) => (
              <TcpComparisonSection
                data={data()}
                allVpnNames={props.allVpnNames}
              />
            )}
          </Show>
        </Tabs.Content>

        <Tabs.Content class="tabs__content" value="udp-comparison">
          <Show
            when={currentProfileData()?.udpIperf}
            fallback={<FallbackMessage />}
          >
            {(data) => (
              <UdpComparisonSection
                data={data()}
                allVpnNames={props.allVpnNames}
              />
            )}
          </Show>
        </Tabs.Content>

        <Tabs.Content class="tabs__content" value="ping-comparison">
          <Show
            when={currentProfileData()?.ping}
            fallback={<FallbackMessage />}
          >
            {(data) => (
              <PingComparisonSection
                data={data()}
                allVpnNames={props.allVpnNames}
              />
            )}
          </Show>
        </Tabs.Content>

        <Tabs.Content class="tabs__content" value="qperf-comparison">
          <Show
            when={currentProfileData()?.qperf}
            fallback={<FallbackMessage />}
          >
            {(data) => (
              <QperfComparisonSection
                data={data()}
                allVpnNames={props.allVpnNames}
              />
            )}
          </Show>
        </Tabs.Content>

        <Tabs.Content class="tabs__content" value="video-comparison">
          <Show
            when={currentProfileData()?.videoStreaming}
            fallback={<FallbackMessage />}
          >
            {(data) => (
              <VideoStreamingComparisonSection
                data={data()}
                allVpnNames={props.allVpnNames}
              />
            )}
          </Show>
        </Tabs.Content>

        <Tabs.Content class="tabs__content" value="nix-cache-comparison">
          <Show
            when={currentProfileData()?.nixCache}
            fallback={<FallbackMessage />}
          >
            {(data) => (
              <NixCacheComparisonSection
                data={data()}
                allVpnNames={props.allVpnNames}
              />
            )}
          </Show>
        </Tabs.Content>

        <Tabs.Content class="tabs__content" value="parallel-tcp-comparison">
          <Show
            when={currentProfileData()?.parallelTcp}
            fallback={<FallbackMessage />}
          >
            {(data) => (
              <ParallelTcpComparisonSection
                data={data()}
                allVpnNames={props.allVpnNames}
              />
            )}
          </Show>
        </Tabs.Content>
      </Tabs>
    </div>
  );
};
