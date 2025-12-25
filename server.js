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

app.post("/api/chart/line", async (req, res) => {
  const { device_name, from, to } = req.body;

  const result = await pool.query(
    `
    SELECT created_at, value
    FROM device_logs
    WHERE device_name = $1
      AND action = 'READ'
      AND created_at BETWEEN $2 AND $3
    ORDER BY created_at ASC
    `,
    [device_name, from, to]
  );

  res.json(result.rows);
});


app.listen(3001, () => {
  console.log("PLC Backend running on port 3001");
});
