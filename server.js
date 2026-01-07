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

// app.get("/api/logs/onoff", async (req, res) => {
//   const logs = await pool.query(
//     `SELECT created_at, value
//      FROM device_logs 
//      WHERE device_name = $1
//        AND created_at BETWEEN $2 AND $3
//      ORDER BY created_at`,
//     [req.query.device, req.query.start, req.query.end]
//   );

//   const wt = await pool.query(
//     `SELECT working_days, start_time, end_time
//      FROM working_time WHERE id = 1`
//   );

//   const config = wt.rows[0];

//   const filtered = logs.rows.filter(l =>
//     isWorkingTime(new Date(l.created_at), config)
//   );

//   res.json(filtered);
// });


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

// on-off performance
app.get("/api/performance", async (req, res) => {
  const { device, start, end, group = "day" } = req.query;

  if (!device || !start || !end) {
    return res.status(400).json({ message: "missing params" });
  }

  /* ===== 1. Load logs ===== */
  const logsResult = await pool.query(
    `
    SELECT value, created_at
    FROM device_logs
    WHERE device_name = $1
      AND data_type = 'on/off'
      AND created_at BETWEEN $2 AND $3
    ORDER BY created_at
    `,
    [device, start, end]
  );

  /* ===== 2. Load working time ===== */
  const wt = await pool.query(`
    SELECT working_days, start_time, end_time
    FROM working_time
    WHERE id = 1
  `);

  const workingConfig = wt.rows[0];

  /* ===== 3. Filter by working time ===== */
  const validLogs = logsResult.rows.filter(l =>
    isWorkingTime(new Date(l.created_at), workingConfig)
  );

  /* ===== 4. Create buckets ===== */
  const buckets = createBuckets(new Date(start), new Date(end), group);

  /* ===== 5. Fill buckets ===== */
  validLogs.forEach(l => {
    const d = new Date(l.created_at);
    const key = getBucketKey(d, group);

    if (!buckets[key]) return;

    if (l.value === "ON")  buckets[key].on++;
    if (l.value === "OFF") buckets[key].off++;
  });

  /* ===== 6. Calculate % ===== */
  const result = Object.values(buckets).map(b => {
    const total = b.on + b.off;
    return {
      period: b.label,
      onPercent: total ? +(b.on / total * 100).toFixed(2) : 0,
      offPercent: total ? +(b.off / total * 100).toFixed(2) : 0,
      samples: total,
    };
  });

  res.json(result);
});

function pad(n) {
  return String(n).padStart(2, "0");
}

/* ===== Create full bucket list ===== */
function createBuckets(start, end, group) {
  const buckets = {};
  const d = new Date(start);

  if (group === "hour") {
    // ครบ 24 ชั่วโมง (ใช้วันแรก)
    for (let h = 0; h < 24; h++) {
      const label = `${pad(h)}:00`;
      buckets[label] = { label, on: 0, off: 0 };
    }
  }

  if (group === "day") {
    while (d <= end) {
      const label = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      buckets[label] = { label, on: 0, off: 0 };
      d.setDate(d.getDate() + 1);
    }
  }

  if (group === "week") {
    while (d <= end) {
      const year = d.getFullYear();
      const week = getISOWeek(d);
      const label = `${year}-W${week}`;
      buckets[label] = { label, on: 0, off: 0 };
      d.setDate(d.getDate() + 7);
    }
  }

  if (group === "month") {
    while (d <= end) {
      const label = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
      buckets[label] = { label, on: 0, off: 0 };
      d.setMonth(d.getMonth() + 1);
    }
  }

  return buckets;
}

/* ===== Map log time → bucket ===== */
function getBucketKey(d, group) {
  if (group === "hour") return `${pad(d.getHours())}:00`;
  if (group === "day")
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  if (group === "week")
    return `${d.getFullYear()}-W${getISOWeek(d)}`;
  if (group === "month")
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
}

