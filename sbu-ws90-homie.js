// -----------------------------------------------------------------------------
// Shelly BLU WS90 → Homie v4 bridge (BTHome v2 decoding)
// -----------------------------------------------------------------------------
// Purpose
//   - Listens to WS90 BLE advertisements (BTHome v2, UUID FCD2), decodes values,
//     and publishes them as a Homie v4 device into MQTT for auto-discovery
//     (e.g., openHAB).
//
// Key features
//   - Homie 4.0.0 compliant announce with phased publishing to avoid broker drops
//   - Values are buffered until $state=ready, then flushed
//   - Wind average/gust and directions split; 16-sector compass labels (DE)
//   - Apparent temperature ("feels like") calculation (Steadman)
//   - Sea-level pressure (QNH) derived from station pressure and altitude
//   - Rolling rainfall sums for last 1h / 24h derived from the precipitation counter
//   - MAC whitelist (colon-lower) to filter to specific WS90 stations
//   - Persistent rolling rain totals across restarts (Shelly KVS, 15-min buckets)
//
// Topics (Homie root = "homie")
//   homie/<device-id>/$state                 : init → ready   (retained, QoS1)
//   homie/<device-id>/env/...               : temperature, humidity, dewpoint,
//                                             pressure, pressuresealevel,
//                                             illuminance, uvindex, feelslike
//   homie/<device-id>/wind/...              : windspeed, windgust,
//                                             winddirection, windgustdirection,
//                                             winddir, windgustdir (text labels)
//   homie/<device-id>/rain/...              : precipitation, rainflag,
//                                             rain1h, rain24h
//   homie/<device-id>/power/...             : capacitorvoltage
//   homie/<device-id>/system/...            : battery, rssi, lastupdate
//
// Configuration
//   ACTIVE_SCAN       : enable active BLE scan if needed (e.g., scan response)
//   HOMIE_ROOT        : base topic (default "homie")
//   HOMIE_VER         : Homie spec version string ("4.0.0")
//   ALTITUDE_M        : station altitude above MSL in meters (for QNH)
//   WIND_DIR_USER_DEG : fine calibration (°); 0 keeps baseline +180° flip
//   WIND_DIR_INVERT_CCW : if true, invert rotation sense (CCW vs CW)
//   allowedMacAddresses : colon-lower MACs to accept
//   PHASE_GAP_MS      : pacing between announce steps (tune if broker is busy)
//   PERSIST_PREFIX    : KVS key prefix for rain persistence (default "ws90_persist:")
//   PERSIST_DEBOUNCE_MS : write throttle to protect flash (default 5000 ms)
//   PERSIST_MAX_BUCKET_AGE : max age of stored buckets (default 86400 s = 24 h)
//   (Bucket length is 900 s = 15 min; can be changed in-code via rr.span if nötig.)
//
// Persistence (KVS) – how rain totals survive restarts
//   Storage layout per device (key: PERSIST_PREFIX + <device-id> + ":rain"):
//     {
//       last: <number|null>,        // last seen precip_mm counter (mm)
//       span: 900,                   // bucket width in seconds (15 min)
//       bucketStart: <epoch-sec>,    // start time of current bucket (aligned)
//       buckets: [ { t:<epoch-sec>, mm:<sum> }, ... ]  // mm per 15-min window
//     }
//   Flow:
//     - On boot we KVS.Get(). If empty, we init {last:null, span:900, ...}.
//     - First frame with precip_mm sets a baseline (rr.last = current counter),
//       but does NOT create deltas yet (no retroactive rain).
//     - On each subsequent frame, delta = current - rr.last.
//         • Negative or unrealistically large jumps (>200 mm) are treated as reset/outlier → delta=0, baseline moves.
//         • If delta>0, it is added to the current 15-min bucket (created/aligned as needed).
//       Then rr.last = current.
//     - Buckets older than 24 h are pruned regularly; we save to KVS
//       debounced (PERSIST_DEBOUNCE_MS) whenever delta>0 or pruning changed data.
//   Exposed rolling sums:
//     - rain1h  = sum of buckets with t >= now − 3600
//     - rain24h = sum of buckets with t >= now − 86400
//     (Trailing windows, not "since midnight".)
//   Publish behavior:
//     - Raw precipitation (precipitation) and rainflag publish as values arrive.
//     - rain1h / rain24h publish once persistence is loaded and buckets exist;
//       values are retained like other properties.
//   Resetting stats (if you really need a clean slate):
//     - Delete the device key: PERSIST_PREFIX + <device-id> + ":rain"
//       (e.g. via Shelly script console: KVS.Delete) and restart the script.
//       After that, a new baseline will be taken on the first reading.
//
// Notes & limits
//   - Script uses Shelly’s built-in MQTT session; a custom LWT for Homie
//     ($state="lost") cannot be set from scripts. Use Shelly’s <shelly-id>/online
//     as a proxy if you need LWT mapping.
//   - $-meta topics are published retained with QoS 0 on purpose to reduce load.
//   - If your broker/device rate-limits, increase PHASE_GAP_MS (e.g., 250–300 ms).
//   - Rolling windows do not count rain before the script observed it.
//   - Multiple WS90 devices are persisted independently (separate keys per device).
// -----------------------------------------------------------------------------
//////////////// CONFIG //////////////////
var ACTIVE_SCAN  = false;  // true --> also SCAN_RESPONSE
var QOS          = 1;      // QoS for values & $state
var HOMIE_ROOT   = "homie";
var HOMIE_VER    = "4.0.0";
var HOMIE_RETAIN = true;   // retained for values/$state
var ALTITUDE_M = 94;       // your station height above sea level in metres
// wind directional calibration
var WIND_DIR_BASELINE_FLIP_180 = false; // true = always +180° flip (regardless of user setting)
var WIND_DIR_USER_DEG  = 0;      // 0 => Basic flip by +180° remains active
var WIND_DIR_INVERT_CCW = false; // optional: true = Invert rotation direction (CCW instead of CW)
// Persistence (KVS)
var PERSIST_PREFIX = "ws90_persist:"; // KVS key prefix
var PERSIST_DEBOUNCE_MS = 5000;       // Write buffer (flash protection)
var PERSIST_MAX_BUCKET_AGE = 86400;   // we only need 24 hours anyway

