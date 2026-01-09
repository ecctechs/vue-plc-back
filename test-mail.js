const { isAlert } = require("./alert/isAlert");
const { sendEmail } = require("./alert/sendEmail");
const { pool } = require("./db/pg");

// mock device
const device = {
  name: "TEST_PUMP",
  dataType: "number",
  alert: {
    enabled: true,
    upper: 80,
    lower: 20,
    emails: ["theerasak789900@gmail.com"], // 🔴 เปลี่ยนเป็นอีเมลจริง
  }
};

// mock working time (ถือว่าอยู่ในเวลางาน)
const workingTime = {
  working_days: ["mon","tue","wed","thu","fri","sat","sun"],
  start_time: "00:00",
  end_time: "23:59"
};

// mock value
const value = 95; // 🔥 เกิน upper → ต้อง alert

async function testAlert() {
  const alert = isAlert(device, value, null, workingTime);

  if (!alert) {
    console.log("❌ NO ALERT");
    return;
  }

  console.log("✅ ALERT TRIGGERED:", alert);

  // save log
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

  // send email
  await sendEmail(
    device.alert.emails,
    `PLC ALERT: ${device.name}`,
    alert.message
  );

  console.log("📧 EMAIL SENT + LOG SAVED");
  process.exit();
}

testAlert();
