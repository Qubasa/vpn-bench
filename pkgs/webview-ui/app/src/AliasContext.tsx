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
  getAvailableKernelProfiles,
  getBenchDataForAlias,
  getComparisonDataForAlias,
  BenchData,
  ComparisonData,
} from "./benchData";

interface AliasContextType {
  currentAlias: Accessor<string>;
  setCurrentAlias: (alias: string) => void;
  availableAliases: string[];
  currentKernelProfile: Accessor<string>;
  setCurrentKernelProfile: (kp: string) => void;
  availableKernelProfiles: Accessor<string[]>;
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

  // Get available kernel profiles for the current alias
  const availableKernelProfilesAccessor = () =>
    getAvailableKernelProfiles(currentAlias());

  // Initialize kernel profile from URL or fallback
  const getInitialKernelProfile = () => {
    const urlKp = searchParams.kernelProfile;
    const kps = getAvailableKernelProfiles(getInitialAlias());
    if (urlKp && kps.includes(urlKp)) {
      return urlKp;
    }
    return kps[0] || "baseline";
  };

  const [currentKernelProfile, setCurrentKernelProfileInternal] =
    createSignal(getInitialKernelProfile());

  // Wrapper that also updates URL
  const setCurrentAlias = (alias: string) => {
    setCurrentAliasInternal(alias);
    // Reset kernel profile to first available for new alias
    const kps = getAvailableKernelProfiles(alias);
    const newKp = kps[0] || "baseline";
    setCurrentKernelProfileInternal(newKp);
    setSearchParams({ alias, kernelProfile: newKp });
  };

  const setCurrentKernelProfile = (kp: string) => {
    setCurrentKernelProfileInternal(kp);
    setSearchParams({ kernelProfile: kp });
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

  createEffect(() => {
    const urlKp = searchParams.kernelProfile;
    const kps = availableKernelProfilesAccessor();
    if (urlKp && kps.includes(urlKp) && urlKp !== currentKernelProfile()) {
      setCurrentKernelProfileInternal(urlKp);
    }
  });

  // Reset kernel profile when alias changes and current selection is no longer valid
  createEffect(() => {
    const kps = availableKernelProfilesAccessor();
    if (kps.length > 0 && !kps.includes(currentKernelProfile())) {
      setCurrentKernelProfileInternal(kps[0]);
    }
  });

  const benchData = () =>
    getBenchDataForAlias(currentAlias(), currentKernelProfile());
  const comparisonData = () =>
    getComparisonDataForAlias(currentAlias(), currentKernelProfile());

  return (
    <AliasContext.Provider
      value={{
        currentAlias,
        setCurrentAlias,
        availableAliases,
        currentKernelProfile,
        setCurrentKernelProfile,
        availableKernelProfiles: availableKernelProfilesAccessor,
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
