# Shelly Scripts

This repository covers Shelly scripts for automating power management and lighting based on device events, ambient light levels, motion detection, and time-of-day conditions. Each script is compatible with Shelly devices that support scripting. Check them out.

## Scripts Overview

1. `shelly-idle-timer.js`

    Automates switch-off based on low power consumption, saving energy.

2. `shelly-blu-motion.js`

    Activates motion detection using a Shelly Blu Motion sensor.

3. `shelly-blu-motion-illuminance.js`

    Activates motion detection only in low light, using a Shelly Blu Motion sensor.

4. `shelly-blu-motion-darknight.js`

    Controls lighting based on motion, light levels, and night-time detection.

5. `shelly-status-check.py`

    Shelly Status Checker Script, to have a status overview of the shellies.

6. `shelly-check.sh`

    Shelly Device Online Status check (HTTP Check Script)

7. `shelly-mqtt-config.py`

    Mass MQTT Configuration Script for Shelly Devices

## `shelly-idle-timer.js`

This Shelly script, `shelly-idle-timer.js`, is designed to monitor the power consumption of a specified switchID on a Shelly device. It turns off the switch automatically after a specified idle time if the power remains below a set threshold, helping save energy by turning off devices that are not actively in use.

### Functionality

- Starts a timer when the switch is ON and `apower < POWER_THRESHOLD`.
- If the condition persists for more than `IDLE_TIMEOUT` minutes,
  the switch will be turned OFF.
- Reacts to `power_update`, `toggle`, and `input` events.

### Polling Fallback

Some Shelly devices (e.g. Plug S Gen2) only emit `power_update` events
when power changes significantly. Small or slowly changing values
may not trigger any event.

To ensure reliable behavior in such cases, the script includes
an optional polling mechanism that regularly fetches the current
device state and applies the same idle logic.

### Configuration Parameters

To customize the behavior of this script, adjust the following parameters in the `CONFIG` object at the beginning of the script:

| Parameter         | Description                                                                 | Type    | Default Value |
|-------------------|-----------------------------------------------------------------------------|---------|---------------|
| `POWER_THRESHOLD` | The minimum active power (in watts) required to keep the device on.        | Integer | `3`           |
| `IDLE_TIMEOUT`    | Duration (in minutes) that power must remain below the threshold before turning off the switch. | Integer | `5`           |
| `SWITCH_ID`       | The ID of the switch on the Shelly device to monitor.                      | Integer | `0`           |
| `DEBUG_LOG`       | Enables or disables debug logging to the console. Set to `true` for debugging. | Boolean | `false`       |
| `ENABLE_POLLING`  | Enable `ENABLE_POLLING` if your device does not emit frequent`power_update` events, or if you want to catch subtle idle conditions. true / false | Boolean | `false`       |
| `POLL_INTERVAL`   | Polling Intervall in Seconds | Integer | `30`       |

### Script Functionality

1. **Power Monitoring**:
   - The script continually checks the power usage of the specified switch.
   - When the power falls below `POWER_THRESHOLD` for the `IDLE_TIMEOUT` duration, the script automatically turns off the switch.

2. **Event Handling**:
   - The script listens for `toggle` events on the specified switch. If the switch is toggled on, it starts a timer. If toggled off, it clears any active timer.
   - The script also responds to `power_update` events:
     - If the active power is below `POWER_THRESHOLD`, the timer starts.
     - If the active power is above or equal to `POWER_THRESHOLD`, the timer is cleared.

3. **Debug Logging**:
   - When `DEBUG_LOG` is enabled, the script logs detailed messages for easier troubleshooting.

### Example Usage

To use the script with a power threshold of 5 watts, an idle timeout of 10 minutes, and debug logging enabled, set up `CONFIG` as follows:

```javascript
const CONFIG = {
    POWER_THRESHOLD: 5,
    IDLE_TIMEOUT: 10,
    SWITCH_ID: 0,
    DEBUG_LOG: true,
};
```

## `shelly-blu-motion.js`

This script configures and operates a Shelly Blu Motion sensor to detect motion. If motion is correctly detected, the configured switch will turned on, otherwise the switch will turned off.

Note: Bluetooth (BLE) must be enabled in the device settings for this script to function correctly.

### Configuration Parameters

#### Essential Parameters

