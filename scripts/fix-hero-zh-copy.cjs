const fs = require("fs");
const path = "index.html";
let s = fs.readFileSync(path, "utf8");

const reps = [
  [
    '<h1 class="home-brand-hero-title">???</h1>',
    '<h1 class="home-brand-hero-title">妙脆角</h1>',
  ],
  [
    'aria-label="??????" hidden></div>',
    'aria-label="平台实时数据" hidden></div>',
  ],
  [
    '<p class="home-brand-hero-tagline">?????????????????????????</p>',
    '<p class="home-brand-hero-tagline">专业陪玩，每一场游戏认真对待，每一位热爱电竞的你。</p>',
  ],
  [
    '<a class="home-brand-hero-btn primary" href="companion-center.html">??????</a>',
    '<a class="home-brand-hero-btn primary" href="companion-center.html">进入陪玩大厅</a>',
  ],
  [
    '<a class="home-brand-hero-btn" href="support.html?start=1">????</a>',
    '<a class="home-brand-hero-btn" href="support.html?start=1">联系客服</a>',
  ],
  [
    'aria-label="??? APP ????"',
    'aria-label="妙脆角 APP 首页品牌区"',
  ],
  [
    '<section class="mcj-home-hero mcj-home-hero--promo" data-mcj-home-hero aria-label="????"></section>',
    '<section class="mcj-home-hero mcj-home-hero--promo" data-mcj-home-hero aria-label="首页 Banner"></section>',
  ],
];

let n = 0;
for (const [a, b] of reps) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    n += 1;
    console.log("fixed:", a.slice(0, 48));
  } else {
    console.log("MISS:", a.slice(0, 64));
  }
}
fs.writeFileSync(path, s, "utf8");
console.log("done", n);
