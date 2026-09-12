import { chromium } from "playwright-core";
import fs from "fs";
import { spawn } from "child_process";
import http from "http";
const OUT="/opt/cursor/artifacts/i18n-phase1";
const PORT=5188;
function wait(url){return new Promise(async(resolve,reject)=>{const t0=Date.now();while(Date.now()-t0<45000){try{await new Promise((res,rej)=>{http.get(url,r=>{r.resume();r.statusCode<500?res():rej()}).on("error",rej)});return resolve()}catch{await new Promise(r=>setTimeout(r,300))}}reject(new Error("timeout"))})}
const child=spawn("npx",["vite","--host","127.0.0.1","--port",String(PORT)],{stdio:"ignore"});
await wait(`http://127.0.0.1:${PORT}/`);
const browser=await chromium.launch({executablePath:"/usr/local/bin/google-chrome",headless:true,args:["--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await ctx.addInitScript(()=>localStorage.setItem("mcj_locale","en"));
const page=await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1000);
const texts=await page.evaluate(()=>({
  locale: localStorage.getItem("mcj_locale"),
  lang: document.documentElement.lang,
  cta: document.querySelector('[data-i18n="home.hero.enter_hall"]')?.textContent,
  tab: document.querySelector('[data-i18n="nav.home"]')?.textContent,
  club: document.querySelector('[data-i18n="home.club_level"]')?.textContent,
  weekly: document.querySelector('[data-i18n="home.weekly_popular"]')?.textContent,
}));
console.log(texts);
await page.screenshot({path:OUT+"/08-en-home.png"});
await page.click("[data-mcj-mnav-toggle], .mcj-mnav-toggle");
await page.waitForTimeout(400);
await page.screenshot({path:OUT+"/09-en-language-menu.png"});
// persist reload
await page.reload({waitUntil:"domcontentloaded"});
await page.waitForTimeout(800);
const after=await page.evaluate(()=>({
  locale: localStorage.getItem("mcj_locale"),
  cta: document.querySelector('[data-i18n="home.hero.enter_hall"]')?.textContent,
  tab: document.querySelector('[data-i18n="nav.home"]')?.textContent,
}));
console.log("persist", after);
await page.screenshot({path:OUT+"/17-en-persist-reload.png"});
await browser.close(); child.kill("SIGTERM");
