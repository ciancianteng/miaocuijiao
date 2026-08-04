(function(){
  var root=document.getElementById('companionApp');
  if(!root)return;
  function fmtContentTime(v){
    if(window.MCJContentTime&&window.MCJContentTime.fmtContentTime)return window.MCJContentTime.fmtContentTime(v);
    if(!v)return '';
    try{
      return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)).replace(' ',' ');
    }catch(e){return String(v).slice(0,16).replace('T',' ')}
  }
  var ROUTES={
    '/companion/':'dashboard','/companion/login':'login','/companion/dashboard':'dashboard',
    '/companion/order-hall':'hall','/companion/orders':'orders',
    '/companion/earnings':'earnings','/companion/wallet':'earnings',
    '/companion/profile':'profile',
    '/companion/account':'account','/companion/mine':'account','/companion/verification':'account',
    '/companion/withdraw':'withdraw',
    '/companion/messages':'messages',
    '/companion/settings':'settings',
    '/companion/popularity':'popularity',
    '/companion/rules':'rules',
    '/companion/review-status':'review-status',
    '/companion/grab-hall':'hall'
  };
  var NAV=[
    ['dashboard','工作台','/companion/dashboard'],
    ['hall','抢单大厅','/companion/order-hall'],
    ['orders','我的订单','/companion/orders'],
    ['earnings','收益中心','/companion/earnings'],
    ['profile','我的资料（公开）','/companion/profile'],
    ['account','账号中心（隐私）','/companion/account'],
    ['messages','消息中心','/companion/messages'],
    ['settings','设置','/companion/settings']
  ];
  var BOTTOM_NAV=[
    ['dashboard','工作台','/companion/dashboard'],
    ['hall','抢单','/companion/order-hall'],
    ['orders','订单','/companion/orders'],
    ['earnings','收益','/companion/earnings'],
    ['account','账号','/companion/account']
  ];
  var ISOLATION_NAV=[
    ['review-status','审核状态','/companion/review-status'],
    ['profile','申请资料','/companion/profile'],
    ['account','账号资料','/companion/account']
  ];
  var ISOLATION_BOTTOM_NAV=[
    ['review-status','审核','/companion/review-status'],
    ['profile','资料','/companion/profile'],
    ['account','账号','/companion/account']
  ];
  var ISOLATION_ALLOWED_ROUTES={
    'review-status':1,'profile':1,'account':1,'mine':1,'verification':1,'login':1
  };
  var COMPANION_ISOLATION_MSG='您的陪玩认证尚未通过，目前只能查看审核进度。';
  var HIDDEN_MVP_ROUTES={};
  var state={route:'dashboard',session:null,data:null,notice:'',loading:false,error:'',walletWarning:'',authTab:'login',loginError:'',loginBusy:false,forgotStep:'',forgotAccount:'',forgotBusy:false,forgotMsg:'',forgotResetToken:'',profileServices:[],profileVoiceTypes:[],profileCompanionTags:[],profileErrors:{},profileDraft:null,accountDraft:null,uploadBusy:'',statusBusy:false,pendingOnlineStatus:null,settlement:null,orderFilter:'all',pollTimer:null,rulesPollTimer:null,ordersCacheAt:0,msgFilter:'all',settings:null,earningsTab:'overview',chatSession:'cs',chatConversationId:'',chatBusy:false,withdrawBusy:false,inbox:null,inboxError:'',hallOrderType:'all',hallGame:'all',_prevDesignated:null,_prevAuditLocked:null,_toastTimer:null};
  var SESSION_KEY='mcjCompanionSession';
  var SETTINGS_KEY='mcjCompanionSettings';
  var MSG_READ_KEY='mcjCompanionMsgRead';
  var Auth=window.MCJAuthShell;
  var STATUS_META={
    online:{emoji:'🟢',label:'在线接单',hint:'可以进入抢单大厅，也可以收到客服派单。'},
    busy:{emoji:'🟡',label:'忙碌',hint:'已有订单，不再收到新订单。'},
    paused:{emoji:'⏸',label:'暂停接单',hint:'暂时停止接单，但保留在线。'},
    offline:{emoji:'⚫',label:'离线',hint:'完全停止工作。'}
  };
  var WD_STATUS_TEXT={
    pending:'已提交',pending_review:'待周五结算',pending_friday:'待周五结算',submitted:'已提交',reviewing:'审核中',
    approved:'审核通过待打款',approved_pending_pay:'审核通过待打款',pending_payment:'审核通过待打款',paying:'审核通过待打款',
    paid_pending_receipt:'已打款',paid:'已打款',completed:'已完成',rejected:'已驳回',rolled_over:'顺延至下周',
    pay_failed:'付款失败',cancelled:'已取消'
  };
  var LEDGER_STATUS_CN={completed:'已完成',pending:'处理中',processing:'处理中',cancelled:'已取消',failed:'失败',rejected:'已拒绝'};
  function ledgerStatusCN(s){
    var v=String(s||'').trim();
    if(WD_STATUS_TEXT[v])return WD_STATUS_TEXT[v];
    var low=v.toLowerCase();
    return LEDGER_STATUS_CN[low]||v||'-';
  }
  var STATUS_CN={
    verification:function(s){
      var v=String(s||'').trim().toLowerCase();
      if(!v||/none|not_submitted|missing|unsubmitted|draft|uploaded/.test(v))return '资料未完成';
      if(/approved|verified|passed|active/.test(v))return '已通过';
      if(/reject|declin|fail/.test(v))return '审核未通过';
      if(/resubmit|need_more/.test(v))return '需补资料';
      if(/pending|review|submit/.test(v))return '审核中';
      return s||'资料未完成';
    },
    deposit:function(s){
      var v=String(s||'').trim().toLowerCase();
      if(!v||/none|not_submitted|missing|unsubmitted|draft|uploaded|unpaid/.test(v))return '未缴纳';
      if(/approved|verified|passed|paid|active|completed|received/.test(v))return '已通过';
      if(/reject|declin|fail/.test(v))return '审核未通过';
      if(/pending|review|submit/.test(v))return '待审核';
      return s||'未缴纳';
    },
    accountAccess:function(s){
      var v=String(s||'').trim().toLowerCase();
      if(!v)return '待审核';
      if(/approved|verified|passed|active/.test(v))return '可正常接单';
      if(/reject|declin|fail/.test(v))return '暂不可接单';
      if(/pending|review|submit/.test(v))return '审核中';
      return s||'待审核';
    }
  };
  var CONSULT_TYPE_CN={order_dock:'订单对接',profile_audit:'资料审核',deposit_auth:'押金认证',withdraw:'提现问题',earnings:'收益问题',other:'其他'};
  function consultTypeLabel(key){return CONSULT_TYPE_CN[key]||CONSULT_TYPE_CN.other}
  function unifiedAccess(){
    var p=(state.data&&state.data.player)||{};
    var d=(state.data&&state.data.deposit)||{};
    var v=(state.data&&state.data.verification)||{};
    var raw=p.raw||{};
    var perms=(state.data&&state.data.permissions)||{};
    var profileReview=String(p.profile_review_status||p.profileReviewStatus||p.auditStatus||raw.application_status||'').trim();
    var depositSt=String(p.deposit_status||p.depositStatus||d.status||v.depositStatus||raw.deposit_status||'').trim();
    var accessSt=String(p.account_access_status||p.accountAccessStatus||'').trim();
    var accessLabel=String(p.accountAccessLabel||'').trim();
    if(!accessSt){
      var profOk=/approved|verified|passed/.test(String(profileReview).toLowerCase());
      var depOk=/approved|verified|passed|paid|received/.test(String(depositSt).toLowerCase());
      if(profOk&&depOk)accessSt='approved';
      else if(/reject|declin|fail/.test(String(profileReview).toLowerCase())||/reject|declin|fail/.test(String(depositSt).toLowerCase()))accessSt='rejected';
      else accessSt='pending';
    }
    if(!accessLabel){
      if(accessSt==='approved'||perms.canWork===true)accessLabel='资料与押金均已通过，可正常接单。';
      else accessLabel=perms.lockReason||auditHint();
    }
    return {
      profile_review_status:profileReview,
      deposit_status:depositSt,
      account_access_status:accessSt,
      accountAccessLabel:accessLabel,
      canWork:perms.canWork===true
    };
  }
  function csConvList(inbox){
    inbox=inbox||state.inbox||{};
    if(Array.isArray(inbox.csConversations)&&inbox.csConversations.length)return inbox.csConversations;
    if(Array.isArray(inbox.conversations))return inbox.conversations.filter(function(c){return c&&c.type==='cs'&&c.id!=='cs'&&c.key!=='cs'});
    return [];
  }
  function activeCsConversation(inbox){
    var list=csConvList(inbox);
    var cid=String(state.chatConversationId||'').trim();
    if(cid){
      var hit=list.find(function(c){return String(c.id)===cid});
      if(hit)return hit;
    }
    if(inbox&&inbox.csConversationId){
      var byInbox=list.find(function(c){return String(c.id)===String(inbox.csConversationId)});
      if(byInbox)return byInbox;
    }
    return list.find(function(c){return !c.ended})||list[0]||null;
  }
  function inboxQueryParams(){
    var q={};
    if(state.chatConversationId)q.conversation_id=state.chatConversationId;
    return q;
  }
  var HALL_TYPE_FILTERS=[['all','全部'],['fixed','固定单'],['custom','自定义单']];
  var EARNINGS_TABS=[['overview','收入'],['withdraw','提现'],['records','流水']];
  var _audioCtx=null;
  function playCue(kind){
    if(!readSettings().sound)return;
    try{
      if(!_audioCtx)_audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      var ctx=_audioCtx;
      if(ctx.state==='suspended')ctx.resume();
      var now=ctx.currentTime;
      var osc=ctx.createOscillator();
      var gain=ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      var base={message:880,order:660,grab:520,audit:440}[kind]||660;
      osc.type=kind==='audit'?'sine':'triangle';
      osc.frequency.setValueAtTime(base,now);
      gain.gain.setValueAtTime(0.0001,now);
      if(kind==='message'){
        gain.gain.exponentialRampToValueAtTime(0.14,now+0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001,now+0.14);
        osc.start(now);osc.stop(now+0.15);
      }else if(kind==='order'){
        osc.frequency.setValueAtTime(base,now);
        osc.frequency.setValueAtTime(base*1.25,now+0.12);
        gain.gain.exponentialRampToValueAtTime(0.16,now+0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001,now+0.28);
        osc.start(now);osc.stop(now+0.3);
      }else if(kind==='grab'){
        osc.frequency.setValueAtTime(620,now);
        osc.frequency.exponentialRampToValueAtTime(980,now+0.1);
        gain.gain.exponentialRampToValueAtTime(0.18,now+0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001,now+0.22);
        osc.start(now);osc.stop(now+0.24);
      }else{
        gain.gain.exponentialRampToValueAtTime(0.12,now+0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001,now+0.45);
        osc.frequency.setValueAtTime(440,now);
        osc.frequency.setValueAtTime(660,now+0.15);
        osc.frequency.setValueAtTime(880,now+0.3);
        osc.start(now);osc.stop(now+0.48);
      }
    }catch(e){}
  }
  function readSettings(){
    try{return Object.assign({notify:true,sound:true,theme:'dark'},JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'))}catch(e){return {notify:true,sound:true,theme:'dark'}}
  }
  function saveSettings(next){state.settings=next;try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(next))}catch(e){}}
  function readMsgRead(){try{return JSON.parse(localStorage.getItem(MSG_READ_KEY)||'{}')}catch(e){return {}}}
  function markMsgRead(id){var map=readMsgRead();map[id]=1;try{localStorage.setItem(MSG_READ_KEY,JSON.stringify(map))}catch(e){}}
  function availableGames(){
    return availableServiceOptions().map(function(s){return s.name}).filter(Boolean);
  }
  function availableServiceOptions(){
    var list=[];
    var seen={};
    (state.profileServices||[]).forEach(function(s){
      var id=String((s&&s.id)||'').trim();
      var name=String((s&&(s.name||s.title))||'').trim();
      if(!id||!name||seen[id])return;
      seen[id]=1;
      list.push({id:id,name:name});
    });
    return list;
  }
  function selectedServiceIdsFromPlayer(p,raw){
    var ids=[];
    if(Array.isArray(p.serviceIds))ids=p.serviceIds.slice();
    else if(Array.isArray(p.service_ids))ids=p.service_ids.slice();
    else if(raw&&raw.service_ids){
      if(Array.isArray(raw.service_ids))ids=raw.service_ids.slice();
      else if(typeof raw.service_ids==='string'){
        try{ids=JSON.parse(raw.service_ids)}catch(e){ids=String(raw.service_ids).split(/[,，、/|]+/)}
      }
    }
    ids=(ids||[]).map(function(x){return String(x||'').trim()}).filter(Boolean);
    if(ids.length)return ids;
    var names=String(p.mainGame||raw.game||'').split(/[,，、/|]+/).map(function(x){return x.trim()}).filter(Boolean);
    var byName={};
    availableServiceOptions().forEach(function(s){byName[s.name]=s.id});
    return names.map(function(n){return byName[n]}).filter(Boolean);
  }
  function selectedServiceTypesFromPlayer(p,raw){
    var rawType=p.service_type||p.serviceType||(Array.isArray(p.serviceTypes)?p.serviceTypes.join(','):'')||raw.service_type||'';
    var types=String(rawType).split(/[,，、/|]+/).map(function(x){return String(x||'').trim()}).filter(Boolean).map(function(s){
      if(s==='陪玩服务'||s==='陪聊服务')return s;
      if(/陪聊|语音|语聊|聊天/.test(s))return '陪聊服务';
      if(/陪玩/.test(s))return '陪玩服务';
      return '';
    }).filter(Boolean);
    var uniq=[];
    types.forEach(function(t){if(uniq.indexOf(t)===-1)uniq.push(t)});
    if(!uniq.length&&(p.mainGame||raw.game||(p.serviceIds&&p.serviceIds.length)))uniq=['陪玩服务'];
    return uniq;
  }
  function num(v){var n=Number(v);return Number.isFinite(n)?n:0}
  function isIsolationMode(){
    var perms=(state.data||{}).permissions||{};
    if(perms.isolationMode===true)return true;
    if(perms.isolationMode===false)return false;
    if(!state.data)return false;
    var st=String(perms.applicationStatus||'').toLowerCase();
    if(!st){
      var ua=unifiedAccess();
      st=String(ua.profile_review_status||'').toLowerCase();
    }
    if(/approved|verified|passed/.test(st))return false;
    return true;
  }
  function isolationHint(){
    var perms=(state.data||{}).permissions||{};
    return perms.isolationMessage||COMPANION_ISOLATION_MSG;
  }
  function enforceIsolationRoute(opts){
    opts=opts||{};
    if(!state.session||!isIsolationMode())return false;
    if(ISOLATION_ALLOWED_ROUTES[state.route])return false;
    if(opts.toast!==false)toast(isolationHint());
    try{history.replaceState(null,'','/companion/review-status')}catch(e){}
    state.route='review-status';
    return true;
  }
  function isAuditLocked(){
    var perm=(state.data||{}).permissions||{};
    if(isIsolationMode())return true;
    return perm.canWork===false||perm.canSetAvailable===false||!!(state.data||{}).forcedAckRequired;
  }
  function auditHint(){
    var perm=(state.data||{}).permissions||{};
    var data=state.data||{};
    if(isIsolationMode())return isolationHint();
    if(data.forcedAckRequired||perm.forcedAckRequired)return perm.forcedAckReason||'请先阅读并确认最新强制公告后，才能切换状态、抢单或接单。';
    return perm.lockReason||'您的陪玩认证尚未通过，暂不可使用此功能。';
  }
  function collectRejectReasons(){
    var v=(state.data&&state.data.verification)||{};
    var d=(state.data&&state.data.deposit)||{};
    var p=(state.data&&state.data.player)||{};
    var bits=[];
    if(v.applicationRejectReason)bits.push('申请：'+v.applicationRejectReason);
    if(v.identityRejectReason)bits.push('实名：'+v.identityRejectReason);
    if(v.mediaRejectReason)bits.push('媒体：'+v.mediaRejectReason);
    if(v.paymentRejectReason)bits.push('收款：'+v.paymentRejectReason);
    if(v.depositRejectReason||d.rejectReason)bits.push('押金：'+(v.depositRejectReason||d.rejectReason));
    var lock=String(((state.data||{}).permissions||{}).lockReason||'');
    if(!bits.length&&/审核未通过|需补交资料|未通过/.test(lock))bits.push(lock);
    if(!bits.length&&p.applicationRejectReason)bits.push(String(p.applicationRejectReason));
    return bits;
  }
  function reviewStatusBannerHtml(){
    var ua=unifiedAccess();
    var st=String(ua.profile_review_status||'').toLowerCase();
    var v=(state.data&&state.data.verification)||{};
    var p=(state.data&&state.data.player)||{};
    var reason=String(v.applicationRejectReason||p.applicationRejectReason||'').trim();
    var emailPending='';
    try{
      var notices=((state.inbox&&state.inbox.systemNotices)||[]);
      var hit=notices.find(function(n){return /email_pending|邮件待发送/i.test(String(n.body||'')+String(n.title||''));});
      if(hit)emailPending='<span class="pw-note">邮件状态：email_pending（SMTP 未配置或发送失败，通知已写入消息中心）</span>';
    }catch(e){}
    if(/reject|declin|fail|resubmit|need_more/.test(st)){
      return '<div class="pw-alert" role="status" data-review-status-banner="rejected"><strong>审核未通过</strong><span>'+esc(reason||'请根据驳回原因修改后重新提交。')+'</span>'+emailPending+'<button class="pw-btn primary" type="button" data-route="/companion/profile">修改资料并重新提交</button></div>';
    }
    if(/approved|verified|passed/.test(st)){
      var can=!!(((state.data||{}).permissions||{}).canWork);
      if(can){
        return '<div class="pw-alert pw-privacy-review" role="status" data-review-status-banner="approved"><strong>恭喜，认证已通过</strong><span>您的接单权限已开放。</span>'+emailPending+'<button class="pw-btn primary" type="button" data-enter-hall>开始接单</button></div>';
      }
      return '<div class="pw-alert pw-privacy-review" role="status" data-review-status-banner="approved"><strong>恭喜，认证已通过</strong><span>'+esc(ua.accountAccessLabel||'认证已通过，请完善剩余接单条件。')+'</span>'+emailPending+'</div>';
    }
    if(/draft|none|not_submitted|missing|unsubmitted/.test(st)||!st){
      return '<div class="pw-alert" role="status" data-review-status-banner="draft"><strong>资料未完成</strong><span>请继续填写申请并保存草稿。审核通过前可登录，但不可接单。</span><button class="pw-btn" type="button" data-route="/companion/profile">继续填写</button></div>';
    }
    // pending / submitted / pending_review
    return '<div class="pw-alert" role="status" data-review-status-banner="pending"><strong>资料审核中</strong><span>已收到您的申请，请耐心等待后台审核。可查看资料、系统通知和联系客服。</span><button class="pw-btn" type="button" data-route="/companion/review-status">查看审核进度</button></div>';
  }
  function reviewRejectBannerHtml(ctaRoute){
    var ua=unifiedAccess();
    var audit=String(ua.profile_review_status||'').toLowerCase();
    var rejected=/reject|declin|fail|resubmit|need_more/.test(audit);
    if(!rejected)return '';
    var v=(state.data&&state.data.verification)||{};
    var p=(state.data&&state.data.player)||{};
    var reasonText=v.applicationRejectReason||p.applicationRejectReason||auditHint();
    var route=ctaRoute||'/companion/profile';
    return '<div class="pw-alert" role="status" data-review-reject-banner><strong>审核未通过</strong><span>'+esc(reasonText)+'</span><button class="pw-btn primary" type="button" data-route="'+esc(route)+'">修改资料并重新提交</button></div>';
  }
  function accountAccessBannerHtml(){
    var ua=unifiedAccess();
    var st=String(ua.account_access_status||'').toLowerCase();
    if(st==='approved'||ua.canWork){
      return '<div class="pw-alert pw-privacy-review" role="status"><strong>✅ 可正常接单</strong><span>'+esc(ua.accountAccessLabel||'资料与押金均已通过审核。')+'</span></div>';
    }
    if(/reject|declin|fail/.test(st)){
      return '<div class="pw-alert" role="status"><strong>暂不可接单</strong><span>'+esc(ua.accountAccessLabel||auditHint())+'</span></div>';
    }
    return '<div class="pw-note" style="margin:0 0 14px" role="status">'+esc(ua.accountAccessLabel||auditHint())+'</div>';
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function loadWorkRules(){
    state.rulesLoading=true;
    paint();
    return fetch('/api/platform/content?types=companion_work_rules',{cache:'no-store',headers:{Accept:'application/json'}})
      .then(function(r){return r.json()})
      .then(function(body){
        state.workRules=(((body||{}).byType||{}).companion_work_rules)||[];
        state.rulesLoading=false;
        paint();
      })
      .catch(function(){
        state.workRules=[];
        state.rulesLoading=false;
        paint();
      });
  }
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function humanId(v){
    var s=String(v==null?'':v).trim();
    if(!s)return '-';
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))return s.slice(0,8);
    return s;
  }
  function humanOrderNo(o){
    o=o||{};
    var no=o.orderNo||o.order_no;
    if(no)return no;
    return humanId(o.id);
  }
  function infoRow(label,value){return '<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>'}
  function cleanTip(t){
    var s=String(t||'').trim();
    if(!s||/regression|selector|grabber|uuid/i.test(s))return '';
    return s;
  }
  function orderNoLookup(){
    var map={};
    ((state.data&&state.data.myOrders)||[]).forEach(function(o){map[o.id]=humanOrderNo(o)});
    return map;
  }
  function unreadCount(){
    if(state.inbox&&typeof state.inbox.unreadTotal==='number')return state.inbox.unreadTotal;
    var s=(state.data||{}).summary||{};
    if(typeof s.unreadMessages==='number'&&s.unreadMessages>0)return s.unreadMessages;
    return buildInbox().filter(function(m){return m.unread}).length;
  }
  function route(){var p=location.pathname.replace(/\/$/,'')||'/companion';if(p==='/companion')p='/companion/';return ROUTES[p]||'dashboard'}
  function go(path){
    var next=String(path||'');
    if(isIsolationMode()&&state.session){
      var nextRoute=ROUTES[next.replace(/\/$/,'')]||ROUTES[next]||'';
      if(next.indexOf('/companion/grab-hall')>=0)nextRoute='hall';
      if(nextRoute&&!ISOLATION_ALLOWED_ROUTES[nextRoute]&&nextRoute!=='login'){
        toast(isolationHint());
        next='/companion/review-status';
      }
    }
    var leavingProfile=state.route==='profile'&&next.indexOf('/companion/profile')===-1;
    if(leavingProfile)state.profileDraft=null;
    var leavingAccount=isAccountRoute(state.route)&&!/\/companion\/(account|mine|verification)(\/|$)/.test(next);
    if(leavingAccount)state.accountDraft=null;
    history.pushState(null,'',next);paint();
  }
  function isAccountRoute(route){
    var r=route!=null?route:state.route;
    return r==='account'||r==='mine'||r==='verification';
  }
  function isEditingProfileForm(){
    if(state.route!=='profile')return false;
    var el=document.activeElement;
    if(el&&el.closest&&el.closest('[data-profile-form]'))return true;
    return !!state.profileDraft;
  }
  function isEditingAccountForm(){
    if(!isAccountRoute())return false;
    var el=document.activeElement;
    if(el&&el.closest&&el.closest('[data-private-contact-form],[data-verification-form],[data-deposit-form]'))return true;
    return !!state.accountDraft;
  }
  function isEditingLiveForm(){return isEditingProfileForm()||isEditingAccountForm()}
  function captureFieldFocus(form){
    var active=document.activeElement;
    var focus={};
    if(active&&form&&form.contains(active)){
      focus.name=active.name||'';
      focus.type=active.type||'';
      focus.value=active.value||'';
      if(typeof active.selectionStart==='number'){
        focus.selStart=active.selectionStart;
        focus.selEnd=active.selectionEnd;
      }
    }
    return focus;
  }
  function restoreFocusOnForm(form,focus){
    if(!form||!focus||!focus.name)return;
    var el=null;
    var nodes=form.querySelectorAll('[name="'+focus.name+'"]');
    if(focus.type==='radio'||focus.type==='checkbox'){
      Array.prototype.some.call(nodes,function(node){
        if(String(node.value)===String(focus.value||'')){el=node;return true}
        return false;
      });
      if(!el&&nodes.length)el=nodes[0];
    }else{
      el=nodes[0]||null;
    }
    if(!el||typeof el.focus!=='function')return;
    try{
      el.focus({preventScroll:true});
      if(typeof focus.selStart==='number'&&typeof el.setSelectionRange==='function'){
        el.setSelectionRange(focus.selStart,focus.selEnd!=null?focus.selEnd:focus.selStart);
      }
    }catch(e){}
  }
  function readProfileDraft(form){
    if(!form)return null;
    var fd=new FormData(form);
    var serviceTypes=Array.prototype.map.call(form.querySelectorAll('input[name="service_type_opt"]:checked'),function(el){return el.value}).filter(Boolean);
    var serviceIds=Array.prototype.map.call(form.querySelectorAll('input[name="service_id_opt"]:checked'),function(el){return el.value}).filter(Boolean);
    var gamePrices={};
    Array.prototype.forEach.call(form.querySelectorAll('[data-game-price-grid] input[name^="game_price_"]'),function(inp){
      var key=String(inp.name||'').replace(/^game_price_/,'');
      if(key)gamePrices[key]=String(inp.value||'');
    });
    return {
      nickname:String(fd.get('nickname')||''),
      age:String(fd.get('age')||''),
      gender:String(fd.get('gender')||''),
      region:String(fd.get('region')||''),
      public_tags:Array.prototype.map.call(form.querySelectorAll('input[name="public_tag_opt"]:checked'),function(el){return el.value}).filter(Boolean).join('、'),
      publicTagList:Array.prototype.map.call(form.querySelectorAll('input[name="public_tag_opt"]:checked'),function(el){return el.value}).filter(Boolean),
      bio:String(fd.get('bio')||''),
      voiceTypes:Array.prototype.map.call(form.querySelectorAll('input[name="voice_type_opt"]:checked'),function(el){return el.value}).filter(Boolean),
      game_id:String(fd.get('game_id')||''),
      rank:String(fd.get('rank')||''),
      position:String(fd.get('position')||''),
      serviceTypes:serviceTypes,
      serviceIds:serviceIds,
      gamePrices:gamePrices,
      focus:captureFieldFocus(form)
    };
  }
  function readAccountDraft(){
    var contact=document.querySelector('[data-private-contact-form]');
    var verify=document.querySelector('[data-verification-form]');
    var deposit=document.querySelector('[data-deposit-form]');
    if(!contact&&!verify&&!deposit)return state.accountDraft||null;
    var draft=state.accountDraft?Object.assign({},state.accountDraft):{};
    if(contact){
      var cfd=new FormData(contact);
      draft.contact_phone=String(cfd.get('contact_phone')||'');
    }
    if(verify){
      var vfd=new FormData(verify);
      ['real_name','identity_no','phone','bank_name','bank_account','tng_account','remark'].forEach(function(k){
        draft[k]=String(vfd.get(k)||'');
      });
    }
    if(deposit){
      var dfd=new FormData(deposit);
      draft.paid_amount=String(dfd.get('paid_amount')||'');
      draft.payment_method=String(dfd.get('payment_method')||'');
      draft.deposit_remark=String(dfd.get('remark')||'');
    }
    var activeForm=document.activeElement&&document.activeElement.closest
      ?document.activeElement.closest('[data-private-contact-form],[data-verification-form],[data-deposit-form]')
      :null;
    draft.focus=captureFieldFocus(activeForm);
    draft.focusForm=activeForm
      ?(activeForm.hasAttribute('data-private-contact-form')?'contact'
        :activeForm.hasAttribute('data-verification-form')?'verify':'deposit')
      :(draft.focusForm||'');
    return draft;
  }
  function captureLiveForms(force){
    var form=document.querySelector('[data-profile-form]');
    if(form){
      var active=document.activeElement;
      var focused=!!(active&&form.contains(active));
      // Snapshot while editing, when a draft already exists, or when forced (uploads / save).
      if(force||focused||state.profileDraft)state.profileDraft=readProfileDraft(form);
    }
    if(isAccountRoute()||document.querySelector('[data-private-contact-form],[data-verification-form],[data-deposit-form]')){
      var accActive=document.activeElement;
      var accFocused=!!(accActive&&accActive.closest&&accActive.closest('[data-private-contact-form],[data-verification-form],[data-deposit-form]'));
      if(force||accFocused||state.accountDraft)state.accountDraft=readAccountDraft();
    }
  }
  function restoreProfileFocus(){
    restoreFocusOnForm(document.querySelector('[data-profile-form]'),state.profileDraft&&state.profileDraft.focus);
  }
  function restoreAccountFocus(){
    var draft=state.accountDraft;
    if(!draft||!draft.focus)return;
    var sel=draft.focusForm==='contact'
      ?'[data-private-contact-form]'
      :(draft.focusForm==='deposit'?'[data-deposit-form]':'[data-verification-form]');
    restoreFocusOnForm(document.querySelector(sel),draft.focus);
  }
  function privacyReviewPhase(status,opts){
    opts=opts||{};
    var s=String(status||'').trim().toLowerCase();
    var submitted=!!opts.submitted;
    if(/approved|verified|passed|active|paid|completed/.test(s))return 'approved';
    if(/reject|declin|fail|resubmit|need_more/.test(s))return 'rejected';
    if(submitted&&/pending|review|submit/.test(s))return 'pending';
    return 'editable';
  }
  function privacyReviewBannerHtml(phase,rejectReason,kind){
    if(phase==='pending'){
      return '<div class="pw-alert pw-privacy-review" role="status" data-privacy-review="pending"><strong>✅ 已提交审核，等待后台审核。</strong><span>审核完成前不可再次提交，以下为已提交资料（只读）。</span></div>';
    }
    if(phase==='approved'){
      var approvedTitle=kind==='deposit'?'✅ 押金已通过审核。':(kind==='profile'?'✅ 资料已通过审核。':'✅ 已通过审核。');
      return '<div class="pw-alert pw-privacy-review" role="status" data-privacy-review="approved"><strong>'+approvedTitle+'</strong><span>如需变更请联系客服或等待后台开放修改。</span></div>';
    }
    if(phase==='rejected'){
      return '<div class="pw-alert pw-privacy-review" role="status" data-privacy-review="rejected"><strong>审核未通过</strong><span>'+esc(rejectReason||'请根据驳回原因修改后重新提交。')+'</span></div>';
    }
    return '';
  }
  function accountDraftVal(key,fallback){
    var d=state.accountDraft;
    if(d&&d[key]!=null)return String(d[key]);
    return fallback==null?'':String(fallback);
  }
  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null')}catch(e){return null}}
  function saveSession(session,remember){
    // Always dual-write so refresh + new tab keep companion login (incl. refreshToken).
    var normalized={
      token:String((session&&(session.token||session.accessToken||session.access_token))||'').trim(),
      accessToken:String((session&&(session.accessToken||session.token||session.access_token))||'').trim(),
      refreshToken:String((session&&(session.refreshToken||session.refresh_token))||'').trim(),
      expiresAt:(session&&(session.expiresAt!=null?session.expiresAt:session.expires_at))||'',
      user:(session&&session.user)||{},
      remember:remember!==false&&!(session&&session.remember===false)
    };
    if(!normalized.token&&!normalized.refreshToken)return;
    // P0: wipe boss/CS/admin soft sessions before claiming shared JWT mirrors.
    if(window.MCJRoleGate&&typeof window.MCJRoleGate.clearOtherRoleSessions==='function'){
      window.MCJRoleGate.clearOtherRoleSessions('companion');
      if(typeof window.MCJRoleGate.clearSharedAuthMirrors==='function')window.MCJRoleGate.clearSharedAuthMirrors();
    }else{
      ['customerAuthToken','customerUser','customerServiceAuthToken','customerServiceUser','mcjServiceSession','adminAuthToken','adminUser','mcjAuthAccessToken','mcjAuthRefreshToken','mcjAuthExpiresAt','mcjRole'].forEach(function(k){try{localStorage.removeItem(k);sessionStorage.removeItem(k);}catch(e){}});
    }
    var payload=JSON.stringify(normalized);
    try{localStorage.setItem(SESSION_KEY,payload);}catch(e){}
    try{sessionStorage.setItem(SESSION_KEY,payload);}catch(e){}
    try{
      var soft='companion_session_v4_'+Date.now();
      localStorage.setItem('companionAuthToken',soft);
      localStorage.setItem('companionUser',JSON.stringify(Object.assign({},normalized.user||{},{role:(normalized.user&&normalized.user.role)||'companion'})));
      localStorage.setItem('mcjRole','companion');
      if(normalized.token)localStorage.setItem('mcjAuthAccessToken',normalized.token);
      if(normalized.refreshToken)localStorage.setItem('mcjAuthRefreshToken',normalized.refreshToken);
      if(normalized.expiresAt!==''&&normalized.expiresAt!=null)localStorage.setItem('mcjAuthExpiresAt',String(normalized.expiresAt));
      sessionStorage.removeItem('companionAuthToken');
      sessionStorage.removeItem('companionUser');
      sessionStorage.removeItem('mcjRole');
      sessionStorage.removeItem('mcjAuthAccessToken');
      sessionStorage.removeItem('mcjAuthRefreshToken');
      sessionStorage.removeItem('mcjAuthExpiresAt');
    }catch(e){}
    state.session=normalized;
  }
  function clearSession(){
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    try{
      localStorage.removeItem('companionAuthToken');
      localStorage.removeItem('companionUser');
      sessionStorage.removeItem('companionAuthToken');
      sessionStorage.removeItem('companionUser');
      localStorage.removeItem('mcjAuthAccessToken');
      localStorage.removeItem('mcjAuthRefreshToken');
      localStorage.removeItem('mcjAuthExpiresAt');
      sessionStorage.removeItem('mcjAuthAccessToken');
      sessionStorage.removeItem('mcjAuthRefreshToken');
      sessionStorage.removeItem('mcjAuthExpiresAt');
      if(localStorage.getItem('mcjRole')==='companion'||localStorage.getItem('mcjRole')==='player'){
        localStorage.removeItem('mcjRole');
      }
    }catch(e){}
    state.session=null;
    state.data=null;
    if(window.MCJRoleGate&&typeof window.MCJRoleGate.logout==='function'){
      window.MCJRoleGate.logout('companion');
    }
  }
  function isAuthExpiredError(err){
    var msg=String((err&&err.message)||err||'');
    var status=Number(err&&err.status)||0;
    return status===401||/登录已过期|请先登录|登录态无效|jwt|token is expired|invalid jwt|unauthorized/i.test(msg);
  }
  var refreshPromise=null;
  function refreshCompanionSession(){
    if(refreshPromise)return refreshPromise;
    var session=state.session||readSession()||{};
    var refreshToken=String(session.refreshToken||session.refresh_token||'').trim();
    if(!refreshToken){
      clearSession();
      return Promise.reject(new Error('登录已过期，请重新登录。'));
    }
    refreshPromise=fetch('/api/auth',{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({action:'refresh',refreshToken:refreshToken})
    }).then(function(res){
      return res.text().then(function(text){
        var body={};try{body=text?JSON.parse(text):{}}catch(e){body={}}
        if(!res.ok||body.ok===false){
          clearSession();
          throw new Error(body.message||'登录已过期，请重新登录。');
        }
        var sess=body.session||{};
        saveSession({
          token:sess.accessToken||sess.token||'',
          refreshToken:sess.refreshToken||refreshToken,
          expiresAt:sess.expiresAt||sess.expires_at||'',
          user:sess.user||session.user||{},
          remember:session.remember!==false
        },session.remember!==false);
        return state.session;
      });
    }).catch(function(err){
      clearSession();
      throw err;
    }).finally(function(){refreshPromise=null});
    return refreshPromise;
  }
  function forceReLogin(message){
    clearSession();
    state.error='';
    state.loginError=message||'登录已过期，请重新登录。';
    go('/companion/login');
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
    // Avoid full paint: re-rendering the shell wipes in-progress profile/account forms.
    var host=root.querySelector('.pw-shell')||root;
    var existing=root.querySelector('.pw-toast');
    if(existing){
      existing.textContent=msg||'';
      existing.classList.add('show');
    }else if(host){
      var t=document.createElement('div');
      t.className='pw-toast show';
      t.textContent=msg||'';
      host.appendChild(t);
    }else{
      captureLiveForms();
      paint();
    }
    if(state._toastTimer)clearTimeout(state._toastTimer);
    state._toastTimer=setTimeout(function(){
      state.notice='';
      var el=root.querySelector('.pw-toast');
      if(el)el.remove();
    },2200);
  }
  function api(action,body,method,retried){
    var opts={method:method||'POST',headers:{'Content-Type':'application/json'}};
    var session=state.session||readSession();
    if(session&&session.token)opts.headers['x-mcj-companion-token']=session.token;
    var ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    if(ctrl){
      opts.signal=ctrl.signal;
      setTimeout(function(){try{ctrl.abort()}catch(e){}},18000);
    }
    var run;
    if(opts.method==='GET'){
      var qs='action='+encodeURIComponent(action);
      if(body&&typeof body==='object'){
        Object.keys(body).forEach(function(k){
          if(body[k]==null||body[k]==='')return;
          qs+='&'+encodeURIComponent(k)+'='+encodeURIComponent(body[k]);
        });
      }
      run=fetch('/api/companion?'+qs,opts);
    }else{
      opts.body=JSON.stringify(Object.assign({action:action},body||{}));
      run=fetch('/api/companion',opts);
    }
    return run.then(parseResponse).catch(function(err){
      if(err&&err.name==='AbortError')throw new Error('请求超时，请重试');
      if(!retried&&isAuthExpiredError(err)){
        return refreshCompanionSession().then(function(){
          return api(action,body,method,true);
        }).catch(function(refreshErr){
          forceReLogin((refreshErr&&refreshErr.message)||'登录已过期，请重新登录。');
          throw refreshErr;
        });
      }
      throw err;
    });
  }
  function parseResponse(res){
    return res.text().then(function(text){
      var body={};
      try{body=text?JSON.parse(text):{}}catch(e){throw new Error('接口返回格式错误')}
      if(!res.ok||body.ok===false){
        var err=new Error(body.message||('请求失败：HTTP '+res.status));
        err.status=res.status;
        throw err;
      }
      return body;
    });
  }
  function loadProfileServices(){
    return fetch('/api/platform/services?scope=profile',{headers:{Accept:'application/json'},cache:'no-store'})
      .then(function(res){return res.json().catch(function(){return {ok:false,services:[],message:'游戏列表读取失败'}})})
      .then(function(body){
        state.profileServices=(body&&body.services)||[];
        if(body&&body.source==='missing_table'){
          state.walletWarning=body.message||'游戏列表未初始化，请联系管理员执行 services 迁移。';
        }else if(body&&body.ok===false&&body.message){
          state.walletWarning=body.message;
        }
      })
      .catch(function(){state.profileServices=[];});
  }
  function loadProfileVoiceTypes(){
    return fetch('/api/platform/content?types=voice_types,companion_tags',{headers:{Accept:'application/json'},cache:'no-store'})
      .then(function(res){return res.json().catch(function(){return {ok:false,byType:{}}})})
      .then(function(body){
        var rows=(body&&body.byType&&body.byType.voice_types)||[];
        state.profileVoiceTypes=(rows||[]).map(function(item){
          return {
            id:String(item.id||''),
            name:String(item.name||item.title||'').trim(),
            enabled:item.enabled!==false
          };
        }).filter(function(item){return item.name&&item.enabled!==false;});
        var tags=(body&&body.byType&&body.byType.companion_tags)||[];
        state.profileCompanionTags=(tags||[]).map(function(item){
          return {
            id:String(item.id||''),
            name:String(item.name||item.title||'').trim(),
            enabled:item.enabled!==false
          };
        }).filter(function(item){return item.name&&item.enabled!==false;});
      })
      .catch(function(){state.profileVoiceTypes=[];state.profileCompanionTags=[];});
  }
  function selectedPublicTagsFromPlayer(p,raw,draft){
    if(draft&&Array.isArray(draft.publicTagList))return draft.publicTagList.slice();
    var publicTags=draft&&draft.public_tags!=null?String(draft.public_tags):(String(p.publicTags||'').trim()||String(raw.public_tags||'').trim());
    if(!publicTags&&!(draft&&draft.public_tags!=null)){
      publicTags=String(p.tags||raw.tags||'').replace(/\[\[MCJ_[^\]]+\]\]/g,'').replace(/游戏ID:[^,，]*/g,'').split(/[,，、]/).map(function(x){return x.trim()}).filter(function(x){return x;}).join('、');
    }
    return String(publicTags||'').split(/[,，、|/]+/).map(function(x){return String(x||'').trim()}).filter(Boolean);
  }
  function selectedVoiceTypesFromPlayer(p,raw){
    var rawVoice=String((p&&p.voiceType)||(p&&p.voice_type)||(raw&&raw.voice_type)||'').trim();
    if(!rawVoice)return [];
    return rawVoice.replace(/^声线\s*[:：]\s*/,'').split(/[,，、|/]+/).map(function(x){return String(x||'').trim()}).filter(Boolean);
  }
  function mergeWithdrawals(primary,fallback){
    var byId={};
    (primary||[]).forEach(function(w){if(w&&w.id)byId[String(w.id)]=Object.assign({},w)});
    (fallback||[]).forEach(function(w){
      if(!w||!w.id)return;
      var id=String(w.id);
      byId[id]=Object.assign({},byId[id]||{},w,{
        accountLast4:(byId[id]&&byId[id].accountLast4)||w.accountLast4||'',
        paidAt:(byId[id]&&byId[id].paidAt)||w.paidAt||'',
        reviewedAt:(byId[id]&&byId[id].reviewedAt)||w.reviewedAt||''
      });
    });
    return Object.keys(byId).map(function(k){return byId[k]}).sort(function(a,b){
      return String(b.submittedAt||b.createdAt||'').localeCompare(String(a.submittedAt||a.createdAt||''));
    });
  }
  function reloadInbox(){
    if(!state.session||!state.session.token)return Promise.resolve();
    state.inboxError='';
    return api('inbox',inboxQueryParams(),'GET').then(function(res){
      if(res&&res.ok){
        var data=res.data||res.inbox||emptyInboxShell();
        if(data.connectError&&!data.csConversationId&&!csConvList(data).length){
          state.inbox=Object.assign(emptyInboxShell(),data,{_placeholder:true});
          state.inboxError=data.connectError;
        }else{
          state.inbox=data;
          state.inboxError=data.connectError||'';
        }
        if(!state.chatConversationId&&state.inbox.csConversationId){
          state.chatConversationId=String(state.inbox.csConversationId);
        }
        if(data.csTransferring||(data.conversations||[]).some(function(c){return /更换客服/.test(String(c.subtitle||c.lastMessage||''));})){
          toast('正在为你更换客服。');
        }
        if(state.data&&state.data.summary&&state.inbox){
          state.data.summary.unreadMessages=num(state.inbox.unreadTotal);
        }
      }else{
        state.inboxError=(res&&res.message)||'客服连接失败';
        if(!state.inbox)state.inbox=emptyInboxShell();
      }
    }).catch(function(err){
      state.inboxError=(err&&err.message)||'客服连接失败，请重试';
      if(!state.inbox)state.inbox=emptyInboxShell();
    }).then(function(){
      paint({preserveScroll:true});
      bindCompanionChatRealtime();
    });
  }
  function emptyInboxShell(){
    return {
      conversations:[],
      csConversations:[],
      csConversationId:'',
      messages:[],
      systemNotices:[],
      unreadTotal:0,
      unreadMessages:0,
      _placeholder:true
    };
  }
  function optimisticClearSessionUnread(sessionKey){
    if(!state.inbox)return;
    if(sessionKey==='cs'){
      var cid=companionCsConversationId();
      csConvList(state.inbox).forEach(function(c){
        if(!cid||String(c.id)===cid)c.unread=0;
      });
      (state.inbox.conversations||[]).forEach(function(c){
        if(c.type==='cs'&&(!cid||String(c.id)===cid))c.unread=0;
      });
      (state.inbox.messages||[]).forEach(function(m){
        if(m.senderRole!=='companion'&&!m.readAt)m.readAt=new Date().toISOString();
      });
    }else if(sessionKey==='system'){
      (state.inbox.systemNotices||[]).forEach(function(n){n.unread=false});
      (state.inbox.conversations||[]).forEach(function(c){
        if(c.key==='system'||c.type==='system')c.unread=0;
      });
    }
    var csUnread=csConvList(state.inbox).reduce(function(sum,c){return sum+num(c.unread)},0);
    var sys=(state.inbox.systemNotices||[]).filter(function(n){return n.unread}).length;
    state.inbox.unreadTotal=csUnread+sys;
    state.inbox.unreadMessages=state.inbox.unreadTotal;
    if(state.data&&state.data.summary)state.data.summary.unreadMessages=state.inbox.unreadTotal;
  }
  function markActiveChatSessionRead(){
    if(!state.session||!state.session.token)return Promise.resolve();
    if(state.route!=='messages')return Promise.resolve();
    var session=state.chatSession==='system'?'system':'cs';
    optimisticClearSessionUnread(session);
    paint();
    if(session==='cs'){
      var readCid=companionCsConversationId();
      return api('mark_cs_read',readCid?{conversation_id:readCid}:{}).then(function(){return reloadInbox()}).catch(function(){return reloadInbox()});
    }
    var keys=[];
    if(state.inbox&&Array.isArray(state.inbox.systemNotices)){
      keys=state.inbox.systemNotices.map(function(n){return n.key||n.id}).filter(Boolean);
    }else{
      keys=buildInbox().map(function(m){return m.id});
    }
    keys.forEach(function(k){markMsgRead(k)});
    if(!keys.length)return reloadInbox();
    return api('mark_notices_read',{keys:keys}).then(function(){return reloadInbox()}).catch(function(){return reloadInbox()});
  }
  function loadData(opts){
    opts=opts||{};
    if(!state.session||!state.session.token)return Promise.resolve();
    var soft=!!opts.soft||!!state.data;
    if(!soft){state.loading=true;paint();}
    var boot=api('bootstrap',{},'GET');
    var isolatedGuess=isIsolationMode()||state.route==='review-status';
    var needWallet=!isolatedGuess&&(state.route==='earnings'||state.route==='withdraw'||state.route==='account'||state.route==='wallet');
    var walletReq=needWallet
      ? api('wallet',{},'GET').catch(function(err){
          if(err&&(err.status===403||/尚未通过|只能查看审核进度|COMPANION_ISOLATED/i.test(String(err.message||''))))return {ok:false,_isolated:true,message:err.message};
          return null;
        })
      : Promise.resolve(null);
    var inboxReq=api('inbox',inboxQueryParams(),'GET').catch(function(){return null});
    return Promise.all([boot,loadProfileServices(),loadProfileVoiceTypes(),walletReq,inboxReq]).then(function(results){
      var result=results[0]||{};
      var walletResult=results[3];
      var inboxResult=results[4];
      state.data=Object.assign({},state.data||{},result.data||{});
      state.ordersCacheAt=Date.now();
      if(inboxResult&&inboxResult.ok){
        state.inbox=inboxResult.data||inboxResult.inbox||emptyInboxShell();
        state.inboxError='';
      }else if(!state.inbox){
        state.inbox=emptyInboxShell();
        state.inboxError=(inboxResult&&inboxResult.message)||'客服连接失败，请点重新连接';
        // Retry once in background
        setTimeout(function(){reloadInbox()},400);
      }
      if(walletResult&&walletResult.ok&&walletResult.data){
        state.data.summary=walletResult.data.summary||state.data.summary;
        state.data.earnings=walletResult.data.earnings||state.data.earnings;
        state.data.walletLedger=walletResult.data.walletLedger||state.data.walletLedger||[];
        state.data.earningDetails=walletResult.data.earningDetails||state.data.earningDetails||[];
        state.data.withdrawals=mergeWithdrawals(walletResult.data.withdrawals,state.data.withdrawals)||[];
        if(walletResult.data.withdrawalRules){
          state.data.withdrawalRules=Object.assign({},state.data.withdrawalRules||{},walletResult.data.withdrawalRules);
        }
      }
      // Do not treat informational/server notice as fatal page error when data exists.
      state.error='';
      state.walletWarning=(walletResult&&walletResult.data&&walletResult.data.warnings&&walletResult.data.warnings[0])
        || (result.data&&result.data.walletWarnings&&result.data.walletWarnings[0])
        || '';
      if(window.MCJCompanionForcedAck&&window.MCJCompanionForcedAck.refreshFromBootstrap){
        window.MCJCompanionForcedAck.refreshFromBootstrap(state.data);
      }
      var sInit=(state.data||{}).summary||{};
      if(state._prevDesignated==null)state._prevDesignated=num(sInit.waitingConfirm||sInit.designatedPending);
      var auditNow=isAuditLocked();
      if(state._prevAuditLocked==null)state._prevAuditLocked=auditNow;
      else if(state._prevAuditLocked===true&&auditNow===false)playCue('audit');
      state._prevAuditLocked=auditNow;
      if(isIsolationMode()){
        // Strip any residual business payloads client-side as defense in depth.
        state.data.openOrders=[];
        state.data.myOrders=[];
        state.data.earningDetails=[];
        state.data.walletLedger=[];
        state.data.withdrawals=[];
        state.data.popularity=null;
        if(enforceIsolationRoute({toast:!!opts.fromManualNav})){
          /* route corrected */
        }
      }else if(state.route==='review-status'){
        // Approved: leave isolation home for real workbench.
        try{history.replaceState(null,'','/companion/dashboard')}catch(e){}
        state.route='dashboard';
      }
      if(state.route==='rules')loadWorkRules();
    }).catch(function(err){
      // Auth expired: refresh path already tried inside api(); force re-login instead of blank "数据源未就绪".
      if(isAuthExpiredError(err)){
        forceReLogin(err.message||'登录已过期，请重新登录。');
        return;
      }
      // Keep previous data if any; wallet page must still show zeros instead of blank failure.
      state.error=err.message||'陪玩端数据读取失败';
      if(state.route==='earnings'||state.route==='withdraw'||state.route==='account'||state.route==='wallet'){
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
          if(isAuthExpiredError(walletErr)){
            forceReLogin(walletErr.message||'登录已过期，请重新登录。');
            return;
          }
          state.data=Object.assign({},state.data||{},{
            summary:{todayIncome:0,monthIncome:0,totalIncome:0,withdrawable:0,frozen:0,withdrawn:0},
            earnings:{todayIncome:0,monthIncome:0,totalIncome:0,withdrawable:0,available:0,frozen:0,withdrawn:0},
            walletLedger:[],
            withdrawals:[],
            withdrawalRules:{minAmount:0,monthlyLimit:0,remainingThisMonth:0,exchangeRate:1},
            permissions:(state.data&&state.data.permissions)||{}
          });
          state.walletWarning=walletErr.message||state.error;
          if(state.route==='earnings'||state.route==='withdraw'||state.route==='account'||state.route==='wallet')state.error='';
        });
      }
    }).finally(function(){
      state.loading=false;
      // Keep in-progress public/privacy form edits while soft-syncing in background.
      if(opts.soft&&isEditingLiveForm()&&!opts.forcePaint){
        if(state.route==='messages')markActiveChatSessionRead();
        bindCompanionChatRealtime();
        return;
      }
      paint({preserveScroll:!!opts.preserveScroll||!!opts.forcePaint||isEditingLiveForm()});
      if(state.route==='messages')markActiveChatSessionRead();
      bindCompanionChatRealtime();
    });
  }
  function startPoll(){
    if(state.pollTimer)clearInterval(state.pollTimer);
    state.pollTimer=setInterval(function(){
      if(!state.session||!state.session.token||document.hidden||state.statusBusy)return;
      if(isIsolationMode()){
        if(['review-status','profile','account'].indexOf(state.route)===-1)return;
        var tickIso=Number(state._pollTick||0)+1;
        state._pollTick=tickIso;
        if(tickIso%3!==0){
          api('inbox',inboxQueryParams(),'GET').then(function(res){
            if(res&&res.ok){
              state.inbox=res.data||res.inbox||null;
              if(!isEditingLiveForm())paint({preserveScroll:true});
            }
          }).catch(function(){});
          return;
        }
        api('bootstrap',{},'GET').then(function(result){
          state.data=Object.assign({},state.data||{},result.data||{});
          if(isIsolationMode()){
            state.data.openOrders=[];
            state.data.myOrders=[];
            state.data.earningDetails=[];
            state.data.walletLedger=[];
            state.data.withdrawals=[];
            state.data.popularity=null;
          }else{
            try{history.replaceState(null,'','/companion/dashboard')}catch(e){}
            state.route='dashboard';
            playCue('audit');
          }
          if(!isEditingLiveForm())paint({preserveScroll:true});
        }).catch(function(){});
        return;
      }
      if(['dashboard','hall','orders','earnings','profile','account','messages'].indexOf(state.route)===-1)return;
      var editingLive=isEditingLiveForm();
      var heavy=['hall','orders','dashboard'].indexOf(state.route)>-1;
      var tick=Number(state._pollTick||0)+1;
      state._pollTick=tick;
      if(!heavy&&tick%3!==0){
        if(state.route==='messages'){
          api('inbox',inboxQueryParams(),'GET').then(function(res){
            if(res&&res.ok){
              state.inbox=res.data||res.inbox||null;
              if(state.data&&state.data.summary&&state.inbox)state.data.summary.unreadMessages=num(state.inbox.unreadTotal);
              bindCompanionChatRealtime();
            }
            if(!editingLive)paint({preserveScroll:true});
          }).catch(function(){});
        }
        return;
      }
      api('bootstrap',{},'GET').then(function(result){
        state.data=Object.assign({},state.data||{},result.data||{});
        state.ordersCacheAt=Date.now();
        state.error='';
        var s=(state.data||{}).summary||{};
        var designated=num(s.waitingConfirm||s.designatedPending);
        if(state._prevDesignated!=null&&designated>state._prevDesignated)playCue('order');
        state._prevDesignated=designated;
        if(editingLive||isEditingLiveForm())return;
        if(state.route==='messages'){
          return api('inbox',inboxQueryParams(),'GET').then(function(res){
            if(res&&res.ok){
              state.inbox=res.data||res.inbox||null;
              if(state.data&&state.data.summary&&state.inbox)state.data.summary.unreadMessages=num(state.inbox.unreadTotal);
              bindCompanionChatRealtime();
            }
            var session=state.chatSession==='system'?'system':'cs';
            var csUnread=session==='cs'?num((activeCsConversation(state.inbox)||{}).unread):0;
            var needMark=session==='cs'?csUnread>0:((state.inbox&&state.inbox.systemNotices)||[]).some(function(n){return n.unread});
            paint({preserveScroll:true});
            if(needMark)return markActiveChatSessionRead();
          }).catch(function(){paint({preserveScroll:true})});
        }
        paint({preserveScroll:true});
      }).catch(function(){});
    },8000);
  }
  function companionCsConversationId(){
    if(state.chatConversationId)return String(state.chatConversationId);
    if(state.inbox&&state.inbox.csConversationId)return String(state.inbox.csConversationId);
    var active=activeCsConversation(state.inbox);
    return active&&active.id?String(active.id):'';
  }
  function bindCompanionChatRealtime(){
    var RT=window.MCJChatRealtime;
    var cid=companionCsConversationId();
    var token=state.session&&state.session.token;
    if(!RT||!cid||!token)return;
    if(state._rtBoundCid===cid)return;
    state._rtBoundCid=cid;
    if(typeof RT.unsubscribeAll==='function')RT.unsubscribeAll();
    RT.subscribeMessages(cid,token,function(row){
      if(!row||!row.id)return;
      if(!state.inbox)state.inbox={messages:[],conversations:[]};
      var list=state.inbox.messages=Array.isArray(state.inbox.messages)?state.inbox.messages:[];
      if(list.some(function(m){return String(m.id)===String(row.id)}))return;
      var role=String(row.sender_role||'');
      var view={
        id:row.id,
        conversationId:row.conversation_id||cid,
        content:row.content||'',
        senderRole:role,
        senderLabel:role==='companion'?'我':(role==='customer_service'?'客服':'系统'),
        side:role==='companion'?'right':'left',
        createdAt:row.created_at||new Date().toISOString(),
        messageType:row.message_type||'text',
        mediaUrl:row.media_url||row.image_url||''
      };
      state.inbox.messages=list.filter(function(m){
        if(!(m._pending||m._failed))return true;
        return !(m.content===view.content&&(m.senderRole==='companion'||m.side==='right'));
      }).concat([view]);
      if(role!=='companion')playCue('message');
      if(state.route==='messages')paint();
    }).catch(function(){ state._rtBoundCid=''; });
  }
  function init(){
    state.settings=readSettings();
    state.session=readSession();
    state.route=route();
    if(!state.session&&state.route!=='login'){go('/companion/login');return}
    if(state.session&&state.route==='login'){
      try{history.replaceState(null,'','/companion/review-status')}catch(e){}
      state.route='review-status';
    }
    if(state.session){
      if(window.MCJCompanionAnnouncements&&window.MCJCompanionAnnouncements.start)window.MCJCompanionAnnouncements.start();
      loadData().then(function(){startPoll();bindCompanionChatRealtime();});
    }else paint();
  }
  window.addEventListener('popstate',init);
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden&&state.session){
      // Soft sync only — do not force-paint over an in-progress profile edit.
      loadData({soft:true});
    }
  });
  function captureScrollPos(){
    var main=document.querySelector('.pw-main');
    var page=document.querySelector('.pw-page');
    return {
      winY:window.scrollY||document.documentElement.scrollTop||0,
      mainY:main?main.scrollTop:0,
      pageY:page?page.scrollTop:0
    };
  }
  function restoreScrollPos(pos){
    if(!pos)return;
    var apply=function(){
      try{window.scrollTo(0,pos.winY||0)}catch(e){}
      var main=document.querySelector('.pw-main');
      var page=document.querySelector('.pw-page');
      if(main&&pos.mainY!=null)main.scrollTop=pos.mainY;
      if(page&&pos.pageY!=null)page.scrollTop=pos.pageY;
    };
    apply();
    requestAnimationFrame(function(){apply();requestAnimationFrame(apply)});
  }
  function paint(opts){
    opts=opts||{};
    var keepScroll=!!opts.preserveScroll||!!state._preserveScrollOnce||isEditingLiveForm()||isAccountRoute()||state.route==='profile'||state.route==='messages'||state.route==='review-status';
    state._preserveScrollOnce=false;
    var scrollPos=keepScroll?captureScrollPos():null;
    if(keepScroll&&(isAccountRoute()||state.route==='profile'))state._skipFocusScrollOnce=true;
    captureLiveForms();
    state.route=route();
    if(state.route!=='profile')state.profileDraft=null;
    if(!isAccountRoute())state.accountDraft=null;
    if(state.session&&isIsolationMode()){
      enforceIsolationRoute({toast:!!opts.fromManualNav});
    }
    if(state.route==='popularity'){
      if(isIsolationMode()){
        enforceIsolationRoute({toast:true});
      }else{
        state.route='dashboard';
        try{history.replaceState(null,'','/companion/dashboard');}catch(e){}
        state.notice='人气榜在首页展示，陪玩端不需要单独页。';
        setTimeout(function(){state.notice='';paint()},2200);
      }
    }
    if(state.route==='rules'){
      if(isIsolationMode()){
        enforceIsolationRoute({toast:true});
      }else if(!state.rulesPollTimer){
        state.rulesPollTimer=setInterval(function(){
          if(state.route==='rules')loadWorkRules();
        },20000);
      }
    }else if(state.rulesPollTimer){
      clearInterval(state.rulesPollTimer);
      state.rulesPollTimer=null;
    }
    if(state.route==='withdraw'){
      if(isIsolationMode()){
        enforceIsolationRoute({toast:true});
      }else{
        state.earningsTab='withdraw';
        try{history.replaceState(null,'','/companion/earnings')}catch(e){}
        state.route='earnings';
      }
    }
    if(state.route==='login')return renderLogin();
    if(!state.session){renderLogin();return}
    renderShell();
    if(scrollPos)restoreScrollPos(scrollPos);
  }
  function noticeHtml(){return state.notice?'<div class="pw-toast show">'+esc(state.notice)+'</div>':''}
  function forgotPasswordModalHtml(){
    // Shared MCJForgotPassword overlay owns the recovery UI.
    return '';
  }
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
      '<button class="mcj-auth-btn ghost" type="button" data-forgot-password data-forgot-role="companion">忘记密码</button>'+
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
      '</section></main>'+forgotPasswordModalHtml();
    if(Auth&&Auth.bindPasswordToggles)Auth.bindPasswordToggles(root);
  }
  function title(){return ({dashboard:'工作台',hall:'抢单大厅',orders:'我的订单',earnings:'收益中心',wallet:'收益中心',profile:isIsolationMode()?'申请资料':'我的资料（公开）',account:isIsolationMode()?'账号资料':'账号中心（隐私）',mine:'账号中心（隐私）',withdraw:'提现',messages:'消息中心',settings:'设置',popularity:'我的人气',rules:'陪玩规则','review-status':'审核状态'})[state.route]||'陪玩端'}
  function maintenanceHtml(name){return '<div class="pw-page-head"><div><h2>'+esc(name||'模块已合并')+'</h2><p>该模块已合并到工作台其他页面，请从工作台进入相应功能。</p></div><button class="pw-btn primary" type="button" data-route="/companion/dashboard">返回工作台</button></div>'}
  function bottomNavHtml(){
    var items=isIsolationMode()?ISOLATION_BOTTOM_NAV:BOTTOM_NAV;
    return '<nav class="pw-bottom-nav">'+items.map(function(n){
      var active=state.route===n[0]||(n[0]==='account'&&(state.route==='mine'||state.route==='verification'))||(n[0]==='earnings'&&state.route==='wallet');
      return '<button type="button" class="'+(active?'active':'')+'" data-route="'+n[2]+'">'+n[1]+'</button>';
    }).join('')+'</nav>';
  }
  function settlementModalHtml(){
    var s=state.settlement;if(!s)return '';
    var rows=[
      ['订单编号',s.orderNo||humanId(s.orderId)],
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
    return '<div class="pw-modal" data-close-settlement><div class="pw-dialog" data-settlement-dialog><div class="pw-dialog-head"><h3>订单结算详情</h3><button type="button" class="pw-btn" data-close-settlement>关闭</button></div><div class="pw-info-list">'+rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>'}).join('')+'</div><div class="pw-actions" style="margin-top:14px"><button class="pw-btn primary" type="button" data-route="/companion/earnings" data-earnings-tab="overview">查看收入</button><button class="pw-btn" type="button" data-close-settlement>关闭</button></div></div></div>';
  }
  function syncPwKeyboardInset(){
    try{
      var vv=window.visualViewport;
      if(!vv){
        document.documentElement.style.setProperty('--pw-keyboard-inset','0px');
        return;
      }
      var inset=Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--pw-keyboard-inset', inset+'px');
    }catch(e){}
  }
  function bindPwKeyboardInset(){
    if(state._kbBound)return;
    state._kbBound=true;
    syncPwKeyboardInset();
    if(window.visualViewport){
      window.visualViewport.addEventListener('resize',syncPwKeyboardInset);
      window.visualViewport.addEventListener('scroll',syncPwKeyboardInset);
    }
    window.addEventListener('resize',syncPwKeyboardInset);
  }
  function renderShell(){
    var data=state.data||{},player=data.player||state.session.user||{},lock=data.permissions&&data.permissions.lockReason;
    var unread=unreadCount();
    var isolated=isIsolationMode();
    var navItems=isolated?ISOLATION_NAV:NAV;
    try{
      document.body.classList.toggle('pw-route-messages', state.route==='messages');
      document.body.classList.toggle('pw-isolation', isolated);
    }catch(e){}
    var subtitle=isolated
      ? isolationHint()
      : (lock?esc(lock):'抢单 → 服务 → 完成订单 → 收益提现');
    var accountMenu=isolated
      ? '<button type="button" data-route="/companion/review-status">审核状态</button><button type="button" data-route="/companion/profile">申请资料</button><button type="button" data-route="/companion/account">账号资料</button><button class="danger" type="button" data-logout>退出登录</button>'
      : '<button type="button" data-route="/companion/profile">我的资料</button><button type="button" data-route="/companion/account">账号中心</button><button type="button" data-route="/companion/settings">设置</button><button class="danger" type="button" data-logout>退出登录</button>';
    root.innerHTML='<div class="pw-shell'+(isolated?' is-isolation':'')+'"><aside class="pw-side"><div class="pw-brand"><strong>MEOW CUI JIAO</strong><span>'+(isolated?'审核隔离模式':'Companion Workbench')+'</span></div><nav class="pw-nav">'+navItems.map(function(n){
      var badge=n[0]==='messages'&&unread?' <em class="pw-nav-badge">'+unread+'</em>':'';
      return '<button class="'+(state.route===n[0]||(n[0]==='account'&&(state.route==='mine'||state.route==='verification'))||(n[0]==='earnings'&&state.route==='wallet')?'active':'')+'" data-route="'+n[2]+'">'+n[1]+badge+'</button>';
    }).join('')+'</nav></aside><section class="pw-main"><header class="pw-top"><div><h1>'+title()+'</h1><p>'+subtitle+'</p></div><div class="pw-account"><button class="pw-avatar" data-account-toggle>'+esc(String(player.name||player.uid||'P').slice(0,1).toUpperCase())+'</button><div class="pw-menu">'+accountMenu+'</div></div></header>'+(isolated?'':(window.MCJCompanionAnnouncements&&window.MCJCompanionAnnouncements.hostHtml?window.MCJCompanionAnnouncements.hostHtml():'<div class="pw-announcement-host" data-pw-announcement-host hidden></div>'))+'<main class="pw-page">'+pageHtml()+'</main></section>'+bottomNavHtml()+'</div>'+noticeHtml()+settlementModalHtml();
    if(!isolated&&window.MCJCompanionAnnouncements&&window.MCJCompanionAnnouncements.reload)window.MCJCompanionAnnouncements.reload();
    bindPwKeyboardInset();
    syncPwKeyboardInset();
    if(state.route==='profile')restoreProfileFocus();
    if(isAccountRoute())restoreAccountFocus();
  }
  function pageHtml(){
    if(state.loading&&!state.data)return '<div class="pw-empty pw-skeleton"><div class="pw-skel-line"></div><div class="pw-skel-line short"></div><div class="pw-skel-cards"></div><span>加载中…</span></div>';
    var softBanner=state.loading&&state.data?'<div class="pw-soft-loading" aria-live="polite">同步中…</div>':'';
    if(HIDDEN_MVP_ROUTES[state.route])return softBanner+maintenanceHtml(title());
    if(state.error&&!state.data&&state.route!=='earnings'&&state.route!=='withdraw'&&state.route!=='account')return '<div class="pw-empty"><strong>数据源未就绪</strong><span>'+esc(state.error)+'</span></div>';
    var body='';
    if(state.route==='review-status')body=reviewStatusPageHtml();
    else if(state.route==='hall')body=hallHtml();
    else if(state.route==='orders')body=ordersHtml();
    else if(state.route==='earnings'||state.route==='wallet')body=earningsHtml();
    else if(state.route==='withdraw'){state.earningsTab='withdraw';body=earningsHtml();}
    else if(state.route==='messages')body=messagesHtml();
    else if(state.route==='settings')body=settingsHtml();
    else if(state.route==='popularity')body=popularityHtml();
    else if(state.route==='profile')body=profileHtml();
    else if(state.route==='account'||state.route==='mine')body=accountHtml();
    else if(state.route==='rules')body=rulesHtml();
    else body=dashboardHtml();
    return softBanner+body;
  }
  function reviewStatusPageHtml(){
    var ua=unifiedAccess();
    var st=String(ua.profile_review_status||'').toLowerCase();
    var v=(state.data&&state.data.verification)||{};
    var p=(state.data&&state.data.player)||{};
    var reason=String(v.applicationRejectReason||p.applicationRejectReason||'').trim();
    var statusLabel='资料审核中';
    var statusDetail='已收到您的申请，请耐心等待后台审核。审核通过前只能查看进度、修改资料、接收系统通知并联系客服。';
    var statusTone='pending';
    if(/reject|declin|fail/.test(st)){
      statusLabel='审核未通过';
      statusDetail=reason||'请根据驳回原因修改后重新提交。正式陪玩功能仍不可用。';
      statusTone='rejected';
    }else if(/resubmit|need_more/.test(st)){
      statusLabel='需补交资料';
      statusDetail=reason||'请按审核意见补交资料后再提交。';
      statusTone='rejected';
    }else if(/draft|none|not_submitted|missing|unsubmitted/.test(st)||!st){
      statusLabel='资料未完成';
      statusDetail='请继续填写申请并保存。提交审核前不会出现在正式陪玩列表。';
      statusTone='draft';
    }else if(/approved|verified|passed/.test(st)){
      statusLabel='认证已通过';
      statusDetail='正在开放正式陪玩端，请刷新或稍候…';
      statusTone='approved';
    }
    var notices=((state.inbox&&state.inbox.systemNotices)||[]).slice(0,8);
    var noticeHtmlBlock=notices.length
      ? notices.map(function(n){
          return '<article class="pw-card pad"><strong>'+esc(n.title||'系统通知')+'</strong><p style="margin:8px 0 0;color:var(--pw-muted);line-height:1.55">'+esc(n.body||n.content||'')+'</p><span class="pw-review-meta">'+esc(fmtContentTime(n.createdAt||n.created_at||''))+'</span></article>';
        }).join('')
      : '<div class="pw-note">暂无系统通知</div>';
    var csList=csConvList(state.inbox);
    var csActive=activeCsConversation(state.inbox);
    var csHint=csActive?'已有客服会话，可继续咨询审核进度。':'可发起客服咨询，仅处理审核与账号问题。';
    var csMsgs=((state.inbox&&state.inbox.messages)||[]).filter(function(m){
      if(!csActive)return false;
      return String(m.conversationId||m.conversation_id||'')===String(csActive.id||'');
    }).slice(-8);
    var csThread=csMsgs.length
      ? '<div class="pw-review-list" style="margin-top:12px">'+csMsgs.map(function(m){
          return '<div class="pw-review-card"><strong>'+esc(m.senderLabel||(m.side==='right'?'我':'客服'))+'</strong><p class="pw-review-body">'+esc(m.content||'')+'</p><span class="pw-review-date">'+esc(fmtContentTime(m.createdAt||''))+'</span></div>';
        }).join('')+'</div>'
      : '';
    var csComposer=csActive
      ? '<form class="pw-form" style="margin-top:12px" data-isolation-cs-send><label>发送消息<textarea name="content" rows="2" required placeholder="询问审核进度…"></textarea></label><button class="pw-btn primary" type="submit"'+(state.chatBusy?' disabled':'')+'>发送</button></form>'
      : '';
    return '<div class="pw-page-head"><div><h2>审核状态</h2><p>'+esc(isolationHint())+'</p></div><div class="pw-actions"><button class="pw-btn" type="button" data-logout>退出登录</button></div></div>'+
      '<section class="pw-alert" data-review-isolation="'+esc(statusTone)+'" role="status"><strong>'+esc(statusLabel)+'</strong><span>'+esc(statusDetail)+'</span>'+
      (statusTone==='rejected'||statusTone==='draft'
        ?'<button class="pw-btn primary" type="button" data-route="/companion/profile">'+(statusTone==='draft'?'继续填写申请':'修改资料并重新提交')+'</button>'
        :'<button class="pw-btn" type="button" data-route="/companion/profile">查看申请资料</button>')+
      '</section>'+
      (reason&&(statusTone==='rejected')?'<section class="pw-card pad" style="margin-bottom:14px"><strong>驳回原因</strong><p style="margin:8px 0 0;line-height:1.6">'+esc(reason)+'</p></section>':'')+
      '<section class="pw-card pad" style="margin-bottom:14px"><strong style="display:block;margin-bottom:8px">系统通知</strong>'+noticeHtmlBlock+'</section>'+
      '<section class="pw-card pad"><strong style="display:block;margin-bottom:8px">联系客服</strong><p style="margin:0 0 12px;color:var(--pw-muted)">'+esc(csHint)+'</p>'+
      '<div class="pw-actions" style="flex-wrap:wrap">'+
      '<button class="pw-btn primary" type="button" data-isolation-cs-open>联系客服</button>'+
      '<button class="pw-btn" type="button" data-route="/companion/account">账号资料</button>'+
      '</div>'+
      (csList.length?'<p class="pw-review-meta" style="margin-top:10px">进行中会话：'+esc(csList.length)+' 个</p>':'')+
      csThread+csComposer+
      '</section>';
  }
  function metric(label,value,routePath,orderFilter){
    var attrs='';
    if(routePath)attrs=' data-route="'+esc(routePath)+'"'+(orderFilter?' data-order-filter="'+esc(orderFilter)+'"':'')+' tabindex="0" role="button" class="pw-card pw-metric is-clickable"';
    else attrs=' class="pw-card pw-metric"';
    return '<article'+attrs+'><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>';
  }
  function popularityHtml(){
    var pop=(state.data&&state.data.popularity)||{};
    var w=pop.weekly||{},m=pop.monthly||{},t=pop.total||{};
    var tip=cleanTip(w.tip)||'完成订单、好评与礼物可提升人气。';
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
  function applyOnlineStatusUi(next){
    if(state.data&&state.data.player){
      state.data.player.onlineStatus=next;
      state.data.player.onlineStatusLabel=(STATUS_META[next]&&STATUS_META[next].label)||next;
      state.data.player.workStatus=state.data.player.onlineStatusLabel;
    }
    document.querySelectorAll('[data-online-status]').forEach(function(btn){
      var on=btn.dataset.onlineStatus===next;
      btn.classList.toggle('is-active',on);
      btn.setAttribute('aria-checked',on?'true':'false');
    });
    var label=document.querySelector('[data-current-status-label]');
    if(label){
      var m=STATUS_META[next]||{};
      label.textContent=(m.emoji?m.emoji+' ':'')+(m.label||next);
    }
  }
  function commitOnlineStatus(next){
    state.statusBusy=true;
    state.pendingOnlineStatus=null;
    api('set_online_status',{online_status:next}).then(function(x){
      var saved=x.onlineStatus||next;
      if(state.data&&state.data.player){
        state.data.player.onlineStatus=saved;
        state.data.player.onlineStatusLabel=x.onlineStatusLabel||((STATUS_META[saved]||{}).label);
        state.data.player.workStatus=state.data.player.onlineStatusLabel;
      }
      applyOnlineStatusUi(saved);
      toast(x.message||'状态已更新');
    }).catch(function(err){
      toast(err.message||'状态更新失败');
    }).finally(function(){
      state.statusBusy=false;
      var pending=state.pendingOnlineStatus;
      if(pending&&pending!==currentOnlineStatus()){
        state.pendingOnlineStatus=null;
        applyOnlineStatusUi(pending);
        commitOnlineStatus(pending);
        return;
      }
      loadData({soft:true});
    });
  }
  function statusSwitcherHtml(extraClass){
    var cur=currentOnlineStatus();
    var locked=isAuditLocked();
    var metaCur=STATUS_META[cur]||STATUS_META.offline;
    var label=locked?'审核中（不可接单）':(metaCur.emoji+' '+metaCur.label);
    return '<div class="pw-status-panel '+(extraClass||'')+(state.statusBusy?' is-busy':'')+(locked?' is-locked':'')+'">'+
      '<div class="pw-status-current">今日状态：<strong data-current-status-label>'+esc(label)+'</strong></div>'+
      '<div class="pw-status-switch" role="radiogroup" aria-label="接单状态">'+
      ['online','busy','paused','offline'].map(function(key){
        var meta=STATUS_META[key];
        var active=!locked&&cur===key;
        return '<button type="button" class="pw-btn pw-status-btn'+(active?' is-active':'')+(locked?' is-disabled':'')+'" role="radio" aria-checked="'+(active?'true':'false')+'" data-online-status="'+key+'" '+(locked?'disabled':'')+' aria-label="'+esc(meta.label)+'：'+esc(meta.hint)+'"><span class="pw-status-emoji" aria-hidden="true">'+meta.emoji+'</span><span class="pw-status-btn-label">'+esc(meta.label)+'</span></button>';
      }).join('')+
      '</div>'+
      (locked
        ?'<p class="pw-status-hint warn" data-status-hint>'+esc(auditHint())+'</p>'
        :(extraClass&&String(extraClass).indexOf('compact')>=0
          ?'<p class="pw-status-hint" data-status-hint>'+esc(metaCur.hint)+'</p>'
          :'<ul class="pw-status-guide">'+
            ['online','busy','paused','offline'].map(function(key){
              var m=STATUS_META[key];
              return '<li><strong>'+m.emoji+' '+esc(m.label)+'</strong><span>'+esc(m.hint)+'</span></li>';
            }).join('')+
          '</ul>'))+
      '</div>';
  }
  function publishGateBannerHtml(){
    var gate=(state.data&&state.data.publishGate)||{};
    var missing=Array.isArray(state.data&&state.data.publishMissing)?state.data.publishMissing:(gate.missing||[]);
    var status=String((state.data&&state.data.publishStatus)||gate.statusLabel||'');
    if(gate.publishReady||gate.ok){
      return '<div class="pw-note" style="margin:0 0 14px" role="status">老板端可见：已满足上架条件。认证标签由后台分配，陪玩不可自行修改。</div>';
    }
    var missText=missing.length?missing.join('、'):(status||'资料不完整');
    return '<div class="pw-alert" role="status"><strong>尚未对老板公开</strong><span>'+esc(status||'资料不完整')+'：'+esc(missText)+'。完善并审核通过后才会出现在首页/大厅，且老板才能下单。</span><button class="pw-btn" type="button" data-route="/companion/profile">去完善资料</button></div>';
  }
  function dashboardHtml(){
    var s=(state.data||{}).summary||{};
    var online=currentOnlineStatus()==='online';
    var locked=isAuditLocked();
    var designated=num(s.waitingConfirm||s.designatedPending);
    var reviewBanner=reviewStatusBannerHtml();
    var uaTop=unifiedAccess();
    var stTop=String(uaTop.profile_review_status||'').toLowerCase();
    var showDesignated=!locked&&designated>0&&/approved|verified|passed/.test(stTop);
    var extra=showDesignated
      ?'<div class="pw-alert designated" role="status"><strong>你有新的指定订单</strong><span>共 '+esc(designated)+' 单等待确认接单</span><button class="pw-btn primary" type="button" data-route="/companion/orders" data-order-filter="waiting_confirm">去处理</button></div>'
      :'';
    return '<div class="pw-page-head"><div><h2>工作台</h2><p>先切换今日状态，再处理订单。收益与提现请到独立页面。</p></div><div class="pw-actions"><button class="pw-btn primary" type="button" data-enter-hall '+(locked?'disabled':'')+'>进入抢单大厅</button><button class="pw-btn" data-route="/companion/orders">我的订单</button></div></div>'+
      publishGateBannerHtml()+
      reviewBanner+
      extra+
      statusSwitcherHtml()+
      (!locked&&!online?'<div class="pw-note" style="margin:0 0 14px">请先切换为在线接单。</div>':'')+
      '<section class="pw-grid">'+
      metric('待确认',num(s.waitingConfirm),'/companion/orders','waiting_confirm')+
      metric('进行中就绪',num(s.waitingStart),'/companion/orders','waiting_start')+
      metric('进行中',num(s.runningOrders),'/companion/orders','running')+
      metric('今日完成',num(s.todayCompleted),'/companion/orders','completed')+
      '</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>待处理事项</h3>'+todoList()+'</section>'+
      '<div class="pw-actions" style="margin-top:14px;flex-wrap:wrap"><button class="pw-btn" type="button" data-route="/companion/earnings">收益中心</button><button class="pw-btn" type="button" data-route="/companion/messages">消息中心</button><button class="pw-btn" type="button" data-route="/companion/rules">规则与制度</button></div>';
  }
  function todoList(){var s=(state.data||{}).summary||{},ua=unifiedAccess();var rows=[['待确认订单',s.waitingConfirm||0],['进行中就绪',s.waitingStart||0],['待完成订单',s.waitingComplete||0],['待处理消息',unreadCount()],['资料审核状态',STATUS_CN.verification(ua.profile_review_status)],['押金状态',STATUS_CN.deposit(ua.deposit_status)],['账号接单权限',STATUS_CN.accountAccess(ua.account_access_status)]];return '<div class="pw-info-list">'+rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>'}).join('')+'</div>'}
  function orderStatus(o){return o.orderStatus||o.statusText||o.status||'-'}
  function fmtTime(v){if(!v)return '-';try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(e){return String(v)}}
  var REJECT_REASONS=['正在服务其他订单','时间无法配合','临时有事','不接该项目','其他'];
  function orderActions(o){
    var s=orderStatus(o),id=esc(o.id);var raw=o.status||o.rawStatus||'';var out=[];
    // Open-grab applicant: never show 开始订单 until boss selected (confirmed).
    if(o.grabStatus==='pending_customer_selection'||(raw==='waiting_boss_confirm'&&!o.companionId)){
      out.push('<span class="pw-note">已抢单，等待老板选择。被选中后请确认接单，确认后进入进行中</span>');
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
    if(raw==='confirmed'||s==='已接单待开始'||s==='待开始')out.push('<button class="pw-btn primary" data-order-action="start_order" data-order-id="'+id+'">开始服务</button>');
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
      '<header><div><h3>'+esc(humanOrderNo(o))+'</h3><p>'+esc(o.game||o.serviceName||'-')+' / '+esc(o.serviceName||o.serviceContent||'-')+'</p></div><span class="pw-status info">'+esc(orderStatus(o))+'</span></header>'+
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
      if(filter==='running')return o.status==='in_progress'&&!o.completionPending;
      if(filter==='completed')return o.status==='completed'||o.completionPending||orderStatus(o)==='已完成';
      if(filter==='cancelled')return o.status==='cancelled';
      if(filter==='after_sale')return o.status==='refund_requested'||o.status==='refunded'||o.status==='disputed';
      return true;
    });
    var tabs=[
      ['all','全部'],
      ['waiting_selection','待老板选择'],
      ['waiting_confirm','待确认'],
      ['waiting_start','进行中就绪'],
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
  function computeIncomeStats(){
    var ledger=(state.data&&state.data.walletLedger)||[];
    var now=new Date();
    var y=new Date(now);y.setDate(y.getDate()-1);
    var yesterday=y.toISOString().slice(0,10);
    var weekStart=new Date(now);
    var dow=(weekStart.getDay()+6)%7;
    weekStart.setHours(0,0,0,0);
    weekStart.setDate(weekStart.getDate()-dow);
    var yesterdayIncome=0,weekIncome=0;
    ledger.forEach(function(r){
      if(r.typeCode!=='companion_income')return;
      var day=String(r.createdAt||'').slice(0,10);
      if(!day)return;
      if(day===yesterday)yesterdayIncome+=num(r.amount);
      if(new Date(day+'T00:00:00')>=weekStart)weekIncome+=num(r.amount);
    });
    return {yesterdayIncome:yesterdayIncome,weekIncome:weekIncome};
  }
  function earningsHtml(){
    var tab=state.earningsTab||'overview';
    var body=tab==='withdraw'
      ?'<div class="pw-form-narrow">'+earningsWithdrawTab()+'</div>'
      :(tab==='records'
        ?'<div class="pw-list-narrow">'+earningsRecordsTab()+'</div>'
        :earningsOverviewTab());
    return '<div class="pw-page-head"><div><h2>收益中心</h2><p>收入、提现与流水来自真实数据库，切换下方标签查看收入 / 提现 / 流水。</p></div></div>'+
      '<div class="pw-tabs">'+EARNINGS_TABS.map(function(t){
        return '<button type="button" class="'+(tab===t[0]?'active':'')+'" data-earnings-tab="'+t[0]+'">'+t[1]+'</button>';
      }).join('')+'</div>'+
      body;
  }
  function earningsOverviewTab(){
    var e=(state.data&&state.data.earnings)||{},summary=(state.data&&state.data.summary)||{},details=(state.data&&state.data.earningDetails)||[],level=(state.data&&state.data.levelInfo)||{},warn=state.walletWarning||'';
    var available=e.available!=null?e.available:e.withdrawable;
    var frozen=e.frozen!=null?e.frozen:summary.frozen||0;
    var commission=level.platformCommissionRate!=null?level.platformCommissionRate:(level.orderCommissionRate||0);
    var stats=computeIncomeStats();
    var noMap=orderNoLookup();
    return (warn?'<div class="pw-empty" style="margin-bottom:12px"><strong>部分数据读取异常</strong><span>'+esc(warn)+'</span></div>':'')+
      '<section class="pw-grid">'+
      metric('今日收入',money(num(e.todayIncome)))+
      metric('昨日收入',money(num(stats.yesterdayIncome)))+
      metric('本周收入',money(num(stats.weekIncome)))+
      metric('本月收入',money(num(e.monthIncome||summary.monthIncome)))+
      metric('累计收入',money(num(e.totalIncome||summary.totalIncome)))+
      metric('可提现猫粮',money(num(available)))+
      metric('冻结中',money(num(frozen)))+
      metric('平台抽成',esc(commission)+'%')+
      '</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>奖励 / 其它</h3><div class="pw-info-list">'+infoRow('奖励猫粮',money(num(e.bonus||e.reward||0)))+infoRow('已提现',money(num(e.withdrawn||summary.withdrawn)))+'</div></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>收入明细</h3>'+(details.length?'<div class="pw-table-wrap"><table class="pw-table"><thead><tr><th>类型</th><th>订单</th><th>订单总额</th><th>平台抽成</th><th>实际到账</th><th>状态</th><th>时间</th></tr></thead><tbody>'+details.map(function(x){
        var s=x.settlement||{};
        var gross=s.totalCatFood!=null?s.totalCatFood:x.amount;
        var fee=s.platformCommissionCatFood!=null?s.platformCommissionCatFood:0;
        var net=s.companionNetCatFood!=null?s.companionNetCatFood:x.amount;
        var no=x.orderId?(noMap[x.orderId]||humanId(x.orderId)):'-';
        return '<tr><td data-label="类型">'+esc(x.type||'订单收入')+'</td><td data-label="订单">'+esc(no)+'</td><td data-label="订单总额">'+money(num(gross))+'</td><td data-label="平台抽成">'+money(num(fee))+'</td><td data-label="实际到账">'+money(num(net))+'</td><td data-label="状态">'+esc(ledgerStatusCN(x.status))+'</td><td data-label="时间">'+esc(fmtTime(x.createdAt))+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<div class="pw-empty">暂无收入明细</div>')+'</section>';
  }
  function earningsWithdrawTab(){
    var e=(state.data&&state.data.earnings)||{},rules=(state.data&&state.data.withdrawalRules)||{},perm=(state.data&&state.data.permissions)||{};
    var can=!!perm.canWithdraw&&!state.withdrawBusy;
    var available=e.available!=null?e.available:e.withdrawable;
    return (!perm.canWithdraw&&perm.withdrawLockReason?'<div class="pw-empty" style="margin-bottom:12px"><strong>暂不可提现</strong><span>'+esc(perm.withdrawLockReason)+'</span></div>':'')+
      '<div class="pw-empty" style="margin-bottom:12px"><strong>每周五统一发放</strong><span>'+esc((rules.weeklyBanner&&rules.weeklyBanner.bannerBody)||rules.settlementHint||'周四 23:59 前提交 → 本周五发放；截止后提交 → 下周五发放。')+'</span></div>'+
      '<div class="pw-empty" style="margin-bottom:12px"><strong>退款冲减</strong><span>若订单进入待周五退款队列，相关收入会被冲减或锁定，暂不可提现；已入批次未打款将重算，已打款后退款记入下期负向调整。</span></div>'+
      '<form class="pw-card pad pw-form" data-withdraw-form novalidate>'+
      '<div class="pw-info-list" style="margin-bottom:14px">'+
      infoRow('可提现余额',money(num(available)))+
      infoRow('最低提现金额',(rules.minAmount||0)+' 猫粮')+
      infoRow('预计发放日期',(rules.nextSettlementDate||'-')+(rules.nextSettlementDate?'（星期五）':''))+
      infoRow('提现账户',rules.currentAccount||'未绑定')+
      infoRow('本周剩余次数',(rules.remainingThisWeek!=null?rules.remainingThisWeek:rules.remainingThisMonth||0)+' / '+(rules.weeklyLimit!=null?rules.weeklyLimit:rules.monthlyLimit||0))+
      '</div>'+
      '<label>提现猫粮数量<input name="amount" type="number" inputmode="decimal" step="1" placeholder="请输入数量" '+(can?'':'disabled')+'></label>'+
      '<label>备注（可选）<input name="remark" placeholder="可选" '+(can?'':'disabled')+'></label>'+
      '<button class="pw-btn primary" type="submit" '+(can?'':'disabled')+'>'+(state.withdrawBusy?'提交中…':'提交提现申请')+'</button>'+
      '</form>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>提现记录</h3>'+withdrawalRecordsListHtml()+'</section>';
  }
  function withdrawalRecordsListHtml(){
    var withdrawals=((state.data&&state.data.withdrawals)||[]).slice().sort(function(a,b){return String(b.submittedAt||b.createdAt||'').localeCompare(String(a.submittedAt||a.createdAt||''))});
    if(!withdrawals.length)return '<div class="pw-empty"><strong>暂无提现记录</strong><span>提交提现申请后会显示在这里。</span></div>';
    return '<section class="pw-list">'+withdrawals.map(function(x){
      var statusKey=x.status||'';
      var statusCn=WD_STATUS_TEXT[statusKey]||x.statusText||statusKey||'-';
      var tagClass=statusKey==='completed'?'ok':((statusKey==='rejected'||statusKey==='pay_failed')?'bad':(statusKey==='cancelled'?'muted':'warn'));
      var last4=x.accountLast4?String(x.accountLast4):'';
      return '<details class="pw-card pad pw-record-card">'+
        '<summary>'+
          '<span>'+esc(fmtTime(x.submittedAt||x.createdAt))+' · '+money(num(x.catFoodAmount||x.amount))+'</span>'+
          '<span class="pw-status-tag '+tagClass+'">'+esc(statusCn)+'</span>'+
        '</summary>'+
        '<div class="pw-info-list pw-record-body">'+
          infoRow('单号',x.withdrawalNo||humanId(x.id))+
          infoRow('提现金额',money(num(x.catFoodAmount||x.amount)))+
          infoRow('到账金额',money(num(x.netAmountRm||0))+' RM')+
          infoRow('预计发放日期',x.settlementDate?(String(x.settlementDate).slice(0,10)+'（星期五）'):'-')+
          infoRow('当前状态',statusCn)+
          infoRow('收款账户',last4?('尾号 '+last4):'-')+
          infoRow('提交时间',fmtTime(x.submittedAt||x.createdAt))+
          infoRow('审核时间',fmtTime(x.reviewedAt||x.approvedAt))+
          infoRow('打款时间',fmtTime(x.paidAt||x.completedAt))+
          (x.bankReference||x.bankReferenceMasked||x.transactionNo?infoRow('交易编号',x.bankReference||x.bankReferenceMasked||x.transactionNo):'')+
          (x.paymentRemark?infoRow('备注',x.paymentRemark):'')+
          (x.receiptUrl?'<div class="pw-info-row"><span>汇款收据</span><strong><a href="'+esc(x.receiptUrl)+'" target="_blank" rel="noopener">查看收据</a></strong></div>':(x.hasReceipt?infoRow('汇款收据','已上传'):''))+
          (x.rejectReason?infoRow('驳回原因',x.rejectReason):'')+
        '</div>'+
      '</details>';
    }).join('')+'</section>';
  }
  function earningsRecordsTab(){
    var ledger=(state.data&&state.data.walletLedger)||[];
    var noMap=orderNoLookup();
    if(!ledger.length)return '<div class="pw-empty"><strong>暂无流水</strong><span>猫粮变动会显示在这里。</span></div>';
    return '<section class="pw-card pad"><h3>猫粮流水</h3><div class="pw-table-wrap"><table class="pw-table"><thead><tr><th>类型</th><th>金额</th><th>关联</th><th>状态</th><th>时间</th></tr></thead><tbody>'+ledger.map(function(x){
      var rel=x.orderId?(noMap[x.orderId]||humanId(x.orderId)):(x.withdrawalId?'提现 '+humanId(x.withdrawalId):(x.note||'-'));
      return '<tr><td data-label="类型">'+esc(x.type||'-')+'</td><td data-label="金额">'+(x.direction==='out'?'-':'')+money(x.amount||0)+'</td><td data-label="关联">'+esc(rel)+'</td><td data-label="状态">'+esc(ledgerStatusCN(x.status))+'</td><td data-label="时间">'+esc(fmtTime(x.createdAt))+'</td></tr>';
    }).join('')+'</tbody></table></div></section>';
  }
  function buildInbox(){
    var read=readMsgRead();
    var items=[];
    var p=(state.data&&state.data.player)||{};
    var v=(state.data&&state.data.verification)||{};
    var d=(state.data&&state.data.deposit)||{};
    var orders=(state.data&&state.data.myOrders)||[];
    var withdrawals=(state.data&&state.data.withdrawals)||[];
    function push(id,cat,title,body,at){
      items.push({id:id,category:cat,title:title,body:body,at:at||'',unread:!read[id]});
    }
    // Audit notices come from API inbox (companion_notifications). Do not synthesize fake rows.
    orders.slice(0,20).forEach(function(o){
      push('ord-'+o.id,'order','订单 '+humanOrderNo(o),orderStatus(o)+' · '+(o.game||o.serviceName||''),o.updatedAt||o.createdAt||'');
    });
    withdrawals.forEach(function(w){
      push('wd-'+w.id,'withdraw','提现 '+(w.withdrawalNo||humanId(w.id)),(WD_STATUS_TEXT[w.status]||w.statusText||w.status)+' · '+(w.catFoodAmount||w.amount||0)+' 猫粮',w.submittedAt||w.createdAt||'');
    });
    var pop=((state.data&&state.data.popularity)||{}).weekly||{};
    var tip=cleanTip(pop.tip);
    if(tip)push('act-pop','activity','人气活动',tip,'');
    return items;
  }
  var CATEGORY_LABEL_CN={system:'系统通知',order:'订单通知',withdraw:'提现通知',audit:'审核通知',activity:'活动通知'};
  function csConvConsultType(){
    var conv=activeCsConversation(state.inbox);
    if(conv&&conv.consultType)return conv.consultType;
    if(state.inbox&&state.inbox.csConsultType)return state.inbox.csConsultType;
    return state.csConsultType||'other';
  }
  function consultTypeOptionsHtml(selected){
    var cur=selected||csConvConsultType();
    var opts=[
      ['order_dock','订单对接'],
      ['profile_audit','资料审核'],
      ['deposit_auth','押金认证'],
      ['withdraw','提现问题'],
      ['earnings','工资收益问题'],
      ['other','其他']
    ];
    return opts.map(function(o){
      return '<option value="'+o[0]+'"'+(cur===o[0]?' selected':'')+'>'+esc(o[1])+'</option>';
    }).join('');
  }
  function renderChatMessagesHtml(messages){
    var body;
    if(!messages.length){
      body='<div class="pw-empty"><strong>暂无消息</strong><span>发送消息即可联系官方客服。</span></div>';
    }else{
      body=messages.filter(function(m){
        var c=String(m.content||'');
        return !/^(CHAT-|E2E-MSG-|CS-LINK-|SVC-|MSG-|ORDER-CHAT-)/i.test(c.trim());
      }).map(function(m){
        var side=m.side||(m.senderRole==='companion'?'right':'left');
        var Media=window.MCJChatMedia;
        var isImg=Media&&Media.isImageMessage(m);
        var bubble=isImg?Media.imageBubbleHtml(Media.imageUrlOf(m),esc):('<div class="pw-bubble">'+esc(m.content)+'</div>');
        var pending=m._pending?' · 上传中…':'';
        var failed=m._failed?' · 发送失败':'';
        return '<div class="pw-msg '+esc(side)+'" data-msg-id="'+esc(m.id||m._localId||'')+'">'+bubble+'<small>'+esc(m.senderLabel||'')+' · '+esc(fmtTime(m.createdAt))+pending+failed+'</small></div>';
      }).join('');
      if(!body)body='<div class="pw-empty"><strong>暂无消息</strong><span>发送消息即可联系官方客服。</span></div>';
    }
    return body;
  }
  function chatCsPanelHtml(inbox){
    var conv=activeCsConversation(inbox);
    var messages=(inbox&&inbox.messages)||[];
    var busy=!!state.chatBusy;
    var ended=!!(conv&&conv.ended)||!!(inbox&&inbox.csEnded);
    var connecting=!inbox||!!inbox._placeholder;
    if(connecting){
      return '<div class="pw-chat-main"><div class="pw-chat-head"><div><h3>官方客服</h3><p>'+esc(state.inboxError||'正在连接…')+'</p></div></div>'+
        '<div class="pw-empty"><strong>'+esc(state.inboxError?'连接失败':'正在连接客服…')+'</strong><span>'+esc(state.inboxError||'正在建立会话，请稍候。')+'</span></div>'+
        '<div class="pw-composer is-disabled" data-chat-composer-disabled><textarea disabled placeholder="客服连接中…"></textarea>'+
        '<div class="pw-send-line"><button class="pw-btn primary" type="button" data-reload-inbox>重新连接</button></div></div></div>';
    }
    if(!conv){
      return '<div class="pw-chat-main"><div class="pw-chat-head"><div><h3>官方客服</h3><p>选择左侧会话，或发起新咨询。</p></div></div>'+
        '<div class="pw-empty"><strong>暂无客服会话</strong><span>选择咨询类型后点击「发起新咨询」。</span></div>'+
        '<div class="pw-actions" style="padding:12px;flex-wrap:wrap;gap:8px">'+
        '<label class="pw-consult-type">咨询类型 <select data-cs-consult-type>'+consultTypeOptionsHtml('other')+'</select></label>'+
        '<button class="pw-btn primary" type="button" data-start-cs-consult>发起新咨询</button></div></div>';
    }
    var title=conv.consultTypeLabel||consultTypeLabel(conv.consultType)||'官方客服';
    var meta=[conv.statusLabel||'',conv.assignedServiceName||'',conv.orderLabel||''].filter(Boolean).join(' · ');
    var head='<div class="pw-chat-head"><div><h3>'+esc(title)+'</h3><p>'+esc(meta||conv.subtitle||'工作时间 9:00–24:00')+'</p></div>'+
      '<div class="pw-actions" style="gap:8px;flex-wrap:wrap">'+
      (!ended?'<button class="pw-btn" type="button" data-end-cs-chat="'+esc(conv.id)+'">结束对话</button>':'')+
      '<label class="pw-consult-type" style="font-size:12px">新咨询 <select data-cs-consult-type>'+consultTypeOptionsHtml()+'</select></label>'+
      '<button class="pw-btn primary" type="button" data-start-cs-consult>发起新咨询</button></div></div>';
    var body=renderChatMessagesHtml(messages);
    if(state.inboxError&&messages.length){
      body='<div class="pw-alert" style="margin:8px 12px"><strong>同步异常</strong><span>'+esc(state.inboxError)+'</span><button class="pw-btn" type="button" data-reload-inbox>重新连接</button></div>'+body;
    }
    var composer;
    if(ended){
      composer='<div class="pw-composer is-disabled" data-chat-composer-disabled>'+
        '<textarea disabled placeholder="会话已结束，请发起新咨询"></textarea>'+
        '<div class="pw-send-line"><button class="pw-btn primary" type="button" data-start-cs-consult>发起新咨询</button></div></div>';
    }else{
      composer='<form class="pw-composer" data-chat-composer>'+
        '<div class="mcj-composer-tools">'+
        '<button class="mcj-composer-tool" type="button" data-pw-emoji '+(busy?'disabled':'')+' aria-label="表情">😊</button>'+
        '<button class="mcj-composer-tool" type="button" data-pw-image '+(busy?'disabled':'')+' aria-label="图片">🖼</button>'+
        '</div>'+
        '<textarea name="content" placeholder="输入消息，Enter 发送，Shift+Enter 换行" data-chat-input '+(busy?'disabled':'')+'></textarea>'+
        '<div class="pw-send-line"><span class="mcj-upload-status" data-pw-upload-status>'+(busy?'发送中…':'')+'</span><button class="pw-btn primary" type="submit" '+(busy?'disabled':'')+'>发送</button></div>'+
        '</form>';
    }
    return '<div class="pw-chat-main">'+head+'<div class="pw-messages">'+body+'</div>'+composer+'</div>';
  }
  function chatSystemPanelHtml(notices){
    var unread=notices.filter(function(n){return n.unread}).length;
    var total=notices.length;
    var head='<div class="pw-chat-head"><div><h3>系统通知</h3><p>全部 '+esc(total)+' · 未读 '+esc(unread)+'</p></div><button class="pw-btn" type="button" data-msg-read-all '+(unread?'':'disabled')+'>全部已读</button></div>';
    var body=notices.length?'<div class="pw-notice-list">'+notices.map(function(n){
      var cat=n.categoryLabel||CATEGORY_LABEL_CN[n.category]||n.category||'通知';
      return '<article class="pw-msg-card'+(n.unread?' is-unread':'')+'" data-notice-id="'+esc(n.id||n.key)+'"><header><strong>'+esc(n.title)+'</strong><span>'+esc(cat)+'</span></header><p>'+esc(n.body)+'</p><footer>'+esc(fmtTime(n.at))+(n.unread?' · 未读':'')+'</footer></article>';
    }).join('')+'</div>':'<div class="pw-empty"><strong>暂无通知</strong><span>订单 / 审核 / 提现 / 活动通知会出现在这里。</span></div>';
    return '<div class="pw-chat-main pw-chat-main-notices">'+head+body+'</div>';
  }
  function messagesHtml(){
    var inbox=state.inbox;
    var session=state.chatSession==='system'?'system':'cs';
    var localInbox=buildInbox();
    var systemNotices=(inbox&&inbox.systemNotices)?inbox.systemNotices:localInbox.map(function(m){
      return {id:m.id,key:m.id,title:m.title,body:m.body,at:m.at,category:m.category,unread:m.unread};
    });
    var csList=csConvList(inbox);
    var activeConv=activeCsConversation(inbox);
    var activeId=String(state.chatConversationId||inbox&&inbox.csConversationId||activeConv&&activeConv.id||'');
    var csUnread=csList.reduce(function(sum,c){return sum+num(c.unread)},0);
    var sysUnread=systemNotices.filter(function(n){return n.unread}).length;
    var csRows=csList.map(function(c){
      var isActive=session==='cs'&&activeId&&String(c.id)===activeId;
      var label=c.consultTypeLabel||consultTypeLabel(c.consultType);
      var meta=[c.statusLabel||'',c.assignedServiceName||'',c.orderLabel||''].filter(Boolean).join(' · ');
      return '<button type="button" class="pw-session'+(isActive?' active':'')+(c.ended?' is-ended':'')+'" data-chat-session="cs" data-cs-conversation="'+esc(c.id)+'">'+
        '<span class="pw-session-avatar" aria-hidden="true">🎧</span>'+
        '<span><b>'+esc(label)+'</b><span>'+esc(meta)+'</span><span>'+esc(c.lastMessage||'')+'</span></span>'+
        (c.unread?'<em class="pw-unread">'+esc(c.unread)+'</em>':'')+
      '</button>';
    }).join('');
    var systemRow='<button type="button" class="pw-session'+(session==='system'?' active':'')+'" data-chat-session="system">'+
      '<span class="pw-session-avatar" aria-hidden="true">🔔</span>'+
      '<span><b>系统通知</b><span>'+esc((systemNotices[0]&&systemNotices[0].title)||'暂无通知')+'</span></span>'+
      (sysUnread?'<em class="pw-unread">'+esc(sysUnread)+'</em>':'')+
    '</button>';
    var listHtml=(csRows||'<div class="pw-empty" style="padding:12px"><span>暂无客服会话，可在右侧发起新咨询。</span></div>')+systemRow;
    var rightHtml=session==='cs'?chatCsPanelHtml(inbox):chatSystemPanelHtml(systemNotices);
    return '<div class="pw-page-head"><div><h2>消息中心</h2><p>官方客服与系统通知，未读共 '+esc(csUnread+sysUnread)+' 条。</p></div></div>'+
      '<div class="pw-chat"><div class="pw-chat-list"><div class="pw-session-list">'+listHtml+'</div></div>'+rightHtml+'</div>';
  }
  function settingsHtml(){
    var s=state.settings||readSettings();
    return '<div class="pw-page-head"><div><h2>设置</h2><p>仅影响本机陪玩端体验。</p></div></div>'+
      '<section class="pw-card pad"><h3>主题</h3><p class="pw-note">当前为固定黑粉运营主题（上线版不可切换品牌色）。</p><div class="pw-info-list"><div><span>主题</span><strong>暗色粉（默认）</strong></div></div></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>通知</h3><label class="pw-check"><input type="checkbox" data-setting="notify" '+(s.notify?'checked':'')+'> 接收订单 / 提现 / 审核提醒</label></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>声音</h3><label class="pw-check"><input type="checkbox" data-setting="sound" '+(s.sound?'checked':'')+'> 提示音（新消息 / 订单 / 抢单 / 审核）</label></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>账号</h3><button class="pw-btn danger" type="button" data-logout>退出登录</button></section>';
  }
  function reviewStars(rating){
    var n=Math.max(0,Math.min(5,Math.round(Number(rating)||0)));
    var out='';
    for(var i=0;i<5;i++)out+=i<n?'★':'☆';
    return out;
  }
  function fieldErr(name){var msg=state.profileErrors&&state.profileErrors[name];return msg?'<span class="pw-field-error" data-field-error="'+esc(name)+'">'+esc(msg)+'</span>':''}
  function fieldLabel(text,required){return '<span class="pw-field-label">'+esc(text)+(required?'<i class="pw-req">*</i>':'')+'</span>'}
  function profileHtml(){
    var p=(state.data&&state.data.player)||{};
    var raw=p.raw||{};
    var draft=state.profileDraft||null;
    var level=(state.data&&state.data.levelInfo)||{};
    var media=(state.data&&state.data.media)||[];
    var avatarMedia=media.filter(function(m){return m.mediaType==='avatar'})[0];
    var gallery=media.filter(function(m){return m.mediaType==='gallery'}).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
    var avatarUrl=avatarMedia&&avatarMedia.url?avatarMedia.url:(p.hasCustomAvatar?p.avatar:'');
    var displayAvatar=avatarUrl||'/default-avatar.png';
    var gender=draft&&draft.gender!=null&&draft.gender!==''?String(draft.gender):String(raw.gender||'');
    var gameId=draft&&draft.game_id!=null?String(draft.game_id):(p.gameId||raw.game_id||'');
    var nickname=draft&&draft.nickname!=null?String(draft.nickname):(p.name||'');
    var ageVal=draft&&draft.age!=null?String(draft.age):String(raw.age||'');
    var regionVal=draft&&draft.region!=null?String(draft.region):String(raw.region||'');
    var bioVal=draft&&draft.bio!=null?String(draft.bio):(p.bio||'');
    var rankVal=draft&&draft.rank!=null?String(draft.rank):String(raw.game_rank||raw.rank||'');
    var positionVal=draft&&draft.position!=null?String(draft.position):String(raw.position||'');
    var serviceOptions=availableServiceOptions();
    var selectedIds=draft&&Array.isArray(draft.serviceIds)?draft.serviceIds.slice():selectedServiceIdsFromPlayer(p,raw);
    var selectedTypes=draft&&Array.isArray(draft.serviceTypes)?draft.serviceTypes.slice():selectedServiceTypesFromPlayer(p,raw);
    var gameList=availableGames();
    selectedIds.forEach(function(id){
      if(!serviceOptions.some(function(s){return s.id===id})){
        // keep orphan selected id with name fallback from game string
        var name=String(p.mainGame||raw.game||'').split(/[,，、/|]+/).map(function(x){return x.trim()}).filter(Boolean)[0]||id;
        serviceOptions.push({id:id,name:name});
      }
    });
    var gamePrices=Object.assign({},p.gamePrices||level.gamePrices||{},(draft&&draft.gamePrices)||{});
    var publicTags=draft&&draft.public_tags!=null?String(draft.public_tags):(String(p.publicTags||'').trim()||String(raw.public_tags||'').trim());
    if(!publicTags&&!(draft&&draft.public_tags!=null)){
      publicTags=String(p.tags||raw.tags||'').replace(/\[\[MCJ_[^\]]+\]\]/g,'').replace(/游戏ID:[^,，]*/g,'').split(/[,，、]/).map(function(x){return x.trim()}).filter(function(x){return x&&gameList.indexOf(x)===-1}).join('、');
    }
    var selectedTags=selectedPublicTagsFromPlayer(p,raw,draft);
    var tagOpts=(state.profileCompanionTags||[]).slice();
    selectedTags.forEach(function(name){
      if(!tagOpts.some(function(t){return t.name===name}))tagOpts.push({id:'legacy-'+name,name:name,enabled:true});
    });
    var tagChecks=tagOpts.length?tagOpts.map(function(t){
      var on=selectedTags.indexOf(t.name)!==-1;
      return '<label class="pw-check-chip"><input type="checkbox" name="public_tag_opt" value="'+esc(t.name)+'" '+(on?'checked':'')+'> '+esc(t.name)+'</label>';
    }).join(''):'<span class="pw-muted">后台暂未配置标签，请联系管理员</span>';
    var uploadBusy=state.uploadBusy;
    var minP=level.minPrice!=null?level.minPrice:20;
    var maxP=level.maxPrice!=null?level.maxPrice:30;
    var maxPlus=!!level.maxPlus;
    var rangeText=level.priceRangeText||('RM'+minP+'–RM'+maxP+(maxPlus?'+':'')+' / 小时');
    var levelLabel=level.level||p.level||'未设置';
    var fallbackPrice=level.price!=null?level.price:(p.rawPrice||p.price||'');
    var needsReset=!!(level.priceNeedsReset||p.priceNeedsReset);
    var genderRadios=['男','女','不公开'].map(function(g){
      return '<label class="pw-radio"><input type="radio" name="gender" value="'+esc(g)+'" '+(gender===g?'checked':'')+'> '+esc(g)+'</label>';
    }).join('');
    var selectedVoices=draft&&Array.isArray(draft.voiceTypes)?draft.voiceTypes.slice():selectedVoiceTypesFromPlayer(p,raw);
    var voiceOpts=(state.profileVoiceTypes||[]).slice();
    selectedVoices.forEach(function(name){
      if(!voiceOpts.some(function(v){return v.name===name}))voiceOpts.push({id:'legacy-'+name,name:name,enabled:true});
    });
    var voiceTypeChecks=voiceOpts.map(function(v){
      var on=selectedVoices.indexOf(v.name)!==-1;
      return '<label class="pw-check-chip"><input type="checkbox" name="voice_type_opt" value="'+esc(v.name)+'" '+(on?'checked':'')+'> '+esc(v.name)+'</label>';
    }).join('');
    var serviceTypeChecks=['陪玩服务','陪聊服务'].map(function(t){
      var on=selectedTypes.indexOf(t)!==-1;
      return '<label class="pw-check-chip"><input type="checkbox" name="service_type_opt" value="'+esc(t)+'" '+(on?'checked':'')+'> '+esc(t)+'</label>';
    }).join('');
    var gameChecks=serviceOptions.length?serviceOptions.map(function(s){
      var on=selectedIds.indexOf(s.id)!==-1;
      return '<label class="pw-check-chip"><input type="checkbox" name="service_id_opt" value="'+esc(s.id)+'" data-game-name="'+esc(s.name)+'" '+(on?'checked':'')+' data-game-toggle> '+esc(s.name)+'</label>';
    }).join(''):'<div class="pw-empty"><strong>暂无游戏</strong><span>请后台在「服务管理」新增游戏后刷新。</span></div>';
    var priceRows=serviceOptions.length?serviceOptions.map(function(s){
      var on=selectedIds.indexOf(s.id)!==-1;
      var draftPrice=draft&&draft.gamePrices&&draft.gamePrices[s.id]!=null?draft.gamePrices[s.id]:'';
      var val=draftPrice!==''?draftPrice:(gamePrices[s.id]!=null&&gamePrices[s.id]!==''?gamePrices[s.id]:(gamePrices[s.name]!=null&&gamePrices[s.name]!==''?gamePrices[s.name]:(on&&!needsReset?fallbackPrice:'')));
      return '<label class="pw-game-price'+(on?' is-on':'')+'" data-game-price-row="'+esc(s.id)+'">'+
        '<span>'+esc(s.name)+'</span>'+
        '<span class="pw-game-price-unit"><input name="game_price_'+esc(s.id)+'" type="number" inputmode="decimal" step="0.01" min="0" value="'+(needsReset&&!(draftPrice||gamePrices[s.id]||gamePrices[s.name])?'':esc(val))+'" placeholder="RM" '+(on?'':'disabled')+' data-min-price="'+esc(minP)+'" data-max-price="'+esc(maxP)+'" data-max-plus="'+(maxPlus?'1':'0')+'"> /小时</span>'+
        '</label>';
    }).join(''):'';
    var galleryHtml=gallery.map(function(item,idx){
      return '<div class="pw-gallery-item" data-media-id="'+esc(item.id)+'">'+
        '<img src="'+esc(item.url||'/default-avatar.png')+'" alt="相册">' +
        '<div class="pw-gallery-actions">'+
        '<button type="button" class="pw-btn" data-gallery-move="-1" '+(idx===0?'disabled':'')+'>上移</button>'+
        '<button type="button" class="pw-btn" data-gallery-move="1" '+(idx===gallery.length-1?'disabled':'')+'>下移</button>'+
        '<button type="button" class="pw-btn danger" data-delete-media="'+esc(item.id)+'">删除</button>'+
        '</div></div>';
    }).join('');
    var previewId=encodeURIComponent(p.id||p.uid||'');
    return '<div class="pw-page-head"><div><h2>我的资料（公开）</h2><p>老板可见。联系方式 / 身份证 / 押金 / 收款请到「账号中心」。</p></div><div class="pw-actions">'+
      (previewId?'<a class="pw-btn" href="/profile.html?player='+previewId+'" target="_blank" rel="noopener">预览老板端展示</a>':'')+
      '<button class="pw-btn" type="button" data-route="/companion/account">账号中心</button>'+
      '</div></div>'+
      publishGateBannerHtml()+
      reviewRejectBannerHtml('/companion/profile')+
      '<div class="pw-alert"><strong>隐私提醒</strong><span>以下内容将展示给老板，请勿填写身份证、银行卡、私人联系方式等隐私信息。</span></div>'+
      '<form class="pw-form-narrow pw-profile-form" data-profile-form novalidate>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><h3>基本展示资料</h3>'+
      '<div class="pw-field pw-upload-block'+(state.profileErrors&&state.profileErrors.avatar?' is-missing':'')+'" data-field="avatar">'+
      fieldLabel('头像',true)+
      '<div class="pw-avatar-upload">'+
      '<img class="pw-avatar-preview" src="'+esc(displayAvatar)+'" alt="头像预览" data-avatar-preview>'+
      '<div class="pw-upload-actions">'+
      '<label class="pw-btn pw-file-btn'+(uploadBusy==='avatar'?' is-busy':'')+'" data-pw-upload-trigger="avatar">'+
      (uploadBusy==='avatar'?'上传中…':'上传头像')+
      '<input type="file" class="pw-file-input" accept="image/jpeg,image/jpg,image/png,image/webp,image/*" data-upload-avatar '+(uploadBusy?'disabled':'')+'>'+
      '</label>'+
      (avatarUrl?'<button type="button" class="pw-btn danger" data-delete-avatar>删除头像</button>':'')+
      '</div></div>'+
      '<p class="pw-field-hint">支持 jpg / png / webp，单张不超过 5MB。</p>'+
      fieldErr('avatar')+
      '</div>'+
      '<div class="pw-two-col">'+
      '<div class="pw-field">'+fieldLabel('昵称',true)+'<input name="nickname" value="'+esc(nickname)+'" placeholder="例如：1717大王" autocomplete="nickname">'+fieldErr('nickname')+'</div>'+
      '<div class="pw-field">'+fieldLabel('年龄',true)+'<input name="age" type="number" inputmode="numeric" min="18" max="60" value="'+esc(ageVal)+'" placeholder="例如 23">'+fieldErr('age')+'</div>'+
      '</div>'+
      '<div class="pw-two-col">'+
      '<div class="pw-field">'+fieldLabel('性别',true)+'<div class="pw-radio-row">'+genderRadios+'</div>'+fieldErr('gender')+'</div>'+
      '<div class="pw-field">'+fieldLabel('地区',true)+'<input name="region" value="'+esc(regionVal)+'" placeholder="例如：马来西亚·吉隆坡">'+fieldErr('region')+'</div>'+
      '</div>'+
      '<div class="pw-field" data-field="voice_type">'+fieldLabel('声线',true)+
      '<div class="pw-chip-grid">'+(voiceTypeChecks||'<div class="pw-empty tiny">暂无声线选项，请联系后台在「声线管理」配置</div>')+'</div>'+
      '<p class="pw-field-hint">可多选；与标签分开，展示为「声线：甜妹」</p>'+fieldErr('voice_type')+'</div>'+
      '<div class="pw-field"><span class="pw-field-label">当前等级</span><p class="pw-field-hint">'+esc(levelLabel)+'（由后台评定，决定可设置的价格区间）</p></div>'+
      '<div class="pw-field">'+fieldLabel('标签',false)+
      '<div class="pw-chip-grid">'+tagChecks+'</div>'+
      '<p class="pw-field-hint">从后台标签库多选；保存后同步老板端大厅筛选</p></div>'+
      '<div class="pw-field">'+fieldLabel('介绍',false)+'<textarea name="bio" rows="4" placeholder="简单介绍你的技术、声音和陪玩风格">'+esc(bioVal)+'</textarea></div>'+
      '</section>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><h3>游戏与价格</h3>'+
      '<div class="pw-field" data-field="service_type">'+fieldLabel('可提供服务',true)+'<div class="pw-chip-grid">'+serviceTypeChecks+'</div>'+'<p class="pw-field-hint">可多选：陪玩服务 / 陪聊服务</p>'+fieldErr('service_type')+'</div>'+
      '<div class="pw-field" data-field="main_game">'+fieldLabel('可接游戏',true)+'<div class="pw-chip-grid">'+gameChecks+'</div>'+'<p class="pw-field-hint">从后台启用游戏中多选；每个勾选游戏需单独设置价格</p>'+fieldErr('main_game')+'</div>'+
      '<div class="pw-field" data-field="price">'+fieldLabel('各游戏价格',true)+
      '<div class="pw-price-meta"><div>当前等级：<strong>'+esc(levelLabel)+'</strong></div><div>可设置范围：<strong>'+esc(rangeText)+'</strong></div>'+
      (needsReset?'<div class="pw-field-error">有价格超出等级范围，请按游戏重新设置</div>':'')+
      '</div>'+
      '<div class="pw-game-price-grid" data-game-price-grid>'+priceRows+'</div>'+fieldErr('price')+'</div>'+
      '<div class="pw-two-col">'+
      '<div class="pw-field">'+fieldLabel('游戏 ID',true)+'<input name="game_id" value="'+esc(gameId)+'" placeholder="游戏内昵称或 ID">'+fieldErr('game_id')+'</div>'+
      '<div class="pw-field">'+fieldLabel('段位',false)+'<input name="rank" value="'+esc(rankVal)+'" placeholder="例如：超凡 2"></div>'+
      '</div>'+
      '<div class="pw-field">'+fieldLabel('擅长位置',false)+'<input name="position" value="'+esc(positionVal)+'" placeholder="例如：决斗 / 烟位"></div>'+
      '</section>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><h3>展示资料</h3>'+
      '<div class="pw-field pw-upload-block'+(state.profileErrors&&state.profileErrors.gallery?' is-missing':'')+'" data-field="gallery">'+
      fieldLabel('相册',true)+
      '<div class="pw-gallery-grid" data-gallery-list>'+(galleryHtml||'<div class="pw-empty tiny">还没有相册照片，请至少上传 1 张（最多 6 张）</div>')+'</div>'+
      '<label class="pw-btn pw-file-btn'+(uploadBusy==='gallery'||gallery.length>=6?' is-busy':'')+'" data-pw-upload-trigger="gallery">'+
      (uploadBusy==='gallery'?'上传中…':(gallery.length>=6?'已达 6 张上限':'上传相册照片'))+
      '<input type="file" class="pw-file-input" accept="image/jpeg,image/jpg,image/png,image/webp,image/*" data-upload-gallery '+(uploadBusy||gallery.length>=6?'disabled':'')+'>'+
      '</label>'+
      fieldErr('gallery')+
      '</div>'+
      '<div class="pw-field pw-upload-block'+(state.profileErrors&&state.profileErrors.voice?' is-missing':'')+'" data-field="voice">'+
      fieldLabel('录音',true)+
      (function(){
        var voiceMedia=((state.data&&state.data.media)||[]).filter(function(m){return m.mediaType==='voice'&&m.url})[0];
        var v=(voiceMedia&&voiceMedia.url)||p.voiceUrl||raw.voice_url||'';
        if(v){
          return '<div class="pw-voice-preview" data-voice-preview><audio controls preload="metadata" src="'+esc(v)+'"></audio></div>'+
            '<p class="pw-field-hint">已上传录音，可直接试听；重新上传将覆盖。</p>';
        }
        return '<div class="pw-voice-preview" data-voice-preview></div><p class="pw-field-hint">尚未上传语音试听。支持 mp3 / m4a / wav / webm。</p>';
      })()+
      '<label class="pw-btn pw-file-btn'+(uploadBusy==='voice'?' is-busy':'')+'">'+
      (uploadBusy==='voice'?'上传中…':'上传录音')+
      '<input type="file" class="pw-file-input" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,audio/mpeg,audio/mp4,audio/wav,audio/webm" data-upload-voice '+(uploadBusy?'disabled':'')+'>'+
      '</label>'+
      fieldErr('voice')+
      '</div>'+
      '<div class="pw-field">'+fieldLabel('在线状态',false)+'<p class="pw-field-hint">当前：'+esc((STATUS_META[currentOnlineStatus()]||{}).label||'离线')+'（只读，审核通过后可在工作台切换）</p></div>'+
      (function(){
        var reviews=(state.data&&state.data.reviews)||[];
        var fav=num((state.data&&state.data.summary&&state.data.summary.favorites)||p.favorites||0);
        var list=reviews.slice(0,8).map(function(r){
          var code=String(r.bossCode||r.bossUid||'').trim();
          if(!code||/@/.test(code)||/^[0-9a-f-]{20,}$/i.test(code))code='';
          var bossLabel=code||String(r.bossName||'').replace(/^老板\s*/,'')||'老板';
          if(code&&bossLabel.indexOf('MCJ')===-1&&!/^老板/.test(bossLabel))bossLabel=code;
          if(code)bossLabel=code;
          var orderLabel=String(r.orderNo||r.orderId||'').trim();
          var gameLabel=String(r.gameName||r.game||'').trim()||'-';
          return '<article class="pw-review-card">'+
            '<p class="pw-review-stars">'+reviewStars(r.rating)+'</p>'+
            '<p class="pw-review-name"><span class="pw-review-avatar">'+(bossLabel.slice(0,1)||'匿')+'</span><span>'+esc(bossLabel)+'</span></p>'+
            '<p class="pw-review-body">'+esc(r.content||'无文字评价')+'</p>'+
            '<p class="pw-review-meta">订单 '+esc(orderLabel||'-')+' · '+esc(gameLabel)+'</p>'+
            '<p class="pw-review-date">'+esc(fmtTime(r.createdAt||r.date))+'</p>'+
            '</article>';
        }).join('');
        return '<div class="pw-field"><span class="pw-field-label">评价 / 收藏（公开只读）</span>'+
          '<div class="pw-info-list" style="margin-bottom:10px"><div><span>收藏数</span><strong>'+esc(fav)+'</strong></div></div>'+
          (list?'<div class="pw-review-list">'+list+'</div>':'<div class="pw-empty tiny">暂无真实订单评价</div>')+
          '</div>';
      })()+
      '</section>'+
      '<button class="pw-btn primary" type="submit">保存公开资料</button>'+
      '</form>';
  }
  function matchesHallType(o,filter){
    if(filter==='all')return true;
    if(filter==='fixed')return o.orderTypeKey==='gameplay_mall';
    if(filter==='custom'){
      var k=String(o.orderTypeKey||o.orderType||'').toLowerCase();
      return k==='custom'||k==='open_grab'||k==='customer_service'||k==='cs_proxy'||!k;
    }
    return true;
  }
  function hallHtml(){
    var rows=(state.data&&state.data.openOrders)||[],perm=(state.data&&state.data.permissions)||{};
    var statusKey=currentOnlineStatus();
    var online=statusKey==='online';
    var locked=isAuditLocked();
    var statusMeta=STATUS_META[statusKey]||STATUS_META.offline;
    var typeFilter=state.hallOrderType||'all';
    var gameFilter=state.hallGame||'all';
    var games=[];
    var seenGame={};
    rows.forEach(function(o){var g=o.game||'';if(g&&!seenGame[g]){seenGame[g]=1;games.push(g)}});
    var filtered=rows.filter(function(o){
      if(!matchesHallType(o,typeFilter))return false;
      if(gameFilter!=='all'&&o.game!==gameFilter)return false;
      return true;
    });
    var statusReadout='<div class="pw-card pad" style="margin-bottom:14px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">'+
      '<span>当前状态：<strong>'+esc((locked?'审核中（不可接单）':statusMeta.emoji+' '+statusMeta.label))+'</strong>。如需切换，请前往工作台。</span>'+
      '<button class="pw-btn" type="button" data-route="/companion/dashboard">前往工作台</button>'+
      '</div>';
    var filtersRow='<div class="pw-hall-filters">'+
      HALL_TYPE_FILTERS.map(function(t){return '<button type="button" class="pw-tab-chip'+(typeFilter===t[0]?' active':'')+'" data-hall-type="'+t[0]+'">'+t[1]+'</button>'}).join('')+
      '<select data-hall-game aria-label="游戏筛选">'+
        '<option value="all">全部游戏</option>'+
        games.map(function(g){return '<option value="'+esc(g)+'" '+(gameFilter===g?'selected':'')+'>'+esc(g)+'</option>'}).join('')+
      '</select>'+
      '<button class="pw-btn" type="button" data-hall-refresh>刷新</button>'+
      '</div>';
    return '<div class="pw-page-head"><div><h2>抢单大厅</h2><p>仅「在线接单」可进入抢单。</p></div></div>'+
      statusReadout+
      (locked?'<div class="pw-empty" style="margin-bottom:12px"><strong>暂不可抢单</strong><span>'+esc(auditHint())+'</span></div>':'')+
      filtersRow+
      '<section class="pw-card-list">'+(filtered.length?filtered.map(function(o){
        var already=!!o.alreadyGrabbed||!!(o.myGrab&&o.myGrab.companionId);
        var hallState=o.hallState||'open';
        var grabCount=Number(o.grabCount||0)||0;
        var disabled=false,btnLabel='立即抢单';
        if(hallState==='settled'){disabled=true;btnLabel='已结单';}
        else if(hallState==='cancelled'){disabled=true;btnLabel='已取消';}
        else if(hallState==='expired'){disabled=true;btnLabel='已失效';}
        else if(already){disabled=true;btnLabel='已抢单，等待老板选择';}
        else if(locked){disabled=true;btnLabel='审核通过后可抢单';}
        else if(statusKey==='busy'){disabled=true;btnLabel='当前忙碌，无法抢新订单';}
        else if(statusKey==='paused'){disabled=true;btnLabel='已暂停接单，无法抢新订单';}
        else if(statusKey==='offline'){disabled=true;btnLabel='离线状态无法抢单';}
        else if(!perm.canAcceptOrder){disabled=true;btnLabel=perm.lockReason||perm.acceptLockReason||'暂不可接单';}
        var hallBadge=hallState==='settled'
          ?'<em class="pw-hall-badge settled">已结单</em>'
          :hallState==='cancelled'
            ?'<em class="pw-hall-badge cancelled">已取消</em>'
            :hallState==='expired'
              ?'<em class="pw-hall-badge expired">已失效</em>'
              :(grabCount>0?'<em class="pw-hall-badge grabbing">抢单中 · 已有 '+grabCount+' 人抢单</em>':'<em class="pw-hall-badge open">待抢单 · 已有 '+grabCount+' 人抢单</em>');
        var serviceText=String(o.serviceContent||'')
          .replace(/\[\[ORDER_GRABS\]\][\s\S]*$/g,'')
          .replace(/\[\[COMPLETION_PENDING\]\]/g,'')
          .replace(/\[\[BOSS_INTENT\]\][\s\S]*?\[\[\/BOSS_INTENT\]\]/g,'')
          .replace(/\buuid\s+create\s+regression\s+\d+\b/gi,'')
          .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'')
          .replace(/\b(selector|grabber)\b/gi,'')
          .trim()||'-';
        var orderNo=o.orderNo||humanId(o.id)||'-';
        var created=o.createdAt||o.appointmentAt||'';
        var createdLabel=created?fmtTime(created):'-';
        return '<article class="pw-grab-card'+(hallState==='settled'?' is-settled':'')+'" data-order-id="'+esc(o.id)+'"><header><div><span class="pw-type">'+esc(o.orderType||o.orderSource||'订单')+'</span>'+hallBadge+'<h3>'+esc(o.game||'-')+'</h3><p>'+esc(serviceText)+'</p></div><strong>'+money(o.amount||o.budget||0)+'</strong></header><div class="pw-order-meta"><div><span>订单编号</span><strong>'+esc(orderNo)+'</strong></div><div><span>服务类型</span><strong>'+esc(o.serviceType||o.serviceName||o.orderType||'-')+'</strong></div><div><span>游戏</span><strong>'+esc(o.game||'-')+'</strong></div><div><span>区服</span><strong>'+esc(o.gameServer||'-')+'</strong></div><div><span>单价</span><strong>'+money(o.unitPrice||0)+'</strong></div><div><span>时长/局数</span><strong>'+esc(o.duration||'-')+'</strong></div><div><span>老板备注</span><strong>'+esc(o.bossNotes||o.remark||'-')+'</strong></div><div><span>下单时间</span><strong>'+esc(createdLabel)+'</strong></div><div><span>订单来源</span><strong>'+esc(o.orderSource||o.orderType||'-')+'</strong></div><div><span>预计收入</span><strong>'+money(o.playerIncome||0)+'</strong></div><div><span>抢单人数</span><strong>'+esc(grabCount)+'</strong></div><div><span>当前状态</span><strong>'+esc(o.hallStateLabel||o.statusText||o.orderStatus||'待抢单')+'</strong></div></div><footer><button class="pw-btn primary" data-accept-order="'+esc(o.id)+'" '+(disabled?'disabled':'')+'>'+esc(btnLabel)+'</button></footer></article>';
      }).join(''):'<div class="pw-empty"><strong>暂无可抢订单</strong><span>'+(locked?auditHint():(!online?'请先切换为在线接单。':'客服发布订单后会自动显示，或调整筛选条件。'))+'</span></div>')+'</section>';
  }
  function accountDocCard(opts){
    var key=opts.key;
    var label=opts.label;
    var url=String(opts.url||'').trim();
    var busy=state.uploadBusy===key;
    var statusText=opts.statusText||'';
    var rejectReason=opts.rejectReason||'';
    var hasImg=!!url && !/^data:/i.test(url) && !/^blob:/i.test(url);
    // Same overlay file-input pattern as album/voice: absolute opacity-0 input (no hidden attr)
    // so the OS picker opens on the first click without waiting for a JS paint.
    var fileInput='<input type="file" class="pw-file-input" accept="image/jpeg,image/jpg,image/png,image/webp,image/*" data-upload-doc="'+esc(key)+'" '+(busy?'disabled':'')+'>';
    return '<div class="pw-field pw-doc-upload" data-doc-card="'+esc(key)+'">'+
      '<div class="pw-doc-upload-head"><span class="pw-field-label">'+esc(label)+'</span>'+
      (statusText?'<em class="pw-doc-status">'+esc(statusText)+'</em>':'')+
      '</div>'+
      (rejectReason?'<p class="pw-field-error">拒绝原因：'+esc(rejectReason)+'</p>':'')+
      (hasImg
        ?('<div class="pw-doc-preview-wrap">'+
          '<img class="pw-doc-preview" src="'+esc(url)+'" alt="'+esc(label)+'" data-doc-preview="'+esc(key)+'">'+
          '<div class="pw-upload-actions">'+
          '<label class="pw-btn pw-file-btn'+(busy?' is-busy':'')+'" data-pw-upload-trigger="doc" data-pw-upload-doc="'+esc(key)+'">'+(busy?'上传中…':'重新上传')+
          fileInput+
          '</label>'+
          '<button type="button" class="pw-btn danger" data-delete-doc="'+esc(key)+'" '+(busy?'disabled':'')+'>删除</button>'+
          '</div></div>')
        :('<label class="pw-doc-drop'+(busy?' is-busy':'')+'" data-pw-upload-trigger="doc" data-pw-upload-doc="'+esc(key)+'">'+
          fileInput+
          '<span class="pw-doc-plus">＋</span>'+
          '<strong>'+(busy?'上传中…':esc(opts.cta||('上传'+label)))+'</strong>'+
          '<small>支持 jpg / png / webp，单张不超过 10MB；可从相册选择或拍照</small>'+
          '</label>'))+
      '</div>';
  }
  function accountHtml(){
    var v=(state.data&&state.data.verification)||{},d=(state.data&&state.data.deposit)||{},level=(state.data&&state.data.levelInfo)||{},p=(state.data&&state.data.player)||{};
    var ua=unifiedAccess();
    var raw=p.raw||{};
    var rules=(state.data&&state.data.withdrawalRules)||{};
    var idStatusRaw=v.identityStatus||'';
    var bankStatusRaw=v.bankStatus||'';
    var appStatusRaw=ua.profile_review_status||p.auditStatus||raw.application_status||'';
    var depositStatusRaw=ua.deposit_status||d.status||v.depositStatus||'';
    var idSubmitted=!!(v.identitySubmitted||(v.realName&&(v.hasIdFront||v.idFrontUrl)&&(v.hasIdBack||v.idBackUrl)&&v.hasIdentityNo));
    // Treat formal ID/payment submit as locked when either identity or bank is pending/approved, or application is pending after privacy submit.
    var verifySubmitted=idSubmitted||!!v.paymentSubmitted||!!(v.bankName&&(v.bankAccountMasked||v.hasBankAccount));
    if(/pending|review|submit|approved|verified|passed/.test(String(appStatusRaw).toLowerCase())&&idSubmitted)verifySubmitted=true;
    // 资料审核以 application_status（player.auditStatus）为准，与后台陪玩申请审核同一 DB 字段。
    var verifyStatusForPhase=appStatusRaw||idStatusRaw||bankStatusRaw;
    var verifyPhase=privacyReviewPhase(verifyStatusForPhase,{submitted:verifySubmitted||!!appStatusRaw});
    var appStatusLabel=STATUS_CN.verification(appStatusRaw);
    var depositSubmitted=!!(d.depositSubmitted||((d.hasProof||d.proofUrl)&&num(d.paidAmount)>0&&d.paymentMethod));
    var depositPhase=privacyReviewPhase(depositStatusRaw,{submitted:depositSubmitted});
    var idStatus=STATUS_CN.verification(idStatusRaw);
    var depositStatus=STATUS_CN.deposit(depositStatusRaw);
    var verifyReject=v.applicationRejectReason||[v.identityRejectReason,v.paymentRejectReason].filter(Boolean).join('；');
    var depositReject=d.rejectReason||v.depositRejectReason||'';
    var contactPhone=accountDraftVal('contact_phone',raw.contact_phone||v.phone||'');
    var realName=accountDraftVal('real_name',v.realName||'');
    var identityNo=accountDraftVal('identity_no','');
    var verifyPhone=accountDraftVal('phone',v.phone||raw.contact_phone||'');
    var bankName=accountDraftVal('bank_name',v.bankName||'');
    var bankAccount=accountDraftVal('bank_account','');
    var tngAccount=accountDraftVal('tng_account',v.tngAccount||'');
    var verifyRemark=accountDraftVal('remark','');
    var paidAmount=accountDraftVal('paid_amount',d.paidAmount||'');
    var paymentMethod=accountDraftVal('payment_method',d.paymentMethod||'');
    var depositRemark=accountDraftVal('deposit_remark',d.remark||'');
    var verifyLocked=verifyPhase==='pending'||verifyPhase==='approved';
    var depositLocked=depositPhase==='pending'||depositPhase==='approved';
    var verifyView=
      '<section class="pw-card pad pw-form-narrow pw-account-verify" style="margin-top:14px" data-verification-view>'+
      '<h3>身份证 / 实名认证 / 收款账户</h3>'+
      privacyReviewBannerHtml(verifyPhase,verifyReject,'profile')+
      '<p class="pw-note">资料审核：<strong data-audit-status="'+esc(appStatusRaw)+'">'+esc(appStatusLabel)+'</strong> · 实名：<strong>'+esc(idStatus)+'</strong> · 收款：<strong>'+esc(STATUS_CN.verification(bankStatusRaw))+'</strong></p>'+
      '<div class="pw-info-list">'+
        infoRow('真实姓名',v.realName||'-')+
        infoRow('身份证号码',v.identityNoMasked||(v.hasIdentityNo?'已填写':'-'))+
        infoRow('身份证正面',(v.hasIdFront||v.idFrontUrl)?'已上传':'-')+
        infoRow('身份证反面',(v.hasIdBack||v.idBackUrl)?'已上传':'-')+
        infoRow('联系方式',v.phone||raw.contact_phone||'-')+
        infoRow('银行名称',v.bankName||'-')+
        infoRow('收款账号',v.bankAccountMasked||rules.currentAccount||'-')+
        infoRow('TNG 账号',v.tngAccount||'-')+
      '</div>'+
      ((v.idFrontUrl||v.idBackUrl)
        ?('<div class="pw-doc-preview-wrap" style="margin-top:12px">'+(v.idFrontUrl?'<img class="pw-doc-preview" src="'+esc(v.idFrontUrl)+'" alt="身份证正面">':'')+(v.idBackUrl?'<img class="pw-doc-preview" src="'+esc(v.idBackUrl)+'" alt="身份证反面">':'')+'</div>')
        :'')+
      '</section>';
    var verifyForm=
      '<form class="pw-card pad pw-form pw-form-narrow pw-account-verify" style="margin-top:14px" data-verification-form>'+
      '<h3>身份证 / 实名认证 / 收款账户</h3>'+
      privacyReviewBannerHtml(verifyPhase,verifyReject,'profile')+
      '<p class="pw-note">资料审核：<strong data-audit-status="'+esc(appStatusRaw)+'">'+esc(appStatusLabel)+'</strong>'+(verifyReject?' · 拒绝原因：'+esc(verifyReject):'')+'</p>'+
      '<label>真实姓名<input name="real_name" value="'+esc(realName)+'" required></label>'+
      '<label>身份证号码<input name="identity_no" value="'+esc(identityNo)+'" required autocomplete="off" placeholder="'+(v.identityNoMasked?'已保存 '+v.identityNoMasked+'，修改请重新输入':'')+'"></label>'+
      accountDocCard({key:'id_front',label:'身份证正面',cta:'上传身份证正面',url:v.idFrontUrl||'',statusText:idStatus,rejectReason:v.identityRejectReason||''})+
      accountDocCard({key:'id_back',label:'身份证反面',cta:'上传身份证反面',url:v.idBackUrl||'',statusText:idStatus,rejectReason:v.identityRejectReason||''})+
      '<label>联系方式<input name="phone" value="'+esc(verifyPhone)+'" required></label>'+
      '<label>银行名称<input name="bank_name" value="'+esc(bankName)+'" required></label>'+
      '<label>收款账号 / 提现账户<input name="bank_account" value="'+esc(bankAccount)+'" required autocomplete="off" placeholder="'+(v.bankAccountMasked?'已保存 '+v.bankAccountMasked+'，修改请重新输入':'')+'"></label>'+
      '<label>TNG 账号<input name="tng_account" value="'+esc(tngAccount)+'"></label>'+
      '<label>备注<textarea name="remark">'+esc(verifyRemark)+'</textarea></label>'+
      '<button class="pw-btn primary" type="submit">'+(verifyPhase==='rejected'?'重新提交认证审核':'提交认证审核')+'</button></form>';
    var depositView=
      '<section class="pw-card pad pw-form-narrow pw-account-deposit" style="margin-top:14px" data-deposit-view>'+
      '<h3>押金</h3>'+
      privacyReviewBannerHtml(depositPhase,depositReject,'deposit')+
      '<p class="pw-note">审核状态：<strong>'+esc(depositStatus)+'</strong></p>'+
      '<div class="pw-info-list">'+
        infoRow('已缴金额',d.paidAmount!=null&&d.paidAmount!==''?('RM '+d.paidAmount):'-')+
        infoRow('付款方式',d.paymentMethod||'-')+
        infoRow('付款凭证',(d.hasProof||d.proofUrl)?'已上传':'-')+
        infoRow('备注',d.remark||'-')+
      '</div>'+
      (d.proofUrl?'<div class="pw-doc-preview-wrap" style="margin-top:12px"><img class="pw-doc-preview" src="'+esc(d.proofUrl)+'" alt="押金凭证"></div>':'')+
      '</section>';
    var depositForm=
      '<form class="pw-card pad pw-form pw-form-narrow pw-account-deposit" style="margin-top:14px" data-deposit-form>'+
      '<h3>押金</h3>'+
      privacyReviewBannerHtml(depositPhase,depositReject,'deposit')+
      '<p class="pw-note">审核状态：<strong>'+esc(depositStatus)+'</strong>'+(depositReject?' · 拒绝原因：'+esc(depositReject):'')+'</p>'+
      '<label>已缴金额 RM<input name="paid_amount" type="number" min="1" required value="'+esc(paidAmount)+'"></label>'+
      '<label>付款方式<input name="payment_method" required value="'+esc(paymentMethod)+'" placeholder="例如：银行转账 / TNG"></label>'+
      accountDocCard({key:'deposit_proof',label:'押金付款凭证',cta:'上传付款凭证',url:d.proofUrl||'',statusText:depositStatus,rejectReason:depositReject})+
      '<label>备注<textarea name="remark">'+esc(depositRemark)+'</textarea></label>'+
      '<button class="pw-btn primary" type="submit">'+(depositPhase==='rejected'?'重新提交押金凭证':'提交押金凭证')+'</button></form>';
    return '<div class="pw-page-head"><div><h2>账号中心（隐私）</h2><p>仅本人 / 客服 / 后台可见，老板永远看不到。</p></div><button class="pw-btn" type="button" data-route="/companion/profile">公开资料</button></div>'+
      accountAccessBannerHtml()+
      reviewRejectBannerHtml('/companion/account')+
      '<div class="pw-alert"><strong>隐私提示</strong><span>本页面仅本人和平台后台可见，不会公开给老板。</span></div>'+
      '<div class="pw-two-col">'+
        '<section class="pw-card pad"><h3>账号信息</h3><div class="pw-info-list">'+
          infoRow('登录邮箱',p.email||p.uid||'-')+
          infoRow('联系方式',raw.contact_phone||v.phone||'未填写')+
          infoRow('实名认证',idStatus)+
          infoRow('真实姓名',v.realName||'未填写')+
          infoRow('资料审核状态',STATUS_CN.verification(ua.profile_review_status))+
        '</div></section>'+
        '<section class="pw-card pad"><h3>提现与押金</h3><div class="pw-info-list">'+
          infoRow('收款账户审核',STATUS_CN.verification(bankStatusRaw))+
          infoRow('银行名称',v.bankName||'未填写')+
          infoRow('当前提现账户',rules.currentAccount||'未绑定')+
          infoRow('押金状态',STATUS_CN.deposit(ua.deposit_status))+
          infoRow('账号接单权限',STATUS_CN.accountAccess(ua.account_access_status))+
          infoRow('当前等级',level.level||p.level||'未设置')+
        '</div>'+
        '<div class="pw-actions" style="margin-top:12px"><button class="pw-btn primary" type="button" data-route="/companion/earnings" data-earnings-tab="withdraw">去提现</button></div>'+
        '</section>'+
      '</div>'+
      '<form class="pw-card pad pw-form pw-form-narrow" style="margin-top:14px" data-private-contact-form><h3>联系方式</h3>'+
      '<label>联系方式（WhatsApp / 手机）<input name="contact_phone" value="'+esc(contactPhone)+'" required placeholder="仅后台/客服可见"></label>'+
      '<button class="pw-btn primary" type="submit">保存联系方式</button></form>'+
      (verifyLocked?verifyView:verifyForm)+
      (depositLocked?depositView:depositForm)+
      '<section class="pw-card pad pw-form-narrow" style="margin-top:14px"><h3>账号安全 / 登录设备 / 修改密码</h3>'+
      '<div class="pw-info-list">'+
      infoRow('登录账号',p.email||p.uid||'-')+
      infoRow('最近资料更新',raw.updated_at||p.updatedAt||'-')+
      infoRow('本机设备',navigator.userAgent?String(navigator.userAgent).slice(0,48)+'…':'未知')+
      '</div>'+
      '<p class="pw-note" style="margin-top:10px">修改密码：请到登录页使用「忘记密码」。后台通知请查看「消息中心」。</p>'+
      '<div class="pw-actions" style="margin-top:12px"><button class="pw-btn" type="button" data-route="/companion/settings">打开设置</button><button class="pw-btn" type="button" data-route="/companion/rules">陪玩规则</button><button class="pw-btn danger" type="button" data-logout>退出登录</button></div></section>';
  }
  function rulesHtml(){
    var rules=state.workRules||[];
    if(state.rulesLoading)return '<div class="pw-empty">正在加载陪玩规则…</div>';
    return '<div class="pw-page-head"><div><h2>陪玩规则</h2><p>内容由后台「制度与等级」维护，保存后实时同步。</p></div><button class="pw-btn" type="button" data-reload-rules>刷新</button></div>'+
      (rules.length?rules.map(function(r){
        return '<section class="pw-card pad" style="margin-bottom:12px"><h3 style="margin:0 0 8px">'+esc(r.category||r.title||'规则')+'</h3>'+
          '<div style="white-space:pre-wrap;line-height:1.65;color:rgba(255,220,235,.9);font-size:14px">'+esc(r.body||r.content||'')+'</div>'+
          '<p class="pw-note" style="margin-top:10px;margin-bottom:0">版本 '+esc(r.version||'1')+'</p>'+
          (r.updatedAt?'<p class="pw-note" style="margin-top:4px">最后更新：'+esc(fmtContentTime(r.updatedAt))+'</p>':'')+'</section>';
      }).join(''):'<div class="pw-empty"><strong>暂无规则</strong><span>请联系管理员在后台发布陪玩规则。</span></div>');
  }
  function mineHtml(){return accountHtml()}
  function hallGateMessage(){
    if(isAuditLocked())return auditHint();
    return '请先切换为在线接单。';
  }
  function guessAudioMime(file){
    var type=String(file&&file.type||'').toLowerCase();
    if(/^audio\//.test(type)&&type!=='audio/mp3')return type==='audio/mp3'?'audio/mpeg':type;
    if(type==='audio/mp3')return 'audio/mpeg';
    var name=String(file&&file.name||'');
    if(/\.mp3$/i.test(name))return 'audio/mpeg';
    if(/\.m4a$/i.test(name))return 'audio/mp4';
    if(/\.wav$/i.test(name))return 'audio/wav';
    if(/\.webm$/i.test(name))return 'audio/webm';
    if(/\.ogg$/i.test(name))return 'audio/ogg';
    if(/\.aac$/i.test(name))return 'audio/aac';
    return type||'audio/mpeg';
  }
  function readFileAsDataUrl(file,kind){
    if(window.MCJUpload&&window.MCJUpload.validateFile&&window.MCJUpload.readAsDataUrl){
      var check=window.MCJUpload.validateFile(file,kind==='voice'?'audio':'image');
      if(!check.ok)return Promise.reject(new Error(check.error||'文件格式不支持'));
      return window.MCJUpload.readAsDataUrl(file).then(function(result){
        if(kind==='voice'){
          var mime=guessAudioMime(file);
          if(mime&&/^data:/i.test(result)){
            result=result.replace(/^data:[^;]*;base64,/i,'data:'+mime+';base64,');
          }
        }
        return result;
      });
    }
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
        if(file.size>10*1024*1024)return reject(new Error('单张图片不能超过 10MB'));
      }
      var reader=new FileReader();
      reader.onload=function(){
        var result=String(reader.result||'');
        if(kind==='voice'){
          var mime=guessAudioMime(file);
          if(mime&&/^data:/i.test(result)){
            result=result.replace(/^data:[^;]*;base64,/i,'data:'+mime+';base64,');
          }
        }
        resolve(result);
      };
      reader.onerror=function(){reject(new Error(kind==='voice'?'读取录音失败，请重试':'读取图片失败，请重试'))};
      reader.readAsDataURL(file);
    });
  }
  function compressImageDataUrl(dataUrl,maxEdge,quality){
    return new Promise(function(resolve){
      try{
        var img=new Image();
        img.onload=function(){
          var w=img.naturalWidth||img.width||0;
          var h=img.naturalHeight||img.height||0;
          if(!w||!h){resolve(dataUrl);return}
          var edge=Math.max(w,h);
          var scale=edge>maxEdge?(maxEdge/edge):1;
          // Keep ID text readable: only shrink very large photos.
          if(scale>=0.98){resolve(dataUrl);return}
          var canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(w*scale));
          canvas.height=Math.max(1,Math.round(h*scale));
          var ctx=canvas.getContext('2d');
          if(!ctx){resolve(dataUrl);return}
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL('image/jpeg',quality||0.88));
        };
        img.onerror=function(){resolve(dataUrl)};
        img.src=dataUrl;
      }catch(e){resolve(dataUrl)}
    });
  }
  function uploadPrivateDoc(docType,file){
    if(!file){toast('未选择文件');return Promise.resolve()}
    if(state.uploadBusy){toast('请等待当前上传完成');return Promise.resolve()}
    captureLiveForms(true);
    // Mark busy + toast first; picker already closed. Avoid pre-picker paint lag.
    state.uploadBusy=docType;
    toast('上传中…');
    var card=document.querySelector('[data-doc-card="'+docType+'"]');
    if(card){
      card.classList.add('is-uploading');
      var labelBusy=card.querySelector('.pw-doc-drop strong, .pw-file-btn');
      if(labelBusy)labelBusy.textContent='上传中…';
      card.querySelectorAll('input[type="file"]').forEach(function(inp){inp.disabled=true});
    }
    return withTimeout(readFileAsDataUrl(file,'image').then(function(dataUrl){
      return compressImageDataUrl(dataUrl,1280,0.82);
    }).then(function(dataUrl){
      return api('upload_private_doc',{doc_type:docType,data_url:dataUrl,filename:file.name||(docType+'.jpg')});
    }),60000,'上传超时，请检查网络后重试').then(function(res){
      toast(res.message||'上传成功');
      state.uploadBusy='';
      return loadData({soft:true,forcePaint:true,preserveScroll:true});
    }).catch(function(err){
      state.uploadBusy='';
      paint({preserveScroll:true});
      toast(err.message||'上传失败，请重试');
    });
  }
  function deletePrivateDoc(docType){
    if(state.uploadBusy){toast('请等待当前上传完成');return}
    if(!window.confirm('确定删除这张图片吗？'))return;
    captureLiveForms(true);
    state.uploadBusy=docType;
    paint({preserveScroll:true});
    api('delete_private_doc',{doc_type:docType}).then(function(res){
      toast(res.message||'已删除');
      state.uploadBusy='';
      return loadData({soft:true,forcePaint:true,preserveScroll:true});
    }).catch(function(err){
      state.uploadBusy='';
      paint({preserveScroll:true});
      toast(err.message||'删除失败');
    });
  }
  function withTimeout(promise,ms,message){
    return new Promise(function(resolve,reject){
      var done=false;
      var t=setTimeout(function(){if(done)return;done=true;reject(new Error(message||'请求超时，请重试'))},ms||45000);
      Promise.resolve(promise).then(function(v){if(done)return;done=true;clearTimeout(t);resolve(v)},function(err){if(done)return;done=true;clearTimeout(t);reject(err)});
    });
  }
  function uploadImage(mediaType,file){
    if(state.uploadBusy){toast('请等待当前上传完成');return Promise.resolve()}
    // Always freeze in-progress fields before any re-render triggered by upload.
    captureLiveForms(true);
    state.uploadBusy=mediaType;
    var localPreview='';
    paint();
    return withTimeout(readFileAsDataUrl(file,mediaType==='voice'?'voice':'image').then(function(dataUrl){
      localPreview=dataUrl;
      var preview=document.querySelector('[data-avatar-preview]');
      if(mediaType==='avatar'&&preview)preview.src=dataUrl;
      if(mediaType==='voice'){
        var host=document.querySelector('[data-voice-preview]');
        if(host)host.innerHTML='<audio controls preload="metadata" src="'+esc(dataUrl)+'"></audio>';
      }
      if(mediaType==='gallery'){
        var list=document.querySelector('[data-gallery-list]');
        if(list){
          var empty=list.querySelector('.pw-empty');
          if(empty)empty.remove();
          var tmp=document.createElement('div');
          tmp.className='pw-gallery-item is-uploading';
          tmp.innerHTML='<img src="'+esc(dataUrl)+'" alt="相册上传中">';
          list.appendChild(tmp);
        }
      }
      return api('upload_media',{media_type:mediaType,data_url:dataUrl,filename:file.name||(mediaType==='voice'?'voice.webm':mediaType+'.jpg')});
    }),45000,'上传超时，请检查网络后重试').then(function(res){
      toast(res.message||'上传成功');
      state.uploadBusy='';
      // Keep draft + force paint so thumbnails / voice player refresh without wiping fields.
      if(res&&res.url&&mediaType==='avatar'&&state.data&&state.data.player){
        state.data.player.avatar=res.url;
        state.data.player.hasCustomAvatar=true;
      }
      if(res&&res.url&&mediaType==='voice'&&state.data&&state.data.player){
        state.data.player.voiceUrl=res.url;
      }
      return loadData({soft:true,forcePaint:true});
    }).catch(function(err){
      state.uploadBusy='';
      captureLiveForms(true);
      paint();
      toast(err.message||'上传失败，请重试');
    });
  }
  function validateProfileForm(form){
    var fd=new FormData(form);
    var errors={};
    var missing=[];
    var nickname=String(fd.get('nickname')||'').trim();
    var age=Number(fd.get('age'));
    var gender=String(fd.get('gender')||'').trim();
    var region=String(fd.get('region')||'').trim();
    var gameId=String(fd.get('game_id')||'').trim();
    var serviceTypes=Array.prototype.map.call(form.querySelectorAll('input[name="service_type_opt"]:checked'),function(el){return el.value}).filter(Boolean);
    var voiceTypes=Array.prototype.map.call(form.querySelectorAll('input[name="voice_type_opt"]:checked'),function(el){return el.value}).filter(Boolean);
    var publicTagList=Array.prototype.map.call(form.querySelectorAll('input[name="public_tag_opt"]:checked'),function(el){return el.value}).filter(Boolean);
    var publicTagsJoined=publicTagList.join('、');
    var serviceInputs=Array.prototype.slice.call(form.querySelectorAll('input[name="service_id_opt"]:checked'));
    var serviceIds=serviceInputs.map(function(el){return el.value}).filter(Boolean);
    var serviceNames=serviceInputs.map(function(el){return el.getAttribute('data-game-name')||el.value}).filter(Boolean);
    var minP=20,maxP=30,maxPlus=false;
    var sample=form.querySelector('[data-game-price-grid] input')||form.querySelector('[name="price"]');
    if(sample){
      minP=Number(sample.dataset.minPrice)||minP;
      maxP=Number(sample.dataset.maxPrice)||maxP;
      maxPlus=sample.dataset.maxPlus==='1';
    }
    var gamePrices={};
    var priceError='';
    serviceInputs.forEach(function(el){
      var id=el.value;
      var name=el.getAttribute('data-game-name')||id;
      var raw=String(fd.get('game_price_'+id)||'').trim();
      if(!raw){priceError=priceError||('请填写 '+name+' 的价格');return;}
      if(!/^\d+(\.\d{1,2})?$/.test(raw)){priceError=priceError||(name+' 单价格式无效');return;}
      var price=Number(raw);
      if(price<minP||(!maxPlus&&price>maxP)){priceError=priceError||(name+' 须在 RM'+minP+'–RM'+maxP+(maxPlus?'+':'')+' 之间');return;}
      gamePrices[id]=price;
      if(name)gamePrices[name]=price;
    });
    if(!nickname){errors.nickname='请填写昵称';missing.push('缺少昵称')}
    if(!Number.isFinite(age)||age<18||age>60){errors.age='年龄须为 18–60 的数字';missing.push('缺少年龄')}
    if(!gender){errors.gender='请选择性别';missing.push('缺少性别')}
    if(!region){errors.region='请填写地区';missing.push('缺少地区')}
    if(!voiceTypes.length){errors.voice_type='请至少选择一种声线';missing.push('缺少声线')}
    if(!serviceTypes.length){errors.service_type='请至少选择一种可提供服务';missing.push('缺少服务类型')}
    if(!serviceIds.length){errors.main_game='请至少选择一个可接游戏';missing.push('缺少游戏资料')}
    if(!gameId){errors.game_id='请填写游戏 ID';if(missing.indexOf('缺少游戏资料')===-1)missing.push('缺少游戏资料')}
    if(priceError){errors.price=priceError;missing.push('缺少价格')}

    var p=(state.data&&state.data.player)||{};
    var media=(state.data&&state.data.media)||[];
    var hasAvatar=media.some(function(m){return m.mediaType==='avatar'&&m.url})||!!(p.hasCustomAvatar&&p.avatar&&p.avatar!=='/default-avatar.png');
    var hasGallery=media.some(function(m){return m.mediaType==='gallery'&&m.url});
    var voiceMedia=media.filter(function(m){return m.mediaType==='voice'&&m.url})[0];
    var hasVoice=!!(voiceMedia&&voiceMedia.url)||!!(p.voiceUrl||(p.raw&&p.raw.voice_url));
    if(!hasAvatar){errors.avatar='缺少头像';missing.push('缺少头像')}
    if(!hasGallery){errors.gallery='缺少相册';missing.push('缺少相册')}
    if(!hasVoice){errors.voice='缺少录音';missing.push('缺少录音')}

    // de-dupe missing labels while preserving order
    var seen={};
    missing=missing.filter(function(x){if(seen[x])return false;seen[x]=1;return true});
    state.profileErrors=errors;
    state.profileMissing=missing;
    var primaryPrice=serviceIds.length&&gamePrices[serviceIds[0]]!=null?String(gamePrices[serviceIds[0]]):'';
    return {
      ok:!Object.keys(errors).length,
      missing:missing,
      payload:{
        nickname:nickname,
        age:String(age),
        gender:gender,
        region:region,
        service_type:serviceTypes.join(','),
        service_ids:serviceIds,
        main_game:serviceNames.join('、'),
        game_id:gameId,
        rank:String(fd.get('rank')||'').trim(),
        position:String(fd.get('position')||'').trim(),
        bio:String(fd.get('bio')||'').trim(),
        public_tags:publicTagsJoined,
        tags:publicTagsJoined,
        voice_type:voiceTypes.join('、'),
        voiceType:voiceTypes.join('、'),
        price:primaryPrice,
        game_prices:gamePrices
      }
    };
  }
  function highlightProfileMissing(form){
    if(!form)return;
    form.querySelectorAll('.pw-field.is-missing').forEach(function(n){n.classList.remove('is-missing')});
    form.querySelectorAll('[data-field-error]').forEach(function(n){n.remove()});
    var order=['avatar','nickname','age','gender','region','voice_type','service_type','main_game','price','game_id','gallery','voice'];
    var firstField=null;
    order.forEach(function(key){
      if(!state.profileErrors||!state.profileErrors[key])return;
      var field=form.querySelector('[data-field="'+key+'"]');
      if(!field){
        var input=form.querySelector('[name="'+key+'"]')||form.querySelector('input[name="service_type_opt"]')||form.querySelector('input[name="service_id_opt"]');
        field=input&&input.closest('.pw-field');
      }
      if(!field)return;
      field.classList.add('is-missing');
      var span=document.createElement('span');
      span.className='pw-field-error';
      span.setAttribute('data-field-error',key);
      span.textContent=state.profileErrors[key];
      field.appendChild(span);
      if(!firstField)firstField=field;
    });
    if(firstField){
      try{firstField.scrollIntoView({behavior:'smooth',block:'center'})}catch(err){}
      var focusEl=firstField.querySelector('input:not([type="file"]):not([type="hidden"]),textarea,select');
      if(focusEl&&typeof focusEl.focus==='function'){
        try{focusEl.focus({preventScroll:true})}catch(e){}
      }
    }
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
      if(isIsolationMode()){toast(isolationHint());go('/companion/review-status');return}
      if(isAuditLocked()){toast(auditHint());return}
      go('/companion/order-hall');
      return;
    }
    if(e.target.closest('[data-isolation-cs-open]')){
      api('start_cs_consult',{consult_type:'profile_audit',forceNew:false}).then(function(res){
        var newId=res.conversationId||res.conversation_id||(res.data&&res.data.conversationId)||'';
        state.chatSession='cs';
        if(newId)state.chatConversationId=String(newId);
        toast((res&&res.message)||'已连接客服，可在下方继续咨询审核问题');
        return reloadInbox().then(function(){paint({preserveScroll:true});});
      }).catch(function(err){toast(err.message||'客服连接失败')});
      return;
    }
    if(e.target.closest('[data-reload-rules]')){
      loadWorkRules();
      return;
    }
    var r=e.target.closest('[data-route]');
    if(r){
      if(isIsolationMode()){
        var nextPath=String(r.dataset.route||'');
        var nextKey=ROUTES[nextPath.replace(/\/$/,'')]||'';
        if(nextPath.indexOf('/companion/grab-hall')>=0)nextKey='hall';
        if(nextKey&&!ISOLATION_ALLOWED_ROUTES[nextKey]){
          toast(isolationHint());
          go('/companion/review-status');
          return;
        }
      }
      if(r.dataset.route==='/companion/order-hall' && isAuditLocked()){
        toast(auditHint());
        return;
      }
      if(r.dataset.orderFilter)state.orderFilter=r.dataset.orderFilter;
      if(r.dataset.earningsTab)state.earningsTab=r.dataset.earningsTab;
      go(r.dataset.route);
      if(/\/rules/.test(r.dataset.route||''))loadWorkRules();
      if(/\/(wallet|earnings|withdraw|account|mine)/.test(r.dataset.route||''))loadData({soft:true});
      if(/\/messages/.test(r.dataset.route||'')){
        loadData({soft:true}).then(function(){return markActiveChatSessionRead()});
      }
      return;
    }
    var earnTab=e.target.closest('[data-earnings-tab]');
    if(earnTab){state.earningsTab=earnTab.dataset.earningsTab||'overview';paint();return}
    var chatSess=e.target.closest('[data-chat-session]');
    if(chatSess){
      var sess=chatSess.dataset.chatSession;
      if(sess==='system'){
        state.chatSession='system';
      }else{
        state.chatSession='cs';
        var convId=chatSess.dataset.csConversation||'';
        if(convId)state.chatConversationId=String(convId);
      }
      reloadInbox().then(function(){return markActiveChatSessionRead()});
      return;
    }
    var endCsBtn=e.target.closest('[data-end-cs-chat]');
    if(endCsBtn){
      var endCid=endCsBtn.getAttribute('data-end-cs-chat')||state.chatConversationId||'';
      if(!endCid){toast('会话无效');return}
      api('end_cs_conversation',{conversation_id:endCid,id:endCid}).then(function(res){
        toast((res&&res.message)||'对话已结束');
        return reloadInbox();
      }).catch(function(err){toast(err.message||'结束失败')});
      return;
    }
    var startCsBtn=e.target.closest('[data-start-cs-consult]');
    if(startCsBtn){
      var consultPick=root.querySelector('[data-cs-consult-type]');
      var startType=String((consultPick&&consultPick.value)||'other').trim()||'other';
      api('start_cs_consult',{consult_type:startType,forceNew:true}).then(function(res){
        var newId=res.conversationId||res.conversation_id||(res.data&&res.data.conversationId)||'';
        state.chatSession='cs';
        if(newId)state.chatConversationId=String(newId);
        toast((res&&res.message)||'已发起咨询');
        return reloadInbox();
      }).catch(function(err){toast(err.message||'发起失败')});
      return;
    }
    var hallType=e.target.closest('[data-hall-type]');
    if(hallType){state.hallOrderType=hallType.dataset.hallType||'all';paint();return}
    if(e.target.closest('[data-hall-refresh]')){loadData({soft:true});return}
    if(e.target.closest('[data-account-toggle]')){e.target.closest('.pw-account').classList.toggle('open');return}
    if(e.target.closest('[data-logout]')){clearSession();location.replace('/companion/login/');return}
    if(e.target.closest('[data-reload-inbox]')){reloadInbox();return}
    if(e.target.closest('[data-forgot-dialog] [data-forgot-close]')|| (e.target.closest('[data-forgot-close]')&&!e.target.closest('[data-forgot-dialog]'))){
      state.forgotStep='';state.forgotAccount='';state.forgotMsg='';state.forgotResetToken='';state.forgotBusy=false;paint();return;
    }
    if(e.target.closest('[data-forgot-password]')){
      e.preventDefault();
      function openForgot(){
        window.MCJForgotPassword.open({
          role:'companion',
          onDone:function(){
            state.loginError=window.MCJForgotPassword.SUCCESS_TOAST||'密码修改成功，请重新登录。';
            state.authTab='login';
            paint();
          }
        });
      }
      if(window.MCJForgotPassword&&typeof window.MCJForgotPassword.open==='function'){
        openForgot();
        return;
      }
      var s=document.createElement('script');
      s.src='/src/forgot-password.js?v=20260804forgotP0b';
      s.onload=function(){ if(window.MCJForgotPassword) openForgot(); };
      document.head.appendChild(s);
      return;
    }
    if(e.target.closest('[data-forgot-resend]')){
      if(state.forgotBusy||!state.forgotAccount)return;
      state.forgotBusy=true;state.forgotMsg='';paint();
      api('send_reset_code',{account:state.forgotAccount}).then(function(x){
        state.forgotBusy=false;state.forgotMsg=x.message||'验证码已重新发送';paint();
      }).catch(function(err){state.forgotBusy=false;state.forgotMsg=err.message||'发送失败';paint();});
      return;
    }
    var accept=e.target.closest('[data-accept-order]');
    if(accept){
      if(!confirm('确认抢单？抢单后需等待老板选择，不会立即成为正式接单，也不能直接开始订单。'))return;
      api('accept_order',{id:accept.dataset.acceptOrder}).then(function(x){
        playCue('grab');
        toast(x.message||'已抢单，等待老板选择。');
        state.route='orders';
        state.orderFilter='waiting_selection';
        go('/companion/orders');
        return loadData();
      }).catch(function(err){toast(err.message)});
      return;
    }
    var filterBtn=e.target.closest('[data-order-filter]');
    if(filterBtn){state.orderFilter=filterBtn.dataset.orderFilter||'all';paint();return}
    if(e.target.closest('[data-close-settlement]')){
      if(e.target.closest('[data-settlement-dialog]')&&!e.target.closest('.pw-dialog-head [data-close-settlement],.pw-actions [data-close-settlement]'))return;
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
        api(act,{id:oid}).then(function(x){
          toast(x.message||'已确认接单');
          state.route='orders';
          state.orderFilter='waiting_start';
          go('/companion/orders');
          return loadData();
        }).catch(function(err){toast(err.message)});
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
        api(act,{id:oid}).then(function(x){
          toast(x.message||'已开始服务');
          state.route='orders';
          state.orderFilter='running';
          go('/companion/orders');
          return loadData();
        }).catch(function(err){toast(err.message)});
        return;
      }
      if(act==='complete_order'||act==='confirm_complete'){
        if(!confirm('确认本次服务已经完成吗？'))return;
        api(act,{id:oid}).then(function(x){
          if(x.settlement){state.settlement=x.settlement;}
          toast(x.message||'已提交完成，订单进入已完成');
          state.route='orders';
          state.orderFilter='completed';
          go('/companion/orders');
          return loadData();
        }).catch(function(err){toast(err.message)});
        return;
      }
      api(act,{id:oid}).then(function(x){
        toast(x.message||'操作成功');
        return loadData();
      }).catch(function(err){toast(err.message)});
      return;
    }
    var online=e.target.closest('[data-online-status]');
    if(online){
      if(isAuditLocked()){toast(auditHint());return}
      if(online.disabled)return;
      var next=online.dataset.onlineStatus;
      if(!next)return;
      if(next===currentOnlineStatus()&&!state.statusBusy)return;
      applyOnlineStatusUi(next);
      if(state.statusBusy){
        state.pendingOnlineStatus=next;
        return;
      }
      commitOnlineStatus(next);
      return;
    }
    if(e.target.closest('[data-delete-avatar]')){
      captureLiveForms(true);
      api('delete_media',{media_type:'avatar'}).then(function(x){toast(x.message||'头像已删除');return loadData({soft:true,forcePaint:true})}).catch(function(err){toast(err.message)});
      return;
    }
    var delDoc=e.target.closest('[data-delete-doc]');
    if(delDoc){
      e.preventDefault();
      deletePrivateDoc(delDoc.getAttribute('data-delete-doc')||'');
      return;
    }
    var del=e.target.closest('[data-delete-media]');
    if(del){
      captureLiveForms(true);
      api('delete_media',{media_id:del.dataset.deleteMedia}).then(function(x){toast(x.message||'已删除');return loadData({soft:true,forcePaint:true})}).catch(function(err){toast(err.message)});
      return;
    }
    var move=e.target.closest('[data-gallery-move]');
    if(move){
      var item=move.closest('[data-media-id]');
      if(item)reorderGallery(item.dataset.mediaId,Number(move.dataset.galleryMove||0));
      return;
    }
    if(e.target.closest('[data-open-withdraw]')){
      state.earningsTab='withdraw';
      go('/companion/earnings');
      loadData({soft:true});
      return;
    }
    var readAllBtn=e.target.closest('[data-msg-read-all]');
    if(readAllBtn){
      if(readAllBtn.disabled)return;
      buildInbox().forEach(function(m){markMsgRead(m.id)});
      if(state.inbox&&Array.isArray(state.inbox.systemNotices)){
        var keys=state.inbox.systemNotices.map(function(n){return n.key||n.id}).filter(Boolean);
        api('mark_all_read',{keys:keys}).then(function(){return reloadInbox()}).catch(function(){paint()});
      }else{
        paint();
      }
      return;
    }
    var noticeEl=e.target.closest('[data-notice-id]');
    if(noticeEl){
      var noticeId=noticeEl.dataset.noticeId;
      markMsgRead(noticeId);
      if(state.inbox){
        api('mark_notices_read',{keys:[noticeId]}).then(function(){return reloadInbox()}).catch(function(){paint()});
      }else{
        paint();
      }
      return;
    }
  });
  document.addEventListener('input',function(e){
    var profileField=e.target.closest('.pw-profile-form input,.pw-profile-form textarea,.pw-profile-form select');
    if(profileField){
      var form=profileField.closest('[data-profile-form]');
      if(form)state.profileDraft=readProfileDraft(form);
      return;
    }
    var accountField=e.target.closest('[data-private-contact-form] input,[data-private-contact-form] textarea,[data-verification-form] input,[data-verification-form] textarea,[data-deposit-form] input,[data-deposit-form] textarea');
    if(accountField)state.accountDraft=readAccountDraft();
  });
  function isPwTouchUpload(){
    if(window.MCJUpload&&typeof window.MCJUpload.isTouchLike==='function')return !!window.MCJUpload.isTouchLike();
    try{
      return (window.matchMedia&&window.matchMedia('(pointer: coarse)').matches)||
        (navigator&&navigator.maxTouchPoints>0)||
        /Android|iPhone|iPad|iPod/i.test(String(navigator.userAgent||''));
    }catch(e){return false}
  }
  function openPwUploadSourceSheet(onChosen){
    if(window.MCJUpload&&typeof window.MCJUpload.openSourceSheet==='function'){
      window.MCJUpload.openSourceSheet(null,onChosen);
      return;
    }
    var choice=window.confirm('从相册选择？\n确定=相册 / 取消=拍照');
    onChosen({capture:!choice});
  }
  function triggerPwHiddenPick(accept,useCapture,onFile){
    var input=document.createElement('input');
    input.type='file';
    input.accept=accept||'image/jpeg,image/jpg,image/png,image/webp,image/*';
    if(useCapture)input.setAttribute('capture','environment');
    input.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;';
    document.body.appendChild(input);
    input.addEventListener('change',function(){
      var file=input.files&&input.files[0];
      try{input.remove()}catch(err){}
      if(file&&typeof onFile==='function')onFile(file);
    });
    input.click();
  }
  // Mobile: intercept + uploads → 相册/拍照 sheet (never jump straight to camera).
  document.addEventListener('click',function(e){
    if(!isPwTouchUpload())return;
    var host=e.target.closest('[data-pw-upload-trigger]');
    if(!host||host.classList.contains('is-busy'))return;
    var input=host.querySelector('[data-upload-avatar],[data-upload-gallery],[data-upload-doc],[data-upload-voice]');
    if(!input||input.disabled)return;
    if(input.hasAttribute('data-upload-voice'))return; // audio: native picker
    e.preventDefault();
    e.stopPropagation();
    openPwUploadSourceSheet(function(opts){
      if(!opts)return;
      var accept=input.getAttribute('accept')||'image/jpeg,image/jpg,image/png,image/webp,image/*';
      triggerPwHiddenPick(accept,!!opts.capture,function(file){
        if(input.hasAttribute('data-upload-avatar'))uploadImage('avatar',file);
        else if(input.hasAttribute('data-upload-gallery'))uploadImage('gallery',file);
        else if(input.hasAttribute('data-upload-doc'))uploadPrivateDoc(input.getAttribute('data-upload-doc')||'',file);
      });
    });
  },true);
  document.addEventListener('change',function(e){
    var profileField=e.target.closest('[data-profile-form] input,[data-profile-form] textarea,[data-profile-form] select');
    if(profileField){
      var pForm=profileField.closest('[data-profile-form]');
      if(pForm)state.profileDraft=readProfileDraft(pForm);
    }
    var accountChanged=e.target.closest('[data-private-contact-form] input,[data-private-contact-form] textarea,[data-verification-form] input,[data-verification-form] textarea,[data-deposit-form] input,[data-deposit-form] textarea');
    if(accountChanged)state.accountDraft=readAccountDraft();
    var setting=e.target.closest('[data-setting]');
    if(setting){
      var cur=state.settings||readSettings();
      cur[setting.dataset.setting]=!!setting.checked;
      saveSettings(cur);
      toast('设置已保存');
      return;
    }
    var hallGameSel=e.target.closest('[data-hall-game]');
    if(hallGameSel){state.hallGame=hallGameSel.value||'all';paint();return}
    var gameToggle=e.target.closest('[data-game-toggle]');
    if(gameToggle){
      var g=gameToggle.value;
      var row=document.querySelector('[data-game-price-row="'+g+'"]');
      var input=row&&row.querySelector('input');
      if(row)row.classList.toggle('is-on',gameToggle.checked);
      if(input){input.disabled=!gameToggle.checked;if(!gameToggle.checked)input.value='';}
      return;
    }
    var avatarInput=e.target.closest('[data-upload-avatar]');
    if(avatarInput&&avatarInput.files&&avatarInput.files[0]){uploadImage('avatar',avatarInput.files[0]);avatarInput.value='';return}
    var galleryInput=e.target.closest('[data-upload-gallery]');
    if(galleryInput&&galleryInput.files&&galleryInput.files[0]){uploadImage('gallery',galleryInput.files[0]);galleryInput.value='';return}
    var voiceInput=e.target.closest('[data-upload-voice]');
    if(voiceInput&&voiceInput.files&&voiceInput.files[0]){uploadImage('voice',voiceInput.files[0]);voiceInput.value='';return}
    var docInput=e.target.closest('[data-upload-doc]');
    if(docInput&&docInput.files&&docInput.files[0]){
      uploadPrivateDoc(docInput.getAttribute('data-upload-doc')||'',docInput.files[0]);
      docInput.value='';
      return;
    }
  });
  document.addEventListener('focusin',function(e){
    var field=e.target.closest('.pw-profile-form input,.pw-profile-form textarea,.pw-profile-form select,[data-private-contact-form] input,[data-private-contact-form] textarea,[data-verification-form] input,[data-verification-form] textarea,[data-deposit-form] input,[data-deposit-form] textarea');
    if(!field)return;
    // Only nudge into view when the field is off-screen — never force-scroll after poll/paint restore.
    if(state._skipFocusScrollOnce){state._skipFocusScrollOnce=false;return}
    setTimeout(function(){
      try{
        var r=field.getBoundingClientRect();
        var vh=window.innerHeight||document.documentElement.clientHeight||0;
        var off=r.top<8||r.bottom>vh-8;
        if(off)field.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});
      }catch(err){}
    },280);
  });
  document.addEventListener('keydown',function(e){
    var input=e.target.closest('[data-chat-input]');
    if(!input)return;
    if(e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      var form=input.closest('form');
      if(form){
        if(typeof form.requestSubmit==='function')form.requestSubmit();
        else form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
      }
    }
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
        saveSession({
          token:sess.accessToken||sess.token||'',
          refreshToken:sess.refreshToken||sess.refresh_token||'',
          expiresAt:sess.expiresAt||sess.expires_at||'',
          user:sess.user||{},
          remember:remember
        },remember);
        state.loginBusy=false;state.loginError='';go('/companion/review-status');return loadData();
      }).catch(function(err){
        state.loginBusy=false;
        state.loginError=(Gate&&Gate.humanizeAuthError?Gate.humanizeAuthError(err):null)||err.message||'账号或密码错误。';
        if(Auth&&Auth.setLoading)Auth.setLoading(btn,false,'登录');else if(btn){btn.disabled=false;btn.textContent='登录';}
        if(Auth&&Auth.setFormError)Auth.setFormError(form,state.loginError);else{var errBox=form.querySelector('[data-auth-error]');if(errBox)errBox.textContent=state.loginError;else toast(state.loginError);}
      });
      return;
    }
    if(e.target.matches('[data-forgot-email]')){
      e.preventDefault();
      if(state.forgotBusy)return;
      var fde=new FormData(e.target);
      var faccount=String(fde.get('account')||'').trim();
      if(!faccount){state.forgotMsg='请输入账号';paint();return}
      state.forgotBusy=true;state.forgotMsg='';paint();
      api('send_reset_code',{account:faccount}).then(function(x){
        state.forgotBusy=false;state.forgotAccount=faccount;state.forgotStep='code';state.forgotMsg=x.message||'验证码已发送';paint();
      }).catch(function(err){state.forgotBusy=false;state.forgotMsg=err.message||'发送失败';paint();});
      return;
    }
    if(e.target.matches('[data-forgot-code]')){
      e.preventDefault();
      if(state.forgotBusy)return;
      var fdc=new FormData(e.target);
      var fcode=String(fdc.get('code')||'').trim();
      if(!/^\d{6}$/.test(fcode)){state.forgotMsg='请输入 6 位验证码';paint();return}
      state.forgotBusy=true;state.forgotMsg='';paint();
      api('verify_reset_code',{account:state.forgotAccount,code:fcode}).then(function(x){
        state.forgotBusy=false;state.forgotResetToken=x.resetToken||'';state.forgotStep='reset';state.forgotMsg=x.message||'验证成功';paint();
      }).catch(function(err){state.forgotBusy=false;state.forgotMsg=err.message||'验证失败';paint();});
      return;
    }
    if(e.target.matches('[data-forgot-reset]')){
      e.preventDefault();
      if(state.forgotBusy)return;
      var fdr=new FormData(e.target);
      var fnp=String(fdr.get('new_password')||'');
      var fcp=String(fdr.get('confirm_password')||'');
      if(fnp.length<8){state.forgotMsg='新密码至少 8 位';paint();return}
      if(fnp!==fcp){state.forgotMsg='两次输入的新密码不一致';paint();return}
      if(!state.forgotResetToken){state.forgotMsg='请先完成验证码校验';paint();return}
      state.forgotBusy=true;state.forgotMsg='';paint();
      api('reset_password',{account:state.forgotAccount,newPassword:fnp,confirmPassword:fcp,resetToken:state.forgotResetToken}).then(function(x){
        state.forgotBusy=false;state.forgotStep='';state.forgotAccount='';state.forgotResetToken='';state.authTab='login';
        toast(x.message||'密码已重置，请登录');
        paint();
      }).catch(function(err){state.forgotBusy=false;state.forgotMsg=err.message||'重置失败';paint();});
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
      captureLiveForms(true);
      var checked=validateProfileForm(formEl);
      if(!checked.ok){
        highlightProfileMissing(formEl);
        var miss=(checked.missing&&checked.missing.length)?checked.missing:Object.keys(state.profileErrors||{}).map(function(k){return state.profileErrors[k]});
        toast(miss.join('\n')||'请完善必填资料');
        return;
      }
      var saveBtn=formEl.querySelector('[type="submit"]');
      var saveLabel=saveBtn?String(saveBtn.textContent||'保存公开资料'):'保存公开资料';
      if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='保存中…';}
      api('update_profile',checked.payload).then(function(res){
        state.profileErrors={};
        state.profileMissing=[];
        // Keep draft values so re-paint does not blank lower fields; scroll stays put.
        captureLiveForms(true);
        if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveLabel;}
        toast(res.message||'保存成功');
        return loadData({soft:true,forcePaint:true,preserveScroll:true});
      }).catch(function(err){
        if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveLabel;}
        if(err.message){
          var map={昵称:'nickname',年龄:'age',性别:'gender',地区:'region',联系方式:'contact_phone',主接游戏:'main_game','游戏 ID':'game_id','游戏ID':'game_id',单价:'price',价格:'price',头像:'avatar',相册:'gallery',录音:'voice'};
          Object.keys(map).forEach(function(k){if(err.message.indexOf(k)!==-1)state.profileErrors[map[k]]=err.message});
        }
        highlightProfileMissing(formEl);
        toast(err.message||'保存失败');
        captureLiveForms(true);
        paint({preserveScroll:true});
      });
      return;
    }
    if(e.target.matches('[data-verification-form]')){
      e.preventDefault();
      var vForm=e.target;
      captureLiveForms(true);
      var vf=new FormData(vForm),vp={};
      vf.forEach(function(v,k){vp[k]=String(v||'')});
      var ver=(state.data&&state.data.verification)||{};
      if(!ver.hasIdFront&&!ver.idFrontUrl){toast('请先上传身份证正面');return}
      if(!ver.hasIdBack&&!ver.idBackUrl){toast('请先上传身份证反面');return}
      // Photos already uploaded via upload_private_doc; keep existing storage paths.
      delete vp.id_front;delete vp.id_back;delete vp.proof_url;
      var vBtn=vForm.querySelector('[type="submit"]');
      var vLabel=vBtn?String(vBtn.textContent||'提交认证审核'):'提交认证审核';
      if(vBtn){vBtn.disabled=true;vBtn.textContent='提交中…';}
      api('submit_verification',vp).then(function(res){
        state.accountDraft=null;
        if(vBtn){vBtn.disabled=false;vBtn.textContent=vLabel;}
        toast(res.message||'已提交审核，等待后台审核。');
        return loadData({soft:true,forcePaint:true,preserveScroll:true});
      }).catch(function(err){
        if(vBtn){vBtn.disabled=false;vBtn.textContent=vLabel;}
        toast(err.message);
        paint({preserveScroll:true});
      });
      return;
    }
    if(e.target.matches('[data-deposit-form]')){
      e.preventDefault();
      var dForm=e.target;
      captureLiveForms(true);
      var df=new FormData(dForm),dp={};
      df.forEach(function(v,k){dp[k]=String(v||'')});
      var dep=(state.data&&state.data.deposit)||{};
      if(!dep.hasProof&&!dep.proofUrl){toast('请先上传押金付款凭证');return}
      delete dp.proof_url;
      var dBtn=dForm.querySelector('[type="submit"]');
      var dLabel=dBtn?String(dBtn.textContent||'提交押金凭证'):'提交押金凭证';
      if(dBtn){dBtn.disabled=true;dBtn.textContent='提交中…';}
      api('submit_deposit_proof',dp).then(function(res){
        state.accountDraft=null;
        if(dBtn){dBtn.disabled=false;dBtn.textContent=dLabel;}
        toast(res.message||'已提交审核，等待后台审核。');
        return loadData({soft:true,forcePaint:true,preserveScroll:true});
      }).catch(function(err){
        if(dBtn){dBtn.disabled=false;dBtn.textContent=dLabel;}
        toast(err.message);
        paint({preserveScroll:true});
      });
      return;
    }
    if(e.target.matches('[data-private-contact-form]')){
      e.preventDefault();
      captureLiveForms(true);
      var cf=new FormData(e.target);
      var phone=String(cf.get('contact_phone')||'').trim();
      if(!phone){toast('请填写联系方式');return}
      api('update_profile',{contact_phone:phone,privacy_only:true}).then(function(res){
        toast(res.message||'保存成功');
        return loadData({soft:true,forcePaint:true,preserveScroll:true});
      }).catch(function(err){toast(err.message)});
      return;
    }
    if(e.target.matches('[data-withdraw-form]')){
      e.preventDefault();
      if(state.withdrawBusy)return;
      var wf=new FormData(e.target);
      var amountRaw=String(wf.get('amount')||'').trim();
      var remark=String(wf.get('remark')||'').trim();
      var rules=(state.data&&state.data.withdrawalRules)||{};
      var perm=(state.data&&state.data.permissions)||{};
      var earnings=(state.data&&state.data.earnings)||{};
      var available=num(earnings.available!=null?earnings.available:earnings.withdrawable);
      var minAmount=num(rules.minAmount||0);
      var accountId=(rules.approvedAccounts&&rules.approvedAccounts[0]&&rules.approvedAccounts[0].id)||'';
      var accountLabel=rules.currentAccount||'';
      if(!perm.canWithdraw){toast(perm.withdrawLockReason||'暂不可提现');return}
      if(!amountRaw){toast('请输入提现金额');return}
      if(!/^\d+(\.\d+)?$/.test(amountRaw)){toast('提现金额必须是正数');return}
      var amount=Number(amountRaw);
      if(!(amount>0)){toast('提现金额必须大于 0');return}
      if(minAmount>0&&amount<minAmount){toast('提现金额不能低于最低提现额 '+minAmount+' 猫粮');return}
      if(amount>available){toast('提现金额不能超过可提现余额 '+available+' 猫粮');return}
      if(!accountId&&!accountLabel){toast('请先在账号中心绑定并审核通过提现账户');return}
      if(num(rules.remainingThisWeek!=null?rules.remainingThisWeek:rules.remainingThisMonth)<=0){toast('本周提现次数已用完');return}
      state.withdrawBusy=true;
      paint();
      api('request_withdrawal',{amount:amount,remark:remark,paymentAccountId:accountId}).then(function(res){
        state.withdrawBusy=false;
        var item=res&&(res.item||res.withdrawal||(res.data&&res.data.item));
        var preview=res&&res.preview;
        if(item&&state.data){
          var mapped={
            id:item.id,
            withdrawalNo:item.withdrawal_no||item.withdrawalNo||'',
            amount:item.amount||item.cat_food_amount||amount,
            catFoodAmount:item.cat_food_amount||item.amount||amount,
            status:item.status||'pending_friday',
            statusText:'待周五结算',
            settlementDate:(preview&&preview.settlementDate)||item.settlement_date||item.settlementDate||'',
            submittedAt:item.submitted_at||item.submittedAt||new Date().toISOString(),
            remark:item.remark||remark||'',
            accountLast4:item.account_last4||item.accountLast4||''
          };
          state.data.withdrawals=mergeWithdrawals([mapped],state.data.withdrawals||[]);
        }
        toast((res&&res.message)||'提现申请已提交，进入待周五结算');
        paint();
        return loadData({soft:true});
      }).catch(function(err){
        state.withdrawBusy=false;
        toast(err.message||'提现失败');
        paint();
      });
      return;
    }
    if(e.target.matches('[data-isolation-cs-send]')){
      e.preventDefault();
      if(state.chatBusy)return;
      var isoFd=new FormData(e.target);
      var isoContent=String(isoFd.get('content')||'').trim();
      if(!isoContent){toast('请输入消息内容');return}
      var isoCid=companionCsConversationId();
      if(!isoCid){
        toast('请先点击「联系客服」');
        return;
      }
      state.chatBusy=true;
      paint({preserveScroll:true});
      api('send_cs_message',{content:isoContent,consult_type:'profile_audit',conversation_id:isoCid}).then(function(){
        e.target.reset();
        return reloadInbox();
      }).then(function(){
        state.chatBusy=false;
        paint({preserveScroll:true});
      }).catch(function(err){
        state.chatBusy=false;
        toast(err.message||'发送失败');
        paint({preserveScroll:true});
      });
      return;
    }
    if(e.target.matches('[data-chat-composer]')){
      e.preventDefault();
      if(state.chatBusy)return;
      var ta=e.target.querySelector('[data-chat-input]');
      var content=String((ta&&ta.value)||'').trim();
      if(!content){toast('请输入消息内容');return}
      if(!state.inbox||state.inbox._placeholder){toast('客服连接中，请点重新连接');return}
      var activeConv=activeCsConversation(state.inbox);
      if(activeConv&&activeConv.ended){toast('会话已结束，请发起新咨询');return}
      var cid=companionCsConversationId();
      var consultEl=e.target.querySelector('[data-cs-consult-type]')||root.querySelector('[data-cs-consult-type]');
      var consultType=String((consultEl&&consultEl.value)||csConvConsultType()||'other').trim()||'other';
      var prevType=String((activeConv&&activeConv.consultType)||csConvConsultType()||'').trim();
      var forceNew=!!(prevType&&prevType!==consultType);
      state.csConsultType=consultType;
      var localId='local-txt-'+Date.now();
      var optimistic={
        id:localId,_localId:localId,_pending:true,
        side:'right',senderRole:'companion',senderLabel:'我',
        messageType:'text',content:content,createdAt:new Date().toISOString()
      };
      state.chatBusy=true;
      if(ta)ta.value='';
      state.inbox.messages=(state.inbox.messages||[]).concat([optimistic]);
      paint({preserveScroll:true});
      api('send_cs_message',{content:content,consult_type:consultType,conversation_id:cid,forceNew:forceNew}).then(function(){
        state.chatBusy=false;
        return reloadInbox();
      }).catch(function(err){
        state.chatBusy=false;
        if(state.inbox&&state.inbox.messages){
          state.inbox.messages=state.inbox.messages.map(function(m){
            if(m.id!==localId&&m._localId!==localId)return m;
            return Object.assign({},m,{_pending:false,_failed:true});
          });
        }
        toast(err.message||'发送失败');
        paint({preserveScroll:true});
      });
      return;
    }
  });
  root.addEventListener('click',function(e){
    if(e.target.closest('[data-pw-emoji]')){
      e.preventDefault();
      var ta=root.querySelector('[data-chat-input]');
      if(!ta||ta.disabled)return;
      var emojis=['😊','😂','👍','❤️','🙏','🔥','✨','😺','👌','🎉'];
      var panel=root.querySelector('[data-pw-emoji-panel]');
      if(!panel){
        panel=document.createElement('div');
        panel.setAttribute('data-pw-emoji-panel','1');
        panel.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px';
        panel.innerHTML=emojis.map(function(em){return '<button type="button" data-pw-pick-emoji="'+em+'">'+em+'</button>'}).join('');
        var composer=root.querySelector('[data-chat-composer]');
        if(composer)composer.parentNode.insertBefore(panel,composer);
      }else panel.hidden=!panel.hidden;
      return;
    }
    var pick=e.target.closest('[data-pw-pick-emoji]');
    if(pick){
      e.preventDefault();
      var ta2=root.querySelector('[data-chat-input]');
      if(!ta2||ta2.disabled)return;
      ta2.value=String(ta2.value||'')+pick.getAttribute('data-pw-pick-emoji');
      ta2.focus();
      return;
    }
    if(e.target.closest('[data-pw-image]')){
      e.preventDefault();
      if(state.chatBusy)return;
      if(!state.inbox||state.inbox._placeholder){toast('客服连接中，请点重新连接');return}
      var activeConvImg=activeCsConversation(state.inbox);
      if(activeConvImg&&activeConvImg.ended){toast('会话已结束，请发起新咨询');return}
      var Media=window.MCJChatMedia;
      if(!Media){toast('图片组件未加载');return}
      var token=(state.session&&state.session.token)||'';
      var statusEl=root.querySelector('[data-pw-upload-status]');
      Media.pickAndSendImages({
        token:token,
        multiple:true,
        onStatus:function(t){if(statusEl)statusEl.textContent=t||'';},
        onError:function(err){toast((err&&err.message)||'发送失败');},
        onUploaded:function(url){
          state.chatBusy=true;
          if(statusEl)statusEl.textContent='上传中…';
          if(state.inbox){
            state.inbox.messages=(state.inbox.messages||[]).concat([{
              id:'local-img-'+Date.now(),_localId:'local-img',_pending:true,
              side:'right',senderRole:'companion',senderLabel:'我',
              messageType:'image',message_type:'image',content:url,createdAt:new Date().toISOString()
            }]);
            paint({preserveScroll:true});
          }
          var consultEl=root.querySelector('[data-cs-consult-type]');
          var consultType=String((consultEl&&consultEl.value)||csConvConsultType()||'other').trim()||'other';
          var prevType=String((activeConvImg&&activeConvImg.consultType)||csConvConsultType()||'').trim();
          var forceNew=!!(prevType&&prevType!==consultType);
          var cidImg=companionCsConversationId();
          return api('send_cs_message',{content:url,message_type:'image',consult_type:consultType,conversation_id:cidImg,forceNew:forceNew}).then(function(){
            state.chatBusy=false;
            return reloadInbox();
          }).catch(function(err){
            state.chatBusy=false;
            toast(err.message||'图片发送失败');
            paint({preserveScroll:true});
          });
        }
      }).then(function(){if(statusEl)setTimeout(function(){statusEl.textContent='';},1200);});
      return;
    }
  });
  if(window.MCJChatMedia)window.MCJChatMedia.bindLightboxClicks(root);
  window.MCJCompanionApi=api;
  window.__MCJCompanionAfterForcedAck=function(){loadData({soft:true}).then(function(){paint()});};
  init();
})();

