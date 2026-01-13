import { useSearchParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";

// Import instruction files as raw text
import overviewInstructions from "@/analysis/llm-instructions/2026-01-13-init-overview-md.txt?raw";
import analysisInstructions from "@/analysis/llm-instructions/2026-01-13-init-analysis-md.txt?raw";

const instructions: Record<string, { title: string; content: string }> = {
  overview: {
    title: "LLM Instructions for Overview Files",
    content: overviewInstructions,
  },
  analysis: {
    title: "LLM Instructions for Initial Analysis",
    content: analysisInstructions,
  },
};

export const LlmInstructionsPage = () => {
  const [searchParams] = useSearchParams();

  const selectedInstruction = createMemo(() => {
    const file = searchParams.file || "overview";
    return instructions[file] || instructions.overview;
  });

  return (
    <div class="p-6">
      <h1 class="mb-4 text-2xl font-bold text-gray-900">
        {selectedInstruction().title}
      </h1>

      <div class="mb-4 flex gap-2">
        <a
          href="/llm-instructions?file=overview"
          class={`rounded px-3 py-1 text-sm ${
            (searchParams.file || "overview") === "overview"
              ? "bg-amber-500 text-white"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          Overview Instructions
        </a>
        <a
          href="/llm-instructions?file=analysis"
          class={`rounded px-3 py-1 text-sm ${
            searchParams.file === "analysis"
              ? "bg-amber-500 text-white"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          Analysis Instructions
        </a>
      </div>

      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <pre class="overflow-x-auto whitespace-pre-wrap break-words text-sm text-gray-800">
          {selectedInstruction().content}
        </pre>
      </div>
    </div>
  );
};
