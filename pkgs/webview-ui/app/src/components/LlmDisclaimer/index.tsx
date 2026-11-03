import { onMount, JSX } from "solid-js";
import type { MatrixAnalysis, VpnAnalysis } from "@/src/analysisData";

interface LlmDisclaimerProps {
  id: string;
  title?: string;
  children: JSX.Element;
}

// Helper to check if disclaimer should be open (reads localStorage synchronously)
const shouldBeOpen = (id: string): boolean => {
  try {
    const key = `llm-disclaimer-${id}-collapsed`;
    return localStorage.getItem(key) !== "true";
  } catch {
    return true;
  }
};

export const LlmDisclaimer = (props: LlmDisclaimerProps) => {
  let detailsRef: HTMLDetailsElement | undefined;
  const storageKey = `llm-disclaimer-${props.id}-collapsed`;

  // Compute initial state synchronously before render
  const initialOpen = shouldBeOpen(props.id);

  onMount(() => {
    if (!detailsRef) return;

    const ref = detailsRef;
    // Listen for toggle events to persist state
    ref.addEventListener("toggle", () => {
      localStorage.setItem(storageKey, (!ref.open).toString());
    });
  });

  return (
    <details
      ref={detailsRef}
      {...(initialOpen ? { open: true } : {})}
      style={{
        "margin-bottom": "1.5rem",
        padding: "1rem",
        background: "#fef3c7",
        border: "1px solid #f59e0b",
        "border-radius": "0.5rem",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          "font-weight": "600",
          color: "#92400e",
        }}
      >
        {props.title ?? "LLM-Generated Content"} (click to collapse)
      </summary>
      <div style={{ "margin-top": "0.75rem", color: "#78350f" }}>
        {props.children}
      </div>
    </details>
  );
};

const InaccuracyNote = () => (
  <p>
    <strong>Found an inaccuracy?</strong> PRs are welcome at the{" "}
    <a
      href="https://github.com/Qubasa/vpn-bench/tree/main/pkgs/webview-ui/app/bench"
      style={{ color: "#d97706", "text-decoration": "underline" }}
    >
      vpn benchmark repository
    </a>
    .
  </p>
);

const shortRev = (rev: string): string =>
  /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev;

export const FeatureMatrixDisclaimer = (props: {
  analysis: MatrixAnalysis;
}) => (
  <LlmDisclaimer id="feature-matrix">
    <p>
      Generated on {props.analysis.date} by {props.analysis.model} from the
      source of the {Object.keys(props.analysis.revs).length} VPNs at the
      versions benchmarked in this run.
    </p>
    <InaccuracyNote />
  </LlmDisclaimer>
);

export const OverviewDisclaimer = (props: { analysis: VpnAnalysis }) => (
  <LlmDisclaimer id="overview">
    <p>
      Generated on {props.analysis.date} by {props.analysis.model} from the
      source of{" "}
      {Object.entries(props.analysis.revs)
        .map(([input, rev]) => `${input} ${shortRev(rev)}`)
        .join(", ")}
      , the version benchmarked in this run.
    </p>
    <InaccuracyNote />
  </LlmDisclaimer>
);