- **allowedMacAddresses**: *Array of Strings* — Lists the MAC addresses of approved devices for which motion and light data will be processed. Example:

  ```javascript
  allowedMacAddresses: [
    "0b:ae:5f:33:9b:3c",
    "1a:22:33:62:5a:bc",
  ]
  ```

- **switchId**: *Number* — Specifies the ID of the Shelly switch that should be activated upon motion detection in darkness. This ID is used to identify the target switch when calling `Shelly.call("Switch.Set", { id: switchId, on: motion })`. *Default*: `0`

#### Debug and Scanning Settings

- **debug**: `true` or `false` — Enables debug mode to log additional information to the console. *Default*: `false`
- **active**: `true` or `false` — Enables or disables active Bluetooth scanning. *Default*: `false`

## `shelly-blu-motion-illuminance.js`

This script configures and operates a Shelly Blu Motion sensor to detect motion and adjust behavior based on ambient light levels. The sensor activates motion detection only when it's dark, based on configurable parameters in the `CONFIG` object. If motion is correctly detected, the configured switch will turned on, otherwise the switch will turned off, only when there is no more detected motion from any sensor. Additionally, the light status is checked to avoid redundant on/off commands.

Note: Bluetooth (BLE) must be enabled in the device settings for this script to function correctly.

### Configuration Parameters

#### Essential Parameters

- **`allowedMacAddresses`**: *Array of Strings* — Lists the MAC addresses of approved devices for which motion and light data will be processed. Example:

  ```javascript
  allowedMacAddresses: [
    "0b:ae:5f:33:9b:3c",
    "1a:22:33:62:5a:bc",
  ]
  ```

- **`switchId`**: *Number* — Specifies the ID of the Shelly switch that should be activated upon motion detection in darkness. This ID is used to identify the target switch when calling `Shelly.call("Switch.Set", { id: switchId, on: motion })`. *Default*: `0`
- **`darknessThreshold`**: *Number* — Sets the light threshold in lux; any value below this threshold is considered "dark," triggering motion detection. *Default*: `1`

#### Debug and Scanning Settings

- **debug**: `true` or `false` — Enables debug mode to log additional information to the console. *Default*: `false`
- **active**: `true` or `false` — Enables or disables active Bluetooth scanning. *Default*: `false`

## `shelly-blu-motion-darknight.js`

This script provides a robust way to control lighting based on motion detection, ambient light levels, and night-time detection using Shelly devices and BLU Motion sensors. With the flexibility of configurable parameters and real-time sensor readings, it helps automate lighting efficiently and with reduced redundancy.

This script is designed to control a light based on motion detection from Bluetooth Low Energy (BLE) sensors and ambient light conditions. It ensures that the light only turns on when it’s dark and motion is detected, and turns off only when there is no more detected motion from any sensor.

The script uses geographic coordinates to calculate sunrise and sunset times, enabling it to distinguish between night and day. Additionally, the light status is checked to avoid redundant on/off commands.

Note: Bluetooth (BLE) must be enabled in the device settings for this script to function correctly.

### How It Works

1. **Motion Detection**: The script monitors motion data from multiple sensors.
2. **Light Control**: The light turns on only if:
   - It’s dark enough (determined by a lux threshold),
   - The current time is night (based on sunset/sunrise times), and
   - Motion is detected from any sensor.
3. **Avoids Redundant Switching**: Before changing the light state, the script checks if it’s already on or off.
4. **Light Turns Off**: The light turns off only when no sensors report motion.

### Key Functions

- **`motionHandler`**: Handles motion events for each sensor. It increments the active motion count when motion is detected and reduces it when motion ends.
- **`illuminanceHandler`**: Updates the current ambient light value in lux to decide if it's dark enough.
- **`updateSunTimes`**: Fetches sunrise and sunset times based on geographic coordinates.

### Script Configuration Parameters

#### Essential Parameters

- **`allowedMacAddresses`** *(array)*: List of MAC addresses for allowed motion sensors to monitor for motion. Example:

  ```javascript
  allowedMacAddresses: [
    "0b:ae:5f:33:9b:3c",
    "1a:22:33:62:5a:bc",
  ]
  ```

