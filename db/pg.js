const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",      // แก้ตามเครื่องคุณ
  password: "1234",  // แก้ตามเครื่องคุณ
  database: "plc",
});

async function logRead(device, value) {
  await pool.query(
    `INSERT INTO device_logs
     (device_name, data_type, address, action, value, created_at)
     VALUES ($1, $2, $3, 'READ', $4, NOW())`,
    [
      device.name,
      device.dataType,
      `${device.address.type}${device.address.start}`,
      String(value),
    ]
  );
}

async function logWrite(device, value) {
  const action = "WRITE";

  console.log(
    `[WRITE] ${new Date().toISOString()} | ${device.name} | ${device.dataType} | ${device.address.type}${device.address.start} | ${value}`
  );

  await pool.query(
    `INSERT INTO device_logs
     (device_name, data_type, address, action, value, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      device.name,
      device.dataType,
      `${device.address.type}${device.address.start}`,
      action,
      String(value),
    ]
  );
}


module.exports = { logRead , logWrite , pool };
