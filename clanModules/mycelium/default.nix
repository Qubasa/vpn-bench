{
  clanLib,
  lib,
  config,
  directory,
  ...
}:
{
  _class = "clan.service";
  manifest.name = "clan-core/mycelium";
  manifest.description = "End-2-end encrypted P2P IPv6 overlay network";
  manifest.categories = [
    "System"
    "Network"
  ];
  manifest.readme = builtins.readFile ./README.md;

  exports = lib.mapAttrs' (instanceName: _: {
    name = clanLib.exports.buildScopeKey {
      inherit instanceName;
      serviceName = config.manifest.name;
    };
    value = {
      networking.priority = 800;
    };
  }) config.instances;

  roles.peer = {
    description = "A peer in the mycelium network";
    interface =
      { lib, ... }:
      {
        options = {
          openFirewall = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "Open the firewall for mycelium";
          };

          addHostedPublicNodes = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "Add hosted Public nodes";
          };

          publicAddress = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = ''
              Public IP address of this machine, used for direct peering
              with other machines in the same instance.
              If set, other peers will connect directly via QUIC and TCP.
            '';
          };
        };
      };

    perInstance =
      {
        settings,
        mkExports,
        machine,
        roles,
        ...
      }:
      let
        # Collect public addresses from all other peer machines for direct peering
        directPeers = lib.concatLists (
          lib.mapAttrsToList (
            peerName: peerCfg:
            let
              addr = peerCfg.settings.publicAddress;
            in
            lib.optionals (peerName != machine.name && addr != null) [
              "quic://${addr}:9651"
              "tcp://${addr}:9651"
            ]
          ) roles.peer.machines
        );
      in
      {

        exports = mkExports {
          peer.hosts = [
            {
              plain = clanLib.vars.getPublicValue {
                machine = machine.name;
                generator = "mycelium";
                file = "ip";
                flake = directory;
              };
            }
          ];
        };

        nixosModule =
          {
            config,
            pkgs,
            lib,
            ...
          }:
          {
            imports = [
              ./service.nix
            ];

            services.custom-mycelium = {
              enable = true;
              addHostedPublicNodes = lib.mkDefault settings.addHostedPublicNodes;
              openFirewall = lib.mkDefault settings.openFirewall;
              keyFile = config.clan.core.vars.generators.mycelium.files.key.path;
              peers = directPeers;
            };

            clan.core.vars.generators.mycelium = {
              files.key = { };
              files.ip.secret = false;
              files.pubkey.secret = false;
              runtimeInputs = [
                pkgs.mycelium
                pkgs.coreutils
                pkgs.jq
              ];
              script = ''
                timeout 5 mycelium --key-file "$out"/key || :
                mycelium inspect --key-file "$out"/key --json | jq -r .publicKey > "$out"/pubkey
                mycelium inspect --key-file "$out"/key --json | jq -r .address > "$out"/ip
              '';
            };
          };
      };
  };
}
