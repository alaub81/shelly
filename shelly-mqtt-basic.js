/** 
 * Shelly BLU Motion → MQTT Light Control Script
 *
 * This script runs on Shelly Gen2/Gen3/Pro devices that act as a BLE gateway.
 * It listens for BTHome v2 advertisements from Shelly BLU Motion (and other
 * BTHome motion) sensors and sends a single MQTT command to control a light:
 *
 *   - When at least one configured motion sensor reports motion ("ON"),
 *     the script publishes the configured MQTT "ON" payload.
 *   - When all configured motion sensors report no motion ("OFF"),
 *     the script publishes the configured MQTT "OFF" payload.
 *
 * Optionally the script can turn the light on only when it is dark enough
 * based on the illuminance (lux) value reported by the BLU devices.
 *
 * Requirements:
 *   - Bluetooth (BLE) must be enabled on the Shelly device.
 *   - MQTT must be enabled and correctly configured on the Shelly device.
 *   - The BLU devices must send BTHome v2 packets (UUID 0xFCD2).
 *
 * Configuration:
 *   - Edit the CONFIG object below:
 *       - debug:               enable/disable debug logging
 *       - active:              active vs. passive BLE scanning
 *       - darknessThreshold:   lux threshold below which it is considered dark
 *       - useDarknessThreshold: if true, only turn on light when it is dark
 *       - allowedMacAddresses: list of BLU motion sensor MAC addresses
 *       - mqtt:                topic and payloads for light ON/OFF
 *
 * Notes:
 *   - MAC addresses in allowedMacAddresses should be lower-case and
 *     colon-separated (e.g. "0b:ae:5f:33:9b:3c").
 *   - The script keeps track of how many sensors are currently reporting
 *     motion; it sends MQTT "ON" only when the first sensor becomes active,
 *     and "OFF" only when the last active sensor clears.
 */

