const fs = require("fs");
const path = "index.html";
let html = fs.readFileSync(path, "utf8");

if (html.includes('property="og:image"')) {
  console.log("OG already present — abort to avoid duplicates");
  process.exit(1);
}

const metaBlock = `  <title>妙脆角 MEOW CUI JIAO｜专业游戏陪玩</title>
  <meta name="description" content="专业陪玩，每一场游戏认真对待每一位热爱电竞的你。">
  <link rel="canonical" href="https://www.meowcuijiao.com/">
  <meta name="robots" content="index,follow">
  <!-- Open Graph / WeChat & WeCom link preview -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="妙脆角 MEOW CUI JIAO">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:url" content="https://www.meowcuijiao.com/">
  <meta property="og:title" content="妙脆角 MEOW CUI JIAO｜专业游戏陪玩">
  <meta property="og:description" content="专业陪玩，每一场游戏认真对待每一位热爱电竞的你。">
  <meta property="og:image" content="https://www.meowcuijiao.com/og/share-card-square.jpg">
  <meta property="og:image:secure_url" content="https://www.meowcuijiao.com/og/share-card-square.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="600">
  <meta property="og:image:height" content="600">
  <meta property="og:image:alt" content="妙脆角 MEOW CUI JIAO 品牌形象">
  <meta property="og:image" content="https://www.meowcuijiao.com/og/share-card.jpg">
  <meta property="og:image:secure_url" content="https://www.meowcuijiao.com/og/share-card.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="妙脆角 MEOW CUI JIAO｜专业游戏陪玩">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="妙脆角 MEOW CUI JIAO｜专业游戏陪玩">
  <meta name="twitter:description" content="专业陪玩，每一场游戏认真对待每一位热爱电竞的你。">
  <meta name="twitter:image" content="https://www.meowcuijiao.com/og/share-card.jpg">
`;

const oldTitle = /<title>[^<]*<\/title>\s*/;
if (!oldTitle.test(html)) {
  console.error("title tag not found");
  process.exit(1);
}
html = html.replace(oldTitle, metaBlock + "\n");
fs.writeFileSync(path, html);
console.log("index.html metadata injected");
console.log({
  title: /<title>([^<]+)<\/title>/.exec(html)?.[1],
  ogImage: (html.match(/property="og:image" content="([^"]+)"/g) || []).length,
  hasCanonical: html.includes('rel="canonical"'),
  hasTwitter: html.includes("twitter:card"),
});
