const http = require('http');
function get(path, headers={}) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1', port:5190, path, method:'GET', headers}, (res) => {
      let d=''; res.on('data', c => d+=c); res.on('end', () => resolve({status:res.statusCode, body:d, ct:res.headers['content-type']}));
    });
    req.on('error', reject); req.end();
  });
}
function post(path, body, headers={}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({hostname:'127.0.0.1', port:5190, path, method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data), ...headers}}, (res) => {
      let d=''; res.on('data', c => d+=c); res.on('end', () => resolve({status:res.statusCode, body:d}));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
(async () => {
  // public companions
  const companions = await get('/api/public/companions');
  console.log('companions', companions.status, companions.body.slice(0,300));

  // auth config
  const auth = await get('/api/auth');
  console.log('auth', auth.status, auth.body);

  // CS login attempt with known test account (from prior tests)
  const login = await post('/api/customer-service', {action:'login', account:'service@meow.test', password:'McjTest@12345678', remember:true});
  console.log('cs_login', login.status, login.body.slice(0,500));

  let token = null;
  try {
    const j = JSON.parse(login.body);
    token = j.session && (j.session.accessToken || j.session.token || j.session.access_token);
    console.log('token_keys', j.session ? Object.keys(j.session) : null);
  } catch(e) { console.log('parse_fail', e.message); }

  if (token) {
    const boot = await post('/api/customer-service', {action:'bootstrap'}, {Authorization:'Bearer '+token, 'x-mcj-access-token':token});
    console.log('cs_boot', boot.status, boot.body.slice(0,800));
  }

  // Boss login - try common test accounts from env/docs without printing secrets from .env
  const bossAttempts = [
    {email:'boss@meow.test', password:'McjTest@12345678'},
    {email:'testboss@meow.test', password:'McjTest@12345678'},
    {email:'boss@test.com', password:'password123'},
  ];
  for (const a of bossAttempts) {
    const r = await post('/api/auth', {action:'login', email:a.email, password:a.password});
    console.log('boss_login', a.email, r.status, r.body.slice(0,250));
    if (r.status===200) break;
  }
})().catch(e => { console.error(e); process.exit(1); });
