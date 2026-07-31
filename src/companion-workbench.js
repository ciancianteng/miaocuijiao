(function(){
  var root=document.getElementById('companionApp');
  if(!root)return;
  var ROUTES={'/companion/':'dashboard','/companion/login':'login','/companion/dashboard':'dashboard','/companion/order-hall':'hall','/companion/orders':'orders','/companion/earnings':'wallet','/companion/wallet':'wallet','/companion/popularity':'popularity','/companion/profile':'profile','/companion/verification':'verification'};
  var NAV=[['dashboard','工作台','/companion/dashboard'],['hall','抢单大厅','/companion/order-hall'],['orders','我的订单','/companion/orders'],['wallet','我的猫粮','/companion/wallet'],['profile','我的资料','/companion/profile']];
  var HIDDEN_MVP_ROUTES={popularity:1};
  var state={route:'dashboard',session:null,data:null,notice:'',loading:false,error:'',walletWarning:'',authTab:'login',loginError:'',loginBusy:false,profileServices:[],profileErrors:{},uploadBusy:'',statusBusy:false,settlement:null,orderFilter:'all',pollTimer:null};
  var SESSION_KEY='mcjCompanionSession';
  var Auth=window.MCJAuthShell;
  var MAIN_GAMES=['VALORANT','三角洲','APEX','CS2','英雄联盟','王者荣耀','和平精英','其他'];
  var STATUS_META={
    online:{label:'在线可接单',hint:'可进入抢单大厅并接单'},
    busy:{label:'忙碌',hint:'不再接新单，但可处理进行中订单'},
    paused:{label:'暂停接单',hint:'暂时不展示为可接单'},
    offline:{label:'离线',hint:'退出接单状态'}
  };
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function route(){var p=location.pathname.replace(/\/$/,'')||'/companion';if(p==='/companion')p='/companion/';return ROUTES[p]||'dashboard'}
  function go(path){history.pushState(null,'',path);paint()}
  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null')}catch(e){return null}}
  function saveSession(session,remember){
    // Always dual-write so refresh + new tab keep companion login.
    var payload=JSON.stringify(session||{});
    try{localStorage.setItem(SESSION_KEY,payload);}catch(e){}
    try{sessionStorage.setItem(SESSION_KEY,payload);}catch(e){}
    state.session=session;
  }
  function clearSession(){
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    state.session=null;
    state.data=null;
    if(window.MCJRoleGate&&typeof window.MCJRoleGate.logout==='function'){
      window.MCJRoleGate.logout('companion');
    }
  }
  function toast(msg){
    state.notice=msg||'';
    if(state.route==='login'||!state.session){
      var err=document.querySelector('[data-auth-error]');
      if(err){
        err.textContent=msg||'';
        setTimeout(function(){if(err.textContent===msg){err.textContent='';state.notice='';}},2200);
        return;
      }
    }
    paint();
    setTimeout(function(){state.notice='';paint()},2200);
  }
  function api(action,body,method){
    var opts={method:method||'POST',headers:{'Content-Type':'application/json'}};
    var session=state.session||readSession();
    if(session&&session.token)opts.headers['x-mcj-companion-token']=session.token;
    if(opts.method==='GET'){
      var qs='action='+encodeURIComponent(action);
      if(body&&typeof body==='object'){
        Object.keys(body).forEach(function(k){
          if(body[k]==null||body[k]==='')return;
          qs+='&'+encodeURIComponent(k)+'='+encodeURIComponent(body[k]);
        });
      }
      return fetch('/api/companion?'+qs,opts).then(parseResponse);
    }
    opts.body=JSON.stringify(Object.assign({action:action},body||{}));
    return fetch('/api/companion',opts).then(parseResponse);
  }
  function parseResponse(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(e){throw new Error('接口返回格式错误')}if(!res.ok||body.ok===false)throw new Error(body.message||('请求失败：HTTP '+res.status));return body})}
  function loadProfileServices(){
    return fetch('/api/platform/services?scope=profile',{headers:{Accept:'application/json'},cache:'no-store'})
      .then(function(res){return res.json().catch(function(){return {services:[]}})})
      .then(function(body){state.profileServices=(body&&body.services)||[];})
      .catch(function(){state.profileServices=[];});
  }
  function loadData(){
    if(!state.session||!state.session.token)return Promise.resolve();
    state.loading=true;paint();
    var boot=api('bootstrap',{},'GET');
    var walletReq=(state.route==='wallet'||state.route==='earnings')
      ? api('wallet',{},'GET').catch(function(){return null;})
      : Promise.resolve(null);
    return Promise.all([boot,loadProfileServices(),walletReq]).then(function(results){
      var result=results[0]||{};
      var walletResult=results[2];
      state.data=Object.assign({},state.data||{},result.data||{});
      if(walletResult&&walletResult.ok&&walletResult.data){
        state.data.summary=walletResult.data.summary||state.data.summary;
        state.data.earnings=walletResult.data.earnings||state.data.earnings;
        state.data.walletLedger=walletResult.data.walletLedger||state.data.walletLedger||[];
        state.data.withdrawals=walletResult.data.withdrawals||state.data.withdrawals||[];
        if(walletResult.data.withdrawalRules){
          state.data.withdrawalRules=Object.assign({},state.data.withdrawalRules||{},walletResult.data.withdrawalRules);
        }
      }
      // Do not treat informational/server notice as fatal page error when data exists.
      state.error='';
      state.walletWarning=(walletResult&&walletResult.data&&walletResult.data.warnings&&walletResult.data.warnings[0])
        || (result.data&&result.data.walletWarnings&&result.data.walletWarnings[0])
        || '';
    }).catch(function(err){
      // Keep previous data if any; wallet page must still show zeros instead of blank failure.
      state.error=err.message||'陪玩端数据读取失败';
      if(state.route==='wallet'||state.route==='earnings'){
        return api('wallet',{},'GET').then(function(walletResult){
          if(!walletResult||!walletResult.ok)throw new Error((walletResult&&walletResult.message)||state.error);
          state.data=Object.assign({},state.data||{},{
            summary:walletResult.data.summary,
            earnings:walletResult.data.earnings,
            walletLedger:walletResult.data.walletLedger||[],
            withdrawals:walletResult.data.withdrawals||[],
            withdrawalRules:walletResult.data.withdrawalRules||{},
            permissions:(state.data&&state.data.permissions)||{}
          });
          state.error='';
          state.walletWarning=(walletResult.data.warnings&&walletResult.data.warnings[0])||'';
        }).catch(function(walletErr){
          state.data=Object.assign({},state.data||{},{
            summary:{todayIncome:0,monthIncome:0,totalIncome:0,withdrawable:0,frozen:0,withdrawn:0},
            earnings:{todayIncome:0,monthIncome:0,totalIncome:0,withdrawable:0,available:0,frozen:0,withdrawn:0},
            walletLedger:[],
            withdrawals:[],
            withdrawalRules:{minAmount:0,monthlyLimit:0,remainingThisMonth:0,exchangeRate:1},
            permissions:(state.data&&state.data.permissions)||{}
          });
          state.walletWarning=walletErr.message||state.error;
          // Wallet route renders zeros; keep detailed error in banner, not full-page block.
          if(state.route==='wallet'||state.route==='earnings')state.error='';
        });
      }
    }).finally(function(){state.loading=false;paint();});
  }
  function startPoll(){if(state.pollTimer)clearInterval(state.pollTimer);state.pollTimer=setInterval(function(){if(!state.session||!state.session.token||document.hidden||state.loading)return;if(['dashboard','hall','orders','wallet','profile'].indexOf(state.route)===-1)return;api('bootstrap',{},'GET').then(function(result){state.data=result.data||state.data;state.error='';paint();}).catch(function(){});},4000)}
  function init(){state.session=readSession();state.route=route();if(!state.session&&state.route!=='login'){go('/companion/login');return}if(state.session&&state.route==='login'){go('/companion/dashboard');return}if(state.session)loadData().then(startPoll);else paint()}
  window.addEventListener('popstate',init);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&state.session)loadData();});
  function paint(){state.route=route();if(state.route==='login')return renderLogin();if(!state.session){renderLogin();return}renderShell()}
  function noticeHtml(){return state.notice?'<div class="pw-toast show">'+esc(state.notice)+'</div>':''}
  function renderLogin(){
    var tab=state.authTab==='register'?'register':'login';
    var header=Auth&&Auth.brandHeader?Auth.brandHeader('陪玩端登录','登录或注册成为妙脆角陪玩'):'<h1 class="mcj-auth-title">陪玩端登录</h1><p class="mcj-auth-desc">登录或注册成为妙脆角陪玩</p>';
    var loginPwd=Auth&&Auth.passwordField?Auth.passwordField('password','密码'):'<label class="mcj-auth-field">密码<input name="password" type="password" autocomplete="current-password" required></label>';
    var regPwd=Auth&&Auth.passwordField?Auth.passwordField('password','密码','autocomplete="new-password" minlength="8"'):'<label class="mcj-auth-field">密码<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>';
    var regConfirm=Auth&&Auth.passwordField?Auth.passwordField('confirm_password','确认密码','autocomplete="new-password" minlength="8"'):'<label class="mcj-auth-field">确认密码<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label>';
    root.innerHTML=
      '<main class="mcj-auth-page">'+
      '<section class="mcj-auth-card">'+header+
      '<div class="mcj-auth-tabs">'+
      '<button class="mcj-auth-btn '+(tab==='login'?'primary active':'ghost')+'" type="button" data-auth-tab="login">登录</button>'+
      '<button class="mcj-auth-btn '+(tab==='register'?'primary active':'ghost')+'" type="button" data-auth-tab="register">注册陪玩</button>'+
      '</div>'+
      '<form class="mcj-auth-form" data-login '+(tab==='login'?'':'hidden')+' autocomplete="on">'+
      '<label class="mcj-auth-field">陪玩 ID / 邮箱 / 手机号<input name="account" autocomplete="username" required></label>'+
      loginPwd+
      '<label class="mcj-auth-check"><input name="remember" type="checkbox" checked> 记住登录</label>'+
      '<button class="mcj-auth-btn primary" type="submit"'+(state.loginBusy?' disabled':'')+'>'+(state.loginBusy?'登录中…':'登录')+'</button>'+
      '<button class="mcj-auth-btn ghost" type="button" data-forgot-password>忘记密码</button>'+
      '<p class="mcj-auth-error" data-auth-error>'+esc(state.loginError||'')+'</p>'+
      '</form>'+
      '<form class="mcj-auth-form" data-register '+(tab==='register'?'':'hidden')+' autocomplete="on">'+
      '<label class="mcj-auth-field">邮箱<input name="email" type="email" autocomplete="email" required></label>'+
      '<label class="mcj-auth-field">陪玩昵称<input name="nickname" required></label>'+
      '<label class="mcj-auth-field">手机号 / 联系方式<input name="phone" autocomplete="tel"></label>'+
      regPwd+regConfirm+
      '<label class="mcj-auth-check"><input name="agree" type="checkbox" required> 我已阅读并同意服务条款</label>'+
      '<label class="mcj-auth-check"><input name="remember" type="checkbox" checked> 注册后保持登录</label>'+
      '<button class="mcj-auth-btn primary" type="submit">注册并提交资料</button>'+
      '<p class="mcj-auth-error" data-auth-error></p>'+
      '</form>'+
      '<p class="mcj-auth-note">正式数据保存到统一数据库；未配置数据库时不会生成本地假账号。</p>'+
      '</section></main>';
    if(Auth&&Auth.bindPasswordToggles)Auth.bindPasswordToggles(root);
  }
  function title(){return ({dashboard:'陪玩工作台',hall:'抢单大厅',orders:'我的订单',wallet:'我的猫粮',earnings:'我的猫粮',popularity:'我的人气',profile:'我的资料',verification:'资料认证与押金'})[state.route]||'陪玩端'}
  function maintenanceHtml(name){return '<div class="pw-page-head"><div><h2>'+esc(name||'功能开发中')+'</h2><p>该模块今晚暂未开放，请先处理抢单与订单完成。</p></div><button class="pw-btn primary" type="button" data-route="/companion/dashboard">返回工作台</button></div><div class="pw-empty">功能开发中</div>'}
  function bottomNavHtml(){
    return '<nav class="pw-bottom-nav">'+NAV.map(function(n){
      return '<button type="button" class="'+(state.route===n[0]?'active':'')+'" data-route="'+n[2]+'">'+n[1]+'</button>';
    }).join('')+'</nav>';
  }
  function settlementModalHtml(){
    var s=state.settlement;if(!s)return '';
    var rows=[
      ['订单编号',s.orderNo||s.orderId||'-'],
      ['老板', (s.bossName||'-')+(s.bossUid?' / '+s.bossUid:'')],
      ['服务项目',s.serviceName||s.game||'-'],
      ['服务时长',s.duration||'-'],
      ['订单总猫粮',s.totalCatFood],
      ['平台抽成比例',(s.platformCommissionRate!=null?s.platformCommissionRate:'-')+'%'],
      ['平台抽成猫粮',s.platformCommissionCatFood],
      ['邀请返点/其他扣除',s.rebateOrOtherDeduction||0],
      ['陪玩实际到账猫粮',s.companionNetCatFood],
      ['完成时间',s.completedAt||'-'],
      ['结算状态',s.settlementStatus||'已结算']
    ];
    return '<div class="pw-modal" data-close-settlement><div class="pw-dialog" data-settlement-dialog><div class="pw-dialog-head"><h3>订单结算详情</h3><button type="button" class="pw-btn" data-close-settlement>关闭</button></div><div class="pw-info-list">'+rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>'}).join('')+'</div></div></div>';
  }
  function renderShell(){var data=state.data||{},player=data.player||state.session.user||{},lock=data.permissions&&data.permissions.lockReason;root.innerHTML='<div class="pw-shell"><aside class="pw-side"><div class="pw-brand"><strong>MEOW CUI JIAO</strong><span>Companion Workbench</span></div><nav class="pw-nav">'+NAV.map(function(n){return '<button class="'+(state.route===n[0]?'active':'')+'" data-route="'+n[2]+'">'+n[1]+'</button>'}).join('')+'</nav></aside><section class="pw-main"><header class="pw-top"><div><h1>'+title()+'</h1><p>'+(lock?esc(lock):'今晚主流程：抢单 → 服务 → 完成订单。')+'</p></div><div class="pw-account"><button class="pw-avatar" data-account-toggle>'+esc(String(player.name||player.uid||'P').slice(0,1).toUpperCase())+'</button><div class="pw-menu"><button type="button" data-route="/companion/profile">我的资料</button><button type="button" data-route="/companion/wallet">我的猫粮</button><button class="danger" type="button" data-logout>退出登录</button></div></div></header><main class="pw-page">'+pageHtml()+'</main></section>'+bottomNavHtml()+'</div>'+noticeHtml()+settlementModalHtml()}
  function pageHtml(){if(state.loading)return '<div class="pw-empty">正在读取真实数据...</div>';if(HIDDEN_MVP_ROUTES[state.route])return maintenanceHtml(title());if(state.error&&state.route!=='wallet'&&state.route!=='earnings')return '<div class="pw-empty"><strong>数据源未就绪</strong><span>'+esc(state.error)+'</span></div>';if(state.route==='hall')return hallHtml();if(state.route==='orders')return ordersHtml();if(state.route==='wallet'||state.route==='earnings')return walletHtml();if(state.route==='popularity')return popularityHtml();if(state.route==='profile')return profileHtml();if(state.route==='verification')return verificationHtml();return dashboardHtml()}
  function metric(label,value){return '<article class="pw-card pw-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>'}
  function popularityHtml(){
    var pop=(state.data&&state.data.popularity)||{};
    var w=pop.weekly||{},m=pop.monthly||{},t=pop.total||{};
    var tip=w.tip||'完成订单、好评与礼物可提升人气。';
    var penalties=(w.penalties||[]).map(function(p){return '<div><span>'+esc(p.type)+' ×'+esc(p.count)+'</span><strong>'+esc(p.points)+'</strong></div>'}).join('')||'<div><span>本周扣分</span><strong>无</strong></div>';
    return '<div class="pw-page-head"><div><h2>我的人气</h2><p>排名来自真实订单、评价、礼物与在线数据，刷新后不会丢。</p></div></div>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><strong style="display:block;margin-bottom:8px">动力提示</strong><p style="margin:0;color:rgba(255,220,235,.92)">'+esc(tip)+'</p></section>'+
      '<section class="pw-grid">'+metric('本周排名',w.rank||'-')+metric('本月排名',m.rank||'-')+metric('总榜排名',t.rank||'-')+metric('本周人气值',w.score||0)+metric('距上一名',w.gapToPrevious==null?'-':w.gapToPrevious)+metric('本周完成订单',w.completedOrders||0)+metric('本周好评',(w.fiveStarReviews||0)+(w.fourStarReviews||0))+metric('本周礼物猫粮',w.giftCatFood||0)+metric('本周在线(分钟)',w.onlineMinutes||0)+'</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>本周扣分记录</h3><div class="pw-info-list">'+penalties+'</div></section>';
  }
  function currentOnlineStatus(){
    var p=(state.data&&state.data.player)||{};
    var s=String(p.onlineStatus||'offline').toLowerCase();
    return STATUS_META[s]?s:'offline';
  }
  function statusSwitcherHtml(extraClass){
    var cur=currentOnlineStatus();
    var perm=(state.data||{}).permissions||{};
    var locked=!perm.canSetAvailable;
    var label=(STATUS_META[cur]&&STATUS_META[cur].label)||'离线';
    return '<div class="pw-status-panel '+(extraClass||'')+'">'+
      '<div class="pw-status-current">当前状态：<strong data-current-status-label>'+esc(label)+'</strong></div>'+
      '<div class="pw-status-switch" role="radiogroup" aria-label="接单状态">'+
      ['online','busy','paused','offline'].map(function(key){
        var meta=STATUS_META[key];
        var active=cur===key;
        return '<button type="button" class="pw-btn pw-status-btn'+(active?' is-active':'')+'" role="radio" aria-checked="'+(active?'true':'false')+'" data-online-status="'+key+'" '+(locked||state.statusBusy?'disabled':'')+' title="'+esc(meta.hint)+'">'+esc(meta.label)+'</button>';
      }).join('')+
      '</div>'+
      '<p class="pw-status-hint">'+esc((STATUS_META[cur]&&STATUS_META[cur].hint)||'')+'</p>'+
      '</div>';
  }
  function dashboardHtml(){
    var s=(state.data||{}).summary||{},p=(state.data||{}).player||{},perm=(state.data||{}).permissions||{},pop=((state.data||{}).popularity||{}).weekly||{};
    var online=currentOnlineStatus()==='online';
    var designated=Number(s.waitingConfirm||s.designatedPending||0);
    var banner=designated>0?'<div class="pw-alert designated" role="status"><strong>你有新的指定订单</strong><span>共 '+esc(designated)+' 单等待确认接单</span><button class="pw-btn primary" type="button" data-route="/companion/orders" data-order-filter="waiting_confirm">去处理</button></div>':'';
    return '<div class="pw-page-head"><div><h2>工作台</h2><p>没有真实数据时显示 0，不显示模拟趋势。</p></div><div class="pw-actions"><button class="pw-btn primary" type="button" data-enter-hall>进入抢单大厅</button><button class="pw-btn" data-route="/companion/profile">编辑资料</button></div></div>'+
      banner+
      statusSwitcherHtml()+
      (!online?'<div class="pw-note" style="margin:0 0 14px">只有「在线可接单」时可进入抢单大厅；当前为「'+esc((STATUS_META[currentOnlineStatus()]||{}).label||'离线')+'」。</div>':'')+
      '<section class="pw-grid">'+
      metric('待确认订单',s.waitingConfirm||0)+
      metric('进行中订单',s.runningOrders||0)+
      metric('今日完成订单',s.todayCompleted||0)+
      metric('今日预计收入',money(s.todayExpectedIncome||0))+
      metric('可提现猫粮',money(s.withdrawable||0))+
      metric('今日订单',s.todayOrders||0)+
      metric('本月收入',money(s.monthIncome||0))+
      metric('本周人气值',pop.score||0)+
      '</section>'+(pop.tip?'<section class="pw-card pad" style="margin-top:14px"><strong>人气提示</strong><p style="margin:8px 0 0">'+esc(pop.tip)+'</p><button class="pw-btn" style="margin-top:10px" data-route="/companion/popularity">查看我的人气</button></section>':'')+'<section class="pw-card pad" style="margin-top:14px"><h3>待处理事项</h3>'+todoList()+'</section>';
  }
  function todoList(){var s=(state.data||{}).summary||{},p=(state.data||{}).player||{};var rows=[['待确认订单',s.waitingConfirm||0],['待开始订单',s.waitingStart||0],['待完成订单',s.waitingComplete||0],['待处理消息',s.unreadMessages||0],['资料审核状态',p.auditStatus||'待提交'],['押金状态',p.depositStatus||'未缴纳']];return '<div class="pw-info-list">'+rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>'}).join('')+'</div>'}
  function orderStatus(o){return o.orderStatus||o.statusText||o.status||'-'}
  function fmtTime(v){if(!v)return '-';try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(e){return String(v)}}
  var REJECT_REASONS=['正在服务其他订单','时间无法配合','临时有事','不接该项目','其他'];
  function orderActions(o){
    var s=orderStatus(o),id=esc(o.id);var raw=o.status||o.rawStatus||'';var out=[];
    // Open-grab applicant: never show 开始订单 until boss selected (confirmed).
    if(o.grabStatus==='pending_customer_selection'||(raw==='waiting_boss_confirm'&&!o.companionId)){
      out.push('<span class="pw-note">已抢单，等待老板确认人选后进入待开始</span>');
      return out.join('');
    }
    if(o.grabStatus==='not_selected'){
      out.push('<span class="pw-note">该订单已由其他陪玩接单</span>');
      return out.join('');
    }
    if(s==='待老板确认'||s==='等待老板选择')out.push('<span class="pw-note">等待老板确认陪玩</span>');
    if(raw==='claimed'||/等待陪玩确认|已支付待陪玩/.test(s)){
      out.push('<div class="pw-order-actions sticky">'+
        '<button class="pw-btn primary" type="button" data-order-action="accept_direct_order" data-order-id="'+id+'">确认接单</button>'+
        '<button class="pw-btn danger" type="button" data-order-action="reject_direct_order" data-order-id="'+id+'">无法接单</button>'+
        '</div>');
    }
    if(raw==='confirmed'||s==='已接单待开始'||s==='待开始')out.push('<button class="pw-btn primary" data-order-action="start_order" data-order-id="'+id+'">开始订单</button>');
    if((s==='进行中'||raw==='in_progress')&&!o.completionPending)out.push('<button class="pw-btn primary" data-order-action="complete_order" data-order-id="'+id+'">完成订单</button>');
    if(o.completionPending&&raw==='in_progress')out.push('<span class="pw-note">已申请完成，等待老板确认</span>');
    if(raw==='completed'||s==='已完成'){
      out.push('<button class="pw-btn" type="button" data-view-settlement="'+id+'">查看结算详情</button>');
    }
    return out.join('')||'<span class="pw-note">无可用操作</span>';
  }
  function designatedOrderCard(o){
    var banner=o.status==='claimed'?'<div class="pw-order-banner">你有新的指定订单</div>':'';
    return '<article class="pw-order-card'+(o.status==='claimed'?' is-designated':'')+'">'+banner+
      '<header><div><h3>'+esc(o.orderNo||o.id)+'</h3><p>'+esc(o.game||o.serviceName||'-')+' / '+esc(o.serviceName||o.serviceContent||'-')+'</p></div><span class="pw-status info">'+esc(orderStatus(o))+'</span></header>'+
      '<div class="pw-order-meta">'+
      '<div><span>老板昵称/编号</span><strong>'+esc((o.bossName||'-')+(o.bossUid?' / '+o.bossUid:''))+'</strong></div>'+
      '<div><span>数量/预计时长</span><strong>'+esc(o.duration||(o.hours?o.hours+'小时':'-'))+'</strong></div>'+
      '<div><span>陪玩单价</span><strong>'+money(o.unitPrice||0)+'</strong></div>'+
      '<div><span>本单总额</span><strong>'+money(o.amount||0)+'</strong></div>'+
      '<div><span>预计到手猫粮</span><strong>'+money(o.playerIncome||0)+'</strong></div>'+
      '<div><span>平台抽成</span><strong>'+money(o.platformFee||0)+'</strong></div>'+
      '<div><span>游戏 ID</span><strong>'+esc(o.gameId||'-')+'</strong></div>'+
      '<div><span>老板备注</span><strong>'+esc(o.bossNotes||'-')+'</strong></div>'+
      '<div><span>下单时间</span><strong>'+esc(fmtTime(o.createdAt))+'</strong></div>'+
      '<div><span>最迟确认时间</span><strong>'+esc(fmtTime(o.confirmDeadline))+'</strong></div>'+
      '</div><footer class="pw-actions">'+orderActions(o)+'</footer></article>';
  }
  function ordersHtml(){
    var rows=(state.data&&state.data.myOrders)||[];
    var filter=state.orderFilter||'all';
    var designatedCount=rows.filter(function(o){return o.status==='claimed'}).length;
    var filtered=rows.filter(function(o){
      if(filter==='waiting_selection')return o.grabStatus==='pending_customer_selection'||o.status==='waiting_boss_confirm';
      if(filter==='waiting_confirm')return o.status==='claimed';
      if(filter==='waiting_start')return o.status==='confirmed';
      if(filter==='running')return o.status==='in_progress';
      if(filter==='completed')return o.status==='completed'||orderStatus(o)==='已完成';
      if(filter==='cancelled')return o.status==='cancelled';
      if(filter==='after_sale')return o.status==='refund_requested'||o.status==='refunded'||o.status==='disputed';
      return true;
    });
    var tabs=[
      ['all','全部'],
      ['waiting_selection','等待老板选择'],
      ['waiting_confirm','待确认'],
      ['waiting_start','待开始'],
      ['running','进行中'],
      ['completed','已完成'],
      ['cancelled','已取消'],
      ['after_sale','售后订单']
    ];
    return '<div class="pw-page-head"><div><h2>我的订单</h2><p>所有订单来自统一订单表；指定订单需先确认接单后才能开始服务。</p></div></div>'+
      (designatedCount?'<div class="pw-alert designated"><strong>你有新的指定订单</strong><span>共 '+esc(designatedCount)+' 单待确认</span></div>':'')+
      '<div class="pw-tabs">'+tabs.map(function(t){
        return '<button type="button" class="'+(filter===t[0]?'active':'')+'" data-order-filter="'+t[0]+'">'+t[1]+'</button>';
      }).join('')+'</div>'+
      '<section class="pw-list">'+(filtered.length?filtered.map(designatedOrderCard).join(''):'<div class="pw-empty"><strong>暂无订单</strong><span>接单成功后会显示在这里。</span></div>')+'</section>';
  }
  function walletHtml(){
    var e=(state.data&&state.data.earnings)||{},summary=(state.data&&state.data.summary)||{},ledger=(state.data&&state.data.walletLedger)||[],withdrawals=(state.data&&state.data.withdrawals)||[],rules=(state.data&&state.data.withdrawalRules)||{},perm=(state.data&&state.data.permissions)||{};
    var can=!!perm.canWithdraw;
    var available=e.available!=null?e.available:e.withdrawable;
    var frozen=e.frozen!=null?e.frozen:summary.frozen||0;
    var warn=state.walletWarning||state.error||'';
    return '<div class="pw-page-head"><div><h2>我的猫粮</h2><p>余额与流水来自 Supabase 真实记录，不可前端改余额。</p></div><button class="pw-btn primary" data-open-withdraw '+(can?'':'disabled')+'>申请提现</button></div>'+
      (warn?'<div class="pw-empty" style="margin-bottom:12px"><strong>部分数据读取异常</strong><span>'+esc(warn)+'</span></div>':'')+
      (!can&&perm.withdrawLockReason?'<div class="pw-empty" style="margin-bottom:12px"><strong>暂不可提现</strong><span>'+esc(perm.withdrawLockReason)+'</span></div>':'')+
      '<section class="pw-grid">'+
      metric('当前可用猫粮',money(available||0))+
      metric('待结算/冻结中',money(frozen||0))+
      metric('累计收入',money(e.totalIncome||summary.totalIncome||0))+
      metric('已提现猫粮',money(e.withdrawn||summary.withdrawn||0))+
      metric('本月收入',money(e.monthIncome||summary.monthIncome||0))+
      metric('今日收入',money(e.todayIncome||0))+
      '</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>提现规则</h3><div class="pw-info-list">'+
      '<div><span>可提现余额</span><strong>'+money(available||0)+'</strong></div>'+
      '<div><span>最低提现额度</span><strong>'+esc(rules.minAmount||0)+' 猫粮</strong></div>'+
      '<div><span>本月剩余次数</span><strong>'+esc(rules.remainingThisMonth||0)+' / '+esc(rules.monthlyLimit||0)+'</strong></div>'+
      '<div><span>结款账户</span><strong>'+esc(rules.currentAccount||'未绑定')+'</strong></div>'+
      '<div><span>结算比例</span><strong>1 猫粮 = '+esc(rules.exchangeRate||1)+' RM</strong></div>'+
      '</div></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>猫粮流水明细</h3>'+(ledger.length?'<div class="pw-table-wrap"><table class="pw-table"><thead><tr><th>类型</th><th>金额</th><th>关联</th><th>状态</th><th>时间</th></tr></thead><tbody>'+ledger.map(function(x){
        return '<tr><td>'+esc(x.type||'-')+'</td><td>'+(x.direction==='out'?'-':'')+money(x.amount||0)+'</td><td>'+esc(x.orderId||x.withdrawalId||x.note||'-')+'</td><td>'+esc(x.status||'-')+'</td><td>'+esc(x.createdAt||'-')+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<div class="pw-empty">暂无流水</div>')+'</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>提现记录</h3>'+(withdrawals.length?'<div class="pw-table-wrap"><table class="pw-table"><thead><tr><th>单号</th><th>猫粮</th><th>到账RM</th><th>状态</th><th>时间</th><th>说明</th></tr></thead><tbody>'+withdrawals.map(function(x){
        return '<tr><td>'+esc(x.withdrawalNo||x.id)+'</td><td>'+esc(x.catFoodAmount||x.amount||0)+'</td><td>'+esc(x.netAmountRm||0)+'</td><td>'+esc(x.statusText||x.status||'-')+'</td><td>'+esc(x.submittedAt||x.createdAt||'-')+'</td><td>'+esc(x.rejectReason||x.bankName||'')+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<div class="pw-empty">暂无提现记录</div>')+'</section>';
  }
  function fieldErr(name){var msg=state.profileErrors&&state.profileErrors[name];return msg?'<span class="pw-field-error" data-field-error="'+esc(name)+'">'+esc(msg)+'</span>':''}
  function fieldLabel(text,required){return '<span class="pw-field-label">'+esc(text)+(required?'<i class="pw-req">*</i>':'')+'</span>'}
  function profileHtml(){
    var p=(state.data&&state.data.player)||{};
    var raw=p.raw||{};
    var level=(state.data&&state.data.levelInfo)||{};
    var media=(state.data&&state.data.media)||[];
    var avatarMedia=media.filter(function(m){return m.mediaType==='avatar'})[0];
    var gallery=media.filter(function(m){return m.mediaType==='gallery'}).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
    var avatarUrl=avatarMedia&&avatarMedia.url?avatarMedia.url:(p.hasCustomAvatar?p.avatar:'');
    var displayAvatar=avatarUrl||'/default-avatar.png';
    var gender=String(raw.gender||'');
    var gameId=p.gameId||raw.game_id||'';
    var selectedGames=String(p.mainGame||raw.game||'').split(/[,，、/|]+/).map(function(x){return x.trim()}).filter(Boolean);
    var uploadBusy=state.uploadBusy;
    var minP=level.minPrice!=null?level.minPrice:20;
    var maxP=level.maxPrice!=null?level.maxPrice:30;
    var maxPlus=!!level.maxPlus;
    var rangeText=level.priceRangeText||('RM'+minP+'–RM'+maxP+(maxPlus?'+':'')+' / 小时');
    var levelLabel=level.level||p.level||'未设置';
    var priceVal=level.price!=null?level.price:(p.rawPrice||p.price||'');
    var needsReset=!!(level.priceNeedsReset||p.priceNeedsReset);
    var genderRadios=['男','女','不公开'].map(function(g){
      return '<label class="pw-radio"><input type="radio" name="gender" value="'+esc(g)+'" '+(gender===g?'checked':'')+'> '+esc(g)+'</label>';
    }).join('');
    var gameChecks=MAIN_GAMES.map(function(g){
      var on=selectedGames.indexOf(g)!==-1;
      return '<label class="pw-check-chip"><input type="checkbox" name="main_game_opt" value="'+esc(g)+'" '+(on?'checked':'')+'> '+esc(g)+'</label>';
    }).join('');
    var galleryHtml=gallery.map(function(item,idx){
      return '<div class="pw-gallery-item" data-media-id="'+esc(item.id)+'">'+
        '<img src="'+esc(item.url||'/default-avatar.png')+'" alt="相册">' +
        '<div class="pw-gallery-actions">'+
        '<button type="button" class="pw-btn" data-gallery-move="-1" '+(idx===0?'disabled':'')+'>上移</button>'+
        '<button type="button" class="pw-btn" data-gallery-move="1" '+(idx===gallery.length-1?'disabled':'')+'>下移</button>'+
        '<button type="button" class="pw-btn danger" data-delete-media="'+esc(item.id)+'">删除</button>'+
        '</div></div>';
    }).join('');
    return '<div class="pw-page-head"><div><h2>我的资料</h2><p>填写真实信息并上传照片；保存后提交后台审核。等级、抽成、返点不能自行修改。</p></div></div>'+
      '<form class="pw-card pad pw-form pw-profile-form" data-profile-form novalidate>'+
      '<div class="pw-field pw-upload-block">'+
      fieldLabel('头像',false)+
      '<div class="pw-avatar-upload">'+
      '<img class="pw-avatar-preview" src="'+esc(displayAvatar)+'" alt="头像预览" data-avatar-preview>'+
      '<div class="pw-upload-actions">'+
      '<label class="pw-btn'+(uploadBusy==='avatar'?' is-busy':'')+'">'+
      (uploadBusy==='avatar'?'上传中…':'上传头像')+
      '<input type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/*" capture="environment" data-upload-avatar hidden '+(uploadBusy?'disabled':'')+'>'+
      '</label>'+
      (avatarUrl?'<button type="button" class="pw-btn danger" data-delete-avatar>删除头像</button>':'')+
      '</div></div>'+
      '<p class="pw-field-hint">支持从手机相册选择或拍照；格式 jpg / png / webp，单张不超过 5MB。未上传时显示默认头像。</p>'+
      '</div>'+
      '<div class="pw-field pw-upload-block">'+
      fieldLabel('陪玩卡面 / 相册',false)+
      '<div class="pw-gallery-grid" data-gallery-list>'+(galleryHtml||'<div class="pw-empty tiny">还没有相册照片，请至少上传 1 张（最多 6 张）</div>')+'</div>'+
      '<label class="pw-btn'+(uploadBusy==='gallery'||gallery.length>=6?' is-busy':'')+'">'+
      (uploadBusy==='gallery'?'上传中…':(gallery.length>=6?'已达 6 张上限':'上传相册照片'))+
      '<input type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/*" capture="environment" data-upload-gallery hidden '+(uploadBusy||gallery.length>=6?'disabled':'')+'>'+
      '</label>'+
      '<p class="pw-field-hint">建议上传清晰正面或游戏风格卡面；可删除、调整顺序。至少 1 张，最多 6 张。</p>'+
      '</div>'+
      '<div class="pw-field pw-upload-block">'+
      fieldLabel('语音试听',false)+
      (function(){var v=p.voiceUrl||raw.voice_url||'';return v?'<p class="pw-field-hint">当前已有录音：<a href="'+esc(v)+'" target="_blank" rel="noopener">试听</a></p>':'<p class="pw-field-hint">尚未上传语音试听。</p>';})()+
      '<label class="pw-btn'+(uploadBusy==='voice'?' is-busy':'')+'">'+
      (uploadBusy==='voice'?'上传中…':'上传录音')+
      '<input type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" data-upload-voice hidden '+(uploadBusy?'disabled':'')+'>'+
      '</label>'+
      '<p class="pw-field-hint">支持 mp3 / wav / m4a / webm，建议 5–30 秒，单文件不超过 10MB。</p>'+
      '</div>'+
      '<div class="pw-field">'+fieldLabel('昵称',true)+'<input name="nickname" value="'+esc(p.name||'')+'" placeholder="例如：1717大王" autocomplete="nickname">'+fieldErr('nickname')+'</div>'+
      '<div class="pw-field">'+fieldLabel('年龄',true)+'<input name="age" type="number" inputmode="numeric" min="18" max="60" value="'+esc(raw.age||'')+'" placeholder="请输入真实年龄，例如 23">'+'<p class="pw-field-hint">只允许 18–60 的数字</p>'+fieldErr('age')+'</div>'+
      '<div class="pw-field">'+fieldLabel('性别',true)+'<div class="pw-radio-row">'+genderRadios+'</div>'+fieldErr('gender')+'</div>'+
      '<div class="pw-field">'+fieldLabel('地区',true)+'<input name="region" value="'+esc(raw.region||'')+'" placeholder="例如：马来西亚·吉隆坡" autocomplete="address-level1">'+fieldErr('region')+'</div>'+
      '<div class="pw-field">'+fieldLabel('联系方式',true)+'<input name="contact_phone" value="'+esc(raw.contact_phone||'')+'" placeholder="例如：WhatsApp 012-3456789" autocomplete="tel">'+'<p class="pw-field-hint">仅后台和客服可见，不会公开展示</p>'+fieldErr('contact_phone')+'</div>'+
      '<div class="pw-field">'+fieldLabel('主接游戏',true)+'<div class="pw-chip-grid">'+gameChecks+'</div>'+'<p class="pw-field-hint">可多选；至少选择一项</p>'+fieldErr('main_game')+'</div>'+
      '<div class="pw-field">'+fieldLabel('游戏 ID',true)+'<input name="game_id" value="'+esc(gameId)+'" placeholder="请输入游戏内昵称或 ID">'+fieldErr('game_id')+'</div>'+
      '<div class="pw-field">'+fieldLabel('段位',false)+'<input name="rank" value="'+esc(raw.game_rank||raw.rank||'')+'" placeholder="例如：无畏契约 超凡 2"></div>'+
      '<div class="pw-field">'+fieldLabel('擅长位置',false)+'<input name="position" value="'+esc(raw.position||'')+'" placeholder="例如：决斗 / 烟位 / 指挥"></div>'+
      '<div class="pw-field">'+fieldLabel('自定义单价',true)+
      '<div class="pw-price-meta"><div>当前等级：<strong>'+esc(levelLabel)+'</strong></div><div>可设置范围：<strong>'+esc(rangeText)+'</strong></div>'+
      (needsReset?'<div class="pw-field-error">需要重新设置：当前单价已超出等级范围，不能继续使用异常价格</div>':'')+
      '</div>'+
      '<input name="price" type="number" inputmode="decimal" step="0.01" min="0" value="'+(needsReset?'':esc(priceVal))+'" placeholder="请输入 RM'+esc(minP)+'–RM'+esc(maxP)+(maxPlus?'+':'')+' 之间的价格" data-min-price="'+esc(minP)+'" data-max-price="'+esc(maxP)+'" data-max-plus="'+(maxPlus?'1':'0')+'">'+
      fieldErr('price')+'</div>'+
      '<div class="pw-field">'+fieldLabel('个人介绍',false)+'<textarea name="bio" rows="4" placeholder="简单介绍你的技术、声音和陪玩风格">'+esc(p.bio||'')+'</textarea></div>'+
      '<button class="pw-btn primary" type="submit">保存并提交审核</button>'+
      '</form>';
  }
  function hallHtml(){
    var rows=(state.data&&state.data.openOrders)||[],perm=(state.data&&state.data.permissions)||{};
    var online=currentOnlineStatus()==='online';
    return '<div class="pw-page-head"><div><h2>抢单大厅</h2><p>只显示当前账号有资格查看的真实订单。</p></div></div>'+
      statusSwitcherHtml('compact')+
      (!online?'<div class="pw-empty" style="margin-bottom:12px"><strong>当前不可抢单</strong><span>请先在工作台将状态切换为「在线可接单」。</span></div>':'')+
      '<section class="pw-card-list">'+(rows.length?rows.map(function(o){
        var already=!!o.alreadyGrabbed||!!(o.myGrab&&o.myGrab.companionId);
        var disabled=!perm.canAcceptOrder||!online||already;
        var btnLabel=already?'已抢单，等待老板确认':(disabled?'暂不可接单':'立即抢单');
        return '<article class="pw-grab-card" data-order-id="'+esc(o.id)+'"><header><div><span class="pw-type">'+esc(o.orderType||'订单')+'</span><h3>'+esc(o.game||'-')+'</h3><p>'+esc(o.serviceContent||'-')+'</p></div><strong>'+money(o.amount||o.budget||0)+'</strong></header><div class="pw-order-meta"><div><span>老板</span><strong>'+esc(o.bossName||o.bossUid||'-')+'</strong></div><div><span>时长</span><strong>'+esc(o.duration||'-')+'</strong></div><div><span>预计收入</span><strong>'+money(o.playerIncome||0)+'</strong></div><div><span>所需等级</span><strong>'+esc(o.requiredLevel||'不限')+'</strong></div></div><p style="margin-top:12px;color:rgba(255,255,255,.7)">'+esc(o.requiredTags||'无特殊标签')+'</p><footer><button class="pw-btn primary" data-accept-order="'+esc(o.id)+'" '+(disabled?'disabled':'')+'>'+esc(btnLabel)+'</button></footer></article>';
      }).join(''):'<div class="pw-empty"><strong>暂无可抢订单</strong><span>客服发布订单后会自动显示。</span></div>')+'</section>';
  }
  function verificationHtml(){
    var v=(state.data&&state.data.verification)||{},d=(state.data&&state.data.deposit)||{},level=(state.data&&state.data.levelInfo)||{},p=(state.data&&state.data.player)||{};
    var rejectBits=[v.identityRejectReason,v.paymentRejectReason,v.applicationRejectReason,v.mediaRejectReason,v.depositRejectReason,d.rejectReason].filter(Boolean);
    return '<div class="pw-page-head"><div><h2>资料认证与押金</h2><p>认证资料和押金凭证会保存到后台审核。</p></div></div>'+
      (rejectBits.length?'<div class="pw-empty" style="margin-bottom:12px"><strong>审核驳回</strong><span>'+esc(rejectBits.join('；'))+'。请按原因重新提交。</span></div>':'')+
      '<section class="pw-grid"><article class="pw-card pw-metric"><span>身份认证</span><strong>'+esc(v.identityStatus||'未认证')+'</strong></article><article class="pw-card pw-metric"><span>结款账户</span><strong>'+esc(v.bankStatus||'未认证')+'</strong></article><article class="pw-card pw-metric"><span>押金</span><strong>'+esc(d.status||v.depositStatus||'未缴纳')+'</strong></article><article class="pw-card pw-metric"><span>当前等级</span><strong>'+esc(level.level||p.level||'未设置')+'</strong></article></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>当前抽成与返点</h3><div class="pw-info-list"><div><span>平台抽成</span><strong>'+esc((level.platformCommissionRate!=null?level.platformCommissionRate:level.orderCommissionRate!=null?level.orderCommissionRate:p.orderCommissionRate)||0)+'%</strong></div><div><span>礼物抽成</span><strong>'+esc(level.giftCommissionRate||p.giftCommissionRate||0)+'%</strong></div><div><span>直属陪返点</span><strong>'+esc(level.directRebateRate||p.directRebateRate||0)+'%</strong></div></div></section>'+
      '<form class="pw-card pad pw-form" style="margin-top:14px" data-verification-form><h3>提交认证资料</h3><label>真实姓名<input name="real_name" value="'+esc(v.realName||'')+'" required></label><label>身份证号码<input name="identity_no" required></label><label>身份证正面（可选，粘贴 dataURL 或稍后通过申请页上传）<input name="id_front" placeholder="data:image/... 或留空"></label><label>身份证反面<input name="id_back" placeholder="data:image/... 或留空"></label><label>联系方式<input name="phone" value="'+esc(v.phone||'')+'" required></label><label>银行名称<input name="bank_name" value="'+esc(v.bankName||'')+'" required></label><label>收款账号<input name="bank_account" required></label><label>TNG 账号<input name="tng_account"></label><label>备注<textarea name="remark"></textarea></label><button class="pw-btn primary" type="submit">提交认证审核</button></form>'+
      '<form class="pw-card pad pw-form" style="margin-top:14px" data-deposit-form><h3>提交押金凭证</h3><label>已缴金额 RM<input name="paid_amount" type="number" min="1" required></label><label>付款方式<input name="payment_method" required></label><label>付款凭证（图片 dataURL 或链接）<input name="proof_url" required></label><label>备注<textarea name="remark"></textarea></label><button class="pw-btn primary" type="submit">提交押金凭证</button></form>';
  }
  function hallGateMessage(){
    var st=currentOnlineStatus();
    return ({
      busy:'当前为「忙碌」，不能进入抢单大厅。忙碌时可处理进行中订单，但不接新单。',
      paused:'当前为「暂停接单」，不能进入抢单大厅。请先切换为「在线可接单」。',
      offline:'当前为「离线」，不能进入抢单大厅。请先切换为「在线可接单」。'
    })[st]||'请先将状态切换为「在线可接单」后再进入抢单大厅。';
  }
  function readFileAsDataUrl(file,kind){
    return new Promise(function(resolve,reject){
      if(!file)return reject(new Error('未选择文件'));
      var type=String(file.type||'').toLowerCase();
      var name=String(file.name||'');
      if(kind==='voice'){
        if(!/^audio\//.test(type) && !/\.(mp3|wav|m4a|webm|ogg|aac)$/i.test(name)){
          return reject(new Error('仅支持 mp3、wav、m4a、webm、ogg 音频'));
        }
        if(file.size>10*1024*1024)return reject(new Error('录音不能超过 10MB'));
      }else{
        if(!/image\/(jpeg|jpg|png|webp)/.test(type) && !/\.(jpe?g|png|webp)$/i.test(name)){
          return reject(new Error('仅支持 jpg、jpeg、png、webp 格式'));
        }
        if(file.size>5*1024*1024)return reject(new Error('单张图片不能超过 5MB'));
      }
      var reader=new FileReader();
      reader.onload=function(){resolve(String(reader.result||''))};
      reader.onerror=function(){reject(new Error(kind==='voice'?'读取录音失败，请重试':'读取图片失败，请重试'))};
      reader.readAsDataURL(file);
    });
  }
  function uploadImage(mediaType,file){
    state.uploadBusy=mediaType;
    paint();
    return readFileAsDataUrl(file,mediaType==='voice'?'voice':'image').then(function(dataUrl){
      var preview=document.querySelector('[data-avatar-preview]');
      if(mediaType==='avatar'&&preview)preview.src=dataUrl;
      return api('upload_media',{media_type:mediaType,data_url:dataUrl,filename:file.name||(mediaType==='voice'?'voice.webm':mediaType+'.jpg')});
    }).then(function(res){
      toast(res.message||'上传成功');
      state.uploadBusy='';
      return loadData();
    }).catch(function(err){
      state.uploadBusy='';
      paint();
      toast(err.message||'上传失败，请重试');
    });
  }
  function validateProfileForm(form){
    var fd=new FormData(form);
    var errors={};
    var nickname=String(fd.get('nickname')||'').trim();
    var age=Number(fd.get('age'));
    var gender=String(fd.get('gender')||'').trim();
    var region=String(fd.get('region')||'').trim();
    var contact=String(fd.get('contact_phone')||'').trim();
    var gameId=String(fd.get('game_id')||'').trim();
    var priceRaw=String(fd.get('price')||'').trim();
    var games=Array.prototype.map.call(form.querySelectorAll('input[name="main_game_opt"]:checked'),function(el){return el.value}).filter(Boolean);
    var priceInput=form.querySelector('[name="price"]');
    var minP=Number(priceInput&&priceInput.dataset.minPrice)||0;
    var maxP=Number(priceInput&&priceInput.dataset.maxPrice)||0;
    var maxPlus=priceInput&&priceInput.dataset.maxPlus==='1';
    if(!nickname)errors.nickname='请填写昵称';
    if(!Number.isFinite(age)||age<18||age>60)errors.age='年龄须为 18–60 的数字';
    if(!gender)errors.gender='请选择性别';
    if(!region)errors.region='请填写地区';
    if(!contact)errors.contact_phone='请填写联系方式';
    if(!games.length)errors.main_game='请至少选择一个主接游戏';
    if(!gameId)errors.game_id='请填写游戏 ID';
    if(!priceRaw)errors.price='请填写自定义单价';
    else if(!/^\d+(\.\d{1,2})?$/.test(priceRaw))errors.price='单价只能输入有效数字，最多保留 2 位小数';
    else {
      var price=Number(priceRaw);
      if(price<minP||(!maxPlus&&price>maxP))errors.price='单价必须在 RM'+minP+'–RM'+maxP+(maxPlus?'+':'')+' 之间';
    }
    state.profileErrors=errors;
    return {
      ok:!Object.keys(errors).length,
      payload:{
        nickname:nickname,
        age:String(age),
        gender:gender,
        region:region,
        contact_phone:contact,
        main_game:games.join('、'),
        game_id:gameId,
        rank:String(fd.get('rank')||'').trim(),
        position:String(fd.get('position')||'').trim(),
        bio:String(fd.get('bio')||'').trim(),
        price:priceRaw
      }
    };
  }
  function reorderGallery(mediaId,delta){
    var media=((state.data&&state.data.media)||[]).filter(function(m){return m.mediaType==='gallery'}).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
    var idx=media.findIndex(function(m){return String(m.id)===String(mediaId)});
    if(idx<0)return;
    var next=idx+delta;
    if(next<0||next>=media.length)return;
    var tmp=media[idx];media[idx]=media[next];media[next]=tmp;
    api('reorder_media',{ordered_ids:media.map(function(m){return m.id})}).then(function(res){toast(res.message||'顺序已更新');return loadData()}).catch(function(err){toast(err.message)});
  }
  document.addEventListener('click',function(e){
    var tab=e.target.closest('[data-auth-tab]');
    if(tab){state.authTab=tab.dataset.authTab==='register'?'register':'login';state.loginError='';paint();return}
    if(e.target.closest('[data-enter-hall]')){
      if(currentOnlineStatus()!=='online'){toast(hallGateMessage());return}
      go('/companion/order-hall');
      return;
    }
    var r=e.target.closest('[data-route]');
    if(r){
      if(r.dataset.route==='/companion/order-hall'&&currentOnlineStatus()!=='online'){toast(hallGateMessage());return}
      if(r.dataset.orderFilter)state.orderFilter=r.dataset.orderFilter;
      go(r.dataset.route);return;
    }
    if(e.target.closest('[data-account-toggle]')){e.target.closest('.pw-account').classList.toggle('open');return}
    if(e.target.closest('[data-logout]')){clearSession();go('/companion/login');return}
    if(e.target.closest('[data-forgot-password]')){var account=prompt('请输入陪玩 ID / 邮箱 / 手机号');if(account)api('forgot_password',{account:account}).then(function(x){toast(x.message||'已提交')}).catch(function(err){toast(err.message)});return}
    var accept=e.target.closest('[data-accept-order]');
    if(accept){
      if(!confirm('确认抢单？抢单后需等待老板选择，不会立即成为正式接单，也不能直接开始订单。'))return;
      api('accept_order',{id:accept.dataset.acceptOrder}).then(function(x){
        toast(x.message||'已抢单，等待老板确认');
        // Stay in grab hall — do not jump into formal order / start.
        state.route='hall';
        return loadData();
      }).catch(function(err){toast(err.message)});
      return;
    }
    var filterBtn=e.target.closest('[data-order-filter]');
    if(filterBtn){state.orderFilter=filterBtn.dataset.orderFilter||'all';paint();return}
    if(e.target.closest('[data-close-settlement]')){
      if(e.target.closest('[data-settlement-dialog]')&&!e.target.closest('.pw-dialog-head [data-close-settlement]'))return;
      state.settlement=null;paint();return;
    }
    var viewSettle=e.target.closest('[data-view-settlement]');
    if(viewSettle){
      var oid=viewSettle.dataset.viewSettlement;
      var local=((state.data&&state.data.myOrders)||[]).find(function(o){return String(o.id)===String(oid)});
      if(local&&local.settlement){state.settlement=local.settlement;paint();return}
      api('get_settlement',{id:oid},'GET').then(function(res){
        state.settlement=res.settlement;paint();
      }).catch(function(err){toast(err.message||'暂无结算详情')});
      return;
    }
    var action=e.target.closest('[data-order-action]');
    if(action){
      var act=action.dataset.orderAction;
      var oid=action.dataset.orderId;
      if(act==='accept_direct_order'){
        if(!confirm('确认接受此订单吗？'))return;
        api(act,{id:oid}).then(function(x){toast(x.message||'已确认接单');return loadData()}).catch(function(err){toast(err.message)});
        return;
      }
      if(act==='reject_direct_order'){
        var reason=prompt('请选择无法接单原因：\n'+REJECT_REASONS.map(function(r,i){return (i+1)+'. '+r}).join('\n')+'\n\n请输入序号 1-5，或直接输入原因','1');
        if(reason==null)return;
        var picked=REJECT_REASONS[Number(reason)-1]||String(reason).trim();
        if(!picked){toast('请选择无法接单原因');return}
        if(!confirm('确认无法接单？订单将交给客服重新安排，不会自动消失。'))return;
        api(act,{id:oid,reason:picked}).then(function(x){toast(x.message||'已提交无法接单');return loadData()}).catch(function(err){toast(err.message)});
        return;
      }
      if(act==='start_order'){
        if(!confirm('确认现在开始服务吗？'))return;
      }
      if(act==='complete_order'||act==='confirm_complete'){
        if(!confirm('确认本次服务已经完成吗？'))return;
      }
      api(act,{id:oid}).then(function(x){
        if(act==='complete_order'||act==='confirm_complete'){
          if(x.settlement){state.settlement=x.settlement;}
          toast(x.message||'已提交完成申请，等待老板确认');
        }else toast(x.message||'操作成功');
        return loadData();
      }).catch(function(err){toast(err.message)});
      return;
    }
    var online=e.target.closest('[data-online-status]');
    if(online){
      if(state.statusBusy)return;
      var next=online.dataset.onlineStatus;
      if(next===currentOnlineStatus())return;
      state.statusBusy=true;
      document.querySelectorAll('[data-online-status]').forEach(function(btn){
        btn.classList.toggle('is-active',btn.dataset.onlineStatus===next);
        btn.setAttribute('aria-checked',btn.dataset.onlineStatus===next?'true':'false');
      });
      var label=document.querySelector('[data-current-status-label]');
      if(label)label.textContent=(STATUS_META[next]&&STATUS_META[next].label)||next;
      api('set_online_status',{online_status:next}).then(function(x){
        if(state.data&&state.data.player){
          state.data.player.onlineStatus=x.onlineStatus||next;
          state.data.player.onlineStatusLabel=x.onlineStatusLabel||((STATUS_META[next]||{}).label);
          state.data.player.workStatus=state.data.player.onlineStatusLabel;
        }
        toast(x.message||'状态已更新');
        return loadData();
      }).catch(function(err){toast(err.message);return loadData()}).finally(function(){state.statusBusy=false});
      return;
    }
    if(e.target.closest('[data-delete-avatar]')){
      api('delete_media',{media_type:'avatar'}).then(function(x){toast(x.message||'头像已删除');return loadData()}).catch(function(err){toast(err.message)});
      return;
    }
    var del=e.target.closest('[data-delete-media]');
    if(del){
      api('delete_media',{media_id:del.dataset.deleteMedia}).then(function(x){toast(x.message||'已删除');return loadData()}).catch(function(err){toast(err.message)});
      return;
    }
    var move=e.target.closest('[data-gallery-move]');
    if(move){
      var item=move.closest('[data-media-id]');
      if(item)reorderGallery(item.dataset.mediaId,Number(move.dataset.galleryMove||0));
      return;
    }
    if(e.target.closest('[data-open-withdraw]')){
      var rules=(state.data&&state.data.withdrawalRules)||{},avail=((state.data&&state.data.earnings)||{}).withdrawable||0;
      var amount=prompt('当前可提现猫粮：'+avail+'\n预计到账比例：1 = '+(rules.exchangeRate||1)+' RM\n手续费：'+(rules.feeRm||0)+' + '+(rules.feePercent||0)+'%\n结款账户：'+(rules.currentAccount||'无')+'\n\n请输入提现猫粮数量');
      if(amount){
        var remark=prompt('提现备注（可选）','')||'';
        var accountId=(rules.approvedAccounts&&rules.approvedAccounts[0]&&rules.approvedAccounts[0].id)||'';
        api('request_withdrawal',{amount:amount,remark:remark,paymentAccountId:accountId}).then(function(x){toast(x.message||'已提交');return loadData()}).catch(function(err){toast(err.message)});
      }
      return;
    }
  });
  document.addEventListener('change',function(e){
    var avatarInput=e.target.closest('[data-upload-avatar]');
    if(avatarInput&&avatarInput.files&&avatarInput.files[0]){uploadImage('avatar',avatarInput.files[0]);avatarInput.value='';return}
    var galleryInput=e.target.closest('[data-upload-gallery]');
    if(galleryInput&&galleryInput.files&&galleryInput.files[0]){uploadImage('gallery',galleryInput.files[0]);galleryInput.value='';return}
    var voiceInput=e.target.closest('[data-upload-voice]');
    if(voiceInput&&voiceInput.files&&voiceInput.files[0]){uploadImage('voice',voiceInput.files[0]);voiceInput.value='';return}
  });
  document.addEventListener('focusin',function(e){
    var field=e.target.closest('.pw-profile-form input,.pw-profile-form textarea,.pw-profile-form select');
    if(!field)return;
    setTimeout(function(){try{field.scrollIntoView({behavior:'smooth',block:'center'})}catch(err){}},300);
  });
  document.addEventListener('submit',function(e){
    if(e.target.matches('[data-login]')){
      e.preventDefault();
      var form=e.target;var fd=new FormData(form);var btn=form.querySelector('[type="submit"]');var remember=true;
      state.loginError='';state.loginBusy=true;
      if(Auth&&Auth.setFormError)Auth.setFormError(form,'');else{var box=form.querySelector('[data-auth-error]');if(box)box.textContent='';}
      if(Auth&&Auth.setLoading)Auth.setLoading(btn,true);else if(btn){btn.disabled=true;btn.textContent='登录中…';}
      var account=String(fd.get('account')||'').trim();var password=String(fd.get('password')||'');
      var Gate=window.MCJRoleGate;
      var run=Gate&&typeof Gate.loginPortal==='function'?Gate.loginPortal('companion',account,password,remember):api('login',{account:account,password:password,remember:remember});
      run.then(function(res){
        var sess=res.session||{};
        if(sess.accessToken){saveSession({token:sess.accessToken,user:sess.user||{},remember:remember},remember);}
        else if(sess.token){saveSession(sess,remember);}
        state.loginBusy=false;state.loginError='';go('/companion/dashboard');return loadData();
      }).catch(function(err){
        state.loginBusy=false;
        state.loginError=(Gate&&Gate.humanizeAuthError?Gate.humanizeAuthError(err):null)||err.message||'账号或密码错误。';
        if(Auth&&Auth.setLoading)Auth.setLoading(btn,false,'登录');else if(btn){btn.disabled=false;btn.textContent='登录';}
        if(Auth&&Auth.setFormError)Auth.setFormError(form,state.loginError);else{var errBox=form.querySelector('[data-auth-error]');if(errBox)errBox.textContent=state.loginError;else toast(state.loginError);}
      });
      return;
    }
    if(e.target.matches('[data-register]')){
      e.preventDefault();
      var rf=e.target;var rd=new FormData(rf);
      var password=String(rd.get('password')||'');var confirm=String(rd.get('confirm_password')||'');
      if(!rd.get('agree')){toast('请先同意服务条款');return}
      if(password!==confirm){toast('两次输入的密码不一致');return}
      api('register',{email:String(rd.get('email')||'').trim(),nickname:String(rd.get('nickname')||'').trim(),phone:String(rd.get('phone')||'').trim(),password:password,remember:!!rd.get('remember')}).then(function(res){saveSession(res.session,!!rd.get('remember'));go('/companion/profile');return loadData()}).catch(function(err){toast(err.message)});
      return;
    }
    if(e.target.matches('[data-profile-form]')){
      e.preventDefault();
      var formEl=e.target;
      var checked=validateProfileForm(formEl);
      if(!checked.ok){
        formEl.querySelectorAll('[data-field-error]').forEach(function(n){n.remove()});
        Object.keys(state.profileErrors).forEach(function(key){
          var input=formEl.querySelector('[name="'+key+'"]')||formEl.querySelector('input[name="main_game_opt"]');
          var field=input&&input.closest('.pw-field');
          if(!field)return;
          var span=document.createElement('span');
          span.className='pw-field-error';
          span.setAttribute('data-field-error',key);
          span.textContent=state.profileErrors[key];
          field.appendChild(span);
        });
        toast('请完善必填资料');
        var firstErr=formEl.querySelector('.pw-field-error');
        if(firstErr){try{firstErr.scrollIntoView({behavior:'smooth',block:'center'})}catch(err){}}
        return;
      }
      api('update_profile',checked.payload).then(function(res){state.profileErrors={};toast(res.message||'资料已提交审核');return loadData()}).catch(function(err){
        if(err.message){
          var map={昵称:'nickname',年龄:'age',性别:'gender',地区:'region',联系方式:'contact_phone',主接游戏:'main_game','游戏 ID':'game_id','游戏ID':'game_id'};
          Object.keys(map).forEach(function(k){if(err.message.indexOf(k)!==-1)state.profileErrors[map[k]]=err.message});
        }
        toast(err.message||'保存失败');
        paint();
      });
      return;
    }
    if(e.target.matches('[data-verification-form]')){e.preventDefault();var vf=new FormData(e.target),vp={};vf.forEach(function(v,k){vp[k]=String(v||'')});api('submit_verification',vp).then(function(res){toast(res.message||'认证已提交');return loadData()}).catch(function(err){toast(err.message)});return}
    if(e.target.matches('[data-deposit-form]')){e.preventDefault();var df=new FormData(e.target),dp={};df.forEach(function(v,k){dp[k]=String(v||'')});api('submit_deposit_proof',dp).then(function(res){toast(res.message||'押金凭证已提交');return loadData()}).catch(function(err){toast(err.message)});return}
  });
  init();
})();

