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
# You can automatically generate the device list using nmap:
#   nmap -sP 192.168.10.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt
#
# Requirements:
# - curl
# - (optional) nmap, grep, awk for automatic IP list generation
#
# Author: Andreas Laub
# ------------------------------------------------------------------------------

for i in $(cat /root/shellies.txt); do

	SHELLY_IP=$i
	if curl -s --connect-timeout 15 "http://$SHELLY_IP/rpc/Shelly.GetStatus" | grep -q '"id":'; then
    		echo "$(date): Shelly $i ist erreichbar" > /dev/null
	else
    		echo "$(date): Shelly http://$i ist OFFLINE!" #>> /tmp/shelly_monitor.log
	fi
done
