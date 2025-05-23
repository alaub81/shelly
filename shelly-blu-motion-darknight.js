/******************* START CHANGE HERE *******************/
let CONFIG = {
  // enable / disable debug mode
  debug: true,
  // enable / disable active bluetooth scanning
  active: false,

  // set the motion sensors allowed mac adresses
  allowedMacAddresses: [
    "0b:ae:5f:33:9b:3c",
    "1a:22:33:62:5a:bc", 
  ],

  // Which of the device output should be switched
  switchId: 0,

  // Threshold value for darkness in lux
  darknessThreshold: 1, // Lighting value below this value is considered ‘dark’

  // Geographical coordinates
  latitude: 49.70876653275439,
  longitude: 8.8062444123138,
  // do not change that
  timezone: "UTC",

  // Space for the sunrise and sunset times, do not change!
  sunriseTime: null,
  sunsetTime: null,

  // Space for current lighting value, do not change
  currentIlluminance: null,

  // Space for the number of active motion detection, do not change
  activeMotionCount: 0,

  // Space for the object to save the movement status of each sensor
  motionStates: {},

  // Function for retrieving the solar times
  updateSunTimes: function () {
    let url = "https://api.sunrise-sunset.org/json?lat=" + CONFIG.latitude + "&lng=" + CONFIG.longitude + "&formatted=0&tzid=" + CONFIG.timezone;

    Shelly.call("HTTP.GET", { url: url }, function (result) {
      if (result && result.code === 200) {
        let data = JSON.parse(result.body);
        // sunrise / sunset can be changed to civil_twilight_begin / civil_twilight_end 
        CONFIG.sunriseTime = new Date(data.results.sunrise);
        CONFIG.sunsetTime = new Date(data.results.sunset);
        logger(["current time:", new Date(), "isNightTime:", CONFIG.isNightTime()], "Info");
        logger(["Sunrise:", CONFIG.sunriseTime, "Sunset:", CONFIG.sunsetTime, "Longitude:", CONFIG.longitude, "Latitude:", CONFIG.latitude, "URL", url], "Info");
      } else {
        logger("Failed to fetch sunrise/sunset times.", "Info");
      }
    });
  },

  illuminanceHandler: function (illuminance, eventData) {
    CONFIG.currentIlluminance = illuminance;
    logger(["Current illuminance:", illuminance], "Info");
  },

  // Checks whether it is night based on the sun times
  isNightTime: function () {
    //console.log("in isNightTime Function");
    if (CONFIG.sunriseTime === null || CONFIG.sunsetTime === null) {
      logger("Sunrise or sunset time is not set yet.", "Error");
      return false; // or another default behavior
    }
    let now = new Date();
    return now >= CONFIG.sunsetTime || now < CONFIG.sunriseTime;
  },

  motionHandler: function (motion, eventData) {
    let sensorID = eventData.address || eventData.deviceID; // Use ‘address’ or ‘deviceID’ of the sensor as sensorID
    if (typeof CONFIG.motionStates[sensorID] === "undefined") {
      CONFIG.motionStates[sensorID] = false;
    }
    logger(["current time:", new Date(), "Sunrise:", CONFIG.sunriseTime, "Sunset:", CONFIG.sunsetTime, "isNightTime:", CONFIG.isNightTime(), "lux:", CONFIG.currentIlluminance], "Info");
    if (motion) {
      // If movement is detected and the sensor has not yet signalled any movement
      if (!CONFIG.motionStates[sensorID]) {
        // Motion of the sensor is recognised for the first time
        CONFIG.motionStates[sensorID] = true;  // Set status to ‘Motion detected’
        CONFIG.activeMotionCount++; // Motion detected - increase counter
        logger(["Motion detected from sensor:", sensorID, "Active motion count:", CONFIG.activeMotionCount], "Info");
        // Check whether it is dark enough and night
        if (CONFIG.currentIlluminance !== null && CONFIG.currentIlluminance <= CONFIG.darknessThreshold && CONFIG.isNightTime()) {
          logger("Motion detected in darkness.", "Info");
          // Query the status of the light before it is switched on
          Shelly.call("Switch.GetStatus", { id: CONFIG.switchId }, function (status) {
            if (!status.output) { // Only switch on when the light is of
              Shelly.call("Switch.Set", { id: CONFIG.switchId, on: true });
              logger("light turned on.", "Info");
            } else {
              logger("light is already on.", "Info");
            }
          });  
        } else {
          logger("Motion detected but ignored due to sufficient light.", "Info");
        }
      }  
    } else {
      // If no more motion is detected and the sensor previously signalled motion
      if (CONFIG.motionStates[sensorID]) {
        // Motion of the sensor is terminated
        CONFIG.motionStates[sensorID] = false; // Set status to ‘no motion’
        CONFIG.activeMotionCount = Math.max(0, CONFIG.activeMotionCount - 1); // Reduce counter
        logger(["Motion ended from sensor:", sensorID, "Active motion count:", CONFIG.activeMotionCount], "Info");
        // Switch off the light if no more movement is detected by any sensor
        if (CONFIG.activeMotionCount === 0) {
          // Query the status of the light before it is switched off
          Shelly.call("Switch.GetStatus", { id: CONFIG.switchId }, function (status) {
            if (status.output) { // Only switch off when the light is on
              Shelly.call("Switch.Set", { id: CONFIG.switchId, on: false });
              logger("No motion detected from any sensor, light turned off.", "Info");
            } else {
              logger("No motion detected from any sensor, but light is already off.", "Info");
            }
          });
        }
      }
    }
    // Debug output for the number of active motion detections
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

// Initialisation, including solar time update
function updateAPI() {
  CONFIG.updateSunTimes(); // Retrieve sun times at the start
  // Interval for regular update of the solar times every hour
  Timer.set(3600000  /* 1 hour in milliseconds */, true, function () {
    CONFIG.updateSunTimes();
  });
}

updateAPI();


//Logs the provided message with an optional prefix to the console.
function logger(message, prefix) {
  //exit if the debug isn't enabled
  if (!CONFIG.debug) {
    return;
  }

  let finalText = "";

  //if the message is list loop over it
  if (Array.isArray(message)) {
    for (let i = 0; i < message.length; i++) {
      finalText = finalText + " " + JSON.stringify(message[i]);
    }
  } else {
    finalText = JSON.stringify(message);
  }

  //the prefix must be string
  if (typeof prefix !== "string") {
    prefix = "";
  } else {
    prefix = prefix + ":";
  }

  //log the result
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
  //impossible as advertisements are much smaller;
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
    //beacons might not provide BTH service data
    if (typeof buffer !== "string" || buffer.length === 0) return null;
    let result = {};
    let _dib = buffer.at(0);
    result["encryption"] = _dib & 0x1 ? true : false;
    result["BTHome_version"] = _dib >> 5;
    if (result["BTHome_version"] !== 2) return null;
    //can not handle encrypted data
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

function onReceivedPacket (data) {
  if(CONFIG._processedMacAddresses !== null) { 
    if(CONFIG._processedMacAddresses.indexOf(data.address) < 0) {
      logger(["Received event from", data.address, "outside of the allowed addresses"], "Info");
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

//saving the id of the last packet, this is used to filter the duplicated packets
let lastPacketId = 0x100;

// Callback for the BLE scanner object
function BLEScanCallback(event, result) {
  //exit if not a result of a scan
  if (event !== BLE.Scanner.SCAN_RESULT) {
    return;
  }

  //exit if service_data member is missing
  if (
    typeof result.service_data === "undefined" ||
    typeof result.service_data[BTHOME_SVC_ID_STR] === "undefined"
  ) {
    return;
  }

  let unpackedData = BTHomeDecoder.unpack(
    result.service_data[BTHOME_SVC_ID_STR]
  );

  //exit if unpacked data is null or the device is encrypted
  if (
    unpackedData === null ||
    typeof unpackedData === "undefined" ||
    unpackedData["encryption"]
  ) {
    logger("Encrypted devices are not supported", "Error");
    return;
  }

  //exit if the event is duplicated
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
  //exit if can't find the config
  if (typeof CONFIG === "undefined") {
    console.log("Error: Undefined config");
    return;
  }

  //get the config of ble component
  let BLEConfig = Shelly.getComponentConfig("ble");

  //exit if the BLE isn't enabled
  if (!BLEConfig.enable) {
    console.log(
      "Error: The Bluetooth is not enabled, please enable it from settings"
    );
    return;
  }

  //check if the scanner is already running
  if (BLE.Scanner.isRunning()) {
    console.log("Info: The BLE gateway is running, the BLE scan configuration is managed by the device");
  }
  else {
    //start the scanner
    let bleScanner = BLE.Scanner.Start({
        duration_ms: BLE.Scanner.INFINITE_SCAN,
        active: CONFIG.active
    });

    if(!bleScanner) {
      console.log("Error: Can not start new scanner");
    }
  }

  if (
    typeof CONFIG.allowedMacAddresses !== "undefined"
  ) {
    if(CONFIG.allowedMacAddresses !== null) {
      // Process configured mac addresses all to lower case and remove duplicates. 
      CONFIG._processedMacAddresses = 
        CONFIG
          .allowedMacAddresses
          .map(function (mac) { return mac.toLowerCase(); })
          .filter(function (value, index, array) { return array.indexOf(value) === index; })
    }
    else {
      CONFIG._processedMacAddresses = null;
    }
  }

  //subscribe a callback to BLE scanner
  BLE.Scanner.Subscribe(BLEScanCallback);
}

init();