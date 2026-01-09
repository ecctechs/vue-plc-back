const nodemailer = require("nodemailer");
require("dotenv").config(); // ⭐ สำคัญมาก

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false, // 587 = false
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

async function sendEmail(to, subject, text) {
  const receivers = Array.isArray(to) ? to.join(",") : to;

  await transporter.sendMail({
    from: `"PLC Alert" <${process.env.SMTP_USER}>`,
    to: receivers,
    subject,
    text,
  });
}

module.exports = { sendEmail };
