const fs = require("fs");
const path = require("path");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".vercel", ".git"].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".html")) out.push(p);
  }
  return out;
}

function writeUtf8NoBom(file, text) {
  fs.writeFileSync(file, Buffer.from(text, "utf8"));
}

function stripBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3);
  }
  return buf;
}

function decodeLoose(buf) {
  buf = stripBom(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return Buffer.from(buf).toString("utf8");
  }
}

// PowerShell Set-Content truncated trailing UTF-8 bytes of Chinese chars into � / �?
const fixes = [
  ["超级管理员后�?", "超级管理员后台"],
  ["超级管理员后�", "超级管理员后台"],
  ["超级管理员菜�?", "超级管理员菜单"],
  ["超级管理员菜�", "超级管理员菜单"],
  ["超级管理�?", "超级管理员"],
  ["超级管理�", "超级管理员"],
  ["控制�?", "控制台"],
  ["控制�", "控制台"],
  ["提现与发�?", "提现与发放"],
  ["提现与发�", "提现与发放"],
  ["充值活�?", "充值活动"],
  ["充值活�", "充值活动"],
  ["人气榜设�?", "人气榜设置"],
  ["人气榜设�", "人气榜设置"],
  ["工作�?", "工作台"],
  ["工作�", "工作台"],
  ["退出登�?", "退出登录"],
  ["退出登�", "退出登录"],
  ["待处理事�?", "待处理事项"],
  ["待处理事�", "待处理事项"],
  ["最近操作记�?", "最近操作记录"],
  ["最近操作记�", "最近操作记录"],
  ["充值活动管�?", "充值活动管理"],
  ["充值活动管�", "充值活动管理"],
  ["猫粮充值记�?", "猫粮充值记录"],
  ["猫粮充值记�", "猫粮充值记录"],
  ["猫粮充�?", "猫粮充值"],
  ["猫粮充�", "猫粮充值"],
  ["退款管�?", "退款管理"],
  ["退款管�", "退款管理"],
  ["抽成与返点设�?", "抽成与返点设置"],
  ["抽成与返点设�", "抽成与返点设置"],
  ["广告位管�?", "广告位管理"],
  ["广告位管�", "广告位管理"],
  ["喵管家管�?", "喵管家管理"],
  ["喵管家管�", "喵管家管理"],
  ["自定义订单设�?", "自定义订单设置"],
  ["自定义订单设�", "自定义订单设置"],
  ["可接单时间配�?", "可接单时间配置"],
  ["可接单时间配�", "可接单时间配置"],
  ["徽章 / 身份组管�?", "徽章 / 身份组管理"],
  ["徽章 / 身份组管�", "徽章 / 身份组管理"],
  ["敏感密钥仅服务端管理�?", "敏感密钥仅服务端管理。"],
  ["敏感密钥仅服务端管理�", "敏感密钥仅服务端管理。"],
  ["陪玩工作�?", "陪玩工作台"],
  ["陪玩工作�", "陪玩工作台"],
  ["陪玩�?", "陪玩端"],
  ["陪玩�", "陪玩端"],
  ["资料认证与押�?", "资料认证与押金"],
  ["资料认证与押�", "资料认证与押金"],
  ["正在打开客服工作�?", "正在打开客服工作台"],
  ["正在打开客服工作�", "正在打开客服工作台"],
  ["客服端登�?", "客服端登录"],
  ["客服端登�", "客服端登录"],
  ["客服�?", "客服端"],
  ["客服�", "客服端"],
  ["妙脆�?", "妙脆角"],
  ["妙脆�", "妙脆角"],
  ["使用后台创建的客服账号登�?", "使用后台创建的客服账号登录"],
  ["使用后台创建的客服账号登�", "使用后台创建的客服账号登录"],
  ["请输入客服邮�?", "请输入客服邮箱"],
  ["请输入客服邮�", "请输入客服邮箱"],
  ["显示或隐藏密�?", "显示或隐藏密码"],
  ["显示或隐藏密�", "显示或隐藏密码"],
  ["本页面不提供注册入口�?", "本页面不提供注册入口。"],
  ["本页面不提供注册入口�", "本页面不提供注册入口。"],
];

fixes.sort((a, b) => b[0].length - a[0].length);

const changed = [];
const stillBad = [];

for (const file of walk(".")) {
  const raw = fs.readFileSync(file);
  let text = decodeLoose(raw);
  const before = text;
  for (const [from, to] of fixes) {
    if (text.includes(from)) text = text.split(from).join(to);
  }
  text = text.replace(
    /placeholder="请输入客服邮箱 spellcheck="false"/g,
    'placeholder="请输入客服邮箱" spellcheck="false"'
  );

  const hadBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  if (text !== before || hadBom) {
    writeUtf8NoBom(file, text);
    changed.push(path.relative(".", file).replace(/\\/g, "/"));
  } else {
    // ensure no BOM even if content unchanged
    const stripped = stripBom(raw);
    if (stripped.length !== raw.length) {
      fs.writeFileSync(file, stripped);
      changed.push(path.relative(".", file).replace(/\\/g, "/") + " (bom-strip)");
    }
  }

  const out = fs.readFileSync(file);
  let ok = true;
  let reason = "";
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(out);
    if (t.includes("\uFFFD")) {
      ok = false;
      reason = "still-has-FFFD";
      const idx = t.indexOf("\uFFFD");
      reason += " @" + idx + " " + JSON.stringify(t.slice(Math.max(0, idx - 16), idx + 16));
    }
    if (out.length >= 3 && out[0] === 0xef && out[1] === 0xbb && out[2] === 0xbf) {
      ok = false;
      reason = "still-has-BOM";
    }
  } catch (e) {
    ok = false;
    reason = "invalid-utf8";
  }
  if (!ok) stillBad.push(path.relative(".", file).replace(/\\/g, "/") + " " + reason);
}

console.log("CHANGED", changed.length);
changed.forEach((f) => console.log("  " + f));
console.log("STILL_BAD", stillBad.length);
stillBad.forEach((f) => console.log("  " + f));
