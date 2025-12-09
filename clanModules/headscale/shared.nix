{
  lib,
  pkgs,
  instanceName,
  settings,
  serverUrl,
  machine,
  controllerInfo ? null,
  isController,
}:
let
  # User name for the headscale user (all machines join under this user)
  userName = "clan-${instanceName}";

  # Interface name (limited to 15 chars for Linux)
  interface = lib.substring 0 15 "ts-${instanceName}";

  # Preauthkey file location on controller
  preauthKeyFile = "/var/lib/headscale/preauthkeys/${userName}.key";

  # Keyserver port
  keyserverPort = 8081;
in
lib.mkMerge [
  # Controller configuration
  (lib.mkIf isController {
    services.headscale = {
      enable = true;
      address = "0.0.0.0";
      port = settings.port;

      settings = {
        server_url = serverUrl;

        # IP prefixes for the tailnet
        prefixes = {
          v4 = "100.64.0.0/10";
          v6 = "fd7a:115c:a1e0::/48";
          allocation = "sequential";
        };

        # DNS configuration with MagicDNS
        dns = {
          magic_dns = true;
          base_domain = settings.baseDomain;
          override_local_dns = false;
          nameservers.global = [
            "1.1.1.1"
            "8.8.8.8"
          ];
        };

        # DERP (relay) configuration - use Tailscale's public DERP servers
        derp = {
          urls = [ "https://controlplane.tailscale.com/derpmap/default" ];
          auto_update_enabled = true;
          update_frequency = "24h";
        };

        # Database configuration (SQLite)
        database = {
          type = "sqlite";
          sqlite = {
            path = "/var/lib/headscale/db.sqlite";
            write_ahead_log = true;
          };
        };

        # Logging
        log = {
          level = "info";
          format = "text";
        };

        # Disable policy file (allow all traffic within the network)
        policy.mode = "file";
        policy.path = "";
      };
    };

    # Open firewall for headscale
    networking.firewall = lib.mkIf settings.openFirewall {
      allowedTCPPorts = [
        settings.port
        keyserverPort
      ];
      allowedUDPPorts = [ 3478 ]; # STUN
    };

    # Benchmark resource slice
    systemd.services.headscale.serviceConfig.Slice = "benchmark.slice";

    # Create directory for preauthkeys
    systemd.tmpfiles.rules = [
      "d /var/lib/headscale/preauthkeys 0755 headscale headscale -"
    ];

    # Setup service that creates user and generates preauthkeys after headscale starts
    systemd.services."headscale-${instanceName}-setup" = {
      description = "Initialize headscale user and preauthkeys for ${instanceName}";
      after = [ "headscale.service" ];
      requires = [ "headscale.service" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = "headscale";
        Group = "headscale";
      };

      path = [
        pkgs.headscale
        pkgs.coreutils
        pkgs.gnugrep
      ];

      script = ''
        set -euo pipefail

        # Wait for headscale to be ready
        for i in $(seq 1 30); do
          if headscale users list &>/dev/null; then
            break
          fi
          echo "Waiting for headscale to be ready... ($i/30)"
          sleep 2
        done

        # Create user if it doesn't exist
        if ! headscale users list | grep -q "${userName}"; then
          echo "Creating user ${userName}"
          headscale users create "${userName}"
        fi

        # Generate a reusable preauthkey if one doesn't exist or is expired
        if [ ! -f "${preauthKeyFile}" ] || [ ! -s "${preauthKeyFile}" ]; then
          echo "Generating new preauthkey for ${userName}"
          # Create a reusable key that expires in 10 years
          headscale preauthkeys create --user "${userName}" --reusable --expiration 87600h | tail -1 > "${preauthKeyFile}"
          chmod 644 "${preauthKeyFile}"
        fi

        echo "Headscale setup complete for ${instanceName}"
      '';
    };

    # Simple HTTP server to serve preauthkeys to peers (on a separate port)
    # This allows peers to fetch their keys without SSH
    systemd.services."headscale-${instanceName}-keyserver" = {
      description = "Serve headscale preauthkeys for ${instanceName}";
      after = [ "headscale-${instanceName}-setup.service" ];
      requires = [ "headscale-${instanceName}-setup.service" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "simple";
        User = "headscale";
        Group = "headscale";
        Restart = "always";
        RestartSec = 5;
        Slice = "benchmark.slice";
      };

      script = ''
        ${pkgs.python3}/bin/python3 -m http.server ${toString keyserverPort} --directory /var/lib/headscale/preauthkeys --bind 0.0.0.0
      '';
    };
  })

  # Peer (Tailscale client) configuration
  (lib.mkIf (!isController) {
    services.tailscale = {
      enable = true;
      # Use the interface name for the tunnel
      interfaceName = interface;
    };

    # Benchmark resource slice
    systemd.services.tailscaled.serviceConfig.Slice = "benchmark.slice";

    # Service to authenticate with headscale
    systemd.services."tailscale-${instanceName}-auth" = {
      description = "Authenticate Tailscale with headscale for ${instanceName}";
      after = [
        "tailscaled.service"
        "network-online.target"
      ];
      requires = [ "tailscaled.service" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        Restart = "on-failure";
        RestartSec = 10;
        Slice = "benchmark.slice";
      };

      path = [
        pkgs.tailscale
        pkgs.curl
        pkgs.coreutils
        pkgs.jq
      ];

      script = ''
        set -euo pipefail

        CONTROLLER_HOST="${controllerInfo.publicAddress}"
        KEYSERVER_PORT="${toString keyserverPort}"

        # Wait for the key server to be available
        echo "Waiting for headscale keyserver at $CONTROLLER_HOST:$KEYSERVER_PORT..."
        for i in $(seq 1 60); do
          if curl -sf "http://$CONTROLLER_HOST:$KEYSERVER_PORT/${userName}.key" > /dev/null 2>&1; then
            break
          fi
          echo "Keyserver not ready, waiting... ($i/60)"
          sleep 5
        done

        # Fetch the preauthkey
        AUTHKEY=$(curl -sf "http://$CONTROLLER_HOST:$KEYSERVER_PORT/${userName}.key")

        if [ -z "$AUTHKEY" ]; then
          echo "Failed to fetch preauthkey"
          exit 1
        fi

        # Check if already authenticated
        if tailscale status &>/dev/null; then
          STATUS=$(tailscale status --json 2>/dev/null | jq -r '.BackendState' || echo "unknown")
          if [ "$STATUS" = "Running" ]; then
            echo "Tailscale already authenticated and running"
            exit 0
          fi
        fi

        # Authenticate with headscale
        echo "Authenticating with headscale at ${serverUrl}..."
        tailscale up \
          --login-server="${serverUrl}" \
          --authkey="$AUTHKEY" \
          --hostname="${machine.name}" \
          --accept-routes=${if settings.acceptRoutes then "true" else "false"} \
          ${lib.optionalString settings.exitNode "--advertise-exit-node"} \
          --reset

        echo "Tailscale authentication complete"
      '';
    };

    # Open firewall for Tailscale/WireGuard
    networking.firewall = {
      # Tailscale uses WireGuard which needs UDP
      allowedUDPPorts = [ 41641 ];
      # Trust the tailscale interface
      trustedInterfaces = [ interface ];
    };
  })
]
