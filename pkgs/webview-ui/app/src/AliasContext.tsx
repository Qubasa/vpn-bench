import {
  createContext,
  useContext,
  createSignal,
  ParentComponent,
  Accessor,
  createEffect,
} from "solid-js";
import { useSearchParams } from "@solidjs/router";
import {
  getAvailableAliases,
  getBenchDataForAlias,
  getComparisonDataForAlias,
  BenchData,
  ComparisonData,
} from "./benchData";

interface AliasContextType {
  currentAlias: Accessor<string>;
  setCurrentAlias: (alias: string) => void;
  availableAliases: string[];
  benchData: Accessor<BenchData>;
  comparisonData: Accessor<ComparisonData>;
}

const AliasContext = createContext<AliasContextType>();

export const AliasProvider: ParentComponent = (props) => {
  const availableAliases = getAvailableAliases();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize from URL or fallback to first available alias
  const getInitialAlias = () => {
    const urlAlias = searchParams.alias;
    if (urlAlias && availableAliases.includes(urlAlias)) {
      return urlAlias;
    }
    return availableAliases[0] || "";
  };

  const [currentAlias, setCurrentAliasInternal] =
    createSignal(getInitialAlias());

  // Wrapper that also updates URL
  const setCurrentAlias = (alias: string) => {
    setCurrentAliasInternal(alias);
    setSearchParams({ alias });
  };

  // Sync URL changes back to state (e.g., browser back/forward)
  createEffect(() => {
    const urlAlias = searchParams.alias;
    if (
      urlAlias &&
      availableAliases.includes(urlAlias) &&
      urlAlias !== currentAlias()
    ) {
      setCurrentAliasInternal(urlAlias);
    }
  });

  const benchData = () => getBenchDataForAlias(currentAlias());
  const comparisonData = () => getComparisonDataForAlias(currentAlias());

  return (
    <AliasContext.Provider
      value={{
        currentAlias,
        setCurrentAlias,
        availableAliases,
        benchData,
        comparisonData,
      }}
    >
      {props.children}
    </AliasContext.Provider>
  );
};

export function useAlias() {
  const context = useContext(AliasContext);
  if (!context) {
    throw new Error("useAlias must be used within an AliasProvider");
  }
  return context;
}
