#!/usr/bin/python3

import argparse
import requests

def set_gen2_udp_debug(ip, target_host, target_port):
    url = f"http://{ip}/rpc/Sys.SetConfig"
    payload = {
        "config": {
            "debug": {
                "udp": {
                    "addr": f"{target_host}:{target_port}"
                }
            }
        }
    }

    try:
        response = requests.post(url, json=payload, timeout=5)
        response.raise_for_status()
        print(f"[✓] {ip}: Debug-Ziel gesetzt auf {target_host}:{target_port}")
    except requests.exceptions.HTTPError as e:
        print(f"[✗] {ip}: HTTP-Fehler - {e.response.status_code} {e.response.reason}")
    except requests.exceptions.RequestException as e:
        print(f"[✗] {ip}: Verbindungsfehler - {e}")

def main():
    parser = argparse.ArgumentParser(description="Set UDP Debug target on Shelly Gen2 devices.")
    parser.add_argument("--host", required=True, help="Ziel-Host für UDP-Debug (z. B. 192.168.1.100)")
    parser.add_argument("--port", required=True, help="UDP-Port (z. B. 514)")
    parser.add_argument("--file", default="shellies.txt", help="Pfad zur Datei mit Shelly-IP-Adressen")
    args = parser.parse_args()

    try:
        with open(args.file, "r") as f:
            shellies = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"Datei {args.file} nicht gefunden.")
        return

    for ip in shellies:
        set_gen2_udp_debug(ip, args.host, args.port)

if __name__ == "__main__":
    main()
