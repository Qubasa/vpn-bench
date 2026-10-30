import { useSearchParams } from "@solidjs/router";
import { createMemo, For } from "solid-js";

// The two 2026-01-13 file names are swapped relative to their content:
// init-analysis-md.txt holds the overview prompt and vice versa.
import overviewInstructions from "@/analysis/llm-instructions/2026-01-13-init-analysis-md.txt?raw";
import analysisInstructions from "@/analysis/llm-instructions/2026-01-13-init-overview-md.txt?raw";
import verifyInstructions from "@/analysis/llm-instructions/2026-10-28-verify-overviews-update-matrix.txt?raw";
import addOverviewsInstructions from "@/analysis/llm-instructions/2026-10-28-add-netbird-tincr-overviews.txt?raw";
import matrixContract from "@/analysis/llm-instructions/2026-10-28-matrix-row-contract.md?raw";
import sourceVersions from "@/analysis/llm-instructions/2026-10-28-source-versions.md?raw";

interface Instruction {
  key: string;
  label: string;
  title: string;
  content: string;
}

const instructions: Instruction[] = [
  {
    key: "overview",
    label: "Overview Instructions",
    title: "LLM Instructions for Overview Files",
    content: overviewInstructions,
  },
  {
    key: "analysis",
    label: "Analysis Instructions",
    title: "LLM Instructions for Initial Analysis",
    content: analysisInstructions,
  },
  {
    key: "verify",
    label: "Verification (2026-10-28)",
    title:
      "LLM Instructions for Verifying Overviews and Rebuilding the Feature Matrix",
    content: verifyInstructions,
  },
  {
    key: "add-overviews",
    label: "NetBird & tincr (2026-10-28)",
    title: "LLM Instructions for the NetBird and tincr Overviews",
    content: addOverviewsInstructions,
  },
  {
    key: "contract",
    label: "Matrix Row Definitions",
    title: "Feature Matrix Row Definitions",
    content: matrixContract,
  },
  {
    key: "versions",
    label: "Source Versions",
    title: "Source Versions Used for the 2026-10-28 Verification",
    content: sourceVersions,
  },
];

const defaultInstruction = instructions[0] as Instruction;

export const LlmInstructionsPage = () => {
  const [searchParams] = useSearchParams();

  const selectedInstruction = createMemo(() => {
    const key = searchParams.file || defaultInstruction.key;
    return instructions.find((i) => i.key === key) ?? defaultInstruction;
  });

  return (
    <div class="p-6">
      <h1 class="mb-4 text-2xl font-bold text-gray-900">
        {selectedInstruction().title}
      </h1>

      <div class="mb-4 flex flex-wrap gap-2">
        <For each={instructions}>
          {(instruction) => (
            <a
              href={`/llm-instructions?file=${instruction.key}`}
              class={`rounded px-3 py-1 text-sm ${
                selectedInstruction().key === instruction.key
                  ? "bg-amber-500 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              {instruction.label}
            </a>
          )}
        </For>
      </div>

      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <pre class="overflow-x-auto whitespace-pre-wrap break-words text-sm text-gray-800">
          {selectedInstruction().content}
        </pre>
      </div>
    </div>
  );
};
