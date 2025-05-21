#!/usr/bin/python3

import requests
import time

# 📥 Hostnamen aus Datei einlesen
with open("/root/shelly.txt", "r") as f:
    shelly_hosts = [line.strip() for line in f if line.strip()]

# 🔐 Authentifizierung (falls nötig)
auth = None  # Beispiel: auth = ('admin', 'passwort')

# 📦 Basis-MQTT-Konfiguration (client_id und topic_prefix werden je Host angepasst)
base_config = {
    "enable": True,
    "server": "laub-mqtt.laub.loc:8883",
    "user": "mosquitto",
    "pass": "password",  # ❗ DEIN MQTT-PASSWORT HIER EINTRAGEN
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