- **`switchId`**: *Number* — Specifies the ID of the Shelly switch that should be activated upon motion detection in darkness. This ID is used to identify the target switch when calling `Shelly.call("Switch.Set", { id: switchId, on: motion })`. *Default*: `0`
- **`latitude`** *(float)*: The latitude of your location, used to calculate sunrise and sunset times.
- **`longitude`** *(float)*: The longitude of your location.
- **`timezone`** *(string)*: Timezone identifier (e.g., `UTC`) for the sunrise/sunset API request.
- **`darknessThreshold`** *(integer)*: Sets the lux threshold below which it’s considered "dark." If current illuminance falls below this, the system considers it dark enough to turn on the light when motion is detected.

#### Debug and Scanning Settings

- **`debug`** *(boolean)*: Enables or disables debug logging. Set to `true` for more verbose output.
- **`active`** *(boolean)*: Sets whether the BLE scanner should run in active mode.

## `shelly-status-check.py`

Shelly Status Checker

This script collects status information from multiple Shelly Gen2 devices in your network and displays it in a neatly formatted table. It supports various metrics such as uptime, WiFi signal strength, MQTT status, debug UDP logging configuration, and installed scripts.

### Features

- Queries a list of Shelly devices via their IP or hostname
- Displays:
  - Uptime (formatted as `Xd Xh Xm`)
  - WiFi signal strength (RSSI)
  - Eco Mode status (enable / diable)
  - Bluetooth status (enable / diable)
  - MQTT status (enable / diable)
  - Debug UDP target
  - Installed scripts
- Sortable output (by IP, uptime, or WiFi signal)
- Clean tabular display via `tabulate`

### Installation

1. **Install required Python packages**:

    ```bash
    pip install requests tabulate
    ```

    or on debian based systems

    ```bash
    apt update && apt install python3-requests python3-tabulate
    ```

2. **Make the script executable (optional)**:

    ```bash
    chmod +x shelly-status-check.py
    ```

3. **Ensure your Shelly devices are reachable via DNS or static IP**.
4. **Create a list of device IPs or hostnames in a file named**:

    'shellies.txt'
    Each line should contain one hostname or IP:

    ```bash
    shelly-kitchen.local
    shelly-garage.local
    192.168.1.42
    ```

    you can also generate your list with nmap, here is an example, all shelly devices must have shelly in their hostname:

    ```bash
    nmap -sP 192.168.1.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt
    ```

### Usage

Run the script directly:

```bash
./shelly-status-check.py
./shelly-status-check.py --file
```

By default, it sorts the table by IP address.

#### Optional: Sort by other metrics

```bash
./shelly-status-check.py --sort uptime
./shelly-status-check.py --sort wifi
```

| Option          | Description                        |
|-----------------|------------------------------------|
| `--file </path/to/shellies.txt>` | Path to file containing IPs of Shelly devices default is `./shellies.txt` |
| `--sort ip`     | Sorts alphabetically by IP/host (default) |
| `--sort uptime` | Sorts by device uptime (descending) |
| `--sort wifi`   | Sorts by WiFi signal strength (best first) |

---

### Requirements

- Python 3.6+
- Shelly Gen2 devices with RPC enabled
- Devices must be reachable over HTTP in the local network

---

### Optional Authentication

If your Shelly devices require HTTP authentication, set:

```python
auth = ('admin', 'yourpassword')
```

inside the script.

---

### Example Output

```txt
+-------------------------+-------------+------------+------------+---------------+-------------+--------+-----------------------+-----------------------+
| IP                      | Reachable   | Uptime     | Eco Mode   | WiFi (dBm)    | Bluetooth   | MQTT   | Debug UDP             | Scripts               |
+-------------------------+-------------+------------+------------+---------------+-------------+--------+-----------------------+-----------------------+
| shelly-kitchen.local    | ✅           | 3d 4h 12m  | True       | -42           | ✅           | ✅     | 192.168.1.100:514     | temp_logger           |
| shelly-garage.local     | ✅           | 0d 7h 53m  | False      | -69           | ❌           | ❌     | –                     | –                     |
+-------------------------+-------------+------------+------------+---------------+-------------+--------+-----------------------+-----------------------+
```

## `shelly-debug-setter.py`

Shelly Gen2 UDP Debug Configurator.

This Python script configures the **UDP debug logging target** for a list of **Shelly Gen2 devices** by sending the appropriate RPC command to each device.

