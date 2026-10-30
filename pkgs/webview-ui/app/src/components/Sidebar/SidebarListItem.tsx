import { A } from "@solidjs/router";

import { Typography } from "@/src/components/Typography";
import type { VpnVersion } from "@/src/benchData";

interface SidebarListItem {
  title: string;
  href: string;
  version?: VpnVersion;
}

// Reads props inside JSX so the label follows alias changes
const VersionLink = (props: { version: VpnVersion }) => (
  <a
    class="sidebar__list__version"
    href={props.version[0].url}
    target="_blank"
    rel="noopener noreferrer"
    title={props.version
      .map((c) => `${c.input} ${c.version} at ${c.rev.slice(0, 12)}`)
      .join(", ")}
  >
    <Typography
      tag="span"
      hierarchy="body"
      size="xs"
      weight="normal"
      color="tertiary"
      inverted={true}
    >
      {props.version.length > 1
        ? `${props.version[0].input} ${props.version[0].version}`
        : props.version[0].version}
    </Typography>
  </a>
);

export const SidebarListItem = (props: SidebarListItem) => {
  return (
    <li class="sidebar__list__item">
      <A class="sidebar__list__link" href={props.href}>
        <Typography
          class="sidebar__list__content"
          tag="span"
          hierarchy="body"
          size="s"
          weight="normal"
          color="primary"
          inverted={true}
        >
          {props.title}
        </Typography>
      </A>
      {props.version && <VersionLink version={props.version} />}
    </li>
  );
};
