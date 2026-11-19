{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "edgevpn";
  manifest.description = "EdgeVPN libp2p mesh VPN, with every peer dialing every other peer directly";
  manifest.categories = [
    "System"
    "Network"
  ];

  roles.peer = {
    description = "An EdgeVPN node; it bootstraps from all other peers' public addresses.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = "Public IPv4 address other peers dial to reach this machine.";
      };
      address = lib.mkOption {
        type = lib.types.str;
        example = "10.71.0.1";
        description = "Overlay IPv4 address of this machine inside 10.71.0.0/16; must be unique per peer.";
      };
    };

    perInstance =
      {
        instanceName,
        settings,
        machine,
        roles,
        ...
      }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          let
            edgevpn = packages.${pkgs.hostPlatform.system}.edgevpn;
            port = 8010;
            device = "edgevpn0";
            generatorName = "edgevpn-${instanceName}";
            networkGeneratorName = "edgevpn-${instanceName}-network";
            generator = config.clan.core.vars.generators.${generatorName};

            peerIdPath =
              name:
              "${config.clan.core.settings.directory}/vars/per-machine/${name}/${generatorName}/peer-id/value";

            # Every peer gets all others as bootstrap peers; edgevpn makes them gossipsub
            # direct peers, which keeps a direct libp2p connection to each of them open
            # without the DHT. QUIC only: with TCP also offered, simultaneous dials made each
            # pair randomly end up on QUIC or TCP (TCP-in-TCP), so results were not comparable.
            bootstrapPeers = lib.concatLists (
              lib.mapAttrsToList (
                name: peer:
                lib.optional (name != machine.name && builtins.pathExists (peerIdPath name))
                  "/ip4/${peer.settings.publicAddress}/udp/${toString port}/quic-v1/p2p/${builtins.readFile (peerIdPath name)}"
              ) roles.peer.machines
            );

            args = [
              # %d is the credentials directory: the network config (token) and
              # <dir>/privkey, the stable libp2p identity other peers know the ID of.
              "--config=%d/network.yaml"
              "--privkey-cache"
              "--privkey-cache-dir=%d"
              "--address=${settings.address}/16"
              "--interface=${device}"
              "--listen-maddrs=/ip4/0.0.0.0/udp/${toString port}/quic-v1"
              # Static peers instead of the public IPFS DHT bootstrap nodes and mDNS.
              "--dht=false"
              "--mdns=false"
              # All peers have public addresses, so no relays (which would also need the DHT),
              # hole punching or UPnP port mapping.
              "--autorelay=false"
              "--relay-service=false"
              "--holepunch=false"
              "--natservice=false"
              "--natmap=false"
            ]
            ++ map (p: "--discovery-bootstrap-peers=${p}") bootstrapPeers;
          in
          {
            assertions = [
              {
                assertion =
                  let
                    addresses = lib.mapAttrsToList (_: peer: peer.settings.address) roles.peer.machines;
                  in
                  lib.length addresses == lib.length (lib.unique addresses);
                message = "edgevpn instance '${instanceName}': every peer needs a distinct `address`.";
              }
            ];

            networking.firewall.allowedUDPPorts = [ port ];
            networking.firewall.trustedInterfaces = [ device ];

            systemd.services.edgevpn = {
              description = "EdgeVPN mesh VPN daemon";
              wantedBy = [ "multi-user.target" ];
              wants = [ "network-online.target" ];
              after = [ "network-online.target" ];
              serviceConfig = {
                # clan-core disables systemd-networkd-wait-online, so after a reboot
                # network-online.target is reached before the DHCP lease. edgevpn dials its
                # peers once at start and then only on gossipsub's ~5 min reconnect, so a
                # node whose dials fail would stay cut off (as Hyprspace was after reboots).
                ExecStartPre = "${config.systemd.package}/lib/systemd/systemd-networkd-wait-online --any --ipv4 --operational-state=routable --timeout=120";
                ExecStart = "${lib.getExe edgevpn} ${lib.escapeShellArgs args}";
                LoadCredential = [
                  "network.yaml:${config.clan.core.vars.generators.${networkGeneratorName}.files.config.path}"
                  "privkey:${generator.files.privkey.path}"
                ];
                Restart = "always";
                RestartSec = "3s";
                Slice = "benchmark.slice";
              };
            };

            # The network "token": rendezvous/room names and the OTP keys that seal ledger
            # messages, in YAML form (`edgevpn -g -b` would print the same as base64).
            clan.core.vars.generators.${networkGeneratorName} = {
              share = true;
              files.config.restartUnits = [ "edgevpn.service" ];
              runtimeInputs = [ edgevpn ];
              script = ''
                edgevpn -g > "$out"/config
              '';
            };

            clan.core.vars.generators.${generatorName} = {
              files.privkey.restartUnits = [ "edgevpn.service" ];
              files.peer-id = {
                secret = false;
                deploy = false;
                restartUnits = [ "edgevpn.service" ];
              };
              runtimeInputs = [ edgevpn ];
              script = ''
                edgevpn-keygen "$out"/privkey > "$out"/peer-id
              '';
            };
          };
      };
  };
}
