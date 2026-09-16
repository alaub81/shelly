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
- wcwidth (lets tabulate correctly measure the width of the ✅/❌/❓ emojis
  used in this table; without it, emoji columns misalign in most terminals)

Install dependencies (if not already installed):
    pip install requests tabulate wcwidth

Usage:
------
    python3 shelly-status-check.py                  (called without any arguments, prints this help)
    python3 shelly-status-check.py --file /path/to/devices.txt --sort wifi
    python3 shelly-status-check.py --sort firmware

Options:
--------
--file <path>     Path to the text file containing Shelly IP addresses (default: shellies.txt)
--sort <key>      Sorting criteria: 'ip', 'uptime', 'wifi', 'devtype', 'firmware' or 'response' (default: 'ip')

Expected Output:
----------------
A table with the following columns:
- IP           ... Device IP address
- Device Type  ... Device Type and Device Generation
- Reachable    ... ✅ if reachable, ❌ if not
- Response Time ... Time it took the device to answer all status requests (in ms)
- Firmware     ... Currently installed firmware version
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

import sys
import re
import time
import requests
from tabulate import tabulate
import argparse

try:
    import wcwidth  # noqa: F401  (tabulate erkennt es automatisch und misst dann
                     # die Breite von Emojis wie ✅/❌/❓ korrekt, damit die
                     # Tabellenspalten sauber ausgerichtet bleiben)
except ImportError:
    print("Hinweis: Paket 'wcwidth' nicht gefunden – die Tabelle kann bei Emojis "
          "(✅/❌/❓) schief ausgerichtet sein. Beheben mit: pip install wcwidth\n",
          file=sys.stderr)

# Argumentparser
parser = argparse.ArgumentParser(description="Shelly Status Übersicht")
parser.add_argument("--sort", choices=["uptime", "wifi", "ip", "devtype", "firmware", "response"], default="ip", help="Sortierkriterium")
parser.add_argument("--file", default="shellies.txt", help="Pfad zur Datei mit Shelly-IP-Adressen")

# Ohne jegliche Parameter: Optionen anzeigen statt mit FileNotFoundError abzubrechen
if len(sys.argv) == 1:
    parser.print_help()
    sys.exit(0)

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

def parse_version(value):
    # Wandelt z. B. "1.4.4" in (1, 4, 4) um, damit numerisch statt alphabetisch
    # sortiert wird (sonst wäre "1.10.0" < "1.9.0"). Nicht erkannte Werte (z. B. "–")
    # landen ans Ende.
    parts = re.findall(r"\d+", str(value))
    if not parts:
        return (-1,)
    return tuple(int(p) for p in parts)

for ip in shelly_ips:
    row = {
        "IP": ip,
        "Device Type": "–",
        "Reachable": "❌",
        "Response Time": "–",
        "ResponseTimeRaw": None,
        "Firmware": "–",
        "Uptime": "–",
        "UptimeRaw": 0,
        "Eco Mode": "–",
        "WiFi (dBm)": "–",
        "Bluetooth": "–",
        "MQTT": "–",
        "Debug UDP": "–",
        "Scripts": "–"
    }

    try:
        start = time.perf_counter()

        sysconf = requests.get(f"http://{ip}/rpc/Sys.GetConfig", auth=auth, timeout=5).json()
        sysstatus = requests.get(f"http://{ip}/rpc/Sys.GetStatus", auth=auth, timeout=5).json()
        wifi = requests.get(f"http://{ip}/rpc/WiFi.GetStatus", auth=auth, timeout=5).json()
        ble = requests.get(f"http://{ip}/rpc/BLE.GetConfig", auth=auth, timeout=5).json()
        scripts = requests.get(f"http://{ip}/rpc/Script.List", auth=auth, timeout=5).json()
        mqtt = requests.get(f"http://{ip}/rpc/MQTT.GetConfig", auth=auth, timeout=5).json()
        devinfo = requests.get(f"http://{ip}/rpc/Shelly.GetDeviceInfo", auth=auth, timeout=5).json()

        elapsed_ms = (time.perf_counter() - start) * 1000
        row["Response Time"] = f"{elapsed_ms:.0f} ms"
        row["ResponseTimeRaw"] = elapsed_ms

        row["Device Typ"] = f'{devinfo.get("app", "–")} (Gen {devinfo.get("gen", "?")})'
        row["Reachable"] = "✅"
        row["Firmware"] = devinfo.get("ver", devinfo.get("fw_id", "–"))
        row["Eco Mode"] = sysconf.get('device', {}).get('eco_mode', "n.a.")
        row["Debug UDP"] = sysconf.get('debug', {}).get('udp', {}).get('addr', "–")
        row["Uptime"] = format_uptime(sysstatus.get("uptime", 0))
        row["UptimeRaw"] = sysstatus.get("uptime", 0)
        row["WiFi (dBm)"] = wifi.get("rssi", "❓")
        if "enable" in ble:
            # Old firmware: Bluetooth enabled/disabled
            row["Bluetooth"] = "✅" if ble["enable"] else "❌"
        else:
            # Firmware 2.0+: current Bluetooth activity
            try:
                response = requests.get(
                    f"http://{ip}/rpc/BLE.GetStatus",
                    auth=auth,
                    timeout=5,
                )
                response.raise_for_status()
                ble_status = response.json()

                if "error" in ble_status or "code" in ble_status:
                    row["Bluetooth"] = "❓"
                else:
                    row["Bluetooth"] = "✅" if ble_status.get("flags") else "❌"
            except (requests.RequestException, ValueError):
                row["Bluetooth"] = "❓"
        row["MQTT"] = "✅" if mqtt.get('enable', False) else "❌"
        script_names = [s["name"] for s in scripts.get("scripts", [])]
        row["Scripts"] = ", ".join(script_names) if script_names else "–"

    except Exception:
        pass

    table_data.append(row)

# 🔀 Sortierlogik
if args.sort == "uptime":
    table_data.sort(key=lambda row: float(row.get("UptimeRaw", 0)), reverse=True)
elif args.sort == "wifi":
    table_data.sort(key=lambda row: parse_rssi(row["WiFi (dBm)"]), reverse=True)
elif args.sort == "devtype":
    table_data.sort(key=lambda row: (row.get("Device Typ", ""), row.get("IP", "")))
elif args.sort == "firmware":
    table_data.sort(key=lambda row: parse_version(row.get("Firmware", "")), reverse=True)
elif args.sort == "response":
    # Nicht erreichbare Geräte (ResponseTimeRaw ist None) landen ans Ende
    table_data.sort(key=lambda row: row["ResponseTimeRaw"] if row["ResponseTimeRaw"] is not None else float('inf'))
else:  # Standard: IP
    table_data.sort(key=lambda row: row["IP"])

# Ausgabe
headers = ["IP", "Device Typ", "Reachable", "Response Time", "Firmware", "Uptime", "Eco Mode", "WiFi (dBm)", "Bluetooth", "MQTT", "Debug UDP", "Scripts"]
rows = [[row.get(h, "") for h in headers] for row in table_data]
print(tabulate(rows, headers=headers, tablefmt="grid"))