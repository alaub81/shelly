// WS90 (BTHome v2) → MQTT (schlank) — MAC-Whitelist, optional Schema/RAW
// Topics: weather/ws90/<mac_no_colon>/(state|field/<name>|hdr|raw|schema)

//////////////// CONFIG //////////////////
var TOPIC_PREFIX     = "weather/ws90";
var QOS              = 1;
var RETAIN_STATE     = true;   // letzten State behalten
var PUBLISH_PER_FIELD= true;   // pro Feld eigenes Topic
var ACTIVE_SCAN      = false;  // bei Bedarf true (SCAN_RESPONSE)

var allowedMacAddresses = [
  "c0:2c:ed:aa:57:d5"
  // "0b:ae:5f:33:9b:3c",
  // "1a:22:33:62:5a:bc",
];

var PUBLISH_SCHEMA  = false;   // Schema/IDs-Tracking (debug)
var DEBUG_HDR_RAW   = false;   // hdr/raw mit veröffentlichen (debug)

//////////////// HELPERS //////////////////
function macNoColonLower(m){ var s=(m||"").toLowerCase(); return s.split(":").join(""); }
function hexOf(bytes){ var s="",i,h; for(i=0;i<bytes.length;i++){ h=(bytes[i]&255).toString(16); if(h.length<2) h="0"+h; s+=h; } return s; }
function bytesFromBinaryString(str){ if(!str) return null; var out=[],i; for(i=0;i<str.length;i++) out.push(str.charCodeAt(i)&255); return out; }
function bytesFromHexString(str){
  if(!str) return null; var s="",i,c;
  for(i=0;i<str.length;i++){ c=str[i]; if(c!==" "&&c!=="\n"&&c!=="\r"&&c!=="\t") s+=c; }
  if(s.length%2!==0) return null;
  var out=[]; for(i=0;i<s.length;i+=2){ var b=parseInt(s.substr(i,2),16); if(isNaN(b)) return null; out.push(b&255); }
  return out;
}
function bytesFromBase64(b64){
  if(!b64) return null; var tbl="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out=[],bits=0,val=0,i,c,p;
  for(i=0;i<b64.length;i++){ c=b64.charAt(i); if(c==="=") break; p=tbl.indexOf(c); if(p<0) continue;
    val=(val<<6)|p; bits+=6; if(bits>=8){ bits-=8; out.push((val>>bits)&255); } }
  return out;
}
// String → number[] (Heuristik)
function stringToBytesSmart(s){
  var b = bytesFromBinaryString(s);
  if (b && b.length){ var di=b[0], ver=(di>>5)&7; if(ver===2) return b; }
  b = bytesFromHexString(s);   if(b && b.length) return b;
  b = bytesFromBase64(s);      if(b && b.length) return b;
  return bytesFromBinaryString(s);
}
// any → number[]
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

//////////////// BTHOME v2 MAP (WS90) //////////////////
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
  0x44:{n:"wind_speed_ms",        len:2, s:false, f:0.01 },
  0x46:{n:"uv_index",             len:1, s:false, f:0.1  },
  0x5E:{n:"wind_direction_deg",   len:2, s:false, f:0.01 },
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

//////////////// RUNTIME //////////////////
var allowedSet = {}; // mac_no_colon -> true
for (var i=0;i<allowedMacAddresses.length;i++) allowedSet[macNoColonLower(allowedMacAddresses[i])] = true;

var cache = {};
var seen = {}, seen_ids = {}, last_seen_ts = {}; // nur genutzt, wenn PUBLISH_SCHEMA=true

print("WS90 slim Script start");
if (Shelly && Shelly.call) Shelly.call("Mqtt.GetStatus", null, function(r){ print("MQTT:", JSON.stringify(r)); });

