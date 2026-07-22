import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './miao-coin.css';

const PACKAGES = [
  { rm: 10, coins: 100, tag: '轻量补给' },
  { rm: 30, coins: 300, tag: '热门选择' },
  { rm: 50, coins: 500, tag: '老板常用' },
  { rm: 100, coins: 1000, tag: '高能储备' },
];

const PAYMENTS = ['Touch n Go', 'FPX', 'GrabPay', 'DuitNow', '银行卡'];
const DEFAULT_RECORDS = [
  { time: '2026-07-01 14:20', rm: 30, coins: 300, status: '成功' },
  { time: '2026-06-30 22:18', rm: 10, coins: 100, status: '成功' },
  { time: '2026-06-29 19:06', rm: 50, coins: 500, status: '成功' },
];

function makeOrderId() {
  return 'MCJ-C' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10);
}

function App() {
  const [selected, setSelected] = useState(PACKAGES[1]);
  const [custom, setCustom] = useState('');
  const [payment, setPayment] = useState(PAYMENTS[0]);
  const [modal, setModal] = useState(false);
  const [success, setSuccess] = useState(false);
  const [balance, setBalance] = useState(320);
  const [records, setRecords] = useState(DEFAULT_RECORDS);
  const amount = custom ? Math.max(1, Number(custom) || 0) : selected.rm;
  const coins = useMemo(() => Math.round(amount * 10), [amount]);
  const orderId = useMemo(() => makeOrderId(), [modal]);

  function choose(pkg) {
    setSelected(pkg);
    setCustom('');
    setSuccess(false);
  }

  function pay() {
    const newRecord = {
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      rm: amount,
      coins,
      status: '成功',
    };
    setBalance((n) => n + coins);
    setRecords((list) => [newRecord, ...list].slice(0, 6));
    setSuccess(true);
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
          <h1>喵币充值中心</h1>
          <p>RM1 = 10 喵币，用于下单、送礼、盲盒派单和专属互动。</p>
          <div className="balance-card"><span>当前余额</span><strong>{balance}</strong><b>喵币</b></div>
        </header>

        <section className="miao-grid">
          <div className="miao-card recharge-card">
            <div className="section-title"><p>RECHARGE</p><h2>选择充值套餐</h2></div>
            <div className="package-grid">
              {PACKAGES.map((pkg) => (
                <button key={pkg.rm} className={selected.rm === pkg.rm && !custom ? 'active' : ''} onClick={() => choose(pkg)}>
                  <small>{pkg.tag}</small>
                  <strong>RM{pkg.rm}</strong>
                  <span>{pkg.coins} 喵币</span>
                </button>
              ))}
            </div>
            <label className="custom-box">
              <span>自定义充值金额</span>
              <div><b>RM</b><input value={custom} onChange={(e) => { setCustom(e.target.value); setSuccess(false); }} type="number" min="1" placeholder="输入金额" /></div>
            </label>
          </div>

          <aside className="miao-card summary-card">
            <div className="section-title"><p>SUMMARY</p><h2>订单预览</h2></div>
            <div className="summary-line"><span>应付金额</span><b>RM{amount}</b></div>
            <div className="summary-line"><span>到账喵币</span><b>{coins} 喵币</b></div>
            <div className="payment-title">支付方式</div>
            <div className="payment-grid">
              {PAYMENTS.map((name) => <button key={name} className={payment === name ? 'active' : ''} onClick={() => setPayment(name)}>{name}</button>)}
            </div>
            <button className="pay-now" onClick={() => { setModal(true); setSuccess(false); }}>立即充值</button>
          </aside>
        </section>

        <section className="miao-card record-card">
          <div className="section-title"><p>HISTORY</p><h2>充值记录</h2></div>
          <div className="record-list">
            {records.map((r, index) => (
              <div className="record-row" key={index}>
                <span>{r.time}</span><b>RM{r.rm}</b><strong>{r.coins} 喵币</strong><em>{r.status}</em>
              </div>
            ))}
          </div>
        </section>
      </section>

      {modal && (
        <div className="miao-modal" onClick={() => setModal(false)}>
          <div className="miao-dialog" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setModal(false)}>×</button>
            <p className="modal-eyebrow">PAYMENT CONFIRM</p>
            <h2>付款确认</h2>
            <div className="confirm-list">
              <div><span>充值金额</span><b>RM{amount}</b></div>
              <div><span>到账喵币</span><b>{coins} 喵币</b></div>
              <div><span>支付方式</span><b>{payment}</b></div>
              <div><span>订单编号</span><b>{orderId}</b></div>
            </div>
            {success ? <div className="success-msg">充值成功，喵币已到账</div> : <button className="pay-now" onClick={pay}>模拟付款成功</button>}
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('miao-root')).render(<App />);
