module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!global.__mcjRechargeRequests) {
    global.__mcjRechargeRequests = [
      {
        id: "R001",
        user: "夜色老板",
        amount: "RM100",
        coins: "1000喵币",
        status: "待审核",
        channel: "TNG",
        proof_url: "assets/meow-cuijiao-brand.jpg",
        payment_proof: "assets/meow-cuijiao-brand.jpg",
        time: "2026-07-03 14:00",
        remark: "已打款至 TNG 账号"
      },
      {
        id: "R002",
        user: "Cheese老板",
        amount: "RM50",
        coins: "500喵币",
        status: "待审核",
        channel: "支付宝",
        proof_url: "assets/lianmiao-club-ad.png",
        payment_proof: "assets/lianmiao-club-ad.png",
        time: "2026-07-03 15:30",
        remark: "支付宝转账 50 元"
      },
      {
        id: "R003",
        user: "Moon老板",
        amount: "RM200",
        coins: "2000喵币",
        status: "成功",
        channel: "TNG",
        proof_url: "assets/homepage-cat-cover.png",
        payment_proof: "assets/homepage-cat-cover.png",
        time: "2026-07-02 11:20",
        remark: "已到账"
      }
    ];
  }

  const store = global.__mcjRechargeRequests;

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      data: store
    });
  }

  if (req.method === "POST") {
    const { action, id, reason, items } = req.body || {};

    if (Array.isArray(items)) {
      global.__mcjRechargeRequests = items;
      return res.status(200).json({ ok: true, data: global.__mcjRechargeRequests });
    }

    if (!id) {
      return res.status(400).json({ ok: false, message: "Missing recharge request id" });
    }

    let item = store.find((r) => r.id === id);
    if (!item) {
      item = {
        id,
        user: (req.body && req.body.user) || "老板",
        amount: (req.body && req.body.amount) || "RM100",
        coins: (req.body && req.body.coins) || "1000喵币",
        status: action === "approve" ? "成功" : "已拒绝",
        channel: (req.body && req.body.channel) || "TNG",
        proof_url: (req.body && (req.body.proof_url || req.body.payment_proof)) || "assets/meow-cuijiao-brand.jpg",
        payment_proof: (req.body && (req.body.proof_url || req.body.payment_proof)) || "assets/meow-cuijiao-brand.jpg",
        time: (req.body && req.body.time) || new Date().toLocaleString("zh-CN"),
        remark: reason || (action === "approve" ? "已审核通过" : "审核已被拒绝")
      };
      store.unshift(item);
    } else {
      if (action === "approve") {
        item.status = "成功";
        item.remark = "已审核通过，喵币已到账";
      } else if (action === "reject") {
        item.status = "已拒绝";
        item.remark = reason || "充值审核未通过";
      }
    }

    return res.status(200).json({ ok: true, message: action === "approve" ? "充值已通过" : "充值已拒绝", data: item });
  }

  return res.status(405).json({ ok: false, message: "Method not allowed" });
};
