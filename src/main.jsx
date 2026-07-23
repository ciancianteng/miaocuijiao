import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const games = ['CS2', 'VALORANT', 'APEX', 'Delta Force', 'LOL', 'PUBG'];
const players = [
  { name: '喵喵', game: 'VALORANT', price: 'RM25/小时r', rating: '4.9' },
  { name: '小白猫', game: 'APEX', price: 'RM35/小时r', rating: '5.0' },
  { name: '奶油', game: 'CS2', price: 'RM20/小时r', rating: '4.8' },
];

function App() {
  return (
    <main>
      <nav className="nav">
        <div className="brand">Meow Cui Jiao</div>
        <div className="links">
          <a>HOME</a><a>GAMES</a><a>PLAYERS</a><a>ORDER</a><a>CONTACT</a>
        </div>
        <button className="login">LOGIN</button>
      </nav>

      <section className="hero">
        <div className="glow glow1" />
        <div className="glow glow2" />
        <div className="mascot">🤍</div>
        <p className="eyebrow">MCJ GAMING CLUB</p>
        <h1>Meow Cui Jiao<br />Gaming Club</h1>
        <p className="slogan">Play Together. Win Together.</p>
        <div className="actions">
          <button className="primary">我要找陪玩</button>
          <button className="secondary">我要成为陪玩</button>
        </div>
        <div className="stats">
          <span>🐾 在线陪玩 128</span>
          <span>🎮 今日订单 865</span>
          <span>⭐ 平均评分 4.97</span>
        </div>
      </section>

      <section className="section">
        <h2>热门游戏</h2>
        <div className="grid games">
          {games.map((g) => <div className="card game" key={g}>🎮<strong>{g}</strong></div>)}
        </div>
      </section>

      <section className="section">
        <h2>热门陪玩</h2>
        <div className="grid players">
          {players.map((p) => (
            <div className="card player" key={p.name}>
              <div className="avatar">{p.name.slice(0, 1)}</div>
              <h3>{p.name}</h3>
              <p>{p.game}</p>
              <p>⭐ {p.rating}</p>
              <strong>{p.price}</strong>
              <button>立即下单</button>
            </div>
          ))}
        </div>
      </section>

      <section className="section why">
        <h2>为什么选择我们</h2>
        <div className="grid">
          <div className="card">✅ 官方认证陪玩</div>
          <div className="card">⚡ 快速接单</div>
          <div className="card">🔒 安全交易</div>
          <div className="card">💬 24小时客服</div>
        </div>
      </section>

      <footer>© 2026 Meow Cui Jiao Gaming Club · Powered by Cats</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

