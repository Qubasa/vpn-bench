import { createSignal, For, Show } from "solid-js";
import { Typography } from "@/src/components/Typography";
import Icon from "../icon";
import { getAvailableAliases } from "@/src/benchData";

// Get available aliases dynamically from loaded benchmark data
const AVAILABLE_ALIASES = getAvailableAliases();

interface SidebarDateSelectorProps {
  currentAlias?: string;
  onAliasChange?: (alias: string) => void;
}

export const SidebarDateSelector = (props: SidebarDateSelectorProps) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const currentAlias = () => props.currentAlias || AVAILABLE_ALIASES[0] || "";

  // Don't render if there are no aliases or only one alias
  if (AVAILABLE_ALIASES.length <= 1) {
    return (
      <div class="sidebar__date-selector">
        <div class="sidebar__date-selector__button sidebar__date-selector__button--disabled">
          <Typography
            tag="span"
            hierarchy="body"
            size="s"
            weight="medium"
            color="primary"
            inverted={true}
          >
            {currentAlias() || "No data"}
          </Typography>
        </div>
      </div>
    );
  }

  const handleAliasSelect = (alias: string) => {
    setIsOpen(false);
    if (props.onAliasChange) {
      props.onAliasChange(alias);
    }
  };

  return (
    <div class="sidebar__date-selector">
      <button
        class="sidebar__date-selector__button"
        onClick={() => setIsOpen(!isOpen())}
        type="button"
      >
        <Typography
          tag="span"
          hierarchy="body"
          size="s"
          weight="medium"
          color="primary"
          inverted={true}
        >
          {currentAlias()}
        </Typography>
        <Icon
          icon="CaretDown"
          class={`sidebar__date-selector__caret ${isOpen() ? "sidebar__date-selector__caret--open" : ""}`}
        />
      </button>

      <Show when={isOpen()}>
        <div class="sidebar__date-selector__dropdown">
          <For each={AVAILABLE_ALIASES}>
            {(alias) => (
              <button
                class={`sidebar__date-selector__option ${alias === currentAlias() ? "sidebar__date-selector__option--active" : ""}`}
                onClick={() => handleAliasSelect(alias)}
                type="button"
              >
                <Typography
                  tag="span"
                  hierarchy="body"
                  size="s"
                  weight="normal"
                  color="primary"
                  inverted={true}
                >
                  {alias}
                </Typography>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
