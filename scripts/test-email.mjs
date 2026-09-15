/**
 * 邮件发送测试脚本
 * 用法: node scripts/test-email.mjs [recipient]
 * 默认收件人: dddamienw@gmail.com
 *
 * 直接读取 .env.local 中的 SMTP 配置，用 nodemailer 发送测试邮件。
 * 用于验证 SMTP 配置是否正确（排查 553 等错误）。
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 读取 .env.local
function loadEnv() {
  const envPath = resolve(__dirname, "../.env.local");
  const content = readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const recipient = process.argv[2] || "dddamienw@gmail.com";

const smtpHost = env.SMTP_HOST;
const smtpPort = Number(env.SMTP_PORT) || 465;
const smtpUser = env.SMTP_USER;
const smtpPass = env.SMTP_PASS;
// 同 resolveTransporter 逻辑：SMTP_FROM 非法时回退到 SMTP_USER
const smtpFrom = env.SMTP_FROM && env.SMTP_FROM.includes("@") ? env.SMTP_FROM : smtpUser;

console.log("=== 邮件发送测试 ===");
console.log(`SMTP Host:   ${smtpHost}`);
console.log(`SMTP Port:   ${smtpPort}`);
console.log(`SMTP User:   ${smtpUser}`);
console.log(`SMTP From:   ${smtpFrom}`);
console.log(`Recipient:   ${recipient}`);
console.log();

if (!smtpHost || !smtpUser || !smtpPass) {
  console.error("❌ 缺少 SMTP 配置，请检查 .env.local 中的 SMTP_HOST / SMTP_USER / SMTP_PASS");
  process.exit(1);
}

console.log(`From (resolved): ${smtpFrom}`);
console.log();

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: { user: smtpUser, pass: smtpPass },
});

try {
  console.log("正在发送...");
  const info = await transporter.sendMail({
    from: smtpFrom,
    to: recipient,
    subject: `[PKUSO] 邮件发送测试 - ${new Date().toLocaleString("zh-CN")}`,
    html: `
      <div style="font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a237e; margin-bottom: 16px;">邮件发送测试成功</h2>
        <p>如果你收到这封邮件，说明 SMTP 配置正确。</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; color: #666;">发件人</td><td style="padding: 8px;">${smtpFrom}</td></tr>
          <tr><td style="padding: 8px; color: #666;">SMTP 服务器</td><td style="padding: 8px;">${smtpHost}:${smtpPort}</td></tr>
          <tr><td style="padding: 8px; color: #666;">发送时间</td><td style="padding: 8px;">${new Date().toLocaleString("zh-CN")}</td></tr>
        </table>
        <p style="color: #999; font-size: 12px;">—— PKUSO 管理系统</p>
      </div>
    `,
  });
  console.log("✅ 发送成功！");
  console.log(`   Message ID: ${info.messageId}`);
} catch (err) {
  console.error("❌ 发送失败:");
  console.error(`   ${err.message}`);
  if (err.code) console.error(`   Code: ${err.code}`);
  if (err.command) console.error(`   Command: ${err.command}`);
  process.exit(1);
}
