const { pool } = require("../db/pg");

async function getLastAlert(deviceName, alertType) {
  const result = await pool.query(`
    SELECT current_value, created_at
    FROM alert_logs
    WHERE device_name = $1
      AND alert_type = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [deviceName, alertType]);

  if (result.rows.length === 0) return null;

  return {
    value: Number(result.rows[0].current_value),
    time: new Date(result.rows[0].created_at)
  };
}

module.exports = { getLastAlert };
