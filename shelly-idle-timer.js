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
  };
  
/******************* STOP CHANGE HERE *******************/

  let timerHandle = undefined;
  
  // Logs the provided message with an optional prefix to the console
  function logger(message, prefix) {
    if (!CONFIG.DEBUG_LOG) {
      return;
    }
  
    let finalText = '';
    if (Array.isArray(message)) {
      for (let i = 0; i < message.length; i++) {
        finalText = finalText + ' ' + JSON.stringify(message[i]);
      }
    } else {
      finalText = JSON.stringify(message);
    }
  
    if (typeof prefix !== 'string') {
      prefix = '';
    } else {
      prefix = prefix + ':';
    }
  
    console.log(prefix, finalText);
  }
  
  function startTimer() {
    if (timerHandle !== undefined) {
      logger('Timer was already started.', 'startTimer');
  
      return;
    }
  
    timerHandle = Timer.set(CONFIG.IDLE_TIMEOUT * 60 * 1000, true, function () {
      clearTimer();
  
      Shelly.call('Switch.GetStatus', { id: CONFIG.SWITCH_ID }, function (result) {
        if (result.output === true && result.apower < CONFIG.POWER_THRESHOLD) {
          Shelly.call('Switch.set', { id: CONFIG.SWITCH_ID, on: false }, function () {
            logger(
              'Switched off due to active power of ' + result.apower + ' < ' + CONFIG.POWER_THRESHOLD + ' Watts.',
              'startTimer'
            );
          });
        }
      });
    });
  
    logger('Timer was started.', 'startTimer');
  }
  
  function clearTimer() {
    if (timerHandle !== undefined) {
      Timer.clear(timerHandle);
      timerHandle = undefined;
  
      logger('Timer was reset.', 'clearTimer');
    }
  }
  
  Shelly.addEventHandler(function (event) {
    if (
      typeof event === 'undefined' ||
      typeof event.info === 'undefined' ||
      event.info.event === 'undefined' ||
      event.name !== 'switch' ||
      event.id !== CONFIG.SWITCH_ID
    )
      return;
  
    if (typeof event.info.state !== 'undefined' && event.info.event === 'toggle') {
      logger('Switch was toogled.', 'Event');
  
      if (event.info.state === true) {
        // if switch is toogled on, start a new timer.
        startTimer();
      } else if (event.info.state === false) {
        // if switch is toogled off, check running timer and clear.
        clearTimer();
      }
  
      return;
    }
  
    if (event.info.event === 'power_update') {
      logger('Power was updated.', 'Event');
  
      if (event.info.apower < CONFIG.POWER_THRESHOLD) {
        // if last measured instantaneous active power (in Watts) is lower then power threshold, start a new timer.
        startTimer();
      } else {
        // if last measured instantaneous active power (in Watts) is higher then or equals power threshold, check running timer and clear.
        clearTimer();
      }
  
      return;
    }
  });