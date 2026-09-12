import { chromium } from "playwright-core";
import { spawn } from "child_process";
import http from "http";
const PORT=5189, OUT="/opt/cursor/artifacts/i18n-phase1";
const wait=async(url)=>{const t0=Date.now();while(Date.now()-t0<45000){try{await new Promise((res,rej)=>http.get(url,r=>{r.resume();r.statusCode<500?res():rej()}).on("error",rej));return}catch{await new Promise(r=>setTimeout(r,300))}}throw new Error("timeout")};
const child=spawn("npx",["vite","--host","127.0.0.1","--port",String(PORT)],{stdio:"ignore"});
await wait(`http://127.0.0.1:${PORT}/`);
const browser=await chromium.launch({executablePath:"/usr/local/bin/google-chrome",headless:true,args:["--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await ctx.addInitScript(()=>localStorage.setItem("mcj_locale","en"));
const page=await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/companion-center.html`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1000);
console.log(await page.evaluate(()=>({
  title: document.querySelector('[data-i18n="hall.title"]')?.textContent,
  search: document.querySelector('[data-i18n="hall.search"]')?.textContent,
  empty: document.querySelector('#emptyState strong, .companion-empty strong')?.textContent,
  tab: document.querySelector('[data-i18n="nav.hall"]')?.textContent,
})));
await page.screenshot({path:OUT+"/10-en-hall.png"});
await browser.close(); child.kill("SIGTERM");
