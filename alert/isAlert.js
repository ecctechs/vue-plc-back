function isWorkingTime(now, workingTime) {
  const dayMap = ["sun","mon","tue","wed","thu","fri","sat"];
  const day = dayMap[now.getDay()];
  if (!workingTime.days.includes(day)) return false;

  const time = now.toTimeString().slice(0,5);
  return time >= workingTime.start && time <= workingTime.end;
}

function isAlert(device, value, lastAlert, workingTime) {
  const alert = device.alert;
  if (!alert || !alert.enabled) return null;

  const now = new Date();

  // ON / OFF
  if (device.dataType === "on/off") {
    if (value === "OFF") {
      if (alert.onlyWorkingTime &&
          !isWorkingTime(now, workingTime)) return null;

      return {
        type: "off_duration",
        message: `Device ${device.name} OFF`
      };
    }
  }

  // NUMBER / ANALOG
  const num = Number(value);
  if (isNaN(num)) return null;

  if (alert.lower !== null && num < alert.lower) {
    return {
      type: "lower",
      message: `Value ${num} < lower limit ${alert.lower}`
    };
  }

  if (alert.upper !== null && num > alert.upper) {
    return {
      type: "upper",
      message: `Value ${num} > upper limit ${alert.upper}`
    };
  }

  return null;
}

module.exports = { isAlert };