/******************* START CHANGE HERE *******************/
let CONFIG = {
  // When set to true, debug messages will be logged to the console
  debug: true,

  // When set to true and the script owns the scanner, the scan will be active.
  // Active scan means the scanner will ping back the Bluetooth device to receive
  // all its data, but it will drain the battery faster.
  active: false,

  // --- Darkness handling ----------------------------------------------------
  // Lux threshold: values at or below this are considered "dark".
  darknessThreshold: 10,

  // If true, the light will only be turned on when
  // currentIlluminance <= darknessThreshold.
  // If false, brightness is ignored and motion always turns the light on.
  useDarknessThreshold: false,

  // When `allowedMacAddresses` is set to null, events from every Bluetooth
  // device are accepted. Otherwise, only these MAC addresses are processed.
  allowedMacAddresses: [
    "f4:b3:b1:83:bd:67",
    "0c:ae:5f:62:11:1d"
  ],

  // --- MQTT configuration for the light ------------------------------------
  mqtt: {
    enabled: true,

    // Single MQTT topic that receives ON/OFF commands for the light.
    topic: "homie/laub-raspi3-dp/display/powerswitch/set",

    // Payloads for switching the light
    payloadOn: "true",
    payloadOff: "false",

    qos: 1,
    retain: false
  },

  // --- Internal state (do not modify) --------------------------------------
  currentIlluminance: null, // last reported illuminance in lux
  motionStates: {},         // per-sensor motion state: sensorID -> true/false
  activeMotionCount: 0,     // number of sensors currently reporting motion
  lightIsOn: false,         // last known light state based on MQTT commands

  /**
   * Called when motion is reported from the filtered Shelly BLU Motion devices.
   * @param {Boolean} motion true when there is motion, false otherwise.
   * @param {Object} eventData Object containing all parameters received from the device.
   */
  motionHandler: function (motion, eventData) {
    let sensorID = eventData.address || eventData.deviceID;

    // Initialize motion state for this sensor if needed
    if (typeof CONFIG.motionStates[sensorID] === "undefined") {
      CONFIG.motionStates[sensorID] = false;
    }

    if (motion) {
      // --- Motion detected ---------------------------------------------------
      if (!CONFIG.motionStates[sensorID]) {
        // Transition from OFF -> ON for this sensor
        CONFIG.motionStates[sensorID] = true;
        CONFIG.activeMotionCount++;

        logger(
          [
            "Motion ON from",
            sensorID,
            "ActiveMotionCount:",
            CONFIG.activeMotionCount
          ],
          "Info"
        );

        // Only when this is the first active sensor we consider turning on the light
        if (CONFIG.activeMotionCount === 1) {
          let darkEnough = true;

          if (CONFIG.useDarknessThreshold) {
            // If we have a valid illuminance value, compare against threshold.
            // If we have never seen a lux value, treat it as darkEnough = true.
            if (CONFIG.currentIlluminance !== null) {
              darkEnough = CONFIG.currentIlluminance <= CONFIG.darknessThreshold;
            }
          }

          if (darkEnough) {
            if (CONFIG.mqtt && CONFIG.mqtt.enabled) {
              if (!CONFIG.lightIsOn) {
                MQTT.publish(
                  CONFIG.mqtt.topic,
                  String(CONFIG.mqtt.payloadOn),
                  CONFIG.mqtt.qos,
                  CONFIG.mqtt.retain
                );
                CONFIG.lightIsOn = true;
                logger(
                  [
                    "MQTT ON sent to",
                    CONFIG.mqtt.topic,
                    "payload:",
                    CONFIG.mqtt.payloadOn
                  ],
                  "Info"
                );
              } else {
                logger(
                  ["Motion detected, light already ON, no MQTT sent"],
                  "Info"
                );
              }
            }
          } else {
            logger(
              [
                "Motion detected, but it is too bright (",
                CONFIG.currentIlluminance,
                "lux ) – no ON sent"
              ],
              "Info"
            );
          }
        }
      }
    } else {
      // --- No motion detected ------------------------------------------------
      if (CONFIG.motionStates[sensorID]) {
        // Transition from ON -> OFF for this sensor
        CONFIG.motionStates[sensorID] = false;
        CONFIG.activeMotionCount = Math.max(
          0,
          CONFIG.activeMotionCount - 1
        );

        logger(
          [
            "Motion OFF from",
            sensorID,
            "ActiveMotionCount:",
            CONFIG.activeMotionCount
          ],
          "Info"
        );

        // If no sensor reports motion anymore, we can turn the light off
        if (CONFIG.activeMotionCount === 0) {
          if (CONFIG.mqtt && CONFIG.mqtt.enabled) {
            if (CONFIG.lightIsOn) {
              MQTT.publish(
                CONFIG.mqtt.topic,
                String(CONFIG.mqtt.payloadOff),
                CONFIG.mqtt.qos,
                CONFIG.mqtt.retain
              );
              CONFIG.lightIsOn = false;
              logger(
                [
                  "MQTT OFF sent to",
                  CONFIG.mqtt.topic,
                  "payload:",
                  CONFIG.mqtt.payloadOff
                ],
                "Info"
              );
            } else {
              logger(
                ["No motion anywhere, light already OFF, no MQTT sent"],
                "Info"
              );
            }
          }
        }
      }
    }

    // Small debug info
    logger(["ActiveMotionCount:", CONFIG.activeMotionCount], "Info");
  },

  /**
   * Called when illuminance is reported from the Shelly BLU Motion devices.
   * @param {Number} illuminance Illuminance in lux.
   * @param {Object} eventData Object containing all parameters received from the device.
   */
  illuminanceHandler: function (illuminance, eventData) {
    CONFIG.currentIlluminance = illuminance;
    logger(["Illuminance:", illuminance, "lux"], "Info");
  },
};
/******************* STOP CHANGE HERE *******************/

let ALLTERCO_MFD_ID_STR = "0ba9";
let BTHOME_SVC_ID_STR = "fcd2";

let uint8 = 0;
let int8 = 1;
let uint16 = 2;
let int16 = 3;
let uint24 = 4;
let int24 = 5;

