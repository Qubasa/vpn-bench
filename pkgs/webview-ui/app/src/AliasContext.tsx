import {
  createContext,
  useContext,
  createSignal,
  ParentComponent,
  Accessor,
} from "solid-js";
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
  const [currentAlias, setCurrentAlias] = createSignal(
    availableAliases[0] || "",
  );

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
