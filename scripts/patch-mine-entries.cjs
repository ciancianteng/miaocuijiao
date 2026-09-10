const fs = require("fs");
let h = fs.readFileSync("mine.html", "utf8");

const old = `'<div class="mine-quick" aria-label="常用功能">'+
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
          entryRow('orders','订单与服务')+`;

const neu = `'<div class="mine-quick" aria-label="常用功能">'+
            '<a href="orders.html"><span class="mine-quick-ico" aria-hidden="true">单</span><span class="mine-quick-label">订单</span></a>'+
            '<a href="messages.html"><span class="mine-quick-ico" aria-hidden="true">信</span><span class="mine-quick-label">消息</span></a>'+
            '<a href="support.html?start=1"><span class="mine-quick-ico" aria-hidden="true">客</span><span class="mine-quick-label">客服</span></a>'+
            '<a href="recharge.html"><span class="mine-quick-ico" aria-hidden="true">充</span><span class="mine-quick-label">充值</span></a>'+
          '</div>'+
          '<p class="mine-section-title">账户与服务</p>'+
          '<div class="entry-stack">'+
          entryRow('profile','编辑资料')+
          entryRow('assets','我的资产')+
          entryRow('security','账号安全')+
          entryRow('orders','订单与服务')+
          '<section class="entry"><a class="entry-trigger" href="messages.html"><span class="entry-title">消息中心</span><span class="entry-arrow" aria-hidden="true"></span></a></section>'+
          '<section class="entry"><a class="entry-trigger" href="points.html"><span class="entry-title">我的积分</span><span class="entry-arrow" aria-hidden="true"></span></a></section>'+
          '<section class="entry"><a class="entry-trigger" href="gifts.html"><span class="entry-title">礼物中心</span><span class="entry-arrow" aria-hidden="true"></span></a></section>'+
          '<section class="entry"><a class="entry-trigger" href="my-direct-companions.html"><span class="entry-title">直属陪玩</span><span class="entry-arrow" aria-hidden="true"></span></a></section>'+`;

if (!h.includes(old)) {
  console.error("paint block missing");
  process.exit(1);
}
h = h.replace(old, neu);
if (!h.includes(".entry a.entry-trigger")) {
  h = h.replace(
    ".entry-trigger{",
    ".entry a.entry-trigger{text-decoration:none;color:inherit;box-sizing:border-box}\n    .entry-trigger{"
  );
}
fs.writeFileSync("mine.html", h);
console.log("mine ok", {
  messages: (h.match(/messages\.html/g) || []).length,
  gifts: h.includes("gifts.html"),
});