// MAC-Whitelist (colon-lower)
var allowedMacAddresses = [
  "c0:2c:ed:aa:57:d5"
];

// Phase clock for staggered announcement (one timer per device)
var PHASE_GAP_MS = 200;

//////////////// HELPERS //////////////////
function macNoColonLower(m){ var s=(m||"").toLowerCase(); return s.split(":").join(""); }
function macColonLower(m){
  var s=(m||"").toLowerCase();
  if (s.indexOf(":")>=0) return s;
  if (s.length!==12) return s;
  return s.slice(0,2)+":"+s.slice(2,4)+":"+s.slice(4,6)+":"+s.slice(6,8)+":"+s.slice(8,10)+":"+s.slice(10,12);
}
function devIdFromMacNoColon(mac_nc){ return "ws90-"+mac_nc; }
function homieBase(id){ return HOMIE_ROOT + "/" + id; }
function pub(topic, payload, retain){ MQTT.publish(topic, String(payload), QOS, !!retain); } // QoS1
function pubMeta(topic, payload){ MQTT.publish(topic, String(payload), 0, true); }           // QoS0 retained ($-Metas)

// Bytes/Parsing
function hexOf(bytes){ var s="",i,h; for(i=0;i<bytes.length;i++){ h=(bytes[i]&255).toString(16); if(h.length<2) h="0"+h; s+=h; } return s; }
function bytesFromBinaryString(str){ if(!str) return null; var out=[],i; for(i=0;i<str.length;i++) out.push(str.charCodeAt(i)&255); return out; }
function bytesFromHexString(str){
  if(!str) return null; var s="",i,c; for(i=0;i<str.length;i++){ c=str[i]; if(c!==" "&&c!=="\n"&&c!=="\r"&&c!=="\t") s+=c; }
  if(s.length%2!==0) return null; var out=[],b;
  for(i=0;i<s.length;i+=2){ b=parseInt(s.substr(i,2),16); if(isNaN(b)) return null; out.push(b&255); }
  return out;
}
function bytesFromBase64(b64){
  if(!b64) return null; var tbl="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out=[],bits=0,val=0,i,c,p;
  for(i=0;i<b64.length;i++){ c=b64.charAt(i); if(c==="=") break; p=tbl.indexOf(c); if(p<0) continue;
    val=(val<<6)|p; bits+=6; if(bits>=8){ bits-=8; out.push((val>>bits)&255); } }
  return out;
}
function stringToBytesSmart(s){
  var b = bytesFromBinaryString(s);
  if (b && b.length){ var di=b[0], ver=(di>>5)&7; if(ver===2) return b; }
  b = bytesFromHexString(s); if(b && b.length) return b;
  b = bytesFromBase64(s);    if(b && b.length) return b;
  return bytesFromBinaryString(s);
}
function ensureBytes(x){
  if(x===undefined||x===null) return null;
  var t=typeof x;
  if(t==="string") return stringToBytesSmart(x);
  if(x && x.length!==undefined && typeof x[0]==="number"){ var arr=[],i; for(i=0;i<x.length;i++) arr.push(x[i]&255); return arr; }
  if(x && x.data!==undefined)    return ensureBytes(x.data);
  if(x && x.payload!==undefined) return ensureBytes(x.payload);
  if(x && x.value!==undefined)   return ensureBytes(x.value);
  try { if(x.toString) return ensureBytes(x.toString()); } catch(e){}
  return null;
}

