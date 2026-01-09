const express = require("express");
const cors = require("cors");
const { readPLC, writePLC , isWorkingTime} = require("./plc/plcClient");
const { pool } = require("./db/pg");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= READ ================= */
app.post("/api/read", async (req, res) => {
  const { device } = req.body;

  if (!device || !device.address) {
    return res.status(400).json({
      success: false,
      message: "device or address missing",
    });
  }
    
  try {
    const value = await readPLC(device);
    res.json({ success: true, value });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= WRITE ================= */
app.post("/api/write", async (req, res) => {
  const { device, value } = req.body;
  try {
    await writePLC(device, value);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/logs", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM device_logs ORDER BY created_at DESC LIMIT 1000"
  );
  res.json(result.rows);
});

/* ================= DEVICE LIST ================= */
app.get("/api/device/list", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        device_name,
        data_type
      FROM device_logs
      ORDER BY device_name
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// GET /api/logs/onoff
// app.get("/api/logs/onoff", async (req, res) => {
//   const { device, start, end } = req.query;

//   const rows = await pool.query(`
//     SELECT value, created_at
//     FROM device_logs
//     WHERE device_name = $1
//     AND created_at BETWEEN $2 AND $3
//     ORDER BY created_at
//   `, [device, start, end]);

//   res.json(rows.rows);
// });

app.get("/api/logs/onoff", async (req, res) => {
  const logs = await pool.query(
    `SELECT created_at, value
     FROM device_logs 
     WHERE device_name = $1
       AND created_at BETWEEN $2 AND $3
     ORDER BY created_at`,
    [req.query.device, req.query.start, req.query.end]
  );

  const wt = await pool.query(
    `SELECT working_days, start_time, end_time
     FROM working_time WHERE id = 1`
  );

  const config = wt.rows[0];

  const filtered = logs.rows.filter(l =>
    isWorkingTime(new Date(l.created_at), config)
  );

  res.json(filtered);
});


// GET /api/logs/analog
app.get("/api/logs/analog", async (req, res) => {
  const { device, start, end } = req.query;

  const result = await pool.query(`
    SELECT value, created_at
    FROM device_logs
    WHERE device_name = $1
      AND data_type = 'analog'
      AND created_at BETWEEN $2 AND $3
    ORDER BY created_at
  `, [device, start, end]);

  res.json(result.rows);
});

// GET /api/logs/number
app.get("/api/logs/number", async (req, res) => {
  const { device, start, end } = req.query;

  const result = await pool.query(`
    SELECT value, created_at
    FROM device_logs
    WHERE device_name = $1
      AND data_type = 'number'
      AND created_at BETWEEN $2 AND $3
    ORDER BY created_at
  `, [device, start, end]);

  res.json(result.rows);
});

// update working time (global)
app.put("/api/working-time", async (req, res) => {
  const { days, start, end } = req.body;

  await pool.query(
    `
    UPDATE working_time
    SET
      working_days = $1,
      start_time   = $2,
      end_time     = $3,
      updated_at   = NOW()
    WHERE id = 1
    `,
    [days, start, end]
  );

  res.json({ success: true });
});

// load working time
app.get("/api/working-time", async (req, res) => {
  const result = await pool.query(
    `SELECT working_days, start_time, end_time
     FROM working_time
     WHERE id = 1`
  );

  if (result.rows.length === 0) {
    return res.json(null);
  }

  const row = result.rows[0];

  res.json({
    days: row.working_days,
    start: row.start_time.slice(0, 5), // HH:mm
    end: row.end_time.slice(0, 5),     // HH:mm
  });
});


app.listen(3001, () => {
  console.log("PLC Backend running on port 3001");
});
