import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './miao-coin.css';

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch (_error) {
    return {};
  }
}

function saveStore(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function stores() {
  return [readStore('mcjRealDB.v1'), readStore('mcjPlatformData.v1')];
}

function listFrom(...keys) {
  return stores().flatMap((store) => keys.flatMap((key) => Array.isArray(store[key]) ? store[key] : []));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `RM${num(value).toFixed(2)}`;
}

function currentUser() {
  return readStore('mcjCurrentUser') || readStore('mcj_user') || null;
}

function userIds(user) {
  if (!user) return [];
  return [user.id, user.user_id, user.customer_id, user.boss_id, user.uid, user.bossId].filter(Boolean).map(String);
}

function belongs(row, ids) {
  return ids.some((id) => [row.user_id, row.customer_id, row.boss_id, row.uid, row.owner_id].filter(Boolean).map(String).includes(id));
}

function walletFor(ids) {
  return listFrom('wallets', 'customerWallets', 'userWallets').find((row) => belongs(row, ids)) || {};
}

function packageRows() {
  const map = new Map();
  listFrom('catFoodPackages', 'rechargePackages', 'paymentPackages')
    .filter((row) => row && row.enabled !== false && row.status !== 'disabled' && row.status !== '下架')
    .forEach((row) => {
      const rm = num(row.rm || row.amount || row.price || row.paymentAmount);
      if (rm <= 0) return;
      const catFood = num(row.catFood || row.cat_food || row.coins || row.credits || row.arrivalAmount || rm);
      const id = row.id || `${rm}:${catFood}`;
      map.set(id, { id, rm, catFood, tag: row.tag || row.name || row.title || '充值套餐' });
    });
  return Array.from(map.values()).sort((a, b) => a.rm - b.rm);
}

function paymentRows() {
  return listFrom('payment_channels', 'paymentChannels', 'paymentMethods')
    .filter((row) => row && row.enabled !== false && row.status !== 'disabled' && row.status !== '停用')
    .map((row) => row.frontName || row.displayName || row.name || row.channelName || row.id)
    .filter(Boolean);
}

function rechargeRows(ids) {
  return listFrom('recharges', 'payment_transactions', 'paymentTransactions', 'walletTransactions')
    .filter((row) => belongs(row, ids) && /recharge|充值|catfood|猫粮/i.test(String(row.type || row.flowType || row.category || '')))
    .sort((a, b) => String(b.created_at || b.createdAt || b.time || '').localeCompare(String(a.created_at || a.createdAt || a.time || '')));
}

function CatFoodIcon({ size = 24 }) {
  return (
    <svg className="catfood-icon" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle className="coin-neon" cx="24" cy="24" r="18" />
      <circle className="coin-main" cx="24" cy="24" r="15" />
      <path className="paw-main" d="M19.2 28.8c1.8-3.4 3.1-4.8 4.8-4.8s3 1.4 4.8 4.8c1 1.9.1 4.1-2.2 4.1-1.3 0-1.8-.7-2.6-.7s-1.3.7-2.6.7c-2.3 0-3.2-2.2-2.2-4.1z" />
      <circle className="paw-pad" cx="17.8" cy="21.8" r="1.8" />
      <circle className="paw-pad" cx="22" cy="19" r="1.8" />
      <circle className="paw-pad" cx="26" cy="19" r="1.8" />
      <circle className="paw-pad" cx="30.2" cy="21.8" r="1.8" />
      <path className="spark" d="M35 11v4M33 13h4" />
    </svg>
  );
}

function App() {
  const user = currentUser();
  const ids = userIds(user);
  const wallet = walletFor(ids);
  const packages = packageRows();
  const payments = paymentRows();
  const records = rechargeRows(ids);
  const [selected, setSelected] = useState(packages[0] || null);
  const [custom, setCustom] = useState('');
  const [payment, setPayment] = useState(payments[0] || '');
  const [modal, setModal] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!selected && packages[0]) setSelected(packages[0]);
    if (!payment && payments[0]) setPayment(payments[0]);
  }, [packages, payments, selected, payment]);

  const amount = custom ? Math.max(0, num(custom)) : num(selected?.rm);
  const catFood = useMemo(() => Math.floor(custom ? amount : num(selected?.catFood)), [amount, custom, selected]);
  const balance = num(wallet.available_balance || wallet.availableBalance || wallet.catFoodBalance || wallet.balance || wallet.credits || user?.balance);

  function choose(pkg) {
    setSelected(pkg);
    setCustom('');
    setSubmitted(false);
  }

  function submitRecharge() {
    if (!amount || !payment) return;
    const orderNo = `MCJ-RC-${Date.now().toString(36).toUpperCase()}`;
    const entry = {
      id: orderNo,
      recharge_no: orderNo,
      user_id: user?.id || user?.user_id || '',
      customer_id: user?.customer_id || user?.id || '',
      boss_id: user?.boss_id || user?.bossId || '',
      amount,
      rm: amount,
      catFoodAmount: catFood,
      payment_method: payment,
      status: '待审核',
      type: '猫粮充值',
      created_at: new Date().toLocaleString('zh-CN', { hour12: false }),
    };
    ['mcjRealDB.v1', 'mcjPlatformData.v1'].forEach((key) => {
      const store = readStore(key);
      store.recharges = Array.isArray(store.recharges) ? store.recharges : [];
      store.recharges.unshift(entry);
      saveStore(key, store);
    });
    setSubmitted(true);
  }

  return (
    <main className="miao-page">
      <section className="miao-shell">
        <header className="miao-hero">
          <a className="miao-home" href="index.html">首页</a>
          <div className="miao-brand">
            <img src="assets/meow-cuijiao-brand.jpg" alt="Meow Cui Jiao" />
            <span>Meow Cui Jiao / 妙脆角电竞</span>
          </div>
          <h1>猫粮充值</h1>
          <p>选择后台启用的支付方式，为账户充值猫粮。</p>
          <div className="balance-card"><span>猫粮余额</span><CatFoodIcon size={24} /><strong>{Math.floor(balance)}</strong><b>猫粮</b></div>
        </header>

        <section className="miao-grid">
          <div className="miao-card recharge-card">
            <div className="section-title"><p>RECHARGE</p><h2>选择充值套餐</h2></div>
            <div className="package-grid">
              {packages.map((pkg) => (
                <button key={pkg.id} className={selected?.id === pkg.id && !custom ? 'active' : ''} onClick={() => choose(pkg)}>
                  <small>{pkg.tag}</small>
                  <strong>{money(pkg.rm)}</strong>
                  <span><CatFoodIcon size={16} /> {Math.floor(pkg.catFood)} 猫粮</span>
                </button>
              ))}
            </div>
            {!packages.length && <div className="empty-state">后台暂未配置充值套餐，可使用自定义金额提交充值申请。</div>}
            <label className="custom-box">
              <span>自定义充值金额</span>
              <div><b>RM</b><input value={custom} onChange={(e) => { setCustom(e.target.value); setSubmitted(false); }} type="number" min="1" placeholder="输入金额" /></div>
            </label>
          </div>

          <aside className="miao-card summary-card">
            <div className="section-title"><p>SUMMARY</p><h2>充值申请预览</h2></div>
            <div className="summary-line"><span>充值金额</span><b>{money(amount)}</b></div>
            <div className="summary-line"><span>预计到账</span><b><CatFoodIcon size={16} /> {catFood} 猫粮</b></div>
            <div className="payment-title">支付方式</div>
            <div className="payment-grid">
              {payments.map((name) => <button key={name} className={payment === name ? 'active' : ''} onClick={() => setPayment(name)}>{name}</button>)}
            </div>
            {!payments.length && <div className="empty-state">后台暂未启用支付方式，暂时不能提交充值申请。</div>}
            <button className="pay-now" disabled={!amount || !payment} onClick={() => { setModal(true); setSubmitted(false); }}>提交充值申请</button>
          </aside>
        </section>

        <section className="miao-card record-card">
          <div className="section-title"><p>HISTORY</p><h2>猫粮充值记录</h2></div>
          <div className="record-list">
            {records.map((r, index) => (
              <div className="record-row" key={r.id || r.recharge_no || index}>
                <span>{r.created_at || r.createdAt || r.time || '-'}</span><b>{money(r.amount || r.rm || r.paymentAmount)}</b><strong><CatFoodIcon size={16} /> {Math.floor(num(r.catFoodAmount || r.catFood || r.cat_food || r.coins || r.credits || r.amount))} 猫粮</strong><em>{r.statusLabel || r.status || '待审核'}</em>
              </div>
            ))}
          </div>
          {!records.length && <div className="empty-state">暂无猫粮充值记录。</div>}
        </section>
      </section>

      {modal && (
        <div className="miao-modal" onClick={() => setModal(false)}>
          <div className="miao-dialog" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setModal(false)}>×</button>
            <p className="modal-eyebrow">CONFIRM</p>
            <h2>提交充值申请</h2>
            <div className="confirm-list">
              <div><span>充值金额</span><b>{money(amount)}</b></div>
              <div><span>预计到账</span><b><CatFoodIcon size={16} /> {catFood} 猫粮</b></div>
              <div><span>支付方式</span><b>{payment}</b></div>
            </div>
            {submitted ? <div className="success-msg">充值申请已提交后台审核，审核通过后猫粮到账。</div> : <button className="pay-now" onClick={submitRecharge}>确认提交</button>}
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('miao-root')).render(<App />);
