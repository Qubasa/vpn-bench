import { Typography } from "@/src/components/Typography";
import GiteaLogo from "@/icons/gitea_logo.svg";
import GithubLogo from "@/icons/github.svg";
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
      <div class="relative z-40 flex gap-1 pr-2">
        <a
          href="https://git.clan.lol/Qubasa/vpn-benchmark"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-square btn-ghost btn-sm"
          title="Gitea Repository"
        >
          <GiteaLogo width={20} height={20} />
        </a>
        <a
          href="https://github.com/Qubasa/vpn-bench"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-square btn-ghost btn-sm"
          title="GitHub Repository"
        >
          <GithubLogo width={20} height={20} class="fill-white" />
        </a>
      </div>
    </header>
  );
};