/* ===== ISO week ===== */
function getISOWeek(date) {
  const d = new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ===== ANALOG PERFORMANCE =====
app.get("/api/performance/analog", async (req, res) => {
  const { device, start, end, group = "day" } = req.query;

  if (!device || !start || !end) {
    return res.status(400).json({ message: "missing params" });
  }

  /* 1. Load logs */
  const logsResult = await pool.query(
    `
    SELECT value, created_at
    FROM device_logs
    WHERE device_name = $1
      AND data_type = 'analog'
      AND created_at BETWEEN $2 AND $3
    ORDER BY created_at
    `,
    [device, start, end]
  );

  /* 2. Create buckets */
  const buckets = createAnalogBuckets(new Date(start), new Date(end), group);

  /* 3. Fill buckets */
  logsResult.rows.forEach(l => {
    const d = new Date(l.created_at);
    const key = getBucketKey(d, group);

    if (!buckets[key]) return;

    const v = Number(l.value);
    if (Number.isNaN(v)) return;

    buckets[key].values.push(v);
  });

  /* 4. Calculate */
  const result = Object.values(buckets).map(b => {
    if (!b.values.length) {
      return {
        period: b.label,
        avg: null,
        min: null,
        max: null,
        samples: 0,
      };
    }

    const sum = b.values.reduce((a, c) => a + c, 0);
    return {
      period: b.label,
      avg: +(sum / b.values.length).toFixed(2),
      min: Math.min(...b.values),
      max: Math.max(...b.values),
      samples: b.values.length,
    };
  });

  res.json(result);
});

function createAnalogBuckets(start, end, group) {
  const buckets = {};
  const d = new Date(start);

  if (group === "hour") {
    for (let h = 0; h < 24; h++) {
      const label = `${pad(h)}:00`;
      buckets[label] = { label, values: [] };
    }
  }

  if (group === "day") {
    while (d <= end) {
      const label = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      buckets[label] = { label, values: [] };
      d.setDate(d.getDate() + 1);
    }
  }

  if (group === "week") {
    while (d <= end) {
      const label = `${d.getFullYear()}-W${getISOWeek(d)}`;
      buckets[label] = { label, values: [] };
      d.setDate(d.getDate() + 7);
    }
  }

  if (group === "month") {
    while (d <= end) {
      const label = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
      buckets[label] = { label, values: [] };
      d.setMonth(d.getMonth() + 1);
    }
  }

  return buckets;
}

// ===== NUMBER PERFORMANCE =====
app.get("/api/performance/number", async (req, res) => {
  const { device, start, end, group = "day" } = req.query;

  if (!device || !start || !end) {
    return res.status(400).json({ message: "missing params" });
  }

  const logsResult = await pool.query(
    `
    SELECT value, created_at
    FROM device_logs
    WHERE device_name = $1
      AND data_type = 'number'
      AND created_at BETWEEN $2 AND $3
    ORDER BY created_at
    `,
    [device, start, end]
  );

  const buckets = createAnalogBuckets(new Date(start), new Date(end), group);

  logsResult.rows.forEach(l => {
    const d = new Date(l.created_at);
    const key = getBucketKey(d, group);

    if (!buckets[key]) return;

    const v = Number(l.value);
    if (Number.isNaN(v)) return;

    buckets[key].values.push(v);
  });

  const result = Object.values(buckets).map(b => {
    if (!b.values.length) {
      return {
        period: b.label,
        avg: null,
        min: null,
        max: null,
        samples: 0,
      };
    }

    const sum = b.values.reduce((a, c) => a + c, 0);
    return {
      period: b.label,
      avg: +(sum / b.values.length).toFixed(2),
      min: Math.min(...b.values),
      max: Math.max(...b.values),
      samples: b.values.length,
    };
  });

  res.json(result);
});


app.listen(3001, () => {
  console.log("PLC Backend running on port 3001");
});
