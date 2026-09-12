import fs from "node:fs";

let s = fs.readFileSync("index.html", "utf8");

if (!s.includes("src/mcj-countries.js")) {
  s = s.replace(
    '<script src="src/role-gates.js"></script>',
    '<script src="src/mcj-countries.js"></script>\n  <script src="src/i18n-stub.js"></script>\n  <script src="src/role-gates.js"></script>'
  );
}

if (!s.includes('id="registerCountry"')) {
  const re =
    /var registerPanel = '<div class="login-panel'\+\(mode==='register'\?' active':''\)\+'" data-login-panel="register" data-auth-panel="register"><label class="wide">昵称[\s\S]*?<button class="login-submit" type="button" data-register-confirm>注册<\/button><\/div>';/;
  const replacement =
    "var countryOptions = (window.MCJCountries && typeof window.MCJCountries.optionHtml === 'function')\n" +
    "        ? window.MCJCountries.optionHtml('MY')\n" +
    "        : '<option value=\"MY\" data-dial=\"+60\" selected>🇲🇾 马来西亚 (+60)</option><option value=\"CN\" data-dial=\"+86\">🇨🇳 中国 (+86)</option><option value=\"SG\" data-dial=\"+65\">🇸🇬 新加坡 (+65)</option><option value=\"TW\" data-dial=\"+886\">🇹🇼 台湾 (+886)</option><option value=\"HK\" data-dial=\"+852\">🇭🇰 香港 (+852)</option>';\n" +
    "      var registerPanel = '<div class=\"login-panel'+(mode==='register'?' active':'')+'\" data-login-panel=\"register\" data-auth-panel=\"register\"><label class=\"wide\">昵称<input id=\"registerNickname\" type=\"text\" autocomplete=\"nickname\" placeholder=\"请输入昵称\" maxlength=\"40\"></label><label class=\"wide\">邮箱<input id=\"registerEmail\" type=\"email\" autocomplete=\"email\" placeholder=\"请输入邮箱\"></label><label class=\"wide\">国家 / 地区<select id=\"registerCountry\">'+countryOptions+'</select></label><label class=\"wide\">区号<input id=\"registerDialCode\" type=\"text\" value=\"+60\" readonly tabindex=\"-1\"></label><label class=\"wide\">手机号（建议填写）<input id=\"registerPhone\" type=\"tel\" inputmode=\"tel\" autocomplete=\"tel-national\" placeholder=\"不含区号的本地号码\"></label><p class=\"muted\" style=\"margin:0;font-size:12px\">全球老板可注册 · 默认马来西亚 (+60)</p><label class=\"wide\">密码<input id=\"registerPassword\" type=\"password\" autocomplete=\"new-password\" placeholder=\"至少 6 位密码\"></label><label class=\"wide\">确认密码<input id=\"registerPasswordConfirm\" type=\"password\" autocomplete=\"new-password\" placeholder=\"再次输入密码\"></label><button class=\"login-submit\" type=\"button\" data-register-confirm>注册</button></div>';";
  if (!re.test(s)) {
    console.error("registerPanel pattern not found");
    process.exit(1);
  }
  s = s.replace(re, replacement);
}

fs.writeFileSync("index.html", s);
console.log({
  countries: s.includes("src/mcj-countries.js"),
  registerCountry: s.includes('id="registerCountry"'),
  registerPhone: s.includes('id="registerPhone"'),
  overflowY: /is-auth-dialog\{[^}]*overflow-y:auto/.test(s),
});
