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

## `shelly-idle-timer.js`

This Shelly script, `shelly-idle-timer.js`, is designed to monitor the power consumption of a specified switchID on a Shelly device. It turns off the switch automatically after a specified idle time if the power remains below a set threshold, helping save energy by turning off devices that are not actively in use.

### Configuration Parameters

To customize the behavior of this script, adjust the following parameters in the `CONFIG` object at the beginning of the script:

| Parameter         | Description                                                                 | Type    | Default Value |
|-------------------|-----------------------------------------------------------------------------|---------|---------------|
| `POWER_THRESHOLD` | The minimum active power (in watts) required to keep the device on.        | Integer | `3`           |
| `IDLE_TIMEOUT`    | Duration (in minutes) that power must remain below the threshold before turning off the switch. | Integer | `5`           |
| `SWITCH_ID`       | The ID of the switch on the Shelly device to monitor.                      | Integer | `0`           |
| `DEBUG_LOG`       | Enables or disables debug logging to the console. Set to `true` for debugging. | Boolean | `false`       |

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

# `shelly-status-check.py`

Shelly Status Checker

This script collects status information from multiple Shelly Gen2 devices in your network and displays it in a neatly formatted table. It supports various metrics such as uptime, WiFi signal strength, MQTT status, debug UDP logging configuration, and installed scripts.

## Features

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

## Installation

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

## Usage

Run the script directly:

```bash
./shelly-status-check.py
```

By default, it sorts the table by IP address.

### Optional: Sort by other metrics

```bash
./shelly-status-check.py --sort uptime
./shelly-status-check.py --sort wifi
```

| Option       | Description                        |
|--------------|------------------------------------|
| `--sort ip`  | Sorts alphabetically by IP/host (default) |
| `--sort uptime` | Sorts by device uptime (descending) |
| `--sort wifi` | Sorts by WiFi signal strength (best first) |

---

## Requirements

- Python 3.6+
- Shelly Gen2 devices with RPC enabled
- Devices must be reachable over HTTP in the local network

---

## 🔒 Optional Authentication

If your Shelly devices require HTTP authentication, set:

```python
auth = ('admin', 'yourpassword')
```

inside the script.

---

## Example Output

```
+-------------------------+-------------+------------+------------+---------------+-------------+--------+-----------------------+-----------------------+
| IP                      | Reachable   | Uptime     | Eco Mode   | WiFi (dBm)    | Bluetooth   | MQTT   | Debug UDP             | Scripts               |
+-------------------------+-------------+------------+------------+---------------+-------------+--------+-----------------------+-----------------------+
| shelly-kitchen.local    | ✅           | 3d 4h 12m  | True       | -42           | ✅           | ✅     | 192.168.1.100:514     | temp_logger           |
| shelly-garage.local     | ✅           | 0d 7h 53m  | False      | -69           | ❌           | ❌     | –                     | –                     |
+-------------------------+-------------+------------+------------+---------------+-------------+--------+-----------------------+-----------------------+
```
