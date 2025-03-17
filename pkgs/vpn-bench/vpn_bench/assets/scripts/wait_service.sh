#!/usr/bin/env bash

set -euo pipefail

# Default values
SERVICE_NAME=""
MAX_WAIT_SECONDS=600 # 10 minutes default timeout
POLL_INTERVAL=1      # Check every 1 seconds
QUIET=false

function usage() {
  echo "Usage: $0 -s SERVICE_NAME [-t TIMEOUT_SECONDS] [-i POLL_INTERVAL] [-q]"
  echo
  echo "Wait until a systemd service completes execution."
  echo
  echo "Arguments:"
  echo "  -s SERVICE_NAME     Name of the systemd service to wait for (required)"
  echo "  -t TIMEOUT_SECONDS  Maximum time to wait in seconds (default: 600)"
  echo "  -i POLL_INTERVAL    How often to check service status in seconds (default: 1)"
  echo "  -q                  Quiet mode (suppress informational output)"
  echo "  -h                  Show this help message"
  echo
  echo "Exit codes:"
  echo "  0 - Service completed successfully"
  echo "  1 - Service failed"
  echo "  2 - Timeout waiting for service to complete"
  echo "  3 - Service does not exist or other error"
  exit 1
}

function log() {
  if [ "$QUIET" = false ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  fi
}

# Parse command line arguments
while getopts ":s:t:i:qh" opt; do
  case $opt in
  s)
    SERVICE_NAME="$OPTARG"
    ;;
  t)
    MAX_WAIT_SECONDS="$OPTARG"
    ;;
  i)
    POLL_INTERVAL="$OPTARG"
    ;;
  q)
    QUIET=true
    ;;
  h)
    usage
    ;;
  \?)
    echo "Error: Invalid option -$OPTARG" >&2
    usage
    ;;
  :)
    echo "Error: Option -$OPTARG requires an argument" >&2
    usage
    ;;
  esac
done

# Ensure SERVICE_NAME is provided
if [ -z "$SERVICE_NAME" ]; then
  echo "Error: Service name is required" >&2
  usage
fi

# Append .service if not already present
if [[ ! $SERVICE_NAME =~ \.service$ ]]; then
  SERVICE_NAME="${SERVICE_NAME}.service"
fi

# Check if service exists
if ! systemctl list-units --all --type=service | awk '{print $1}' | grep -qx "$SERVICE_NAME"; then
  log "Error: Service $SERVICE_NAME does not exist"
  exit 3
fi

log "Waiting for $SERVICE_NAME to complete..."
start_time=$(date +%s)
end_time=$((start_time + MAX_WAIT_SECONDS))

while true; do
  current_time=$(date +%s)

  # Check if we've exceeded the timeout
  if [ $current_time -gt $end_time ]; then
    log "Timeout waiting for $SERVICE_NAME to complete after $MAX_WAIT_SECONDS seconds"
    exit 2
  fi

  # Get service status
  service_state=$(systemctl show -p ActiveState --value "$SERVICE_NAME")
  sub_state=$(systemctl show -p SubState --value "$SERVICE_NAME")
  result=$(systemctl show -p Result --value "$SERVICE_NAME")

  # If service is inactive (completed)
  if [ "$service_state" = "inactive" ] && [ "$sub_state" = "dead" ]; then
    # Check if it was successful
    if [ "$result" = "success" ]; then
      # Check the exit code from ExecStart
      exec_start=$(systemctl show -p ExecStart "$SERVICE_NAME" | grep -o 'status=[0-9]*')
      exit_status=${exec_start#status=}

      if [ -z "$exit_status" ] || [ "$exit_status" = "0" ]; then
        elapsed=$((current_time - start_time))
        log "Service $SERVICE_NAME completed successfully after $elapsed seconds"
        exit 0
      else
        log "Service $SERVICE_NAME completed with non-zero exit status: $exit_status"
        exit 1
      fi
    else
      log "Service $SERVICE_NAME failed with result: $result"
      exit 1
    fi
  fi

  # If service is in a failed state
  if [ "$service_state" = "failed" ]; then
    log "Service $SERVICE_NAME failed"
    exit 1
  fi

  # Wait before checking again
  sleep $POLL_INTERVAL
done
