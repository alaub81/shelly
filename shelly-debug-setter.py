#!/usr/bin/python3

import argparse
import requests

def set_gen2_udp_debug(ip, target_host=None, target_port=None, delete=False):
    url = f"http://{ip}/rpc/Sys.SetConfig"
    payload = {
        "config": {
            "debug": {
                "udp": {
                    "addr": None if delete else f"{target_host}:{target_port}"
                }
            }
        }
    }

    try:
        response = requests.post(url, json=payload, timeout=5)
        response.raise_for_status()
        if delete:
            print(f"[✓] {ip}: UDP-Debug deaktiviert (Destination gelöscht)")
        else:
            print(f"[✓] {ip}: Debug-Ziel gesetzt auf {target_host}:{target_port}")
    except requests.exceptions.HTTPError as e:
        print(f"[✗] {ip}: HTTP-Fehler - {e.response.status_code} {e.response.reason}")
    except requests.exceptions.RequestException as e:
        print(f"[✗] {ip}: Verbindungsfehler - {e}")

def main():
    parser = argparse.ArgumentParser(description="UDP-Debug-Ziel auf Shelly Gen2 setzen oder löschen.")
    parser.add_argument("--host", help="Ziel-Host für UDP-Debug (z. B. 192.168.1.100)")
    parser.add_argument("--port", help="UDP-Port (z. B. 514)")
    parser.add_argument("--file", default="shellies.txt", help="Pfad zur Datei mit Shelly-IP-Adressen")
    parser.add_argument("--delete", action="store_true", help="UDP-Debug deaktivieren und Destination löschen")
    args = parser.parse_args()

    if args.delete:
        if args.host is not None or args.port is not None:
            parser.error("--delete kann nicht mit --host oder --port kombiniert werden")
    elif not args.host or not args.port:
        parser.error("--host und --port sind erforderlich, sofern --delete nicht gesetzt ist")

    try:
        with open(args.file, "r") as f:
            shellies = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"Datei {args.file} nicht gefunden.")
        return

    for ip in shellies:
        set_gen2_udp_debug(ip, args.host, args.port, delete=args.delete)

if __name__ == "__main__":
    main()