// Apparent Temperature (Steadman 1979)
function apparentTempC(T, RH, wind_ms){
  if (T==null || RH==null) return null;
  if (wind_ms==null) wind_ms = 0;
  var e = (RH/100) * 6.105 * Math.exp((17.27*T)/(237.7+T)); // hPa
  return T + 0.33*e - 0.70*wind_ms - 4.0;
}

// Sea-Level Pressure (Barometrische Höhenformel)
function pressureSeaLevel_hPa(p_hPa, T_C, h_m){
  // p_hPa: Station pressure (hPa), T_C: °C (outside temperature), h_m: height above sea level (m)
  if (p_hPa==null || h_m==null) return null;
  var L = 0.0065;           // ISA Temperaturgradient (K/m)
  var EXP = 5.255;          // g*M/(R*L) ~ 5.255
  var T0K = ((T_C!=null) ? T_C : 15) + 273.15;  // Fallback 15°C, if T is missing
  var denom = 1 - (L*h_m)/(T0K + L*h_m/2);
  if (denom <= 0) return null;
  return p_hPa * Math.pow(denom, -EXP);
}

// 16-point compass rose (22.5° per sector), German: O = OST / East
function windLabelDE(deg){
  if (deg == null) return null;
  var d = deg % 360; if (d < 0) d += 360;

  if (WIND_DIR_INVERT_CCW) d = (360 - d);

  var user = parseFloat(WIND_DIR_USER_DEG);
  if (!(user >= -360 && user <= 360)) user = 0;

  if (WIND_DIR_BASELINE_FLIP_180) d += 180; // nur wenn wirklich nötig
  d += user;

  d = ((d % 360) + 360) % 360;

  var labels = ["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  var idx = Math.floor((d + 11.25) / 22.5) % 16;
  return labels[idx];
}

function kvsKeyRain(id){ return PERSIST_PREFIX + id + ":rain"; }

// Discard old buckets (everything >24 hours old), defensive guards:
function pruneBuckets(rr, nowSec){
  if (!rr || !rr.buckets) return rr;
  var th24 = nowSec - PERSIST_MAX_BUCKET_AGE;
  var out = [];
  for (var i=0;i<rr.buckets.length;i++){
    var b = rr.buckets[i];
    if (b && b.t >= th24 && typeof b.mm === "number") out.push(b);
  }
  rr.buckets = out;
  // Reset bucketStart if necessary
  if (out.length>0) rr.bucketStart = out[out.length-1].t;
  return rr;
}

// Load (asynchronous) – calls cb() upon completion:
function loadRainFromKVS(id, cb){
  Shelly.call("KVS.Get", { key: kvsKeyRain(id) }, function(r, e){
    var dev = devices[id];
    if (!dev) { if (cb) cb(); return; }

    var nowSec = ((Date.now()/1000)|0);
    var val = r && r.value;

    // If KVS saves as a string:
    if (typeof val === "string") {
      try { val = JSON.parse(val); } catch(_) { val = null; }
    }

    if (val && typeof val === "object") {
      dev.rain = pruneBuckets(val, nowSec);
      if (!dev.rain.span) dev.rain.span = 900;
      if (!dev.rain.buckets) dev.rain.buckets = [];
    } else {
      dev.rain = { last:null, span:900, bucketStart:0, buckets:[] };
    }

    dev.persistLoaded = true;
    if (dev._bootPrecip != null) { dev.rain.last = dev._bootPrecip; dev._bootPrecip = null; }
    if (cb) cb();
  });
}

// Save (debounced) – avoids flash hammer:
function scheduleSaveRain(id){
  var dev = devices[id]; if (!dev) return;
  if (dev._persistTimer){ Timer.clear(dev._persistTimer); dev._persistTimer=0; }
  dev._persistTimer = Timer.set(PERSIST_DEBOUNCE_MS, false, function(){
    dev._persistTimer = 0;
    Shelly.call("KVS.Set", { key: kvsKeyRain(id), value: JSON.stringify(dev.rain) }, function(){});
  });
}

//////////////// BTHome WS90 Decode //////////////////
var T = {
  0x00:{n:"pid",                  len:1, s:false, f:1    },
  0x01:{n:"battery_pct",          len:1, s:false, f:1    },
  0x45:{n:"temperature_c",        len:2, s:true,  f:0.1  },
  0x2E:{n:"humidity_pct",         len:1, s:false, f:1    },
  0x04:{n:"pressure_hpa",         len:3, s:false, f:0.01 },
  0x05:{n:"illuminance_lux",      len:3, s:false, f:0.01 },
  0x08:{n:"dew_point_c",          len:2, s:true,  f:0.01 },
  0x0C:{n:"capacitor_voltage_v",  len:2, s:false, f:0.001},
  0x20:{n:"moisture",             len:1, s:false, f:1    },
  0x44:{n:"wind_speed_ms",        len:2, s:false, f:0.01 }, // [avg, gust]
  0x46:{n:"uv_index",             len:1, s:false, f:0.1  },
  0x5E:{n:"wind_direction_deg",   len:2, s:false, f:0.01 }, // [avg, gust]
  0x5F:{n:"precip_mm",            len:2, s:false, f:0.1  }
};
function parseBTHome(buf){
  if(!buf || !buf.length) return null;
  var di=buf[0], enc=((di&1)===1), ver=(di>>5)&7;
  if(ver!==2 || enc) return null;
  var i=1, out={}, ids=[];
  while(i<buf.length){
    var id=buf[i++], def=T[id]; ids.push(id);
    if(!def) break;
    if(i+def.len>buf.length) break;
    var v=0,j; for(j=0;j<def.len;j++) v|=(buf[i+j]<<(8*j));
    i+=def.len;
    if(def.s){ var bits=8*def.len, sign=1<<(bits-1); if(v&sign) v=v-(1<<bits); }
    var val=v*def.f;
    if(out.hasOwnProperty(def.n)){
      if(out[def.n] && out[def.n].length!==undefined && typeof out[def.n][0]==="number") out[def.n].push(val);
      else out[def.n]=[out[def.n], val];
    } else out[def.n]=val;
  }
  out._ids = ids;
  return out;
}

//////////////// Homie Device State //////////////////
var devices = {};
var allowedSet = {};
for (var i=0;i<allowedMacAddresses.length;i++){
  var macC  = macColonLower(allowedMacAddresses[i]);
  var macNC = macNoColonLower(macC);
  var id    = devIdFromMacNoColon(macNC);
  devices[id] = { macColon: macC, last:{}, phase:"new", pending:[], _annTimer:0,
                  rain:null, persistLoaded:false, _persistTimer:0, _bootPrecip:null };
  loadRainFromKVS(id);
  allowedSet[macNC] = true;
}

function cancelAnnTimer(dev){ if (dev && dev._annTimer){ Timer.clear(dev._annTimer); dev._annTimer = 0; } }
function flushPending(id){
  var dev=devices[id]; if(!dev) return;
  var q = dev.pending; dev.pending = [];
  for (var i=0;i<q.length;i++){ var it=q[i]; publishValue(id,it.node,it.prop,it.value); }
}

// Mapping: decoded field name → Homie-Property-ID (spec-compliant)
function mapPropId(decodedName){
  if (decodedName==="temperature_c")            return "temperature";
  if (decodedName==="humidity_pct")             return "humidity";
  if (decodedName==="dew_point_c")              return "dewpoint";
  if (decodedName==="pressure_hpa")             return "pressure";
  if (decodedName==="pressure_sl_hpa")          return "pressuresealevel";
  if (decodedName==="illuminance_lux")          return "illuminance";
  if (decodedName==="uv_index")                 return "uvindex";
  if (decodedName==="feels_like_c")             return "feelslike";
  if (decodedName==="wind_speed_ms")            return "windspeed";
  if (decodedName==="wind_gust_ms")             return "windgust";
  if (decodedName==="wind_direction_deg")       return "winddirection";
  if (decodedName==="wind_gust_direction_deg")  return "windgustdirection";
  if (decodedName==="wind_dir_txt")             return "winddir";
  if (decodedName==="wind_gust_dir_txt")        return "windgustdir";
  if (decodedName==="precip_mm")                return "precipitation";
  if (decodedName==="rain_detected")            return "rainflag";
  if (decodedName==="rain_1h")                  return "rain1h";
  if (decodedName==="rain_24h")                 return "rain24h";
  if (decodedName==="capacitor_voltage_v")      return "capacitorvoltage";
  if (decodedName==="battery_pct")              return "battery";
  if (decodedName==="last_update")              return "lastupdate";
  return decodedName; // Fallback
}

function publishValue(id, node, prop, value, force){
  var dev=devices[id]; if(!dev) return;
  if (dev.phase !== "ready"){
    dev.pending.push({node:node, prop:prop, value:value});
    if (dev.phase === "new") homieAnnounceOne(id);
    return;
  }
  var key=node+"."+prop;
  if (!force && dev.last[key] === value) return;  // <- throttle only if not forced
  dev.last[key] = value;
  pub(
    homieBase(id)+"/"+node+"/"+prop,
    (value===true)?"true":(value===false)?"false":String(value),
    HOMIE_RETAIN
  );
}

//////////////// Homie Announce (Stepper) //////////////////
function homieAnnounceOne(id){
  var dev=devices[id]; if(!dev) return;
  if (dev.phase === "announcing" || dev.phase === "ready") return;

  dev.phase = "announcing";
  cancelAnnTimer(dev);

  var base = homieBase(id);
  var mac  = dev.macColon;

  function m(t,p){ pubMeta(base + t, p); }
  function s(p){  pub(base + "/$state", p, true); }

  // Steps (finely split)
  function f_state_init(){ s("init"); }
  function f_header(){
    m("/$homie", HOMIE_VER);
    m("/$name",  "Shelly WS90 " + mac);
    m("/$nodes", "env,wind,rain,power,system");
  }
  function f_nodes_env(){       m("/env/$name","environment"); m("/env/$properties","temperature,humidity,dewpoint,pressure,pressuresealevel,illuminance,uvindex,feelslike"); }
  function f_nodes_wind(){      m("/wind/$name","wind");       m("/wind/$properties","windspeed,windgust,winddirection,windgustdirection,winddir,windgustdir"); }
  function f_nodes_rain(){      m("/rain/$name","rain");       m("/rain/$properties","precipitation,rainflag,rain1h,rain24h"); }
  function f_nodes_power(){     m("/power/$name","power");     m("/power/$properties","capacitorvoltage"); }
  function f_nodes_system(){    m("/system/$name","system");   m("/system/$properties","battery,rssi,lastupdate"); }

  // ENV
  function f_meta_env_temp(){    m("/env/temperature/$name","Temperature"); m("/env/temperature/$datatype","float"); m("/env/temperature/$unit","°C"); m("/env/temperature/$settable","false"); }
  function f_meta_env_hum(){     m("/env/humidity/$name","Humidity"); m("/env/humidity/$datatype","integer"); m("/env/humidity/$unit","%"); m("/env/humidity/$settable","false"); }
  function f_meta_env_dew(){     m("/env/dewpoint/$name","Dewpoint"); m("/env/dewpoint/$datatype","float"); m("/env/dewpoint/$unit","°C"); m("/env/dewpoint/$settable","false"); }
  function f_meta_env_press(){   m("/env/pressure/$name","Pressure"); m("/env/pressure/$datatype","float"); m("/env/pressure/$unit","hPa"); m("/env/pressure/$settable","false"); }
  function f_meta_env_press_sl(){m("/env/pressuresealevel/$name","Pressure (MSL)"); m("/env/pressuresealevel/$datatype","float"); m("/env/pressuresealevel/$unit","hPa"); m("/env/pressuresealevel/$settable","false"); }
  function f_meta_env_illu(){    m("/env/illuminance/$name","Illuminance"); m("/env/illuminance/$datatype","float"); m("/env/illuminance/$unit","lx"); m("/env/illuminance/$settable","false"); }
  function f_meta_env_uv(){      m("/env/uvindex/$name","UV Index"); m("/env/uvindex/$datatype","float"); m("/env/uvindex/$unit","1"); m("/env/uvindex/$settable","false"); }
  function f_meta_env_feels(){   m("/env/feelslike/$name","Feels like"); m("/env/feelslike/$datatype","float"); m("/env/feelslike/$unit","°C"); m("/env/feelslike/$settable","false");
}
  // WIND
  function f_meta_wind_1(){
    m("/wind/windspeed/$name","Wind speed (avg)"); m("/wind/windspeed/$datatype","float"); m("/wind/windspeed/$unit","m/s"); m("/wind/windspeed/$settable","false");
    m("/wind/windgust/$name","Wind gust");         m("/wind/windgust/$datatype","float"); m("/wind/windgust/$unit","m/s"); m("/wind/windgust/$settable","false");
  }
  function f_meta_wind_2(){
    m("/wind/winddirection/$name","Direction (avg)"); m("/wind/winddirection/$datatype","float"); m("/wind/winddirection/$unit","deg"); m("/wind/winddirection/$settable","false");
    m("/wind/windgustdirection/$name","Direction (gust)"); m("/wind/windgustdirection/$datatype","float"); m("/wind/windgustdirection/$unit","deg"); m("/wind/windgustdirection/$settable","false");
  }
  function f_meta_wind_3(){      m("/wind/winddir/$name","Direction (avg, text)"); m("/wind/winddir/$datatype","string"); m("/wind/winddir/$settable","false"); }
  function f_meta_wind_4(){      m("/wind/windgustdir/$name","Direction (gust, text)"); m("/wind/windgustdir/$datatype","string"); m("/wind/windgustdir/$settable","false"); }

  // RAIN/POWER/SYSTEM
  function f_meta_rain(){
    m("/rain/precipitation/$name","Precipitation"); m("/rain/precipitation/$datatype","float"); m("/rain/precipitation/$unit","mm"); m("/rain/precipitation/$settable","false");
    m("/rain/rainflag/$name","Rain flag");        m("/rain/rainflag/$datatype","boolean");  m("/rain/rainflag/$settable","false");
  }
  function f_meta_rain_extra(){
    m("/rain/rain1h/$name","Rain last 1h"); m("/rain/rain1h/$datatype","float"); m("/rain/rain1h/$unit","mm"); m("/rain/rain1h/$settable","false");
    m("/rain/rain24h/$name","Rain last 24h"); m("/rain/rain24h/$datatype","float"); m("/rain/rain24h/$unit","mm"); m("/rain/rain24h/$settable","false");
  }
  function f_meta_power(){
    m("/power/capacitorvoltage/$name","Capacitor voltage"); m("/power/capacitorvoltage/$datatype","float"); m("/power/capacitorvoltage/$unit","V"); m("/power/capacitorvoltage/$settable","false");
    m("/system/battery/$name","Battery"); m("/system/battery/$datatype","integer"); m("/system/battery/$unit","%"); m("/system/battery/$settable","false");
  }
  function f_meta_system_2(){
    m("/system/rssi/$name","RSSI"); m("/system/rssi/$datatype","integer"); m("/system/rssi/$unit","dBm"); m("/system/rssi/$settable","false");
    m("/system/lastupdate/$name","Last update"); m("/system/lastupdate/$datatype","datetime"); m("/system/lastupdate/$settable","false");
  }

  function f_state_ready(){
    s("ready");
    dev.phase = "ready";
    flushPending(id);
    cancelAnnTimer(dev);
    print("Homie announce ready for", id);
  }

  var steps = [
    f_state_init,
    f_header,
    f_nodes_env, f_nodes_wind, f_nodes_rain, f_nodes_power, f_nodes_system,
    f_meta_env_temp, f_meta_env_hum, f_meta_env_dew,
    f_meta_env_press, f_meta_env_press_sl,
    f_meta_env_illu, f_meta_env_uv,
    f_meta_env_feels,
    f_meta_wind_1, f_meta_wind_2, f_meta_wind_3, f_meta_wind_4,
    f_meta_rain, f_meta_rain_extra,
    f_meta_power, f_meta_system_2,
    f_state_ready
  ];
  var idx = 0;

  function stepper(){
    if (idx < steps.length){
      steps[idx++]();
      dev._annTimer = Timer.set(PHASE_GAP_MS, false, stepper);
    } else {
      cancelAnnTimer(dev);
    }
  }
  dev._annTimer = Timer.set(150, false, stepper);
}

function homieAnnounceAll(){
  for (var id in devices){
    if (devices[id].phase === "new") homieAnnounceOne(id);
  }
}

//////////////// MQTT CONNECT EDGE //////////////////
var mqttWasConnected = false;
function pollMqttAndAnnounce(){
  Shelly.call("Mqtt.GetStatus", null, function(r){
    var c = r && r.connected;
    if (c && !mqttWasConnected){
      mqttWasConnected = true;
      Timer.set(300, false, homieAnnounceAll);
    } else if (!c && mqttWasConnected){
      mqttWasConnected = false;
    }
  });
}
Timer.set(2000, true, pollMqttAndAnnounce);
pollMqttAndAnnounce();

//////////////// RUNTIME (BLE) //////////////////
var cache = {};
print("WS90 Homie (spec IDs, phased) start – active="+(ACTIVE_SCAN?"true":"false"));
Shelly.call("Mqtt.GetStatus", null, function(r){ print("MQTT:", JSON.stringify(r)); });

BLE.Scanner.Subscribe(function (ev,res){
  if (ev!==BLE.Scanner.SCAN_RESULT || !res) return;

  var mac_nc = macNoColonLower(res.addr || res.address || "");
  if (!mac_nc || !allowedSet[mac_nc]) return;
  if (!res.service_data || (!res.service_data["fcd2"] && !res.service_data["FCD2"])) return;

  var raw = res.service_data["fcd2"] || res.service_data["FCD2"];
  var bth = ensureBytes(raw);
  if (!bth || !bth.length) return;

  var di=bth[0], enc=((di&1)===1), ver=(di>>5)&7;
  if (enc || ver!==2) return;

  var data = parseBTHome(bth);
  if (!data) return;

  // ONE clean timestamp per frame:
  var nowSec = ((Date.now()/1000)|0);

  // Merge
  var merged = cache[mac_nc] || {};
  for (var k in data){ if (k!=="_ids") merged[k]=data[k]; }

  // Set immediately: everything below uses the same time anchor
  merged.ts = nowSec;

  // rain flag
  if (merged.moisture!==undefined) merged.rain_detected = !!merged.moisture;

  // Wind: [avg, gust] separate
  if (merged.wind_speed_ms && merged.wind_speed_ms.length!==undefined){
    var ws = merged.wind_speed_ms;
    merged.wind_gust_ms = ws.length>1 ? ws[1] : null;
    merged.wind_speed_ms = ws[0];
  }
  // wind direction: [avg, gust] separate
  if (merged.wind_direction_deg && merged.wind_direction_deg.length!==undefined){
    var wd = merged.wind_direction_deg;
    merged.wind_gust_direction_deg = wd.length>1 ? wd[1] : null;
    merged.wind_direction_deg      = wd[0];
  }
  if (merged.wind_gust_direction_deg == null && merged.wind_direction_deg != null && merged.wind_gust_ms != null){
    merged.wind_gust_direction_deg = merged.wind_direction_deg;
  }

  // Wind text labels
  if (merged.wind_direction_deg != null)
    merged.wind_dir_txt = windLabelDE(merged.wind_direction_deg);
  if (merged.wind_gust_direction_deg != null)
    merged.wind_gust_dir_txt = windLabelDE(merged.wind_gust_direction_deg);

  // Feels like temperature
  if (merged.temperature_c != null && merged.humidity_pct != null){
    var vms = (merged.wind_speed_ms != null) ? merged.wind_speed_ms : 0;
    var at  = apparentTempC(merged.temperature_c, merged.humidity_pct, vms);
    if (at != null) merged.feels_like_c = Math.round(at*10)/10;
  }

  // QNH
  if (merged.pressure_hpa != null){
    var Tused = (merged.temperature_c != null) ? merged.temperature_c : 15;
    var psl = pressureSeaLevel_hPa(merged.pressure_hpa, Tused, ALTITUDE_M);
    if (psl != null) merged.pressure_sl_hpa = Math.round(psl*10)/10;
  }

  // Rain rolling sums (uses the same time anchor)
  if (merged.precip_mm != null) {
    var id   = devIdFromMacNoColon(mac_nc);
    var dev  = devices[id];
    if (!dev.rain) dev.rain = { last:null, span:900, bucketStart:0, buckets:[] };

    var rr   = dev.rain;
    var tSec = merged.ts;
    var cur  = merged.precip_mm;
    var delta = 0;                 // <-- initialise cleanly

    if (!dev.persistLoaded) {
      if (!rr) dev.rain = rr = { last:null, span:900, bucketStart:0, buckets:[] };
      rr.last = cur;
      dev._bootPrecip = cur;
    } else {
      // First sample after loading? Then just initialise – no delta, no bucket.
      if (rr.last == null || typeof rr.last !== "number" || !isFinite(rr.last)) {
        rr.last = cur;
        delta = 0;
      } else {
        delta = cur - rr.last;
        if (delta < 0 || delta > 200) delta = 0;
      }

      if (delta > 0) {
        var start = Math.floor(tSec / rr.span) * rr.span;
        if (start !== rr.bucketStart) {
          rr.bucketStart = start;
          rr.buckets.push({ t:start, mm:0 });
          if (rr.buckets.length > 128) rr.buckets.shift();
        }
        if (rr.buckets.length === 0) {
          rr.bucketStart = start;
          rr.buckets.push({ t:start, mm:0 });
        }
        rr.buckets[rr.buckets.length-1].mm += delta;
      }

      rr.last = cur;

      // Only if persistLoaded: Prune + possibly save
      var beforeLen = rr.buckets.length;
      pruneBuckets(rr, tSec);
      var didPrune = (rr.buckets.length !== beforeLen);
      if (delta > 0 || didPrune) scheduleSaveRain(id);

      // Sum only if persistLoaded
      var sum1h = 0, sum24h = 0, th1 = tSec - 3600, th24 = tSec - 86400;
      for (var bi = rr.buckets.length - 1; bi >= 0; bi--) {
        var b = rr.buckets[bi];
        if (b.t < th24) break;
        sum24h += b.mm;
        if (b.t >= th1) sum1h += b.mm;
      }
      merged.rain_1h_mm  = Math.round(sum1h  * 10) / 10;
      merged.rain_24h_mm = Math.round(sum24h * 10) / 10;
    }
  }
  // Meta
  merged.rssi = res.rssi;

  // Write cache (without overwriting ts!)
  cache[mac_nc] = merged;

  // Publish as homie (mapping to spec-compliant IDs)
  var id = devIdFromMacNoColon(mac_nc);
  if (!devices[id]){
    var macC = macColonLower(mac_nc);
    devices[id] = { macColon: macC, last:{}, phase:"new", pending:[], _annTimer:0,
                    rain:null, persistLoaded:false, _persistTimer:0, _bootPrecip:null };
    loadRainFromKVS(id);
  }
  if (devices[id].phase === "new") homieAnnounceOne(id);

  // ENV
  if (merged.temperature_c    != null) publishValue(id,"env",mapPropId("temperature_c"),   merged.temperature_c);
  if (merged.humidity_pct     != null) publishValue(id,"env",mapPropId("humidity_pct"),    merged.humidity_pct);
  if (merged.dew_point_c      != null) publishValue(id,"env",mapPropId("dew_point_c"),     merged.dew_point_c);
  if (merged.pressure_hpa     != null) publishValue(id,"env",mapPropId("pressure_hpa"),    merged.pressure_hpa);
  if (merged.pressure_sl_hpa  != null) publishValue(id,"env",mapPropId("pressure_sl_hpa"), merged.pressure_sl_hpa);
  if (merged.illuminance_lux  != null) publishValue(id,"env",mapPropId("illuminance_lux"), merged.illuminance_lux);
  if (merged.uv_index         != null) publishValue(id,"env",mapPropId("uv_index"),        merged.uv_index);
  if (merged.feels_like_c     != null) publishValue(id,"env",mapPropId("feels_like_c"),    merged.feels_like_c);

  // WIND
  if (merged.wind_speed_ms           != null) publishValue(id,"wind",mapPropId("wind_speed_ms"),           merged.wind_speed_ms);
  if (merged.wind_gust_ms            != null) publishValue(id,"wind",mapPropId("wind_gust_ms"),            merged.wind_gust_ms);
  if (merged.wind_direction_deg      != null) publishValue(id,"wind",mapPropId("wind_direction_deg"),      merged.wind_direction_deg);
  if (merged.wind_gust_direction_deg != null) publishValue(id,"wind",mapPropId("wind_gust_direction_deg"), merged.wind_gust_direction_deg);
  if (merged.wind_dir_txt            != null) publishValue(id,"wind",mapPropId("wind_dir_txt"),            merged.wind_dir_txt);
  if (merged.wind_gust_dir_txt       != null) publishValue(id,"wind",mapPropId("wind_gust_dir_txt"),       merged.wind_gust_dir_txt);

  // RAIN
  if (merged.precip_mm     != null) publishValue(id,"rain",mapPropId("precip_mm"),     merged.precip_mm);
  if (merged.rain_detected != null) publishValue(id,"rain",mapPropId("rain_detected"), merged.rain_detected);
  if (merged.rain_1h_mm    != null) publishValue(id,"rain",mapPropId("rain_1h"),       merged.rain_1h_mm);
  if (merged.rain_24h_mm   != null) publishValue(id,"rain",mapPropId("rain_24h"),      merged.rain_24h_mm);

  // POWER
  if (merged.capacitor_voltage_v != null) publishValue(id,"power",mapPropId("capacitor_voltage_v"), merged.capacitor_voltage_v);

  // SYSTEM
  if (merged.battery_pct != null) publishValue(id,"system",mapPropId("battery_pct"), merged.battery_pct);
  if (merged.rssi        != null) publishValue(id,"system","rssi",                   merged.rssi);
  
  publishValue(id, "system", mapPropId("last_update"), new Date(nowSec*1000).toISOString(), true ); // force update even if unchanged
});

// Scanner start
var DUR = (BLE.Scanner && BLE.Scanner.INFINITE_SCAN) ? BLE.Scanner.INFINITE_SCAN : -1;
BLE.Scanner.Start({ duration_ms: DUR, active: ACTIVE_SCAN });
print("Scanner gestartet (active="+(ACTIVE_SCAN?"true":"false")+")");