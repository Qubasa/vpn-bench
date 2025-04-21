{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "yggdrasil";

  roles.peer = {
    interface = {
      options = {
        peers = lib.mkOption {
          type = lib.types.attrsOf (
            lib.types.submodule {
              options = {
                protocol = lib.mkOption {
                  type = lib.types.enum [
                    "quic"
                    "tls"
                    "tcp"
                    "ws"
                    "wss"
                  ];
                  default = "quic";
                  description = ''
                    The protocol to use for the peer connection.
                    For more information, see https://yggdrasil-network.github.io/configurationref.html
                  '';
                };
                ip = lib.mkOption {
                  type = lib.types.str;
                  description = ''
                    The IP address or domain of the peer. 
                  '';
                };
                port = lib.mkOption {
                  type = lib.types.int;
                  default = 6384;
                  description = ''
                    The port of the peer.
                  '';
                };
              };
            }
          );
          default = { };
          example = {
            "myhome" = {
              protocol = "quic";
              ip = "1.1.1.1";
              port = 6384;
            };
          };
          description = ''
            A list of peers to connect to. The key is the name of the peer.
          '';
        };
        allowedPubkeys = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { };
          example = {
            "myhome" = "myhome_pubkey";
          };
          description = ''
            A list of allowed public keys for the peer.
            This is used to verify the identity of the peer.
          '';
        };
        listenPort = lib.mkOption {
          type = lib.types.int; # FIXME: vars.generators.validation doesn't support types.port
          default = 6384;
          description = ''
            Port to listen on for yggdrasil connections.
          '';
        };
        enableMulticast = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = ''
            Enable local peer discovery support for yggdrasil.
          '';
        };
      };
    };

    perInstance =
      { roles, settings, ... }:
      {
        nixosModule =
          { pkgs, config, ... }:

          let
            machines = lib.attrNames (roles.peer.machines or { });
            machinePubPath =
              name: "${config.clan.core.settings.directory}/vars/per-machine/${name}/yggdrasil/public-key/value";
            machineVals =
              valPath:
              builtins.foldl' (
                ips: name:
                if builtins.pathExists (valPath name) then
                  ips
                  ++ [
                    (builtins.readFile (valPath name))
                  ]
                else
                  ips
              ) [ ] machines;
            machinePubVals = machineVals machinePubPath;

            peersToList =
              peersAttrSet:
              let
                peerConfigs = lib.attrValues peersAttrSet;
              in
              lib.map (peer: "${peer.protocol}://${peer.ip}:${toString peer.port}") peerConfigs;
          in
          {
            clan.core.vars.generators.yggdrasil = {
              files.private-key = { };
              files.public-key = {
                secret = false;
              };
              files.ip = {
                secret = false;
                deploy = false;
              };
              files.network = {
                secret = false;
                deploy = false;
              };
              files.config = {
                deploy = false;
              };

              runtimeInputs = [
                pkgs.coreutils
                pkgs.jq
                pkgs.yggdrasil
              ];

              script = ''
                CONF=$(yggdrasil -genconf -json)
                echo "$CONF" > "$out"/config
                echo "$CONF" | jq -r .PrivateKey | tr -d "\n" > "$out"/private-key
                echo "$CONF" | yggdrasil -useconf -subnet | tr -d "\n" > "$out"/network
                echo "$CONF" | yggdrasil -useconf -publickey | tr -d "\n" > "$out"/public-key
                echo "$CONF" | yggdrasil -useconf -address | tr -d "\n" > "$out"/ip
              '';
            };

            networking.firewall = {
              allowedTCPPorts = [ settings.listenPort ];
              allowedUDPPorts = [ settings.listenPort ];
            };

            clan.core.vars.generators.yggdrasil-config = {
              files.config = { };
              dependencies = [
                "yggdrasil"
              ];
              validation = {
                listenPort = settings.listenPort;
                allowedPubkeys = settings.allowedPubkeys;
              } // settings.peers;

              runtimeInputs = [
                pkgs.coreutils
                pkgs.jq
              ];

              script = ''
                ORIG_CONF=$(cat "$in"/yggdrasil/config)
                MACHINE_PUB_KEYS='${builtins.toJSON (machinePubVals ++ (lib.attrValues settings.allowedPubkeys))}'
                PEERS='${builtins.toJSON (peersToList settings.peers)}'
                RES=$(echo "$ORIG_CONF" | jq --argjson pubkeys "$MACHINE_PUB_KEYS" \
                  '.AllowedPublicKeys += $pubkeys')
                RES=$(echo "$RES" | jq '.Listen += ["quic://[::]:${toString settings.listenPort}", "quic://0.0.0.0:${toString settings.listenPort}","tls://0.0.0.0:${toString settings.listenPort}", "tls://[::]:${toString settings.listenPort}"]')
                RES=$(echo "$RES" | jq --argjson peers "$PEERS" \
                  '.Peers += $peers')
                echo "$RES" > "$out"/config
              '';
            };

            services.yggdrasil = {
              enable = true;
              openMulticastPort = settings.enableMulticast;
              configFile = config.clan.core.vars.generators.yggdrasil-config.files.config.path;
            };

          };
      };
  };
}
