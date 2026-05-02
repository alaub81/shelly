/******************* START CHANGE HERE *******************/
let CONFIG = {
  // enable / disable debug mode
  // Empfehlung 1: debug im Normalbetrieb aus, da BLE-Logging viel Last erzeugen kann
  debug: false,

  // enable / disable active bluetooth scanning
  active: false,

  // Threshold value for darkness in lux
  darknessThreshold: 25, // Lighting value below this value is considered ‘dark’

  allowedMacAddresses: [
    "38:39:8f:82:3c:a3",
    "0c:ae:5f:62:11:1d"
  ],

  // Which of the device output should be switched
  switchId: 0,

  // Saves the current lighting value, do not change
  currentIlluminance: null,

  // timestamp of last lux update
  currentIlluminanceTs: null,

  // how long a lux value is considered “fresh”
  illuminanceMaxAgeMs: 60000,

  // Per-sensor illuminance data: sensorID -> { lux, ts }
  illuminanceBySensor: {},

  // Space for the number of active motion detection, do not change
  activeMotionCount: 0,

  // Space for the object to save the movement status of each sensor
  motionStates: {},

  illuminanceHandler: function (illuminance, eventData) {
    let sensorID = eventData.address || eventData.deviceID;

    // store per-sensor illuminance + timestamp
    CONFIG.illuminanceBySensor[sensorID] = {
      lux: illuminance,
      ts: Date.now()
    };

    // optional: keep a global "last illuminance" for logging
    CONFIG.currentIlluminance = illuminance;
    CONFIG.currentIlluminanceTs = Date.now();

    logger(
      ["Current illuminance from", sensorID, ":", illuminance, "lux"],
      "Info"
    );
  },

  motionHandler: function (motion, eventData) {
    let sensorID = eventData.address || eventData.deviceID;

    if (typeof CONFIG.motionStates[sensorID] === "undefined") {
      CONFIG.motionStates[sensorID] = false;
    }

    if (motion) {
      // Motion detected
      if (!CONFIG.motionStates[sensorID]) {
        CONFIG.motionStates[sensorID] = true;
        CONFIG.activeMotionCount++;

        logger(
          [
            "Motion detected from sensor:",
            sensorID,
            "Active motion count:",
            CONFIG.activeMotionCount
          ],
          "Info"
        );

        // get per-sensor illuminance info
        let luxInfo = CONFIG.illuminanceBySensor[sensorID] || null;
        let lux = luxInfo ? luxInfo.lux : null;
        let fresh =
          luxInfo &&
          luxInfo.ts !== null &&
          (Date.now() - luxInfo.ts) <= CONFIG.illuminanceMaxAgeMs;

        if (fresh && lux !== null && lux <= CONFIG.darknessThreshold) {
          logger(
            [
              "Motion detected in darkness at",
              sensorID,
              "(",
              lux,
              "lux )"
            ],
            "Info"
          );

          // Switch ON logic: only if light is currently OFF
          Shelly.call(
            "Switch.GetStatus",
            { id: CONFIG.switchId },
            function (status) {
              if (!status.output) {
                Shelly.call("Switch.Set", { id: CONFIG.switchId, on: true });
                logger("Light turned on.", "Info");
              } else {
                logger("Light is already on.", "Info");
              }
            }
          );
        } else {
          logger(
            [
              "Motion detected at",
              sensorID,
              "but ignored due to sufficient or unknown light (lux=",
              lux,
              ", fresh=",
              !!fresh,
              ")"
            ],
            "Info"
          );
        }
      }
    } else {
      // No motion detected anymore
      if (CONFIG.motionStates[sensorID]) {
        CONFIG.motionStates[sensorID] = false;
        CONFIG.activeMotionCount = Math.max(
          0,
          CONFIG.activeMotionCount - 1
        );

        logger(
          [
            "Motion ended from sensor:",
            sensorID,
            "Active motion count:",
            CONFIG.activeMotionCount
          ],
          "Info"
        );

        // Switch off the light if no more movement is detected by any sensor
        if (CONFIG.activeMotionCount === 0) {
          Shelly.call(
            "Switch.GetStatus",
            { id: CONFIG.switchId },
            function (status) {
              if (status.output) {
                Shelly.call("Switch.Set", { id: CONFIG.switchId, on: false });
                logger(
                  "No motion detected from any sensor, light turned off.",
                  "Info"
                );
              } else {
                logger(
                  "No motion detected from any sensor, but light is already off.",
                  "Info"
                );
              }
            }
          );
        }
      }
    }

    logger(["Active motion count:", CONFIG.activeMotionCount], "Info");
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
  if (!CONFIG.debug) {
    return;
  }

  let finalText = "";

  if (Array.isArray(message)) {
    for (let i = 0; i < message.length; i++) {
      finalText = finalText + " " + JSON.stringify(message[i]);
    }
  } else {
    finalText = JSON.stringify(message);
  }

  if (typeof prefix !== "string") {
    prefix = "";
  } else {
    prefix = prefix + ":";
  }

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

      if (typeof _bth.f !== "undefined") {
        _value = _value * _bth.f;
      }

      result[_bth.n] = _value;
      buffer = buffer.slice(getByteSize(_bth.t));
    }

    return result;
  },
};

