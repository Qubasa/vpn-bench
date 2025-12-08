import { Component, For, Show } from "solid-js";
import * as Accordion from "@kobalte/core/accordion";
import {
  MixedReport,
  Err,
  getErrorMessage,
  CmdOutError,
  ClanError,
} from "@/src/benchData";

/**
 * ErrorDetailsPanel - Displays detailed error information for failed benchmark tests.
 *
 * This component shows a collapsible panel for each failed machine, including:
 * - Error type and basic error message
 * - Command details (for CmdOut errors)
 * - Service logs collected from the target machine (if available)
 */

interface ErrorDetailsPanelProps<T> {
  /** Mixed reports containing both success and failure results */
  mixedReports: MixedReport<T>[];
  /** Title for the panel (e.g., "QPERF Errors", "iPerf TCP Errors") */
  title?: string;
}

// Style classes
const panelClass =
  "mt-4 border border-orange-300 bg-orange-50 rounded-lg overflow-hidden";
const headerClass =
  "bg-orange-100 px-4 py-3 font-semibold text-orange-800 flex items-center gap-2";
const accordionItemClass = "border-t border-orange-200";
const accordionTriggerClass =
  "w-full px-4 py-3 text-left font-medium text-orange-700 hover:bg-orange-100 focus:outline-none flex justify-between items-center";
const accordionContentClass = "px-4 py-3 bg-white text-sm";
const codeBlockClass =
  "block whitespace-pre-wrap bg-gray-800 text-gray-100 p-3 rounded text-xs font-mono my-2 overflow-x-auto max-h-96 overflow-y-auto";
const labelClass = "font-semibold text-gray-700 mt-2 mb-1";

export function ErrorDetailsPanel<T>(
  props: ErrorDetailsPanelProps<T>,
): ReturnType<Component> {
  // Filter to only failed reports
  const failedReports = () =>
    props.mixedReports.filter((r) => !r.result.ok) as {
      name: string;
      result: Err;
    }[];

  // Don't render anything if there are no failures
  if (failedReports().length === 0) {
    return null;
  }

  return (
    <Show when={failedReports().length > 0}>
      <div class={panelClass}>
        <div class={headerClass}>
          <span>&#9888;</span>
          <span>{props.title || "Failed Tests"}</span>
          <span class="ml-auto text-sm font-normal">
            ({failedReports().length} failed)
          </span>
        </div>

        <Accordion.Root collapsible class="w-full">
          <For each={failedReports()}>
            {(report, index) => {
              const error = report.result.error;
              const meta = report.result.meta;
              const isCmdOut = error.type === "CmdOut";
              const cmdOutDetails = isCmdOut
                ? (error.details as CmdOutError)
                : null;
              const clanErrorDetails = !isCmdOut
                ? (error.details as ClanError)
                : null;

              return (
                <Accordion.Item
                  value={`error-${index()}`}
                  class={accordionItemClass}
                >
                  <Accordion.Header>
                    <Accordion.Trigger class={accordionTriggerClass}>
                      <span>
                        <span class="mr-2 font-bold text-red-600">
                          {report.name}
                        </span>
                        <span class="text-sm text-gray-500">
                          ({error.type})
                        </span>
                      </span>
                      <span class="text-gray-400">&#9660;</span>
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content class={accordionContentClass}>
                    {/* Error Summary */}
                    <div class="mb-3 rounded border border-red-200 bg-red-50 p-2">
                      <p class="text-red-700">{getErrorMessage(error)}</p>
                    </div>

                    {/* Test Metadata */}
                    <Show when={meta}>
                      <div class="mb-3 text-xs text-gray-500">
                        <span>Attempts: {meta?.test_attempts || "N/A"}</span>
                        <span class="mx-2">|</span>
                        <span>
                          Duration:{" "}
                          {meta?.duration_seconds?.toFixed(1) || "N/A"}s
                        </span>
                        <span class="mx-2">|</span>
                        <span>
                          VPN Restarts: {meta?.vpn_restart_attempts || 0}
                        </span>
                      </div>
                    </Show>

                    {/* CmdOut Error Details */}
                    <Show when={isCmdOut && cmdOutDetails}>
                      <div class={labelClass}>Command:</div>
                      <pre class={codeBlockClass}>
                        {cmdOutDetails?.command_list
                          ?.map((part) =>
                            part.includes(" ") ? `"${part}"` : part,
                          )
                          .join(" ") || "N/A"}
                      </pre>

                      <Show when={cmdOutDetails?.stderr?.trim()}>
                        <div class={labelClass}>Stderr:</div>
                        <pre class={codeBlockClass}>
                          {cmdOutDetails?.stderr}
                        </pre>
                      </Show>

                      <Show when={cmdOutDetails?.stdout?.trim()}>
                        <div class={labelClass}>Stdout:</div>
                        <pre class={codeBlockClass}>
                          {cmdOutDetails?.stdout}
                        </pre>
                      </Show>
                    </Show>

                    {/* ClanError Details */}
                    <Show when={!isCmdOut && clanErrorDetails}>
                      <div class={labelClass}>Error Message:</div>
                      <p class="text-gray-700">{clanErrorDetails?.msg}</p>

                      <Show when={clanErrorDetails?.description}>
                        <div class={labelClass}>Description:</div>
                        <p class="text-gray-600">
                          {clanErrorDetails?.description}
                        </p>
                      </Show>

                      <Show when={clanErrorDetails?.location}>
                        <div class={labelClass}>Location:</div>
                        <pre class={codeBlockClass}>
                          {clanErrorDetails?.location}
                        </pre>
                      </Show>
                    </Show>

                    {/* Service Logs Section */}
                    <Show when={meta?.service_logs}>
                      <div class="mt-4 border-t border-gray-200 pt-4">
                        <div class={labelClass}>
                          <span class="text-blue-700">
                            &#128196; Service Logs (last 5 minutes)
                          </span>
                        </div>
                        <p class="mb-2 text-xs text-gray-500">
                          Logs collected from the target service after all
                          retries failed:
                        </p>
                        <pre class={codeBlockClass}>{meta?.service_logs}</pre>
                      </div>
                    </Show>

                    {/* Source File Path */}
                    <Show when={error.filePath}>
                      <div class="mt-3 text-xs text-gray-400">
                        Source: {error.filePath}
                      </div>
                    </Show>
                  </Accordion.Content>
                </Accordion.Item>
              );
            }}
          </For>
        </Accordion.Root>
      </div>
    </Show>
  );
}

export default ErrorDetailsPanel;