// Logs the provided message with an optional prefix to the console.
function logger(message, prefix) {
  // exit if the debug isn't enabled
  if (!CONFIG.debug) {
    return;
  }

  let finalText = "";

  // if the message is a list, loop over it
  if (Array.isArray(message)) {
    for (let i = 0; i < message.length; i++) {
      finalText = finalText + " " + JSON.stringify(message[i]);
    }
  } else {
    finalText = JSON.stringify(message);
  }

  // the prefix must be string
  if (typeof prefix !== "string") {
    prefix = "";
  } else {
    prefix = prefix + ":";
  }

  // log the result
  console.log(prefix, finalText);
}

// The BTH object defines the structure of the BTHome data
let BTH = {};
BTH[0x00] = { n: "pid", t: uint8 };
BTH[0x01] = { n: "battery", t: uint8, u: "%" };
BTH[0x02] = { n: "temperature", t: int16, f: 0.01, u: "tC" };
BTH[0x03] = { n: "humidity", t: uint16, f: 0.01, u: "%" };
BTH[0x05] = { n: "illuminance", t: uint24, f: 0.01 };
BTH[0x21] = { n: "motion", t: uint8 };
BTH[0x2d] = { n: "window", t: uint8 };
BTH[0x3a] = { n: "button", t: uint8 };
BTH[0x3f] = { n: "rotation", t: int16, f: 0.1 };

function getByteSize(type) {
  if (type === uint8 || type === int8) return 1;
  if (type === uint16 || type === int16) return 2;
  if (type === uint24 || type === int24) return 3;
  // impossible as advertisements are much smaller
  return 255;
}

// functions for decoding and unpacking the service data from Shelly BLU devices
let BTHomeDecoder = {
  utoi: function (num, bitsz) {
    let mask = 1 << (bitsz - 1);
    return num & mask ? num - (1 << bitsz) : num;
  },
  getUInt8: function (buffer) {
    return buffer.at(0);
  },
  getInt8: function (buffer) {
    return this.utoi(this.getUInt8(buffer), 8);
  },
  getUInt16LE: function (buffer) {
    return 0xffff & ((buffer.at(1) << 8) | buffer.at(0));
  },
  getInt16LE: function (buffer) {
    return this.utoi(this.getUInt16LE(buffer), 16);
  },
  getUInt24LE: function (buffer) {
    return (
      0x00ffffff & ((buffer.at(2) << 16) | (buffer.at(1) << 8) | buffer.at(0))
    );
  },
  getInt24LE: function (buffer) {
    return this.utoi(this.getUInt24LE(buffer), 24);
  },
  getBufValue: function (type, buffer) {
    if (buffer.length < getByteSize(type)) return null;
    let res = null;
    if (type === uint8) res = this.getUInt8(buffer);
    if (type === int8) res = this.getInt8(buffer);
    if (type === uint16) res = this.getUInt16LE(buffer);
    if (type === int16) res = this.getInt16LE(buffer);
    if (type === uint24) res = this.getUInt24LE(buffer);
    if (type === int24) res = this.getInt24LE(buffer);
    return res;
  },

  // Unpacks the service data buffer from a Shelly BLU device
  unpack: function (buffer) {
    // beacons might not provide BTH service data
    if (typeof buffer !== "string" || buffer.length === 0) return null;
    let result = {};
    let _dib = buffer.at(0);
    result["encryption"] = _dib & 0x1 ? true : false;
    result["BTHome_version"] = _dib >> 5;
    if (result["BTHome_version"] !== 2) return null;
    // can not handle encrypted data
    if (result["encryption"]) return result;
    buffer = buffer.slice(1);

    let _bth;
    let _value;
    while (buffer.length > 0) {
      _bth = BTH[buffer.at(0)];
      if (typeof _bth === "undefined") {
        logger("unknown type", "BTH");
        break;
      }
      buffer = buffer.slice(1);
      _value = this.getBufValue(_bth.t, buffer);
      if (_value === null) break;
      if (typeof _bth.f !== "undefined") _value = _value * _bth.f;
      result[_bth.n] = _value;
      buffer = buffer.slice(getByteSize(_bth.t));
    }
    return result;
  },
};

