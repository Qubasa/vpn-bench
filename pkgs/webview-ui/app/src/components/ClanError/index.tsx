import { Component, Show, For } from "solid-js";
import * as Alert from "@kobalte/core/alert";
import * as Accordion from "@kobalte/core/accordion";

// Assuming your types are exported from here
import type {
  BenchmarkRunError,
  CmdOutError,
  ClanError,
} from "../../benchData"; // Adjust the import path as needed

interface BenchmarkErrorDisplayProps {
  /** The error object from an Err Result */
  error: BenchmarkRunError;
}

// --- Basic Styling Placeholders (replace with your actual CSS/utility classes) ---
// You'll likely integrate this with Tailwind or your own CSS setup.
const alertClass =
  "border border-red-400 bg-red-100 text-red-700 px-4 py-3 rounded relative mb-4";
const titleClass = "font-bold";
const descClass = "mt-2 text-sm"; // Class for the description area holding the accordion
const codeBlockClass =
  "block whitespace-pre-wrap bg-gray-800 text-gray-100 p-2 rounded text-xs font-mono my-1 overflow-x-auto";
const accordionItemClass = "border-t border-red-300 mt-2 pt-2"; // Style for the accordion item within the alert
const accordionTriggerClass =
  "font-medium text-left w-full py-1 text-red-800 hover:underline focus:outline-none";
const accordionContentClass = "pb-2 text-sm";
const detailKeyClass = "font-semibold";
// --- End Styling Placeholders ---

// Type guards for more explicit checking within JSX (optional but can improve clarity)
const isCmdOutError = (
  error: BenchmarkRunError,
): error is BenchmarkRunError & { details: CmdOutError } => {
  return error.type === "CmdOut";
};

const isClanError = (
  error: BenchmarkRunError,
): error is BenchmarkRunError & { details: ClanError } => {
  return error.type === "ClanError";
};

export const DisplayClanError: Component<BenchmarkErrorDisplayProps> = (
  props,
) => {
  // Helper to render code blocks nicely, handling potential empty strings
  const renderCodeBlock = (
    content: string | undefined | null,
    title: string,
  ) => (
    <Show when={content?.trim()}>
      <p>
        <strong class={detailKeyClass}>{title}:</strong>
      </p>
      <pre>
        <code class={codeBlockClass}>{content}</code>
      </pre>
    </Show>
  );

  return (
    // Using Kobalte Alert for clear error indication
    <Alert.Root class={alertClass}>
      {/* Optional: Add an icon using Alert.Icon if desired */}
      {/* e.g., <Alert.Icon class="h-5 w-5 text-red-500 mr-2">🚨</Alert.Icon> */}

      <Alert.Root class={titleClass}>
        Benchmark Error: {props.error.type}
      </Alert.Root>

      {/* Use Alert.Description to wrap the details */}
      <Alert.Root class={descClass}>
        <Show when={props.error.filePath}>
          <p class="mb-1">
            <span class={detailKeyClass}>Source File:</span>{" "}
            <code>{props.error.filePath}</code>
          </p>
        </Show>

        {/* Use Kobalte Accordion to make lengthy details collapsible */}
        <Accordion.Root collapsible class="w-full">
          <Accordion.Item value="error-details" class={accordionItemClass}>
            <Accordion.Header>
              <Accordion.Trigger class={accordionTriggerClass}>
                Show Details
                {/* Optional: Add a Chevron icon indicator */}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content class={accordionContentClass}>
              {/* --- CmdOut Specific Details --- */}
              <Show when={isCmdOutError(props.error) ? props.error : false}>
                {(errorWithDetails) => {
                  // Use render prop for type safety
                  const details = props.error.details as CmdOutError;

                  return (
                    <>
                      <p>
                        <strong class={detailKeyClass}>Return Code:</strong>{" "}
                        {details.returncode}
                      </p>
                      <p>
                        <strong class={detailKeyClass}>
                          Working Directory:
                        </strong>{" "}
                        <code>{details.cwd}</code>
                      </p>
                      <p class="mt-1">
                        <strong class={detailKeyClass}>
                          Command Executed:
                        </strong>
                      </p>
                      <pre>
                        <code class={codeBlockClass}>
                          {/* Nicely format the command list */}
                          {details.command_list
                            ?.map((part) =>
                              part.includes(" ") ? `"${part}"` : part,
                            )
                            .join(" ") ?? "N/A"}
                        </code>
                      </pre>

                      {renderCodeBlock(details.stdout, "Stdout")}
                      {renderCodeBlock(details.stderr, "Stderr")}
                    </>
                  );
                }}
              </Show>

              {/* --- ClanError Specific Details --- */}
              <Show when={isClanError(props.error) ? props.error : false}>
                {(errorWithDetails) => {
                  const details = props.error.details as ClanError;
                  return (
                    <>
                      <p>
                        <strong class={detailKeyClass}>Error Message:</strong>{" "}
                        <code>{details.msg} </code>
                      </p>
                      <p>
                        <strong class={detailKeyClass}>Location:</strong>{" "}
                        <code>{details.location}</code>
                      </p>
                      <Show when={details.description}>
                        <p>
                          <strong class={detailKeyClass}>Description:</strong>{" "}
                          {details.description}
                        </p>
                      </Show>
                    </>
                  );
                }}
              </Show>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      </Alert.Root>
    </Alert.Root>
  );
};