BLE.Scanner.Subscribe(function (ev,res){
  if (ev!==BLE.Scanner.SCAN_RESULT || !res) return;

  var mac_nc = macNoColonLower(res.addr || res.address || "");
  if (!mac_nc || !allowedSet[mac_nc]) return;
  if (!res.service_data || (!res.service_data["fcd2"] && !res.service_data["FCD2"])) return;

  var raw = res.service_data["fcd2"] || res.service_data["FCD2"];
  var bth = ensureBytes(raw);
  if (!bth || !bth.length) return;

  var di=bth[0], enc=((di&1)===1), ver=(di>>5)&7;

  if (DEBUG_HDR_RAW){
    MQTT.publish(TOPIC_PREFIX+"/"+mac_nc+"/hdr", JSON.stringify({di:di, ver:ver, enc:enc, len:bth.length}), 0, false);
    MQTT.publish(TOPIC_PREFIX+"/"+mac_nc+"/raw", hexOf(bth), 0, false);
  }
  if (enc || ver!==2) return;

  var data = parseBTHome(bth);
  if (!data) return;

  // --------- Merge & Aufbereitung ----------
  var merged = cache[mac_nc] || {};
  var k;

  // Schema nur wenn aktiv
  if (PUBLISH_SCHEMA && data._ids){
    var now = (Date.now()/1000)|0, i;
    for (i=0;i<data._ids.length;i++){
      var idHex = (data._ids[i]&255).toString(16); if(idHex.length<2) idHex="0"+idHex;
      seen_ids[idHex] = (seen_ids[idHex]||0)+1;
    }
  }

  for (k in data){
    if(k==="_ids") continue;
    merged[k]=data[k];
    if (PUBLISH_SCHEMA){ seen[k]=true; last_seen_ts[k] = (Date.now()/1000)|0; }
  }

  // Regen-Flag
  if (merged.moisture!==undefined) merged.rain_detected = !!merged.moisture;

  // Wind: Geschwindigkeiten [Ø, Böe] → getrennt (m/s)
  if (merged.wind_speed_ms && merged.wind_speed_ms.length!==undefined){
    merged.wind_gust_ms = merged.wind_speed_ms[1];
    merged.wind_speed_ms = merged.wind_speed_ms[0];
  }
  // Wind: Richtungen [Ø, Böe] → getrennt (°)
  if (merged.wind_direction_deg && merged.wind_direction_deg.length!==undefined){
    var _arr = merged.wind_direction_deg;
    merged.wind_gust_direction_deg = _arr[1];
    merged.wind_direction_deg      = _arr[0];
  }
  if (merged.wind_gust_direction_deg == null && merged.wind_direction_deg != null && merged.wind_gust_ms != null){
    merged.wind_gust_direction_deg = merged.wind_direction_deg;
  }

  // Meta
  merged.rssi = res.rssi;
  merged.ts = (Date.now()/1000)|0;
  cache[mac_nc] = merged;

  // STATE (retained)
  var topic = TOPIC_PREFIX+"/"+mac_nc+"/state";
  MQTT.publish(topic, JSON.stringify(merged), QOS, RETAIN_STATE);

  // pro Feld (nicht retained)
  if (PUBLISH_PER_FIELD){
    for (k in merged){
      MQTT.publish(TOPIC_PREFIX+"/"+mac_nc+"/field/"+k, String(merged[k]), 0, false);
    }
  }

  // Optional: Schema publizieren
  if (PUBLISH_SCHEMA){
    var fields=[], last={}, idlist=[], kk;
    for (kk in seen) if (seen[kk]) fields.push(kk);
    for (kk in last_seen_ts) last[kk]=last_seen_ts[kk];
    for (kk in seen_ids) idlist.push(kk);
    var schema = { fields: fields, last_seen: last, ids: idlist, now: merged.ts };
    MQTT.publish(TOPIC_PREFIX+"/"+mac_nc+"/schema", JSON.stringify(schema), 0, false);
  }
});

// Scan starten
var DUR = (BLE.Scanner && BLE.Scanner.INFINITE_SCAN) ? BLE.Scanner.INFINITE_SCAN : -1;
BLE.Scanner.Start({ duration_ms: DUR, active: ACTIVE_SCAN });
print("Scanner gestartet (active="+(ACTIVE_SCAN?"true":"false")+")");