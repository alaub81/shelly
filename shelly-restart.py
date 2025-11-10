#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shelly-restart.py - Restart all Shelly Gen2+ devices listed in a text file

Description:
    This script reads a list of Shelly Gen2/Gen3 device hostnames (FQDN or IP addresses)
    from a text file and sends an RPC request to reboot each device.
    It prints the result for each device (success or failure).

Usage:
    ./shelly-restart.py -f shelly-hosts.txt
    ./shelly-restart.py -f shelly-hosts.txt -u admin -p secret

Requirements:
    - Python 3.x
    - requests library (pip install requests)

Author:
    Andreas Laub, 2025
"""

import argparse
import requests
import sys

def restart_device(host, timeout=5, auth=None):
    url = f"http://{host}/rpc/Shelly.Reboot"
    try:
        # Wichtig: JSON-Body "{}" mitsenden, sonst kommt HTTP 400
        r = requests.post(url, json={}, timeout=timeout, auth=auth)
        if r.status_code == 200:
            return True, "Reboot triggered"
        else:
            return False, f"HTTP {r.status_code} - {r.text}"
    except requests.exceptions.RequestException as e:
        return False, str(e)

def main():
    parser = argparse.ArgumentParser(description="Restart Shelly Gen2/Gen3 devices via RPC")
    parser.add_argument("-f", "--file", required=True,
                        help="Text file with Shelly hostnames (one per line)")
    parser.add_argument("-u", "--user", help="Username for Shelly authentication")
    parser.add_argument("-p", "--password", help="Password for Shelly authentication")
    args = parser.parse_args()

    try:
        with open(args.file, "r", encoding="utf-8") as fh:
            hosts = [line.strip() for line in fh if line.strip()]
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    if not hosts:
        print("No hosts found in file.")
        sys.exit(1)

    print(f"Restarting {len(hosts)} Shelly devices...\n")

    auth = (args.user, args.password) if args.user and args.password else None

    success_count = 0
    fail_count = 0

    for host in hosts:
        ok, msg = restart_device(host, auth=auth)
        if ok:
            print(f"[OK]   {host}: {msg}")
            success_count += 1
        else:
            print(f"[FAIL] {host}: {msg}")
            fail_count += 1

    print("\nSummary:")
    print(f"  Successful: {success_count}")
    print(f"  Failed:     {fail_count}")

    if fail_count > 0:
        sys.exit(2)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()