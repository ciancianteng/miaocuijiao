const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const html = await (await fetch(`${BASE}/companion-apply.html`)).text();
const scripts = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
const applyJs = scripts.find((s) => /companion-apply/.test(s));
console.log("applyJs", applyJs);
if (applyJs) {
  const js = await (await fetch(BASE + applyJs)).text();
  console.log({
    len: js.length,
    hasConfirm录音: js.includes("确认录音"),
    has待确认: js.includes("待确认"),
    has已录制: js.includes("已录制"),
    hasListenedGate: js.includes("请先播放完整试听"),
    has保存中: js.includes("保存中"),
  });
}