function onReceivedPacket(data) {
  // Sicherheitsnetz: falls diese Funktion aus anderer Quelle aufgerufen wird,
  // weiterhin nur erlaubte MAC-Adressen verarbeiten.
  if (
    typeof CONFIG._processedMacAddresses !== "undefined" &&
    CONFIG._processedMacAddresses !== null
  ) {
    let addr = data.address ? data.address.toLowerCase() : "";

    if (CONFIG._processedMacAddresses.indexOf(addr) < 0) {
      return;
    }
  }

  if (
    typeof CONFIG.illuminanceHandler === "function" &&
    typeof data.illuminance !== "undefined"
  ) {
    CONFIG.illuminanceHandler(data.illuminance, data);
    logger("Illuminance handler called", "Info");
  }

  if (
    typeof CONFIG.motionHandler === "function" &&
    typeof data.motion !== "undefined"
  ) {
    CONFIG.motionHandler(data.motion === 1, data);
    logger("Motion handler called", "Info");
  }

  if (typeof CONFIG.onStatusUpdate === "function") {
    CONFIG.onStatusUpdate(data);
    logger("New status update", "Info");
  }
}

// Empfehlung 3: Duplikatfilter pro MAC-Adresse statt global
let lastPacketIdByAddress = {};

// Callback for the BLE scanner object
function BLEScanCallback(event, result) {
  if (event !== BLE.Scanner.SCAN_RESULT) {
    return;
  }

  if (typeof result.addr !== "string") {
    return;
  }

  // Empfehlung 4: MAC-Adresse konsequent normalisieren
  let addr = result.addr.toLowerCase();

  // Empfehlung 2: Erlaubte MAC-Adressen sofort filtern,
  // bevor service_data dekodiert oder geloggt wird.
  if (
    typeof CONFIG._processedMacAddresses !== "undefined" &&
    CONFIG._processedMacAddresses !== null &&
    CONFIG._processedMacAddresses.indexOf(addr) < 0
  ) {
    return;
  }

  if (
    typeof result.service_data === "undefined" ||
    typeof result.service_data[BTHOME_SVC_ID_STR] === "undefined"
  ) {
    return;
  }

  let unpackedData = BTHomeDecoder.unpack(
    result.service_data[BTHOME_SVC_ID_STR]
  );

  if (
    unpackedData === null ||
    typeof unpackedData === "undefined" ||
    unpackedData["encryption"]
  ) {
    return;
  }

  // Falls kein pid vorhanden ist, nicht global blockieren.
  // Falls pid vorhanden ist, pro MAC-Adresse filtern.
  if (typeof unpackedData.pid !== "undefined") {
    if (lastPacketIdByAddress[addr] === unpackedData.pid) {
      return;
    }

    lastPacketIdByAddress[addr] = unpackedData.pid;
  }

  unpackedData.rssi = result.rssi;
  unpackedData.address = addr;

  onReceivedPacket(unpackedData);
}

// Initializes the script and performs the necessary checks and configurations
function init() {
  if (typeof CONFIG === "undefined") {
    console.log("Error: Undefined config");
    return;
  }

  let BLEConfig = Shelly.getComponentConfig("ble");

  if (!BLEConfig.enable) {
    console.log(
      "Error: The Bluetooth is not enabled, please enable it from settings"
    );
    return;
  }

  // Erlaubte MAC-Adressen vorbereiten, bevor der Scanner abonniert wird.
  if (typeof CONFIG.allowedMacAddresses !== "undefined") {
    if (CONFIG.allowedMacAddresses !== null) {
      CONFIG._processedMacAddresses =
        CONFIG
          .allowedMacAddresses
          .map(function (mac) {
            return mac.toLowerCase();
          })
          .filter(function (value, index, array) {
            return array.indexOf(value) === index;
          });
    } else {
      CONFIG._processedMacAddresses = null;
    }
  } else {
    CONFIG._processedMacAddresses = null;
  }

  if (BLE.Scanner.isRunning()) {
    console.log(
      "Info: The BLE gateway is running, the BLE scan configuration is managed by the device"
    );
  } else {
    let bleScanner = BLE.Scanner.Start({
      duration_ms: BLE.Scanner.INFINITE_SCAN,
      active: CONFIG.active
    });

    if (!bleScanner) {
      console.log("Error: Can not start new scanner");
      return;
    }
  }

  BLE.Scanner.Subscribe(BLEScanCallback);
}

init();