import { Typography } from "@/src/components/Typography";
import "./css/sidebar.css";

interface SidebarProps {
  clanName: string;
}

const ClanProfile = (props: SidebarProps) => {
  return (
    <div class="sidebar__profile">
      <Typography
        class="sidebar__profile__character"
        tag="span"
        hierarchy="title"
        size="m"
        weight="bold"
        color="primary"
        inverted={true}
      >
        {props.clanName.slice(0, 1).toUpperCase()}
      </Typography>
    </div>
  );
};

const ClanTitle = (props: SidebarProps) => {
  return (
    <Typography
      tag="h3"
      hierarchy="body"
      size="default"
      weight="medium"
      color="primary"
      inverted={true}
    >
      {props.clanName}
    </Typography>
  );
};

export const SidebarHeader = (props: SidebarProps) => {
  return (
    <header class="sidebar__header">
      <div class="sidebar__header__inner">
        <ClanProfile clanName={props.clanName} />
        <ClanTitle clanName={props.clanName} />
      </div>
    </header>
  );
};
