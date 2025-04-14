{ vpncloud }:
{
  config,
  lib,
  ...
}:

let
  cfg = config.services.vpncloud;
  package = vpncloud;

  api = with lib; {
    enable = mkEnableOption "vpncloud network throughput testing server";
    privateKeyFile = mkOption {
      type = types.path;
      description = "Path to the private key file.";
    };
    publicKeyFile = mkOption {
      type = types.path;
      description = "Path to the private key file.";
    };
    trustedKeys = mkOption {
      type = types.listOf types.str;
      description = "List of trusted pubkeys of other peers.";
    };
    passwordFile = mkOption {
      type = types.path;
      description = "Path to the password file.";
    };
    ipAddr = mkOption {
      type = types.str;
      description = "IP address of the peer.";
    };
    peers = mkOption {
      type = types.listOf types.str;
      description = "List of peers to connect to.";
    };
    port = mkOption {
      type = types.port;
      default = 17000;
      description = "Port to listen on for vpncloud client requests.";
    };
    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open ports in the firewall for vpncloud.";
    };
  };

  imp = {

    environment.systemPackages = [ package ];

    networking.firewall = lib.mkIf cfg.openFirewall {
      allowedUDPPorts = [ cfg.port ];
    };

    systemd.targets.vpncloud = {
      description = "VpnCloud target allowing to start/stop all vpncloud@.service instances at once";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
    };

    # TODO: Make vpncloud multi-instance
    # https://github.com/dswd/vpncloud/blob/master/assets/vpncloud%40.service
    systemd.services.vpncloud = {
      description = "VpnCloud network";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      partOf = [ "vpncloud.target" ];
      path = [ package ];
      script = ''
        PRIVATE_KEY=$(cat "${cfg.privateKeyFile}")
        PUBLIC_KEY=$(cat "${cfg.publicKeyFile}")
        PASSWORD=$(cat "${cfg.passwordFile}")
        vpncloud \
          --private-key "$PRIVATE_KEY" \
          --public-key "$PUBLIC_KEY" \
          --log-file "/var/log/vpncloud.log" \
          --stats-file "/var/log/vpncloud.stats" \
          --pid-file "/run/vpncloud.pid" \
          --password "$PASSWORD" \
          --listen "${toString cfg.port}" \
          --ip "${cfg.ipAddr}" \
          ${lib.concatMapStrings (k: " --trusted-key " + k) cfg.trustedKeys} \
          ${lib.concatMapStrings (k: " --peer " + k) cfg.peers}
      '';
      serviceConfig = {
        RestartSec = 5;
        Restart = "on-failure";
        TasksMax = 10;
        # MemoryMax = "50M";
        # PrivateTmp = "yes";
        # ProtectHome = "yes";
        # ProtectSystem = "strict";
        # ReadWritePaths =
        #   [
        #     "/var/log"
        #     "/run"
        #     "/nix/store"
        #   ]
        #   ++ [
        #     cfg.privateKeyFile
        #     cfg.publicKeyFile
        #   ];
        # CapabilityBoundingSet = [
        #   "CAP_NET_ADMIN"
        #   "CAP_NET_BIND_SERVICE"
        #   "CAP_NET_RAW"
        #   "CAP_SETGID"
        #   "CAP_SETUID"
        #   "CAP_SYS_CHROOT"
        # ];

        # DeviceAllow = [
        #   "/dev/null rw"
        #   "/dev/net/tun rw"
        # ];
        PIDFile = "/run/vpncloud.pid";
      };
    };
  };
in
{
  options.services.vpncloud = api;
  config = lib.mkIf cfg.enable imp;
}
