import { For, Show, createMemo } from "solid-js";
import { useAlias } from "@/src/AliasContext";
import {
  getHardwareDataForAlias,
  type MachineHardware,
} from "@/src/benchData";
import { Typography } from "../Typography";

// Comparison table component for quick overview
const HardwareComparisonTable = (props: { machines: MachineHardware[] }) => {
  return (
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-secondary-100">
            <th class="border border-secondary-200 p-2 text-left">Machine</th>
            <th class="border border-secondary-200 p-2 text-left">CPU</th>
            <th class="border border-secondary-200 p-2 text-center">
              Cores / Threads
            </th>
            <th class="border border-secondary-200 p-2 text-center">RAM</th>
            <th class="border border-secondary-200 p-2 text-left">
              Network Driver
            </th>
            <th class="border border-secondary-200 p-2 text-left">
              Crypto Features
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.machines}>
            {(machine) => (
              <tr class="hover:bg-secondary-50">
                <td class="border border-secondary-200 p-2 font-medium">
                  {machine.machine_name}
                </td>
                <td class="border border-secondary-200 p-2">
                  <div>{machine.cpu.vendor_name}</div>
                  <div class="text-xs text-secondary-600">
                    {machine.cpu.architecture} (Model {machine.cpu.model})
                  </div>
                </td>
                <td class="border border-secondary-200 p-2 text-center">
                  {machine.cpu.cores} / {machine.cpu.siblings}
                </td>
                <td class="border border-secondary-200 p-2 text-center">
                  {machine.memory.total_gb.toFixed(1)} GB
                </td>
                <td class="border border-secondary-200 p-2">
                  {machine.network_controllers[0]?.driver || "N/A"}
                  <Show when={machine.network_controllers[0]?.unix_device_name}>
                    <div class="text-xs text-secondary-600">
                      {machine.network_controllers[0]?.unix_device_name}
                    </div>
                  </Show>
                </td>
                <td class="border border-secondary-200 p-2">
                  <div class="flex flex-wrap gap-1">
                    <For
                      each={machine.cpu.features.filter((f) =>
                        ["aes", "avx", "avx2", "avx512f", "sse4_2"].includes(
                          f.toLowerCase(),
                        ),
                      )}
                    >
                      {(feature) => (
                        <span class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                          {feature}
                        </span>
                      )}
                    </For>
                  </div>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
};

// Machine hardware card component for detailed view
const MachineCard = (props: { machine: MachineHardware }) => {
  return (
    <div class="rounded-lg border border-secondary-200 bg-white p-4 shadow-sm">
      <Typography
        tag="h3"
        hierarchy="headline"
        size="default"
        weight="bold"
        class="mb-4"
      >
        {props.machine.machine_name}
      </Typography>

      {/* CPU Section */}
      <div class="mb-4">
        <Typography
          tag="h4"
          hierarchy="label"
          size="default"
          weight="medium"
          color="tertiary"
          class="mb-2"
        >
          CPU
        </Typography>
        <table class="w-full text-sm">
          <tbody>
            <tr class="border-b border-secondary-100">
              <td class="py-1 text-secondary-600">Architecture</td>
              <td class="py-1 font-medium">
                {props.machine.cpu.architecture}
              </td>
            </tr>
            <tr class="border-b border-secondary-100">
              <td class="py-1 text-secondary-600">Vendor</td>
              <td class="py-1 font-medium">{props.machine.cpu.vendor_name}</td>
            </tr>
            <tr class="border-b border-secondary-100">
              <td class="py-1 text-secondary-600">Model</td>
              <td class="py-1 font-medium">{props.machine.cpu.model}</td>
            </tr>
            <tr class="border-b border-secondary-100">
              <td class="py-1 text-secondary-600">Cores / Threads</td>
              <td class="py-1 font-medium">
                {props.machine.cpu.cores} / {props.machine.cpu.siblings}
              </td>
            </tr>
            <tr class="border-b border-secondary-100">
              <td class="py-1 text-secondary-600">Cache</td>
              <td class="py-1 font-medium">
                {props.machine.cpu.cache_kb} KB
              </td>
            </tr>
            <tr class="border-b border-secondary-100">
              <td class="py-1 text-secondary-600">BogoMIPS</td>
              <td class="py-1 font-medium">
                {props.machine.cpu.bogo.toFixed(2)}
              </td>
            </tr>
            <Show when={props.machine.cpu.features.length > 0}>
              <tr class="border-b border-secondary-100">
                <td class="py-1 text-secondary-600">Crypto Features</td>
                <td class="py-1 font-medium">
                  <div class="flex flex-wrap gap-1">
                    <For each={props.machine.cpu.features}>
                      {(feature) => (
                        <span class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                          {feature}
                        </span>
                      )}
                    </For>
                  </div>
                </td>
              </tr>
            </Show>
            <Show when={props.machine.cpu.bugs.length > 0}>
              <tr>
                <td class="py-1 text-secondary-600">Known Bugs</td>
                <td class="py-1 font-medium">
                  <div class="flex flex-wrap gap-1">
                    <For each={props.machine.cpu.bugs.slice(0, 5)}>
                      {(bug) => (
                        <span class="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                          {bug}
                        </span>
                      )}
                    </For>
                    <Show when={props.machine.cpu.bugs.length > 5}>
                      <span class="rounded bg-secondary-100 px-1.5 py-0.5 text-xs text-secondary-600">
                        +{props.machine.cpu.bugs.length - 5} more
                      </span>
                    </Show>
                  </div>
                </td>
              </tr>
            </Show>
          </tbody>
        </table>
      </div>

      {/* Memory Section */}
      <div class="mb-4">
        <Typography
          tag="h4"
          hierarchy="label"
          size="default"
          weight="medium"
          color="tertiary"
          class="mb-2"
        >
          Memory
        </Typography>
        <table class="w-full text-sm">
          <tbody>
            <tr>
              <td class="py-1 text-secondary-600">Total RAM</td>
              <td class="py-1 font-medium">
                {props.machine.memory.total_gb.toFixed(2)} GB
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Network Controllers Section */}
      <Show when={props.machine.network_controllers.length > 0}>
        <div class="mb-4">
          <Typography
            tag="h4"
            hierarchy="label"
            size="default"
            weight="medium"
            color="tertiary"
            class="mb-2"
          >
            Network Controllers
          </Typography>
          <For each={props.machine.network_controllers}>
            {(nc) => (
              <div class="mb-2 rounded border border-secondary-100 bg-secondary-50 p-2 text-sm">
                <div class="font-medium">{nc.model}</div>
                <div class="text-secondary-600">
                  Vendor: {nc.vendor} | Driver: {nc.driver}
                </div>
                <div class="text-xs text-secondary-500">
                  {nc.unix_device_name}
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Network Interfaces Section */}
      <Show when={props.machine.network_interfaces.length > 0}>
        <div>
          <Typography
            tag="h4"
            hierarchy="label"
            size="default"
            weight="medium"
            color="tertiary"
            class="mb-2"
          >
            Network Interfaces
          </Typography>
          <For each={props.machine.network_interfaces}>
            {(ni) => (
              <div class="mb-2 rounded border border-secondary-100 bg-secondary-50 p-2 text-sm">
                <div class="font-medium">{ni.unix_device_name}</div>
                <div class="text-secondary-600">
                  {ni.model} | Driver: {ni.driver}
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export const HardwarePage = () => {
  const { currentAlias } = useAlias();

  const hardwareData = createMemo(() => getHardwareDataForAlias(currentAlias()));

  return (
    <div class="p-6">
      <Typography
        tag="h1"
        hierarchy="title"
        size="l"
        weight="bold"
        class="mb-6"
      >
        Hardware Configuration
      </Typography>

      <Show
        when={hardwareData()?.machines && hardwareData()!.machines.length > 0}
        fallback={
          <div class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
            <p class="font-medium">No hardware data available</p>
            <p class="mt-1 text-sm">
              Run <code class="rounded bg-yellow-100 px-1">vpb compare</code> to
              generate hardware information from machine facter.json files.
            </p>
          </div>
        }
      >
        {/* Quick comparison table */}
        <div class="mb-8">
          <Typography
            tag="h2"
            hierarchy="headline"
            size="default"
            weight="bold"
            class="mb-4"
          >
            Comparison Overview
          </Typography>
          <HardwareComparisonTable machines={hardwareData()!.machines} />
        </div>

        {/* Detailed machine cards */}
        <Typography
          tag="h2"
          hierarchy="headline"
          size="default"
          weight="bold"
          class="mb-4"
        >
          Detailed Hardware Information
        </Typography>
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <For each={hardwareData()!.machines}>
            {(machine) => <MachineCard machine={machine} />}
          </For>
        </div>
      </Show>
    </div>
  );
};
