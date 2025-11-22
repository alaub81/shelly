#!/usr/bin/env python3
"""
Create HTTP monitors in Uptime Kuma for a list of Shelly devices.

This script:
- Reads Shelly device IP addresses from a text file (one IP per line).
- Optionally creates (or reuses) a monitor group in Uptime Kuma.
- Creates an HTTP monitor for each device at:
    http://<IP>/rpc/Shelly.GetStatus
- Skips creation if a monitor with the same URL already exists.
- Allows configuring check interval, retry interval and max retries.

Requirements:
- Python 3.8+ (recommended)
- A running Uptime Kuma instance (e.g. http://127.0.0.1:3001)
- Valid Uptime Kuma username and password
- The Python library "uptime-kuma-api"

Install the required library with:

    pip install uptime-kuma-api

Input file format:
- Default file name: shellies.txt (can be overridden with --file)
- One IP address (or hostname) per line
- Empty lines and lines starting with '#' are ignored, e.g.:

    # Shelly devices
    192.168.1.10
    192.168.1.11
    # 192.168.1.12 (disabled)
    # or names
    shelly-livingroom.local
    shelly-bedroom.local

Usage example:

    python3 create_shelly_monitors.py \
        --kuma-url http://127.0.0.1:3001 \
        --username admin \
        --password 'Your$Secure!Password' \
        --file /path/to/shellies.txt \
        --interval 60 \
        --retry-interval 60 \
        --maxretries 0 \
        --group-name "Shelly Devices"

Arguments:
- --kuma-url        Base URL of the Uptime Kuma instance.
- --username        Uptime Kuma username.
- --password        Uptime Kuma password.
- --file            Path to the Shelly list file (default: shellies.txt).
- --interval        Check interval in seconds (default: 60).
- --retry-interval  Retry interval in seconds (default: 60).
- --maxretries      Number of retries before marking the monitor as DOWN (default: 0).
- --group-name      Name of the monitor group to put all Shelly monitors into.
                    If the group does not exist, it will be created.
"""

import argparse
from pathlib import Path
from typing import List, Optional

from uptime_kuma_api import UptimeKumaApi, MonitorType, UptimeKumaException


def read_shellies(path: Path) -> List[str]:
    """Liest alle Shelly-IP-Adressen aus der Datei."""
    ips: List[str] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            ips.append(stripped)
    return ips


def get_or_create_group_id(api: UptimeKumaApi, group_name: str) -> int:
    """
    Liefert die ID einer Monitor-Gruppe mit dem gegebenen Namen.
    Falls die Gruppe nicht existiert, wird sie als Monitor vom Typ GROUP angelegt.
    """
    # Vorhandene Monitore durchsuchen
    for monitor in api.get_monitors():
        if monitor.get("type") == MonitorType.GROUP and monitor.get("name") == group_name:
            print(f"[GROUP] Verwende bestehende Gruppe '{group_name}' (id={monitor['id']})")
            return monitor["id"]

    # Gruppe neu anlegen
    print(f"[GROUP] Gruppe '{group_name}' existiert noch nicht – wird angelegt …")
    result = api.add_monitor(
        type=MonitorType.GROUP,
        name=group_name,
    )
    group_id = result.get("monitorID")
    if group_id is None:
        raise RuntimeError(f"Konnte Gruppen-ID nach add_monitor() nicht ermitteln: {result}")
    print(f"[GROUP] Gruppe '{group_name}' angelegt (id={group_id})")
    return group_id


def ensure_monitor(
    api: UptimeKumaApi,
    ip: str,
    interval: int,
    retry_interval: int,
    maxretries: int,
    parent_group_id: Optional[int] = None,
) -> Optional[int]:
    """
    Stellt sicher, dass für die angegebene IP ein Monitor existiert.
    Falls noch keiner existiert, wird ein neuer angelegt (optional mit parent_group_id).
    Rückgabe: monitorId oder None bei Fehler.
    """
    url = f"http://{ip}/rpc/Shelly.GetStatus"
    name = f"Shelly {ip}"

    # Prüfen, ob es bereits einen Monitor mit dieser URL gibt
    for monitor in api.get_monitors():
        if monitor.get("url") == url:
            print(
                f"[OK] Monitor für {ip} existiert bereits "
                f"(id={monitor.get('id')}, name={monitor.get('name')})"
            )
            return monitor.get("id")

    kwargs = dict(
        type=MonitorType.HTTP,
        name=name,
        url=url,
        interval=interval,
        retryInterval=retry_interval,
        maxretries=maxretries,
    )

    if parent_group_id is not None:
        kwargs["parent"] = parent_group_id

    try:
        result = api.add_monitor(**kwargs)
    except UptimeKumaException as exc:
        print(f"[ERR] Fehler beim Erstellen des Monitors für {ip}: {exc}")
        return None

    monitor_id = result.get("monitorID")
    print(
        f"[NEW] Monitor für {ip} erstellt "
        f"(id={monitor_id}, Gruppe-ID={parent_group_id})"
    )
    return monitor_id


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Erzeuge Uptime-Kuma-Monitore für alle Shelly-Devices aus einer IP-Liste."
    )
    parser.add_argument(
        "--kuma-url",
        required=True,
        help="Basis-URL der Uptime-Kuma-Instanz, z.B. http://127.0.0.1:3001",
    )
    parser.add_argument(
        "--username",
        required=True,
        help="Uptime-Kuma-Benutzername",
    )
    parser.add_argument(
        "--password",
        required=True,
        help="Uptime-Kuma-Passwort",
    )
    parser.add_argument(
        "--file",
        default="shellies.txt",
        help="Pfad zur shellies.txt (eine IP pro Zeile). Standard: ./shellies.txt",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=60,
        help="Check-Intervall in Sekunden (>= 20, Standard: 60)",
    )
    parser.add_argument(
        "--retry-interval",
        type=int,
        default=60,
        help="Retry-Intervall in Sekunden (>= 20, Standard: 60)",
    )
    parser.add_argument(
        "--maxretries",
        type=int,
        default=0,
        help="Anzahl Retries bevor der Monitor als DOWN gilt (Standard: 0)",
    )
    parser.add_argument(
        "--group-name",
        default="Shelly",
        help="Name der Monitor-Gruppe, in die alle Shellys einsortiert werden. "
             "Leerlassen, um keine Gruppe zu verwenden. Standard: Shelly",
    )

    args = parser.parse_args()

    shellies_path = Path(args.file)
    if not shellies_path.is_file():
        raise SystemExit(f"Shellies-Datei nicht gefunden: {shellies_path}")

    ips = read_shellies(shellies_path)
    if not ips:
        raise SystemExit("Keine Shelly-IP-Adressen in der Datei gefunden.")

    group_name = args.group_name.strip()
    with UptimeKumaApi(args.kuma_url) as api:
        api.login(args.username, args.password)

        parent_group_id: Optional[int] = None
        if group_name:
            parent_group_id = get_or_create_group_id(api, group_name)

        print(f"Erzeuge/prüfe Monitore für {len(ips)} Shelly-Devices...")
        for ip in ips:
            ensure_monitor(
                api=api,
                ip=ip,
                interval=args.interval,
                retry_interval=args.retry_interval,
                maxretries=args.maxretries,
                parent_group_id=parent_group_id,
            )


if __name__ == "__main__":
    main()