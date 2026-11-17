{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "netbird";
  manifest.description = "NetBird - WireGuard-based mesh VPN with a self-hosted control plane";
  manifest.categories = [ "Utility" ];

  roles.controller = {
    description = "Runs the combined NetBird server (management, signal, relay, STUN, embedded IdP). Must be reachable by all peers.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = "IP address or domain name peers use to reach the NetBird server.";
        example = "netbird.example.com";
      };
      port = lib.mkOption {
        type = lib.types.port;
        default = 443;
        description = "TCP port of the NetBird server (management/signal gRPC, relay, HTTP API).";
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
            inherit (shared) keyDir serverStateDir;
            netbird-server = packages.${pkgs.hostPlatform.system}.netbird-server;
            secretsGenerator = "netbird-${instanceName}-server";
            exposedAddress = "https://${shared.hostPort settings.publicAddress settings.port}";
            credentials = "/run/credentials/netbird-server.service";

            configFile = (pkgs.formats.yaml { }).generate "netbird-server.yaml" {
              server = {
                listenAddress = ":${toString settings.port}";
                inherit exposedAddress;
                stunPorts = [ shared.stunPort ];
                healthcheckAddress = "127.0.0.1:9000";
                logLevel = "info";
                logFile = "console";
                tls = {
                  certFile = config.clan.core.vars.generators.${shared.tlsGenerator}.files.cert.path;
                  keyFile = "${credentials}/tls-key";
                };
                # authSecret and store.encryptionKey come from NB_AUTH_SECRET/NB_STORE_ENCRYPTION_KEY.
                dataDir = serverStateDir;
                disableAnonymousMetrics = true;
                disableGeoliteUpdate = true;
                auth = {
                  issuer = "${exposedAddress}/oauth2";
                  signKeyRefreshEnabled = false;
                  dashboardRedirectURIs = [ ];
                  cliRedirectURIs = [ "http://localhost:53000/" ];
                };
                store.engine = "sqlite";
              };
            };
          in
          {
            imports = [ (shared.tlsModule settings.publicAddress) ];

            clan.core.vars.generators.${secretsGenerator} = {
              files.auth-secret.secret = true;
              files.encryption-key.secret = true;
              files.owner-password.secret = true;
              runtimeInputs = [
                pkgs.openssl
                pkgs.coreutils
              ];
              script = ''
                openssl rand -hex 32 | tr -d '\n' > "$out"/auth-secret
                openssl rand -base64 32 | tr -d '\n' > "$out"/encryption-key
                openssl rand -hex 24 | tr -d '\n' > "$out"/owner-password
              '';
            };

            users.users.netbird-server = {
              isSystemUser = true;
              group = "netbird-server";
              home = serverStateDir;
            };
            users.groups.netbird-server = { };

            systemd.services.netbird-server = {
              description = "NetBird combined server";
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];
              environment = {
                # Lets the setup unit obtain a PAT from the unauthenticated /api/setup call.
                NB_SETUP_PAT_ENABLED = "true";
                # GeoLite databases are downloaded from the internet and only feed posture checks.
                NB_DISABLE_GEOLOCATION = "true";
              };
              script = ''
                NB_AUTH_SECRET="$(< "$CREDENTIALS_DIRECTORY/auth-secret")"
                NB_STORE_ENCRYPTION_KEY="$(< "$CREDENTIALS_DIRECTORY/encryption-key")"
                export NB_AUTH_SECRET NB_STORE_ENCRYPTION_KEY
                exec ${lib.getExe' netbird-server "netbird-server"} --config ${configFile}
              '';
              serviceConfig = {
                User = "netbird-server";
                Group = "netbird-server";
                StateDirectory = "netbird-server";
                StateDirectoryMode = "0700";
                WorkingDirectory = serverStateDir;
                LoadCredential = [
                  "tls-key:${config.clan.core.vars.generators.${shared.tlsGenerator}.files.key.path}"
                  "auth-secret:${config.clan.core.vars.generators.${secretsGenerator}.files.auth-secret.path}"
                  "encryption-key:${config.clan.core.vars.generators.${secretsGenerator}.files.encryption-key.path}"
                ];
                AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ];
                CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
                Restart = "always";
                RestartSec = 2;
                Slice = "benchmark.slice";
              };
            };

            # Creates the owner account (once) and a reusable, non-expiring setup key for peers.
            systemd.services.netbird-server-setup = {
              description = "Create the NetBird owner account and peer setup key";
              after = [ "netbird-server.service" ];
              requires = [ "netbird-server.service" ];
              wantedBy = [ "multi-user.target" ];
              path = [
                pkgs.curl
                pkgs.jq
                pkgs.coreutils
              ];
              script = ''
                set -euo pipefail
                key_file=${keyDir}/setup-key
                pat_file=${serverStateDir}/setup-pat
                api=https://127.0.0.1:${toString settings.port}/api
                # The certificate is valid for 127.0.0.1 and trusted system-wide.
                curl() { command curl --silent --show-error --fail-with-body --max-time 30 "$@"; }

                if [ -s "$key_file" ]; then
                  echo "setup key already exists"
                  exit 0
                fi

                for _ in $(seq 1 120); do
                  status=$(curl "$api/instance" 2>/dev/null) && break
                  sleep 1
                done

                if [ ! -s "$pat_file" ]; then
                  if [ "$(jq -r .setup_required <<<"$status")" != true ]; then
                    echo "server is already set up but $pat_file is missing; wipe ${serverStateDir} to start over" >&2
                    exit 1
                  fi
                  jq -n --rawfile password "$CREDENTIALS_DIRECTORY/owner-password" \
                    '{email: "admin@netbird.invalid", name: "admin", password: $password, create_pat: true, pat_expire_in: 365}' |
                    curl -X POST -H 'Content-Type: application/json' --data @- "$api/setup" |
                    jq -er .personal_access_token > "$pat_file.tmp"
                  mv "$pat_file.tmp" "$pat_file"
                fi

                jq -n '{name: "clan-${instanceName}", type: "reusable", expires_in: 0, usage_limit: 0, auto_groups: [], ephemeral: false}' |
                  curl -X POST -H 'Content-Type: application/json' -H "Authorization: Token $(< "$pat_file")" \
                    --data @- "$api/setup-keys" |
                  jq -er .key > "$key_file.tmp"
                mv "$key_file.tmp" "$key_file"
                echo "setup key created"
              '';
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
                User = "netbird-server";
                Group = "netbird-server";
                LoadCredential = [
                  "owner-password:${config.clan.core.vars.generators.${secretsGenerator}.files.owner-password.path}"
                ];
                Restart = "on-failure";
                RestartSec = 5;
                Slice = "benchmark.slice";
              };
            };

            systemd.services.netbird-server-keyserver = {
              description = "Serve the NetBird setup key to peers";
              after = [ "netbird-server.service" ];
              wantedBy = [ "multi-user.target" ];
              serviceConfig = {
                ExecStart = "${lib.getExe pkgs.python3} -m http.server ${toString shared.keyserverPort} --bind 0.0.0.0 --directory ${keyDir}";
                User = "netbird-server";
                Group = "netbird-server";
                Restart = "always";
                RestartSec = 2;
                Slice = "benchmark.slice";
              };
            };

            systemd.tmpfiles.rules = [ "d ${keyDir} 0750 netbird-server netbird-server -" ];

            networking.firewall.allowedTCPPorts = [
              settings.port
              shared.keyserverPort
            ];
            networking.firewall.allowedUDPPorts = [ shared.stunPort ];
          };
      };
  };

  roles.peer = {
    description = "Runs the NetBird client and joins the controller's network.";
    interface.options = { };

    perInstance =
      {
        instanceName,
        roles,
        machine,
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
            controllerNames = lib.attrNames (roles.controller.machines or { });
            controller =
              if controllerNames == [ ] then
                throw "The NetBird instance '${instanceName}' requires a machine with the 'controller' role."
              else
                roles.controller.machines.${lib.head controllerNames}.settings;
            managementHost = shared.hostPort controller.publicAddress controller.port;
            netbirdCli = config.services.netbird.clients.default.wrapper;
          in
          {
            imports = [ (shared.tlsModule controller.publicAddress) ];

            services.netbird = {
              enable = true;
              package = packages.${pkgs.hostPlatform.system}.netbird;
              ui.enable = false;
              clients.default = {
                port = shared.wireguardPort;
                interface = shared.interface;
                # Merged into the client config on every daemon start. Pointing a fresh daemon at
                # our server keeps it from dialing the default api.netbird.io before it joins.
                config = {
                  ManagementURL = {
                    Scheme = "https";
                    Host = managementHost;
                  };
                  # Benchmarks address peers by static host entries; leave host DNS untouched.
                  DisableDNS = true;
                };
                # New accounts enable lazy connections: tunnels are only built on first traffic and
                # torn down when idle, which would leak setup time into latency/reconnect measurements.
                environment.NB_LAZY_CONN = "false";
              };
            };

            systemd.services.netbird.serviceConfig.Slice = "benchmark.slice";

            # Joins with the controller's setup key on first boot, then waits until the daemon reports
            # its NetBird IP so that activation only finishes once `netbird status --ipv4` works.
            systemd.services.netbird-join = {
              description = "Join the NetBird network ${instanceName}";
              after = [
                "netbird.service"
                "network-online.target"
                "netbird-server-setup.service"
                "netbird-server-keyserver.service"
              ];
              requires = [ "netbird.service" ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];
              path = [
                netbirdCli
                pkgs.curl
                pkgs.jq
                pkgs.coreutils
              ];
              script = ''
                set -uo pipefail
                key_url=http://${shared.hostPort controller.publicAddress shared.keyserverPort}/setup-key
                # Generous: all machines deploy concurrently, so the controller may still be starting.
                deadline=$((SECONDS + 900))
                # Grace period for an already-registered peer to reconnect on its own.
                force_login_at=$((SECONDS + 60))

                while ((SECONDS < deadline)); do
                  ip=$(netbird status --ipv4 2>/dev/null)
                  if [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                    echo "NetBird IP: $ip"
                    exit 0
                  fi

                  status=$(netbird status --json 2>/dev/null | jq -r '.daemonStatus // empty')
                  if [[ $status =~ ^(NeedsLogin|LoginFailed|SessionExpired|Idle)$ ]] ||
                    ((SECONDS >= force_login_at)); then
                    if key=$(curl --silent --fail --max-time 5 "$key_url"); then
                      echo "daemon status '$status', logging in to https://${managementHost}"
                      NB_SETUP_KEY="$key" timeout 120 netbird up \
                        --management-url "https://${managementHost}" \
                        --hostname ${lib.escapeShellArg machine.name} \
                        --disable-dns
                      force_login_at=$((SECONDS + 60))
                    else
                      echo "setup key not available yet at $key_url"
                    fi
                  fi
                  sleep 2
                done
                echo "timed out waiting for the NetBird IP" >&2
                exit 1
              '';
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
                TimeoutStartSec = "16min";
                Slice = "benchmark.slice";
              };
            };

            networking.firewall.allowedUDPPorts = [ shared.wireguardPort ];
            networking.firewall.trustedInterfaces = [ shared.interface ];
          };
      };
  };
}
