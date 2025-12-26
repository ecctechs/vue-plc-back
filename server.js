const express = require("express");
const cors = require("cors");
const { readPLC, writePLC } = require("./plc/plcClient");
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
      SELECT DISTINCT device_name
      FROM device_logs
      ORDER BY device_name
    `);

    res.json(result.rows.map(r => r.device_name));
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// GET /api/logs/onoff
app.get("/api/logs/onoff", async (req, res) => {
  const { device, start, end } = req.query;

  const rows = await pool.query(`
    SELECT value, created_at
    FROM device_logs
    WHERE device_name = $1
    AND created_at BETWEEN $2 AND $3
    ORDER BY created_at
  `, [device, start, end]);

  res.json(rows.rows);
});

app.listen(3001, () => {
  console.log("PLC Backend running on port 3001");
});
