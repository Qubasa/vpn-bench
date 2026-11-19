{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "netmaker";
  manifest.description = "Netmaker - kernel WireGuard full mesh managed by a self-hosted Netmaker server";
  manifest.categories = [
    "System"
    "Network"
  ];

  roles.controller = {
    description = "Runs the Netmaker server, its MQTT broker and TLS endpoints, and creates the network and enrollment key. Must be reachable by all peers.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = "IP address or domain name peers use to reach the Netmaker server.";
        example = "203.0.113.1";
      };
      subnet = lib.mkOption {
        type = lib.types.str;
        default = "10.74.0.0/16";
        description = "IPv4 range the server assigns overlay addresses from.";
      };
    };

    perInstance =
      { instanceName, settings, ... }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          let
            shared = import ./shared.nix { inherit lib instanceName; };
            inherit (shared) serverStateDir;
            netmaker = packages.${pkgs.hostPlatform.system}.netmaker;
            secretsGenerator = "netmaker-${instanceName}-server";
            generators = config.clan.core.vars.generators;
            certFile = generators.${shared.tlsGenerator}.files.cert.path;
            publicApi = shared.hostPort settings.publicAddress shared.tlsApiPort;
            mqUser = "netmaker";

            mosquittoConfig = pkgs.writeText "netmaker-mosquitto.conf" ''
              per_listener_settings false
              allow_anonymous false
              password_file /run/netmaker-mqtt/passwd
              persistence false
              log_dest stdout

              listener ${toString shared.mqttPort} 127.0.0.1

              listener ${toString shared.mqttTlsPort}
              certfile ${certFile}
              keyfile /run/credentials/netmaker-mqtt.service/tls-key
            '';
          in
          {
            imports = [ (shared.sharedModule settings.publicAddress) ];

            clan.core.vars.generators.${secretsGenerator} = {
              files.mq-password.secret = true;
              runtimeInputs = [
                pkgs.openssl
                pkgs.coreutils
              ];
              script = ''
                openssl rand -hex 24 | tr -d '\n' > "$out"/mq-password
              '';
            };

            users.users.netmaker = {
              isSystemUser = true;
              group = "netmaker";
              home = serverStateDir;
            };
            users.groups.netmaker = { };

            systemd.services.netmaker-mqtt = {
              description = "Mosquitto MQTT broker for Netmaker";
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];
              path = [ pkgs.mosquitto ];
              script = ''
                umask 077
                printf '%s:%s\n' ${mqUser} "$(< "$CREDENTIALS_DIRECTORY/mq-password")" > "$RUNTIME_DIRECTORY/passwd"
                mosquitto_passwd -U "$RUNTIME_DIRECTORY/passwd"
                exec mosquitto -c ${mosquittoConfig}
              '';
              serviceConfig = {
                DynamicUser = true;
                RuntimeDirectory = "netmaker-mqtt";
                LoadCredential = [
                  "tls-key:${generators.${shared.tlsGenerator}.files.key.path}"
                  "mq-password:${generators.${secretsGenerator}.files.mq-password.path}"
                ];
                Restart = "always";
                RestartSec = 2;
                Slice = "benchmark.slice";
              };
            };

            systemd.services.netmaker = {
              description = "Netmaker server";
              after = [
                "network-online.target"
                "netmaker-mqtt.service"
              ];
              wants = [
                "network-online.target"
                "netmaker-mqtt.service"
              ];
              wantedBy = [ "multi-user.target" ];
              # See scripts/netmaker.default.env upstream.
              environment = {
                SERVER_NAME = settings.publicAddress;
                SERVER_HOST = settings.publicAddress;
                # Both end up in enrollment tokens and host configs; netclient prepends https://.
                SERVER_HTTP_HOST = publicApi;
                SERVER_API_CONN_STRING = publicApi;
                API_PORT = toString shared.apiPort;
                BROKER_ENDPOINT = "ssl://${shared.hostPort settings.publicAddress shared.mqttTlsPort}";
                SERVER_BROKER_ENDPOINT = "tcp://127.0.0.1:${toString shared.mqttPort}";
                MQ_USERNAME = mqUser;
                DATABASE = "sqlite";
                DISABLE_REMOTE_IP_CHECK = "on";
                TELEMETRY = "off";
                NETCLIENT_AUTO_UPDATE = "disabled";
                # No CoreDNS and no rewriting of the hosts' resolver configuration.
                DNS_MODE = "off";
                MANAGE_DNS = "false";
                # Peers announce their public address as static endpoint; no STUN (whose default
                # servers are Google's) and no probing of peers' other interface addresses.
                STUN = "false";
                ENDPOINT_DETECTION = "false";
                METRICS_EXPORTER = "off";
                VERBOSITY = "1";
              };
              script = ''
                MASTER_KEY="$(< "$CREDENTIALS_DIRECTORY/master-key")"
                MQ_PASSWORD="$(< "$CREDENTIALS_DIRECTORY/mq-password")"
                export MASTER_KEY MQ_PASSWORD
                exec ${lib.getExe netmaker}
              '';
              serviceConfig = {
                User = "netmaker";
                Group = "netmaker";
                StateDirectory = "netmaker";
                StateDirectoryMode = "0700";
                # The SQLite database goes to ./data.
                WorkingDirectory = serverStateDir;
                LoadCredential = [
                  "master-key:${generators.${shared.networkGenerator}.files.master-key.path}"
                  "mq-password:${generators.${secretsGenerator}.files.mq-password.path}"
                ];
                Restart = "always";
                RestartSec = 2;
                Slice = "benchmark.slice";
              };
            };

            # The server only serves plain HTTP, while netclient insists on https://.
            systemd.services.netmaker-api-tls = {
              description = "TLS endpoint for the Netmaker API";
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];
              serviceConfig = {
                ExecStart = lib.concatStringsSep " " [
                  (lib.getExe pkgs.socat)
                  "OPENSSL-LISTEN:${toString shared.tlsApiPort},reuseaddr,fork,cert=${certFile},key=%d/tls-key,verify=0"
                  "TCP:127.0.0.1:${toString shared.apiPort}"
                ];
                DynamicUser = true;
                LoadCredential = [ "tls-key:${generators.${shared.tlsGenerator}.files.key.path}" ];
                Restart = "always";
                RestartSec = 2;
                Slice = "benchmark.slice";
              };
            };

            # Creates the network; the server then adds the network's unlimited default enrollment
            # key, which peers join with.
            systemd.services.netmaker-setup = {
              description = "Create the Netmaker network";
              after = [ "netmaker.service" ];
              requires = [ "netmaker.service" ];
              wantedBy = [ "multi-user.target" ];
              path = [
                pkgs.curl
                pkgs.jq
                pkgs.coreutils
              ];
              script = ''
                set -euo pipefail
                api=http://127.0.0.1:${toString shared.apiPort}/api
                network=${lib.escapeShellArg shared.network}
                call() {
                  curl --silent --show-error --fail-with-body --max-time 30 \
                    -H @<(printf 'Authorization: Bearer %s\n' "$(< "$CREDENTIALS_DIRECTORY/master-key")") \
                    -H 'Content-Type: application/json' "$@"
                }

                for _ in $(seq 1 120); do
                  call "$api/networks" >/dev/null 2>&1 && break
                  sleep 1
                done

                if call "$api/networks/$network" >/dev/null 2>&1; then
                  echo "network $network already exists"
                  exit 0
                fi
                # 1420 is kernel WireGuard's default MTU; Netmaker would default to 1280.
                jq -n --arg n "$network" --arg r ${lib.escapeShellArg settings.subnet} \
                  '{netid: $n, addressrange: $r, defaultmtu: 1420}' |
                  call -X POST --data @- "$api/networks" >/dev/null
                echo "created network $network"
              '';
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
                User = "netmaker";
                Group = "netmaker";
                LoadCredential = [
                  "master-key:${generators.${shared.networkGenerator}.files.master-key.path}"
                ];
                Restart = "on-failure";
                RestartSec = 5;
                Slice = "benchmark.slice";
              };
            };

            networking.firewall.allowedTCPPorts = [
              shared.tlsApiPort
              shared.mqttTlsPort
            ];
          };
      };
  };

  roles.peer = {
    description = "Runs netclient and joins the controller's network.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = "Public IPv4 address of this machine, announced to other peers as its static WireGuard endpoint.";
      };
    };

    perInstance =
      {
        instanceName,
        settings,
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
            shared = import ./shared.nix { inherit lib instanceName; };
            netclient = packages.${pkgs.hostPlatform.system}.netclient;
            controllerNames = lib.attrNames (roles.controller.machines or { });
            controller =
              if controllerNames == [ ] then
                throw "The Netmaker instance '${instanceName}' requires a machine with the 'controller' role."
              else
                roles.controller.machines.${lib.head controllerNames}.settings;
            serversFile = "${shared.netclientStateDir}/servers.json";
          in
          {
            imports = [ (shared.sharedModule controller.publicAddress) ];

            # For `netclient list` / `netclient peers`.
            environment.systemPackages = [ netclient ];

            systemd.services.netclient = {
              description = "Netmaker netclient daemon";
              after = [
                "network-online.target"
                "netmaker-setup.service"
                "netmaker-api-tls.service"
                "netmaker-mqtt.service"
              ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];
              path = [
                netclient
                config.networking.firewall.package
                pkgs.iproute2
                pkgs.coreutils
                pkgs.curl
                pkgs.jq
              ];
              # Joins before the daemon first starts: an unjoined daemon has no static endpoint
              # and would look up its public IP via icanhazip.com/ifconfig.me and Google STUN.
              preStart = ''
                set -uo pipefail
                # Nodes only appear once the daemon pulls them; a saved server means we registered.
                registered() { jq -e 'length > 0' ${serversFile} >/dev/null 2>&1; }
                registered && exit 0

                network=${lib.escapeShellArg shared.network}
                key_url=https://${shared.hostPort controller.publicAddress shared.tlsApiPort}/api/v1/enrollment-keys/network/$network/default
                # Generous: all machines deploy concurrently, so the controller may still be starting.
                deadline=$((SECONDS + 900))
                while ((SECONDS < deadline)); do
                  if token=$(curl --silent --fail --max-time 10 \
                    -H @<(printf 'Authorization: Bearer %s\n' "$(< "$CREDENTIALS_DIRECTORY/master-key")") \
                    "$key_url" | jq -er .token); then
                    # join signals the PID in this file; the daemon is not running, so drop a stale one.
                    rm -f /run/netclient.pid
                    netclient join -t "$token" -e ${lib.escapeShellArg settings.publicAddress} \
                      -p ${toString shared.wireguardPort}
                    registered && exit 0
                  else
                    echo "enrollment token not available yet at $key_url"
                  fi
                  sleep 5
                done
                echo "timed out joining $network" >&2
                exit 1
              '';
              script = "exec netclient daemon";
              # The unit only becomes active once the server-assigned address is on the interface,
              # so that deployment finishes with a usable overlay IP.
              postStart = ''
                for _ in $(seq 1 120); do
                  ip=$(ip -4 -j addr show dev ${shared.interface} 2>/dev/null | jq -r '.[0].addr_info[0].local // empty')
                  if [[ -n $ip ]]; then
                    echo "Netmaker IP: $ip"
                    exit 0
                  fi
                  sleep 1
                done
                echo "timed out waiting for an address on ${shared.interface}" >&2
                exit 1
              '';
              serviceConfig = {
                LoadCredential = [
                  "master-key:${config.clan.core.vars.generators.${shared.networkGenerator}.files.master-key.path}"
                ];
                TimeoutStartSec = "17min";
                Restart = "always";
                RestartSec = 5;
                Slice = "benchmark.slice";
              };
            };

            networking.firewall.allowedUDPPorts = [ shared.wireguardPort ];
            networking.firewall.trustedInterfaces = [ shared.interface ];
          };
      };
  };
}
