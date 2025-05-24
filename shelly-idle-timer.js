/**
 * Shelly Idle Timer Script
 * ------------------------
 * This script monitors the active power (`apower`) of a Shelly device and
 * automatically turns off the configured switch if power consumption stays
 * below a defined threshold for a specified duration.
 *
 * Functionality:
 * - Starts a timer when the switch is ON and `apower < POWER_THRESHOLD`.
 * - If the condition persists for more than `IDLE_TIMEOUT` minutes,
 *   the switch will be turned OFF.
 * - Reacts to `power_update`, `toggle`, and `input` events.
 *
 * Extension: Polling Fallback
 * ---------------------------
 * Some Shelly devices (e.g. Plug S Gen2) only emit `power_update` events
 * when power changes significantly. Small or slowly changing values
 * may not trigger any event.
 *
 * To ensure reliable behavior in such cases, the script includes
 * an optional polling mechanism that regularly fetches the current
 * device state and applies the same idle logic.
 *
 * Configurable options:
 * - `ENABLE_POLLING`: true / false (default: false)
 * - `POLL_INTERVAL`: polling interval in seconds
 *
 * Recommendation:
 * Enable `ENABLE_POLLING` if your device does not emit frequent
 * `power_update` events, or if you want to catch subtle idle conditions.
 */
/******************* START CHANGE HERE *******************/
const CONFIG = {
  // Power threshold, in watts
  POWER_THRESHOLD: 3,

  // Duration of low power before turning off, in minutes
  IDLE_TIMEOUT: 5,

  // Which of the device switches to monitor
  SWITCH_ID: 0,

  // When set to true, debug messages will be logged to the console if console is enabled
  DEBUG_LOG: false,

  // Enable periodic polling as fallback if no power_update is received
  ENABLE_POLLING: false,

  // Polling interval in seconds
  POLL_INTERVAL: 60
};
/******************* STOP CHANGE HERE *******************/

let timerHandle = undefined;

// Logs the provided message with an optional prefix to the console
function logger(message, prefix) {
  if (!CONFIG.DEBUG_LOG) return;

  let finalText = '';
  if (Array.isArray(message)) {
    for (let i = 0; i < message.length; i++) {
      finalText += ' ' + JSON.stringify(message[i]);
    }
  } else {
    finalText = JSON.stringify(message);
  }

  if (typeof prefix !== 'string') prefix = '';
  else prefix = prefix + ':';

  console.log(prefix, finalText);
}

function startTimer() {
  if (timerHandle !== undefined) {
    logger('Timer was already started.', 'startTimer');
    return;
  }

  timerHandle = Timer.set(CONFIG.IDLE_TIMEOUT * 60 * 1000, false, function () {
    clearTimer();

    Shelly.call('Switch.GetStatus', { id: CONFIG.SWITCH_ID }, function (result) {
      if (result.output === true && result.apower < CONFIG.POWER_THRESHOLD) {
        Shelly.call('Switch.set', { id: CONFIG.SWITCH_ID, on: false }, function () {
          logger(
            'Switched off due to active power of ' + result.apower + ' < ' + CONFIG.POWER_THRESHOLD + ' Watts.',
            'startTimer'
          );
          logger('Switch turned OFF by idle timer.', 'action');
        });
      } else {
        logger('No action taken. Power: ' + result.apower + ' W, Switch ON: ' + result.output, 'startTimer');
      }
    });
  });

  Shelly.call('Switch.GetStatus', { id: CONFIG.SWITCH_ID }, function (status) {
    logger('Timer was started. Current power: ' + status.apower + ' W', 'startTimer');
  });
}

function clearTimer() {
  if (timerHandle === undefined) return;

  Timer.clear(timerHandle);
  timerHandle = undefined;

  Shelly.call('Switch.GetStatus', { id: CONFIG.SWITCH_ID }, function (status) {
    logger('Timer was reset. Current power: ' + status.apower + ' W', 'clearTimer');
  });
}

Shelly.addEventHandler(function (event) {
  logger(event, 'raw-event');

  if (!event || !event.info || event.info.event === undefined) return;

  if (event.info.event === 'power_update') {
    logger('Power was updated.', 'Event');

    if (event.info.apower < CONFIG.POWER_THRESHOLD) {
      Shelly.call('Switch.GetStatus', { id: CONFIG.SWITCH_ID }, function (status) {
        if (status.output === true) {
          logger('Switch is ON. Power is low, current power: ' + status.apower + ' W – starting timer.', 'power_update');
          startTimer();
        } else {
          logger('Power is low, but switch is OFF – not starting timer.', 'power_update');
          clearTimer();
        }
      });
    } else {
      clearTimer();
    }

    return;
  }

  if (
    event.name === 'switch' &&
    event.id === CONFIG.SWITCH_ID &&
    typeof event.info.state !== 'undefined' &&
    (event.info.event === 'toggle' || event.name === 'input')
  ) {
    logger('Switch state changed (toggle or input).', 'Event');

    if (event.info.state === true) {
      clearTimer();
    } else if (event.info.state === false) {
      clearTimer();
    }

    return;
  }
});

// Check initial state once at startup
Shelly.call('Switch.GetStatus', { id: CONFIG.SWITCH_ID }, function (status) {
  if (status.output === true && status.apower < CONFIG.POWER_THRESHOLD) {
    logger('Initial state: switch is ON and power is low, current power: ' + status.apower + ' W – starting timer.', 'init');
    startTimer();
  } else {
    logger('Initial state: no need to start timer.', 'init');
  }
});

// Start polling fallback if enabled
if (CONFIG.ENABLE_POLLING) {
  Timer.set(CONFIG.POLL_INTERVAL * 1000, true, function () {
    Shelly.call('Switch.GetStatus', { id: CONFIG.SWITCH_ID }, function (status) {
      if (status.output === true && status.apower < CONFIG.POWER_THRESHOLD) {
        logger('Polling: Power is low, switch ON – starting timer.', 'polling');
        startTimer();
      } else {
        logger('Polling: Power OK or switch OFF – no action.', 'polling');
        clearTimer();
      }
    });
  });
}