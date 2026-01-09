const { Pool } = require("pg");

const pool = new Pool({
  host: "dpg-d5g7khfpm1nc73e0netg-a.singapore-postgres.render.com",
  port: 5432,
  user: "vue_plc_postgres_db_user",      // แก้ตามเครื่องคุณ
  password: "XlPL0fsDtg8XqHSxTOCfQiphAkRucG2e",  // แก้ตามเครื่องคุณ
  database: "vue_plc_postgres_db",
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
