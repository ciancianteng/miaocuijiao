import fs from "node:fs";

let t = fs.readFileSync("mine.html", "utf8");
t = t.replace(
  "function token(){return localStorage.getItem('mcjAuthAccessToken')||sessionStorage.getItem('mcjAuthAccessToken')||''}",
  "function token(){try{localStorage.removeItem('mcjAuthAccessToken');localStorage.removeItem('mcjAuthRefreshToken')}catch(e){}return sessionStorage.getItem('mcjAuthAccessToken')||''}"
);
t = t.replace(
  "if(session.accessToken){localStorage.setItem('mcjAuthAccessToken',session.accessToken);if(session.refreshToken)localStorage.setItem('mcjAuthRefreshToken',session.refreshToken);}",
  "if(session.accessToken){try{localStorage.removeItem('mcjAuthAccessToken');localStorage.removeItem('mcjAuthRefreshToken')}catch(e){}sessionStorage.setItem('mcjAuthAccessToken',session.accessToken);if(session.refreshToken)sessionStorage.setItem('mcjAuthRefreshToken',session.refreshToken);}"
);
t = t.replace(
  "refreshToken:localStorage.getItem('mcjAuthRefreshToken')||''",
  "refreshToken:sessionStorage.getItem('mcjAuthRefreshToken')||''"
);
fs.writeFileSync("mine.html", t);
console.log("mine patched", t.includes("sessionStorage.getItem('mcjAuthAccessToken')||''}"));
