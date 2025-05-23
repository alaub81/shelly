#!/usr/bin/python3
"""
Shelly MQTT Configuration Tool
==============================

Description:
------------
This script configures MQTT settings on a list of Shelly devices by sending
appropriate configuration via HTTP API (`/rpc/MQTT.SetConfig`). It is useful for
mass deployment or automated setup of Shelly MQTT connectivity.

The list of devices (hostnames or IPs) is read from a text file, one per line.
You can specify the path to the list using the `--file` argument.

To generate this list automatically on a local network, you can use:
    nmap -sP 192.168.60.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt

Dependencies:
-------------
- Python 3
- requests

Install dependencies (if not already installed):
    pip install requests

Usage:
------
    python3 shelly-mqtt-config.py
    python3 shelly-mqtt-config.py --file ./my-shelly-devices.txt

Options:
--------
--file <path>     Path to a file containing Shelly hostnames or IPs (one per line). Default is `/root/shellies.txt`.

Behavior:
---------
For each device listed in the file, the script sends an MQTT configuration using
the `/rpc/MQTT.SetConfig` endpoint. It also optionally triggers a reboot to apply
the changes (depending on your implementation logic).

Each device is configured with:
- MQTT server
- Username and password
- Topic prefix based on hostname
- TLS and RPC notification settings

**Note:** You must manually replace the placeholders for:
- `<MQTT-FQDN>`
- `<MQTT-USERNAME>`
- `<MQTT-PASSWORD>`

Author:
-------
Andreas Laub

"""

import requests
import time
import argparse

# 📥 Argumente parsen
parser = argparse.ArgumentParser(description="Configure Shelly MQTT Settings")
parser.add_argument("--file", default="shellies.txt", help="Path to file containing Shelly hostnames")
args = parser.parse_args()

# 📥 Hostnamen aus Datei einlesen
with open(args.file, "r") as f:
    shelly_hosts = [line.strip() for line in f if line.strip()]

# 🔐 Authentifizierung (falls nötig)
auth = None  # Beispiel: auth = ('admin', 'passwort')

# 📦 Basis-MQTT-Konfiguration (client_id und topic_prefix werden je Host angepasst)
base_config = {
    "enable": True,
    "server": "<MQTT-FQDN>:8883",  # ❗ DEIN MQTT-BROKER FULLY QUALIFIED HOSTNAME HIER EINTRAGEN
    "user": "<MQTT-USERNAME>", # ❗ DEIN MQTT-BENUTZER HIER EINTRAGEN
    "pass": "<MQTT-PASSWORD>",  # ❗ DEIN MQTT-PASSWORT HIER EINTRAGEN
    "ssl_ca": "*",
    "rpc_ntf": True,
    "status_ntf": True,
    "use_client_cert": False,
    "enable_rpc": True,
    "enable_control": True
}

# 🛠 Konfiguration + Neustart anwenden
for host in shelly_hosts:
    print(f"\n🔄 MQTT-Konfiguration senden an {host} ...")
    try:
        client_id = host.split('.')[0]
        topic_prefix = f"shelly/{client_id}"

        mqtt_config = base_config.copy()
        mqtt_config["client_id"] = client_id
        mqtt_config["topic_prefix"] = topic_prefix

        url = f"http://{host}/rpc/MQTT.SetConfig"
        payload = { "config": mqtt_config }

        response = requests.post(url, json=payload, auth=auth, timeout=5)

        if response.status_code == 200:
            print(f"✅ {host}: MQTT erfolgreich konfiguriert.")

            # 🔁 Reboot auslösen
            print(f"🔁 {host}: Gerät wird neu gestartet ...")
            reboot_resp = requests.post(f"http://{host}/rpc/Shelly.Reboot", json={}, auth=auth, timeout=3)
            if reboot_resp.status_code == 200:
                print(f"✅ {host}: Neustart ausgelöst.")
            else:
                print(f"⚠️  {host}: Neustart fehlgeschlagen – {reboot_resp.text}")
            time.sleep(1)  # ⏱️ kurze Pause zwischen Geräten (optional)

        else:
            print(f"❌ {host}: Fehler {response.status_code} – {response.text}")

    except Exception as e:
        print(f"❌ {host}: Netzwerkfehler oder nicht erreichbar – {e}")
