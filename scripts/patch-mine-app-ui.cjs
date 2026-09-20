const fs = require("fs");
const path = "mine.html";
let html = fs.readFileSync(path, "utf8");

const cssExtra = `
    /* App-style mine polish (features preserved) */
    body{background:radial-gradient(ellipse 80% 40% at 50% -8%,rgba(255,126,189,.1),transparent 55%),#050505!important}
    .boss-shell{width:min(430px,calc(100% - 24px));padding:4px 0 calc(28px + env(safe-area-inset-bottom,0px))}
    .boss-id{gap:16px;padding:18px 16px;margin:0 0 16px;border-radius:20px;border:1px solid rgba(255,214,232,.14);background:linear-gradient(160deg,rgba(28,18,28,.95),rgba(10,10,12,.96));box-shadow:0 14px 36px rgba(0,0,0,.32)}
    .boss-id-avatar{width:64px;height:64px;flex-basis:64px;border:2px solid rgba(255,158,207,.35)}
    .boss-id-meta h1{font-size:20px}
    .boss-stats{gap:8px}
    .boss-stat{min-height:64px;border-radius:14px;padding:10px 12px;border-color:rgba(255,214,232,.16);background:rgba(255,255,255,.03)}
    .boss-stat-value{font-size:20px}
    .mine-quick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 16px}
    .mine-quick a,.mine-quick button{
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
      min-height:72px;padding:10px 4px;border-radius:16px;border:1px solid rgba(255,214,232,.12);
      background:rgba(255,255,255,.03);color:#fff8fc;text-decoration:none;font:inherit;cursor:pointer;
      -webkit-tap-highlight-color:transparent;
    }
    .mine-quick-ico{width:28px;height:28px;border-radius:10px;display:grid;place-items:center;background:rgba(255,158,207,.12);font-size:14px}
    .mine-quick-label{font-size:11px;font-weight:700;letter-spacing:.02em;color:rgba(255,232,242,.82)}
    .mine-section-title{margin:4px 2px 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:rgba(255,214,232,.45);text-transform:uppercase}
    .entry-stack{gap:10px}
    .entry{border-radius:16px;border-color:rgba(255,214,232,.12);background:rgba(12,10,16,.92);box-shadow:none}
    .entry-trigger{min-height:56px;height:56px;padding:0 14px;font-size:15px}
    .entry-arrow{width:26px;height:26px;flex-basis:26px;border-color:rgba(255,214,232,.22)}
    .empty-card{border-radius:18px;border-color:rgba(255,214,232,.14);background:rgba(14,12,18,.94)}
`;

if (!html.includes("mine-quick{display:grid")) {
  html = html.replace("    .review-tip{margin:0 0 14px;", cssExtra + "\n    .review-tip{margin:0 0 14px;");
}

const paintStartRe = /root\.innerHTML=tipHtml\+[\s\S]*?'<div class="mine-logout-wrap"><button class="mine-logout" type="button" data-logout>退出登录<\/button><\/div>';/;
const newPaint = `root.innerHTML=tipHtml+
          '<section class="boss-id">'+
            '<div class="boss-id-top">'+
              '<div class="boss-id-avatar">'+avatarHtml(u)+'</div>'+
              '<div class="boss-id-meta">'+
                '<h1>'+esc(u.displayName||'老板账号')+'</h1>'+
                '<p>老板 UID '+esc(publicUid)+'</p>'+
              '</div>'+
            '</div>'+
            '<div class="boss-stats">'+
              '<a class="boss-stat" href="points.html"><span class="boss-stat-label">积分</span><strong class="boss-stat-value">'+esc(pointsBal)+'</strong></a>'+
              '<a class="boss-stat" href="my-direct-companions.html"><span class="boss-stat-label">直属</span><strong class="boss-stat-value">'+esc(directCount)+'</strong></a>'+
            '</div>'+
          '</section>'+
          (setHint?'<p style="margin:0 0 14px;color:#fbbf24;font-size:12px;line-height:1.45">'+esc(setHint)+'</p>':'')+
          '<div class="mine-quick" aria-label="常用功能">'+
            '<a href="orders.html"><span class="mine-quick-ico" aria-hidden="true">单</span><span class="mine-quick-label">订单</span></a>'+
            '<a href="support.html?start=1"><span class="mine-quick-ico" aria-hidden="true">客</span><span class="mine-quick-label">客服</span></a>'+
            '<a href="recharge.html"><span class="mine-quick-ico" aria-hidden="true">充</span><span class="mine-quick-label">充值</span></a>'+
            '<a href="points.html"><span class="mine-quick-ico" aria-hidden="true">分</span><span class="mine-quick-label">积分</span></a>'+
          '</div>'+
          '<p class="mine-section-title">账户与服务</p>'+
          '<div class="entry-stack">'+
          entryRow('profile','编辑资料')+
          entryRow('assets','我的资产')+
          entryRow('security','账号安全')+
          entryRow('orders','订单与服务')+
          '</div>'+
          '<div class="mine-logout-wrap"><button class="mine-logout" type="button" data-logout>退出登录</button></div>';`;

if (!paintStartRe.test(html)) {
  console.error("paint block not found");
  process.exit(1);
}
html = html.replace(paintStartRe, newPaint);

html = html.replace("正在登录…", "加载中…");

if (!html.includes("function fetchWithTimeout")) {
  html = html.replace(
    "function token(){try{return sessionStorage.getItem('mcjAuthAccessToken')||localStorage.getItem('mcjAuthAccessToken')||''}catch(e){return ''}}",
    `function token(){try{return sessionStorage.getItem('mcjAuthAccessToken')||localStorage.getItem('mcjAuthAccessToken')||''}catch(e){return ''}}
      function fetchWithTimeout(url,opts,ms){
        var ctrl=typeof AbortController!=='undefined'?new AbortController():null;
        var timer=setTimeout(function(){try{ctrl&&ctrl.abort()}catch(e){}},ms||10000);
        var o=Object.assign({},opts||{});
        if(ctrl)o.signal=ctrl.signal;
        return fetch(url,o).finally(function(){clearTimeout(timer)});
      }`
  );
}

html = html.replace(
  "var res=await fetch('/api/auth?action=me',{headers:{Authorization:'Bearer '+token()}});",
  "var res=await fetchWithTimeout('/api/auth?action=me',{headers:{Authorization:'Bearer '+token()},cache:'no-store'},10000);"
);

if (!html.includes("AbortError")) {
  html = html.replace(
    "var msg=String(err&&err.message||'账号资料读取失败');",
    "var msg=String((err&&err.name==='AbortError')?'加载超时，请重试':(err&&err.message)||'账号资料读取失败');"
  );
}

fs.writeFileSync(path, html);
console.log("mine.html updated", {
  hasQuick: html.includes("mine-quick"),
  hasTimeout: html.includes("fetchWithTimeout"),
  loadingCopy: html.includes("加载中…"),
  noLoginCopy: !html.includes("正在登录…"),
});
