#!/usr/bin/python3
"""
Shelly Device Status Checker
============================

Description:
------------
This script queries a list of Shelly Gen2+ devices and displays their
configuration and current status in a formatted table.

Each device is queried through its own HTTP session using four RPC requests:
- Shelly.GetStatus
- Shelly.GetConfig
- Script.List
- Shelly.GetDeviceInfo

The session allows HTTP connection reuse when supported by the device.

Devices are read from a text file (default: shellies.txt), with one IP
address per line.

To generate this list automatically on a local network, you can use:
    nmap -sP 192.168.60.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt

Dependencies:
-------------
- Python 3
- requests
- tabulate
- wcwidth (ensures correct alignment of emoji columns)

Install dependencies:
    pip install requests tabulate wcwidth

Usage:
------
    python3 shelly-status-check.py
        Show command-line help.

    python3 shelly-status-check.py --file /path/to/devices.txt --sort wifi
        Query devices from the specified file and sort by WiFi signal strength.

    python3 shelly-status-check.py --sort firmware
        Query devices from shellies.txt and sort by firmware version.

Options:
--------
--file <path>    File containing device IP addresses (default: shellies.txt).
--sort <key>     Sort by ip, uptime, wifi, devtype, firmware or response
                 (default: ip).

Output:
-------
- IP            ... Device IP address.
- Device Type   ... Device application name and generation.
- Reachable     ... Whether the device was successfully reached.
- Response Time ... Duration of the initial Shelly.GetStatus request in ms,
                    including connection setup; not the total query duration.
- Firmware      ... Installed firmware version.
- Uptime        ... Time since startup, formatted as days, hours and minutes.
- Eco Mode      ... Whether Eco Mode is enabled.
- WiFi (dBm)    ... WiFi signal strength when connected, or "LAN" when Ethernet
                    has an IP address and no usable WiFi reading is available.
                    WiFi takes precedence when both interfaces are connected.
- Bluetooth     ... Older firmware: whether Bluetooth is enabled.
                    Firmware 2.0+: whether Bluetooth is currently scanning,
                    advertising or connected. Inactivity does not mean that
                    Bluetooth is permanently disabled.
                    Unknown or unavailable status is shown as ❓.
- MQTT          ... Whether MQTT is enabled in the configuration;
                    does not indicate an active broker connection.
- Debug UDP     ... Configured destination for UDP debug messages.
- Scripts       ... Names of scripts installed on the device.

Notes:
------
- Bluetooth activity is a snapshot and may change automatically as needed.
- Ethernet link speed is not reported.
- LAN devices and unavailable WiFi readings sort after numeric WiFi readings.
- Devices must support the RPC methods listed above.

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
    import wcwidth  # noqa: F401  (Tabulate recognises it automatically and then measures
                     # the width of emojis like ✅/❌/❓ correctly, so that the
                     # table columns are aligned properly)
except ImportError:
    print("Hinweis: Paket 'wcwidth' nicht gefunden – die Tabelle kann bei Emojis "
          "(✅/❌/❓) schief ausgerichtet sein. Beheben mit: pip install wcwidth\n",
          file=sys.stderr)

# Argumentparser
parser = argparse.ArgumentParser(description="Shelly Status Übersicht")
parser.add_argument("--sort", choices=["uptime", "wifi", "ip", "devtype", "firmware", "response"], default="ip", help="Sortierkriterium")
parser.add_argument("--file", default="shellies.txt", help="Pfad zur Datei mit Shelly-IP-Adressen")

# Without any parameters: display options instead of terminating with a FileNotFoundError
if len(sys.argv) == 1:
    parser.print_help()
    sys.exit(0)

args = parser.parse_args()

# read device IPs from file
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
    # Converts, for example, "1.4.4" to (1, 4, 4) so that sorting is numerical rather than alphabetical
    # (otherwise "1.10.0" would be < "1.9.0"). Unrecognised values (e.g. "–")
    # are placed at the end.
    parts = re.findall(r"\d+", str(value))
    if not parts:
        return (-1,)
    return tuple(int(p) for p in parts)

def get_rpc(session, ip, method):
    response = session.get(
        f"http://{ip}/rpc/{method}",
        timeout=5,
    )
    response.raise_for_status()
    data = response.json()

    if not isinstance(data, dict):
        raise ValueError(f"{method}: unexpected reply")
    if "error" in data or "code" in data:
        raise ValueError(f"{method}: {data}")

    return data

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
        with requests.Session() as session:
            session.auth = auth

            start = time.perf_counter()
            status = get_rpc(session, ip, "Shelly.GetStatus")
            elapsed_ms = (time.perf_counter() - start) * 1000

            config = get_rpc(session, ip, "Shelly.GetConfig")
            scripts = get_rpc(session, ip, "Script.List")
            devinfo = get_rpc(session, ip, "Shelly.GetDeviceInfo")

        sysstatus = status.get("sys", {})
        wifi = status.get("wifi", {})
        ble_status = status.get("ble")

        sysconf = config.get("sys", {})
        ble = config.get("ble", {})
        mqtt = config.get("mqtt", {})
        eth = status.get("eth", {})
        rssi = wifi.get("rssi")
        
        row["Response Time"] = f"{elapsed_ms:.0f} ms"
        row["ResponseTimeRaw"] = elapsed_ms

        row["Device Type"] = f'{devinfo.get("app", "–")} (Gen {devinfo.get("gen", "?")})'
        row["Reachable"] = "✅"
        row["Firmware"] = devinfo.get("ver", devinfo.get("fw_id", "–"))
        row["Eco Mode"] = sysconf.get('device', {}).get('eco_mode', "n.a.")
        row["Debug UDP"] = sysconf.get('debug', {}).get('udp', {}).get('addr', "–")
        row["Uptime"] = format_uptime(sysstatus.get("uptime", 0))
        row["UptimeRaw"] = sysstatus.get("uptime", 0)

        if wifi.get("status") == "got ip" and rssi is not None:
            row["WiFi (dBm)"] = rssi
        elif eth.get("ip"):
            row["WiFi (dBm)"] = "LAN"
        else:
            row["WiFi (dBm)"] = "–"

        if "enable" in ble:
            # Old firmware: configured Bluetooth switch
            row["Bluetooth"] = "✅" if ble["enable"] else "❌"
        elif isinstance(ble_status, dict) and "addr" in ble_status:
            # Firmware 2.0+: current activity from the batch query
            row["Bluetooth"] = "✅" if ble_status.get("flags") else "❌"
        else:
            # Bluetooth status is missing or cannot be interpreted
            row["Bluetooth"] = "❓"
        row["MQTT"] = "✅" if mqtt.get('enable', False) else "❌"
        script_names = [s["name"] for s in scripts.get("scripts", [])]
        row["Scripts"] = ", ".join(script_names) if script_names else "–"

    except Exception:
        pass

    table_data.append(row)

# Sorting logic
if args.sort == "uptime":
    table_data.sort(key=lambda row: float(row.get("UptimeRaw", 0)), reverse=True)
elif args.sort == "wifi":
    table_data.sort(key=lambda row: parse_rssi(row["WiFi (dBm)"]), reverse=True)
elif args.sort == "devtype":
    table_data.sort(key=lambda row: (row.get("Device Type", ""), row.get("IP", "")))
elif args.sort == "firmware":
    table_data.sort(key=lambda row: parse_version(row.get("Firmware", "")), reverse=True)
elif args.sort == "response":
    # Non-reachable devices (ResponseTimeRaw is None) land at the end
    table_data.sort(key=lambda row: row["ResponseTimeRaw"] if row["ResponseTimeRaw"] is not None else float('inf'))
else:  # Standard: IP
    table_data.sort(key=lambda row: row["IP"])

# Output the table
headers = ["IP", "Device Type", "Reachable", "Response Time", "Firmware", "Uptime", "Eco Mode", "WiFi (dBm)", "Bluetooth", "MQTT", "Debug UDP", "Scripts"]
rows = [[row.get(h, "") for h in headers] for row in table_data]
print(tabulate(rows, headers=headers, tablefmt="grid"))