### 🔧 Features

- Automatically applies UDP debug configuration via HTTP.
- Supports batch configuration of multiple Shelly devices.
- Flexible input via command-line arguments.
- Designed for Shelly Gen2 firmware with `rpc/Sys.SetConfig`.

### 📦 Requirements

- Python 3.x
- `requests` library (`pip install requests`)
- Gen2 Shelly devices reachable over HTTP in the local network.

### 📁 Device List

Create a text file (default: `shelly.txt`) listing one IP or hostname per line:

```txt
192.168.1.101
192.168.1.102
shelly-pro-kitchen.local
```

### ▶ Usage

```bash
python3 shelly_debug_setter.py --host <TARGET_IP> --port <PORT> --file <DEVICE_FILE>
```

#### Parameters

| Argument     | Required | Description                                  |
|--------------|----------|----------------------------------------------|
| `--host`     | ✅ Yes   | The destination IP/hostname for UDP logging  |
| `--port`     | ✅ Yes   | The UDP port number to send debug logs to    |
| `--file`     | ❌ No    | Path to file with device IPs (default: `shellies.txt`) |

#### Example

```bash
python3 shelly_debug_setter.py --host 192.168.1.100 --port 514 --file shellies.txt
```

This sets all devices listed in `shellies.txt` to send debug logs to `192.168.1.100:514`.

### ❗ Notes

- Only compatible with **Shelly Gen2 devices** using the `/rpc/Sys.SetConfig` endpoint.
- Devices must be reachable over HTTP and on the same network (or VPN).
- Authentication is not currently supported — add manually if needed.

## `shelly-check.sh`

This script performs a basic health check for a list of [Shelly](https://www.shelly.com/) smart devices by sending HTTP requests to their status endpoints. It helps verify whether each device is reachable and responsive.

### 🧰 Features

- Pings all IPs listed in a file and checks status via Shelly HTTP API.
- Logs which devices are reachable or offline.
- Default file lookup in the script's directory (`shellies.txt`).
- Supports optional `--file` parameter for custom input.

### 🚀 Usage

#### Run the script

```bash
./shelly-check.sh
```

This will check all devices listed in `shellies.txt` located in the same directory as the script.

#### With a custom input file

```bash
./shelly-check.sh --file /path/to/my/shellies.txt
```

### 🧪 Generate Device List Automatically

To find Shelly devices on your local network, you can use `nmap`:

```bash
nmap -sP 192.168.10.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt
```

### ⏱️ Automate with Cron

To monitor Shelly devices continuously, you can schedule the script to run every 5 minutes using `cron`. If your system is configured to send cron job output via email, you'll receive notifications whenever a device is offline.

#### Example crontab entry

```cron
*/5 * * * * /path/to/shelly-check.sh --file /path/to/shellies.txt
```

Ensure the script is executable:

```bash
chmod +x /path/to/shelly-check.sh
```

> ℹ️ Tip: Configure your system’s `mail` or `postfix` service to forward cron output to your email inbox.

## `shelly-mqtt-config.py`

This script automates the MQTT configuration for multiple Shelly Gen2 devices using their RPC HTTP API.

### Features

- Sends MQTT configuration to each Shelly device listed in a file.
- Configures:
  - MQTT server, username, password
  - client ID and topic prefix per host
  - TLS, control, and status options
- Easy bulk setup for large installations

### Requirements

- Python 3
- `requests` module

Install with:

```bash
pip install requests
```

### Usage

```bash
python3 shelly-mqtt-config.py
python3 shelly-mqtt-config.py --file ./my-devices.txt
```

Make sure your device list is valid before running the script.

### Options

| Option   | Description                                                        | Default              |
|----------|--------------------------------------------------------------------|----------------------|
| `--file` | Path to a file with Shelly IPs or hostnames (one per line)         | `./shellies.txt` |

### Device List Example (`shellies.txt`)

```txt
192.168.1.101
192.168.1.102
shelly-kitchen.local
```

To generate this list from your local network:

```bash
nmap -sP 192.168.1.0/24 | grep "shelly" | awk '/Nmap scan report/ {print $5}' > shellies.txt
```

### Note

Make sure to edit the script to include your actual MQTT broker credentials and hostname in the `base_config` section.
