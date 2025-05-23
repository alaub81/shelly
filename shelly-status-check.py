#!/usr/bin/python3
"""
Shelly Device Status Checker
============================

Description:
------------
This script queries a list of Shelly IoT devices and displays an overview of
their current operational status. It uses the Shelly RPC interface to fetch
system, WiFi, BLE, MQTT and script information, and presents the data in
a clear table format using the `tabulate` module.

Devices are read from a text file (default: /root/shellies.txt), which should
contain one IP address per line. Sorting can be customized via CLI arguments.

To generate this list automatically on a local network, you can use:
    nmap -sP 192.168.60.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt

Dependencies:
-------------
- Python 3
- requests
- tabulate

Install dependencies (if not already installed):
    pip install requests tabulate

Usage:
------
    python3 shelly-status-check.py
    python3 shelly-status-check.py --file /path/to/devices.txt
    python3 shelly-status-check.py --sort wifi
    python3 shelly-status-check.py --file /path/to/devices.txt --sort wifi

Options:
--------
--file <path>     Path to the text file containing Shelly IP addresses (default: /root/shellies.txt)
--sort <key>      Sorting criteria: 'ip', 'uptime', or 'wifi' (default: 'ip')

Expected Output:
----------------
A table with the following columns:
- IP           ... Device IP address
- Reachable    ... ✅ if reachable, ❌ if not
- Uptime       ... Formatted uptime (days, hours, minutes)
- Eco Mode     ... Whether eco_mode is enabled
- WiFi (dBm)   ... Signal strength
- Bluetooth    ... Whether BLE is enabled
- MQTT         ... MQTT connection status
- Debug UDP    ... Target of debug messages (if configured)
- Scripts      ... List of script names on the device

Author:
-------
Andreas Laub

"""
# nmap -sP 192.168.60.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > /root/shellies.txt

import requests
from tabulate import tabulate
import argparse

# Argumentparser
parser = argparse.ArgumentParser(description="Shelly Status Übersicht")
parser.add_argument("--sort", choices=["uptime", "wifi", "ip"], default="ip", help="Sortierkriterium")
parser.add_argument("--file", default="shellies.txt", help="Pfad zur Datei mit Shelly-IP-Adressen")
args = parser.parse_args()

# Geräte einlesen
with open(args.file, "r") as f:
    shelly_ips = [line.strip() for line in f if line.strip()]

auth = None  # z. B. ('admin', 'passwort')

table_data = []

def format_uptime(seconds):
    try:
        seconds = int(float(seconds))
        days = seconds // 86400
        hours = (seconds % 86400) // 3600
        minutes = (seconds % 3600) // 60
        return f"{days}d {hours}h {minutes}m"
    except:
        return "–"

def parse_rssi(value):
    try:
        return int(value)
    except:
        return float('-inf')

for ip in shelly_ips:
    row = {
        "IP": ip,
        "Erreichbar": "❌",
        "Uptime": "–",
        "UptimeRaw": 0,
        "Eco Mode": "–",
        "WiFi (dBm)": "–",
        "Bluetooth": "–",
        "MQTT": "–",
        "Debug UDP": "–",
        "Skripte": "–"
    }

    try:
        sysconf = requests.get(f"http://{ip}/rpc/Sys.GetConfig", auth=auth, timeout=5).json()
        sysstatus = requests.get(f"http://{ip}/rpc/Sys.GetStatus", auth=auth, timeout=5).json()
        wifi = requests.get(f"http://{ip}/rpc/WiFi.GetStatus", auth=auth, timeout=5).json()
        ble = requests.get(f"http://{ip}/rpc/BLE.GetConfig", auth=auth, timeout=5).json()
        scripts = requests.get(f"http://{ip}/rpc/Script.List", auth=auth, timeout=5).json()
        mqtt = requests.get(f"http://{ip}/rpc/MQTT.GetConfig", auth=auth, timeout=5).json()

        row["Erreichbar"] = "✅"
        row["Eco Mode"] = sysconf.get('device', {}).get('eco_mode', "n.a.")
        row["Debug UDP"] = sysconf.get('debug', {}).get('udp', {}).get('addr', "–")
        row["Uptime"] = format_uptime(sysstatus.get("uptime", 0))
        row["UptimeRaw"] = sysstatus.get("uptime", 0)
        row["WiFi (dBm)"] = wifi.get("rssi", "❓")
        row["Bluetooth"] = "✅" if ble.get("enable", False) else "❌"
        row["MQTT"] = "✅" if mqtt.get('enable', False) else "❌"
        script_names = [s["name"] for s in scripts.get("scripts", [])]
        row["Skripte"] = ", ".join(script_names) if script_names else "–"

    except Exception:
        pass

    table_data.append(row)

# 🔀 Sortierlogik
if args.sort == "uptime":
    table_data.sort(key=lambda row: float(row.get("UptimeRaw", 0)), reverse=True)
elif args.sort == "wifi":
    table_data.sort(key=lambda row: parse_rssi(row["WiFi (dBm)"]), reverse=True)
else:  # Standard: IP
    table_data.sort(key=lambda row: row["IP"])

# Ausgabe
headers = ["IP", "Erreichbar", "Uptime", "Eco Mode", "WiFi (dBm)", "Bluetooth", "MQTT", "Debug UDP", "Skripte"]
rows = [[row[h] for h in headers] for row in table_data]
print(tabulate(rows, headers=headers, tablefmt="grid"))
