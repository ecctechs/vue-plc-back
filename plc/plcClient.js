const net = require("net");
const Modbus = require("jsmodbus");
const { logRead , logWrite } = require("../db/pg");
const { isAlert } = require("../alert/isAlert");
const { getLastAlert } = require("../alert/isAlertCooldown");
const { sendEmail } = require("../alert/sendEmail");
const { pool } = require("../db/pg");

const socket = new net.Socket();
const client = new Modbus.client.TCP(socket, 1);

socket.connect({ host: "192.168.3.250", port: 502 });

socket.on("connect", () => {
  console.log("✅ PLC connected");
});

socket.on("error", (err) => {
  console.error("❌ PLC socket error:", err.message);
});

socket.on("close", () => {
  console.warn("⚠️ PLC connection closed");
});

// ⭐ เก็บค่าล่าสุด
const lastValues = {};

function getKey(device) {
  return `${device.address.type}${device.address.start}`;
}

async function saveIfChanged(device, value) {
  const key = getKey(device);

  if (lastValues[key] === value) {
    // ❌ ค่าไม่เปลี่ยน → ไม่ log
    return;
  }

  // ✅ ค่าเปลี่ยน → log
  lastValues[key] = value;
  await logRead(device, value);
}

async function saveLog(device, value) {
  const key = getKey(device);

  // ✅ ON / OFF → log ทุกครั้ง
  if (device.dataType === "on/off") {
    await logRead(device, value);
    lastValues[key] = value;
    return;
  }

  // ✅ TYPE อื่น → log เฉพาะเปลี่ยน
  if (lastValues[key] === value) return;

  lastValues[key] = value;
  await logRead(device, value);
}


/* ===== READ ===== */
async function readPLC(device) {
  const { type, start, length } = device.address;

  /* ================= ON / OFF ================= */
  if (device.dataType === "on/off") {
    const coilAddress = 8192 + Number(start);
    const res = await client.readCoils(coilAddress, length);
    const value = res.response.body.values[0] ? "ON" : "OFF";


    await saveLog(device, value);
    // await saveIfChanged(device, value);

    // ALERT
    const workingTime = await getWorkingTime();
    await handleAlert(device, value, workingTime);

    return value;
  }

  /* ================= NUMBER ================= */
  if (device.dataType === "number") {
    const res = await client.readHoldingRegisters(start, length);
    const value = res.response.body.values[0];

    await saveIfChanged(device, value);

    // ALERT
    const workingTime = await getWorkingTime();
    await handleAlert(device, value, workingTime);

    return value;
  }

  /* ================= ANALOG (2 WORD) ================= */
  if (device.dataType === "analog") {
    const res = await client.readHoldingRegisters(start, length);

    const integerPart = res.response.body.values[0];
    const decimalPart = res.response.body.values[1];
    const decimal = decimalPart.toString().padStart(2, "0");

    const value = `${integerPart}.${decimal}`;

    await saveIfChanged(device, value);

    // ALERT
    const workingTime = await getWorkingTime();
    await handleAlert(device, value, workingTime);

    return value;
  }

  /* ================= STRING ================= */
  if (device.dataType === "string") {
    const res = await client.readHoldingRegisters(start, length);

    let text = "";
    for (const word of res.response.body.values) {
      const highByte = (word >> 8) & 0xff;
      const lowByte  = word & 0xff;

      if (lowByte !== 0) text += String.fromCharCode(lowByte);
      if (highByte !== 0) text += String.fromCharCode(highByte);
    }

    const value = text.trim();
    await saveIfChanged(device, value);
    return value;
  }
}


/* ===== WRITE ===== */
async function writePLC(device, value) {
  const { type, start } = device.address;

  /* ================= ON / OFF ================= */
  if (type === "M") {
    const coilAddress = 8192 + Number(start);
    const coilValue = value === true || value === "ON";

    await client.writeSingleCoil(coilAddress, coilValue);

    // ✅ log WRITE
    await logWrite(device, value);
  }

  /* ================= NUMBER ================= */
  if (type === "D" && device.dataType === "number") {
    await client.writeSingleRegister(start, Number(value));

    // ✅ log WRITE
    await logWrite(device, value);
  }

  /* ================= ANALOG (2 DIGIT) ================= */
  if (type === "D" && device.dataType === "analog") {
    const num = Number(value);

    const integerPart = Math.floor(num);
    const decimalPart = Math.round((num - integerPart) * 100);

    await client.writeMultipleRegisters(start, [
      integerPart,
      decimalPart,
    ]);

    // ✅ log WRITE
    await logWrite(device, value);
  }
}

function isWorkingTime(date, config) {
  const dayMap = ['sun','mon','tue','wed','thu','fri','sat'];

  const day = dayMap[date.getDay()];
  const time = date.toTimeString().slice(0, 5); // HH:mm

  if (!config.working_days.includes(day)) return false;
  if (time < config.start_time) return false;
  if (time > config.end_time) return false;

  return true;
}

async function getWorkingTime() {
  const res = await pool.query(`
    SELECT working_days, start_time, end_time
    FROM working_time
    WHERE id = 1
  `);

  return res.rows[0];
}

async function handleAlert(device, value, workingTime) {
  const alert = isAlert(device, value, null, workingTime);
  if (!alert) return;

  const last = await getLastAlert(device.name, alert.type);

  // ==========================
  // 🔹 คำนวณ % เปลี่ยนแปลง
  // ==========================
  let shouldSend = false;

  if (!last) {
    // ไม่เคยส่งมาก่อน → ส่ง
    shouldSend = true;
  } else {
    const diffPercent =
      Math.abs(value - last.value) / last.value * 100;

    // ⭐ กำหนด threshold ที่นี่
    if (diffPercent >= 50) {
      shouldSend = true;
    }

    // ⏳ cooldown ปกติ (เช่น 10 นาที)
    const diffMin = (Date.now() - last.time) / 1000 / 60;
    if (diffMin >= 10) {
      shouldSend = true;
    }
  }

  if (!shouldSend) {
    console.log("⏳ Alert suppressed (cooldown / small change)");
    return;
  }

  // ==========================
  // ✅ SAVE + SEND
  // ==========================
  await pool.query(`
    INSERT INTO alert_logs
    (device_name, data_type, alert_type, current_value, message)
    VALUES ($1,$2,$3,$4,$5)
  `, [
    device.name,
    device.dataType,
    alert.type,
    value,
    alert.message
  ]);

  await sendEmail(
    device.alert.emails,
    `PLC ALERT: ${device.name}`,
    alert.message + ` (value=${value})`
  );

  console.log("📧 ALERT SENT");
}

module.exports = { readPLC, writePLC , isWorkingTime };

