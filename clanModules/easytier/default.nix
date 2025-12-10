{ packages }:
{ lib, ... }:

let
  inherit (lib)
    substring
    ;

  # the tun interface name is derived from the instance name
  getInterface = instanceName: substring 0 15 instanceName;

  # Shared module for both bootstrap and peer roles
  sharedModule =
    {
      instanceName,
      roles,
    }:
    {
      config,
      pkgs,
      ...
    }:
    let
      interface = getInterface instanceName;

      ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
        libraries = [ ];
        doCheck = false;
      } (builtins.readFile ./ipgenv6.py);

      allMachines = (roles.peer.machines or { }) // (roles.bootstrap.machines or { });
      isBootstrap = machineName: roles.bootstrap.machines ? ${machineName};
      bootstrapMachines = lib.filterAttrs (name: _: isBootstrap name) allMachines;
      bootstrapPeers = lib.mapAttrsToList (
        _name: machine:
        let
          addr = machine.settings.publicAddress;
          port = machine.settings.port or 11010;
        in
        "tcp://${addr}:${toString port}"
      ) bootstrapMachines;
    in
    {
      # vars
      clan.core.vars.generators."easytier-${instanceName}-key" = {
        files.shared-secret.secret = true;
        share = true;
        runtimeInputs = [
          pkgs.pwgen
        ];
        script = ''
          pwgen -s 32 1 > $out/shared-secret
        '';
      };

      # firewall
      networking.firewall.allowedTCPPorts = [
        11010
        11011
      ];
      networking.firewall.allowedUDPPorts = [
        11010
        11011
      ];

      clan.core.vars.generators."easytier-${instanceName}-ula" = {
        share = true;
        files.network = {
          secret = false;
          deploy = false;
        };

        runtimeInputs = [
          ipgenv6
          pkgs.coreutils
        ];

        script = ''
          ipgenv6 --generate-prefix | tr -d "\n" > "$out"/network
        '';
      };

      clan.core.vars.generators."easytier-${instanceName}" = {
        files.ip = {
          deploy = false;
          secret = false;
        };
        dependencies = [
          "easytier-${instanceName}-ula"
        ];
        runtimeInputs = [
          pkgs.coreutils
          pkgs.gnused
          pkgs.gnugrep
          ipgenv6
        ];
        script = ''
          ipgenv6 --prefix "$(cat "$in"/easytier-${instanceName}-ula/network)" | tr -d "\n" > "$out"/ip
        '';
      };
      # pre-service to update environment file with network_secret
      systemd.services."easytier-${instanceName}-update-env" = {
        description = "Update EasyTier environment file with shared secret";
        before = [ "easytier-${instanceName}.service" ];
        requiredBy = [ "easytier-${instanceName}.service" ];
        # TODO: upstream systemd CREDENTIALS_DIRECTORY support
        # this is a hack and will lead the VPN to restart on each activation
        # sops should not delete the /run/secrets directory
        partOf = [ "sysinit-reactivation.target" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
        };
        script = ''
          mkdir -p /run/secrets/easytier
          echo "ET_NETWORK_SECRET=\"$(cat ${
            config.clan.core.vars.generators."easytier-${instanceName}-key".files.shared-secret.path
          })\"" \
            > "/run/secrets/easytier/${instanceName}.env"
        '';
      };

      systemd.services."easytier-${instanceName}" = {
        partOf = [
          "easytier-${instanceName}-update-env.service"
        ];
        # exits with 0 sometimes if it cannot connect
        # see https://github.com/EasyTier/EasyTier/issues/1167
        serviceConfig.Restart = lib.mkForce "always";
        serviceConfig.Slice = "benchmark.slice";
      };

      # easytier
      services.easytier = {
        enable = true;
        package = packages.${pkgs.system}.easytier;
        instances.${instanceName} = {
          environmentFiles = [
            "/run/secrets/easytier/${instanceName}.env"
          ];
          settings = {
            network_name = "${instanceName}4";
            listeners = [
              "tcp://0.0.0.0:11010"
            ];
            peers = bootstrapPeers;
            dhcp = true;
          };
          extraSettings = {
            flags.dev_name = interface;
            ipv6 = "${config.clan.core.vars.generators."easytier-${instanceName}".files.ip.value}/64";
          };
        };
      };

      assertions = [
        {
          assertion = lib.length (builtins.attrNames (roles.bootstrap.machines or { })) != 0;
          message = "The EasyTier service instance '${instanceName}' requires at least one machine with the 'bootstrap' role.";
        }
      ];
    };
in
{
  _class = "clan.service";
  manifest.name = "easytier";
  manifest.description = "Easytier decentralized VPN";
  manifest.categories = [ "Utility" ];

  roles.bootstrap = {
    description = "A bootstrap node that other peers use to join your private EasyTier network. Needs to have a public IP address / domain name.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = ''
          The public IP address or domain name that other peers will use to connect to this bootstrap node.
        '';
      };
      port = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = null;
        description = ''
          The port that other peers will use to connect to this bootstrap node,
          if no port is defined the default port 11010 is used.
        '';
      };
    };

    perInstance =
      {
        instanceName,
        roles,
        ...
      }:
      {
        nixosModule = sharedModule { inherit instanceName roles; };
      };
  };

  roles.peer = {
    description = "A peer that connects to your private EasyTier network.";

    perInstance =
      {
        instanceName,
        roles,
        ...
      }:
      {
        nixosModule = sharedModule { inherit instanceName roles; };
      };
  };

}