function onReceivedPacket(data) {
  if (CONFIG._processedMacAddresses !== null) {
    if (CONFIG._processedMacAddresses.indexOf(data.address) < 0) {
      logger(
        ["Received event from", data.address, "outside of the allowed addresses"],
        "Info"
      );
      return;
    }
  }

  if (
    typeof CONFIG.motionHandler === "function" &&
    typeof data.motion !== "undefined"
  ) {
    CONFIG.motionHandler(data.motion === 1, data);
    logger("Motion handler called", "Info");
  }

  if (
    typeof CONFIG.illuminanceHandler === "function" &&
    typeof data.illuminance !== "undefined"
  ) {
    CONFIG.illuminanceHandler(data.illuminance, data);
    logger("Illuminance handler called", "Info");
  }

  if (typeof CONFIG.onStatusUpdate === "function") {
    CONFIG.onStatusUpdate(data);
    logger("New status update", "Info");
  }
}

// saving the id of the last packet, this is used to filter the duplicated packets
let lastPacketId = 0x100;

// Callback for the BLE scanner object
function BLEScanCallback(event, result) {
  // exit if not a result of a scan
  if (event !== BLE.Scanner.SCAN_RESULT) {
    return;
  }

  // exit if service_data member is missing
  if (
    typeof result.service_data === "undefined" ||
    typeof result.service_data[BTHOME_SVC_ID_STR] === "undefined"
  ) {
    return;
  }

  let unpackedData = BTHomeDecoder.unpack(
    result.service_data[BTHOME_SVC_ID_STR]
  );

  // exit if unpacked data is null or the device is encrypted
  if (
    unpackedData === null ||
    typeof unpackedData === "undefined" ||
    unpackedData["encryption"]
  ) {
    logger("Encrypted devices are not supported", "Error");
    return;
  }

  // exit if the event is duplicated
  if (lastPacketId === unpackedData.pid) {
    return;
  }

  lastPacketId = unpackedData.pid;

  unpackedData.rssi = result.rssi;
  unpackedData.address = result.addr;

  onReceivedPacket(unpackedData);
}

// Initializes the script and performs the necessary checks and configurations
function init() {
  // exit if can't find the config
  if (typeof CONFIG === "undefined") {
    console.log("Error: Undefined config");
    return;
  }

  // get the config of ble component
  let BLEConfig = Shelly.getComponentConfig("ble");

  // exit if the BLE isn't enabled
  if (!BLEConfig.enable) {
    console.log(
      "Error: The Bluetooth is not enabled, please enable it from settings"
    );
    return;
  }

  // check if the scanner is already running
  if (BLE.Scanner.isRunning()) {
    console.log(
      "Info: The BLE gateway is running, the BLE scan configuration is managed by the device"
    );
  } else {
    // start the scanner
    let bleScanner = BLE.Scanner.Start({
      duration_ms: BLE.Scanner.INFINITE_SCAN,
      active: CONFIG.active,
    });

    if (!bleScanner) {
      console.log("Error: Can not start new scanner");
    }
  }

  if (
    typeof CONFIG.allowedMacAddresses !== "undefined"
  ) {
    if (CONFIG.allowedMacAddresses !== null) {
      // Process configured MAC addresses:
      //  - convert all to lower case
      //  - remove duplicates
      CONFIG._processedMacAddresses =
        CONFIG.allowedMacAddresses
          .map(function (mac) { return mac.toLowerCase(); })
          .filter(function (value, index, array) { return array.indexOf(value) === index; });
    } else {
      CONFIG._processedMacAddresses = null;
    }
  }

  // subscribe a callback to BLE scanner
  BLE.Scanner.Subscribe(BLEScanCallback);
}

init();