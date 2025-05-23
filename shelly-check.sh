#!/bin/bash

# ------------------------------------------------------------------------------
# Script Name: shelly-check.sh
#
# Description:
# This script performs a basic health check for a list of Shelly devices by 
# sending HTTP requests to their status endpoints. It verifies whether each 
# device is reachable and responsive. This is useful for monitoring availability 
# and detecting outages in Shelly-based smart home installations.
#
# Usage:
# Configure the script with a list of Shelly device IPs or hostnames. The script 
# will iterate through them and log the connectivity status.
#
# Default Behavior:
# By default, the script looks for a file named 'shellies.txt' located in the 
# same directory as the script itself.
#
# Optional Parameters:
# --file <path> : Specifies a custom file containing Shelly IP addresses, one per line.
#
# You can automatically generate the device list using nmap:
#   nmap -sP 192.168.10.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt
#
# Requirements:
# - curl
# - (optional) nmap, grep, awk for automatic IP list generation
#
# Author: Andreas Laub
# ------------------------------------------------------------------------------

# Determine the script directory and default shellies file path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELLIES_FILE="$SCRIPT_DIR/shellies.txt"

# Parse optional arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --file)
      SHELLIES_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--file path/to/shellies.txt]"
      exit 1
      ;;
  esac
done

# Check if the shellies file exists
if [[ ! -f "$SHELLIES_FILE" ]]; then
  echo "File $SHELLIES_FILE not found!"
  exit 1
fi

# Iterate through the list of IPs and perform the health check
while IFS= read -r SHELLY_IP; do
  if curl -s --connect-timeout 15 "http://$SHELLY_IP/rpc/Shelly.GetStatus" | grep -q '"id":'; then
    echo "$(date): Shelly $SHELLY_IP is reachable" > /dev/null
  else
    echo "$(date): Shelly http://$SHELLY_IP is OFFLINE!" #>> /tmp/shelly_monitor.log
  fi
done < "$SHELLIES_FILE"
