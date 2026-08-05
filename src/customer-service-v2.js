(function(){
  var root=document.getElementById('serviceApp');
  if(!root)return;
  // Login page has its own script; never run SPA paint/remount here.
  if(/\/customer-service\/login/i.test(location.pathname)||window.__MCJCsLoginOnly){
    return;
  }
  var SESSION_KEY='mcjServiceSession';
  var ROUTES={'/customer-service/':'dashboard','/customer-service':'dashboard','/customer-service/login':'login','/customer-service/dashboard':'dashboard','/customer-service/conversations':'conversations','/customer-service/chats':'conversations','/customer-service/orders':'orders','/customer-service/create-order':'createOrder','/customer-service/compensation':'compensation','/customer-service/reports':'reports','/customer-service/profile':'profile'};
  var NAV=[['dashboard','工作台','/customer-service/dashboard'],['conversations','统一会话池','/customer-service/conversations'],['orders','订单处理','/customer-service/orders'],['compensation','申请补偿','/customer-service/compensation'],['reports','工资中心','/customer-service/reports'],['createOrder','客服代下单','/customer-service/create-order'],['profile','我的资料','/customer-service/profile'],['logout','退出登录','logout']];
  var HIDDEN_MVP_ROUTES={};
  var Auth=window.MCJAuthShell;
  var softRefreshSeq=0;
  var toastTimer=null;
  var COMPOSER_SEL='[data-cs-composer], form[data-send-message] textarea[name="content"], form[data-send-message] input[name="content"]';
  var state={route:'dashboard',session:null,data:null,services:[],servicesError:'',servicesSource:'',createOrderErrors:{bosses:'',companions:'',services:''},loading:false,error:'',notice:'',activeConversation:'',orderFilter:'',convFilter:'waiting',suppressAutoSelect:false,loginError:'',loginBusy:false,loginDraft:{account:'',password:'',remember:false},composerDraft:'',composerDrafts:{},composerFocused:false,sendingChat:false,showConversationList:false,acceptLock:null,readCursors:{},acceptingId:'',clockBusy:false,assignBusy:false,realtimeReady:false,hoursTimer:null,lastPollAt:'',listScrollTop:0,poolRealtimeBound:false,virtStart:0,attPage:0};
  var CONV_ROW_H=92;
  var CONV_OVERSCAN=6;
  var ATT_PAGE_SIZE=10;
  function myServiceId(){
    return String(
      (state.session&&state.session.user&&(state.session.user.id||state.session.user.user_id||state.session.user.uid))||
      (state.data&&state.data.staff&&(state.data.staff.id||state.data.staff.user_id||state.data.staff.uid))||
      ''
    ).trim();
  }
  function healSessionStaff(data){
    var staff=(data&&data.staff)||{};
    var sid=String(staff.id||staff.user_id||'').trim();
    if(!sid||!state.session)return;
    if(!state.session.user)state.session.user={};
    if(!state.session.user.id){
      state.session.user=Object.assign({},state.session.user,{id:sid,name:staff.name||state.session.user.name||''});
      try{
        var raw=JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null')||state.session;
        raw.user=Object.assign({},raw.user||{},state.session.user);
        localStorage.setItem(SESSION_KEY,JSON.stringify(raw));
        sessionStorage.setItem(SESSION_KEY,JSON.stringify(raw));
      }catch(e){}
    }
  }
  function isClosedConv(c){
    if(!c)return false;
    var raw=String(c.rawStatus||'').toLowerCase();
    return raw==='closed'||raw==='ended'||c.status==='已结束';
  }
  function isLockedByOther(c){
    if(!c||isClosedConv(c))return false;
    if(String(c.rawStatus||'').toLowerCase()==='pending_transfer'||c.status==='待转接')return false;
    if(c.lockedByOther)return true;
    var myId=myServiceId();
    return !!(c.currentServiceId&&myId&&c.currentServiceId!==myId&&c.currentServiceId!=='local-self');
  }
  function isMineConv(c){
    if(!c||isClosedConv(c))return false;
    if(String(c.rawStatus||'').toLowerCase()==='pending_transfer'||c.status==='待转接')return false;
    var myId=myServiceId();
    if(!myId)return false;
    return !!(c.currentServiceId&&(c.currentServiceId===myId||c.currentServiceId==='local-self'));
  }
  function lockPanelHtml(conv){
    if(!conv)return '';
    var name=esc(conv.assignedCsName||conv.currentServiceName||'其他客服');
    var at=esc(conv.assignedAt||conv.acceptedAt||'');
    return '<div class="cs-lock-banner" data-cs-lock-panel style="margin:8px 12px;padding:10px 12px;border-radius:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);color:#fde68a">'+
      '<strong>只读模式</strong>'+
      '<p style="margin:6px 0 0">该订单正在由【'+name+'】处理中，当前仅可查看。</p>'+
      (at?'<p style="margin:4px 0 0;opacity:.85;font-size:12px">接待开始：'+at+'</p>':'')+
      '</div>';
  }
  function convBucket(c){
    if(isClosedConv(c))return 'ended';
    if(String(c.rawStatus||'').toLowerCase()==='pending_transfer'||c.status==='待转接')return 'waiting';
    if(c&&c.currentServiceId)return 'active';
    return 'waiting';
  }
  function filteredConversations(){
    var f=state.convFilter||'waiting';
    var all=((state.data&&state.data.conversations)||[]);
    if(f==='active'){
      return all.filter(function(c){
        if(isClosedConv(c))return false;
        if(!c.currentServiceId)return false;
        var myId=myServiceId();
        // If session id not healed yet, still show assigned rows (avoid total invisibility).
        if(!myId)return true;
        return isMineConv(c)||isLockedByOther(c);
      });
    }
    if(f==='waiting'){
      return all.filter(function(c){
        if(isClosedConv(c))return false;
        if(!c.currentServiceId)return true;
        // Companion support with peer unread must stay visible somewhere — if somehow
        // still assigned but user is on 待接待, surface mine with unread briefly.
        var isCompanion=c.conversationType==='companion_support'||(!c.bossId&&c.companionId);
        if(isCompanion&&isMineConv(c)&&Number(c.unread||c.unreadCount||0)>0)return true;
        return false;
      });
    }
    return all.filter(function(c){return convBucket(c)===f});
  }
  function filterCounts(){
    var counts={waiting:0,active:0,ended:0};
    ((state.data&&state.data.conversations)||[]).forEach(function(c){
      if(isClosedConv(c)){counts.ended++;return;}
      if(!c.currentServiceId){counts.waiting++;return;}
      var myId=myServiceId();
      if(!myId||isMineConv(c)||isLockedByOther(c))counts.active++;
    });
    return counts;
  }
  function convActivityTime(c){
    // Prefer last message time so mark_read/claim bumps don't pin empty chats above active ones.
    var last=String((c&&c.lastTime)||'');
    var upd=String((c&&c.updatedAt)||'');
    if(last&&upd)return last>=upd?last:upd;
    return last||upd||'';
  }
  function mergeConversationLists(localList, remoteList, incremental){
    var byId={};
    (localList||[]).forEach(function(c){if(c&&c.id)byId[c.id]=c;});
    (remoteList||[]).forEach(function(c){
      if(!c||!c.id)return;
      // Full/top poll must not inflate the pool with noise-unfiltered rows.
      // New sessions arrive via Realtime INSERT (incremental) or bootstrap reload.
      // Always accept companion_support / active peer traffic so companion→CS is never dropped.
      if(!byId[c.id]&&!incremental){
        var isCompanion=c.conversationType==='companion_support'||(!c.bossId&&c.companionId);
        var hasPeerActivity=!!(c.lastMessage||Number(c.unread||c.unreadCount||0)>0);
        if(!(isCompanion||hasPeerActivity))return;
      }
      var prev=byId[c.id]||{};
      var next=Object.assign({},prev,c);
      if(!c.lastMessage&&prev.lastMessage)next.lastMessage=prev.lastMessage;
      if(!c.lastTime&&prev.lastTime)next.lastTime=prev.lastTime;
      // Never let a stale poll wipe a just-claimed / just-ended local state.
      // Only keep optimistic local-self claims; honor remote release / pending_transfer.
      if(prev.currentServiceId&&!c.currentServiceId){
        var remoteTransfer=String(c.rawStatus||'').toLowerCase()==='pending_transfer'||c.status==='待转接'||c.status==='待接待';
        if(prev.currentServiceId==='local-self'&&!remoteTransfer){
          next.currentServiceId=prev.currentServiceId;
          next.currentServiceName=prev.currentServiceName||next.currentServiceName;
          next.status=prev.status||next.status;
          next.rawStatus=prev.rawStatus||next.rawStatus;
        }
      }
      if(prev.currentServiceId==='local-self'&&c.currentServiceId){
        next.currentServiceId=c.currentServiceId;
      }
      if(prev.currentServiceId==='local-self'&&!c.currentServiceId){
        next.currentServiceId='local-self';
        next.status=prev.status||'正在接待';
        next.rawStatus=prev.rawStatus||'active';
      }
      if(isClosedConv(prev)&&!isClosedConv(next)){
        next.status=prev.status;
        next.rawStatus=prev.rawStatus;
        next.closedAt=prev.closedAt||next.closedAt;
      }
      if(state.readCursors&&state.readCursors[c.id]){
        var at=state.readCursors[c.id];
        if(!next.lastReadAt||String(next.lastReadAt)<String(at))next.lastReadAt=at;
        if(next.lastTime&&String(next.lastTime)<=String(at)){
          next.unread=0;
          next.unreadCount=0;
        }else if((c.unread==null||c.unread==='')&&prev.unread!=null&&Number(prev.unread)===0){
          next.unread=0;
          next.unreadCount=0;
        }
      }else if((c.unread==null||c.unread==='')&&prev.unread!=null){
        next.unread=prev.unread;
        next.unreadCount=prev.unreadCount!=null?prev.unreadCount:prev.unread;
      }
      byId[c.id]=next;
    });
    var merged=Object.keys(byId).map(function(k){return byId[k];});
    merged.sort(function(a,b){
      return convActivityTime(b).localeCompare(convActivityTime(a));
    });
    return merged;
  }
  function totalUnreadCount(){
    return ((state.data&&state.data.conversations)||[]).reduce(function(sum,c){
      if(isClosedConv(c))return sum;
      return sum+(Number(c.unread||c.unreadCount||0)||0);
    },0);
  }
  function recomputeSummaryFromConversations(){
    if(!state.data)return;
    if(!state.data.summary)state.data.summary={};
    var counts=filterCounts();
    var myId=myServiceId();
    var mine=((state.data.conversations)||[]).filter(function(c){
      return !isClosedConv(c)&&c.currentServiceId&&myId&&c.currentServiceId===myId;
    }).length;
    state.data.summary.waitingConversations=counts.waiting;
    state.data.summary.currentReceptions=mine;
    state.data.summary.unreadMessages=totalUnreadCount();
  }
  function syncPoolCounters(){
    recomputeSummaryFromConversations();
    var counts=filterCounts();
    var unread=Number((state.data&&state.data.summary&&state.data.summary.unreadMessages)||0)||0;
    root.querySelectorAll('[data-conv-filter]').forEach(function(btn){
      var f=btn.getAttribute('data-conv-filter');
      var em=btn.querySelector('em');
      if(em&&counts[f]!=null)em.textContent=String(counts[f]);
    });
    root.querySelectorAll('[data-nav-unread]').forEach(function(el){
      if(unread>0){
        el.hidden=false;
        el.textContent=unread>99?'99+':String(unread);
      }else{
        el.hidden=true;
        el.textContent='';
      }
    });
    var mUnread=root.querySelector('[data-metric-unread]');
    if(mUnread)mUnread.textContent=String(unread);
    var mCurrent=root.querySelector('[data-metric-current]');
    if(mCurrent)mCurrent.textContent=String((state.data.summary&&state.data.summary.currentReceptions)||0);
    var mWaiting=root.querySelector('[data-metric-waiting]');
    if(mWaiting)mWaiting.textContent=String((state.data.summary&&state.data.summary.waitingConversations)||0);
  }
  function patchDashboardMetrics(){
    syncPoolCounters();
    var s=(state.data&&state.data.summary)||{};
    var map={
      unread:s.unreadMessages,
      current:s.currentReceptions,
      waiting:s.waitingConversations,
      pendingOrders:s.pendingOrders,
      paymentReview:s.paymentReview,
      needsReassign:s.needsReassign
    };
    Object.keys(map).forEach(function(key){
      var el=root.querySelector('[data-metric-'+key+']');
      if(el&&map[key]!=null)el.textContent=String(map[key]);
    });
    var work=(state.data&&state.data.workData)||{};
    var att=work.todayAttendance||{};
    var hoursEl=root.querySelector('[data-live-hours]');
    if(hoursEl)hoursEl.textContent=String(liveTotalHours(att));
  }
  function applyClockResult(res){
    if(!state.data)state.data={};
    if(!state.data.workData)state.data.workData={};
    if(res&&res.attendance){
      state.data.workData.todayAttendance=res.attendance;
      upsertLocalAttendanceRow(res.attendance);
    }
    startHoursTimer();
  }
  function shanghaiNowText(){
    try{
      return new Intl.DateTimeFormat('zh-CN',{
        timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',hour12:false
      }).format(new Date()).replace(/\//g,'-');
    }catch(e){
      var d=new Date();
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    }
  }
  function shanghaiTodayKey(){
    try{
      return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    }catch(e){
      return new Date().toISOString().slice(0,10);
    }
  }
  function monthAttendanceRows(){
    var rows=((state.data&&state.data.workData&&state.data.workData.attendance&&state.data.workData.attendance.rows)||[]).slice();
    var ym=shanghaiTodayKey().slice(0,7);
    return rows.filter(function(r){
      var d=String(r.reportDate||r.date||'');
      return !d||d.indexOf(ym)===0;
    }).sort(function(a,b){
      return String(b.reportDate||b.date||'').localeCompare(String(a.reportDate||a.date||''));
    });
  }
  function fmtAttDateTime(text,iso){
    var raw=String(text||'').trim();
    if(raw&&/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(raw))return raw.slice(0,16);
    if(iso){
      try{
        var p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(iso));
        var get=function(t){var f=p.find(function(x){return x.type===t});return f?f.value:'';};
        return get('year')+'-'+get('month')+'-'+get('day')+' '+get('hour')+':'+get('minute');
      }catch(e){}
    }
    return raw||'';
  }
  function attRowView(r){
    var date=String(r.reportDate||r.date||'-');
    var inText=fmtAttDateTime(r.clockInText,r.clockInAt)||'-';
    var outRaw=fmtAttDateTime(r.clockOutText,r.clockOutAt);
    var onDuty=!!(r.clockInAt||r.clockInText)&&!(r.clockOutAt||r.clockOutText);
    var outText=onDuty?'上班中':(outRaw||'-');
    var hours=onDuty?'—':(r.workHours!=null&&r.workHours!==''?String(r.workHours)+' 小时':'-');
    var status=r.attendanceStatus||(onDuty?'上班中':(r.clockOutAt?'已下班':'未打卡'));
    return {date:date,inText:inText,outText:outText,hours:hours,status:status,onDuty:onDuty};
  }
  function attendanceHistoryHtml(){
    var all=monthAttendanceRows();
    var page=Math.max(0,Number(state.attPage)||0);
    var totalPages=Math.max(1,Math.ceil(all.length/ATT_PAGE_SIZE)||1);
    if(page>totalPages-1){page=totalPages-1;state.attPage=page;}
    var slice=all.slice(page*ATT_PAGE_SIZE,(page+1)*ATT_PAGE_SIZE);
    var tableRows=slice.length?slice.map(function(r){
      var v=attRowView(r);
      return '<tr data-att-row="'+esc(v.date)+'">'+
        '<td class="cs-att-date">'+esc(v.date)+'</td>'+
        '<td class="cs-att-in">'+esc(v.inText)+'</td>'+
        '<td class="cs-att-out">'+(v.onDuty?'<span class="cs-att-onduty">上班中</span>':esc(v.outText))+'</td>'+
        '<td class="cs-att-hours">'+esc(v.hours)+'</td>'+
        '<td class="cs-att-status">'+esc(v.status)+'</td>'+
        '</tr>';
    }).join(''):'<tr><td colspan="5" class="cs-att-empty">本月暂无打卡记录</td></tr>';
    var cards=slice.length?slice.map(function(r){
      var v=attRowView(r);
      return '<article class="cs-att-card" data-att-row="'+esc(v.date)+'">'+
        '<div class="cs-att-card-head"><strong>'+esc(v.date)+'</strong><span>'+esc(v.status)+'</span></div>'+
        '<div class="cs-att-card-row"><span>上班时间</span><strong>'+esc(v.inText)+'</strong></div>'+
        '<div class="cs-att-card-row"><span>下班时间</span><strong>'+(v.onDuty?'上班中':esc(v.outText))+'</strong></div>'+
        '<div class="cs-att-card-row"><span>当日工时</span><strong>'+esc(v.hours)+'</strong></div>'+
        '</article>';
    }).join(''):'<div class="cs-empty">本月暂无打卡记录</div>';
    var pager=all.length>ATT_PAGE_SIZE
      ?('<div class="cs-att-pager">'+
        '<button class="cs-btn" type="button" data-att-page="prev"'+(page<=0?' disabled':'')+'>上一页</button>'+
        '<span>第 '+(page+1)+' / '+totalPages+' 页 · 共 '+all.length+' 条</span>'+
        '<button class="cs-btn" type="button" data-att-page="next"'+(page>=totalPages-1?' disabled':'')+'>下一页</button>'+
        '</div>')
      :(all.length?'<div class="cs-att-pager"><span>共 '+all.length+' 条（本月）</span></div>':'');
    return '<section class="cs-att-section" style="margin-top:14px">'+
      '<div class="cs-att-head"><h3>本月打卡记录</h3><span>默认仅显示本月，每页 '+ATT_PAGE_SIZE+' 条</span></div>'+
      '<div class="cs-att-wrap">'+
      '<table class="cs-table cs-att-table"><thead><tr><th>日期</th><th>上班时间</th><th>下班时间</th><th>当日工时</th><th>状态</th></tr></thead>'+
      '<tbody data-att-history-body>'+tableRows+'</tbody></table>'+
      '</div>'+
      '<div class="cs-att-cards" data-att-cards>'+cards+'</div>'+
      pager+
      '</section>';
  }
  function upsertLocalAttendanceRow(att){
    if(!att)return;
    if(!state.data)state.data={};
    if(!state.data.workData)state.data.workData={};
    if(!state.data.workData.attendance)state.data.workData.attendance={rows:[]};
    var rows=state.data.workData.attendance.rows||[];
    var date=String(att.reportDate||att.date||shanghaiTodayKey());
    var next=Object.assign({},att,{reportDate:date,date:date});
    var idx=rows.findIndex(function(r){return String(r.reportDate||r.date)===date});
    if(idx>=0)rows[idx]=Object.assign({},rows[idx],next);
    else rows.unshift(next);
    state.data.workData.attendance.rows=rows;
    // Rebuild history block if present (keeps pagination + mobile cards in sync).
    var section=root.querySelector('.cs-att-section');
    if(section){
      var wrap=document.createElement('div');
      wrap.innerHTML=attendanceHistoryHtml();
      var fresh=wrap.firstChild;
      if(fresh)section.replaceWith(fresh);
    }
  }
  function clockCanIn(att){
    att=att||{};
    if(att.canClockIn!=null)return !!att.canClockIn;
    // Fallback: after clock-out (or never clocked) allow another in for overtime shifts
    return !att.clockInAt || !!att.clockOutAt;
  }
  function clockCanOut(att){
    att=att||{};
    if(att.canClockOut!=null)return !!att.canClockOut;
    return !!(att.clockInAt&&!att.clockOutAt);
  }
  function liveTotalHours(att){
    att=att||{};
    var sessions=att.sessions||[];
    if(sessions.length){
      var finished=0;
      var openIn='';
      sessions.forEach(function(s){
        if(s.clockOutAt){
          finished+=Number(s.workHours)||((Number(s.durationMinutes)||0)/60);
        }else if(s.clockInAt){
          openIn=s.clockInAt;
        }
      });
      if(openIn){
        var live=(Date.now()-Date.parse(openIn))/3600000;
        return Math.round((finished+Math.max(0,live))*100)/100;
      }
      return Math.round(finished*100)/100;
    }
    if(att.clockInAt&&!att.clockOutAt){
      var base=Number(att.finishedWorkHours);
      if(!Number.isFinite(base))base=0;
      var diff=(Date.now()-Date.parse(att.clockInAt))/3600000;
      return Math.round((base+Math.max(0,diff))*100)/100;
    }
    return att.workHours!=null&&att.workHours!==''?att.workHours:0;
  }
  function patchClockPanel(att,busy){
    att=att||((state.data&&state.data.workData&&state.data.workData.todayAttendance)||{});
    var canIn=clockCanIn(att);
    var canOut=clockCanOut(att);
    var liveHours=liveTotalHours(att);
    var statusEl=root.querySelector('[data-clock-status]');
    var inEl=root.querySelector('[data-clock-in-at]');
    var outEl=root.querySelector('[data-clock-out-at]');
    var hoursEl=root.querySelector('[data-live-hours]');
    var overtimeEl=root.querySelector('[data-overtime-hours]');
    var btnIn=root.querySelector('[data-clock-in]');
    var btnOut=root.querySelector('[data-clock-out]');
    if(statusEl)statusEl.textContent=att.attendanceStatus||'未打卡';
    if(inEl)inEl.textContent=fmtAttDateTime(att.clockInText,att.clockInAt)||'-';
    if(outEl)outEl.textContent=canOut?'上班中':(fmtAttDateTime(att.clockOutText,att.clockOutAt)||'-');
    if(hoursEl)hoursEl.textContent=(liveHours!=null&&liveHours!==''?(liveHours+' 小时'):'-');
    if(overtimeEl)overtimeEl.textContent=(att.overtimeHours!=null?att.overtimeHours:0)+' 小时';
    if(btnIn){
      btnIn.disabled=!!(busy||!canIn);
      btnIn.textContent=busy?'处理中…':(canIn?(Number(att.closedCount||0)>0?'再次上班（加班）':'上班打卡'):'上班中');
    }
    if(btnOut){
      btnOut.disabled=!!(busy||!canOut);
      btnOut.textContent=busy?'处理中…':(canOut?'下班打卡':'已下班');
    }
  }
  function optimisticClockIn(prev){
    prev=prev||{};
    var started=new Date().toISOString();
    var priorClosed=Number(prev.closedCount||0)||(prev.clockOutAt?1:0);
    var finished=Number(prev.workHours)||0;
    if(prev.clockInAt&&!prev.clockOutAt)finished=Number(prev.finishedWorkHours)||0;
    return Object.assign({},prev,{
      reportDate:shanghaiTodayKey(),
      clockInAt:started,
      clockOutAt:'',
      clockInText:shanghaiNowText(),
      clockOutText:'上班中',
      attendanceStatus:priorClosed>0?'加班中':'上班中',
      dutyStatus:'on_duty',
      finishedWorkHours:finished,
      workHours:finished,
      canClockIn:false,
      canClockOut:true,
      clockedIn:true,
      clockedOut:false,
      closedCount:priorClosed,
      sessionType:priorClosed>0?'overtime':'normal',
      isLate:false,
      isAbsent:false
    });
  }
  function optimisticClockOut(prev){
    prev=prev||{};
    var ended=new Date().toISOString();
    var hours=liveTotalHours(Object.assign({},prev,{clockOutAt:''}));
    if(prev.clockInAt){
      var diff=(Date.parse(ended)-Date.parse(prev.clockInAt))/3600000;
      var finished=Number(prev.finishedWorkHours)||0;
      hours=Math.round((finished+Math.max(0,diff))*100)/100;
    }
    return Object.assign({},prev,{
      clockOutAt:ended,
      clockOutText:shanghaiNowText(),
      attendanceStatus:'班次已结束，可再次上班',
      dutyStatus:'off_duty',
      workHours:hours,
      finishedWorkHours:hours,
      canClockIn:true,
      canClockOut:false,
      clockedIn:false,
      clockedOut:true,
      closedCount:(Number(prev.closedCount)||0)+1
    });
  }
  function apiClock(action){
    var cfg=(state.data&&state.data.workData&&state.data.workData.config)||null;
    var payload=cfg?{config:{shiftStart:cfg.shiftStart,shiftEnd:cfg.shiftEnd,graceMinutes:cfg.graceMinutes}}:{};
    var req=api(action,payload);
    var timeout=new Promise(function(_,reject){
      setTimeout(function(){
        reject(Object.assign(new Error('网络较慢，正在核对打卡结果…'),{timeout:true,status:408}));
      },12000);
    });
    return Promise.race([req,timeout]);
  }
  function verifyClockAfterTimeout(action,prev){
    return api('bootstrap',{},'GET').then(function(res){
      var att=res&&res.data&&res.data.workData&&res.data.workData.todayAttendance;
      if(!att)return null;
      // Multi-shift: success = now on duty after clock_in, or can clock in again after clock_out
      if(action==='clock_in'&&clockCanOut(att))return att;
      if(action==='clock_out'&&clockCanIn(att)&&!clockCanOut(att))return att;
      return null;
    }).catch(function(){return null;});
  }
  function runClock(action){
    if(state.clockBusy)return;
    var prev=(state.data&&state.data.workData&&state.data.workData.todayAttendance)||{};
    if(action==='clock_in'&&!clockCanIn(prev)){toast('当前已在上班中');patchClockPanel(prev,false);return;}
    if(action==='clock_out'&&!clockCanOut(prev)){
      toast(clockCanIn(prev)?'请先上班打卡':'请先上班打卡');
      patchClockPanel(prev,false);
      return;
    }
    state.clockBusy=true;
    var optimistic=action==='clock_in'?optimisticClockIn(prev):optimisticClockOut(prev);
    if(!state.data)state.data={};
    if(!state.data.workData)state.data.workData={};
    state.data.workData.todayAttendance=optimistic;
    upsertLocalAttendanceRow(optimistic);
    patchClockPanel(optimistic,true);
    var t0=performance&&performance.now?performance.now():Date.now();
    apiClock(action).then(function(res){
      var ms=Math.round((performance&&performance.now?performance.now():Date.now())-t0);
      if(!res||(!res.attendance&&!res.persisted))throw new Error((res&&res.message)||'打卡未写入数据库');
      applyClockResult(res);
      state.clockBusy=false;
      patchClockPanel(res.attendance||optimistic,false);
      startHoursTimer();
      toast((res.message||'打卡成功')+(res.elapsedMs!=null?(' · '+res.elapsedMs+'ms'):(' · '+ms+'ms')));
      try{console.info('[mcj-clock]',action,'clientMs='+ms,'serverElapsedMs='+(res.elapsedMs||res.totalMs||'-'));}catch(e){}
    }).catch(function(err){
      var finishFail=function(){
        state.clockBusy=false;
        state.data.workData.todayAttendance=prev;
        patchClockPanel(prev,false);
        toast(err.message||'打卡失败');
      };
      if(err&&err.timeout){
        toast('网络较慢，正在核对打卡结果…');
        verifyClockAfterTimeout(action,prev).then(function(att){
          if(att){
            if(!state.data.workData)state.data.workData={};
            state.data.workData.todayAttendance=att;
            upsertLocalAttendanceRow(att);
            state.clockBusy=false;
            patchClockPanel(att,false);
            startHoursTimer();
            toast(action==='clock_in'?'上班打卡已确认':'下班打卡已确认');
            return;
          }
          finishFail();
        });
        return;
      }
      finishFail();
    });
  }
  function startHoursTimer(){
    if(state.hoursTimer){clearInterval(state.hoursTimer);state.hoursTimer=null;}
    var att=(state.data&&state.data.workData&&state.data.workData.todayAttendance)||{};
    if(!clockCanOut(att))return;
    state.hoursTimer=setInterval(function(){
      if(state.route!=='dashboard')return;
      var el=root.querySelector('[data-live-hours]');
      var a=(state.data&&state.data.workData&&state.data.workData.todayAttendance)||{};
      if(!el||!clockCanOut(a))return;
      el.textContent=liveTotalHours(a)+' 小时';
    },30000);
  }
  function virtualListHtml(list,active,data,scrollTop,viewportH){
    var total=list.length;
    if(total<=40){
      return (total?list.map(function(c){return conversationCardHtml(c,active,data)}).join(''):'<div class="cs-empty">该分类暂无会话</div>');
    }
    var start=Math.max(0,Math.floor((scrollTop||0)/CONV_ROW_H)-CONV_OVERSCAN);
    var visible=Math.ceil((viewportH||600)/CONV_ROW_H)+CONV_OVERSCAN*2;
    var end=Math.min(total,start+visible);
    state.virtStart=start;
    var topPad=start*CONV_ROW_H;
    var bottomPad=Math.max(0,(total-end)*CONV_ROW_H);
    var slice=list.slice(start,end);
    return '<div class="cs-virt-spacer" style="height:'+topPad+'px"></div>'+
      slice.map(function(c){return conversationCardHtml(c,active,data)}).join('')+
      '<div class="cs-virt-spacer" style="height:'+bottomPad+'px"></div>';
  }
  function bindListScroll(listEl){
    var scroller=listEl&&(listEl.querySelector('[data-cs-virt-body]')||listEl);
    if(!scroller||scroller.dataset.virtBound==='1')return;
    scroller.dataset.virtBound='1';
    scroller.addEventListener('scroll',function(){
      state.listScrollTop=scroller.scrollTop||0;
      if(state.route!=='conversations')return;
      var full=filteredConversations();
      if(full.length<=40)return;
      // Re-window without resetting scroll.
      var body=listEl.querySelector('[data-cs-virt-body]');
      if(!body)return;
      var active=((state.data&&state.data.conversations)||[]).find(function(c){return c.id===state.activeConversation})||null;
      body.innerHTML=virtualListHtml(full,active,state.data||{},state.listScrollTop,scroller.clientHeight);
    },{passive:true});
  }
  function bindPoolRealtime(force){
    var RT=window.MCJChatRealtime;
    if(!RT||typeof RT.subscribeConversations!=='function')return;
    var token=(state.session&&state.session.token)||'';
    if(!token)return;
    if(state.poolRealtimeBound&&!force)return;
    // Allow rebind after visibility / channel drop.
    state.poolRealtimeBound=true;
    RT.subscribeConversations(token,{
      onChange:function(row){
        if(!row||!row.id||!state.data)return;
        var list=state.data.conversations||[];
        var idx=list.findIndex(function(c){return c.id===row.id});
        var patch={
          id:row.id,
          currentServiceId:row.customer_service_id||'',
          rawStatus:row.status||'',
          status:(row.status==='closed'||row.status==='ended')?'已结束':(row.status==='pending_transfer'?'待转接':(row.customer_service_id?'接待中':'待接待')),
          updatedAt:row.updated_at||new Date().toISOString(),
          closedAt:row.closed_at||'',
          orderId:row.order_id||'',
          consultType:row.consult_type||undefined
        };
        if(row.last_read_at)patch.lastReadAt=row.last_read_at;
        if(idx>=0){
          var prev=list[idx];
          // Another CS claimed / ended — trust realtime row; keep local unread zero if we already read.
          if(state.readCursors&&state.readCursors[row.id]&&!isClosedConv(patch)){
            if(prev.lastTime&&String(prev.lastTime)<=String(state.readCursors[row.id])){
              patch.unread=0;
              patch.unreadCount=0;
            }
          }
          list[idx]=Object.assign({},prev,patch);
        }else{
          list.unshift(Object.assign({bossName:'老板',lastMessage:'',unread:0,unreadCount:0},patch));
        }
        state.data.conversations=list;
        syncPoolCounters();
        if(state.route==='conversations'&&root.querySelector('.cs-chat-layout'))patchConversationMessages();
        else if(state.route==='dashboard')syncPoolCounters();
      },
      onMessage:function(row){
        if(!row||!row.conversation_id||!state.data)return;
        var cid=row.conversation_id;
        var list=state.data.conversations||[];
        var idx=list.findIndex(function(c){return c.id===cid});
        var fromPeer=row.sender_role==='boss'||row.sender_role==='companion';
        if(idx>=0){
          var unread=Number(list[idx].unread||0)||0;
          if(state.activeConversation!==cid&&fromPeer)unread+=1;
          else if(state.activeConversation===cid)unread=0;
          list[idx]=Object.assign({},list[idx],{
            lastMessage:row.content||list[idx].lastMessage,
            lastTime:row.created_at||list[idx].lastTime,
            updatedAt:row.created_at||list[idx].updatedAt,
            unread:unread,
            unreadCount:unread
          });
          // Move bumped conversation toward top.
          var item=list.splice(idx,1)[0];
          list.unshift(item);
          state.data.conversations=list;
          if(fromPeer&&state.route==='conversations'){
            state.convFilter=convBucket(item);
          }
        }else if(fromPeer||row.sender_role==='customer_service'||row.sender_role==='system'){
          // Companion/boss message for a conversation not yet in local pool — upsert stub.
          var isCompanion=row.sender_role==='companion';
          var stub={
            id:cid,
            bossName:isCompanion?'陪玩':'老板',
            companionId:isCompanion?(row.sender_id||''):'',
            conversationType:isCompanion?'companion_support':'general_support',
            lastMessage:row.content||'',
            lastTime:row.created_at||new Date().toISOString(),
            updatedAt:row.created_at||new Date().toISOString(),
            unread:state.activeConversation===cid?0:(fromPeer?1:0),
            unreadCount:state.activeConversation===cid?0:(fromPeer?1:0),
            currentServiceId:'',
            currentServiceName:'待接待',
            status:'待接待',
            rawStatus:'waiting_service',
            lockedByOther:false
          };
          list.unshift(stub);
          state.data.conversations=list;
          if(fromPeer&&state.route==='conversations')state.convFilter='waiting';
          // Hydrate name/assignment from server without wiping composer.
          softRefresh();
        }
        if(state.activeConversation===cid){
          mergeIncomingMessage(mapDbMessage(row));
        }
        syncPoolCounters();
        if(state.route==='conversations'&&root.querySelector('.cs-chat-layout'))patchConversationMessages();
      },
      onReady:function(){state.poolRealtimeBound=true;state.realtimeReady=true;},
      onError:function(){state.poolRealtimeBound=false;}
    }).catch(function(){state.poolRealtimeBound=false;});
  }
  function activeConversation(){
    var list=(state.data&&state.data.conversations)||[];
    if(!state.activeConversation)return null;
    return list.find(function(c){return c.id===state.activeConversation})||null;
  }
  function composerCanReply(conv){
    if(!conv)return false;
    if(isClosedConv(conv))return false;
    if(isLockedByOther(conv))return false;
    if(state.acceptLock&&state.acceptLock.id===conv.id&&state.acceptLock.until>Date.now())return true;
    var mid=myServiceId();
    if(!mid)return false;
    return !!(conv.currentServiceId&&(conv.currentServiceId===mid||conv.currentServiceId==='local-self'));
  }
  function myServiceName(){
    return String(
      (state.session&&state.session.user&&(state.session.user.name||state.session.user.display_name))||
      (state.data&&state.data.staff&&(state.data.staff.name||state.data.staff.display_name))||
      '客服'
    ).trim()||'客服';
  }
  function isAdminSession(){
    var role=String(
      (state.session&&state.session.user&&state.session.user.role)||
      (state.data&&state.data.staff&&state.data.staff.role)||
      ''
    ).toLowerCase();
    return role==='admin'||role==='super_admin'||role==='finance_admin';
  }
  function canMutateActiveOrder(){
    var active=activeConversation();
    if(!active)return true;
    if(isClosedConv(active))return false;
    if(isLockedByOther(active))return false;
    return composerCanReply(active)||!active.currentServiceId;
  }
  function applyAcceptedLocally(cid, remoteConv){
    if(!cid||!state.data)return;
    remoteConv=remoteConv||{};
    var myId=myServiceId()||String(remoteConv.customer_service_id||remoteConv.currentServiceId||'').trim();
    if(!myId&&state.data.staff)myId=String(state.data.staff.id||state.data.staff.user_id||'').trim();
    var nick=myServiceName();
    if(myId&&state.session){
      if(!state.session.user)state.session.user={};
      if(!state.session.user.id)state.session.user.id=myId;
    }
    state.acceptLock={id:cid,until:Date.now()+60000};
    state.convFilter='active';
    state.activeConversation=cid;
    state.suppressAutoSelect=false;
    if(!state.readCursors)state.readCursors={};
    state.readCursors[cid]=new Date().toISOString();
    var list=state.data.conversations||[];
    var idx=list.findIndex(function(c){return c.id===cid});
    var patch={
      currentServiceId:myId||(idx>=0?list[idx].currentServiceId:''),
      currentServiceName:nick,
      status:'正在接待',
      rawStatus:String(remoteConv.status||(idx>=0&&list[idx].rawStatus)||'active'),
      unread:0,
      unreadCount:0,
      lastReadAt:state.readCursors[cid],
      lastMessage:'客服 '+nick+' 已接待您。',
      acceptedAt:remoteConv.accepted_at||remoteConv.acceptedAt||new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    if(!patch.currentServiceId){
      // Still force out of waiting so counters move even if profile id is momentarily missing.
      patch.currentServiceId='local-self';
    }
    if(idx>=0)list[idx]=Object.assign({},list[idx],patch);
    else list.unshift(Object.assign({id:cid,bossName:'老板'},patch));
    state.data.conversations=list;
    clearUnreadLocally(cid);
    var msgs=state.data.messages||[];
    var already=msgs.some(function(m){
      return m.conversationId===cid&&m.messageType==='system'&&String(m.content||'').indexOf('已接待您')>=0;
    });
    if(!already){
      msgs.push({
        id:'local-accept-'+Date.now(),
        conversationId:cid,
        senderId:myId||'',
        senderRole:'customer_service',
        senderName:nick,
        messageType:'system',
        content:'客服 '+nick+' 已接待您。',
        createdAt:new Date().toISOString()
      });
      state.data.messages=msgs;
    }
    if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
    else if(state.route==='conversations')paint();
    syncPoolCounters();
    syncComposerEnabled();
  }
  function acceptConversation(cid){
    var id=String(cid||'').trim();
    if(!id)return Promise.reject(new Error('缺少会话 ID'));
    if(state.acceptingId===id)return Promise.resolve();
    state.acceptingId=id;
    // Optimistic move so counters update immediately even if network is slow.
    applyAcceptedLocally(id,{});
    return api('take_conversation',{id:id,conversation_id:id}).then(function(res){
      applyAcceptedLocally(id,res.conversation||{});
      toast(res.message||'已接待');
      syncComposerEnabled();
      var input=root.querySelector(COMPOSER_SEL);
      if(input){
        input.disabled=false;
        input.readOnly=false;
        input.removeAttribute('readonly');
        input.placeholder='输入消息，Enter 发送，Shift+Enter 换行';
        state.composerFocused=true;
        try{input.focus({preventScroll:true});}catch(err){try{input.focus();}catch(e2){}}
      }
      var hint=root.querySelector('[data-cs-composer-hint]');
      if(hint){hint.hidden=true;hint.textContent='';}
      syncPoolCounters();
    }).catch(function(err){
      // Roll back optimistic claim on failure.
      var list=(state.data&&state.data.conversations)||[];
      var idx=list.findIndex(function(c){return c.id===id});
      if(idx>=0&&list[idx].currentServiceId==='local-self'){
        list[idx]=Object.assign({},list[idx],{currentServiceId:'',currentServiceName:'待接待',status:'待接待',rawStatus:'waiting_service'});
        state.convFilter='waiting';
        syncPoolCounters();
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
      }
      throw err;
    }).finally(function(){
      if(state.acceptingId===id)state.acceptingId='';
    });
  }
  function receptionBannerHtml(conv){
    if(!conv||isClosedConv(conv))return '';
    var mid=myServiceId();
    if(!conv.currentServiceId||!mid||conv.currentServiceId===mid)return '';
    var name=conv.currentServiceName||'其他客服';
    return '<div class="cs-reception-banner" data-cs-reception-banner role="status">该会话已由 '+esc(name)+' 接待</div>';
  }
  function syncReceptionBanner(conv){
    var html=receptionBannerHtml(conv);
    var existing=root.querySelector('[data-cs-reception-banner]');
    if(html){
      if(existing)existing.outerHTML=html;
      else{
        var msgs=root.querySelector('.cs-chat-messages');
        if(msgs)msgs.insertAdjacentHTML('beforebegin',html);
      }
    }else if(existing)existing.remove();
  }
  function syncKeyboardInset(){
    try{
      var vv=window.visualViewport;
      if(!vv){
        document.documentElement.style.setProperty('--cs-keyboard-inset','0px');
        return;
      }
      var inset=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);
      document.documentElement.style.setProperty('--cs-keyboard-inset',inset+'px');
      if(inset>40&&state.composerFocused){
        var box=root.querySelector('.cs-chat-messages');
        if(box)box.scrollTop=box.scrollHeight;
      }
    }catch(e){}
  }
  function bindKeyboardInset(){
    if(window.__MCJCsKeyboardBound)return;
    window.__MCJCsKeyboardBound=true;
    if(window.visualViewport){
      window.visualViewport.addEventListener('resize',syncKeyboardInset);
      window.visualViewport.addEventListener('scroll',syncKeyboardInset);
    }
    window.addEventListener('resize',syncKeyboardInset);
    syncKeyboardInset();
  }
  function autoResizeComposer(el){
    if(!el||el.tagName!=='TEXTAREA')return;
    el.style.height='auto';
    var next=Math.min(120,Math.max(56,el.scrollHeight));
    el.style.height=next+'px';
  }
  function composerBlockReason(conv){
    if(!conv)return '请先选择会话';
    if(isClosedConv(conv))return '会话已结束，无法继续发送';
    if(isLockedByOther(conv))return '该订单正在由【'+(conv.assignedCsName||conv.currentServiceName||'其他客服')+'】处理中，当前仅可查看。';
    var mid=myServiceId();
    if(conv.currentServiceId&&mid&&conv.currentServiceId!==mid&&conv.currentServiceId!=='local-self')return '该订单当前由其他客服负责，你没有操作权限。';
    if(state.acceptLock&&state.acceptLock.id===conv.id&&state.acceptLock.until>Date.now())return '';
    if(!conv.currentServiceId)return '请先点击「开始接待」后再回复';
    return '';
  }
  function clearUnreadLocally(cid){
    if(!cid||!state.data)return;
    var list=state.data.conversations||[];
    var idx=list.findIndex(function(c){return c.id===cid});
    var readAt=new Date().toISOString();
    if(!state.readCursors)state.readCursors={};
    state.readCursors[cid]=readAt;
    if(idx>=0){
      list[idx]=Object.assign({},list[idx],{unread:0,unreadCount:0,lastReadAt:readAt});
    }
    (state.data.messages||[]).forEach(function(m){
      if(m.conversationId===cid&&(m.senderRole==='boss'||m.senderRole==='companion')&&!m.readAt)m.readAt=readAt;
    });
    var badge=root.querySelector('[data-conversation="'+cid+'"] .cs-conv-unread');
    if(badge)badge.remove();
    syncPoolCounters();
  }
  function applyReadCursors(remote){
    if(!remote||!state.readCursors)return remote;
    var cursors=state.readCursors;
    (remote.conversations||[]).forEach(function(c){
      var at=cursors[c.id];
      if(!at)return;
      var roles=c.conversationType==='companion_support'?{companion:1}:{boss:1};
      (remote.messages||[]).forEach(function(m){
        if(m.conversationId===c.id&&roles[m.senderRole]&&String(m.createdAt||'')<=String(at)){
          m.readAt=m.readAt||at;
        }
      });
      var newer=(remote.messages||[]).filter(function(m){
        return m.conversationId===c.id&&roles[m.senderRole]&&!m.readAt&&String(m.createdAt||'')>String(at);
      }).length;
      c.unread=newer;
      c.unreadCount=newer;
      c.lastReadAt=c.lastReadAt||at;
    });
    return remote;
  }
  function markConversationRead(cid){
    var id=String(cid||'').trim();
    if(!id)return Promise.resolve();
    var conv=((state.data&&state.data.conversations)||[]).find(function(c){return c.id===id});
    // View-only CS must not clear the assigned CS unread state.
    if(conv&&isLockedByOther(conv))return Promise.resolve();
    clearUnreadLocally(id);
    // Do not softRefresh after read — stale poll used to restore unread and freeze tab counts.
    syncPoolCounters();
    return api('mark_read',{id:id,conversation_id:id}).then(function(res){
      if(res&&res.skipped)return;
      clearUnreadLocally(id);
      if(res&&(res.last_read_at||(res.conversation&&res.conversation.last_read_at))){
        var at=res.last_read_at||res.conversation.last_read_at;
        if(!state.readCursors)state.readCursors={};
        state.readCursors[id]=at;
        var list=state.data&&state.data.conversations||[];
        var idx=list.findIndex(function(c){return c.id===id});
        if(idx>=0)list[idx]=Object.assign({},list[idx],{lastReadAt:at,unread:0,unreadCount:0});
      }
      syncPoolCounters();
    }).catch(function(err){
      toast((err&&err.message)||'标记已读失败，请刷新重试');
    });
  }
  function mergeIncomingMessage(msg){
    if(!msg||!msg.id||!state.data)return false;
    if(!state.data.messages)state.data.messages=[];
    if(state.data.messages.some(function(m){return m.id===msg.id}))return false;
    // Drop matching optimistic pending/failed of same content (same conversation).
    var cid=String(msg.conversationId||'');
    var content=String(msg.content||'');
    var role=String(msg.senderRole||'').toLowerCase();
    state.data.messages=state.data.messages.filter(function(m){
      if(!(m._pending||m._failed))return true;
      if(String(m.conversationId||'')!==cid)return true;
      if(String(m.content||'')!==content)return true;
      var mr=String(m.senderRole||m.sender_role||'').toLowerCase();
      return !(mr===role||(role==='customer_service'&&(mr==='customer_service'||mr==='service')));
    });
    state.data.messages.push(msg);
    var list=state.data.conversations||[];
    var idx=list.findIndex(function(c){return c.id===msg.conversationId});
    if(idx>=0){
      var bump=msg.senderRole==='boss'||msg.senderRole==='companion';
      var active=state.activeConversation===msg.conversationId;
      var nextUnread=active?0:(Number(list[idx].unread||0)||0)+(bump?1:0);
      list[idx]=Object.assign({},list[idx],{
        lastMessage:msg.content||list[idx].lastMessage,
        lastTime:msg.createdAt||list[idx].lastTime,
        unread:nextUnread,
        unreadCount:nextUnread
      });
      if(active)clearUnreadLocally(msg.conversationId);
      else syncPoolCounters();
    }
    return true;
  }
  function mapDbMessage(row){
    if(!row)return null;
    return {
      id:row.id,
      conversationId:row.conversation_id||row.conversationId||'',
      senderId:row.sender_id||row.senderId||'',
      senderRole:row.sender_role||row.senderRole||'',
      senderName:row.senderName||'',
      content:row.content||'',
      messageType:row.message_type||row.messageType||'text',
      orderId:row.order_id||row.orderId||'',
      createdAt:row.created_at||row.createdAt||'',
      readAt:row.read_at||row.readAt||'',
      sendStatus:row.sendStatus||'sent'
    };
  }
  function loadActiveConversationMessages(cid){
    var id=String(cid||state.activeConversation||'').trim();
    if(!id||!state.session||!state.session.token)return Promise.resolve();
    var conv=((state.data&&state.data.conversations)||[]).find(function(c){return c.id===id});
    if(isLockedByOther(conv)){
      if(state.data&&state.data.messages){
        state.data.messages=(state.data.messages||[]).filter(function(m){return m.conversationId!==id});
      }
      if(state.route==='conversations'){
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
        else paint();
      }
      return Promise.resolve();
    }
    return api('list_messages',{id:id,conversation_id:id}).then(function(res){
      var remote=(res.messages||[]);
      if(!state.data)return;
      var others=(state.data.messages||[]).filter(function(m){return m.conversationId!==id});
      state.data.messages=others.concat(remote);
      if(state.route==='conversations'){
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
        else paint();
      }
    }).catch(function(err){
      if(err&&err.status===403&&state.data){
        var list=state.data.conversations||[];
        var idx=list.findIndex(function(c){return c.id===id});
        if(idx>=0){
          list[idx]=Object.assign({},list[idx],{
            lockedByOther:true,
            currentServiceName:err.currentServiceName||list[idx].currentServiceName||'其他客服',
            currentServiceId:err.currentServiceId||list[idx].currentServiceId||''
          });
          state.data.conversations=list;
        }
        state.data.messages=(state.data.messages||[]).filter(function(m){return m.conversationId!==id});
        if(state.route==='conversations'){
          if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
          else paint();
        }
      }
    });
  }
  function bindRealtime(cid){
    var id=String(cid||'').trim();
    var RT=window.MCJChatRealtime;
    if(!RT||!id)return;
    var token=(state.session&&state.session.token)||'';
    // Do not kill pool subscription — only replace this conversation channel.
    if(typeof RT.unsubscribe==='function')RT.unsubscribe(id);
    RT.subscribeMessages(id,token,function(row){
      var msg=mapDbMessage(row);
      if(!mergeIncomingMessage(msg))return;
      if(state.activeConversation===id){
        clearUnreadLocally(id);
        markConversationRead(id);
      }
      if(state.route==='conversations'&&root.querySelector('.cs-chat-layout'))patchConversationMessages();
      else if(state.route==='conversations')paint();
    }).then(function(){
      state.realtimeReady=true;
    }).catch(function(){
      state.realtimeReady=false;
    });
    bindPoolRealtime();
  }
  function applyEndedLocally(cid){
    if(!cid||!state.data)return;
    var list=state.data.conversations||[];
    var idx=list.findIndex(function(c){return c.id===cid});
    if(idx>=0){
      list[idx]=Object.assign({},list[idx],{
        status:'已结束',
        rawStatus:'closed',
        unread:0,
        unreadCount:0,
        lastMessage:'客服已结束本次接待。',
        closedAt:new Date().toISOString(),
        endedAt:new Date().toISOString(),
        closedBy:myServiceId()
      });
    }
    var msgs=state.data.messages||[];
    var already=msgs.some(function(m){
      return m.conversationId===cid&&m.messageType==='system'&&String(m.content||'').indexOf('已结束本次接待')>=0;
    });
    if(!already){
      msgs.push({
        id:'local-end-'+Date.now(),
        conversationId:cid,
        senderId:myServiceId()||'',
        senderRole:'customer_service',
        senderName:myServiceName(),
        messageType:'system',
        content:'客服已结束本次接待。',
        createdAt:new Date().toISOString()
      });
      state.data.messages=msgs;
    }
    state.convFilter='ended';
    syncPoolCounters();
    if(state.activeConversation&&root.querySelector('.cs-chat-layout'))patchConversationMessages();
  }
  function saveComposerDraftFor(id){
    if(!id)return;
    captureComposer();
    if(!state.composerDrafts)state.composerDrafts={};
    state.composerDrafts[id]=String(state.composerDraft||'');
  }
  function loadComposerDraftFor(id){
    if(!id){state.composerDraft='';return;}
    if(!state.composerDrafts)state.composerDrafts={};
    state.composerDraft=typeof state.composerDrafts[id]==='string'?state.composerDrafts[id]:'';
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function moneyRate(v, unit) {
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(v, unit || "每单");
    return money(v).replace(/\s*猫粮$/, "") + " 猫粮 / " + (unit || "每单");
  }
  function routeFromPath(pathname){
    var p=String(pathname||location.pathname||'').replace(/\\/g,'/').replace(/\/$/,'')||'/customer-service';
    if(/\/customer-service\/login/i.test(p))return 'login';
    if(p==='/customer-service')p='/customer-service/';
    return ROUTES[p]||'dashboard';
  }
  function route(){
    // Prefer SPA in-memory route so soft refresh / typing never snaps back to 工作台.
    if(state.route&&state.route!=='login')return state.route;
    return routeFromPath(location.pathname);
  }
  function go(path){
    if(isLoginView())captureLoginDraft();
    var raw=String(path||'');
    var clean=raw.replace(/\\/g,'/').replace(/\/$/,'')||'/customer-service';
    // Full navigation only for login page.
    if(/\/customer-service\/login$/i.test(clean)){
      location.assign('/customer-service/login/');
      return;
    }
    // SPA route switch — keep URL + in-memory route in sync, never hard-jump away from chats while typing.
    var next=ROUTES[clean]||'dashboard';
    var url=raw;
    if(next==='dashboard')url='/customer-service/dashboard/';
    else if(next==='conversations')url='/customer-service/conversations';
    else if(next==='orders')url='/customer-service/orders';
    else if(next==='profile')url='/customer-service/profile';
    history.pushState(null,'',url);
    state.route=next;
    // Defer remount so the same click cannot "ghost click" 工作台 after buttons regenerate.
    setTimeout(function(){ paint(); }, 0);
  }
  function readSession(){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.hasSession==='function'){
      // Force heal soft/mirror leftovers into mcjServiceSession before reading.
      try{window.MCJServiceAuth.hasSession();}catch(e){}
    }
    try{
      var raw=JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null');
      if(raw&&(raw.token||raw.accessToken||raw.refreshToken)){
        return {
          token:raw.token||raw.accessToken||'',
          refreshToken:raw.refreshToken||'',
          expiresAt:raw.expiresAt||'',
          user:raw.user||{},
          remember:raw.remember!==false
        };
      }
    }catch(e){}
    return null;
  }
  function saveSession(session,remember){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.saveSession==='function'){
      state.session=window.MCJServiceAuth.saveSession(session,remember!==false);
      return;
    }
    // Always keep a localStorage copy so refresh keeps login.
    localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
    state.session=session;
  }
  function clearSession(){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.clearSession==='function'){
      window.MCJServiceAuth.clearSession('logout');
    }else{
      localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(SESSION_KEY);
    }
    state.session=null;state.data=null;state.activeConversation='';
  }
  function token(){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.getAccessToken==='function'){
      return window.MCJServiceAuth.getAccessToken()||'';
    }
    var s=state.session||readSession()||{};
    return s.token||s.accessToken||'';
  }
  function isLoginView(){
    return state.route==='login'||!state.session;
  }
  function captureComposer(){
    var input=root.querySelector(COMPOSER_SEL);
    if(!input)return;
    state.composerDraft=String(input.value||'');
    if(state.activeConversation){
      if(!state.composerDrafts)state.composerDrafts={};
      state.composerDrafts[state.activeConversation]=state.composerDraft;
    }
    state.composerFocused=document.activeElement===input||!!state.composerFocused;
  }
  function restoreComposer(){
    var input=root.querySelector(COMPOSER_SEL);
    if(!input)return;
    if(typeof state.composerDraft==='string')input.value=state.composerDraft;
    autoResizeComposer(input);
    syncComposerEnabled();
    if((state.composerFocused||composerCanReply(activeConversation()))&&!input.disabled){
      try{
        input.focus({preventScroll:true});
        var len=input.value.length;
        input.setSelectionRange(len,len);
      }catch(e){
        try{input.focus();}catch(err){}
      }
    }
  }
  function syncComposerEnabled(){
    var input=root.querySelector(COMPOSER_SEL);
    var sendBtn=root.querySelector('[data-cs-send]');
    var hint=root.querySelector('[data-cs-composer-hint]');
    var conv=activeConversation();
    var can=composerCanReply(conv);
    var reason=composerBlockReason(conv);
    var draft=String((input&&input.value)!=null?(input.value):(state.composerDraft||''));
    var empty=!draft.trim();
    if(input){
      input.disabled=!can;
      input.readOnly=!can;
      if(can)input.removeAttribute('readonly');
      else input.setAttribute('readonly','readonly');
      input.placeholder=can?'输入消息，Enter 发送，Shift+Enter 换行':(reason||'无法回复');
    }
    if(sendBtn){
      sendBtn.disabled=!can||!!state.sendingChat||empty;
      sendBtn.setAttribute('type','button');
    }
    if(hint){
      hint.hidden=can;
      hint.textContent=can?'':reason;
    }
  }
  function captureLoginDraft(){
    var form=root.querySelector('form[data-login]');
    if(!form)return;
    state.loginDraft={
      account:form.elements.account?String(form.elements.account.value||''):'',
      password:form.elements.password?String(form.elements.password.value||''):'',
      remember:!!(form.elements.remember&&form.elements.remember.checked)
    };
  }
  function restoreLoginDraft(){
    var form=root.querySelector('form[data-login]');
    var draft=state.loginDraft||{};
    if(!form)return;
    // Only restore when we actually have a draft. Never wipe live typed values with blanks.
    if(!draft.account&&!draft.password&&!draft.remember)return;
    if(form.elements.account&&draft.account)form.elements.account.value=draft.account;
    if(form.elements.password&&draft.password)form.elements.password.value=draft.password;
    if(form.elements.remember)form.elements.remember.checked=!!draft.remember;
  }
  function updateLoginChrome(){
    var err=root.querySelector('[data-auth-error]');
    if(err)err.textContent=state.loginError||'';
    var btn=root.querySelector('form[data-login] [type="submit"]');
    if(btn){
      btn.disabled=!!state.loginBusy;
      btn.textContent=state.loginBusy?'登录中…':'登录';
    }
  }
  function toast(msg){
    state.notice=msg||'';
    if(isLoginView()){
      var err=document.querySelector('[data-auth-error]');
      if(err){
        err.textContent=msg||'';
        setTimeout(function(){if(err.textContent===msg){err.textContent='';state.notice='';}},2200);
        return;
      }
      // Login form must never be remounted just to show a toast.
      return;
    }
    // Never remount the shell for toasts — that destroyed the chat composer mid-typing.
    showToastOverlay(msg||'');
  }
  function showToastOverlay(msg){
    var el=document.getElementById('csToastOverlay');
    if(!el){
      el=document.createElement('div');
      el.id='csToastOverlay';
      el.className='cs-toast show';
      el.setAttribute('role','status');
      document.body.appendChild(el);
    }
    el.className='cs-toast show';
    el.textContent=msg||'';
    if(toastTimer)clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){
      state.notice='';
      if(el&&el.parentNode)el.parentNode.removeChild(el);
      toastTimer=null;
    },2200);
  }
  function api(action,body,method){
    function doFetch(){
      var opts={method:method||'POST',headers:{'Content-Type':'application/json',Accept:'application/json'}};
      if(token())opts.headers['x-mcj-service-token']=token();
      if(opts.method==='GET')return fetch('/api/customer-service?action='+encodeURIComponent(action||'bootstrap'),opts).then(parse);
      opts.body=JSON.stringify(Object.assign({action:action},body||{}));
      return fetch('/api/customer-service',opts).then(parse);
    }
    var ready=window.MCJServiceAuth&&window.MCJServiceAuth.ensureSession
      ?window.MCJServiceAuth.ensureSession().catch(function(){return null;})
      :Promise.resolve();
    return ready.then(doFetch).catch(function(err){
      var msg=String((err&&err.message)||'');
      var expired=/登录已过期|请先登录|jwt|token is expired|invalid jwt/i.test(msg)||err&&err.status===401;
      if(expired&&window.MCJServiceAuth&&window.MCJServiceAuth.refreshSession){
        return window.MCJServiceAuth.refreshSession().then(function(){
          state.session=readSession();
          return doFetch();
        }).catch(function(){
          clearSession();
          location.replace('/customer-service/login/');
          throw err;
        });
      }
      throw err;
    });
  }
  function parse(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(e){throw new Error('接口返回格式错误')}if(!res.ok||body.ok===false){var err=new Error(body.message||('请求失败：HTTP '+res.status));err.status=res.status;err.locked=body.locked;err.currentServiceName=body.currentServiceName;err.currentServiceId=body.currentServiceId;throw err;}return body})}
  function emptyDashboardData(){
    var staff=(state.session&&state.session.user)||{};
    return {staff:staff,summary:{},conversations:[],messages:[],orders:[],bosses:[],companions:[],payrolls:[],orderStatuses:{}};
  }
  function loadServices(){
    return fetch('/api/platform/services?scope=cs',{headers:{Accept:'application/json'}}).then(function(res){
      return res.text().then(function(text){
        var body={};
        try{body=text?JSON.parse(text):{}}catch(e){body={services:[],ok:false,message:'服务列表返回格式错误'}}
        state.services=Array.isArray(body.services)?body.services:[];
        state.servicesSource=body.source||'';
        if(!res.ok||body.ok===false){
          state.servicesError=body.message||('服务列表请求失败：HTTP '+res.status);
        }else if(body.source==='missing_table'){
          state.servicesError=body.message||'services 表未初始化。请在 Supabase SQL Editor 执行 supabase/services.sql。';
        }else if(!state.services.length){
          state.servicesError=body.message||'暂无服务配置';
        }else{
          state.servicesError='';
        }
        if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
        state.createOrderErrors.services=state.servicesError||'';
      });
    }).catch(function(err){
      state.services=[];
      state.servicesSource='';
      state.servicesError=(err&&err.message)||'服务列表请求失败';
      if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
      state.createOrderErrors.services=state.servicesError;
    });
  }
  // Prefer SPA in-memory route so soft refresh / typing never snaps back to 工作台.
  // Also fix bootstrap summary unread/current from live conversation list.
  function load(){
    if(!state.session||!state.session.token){state.loading=false;paint();return Promise.resolve()}
    state.loading=true;state.error='';
    state.createOrderErrors={bosses:'',companions:'',services:state.servicesError||''};
    if(!state.data)state.data=emptyDashboardData();
    paint();
    var bootFailed=false;
    var bootMsg='';
    var boot=api('bootstrap',{},'GET').then(function(res){return res}).catch(function(err){
      bootFailed=true;
      bootMsg=err&&err.message?err.message:'客服端数据读取失败';
      state.error=bootMsg;
      return {data:state.data||emptyDashboardData(),ok:false};
    });
    return Promise.all([boot,loadServices()]).then(function(results){
      var res=results[0]||{};
      var next=res.data||emptyDashboardData();
      if(!next.staff||!next.staff.name){
        next.staff=Object.assign({},(state.session&&state.session.user)||{},next.staff||{});
      }
      if(!next.summary)next.summary={};
      if(next.conversations&&next.conversations.length){
        next.conversations=next.conversations.slice().sort(function(a,b){
          return convActivityTime(b).localeCompare(convActivityTime(a));
        });
      }
      if(next.orders&&next.orders.length){
        next.orders=next.orders.slice().sort(function(a,b){
          return String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||''));
        });
      }
      state.data=next;
      healSessionStaff(next);
      applyReadCursors(state.data);
      recomputeSummaryFromConversations();
      if(state.suppressAutoSelect){
        state.activeConversation='';
      }else if(state.activeConversation){
        var still=(state.data.conversations||[]).some(function(c){return c.id===state.activeConversation});
        if(!still)state.activeConversation='';
      }
      if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
      if(bootFailed){
        state.createOrderErrors.bosses='老板列表加载失败：'+bootMsg;
        state.createOrderErrors.companions='陪玩列表加载失败：'+bootMsg;
      }else{
        state.createOrderErrors.bosses='';
        state.createOrderErrors.companions='';
      }
      state.createOrderErrors.services=state.servicesError||'';
    }).catch(function(err){
      state.error=err&&err.message?err.message:'客服端数据读取失败';
      if(!state.data)state.data=emptyDashboardData();
      if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
      state.createOrderErrors.bosses='老板列表加载失败：'+state.error;
      state.createOrderErrors.companions='陪玩列表加载失败：'+state.error;
      state.createOrderErrors.services=state.servicesError||state.error;
    }).finally(function(){state.loading=false;try{paint()}catch(e){paintSafeFallback()}})
  }
  function softRefresh(){
    if(!state.session||!state.session.token)return Promise.resolve();
    var keepRoute=state.route;
    var keepConv=state.activeConversation;
    if(keepRoute==='conversations')captureComposer();
    var seq=++softRefreshSeq;
    // Conversations page: lightweight poll (not full bootstrap) for <5s freshness.
    var poller=(keepRoute==='conversations')
      ? api('poll_updates',{conversation_id:keepConv||'',since:state.lastPollAt||''})
      : (keepRoute==='dashboard'||keepRoute==='orders'
        ? api('poll_updates',{conversation_id:'',since:state.lastPollAt||''}).catch(function(){return api('bootstrap',{},'GET')})
        : api('bootstrap',{},'GET'));
    return poller.then(function(res){
      if(seq!==softRefreshSeq)return;
      var nowRoute=state.route||keepRoute;
      var remote;
      var isPollPayload=res&&res.data&&(res.data.conversations||res.data.messages||res.data.incremental!=null||res.data.polledAt);
      var isFullBootstrap=res&&res.data&&res.data.workData;
      if((keepRoute==='conversations'||keepRoute==='dashboard'||keepRoute==='orders')&&isPollPayload&&!isFullBootstrap){
        state.lastPollAt=res.data.polledAt||new Date().toISOString();
        var mergedConvs=mergeConversationLists(
          (state.data&&state.data.conversations)||[],
          res.data.conversations||[],
          !!res.data.incremental
        );
        // Preserve workData/staff/summary — poll_updates never returns them (was wiping punches every 8s).
        remote=Object.assign({},state.data||emptyDashboardData(),{
          conversations:mergedConvs
        });
        // Only merge matching orders from poll; never shrink the full orders list.
        if(res.data.orders&&res.data.orders.length){
          var orderById={};
          (remote.orders||[]).forEach(function(o){if(o&&o.id)orderById[o.id]=o;});
          res.data.orders.forEach(function(o){
            if(!o||!o.id)return;
            orderById[o.id]=Object.assign({},orderById[o.id]||{},o);
          });
          remote.orders=Object.keys(orderById).map(function(k){return orderById[k];}).sort(function(a,b){
            return String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||''));
          });
        }
        var byId={};
        var pendingLocals=[];
        ((state.data&&state.data.messages)||[]).forEach(function(m){
          if(!m)return;
          if(m._pending||m._failed){pendingLocals.push(m);return;}
          if(m.id)byId[m.id]=m;
        });
        (res.data.messages||[]).forEach(function(m){if(m&&m.id)byId[m.id]=Object.assign({},byId[m.id]||{},m);});
        remote.messages=Object.keys(byId).map(function(k){return byId[k];});
        pendingLocals.forEach(function(local){
          var matched=remote.messages.some(function(m){
            return String(m.conversationId||'')===String(local.conversationId||'')&&
              String(m.content||'')===String(local.content||'')&&
              String(m.senderRole||m.sender_role||'').toLowerCase()===String(local.senderRole||local.sender_role||'').toLowerCase();
          });
          if(!matched)remote.messages.push(local);
        });
        remote.messages.sort(function(a,b){
          return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
        });
      }else{
        remote=res.data||state.data||emptyDashboardData();
        if(remote&&!remote.workData&&state.data&&state.data.workData){
          remote=Object.assign({},remote,{
            workData:state.data.workData,
            staff:remote.staff||state.data.staff,
            summary:Object.assign({},state.data.summary||{},remote.summary||{})
          });
        }
        if(remote&&remote.orders&&remote.orders.length){
          remote.orders=remote.orders.slice().sort(function(a,b){
            return String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||''));
          });
        }
      }
      healSessionStaff(remote);
      // Protect just-accepted conversation from a stale poll overwriting the claim.
      if(state.acceptLock&&state.acceptLock.until>Date.now()&&state.data&&state.data.conversations){
        var lockId=state.acceptLock.id;
        var localConv=(state.data.conversations||[]).find(function(c){return c.id===lockId});
        var remoteList=remote.conversations||[];
        var rIdx=remoteList.findIndex(function(c){return c.id===lockId});
        if(localConv&&localConv.currentServiceId&&rIdx>=0){
          if(!remoteList[rIdx].currentServiceId){
            remoteList[rIdx]=Object.assign({},remoteList[rIdx],{
              currentServiceId:localConv.currentServiceId,
              currentServiceName:localConv.currentServiceName,
              status:localConv.status||'正在接待',
              rawStatus:localConv.rawStatus||'active',
              unread:0,
              unreadCount:0
            });
          }else{
            // Keep zeroed unread while lock is warm if remote briefly lags on mark_read.
            remoteList[rIdx]=Object.assign({},remoteList[rIdx],{
              unread:Math.min(Number(remoteList[rIdx].unread||0)||0,Number(localConv.unread||0)||0),
              unreadCount:Math.min(Number(remoteList[rIdx].unreadCount||0)||0,Number(localConv.unreadCount||0)||0)
            });
          }
        }
        if(localConv&&localConv.currentServiceId&&rIdx<0){
          remoteList.unshift(localConv);
          remote.conversations=remoteList;
        }
      }
      applyReadCursors(remote);
      // Keep active conversation history sticky across page polls / route switches.
      if(keepConv&&state.data&&state.data.messages){
        var keepMsgs=(state.data.messages||[]).filter(function(m){return m.conversationId===keepConv});
        var remoteOthers=(remote.messages||[]).filter(function(m){return m.conversationId!==keepConv});
        var byId2={};
        var pending2=[];
        keepMsgs.concat(remoteOthers).concat(remote.messages||[]).forEach(function(m){
          if(!m)return;
          if(m._pending||m._failed){pending2.push(m);return;}
          if(m.id)byId2[m.id]=Object.assign({},byId2[m.id]||{},m);
        });
        remote.messages=Object.keys(byId2).map(function(k){return byId2[k];});
        pending2.forEach(function(local){
          var matched=remote.messages.some(function(m){
            return String(m.conversationId||'')===String(local.conversationId||'')&&
              String(m.content||'')===String(local.content||'');
          });
          if(!matched&&!remote.messages.some(function(m){return m.id===local.id;}))remote.messages.push(local);
        });
        remote.messages.sort(function(a,b){
          return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
        });
      }
      state.data=remote;
      // Keep focus sticky: never jump to conversations[0] on poll/refresh.
      if(state.suppressAutoSelect){
        state.activeConversation='';
      }else if(keepConv){
        var stillThere=(state.data.conversations||[]).some(function(c){return c.id===keepConv});
        state.activeConversation=stillThere?keepConv:'';
      }else{
        state.activeConversation='';
      }
      if(nowRoute)state.route=nowRoute;
      else if(keepRoute)state.route=keepRoute;
      recomputeSummaryFromConversations();
      // Conversations: always patch in place — never remount composer on poll / realtime / send refresh.
      if(state.route==='conversations'){
        if(patchConversationMessages()){
          syncPoolCounters();
          return;
        }
      }
      // Dashboard: poll must NOT remount the shell (was causing login/workbench flicker).
      if(state.route==='dashboard'&&isPollPayload&&!isFullBootstrap){
        syncPoolCounters();
        patchDashboardMetrics();
        return;
      }
      // Orders: remount only when payment/status fingerprint changes (keeps proof modal usable).
      if(state.route==='orders'&&isPollPayload&&!isFullBootstrap){
        var sig=(remote.orders||[]).map(function(o){
          return [o.id,o.status,o.paymentReview?1:0,o.paymentProofUrl||'',o.statusText||''].join(':');
        }).join('|');
        if(sig===state._ordersPollSig){
          syncPoolCounters();
          return;
        }
        state._ordersPollSig=sig;
      }
      paint();
      syncPoolCounters();
    }).catch(function(){});
  }
  /** Manual「刷新」: force full bootstrap + active messages, show Loading (never a silent no-op). */
  function hardRefresh(){
    if(!state.session||!state.session.token)return Promise.resolve();
    var keepRoute=state.route;
    var keepConv=state.activeConversation;
    if(keepRoute==='conversations')captureComposer();
    state.refreshing=true;
    softRefreshSeq+=1;
    var seq=++softRefreshSeq;
    setRefreshButtonsBusy(true);
    toast('刷新中…');
    return api('bootstrap',{},'GET').then(function(res){
      if(seq!==softRefreshSeq)return;
      var remote=res.data||state.data||emptyDashboardData();
      healSessionStaff(remote);
      applyReadCursors(remote);
      state.data=remote;
      state.lastPollAt=new Date().toISOString();
      if(state.suppressAutoSelect){
        state.activeConversation='';
      }else if(keepConv){
        var stillThere=(state.data.conversations||[]).some(function(c){return c.id===keepConv});
        state.activeConversation=stillThere?keepConv:'';
      }
      if(keepRoute)state.route=keepRoute;
      recomputeSummaryFromConversations();
      paint();
      syncPoolCounters();
      var activeId=state.activeConversation||'';
      if(activeId&&state.route==='conversations'){
        return loadActiveConversationMessages(activeId).then(function(){
          bindRealtime(activeId);
          if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
        });
      }
      bindPoolRealtime(true);
    }).catch(function(err){
      toast((err&&err.message)||'刷新失败，请重试');
    }).finally(function(){
      state.refreshing=false;
      setRefreshButtonsBusy(false);
    });
  }
  function setRefreshButtonsBusy(busy){
    root.querySelectorAll('[data-refresh]').forEach(function(btn){
      if(!btn)return;
      if(busy){
        btn.dataset.idleText=btn.dataset.idleText||btn.textContent||'刷新';
        btn.disabled=true;
        btn.textContent='刷新中…';
      }else{
        btn.disabled=false;
        btn.textContent=btn.dataset.idleText||'刷新';
      }
    });
  }
  function patchConversationMessages(){
    var layout=root.querySelector('.cs-chat-layout');
    var box=root.querySelector('.cs-chat-messages');
    var listEl=root.querySelector('.cs-chat-list');
    if(!layout||!box)return false;
    var data=state.data||{};
    var list=filteredConversations();
    var all=data.conversations||[];
    var active=all.find(function(c){return c.id===state.activeConversation})||null;
    if(!active){
      return false;
    }
    var msgs=(data.messages||[]).filter(function(m){return active&&m.conversationId===active.id});
    var lockedActive=isLockedByOther(active);
    var wasNearBottom=true;
    try{wasNearBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<80;}catch(e){}
    box.innerHTML=(lockedActive?lockPanelHtml(active):'')+(msgs.length?msgs.map(messageHtml).join(''):(lockedActive?'':'<div class="cs-empty">暂无消息</div>'));
    if(wasNearBottom){try{box.scrollTop=box.scrollHeight;}catch(e){}}
    if(listEl){
      var scroller=listEl.querySelector('[data-cs-virt-body]')||listEl;
      var savedScroll=typeof state.listScrollTop==='number'?state.listScrollTop:(scroller.scrollTop||0);
      try{if(scroller.scrollTop)savedScroll=scroller.scrollTop;}catch(e){}
      var counts=filterCounts();
      // Update filter tabs + list body only — never remount search/head (kills overlap + click steals).
      var tabs=listEl.querySelector('.cs-conv-tabs');
      if(tabs){
        tabs.innerHTML=
          '<button type="button" class="cs-conv-tab'+(state.convFilter==='waiting'?' active':'')+'" data-conv-filter="waiting">待接待 <em>'+counts.waiting+'</em></button>'+
          '<button type="button" class="cs-conv-tab'+(state.convFilter==='active'?' active':'')+'" data-conv-filter="active">接待中 <em>'+counts.active+'</em></button>'+
          '<button type="button" class="cs-conv-tab'+(state.convFilter==='ended'?' active':'')+'" data-conv-filter="ended">已结束 <em>'+counts.ended+'</em></button>';
      }
      var body=listEl.querySelector('[data-cs-virt-body]');
      if(body){
        body.innerHTML=virtualListHtml(list,active,data,savedScroll,body.clientHeight||600);
        try{body.scrollTop=savedScroll;state.listScrollTop=savedScroll;}catch(e){}
        bindListScroll(listEl);
      }else{
        var headHtml='<div class="cs-chat-list-head"><strong>会话列表</strong><div class="cs-actions"><button class="cs-btn" type="button" data-refresh>刷新</button><button class="cs-btn cs-list-close" type="button" data-close-conv-list>关闭</button></div></div>'+
          companionContactBarHtml()+
          '<div class="cs-conv-tabs" role="tablist">'+
          '<button type="button" class="cs-conv-tab'+(state.convFilter==='waiting'?' active':'')+'" data-conv-filter="waiting">待接待 <em>'+counts.waiting+'</em></button>'+
          '<button type="button" class="cs-conv-tab'+(state.convFilter==='active'?' active':'')+'" data-conv-filter="active">接待中 <em>'+counts.active+'</em></button>'+
          '<button type="button" class="cs-conv-tab'+(state.convFilter==='ended'?' active':'')+'" data-conv-filter="ended">已结束 <em>'+counts.ended+'</em></button>'+
          '</div>';
        listEl.innerHTML=headHtml+'<div data-cs-virt-body>'+virtualListHtml(list,active,data,savedScroll,560)+'</div>';
        try{
          var body2=listEl.querySelector('[data-cs-virt-body]');
          if(body2)body2.scrollTop=savedScroll;
          state.listScrollTop=savedScroll;
        }catch(e){}
        bindListScroll(listEl);
      }
      listEl.classList.toggle('is-open',!!state.showConversationList);
    }
    var layoutEl=root.querySelector('.cs-chat-layout');
    if(layoutEl)layoutEl.classList.toggle('list-open',!!state.showConversationList);
    // Update reception controls + composer enablement without touching the textarea DOM node value/focus.
    var headEl=root.querySelector('.cs-chat-head');
    if(headEl&&active){
      var takenByOther=isLockedByOther(active);
      var takenByMe=isMineConv(active);
      var titleBox=headEl.querySelector('.cs-chat-head-main > div')||headEl.querySelector('div');
      if(titleBox&&!titleBox.classList.contains('cs-chat-head-main')){
        var isCompActive=active.conversationType==='companion_support'||(!active.bossId&&active.companionId);
        var bossLabel=isCompActive?'':publicBossCode(active);
        var headName=isCompActive
          ? (String(active.bossName||'').replace(/^陪玩\s*·\s*/,'')||'陪玩')
          : sanitizeBossLabel(active.bossName,bossLabel);
        titleBox.innerHTML='<h2>'+esc(isCompActive?('陪玩 · '+headName):headName)+'</h2><p>'+(bossLabel?'编号 '+esc(bossLabel)+' · ':'')+(active.orderNo?'订单 '+esc(active.orderNo)+' · ':'')+esc(active.currentServiceId?(active.currentServiceName||'接待中'):'待接待')+'</p>';
      }
      var actionBtn=headEl.querySelector('[data-take],[data-end]');
      var isClosed=isClosedConv(active);
      var takeHtml=isClosed
        ?'<button class="cs-btn" type="button" disabled>会话已结束</button>'+(active.orderId?'<button class="cs-btn" type="button" data-after-sales="'+esc(active.orderId)+'">创建售后会话</button>':'')
        :takenByOther
        ?'<button class="cs-btn" type="button" disabled>只读 · '+esc(active.assignedCsName||active.currentServiceName||'其他客服')+'</button>'+(isAdminSession()?'<button class="cs-btn primary" type="button" data-admin-takeover="'+esc(active.id)+'">管理员接管</button>':'')
        :(takenByMe
          ?'<button class="cs-btn" type="button" data-transfer-cs="'+esc(active.id)+'">转交客服</button><button class="cs-btn danger" type="button" data-end="'+esc(active.id)+'">结束对话</button>'
          :(!active.currentServiceId
            ?'<button class="cs-btn primary" type="button" data-take="'+esc(active.id)+'"'+(state.acceptingId===active.id?' disabled data-taking="1"':'')+'>'+(state.acceptingId===active.id?'接待中…':'开始接待')+'</button>'
            :''));
      // Remove any stale take/end buttons (avoid 接待+结束接待 both showing).
      headEl.querySelectorAll('[data-take],[data-end],[data-transfer-cs],[data-admin-takeover],[data-after-sales]').forEach(function(btn){btn.remove();});
      var disabledStatus=headEl.querySelectorAll('.cs-chat-head > .cs-btn:not(.cs-back-list)');
      disabledStatus.forEach(function(btn){
        if(!btn.getAttribute('data-take')&&!btn.getAttribute('data-end')&&!btn.getAttribute('data-transfer-cs')&&!btn.getAttribute('data-admin-takeover')&&!btn.getAttribute('data-after-sales')&&/已结束|已由客服|接待|只读|转交|接管|售后|结束对话/.test(btn.textContent||''))btn.remove();
      });
      headEl.insertAdjacentHTML('beforeend',takeHtml);
      syncReceptionBanner(takenByOther?null:active);
      var composerWrap=root.querySelector('[data-cs-composer-wrap]');
      if(composerWrap&&isClosed)composerWrap.remove();
    } else if(headEl&&!active){
      // Return to list empty state handled by paint; patch only when layout exists with active.
    }
    syncComposerEnabled();
    syncPoolCounters();
    // While typing, never overwrite textarea. Otherwise sync from draft map.
    var input=root.querySelector(COMPOSER_SEL);
    if(input){
      if(document.activeElement===input){
        state.composerDraft=String(input.value||'');
        if(state.activeConversation){
          if(!state.composerDrafts)state.composerDrafts={};
          state.composerDrafts[state.activeConversation]=state.composerDraft;
        }
      }else if(typeof state.composerDraft==='string'){
        input.value=state.composerDraft;
      }
    }
    return true;
  }
  function quietRefresh(){
    if(!state.session||!state.session.token||document.hidden)return Promise.resolve();
    if(state.route!=='conversations'&&state.route!=='dashboard'&&state.route!=='orders')return Promise.resolve();
    // While user is typing in chat, only refresh data and keep route + composer.
    return softRefresh();
  }
  function startPoll(){
    if(window.__MCJCsPoll)return;
    bindPoolRealtime();
    window.__MCJCsPoll=setInterval(function(){
      if(isLoginView())return;
      quietRefresh();
    }, 1500);
    if(!window.__MCJCsVisBound){
      window.__MCJCsVisBound=true;
      document.addEventListener('visibilitychange',function(){
        if(document.hidden)return;
        if(!state.session||!state.session.token)return;
        state.poolRealtimeBound=false;
        bindPoolRealtime(true);
        if(state.activeConversation)bindRealtime(state.activeConversation);
        quietRefresh();
      });
    }
    if(!window.__MCJCsAuthRtBound && window.MCJServiceAuth && typeof window.MCJServiceAuth.onAuthStateChange==='function'){
      window.__MCJCsAuthRtBound=true;
      window.MCJServiceAuth.onAuthStateChange(function(evt, session){
        if(!session||!session.token)return;
        state.session=session;
        var RT=window.MCJChatRealtime;
        if(RT&&typeof RT.reconnect==='function'){
          RT.reconnect(session.token).catch(function(){});
        }
        state.poolRealtimeBound=false;
        bindPoolRealtime(true);
        if(state.activeConversation)bindRealtime(state.activeConversation);
      });
    }
  }
  function paintSafeFallback(){
    try{
      var staff=(state.data&&state.data.staff)||(state.session&&state.session.user)||{};
      root.innerHTML='<div class="cs-shell"><aside class="cs-side"><div class="cs-brand"><strong>MEOW CUI JIAO</strong><span>Customer Service</span></div><nav class="cs-nav">'+NAV.map(function(n){if(n[0]==='logout')return '<button type="button" data-logout>'+n[1]+'</button>';return '<button type="button" class="'+(n[0]==='dashboard'?'active':'')+'" data-route="'+n[2]+'">'+n[1]+'</button>'}).join('')+'</nav></aside><section class="cs-main"><header class="cs-top"><div><h1>客服工作台</h1><p>数据加载异常时仍保留工作台框架。</p></div><div class="cs-account"><span>'+esc(staff.name||staff.email||'客服')+'</span></div></header><main class="cs-page">'+dashboardHtml()+'</main></section></div>';
    }catch(e){
      root.textContent='客服工作台加载失败，请刷新页面。';
    }
  }
  function init(){
    try{
      var start=function(){
        state.session=readSession();
        state.route=routeFromPath(location.pathname);
        if(!state.session&&state.route!=='login'){
          if(/\/customer-service\/login/i.test(location.pathname)){
            state.route='login';
            paint();
            return;
          }
          // Always leave empty shell for login — do not trust cross-role shared tokens alone.
          if(window.MCJServiceAuth&&window.MCJServiceAuth.redirectToLogin){
            window.MCJServiceAuth.redirectToLogin(location.pathname+location.search+location.hash);
          }else{
            location.replace('/customer-service/login/');
          }
          return;
        }
        if(state.session&&state.route==='login'){
          location.replace('/customer-service/dashboard/');
          return;
        }
        if(state.session){
          state.data=state.data||emptyDashboardData();
          state.loading=false;
          paint();
          load().then(startPoll).catch(function(){state.loading=false;paint()});
        }else{
          paint();
        }
      };
      if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.ensureSession==='function'){
        window.MCJServiceAuth.ensureSession().then(start).catch(start);
      }else{
        start();
      }
    }catch(e){
      paintSafeFallback();
    }
  }
  window.addEventListener('popstate',function(){
    // Never remount the login form on history changes — that wiped typed values.
    if(!state.session||routeFromPath(location.pathname)==='login'){
      state.route='login';
      updateLoginChrome();
      return;
    }
    state.route=routeFromPath(location.pathname);
    paint();
  });
  function paint(){
    try{
      // Do NOT re-read URL into state.route here — that snapped 统一会话池 back to 工作台.
      if(state.route==='conversations')captureComposer();
      if(state.route==='login'||!state.session){
        ensureLoginMounted();
        return;
      }
      if(!state.data)state.data=emptyDashboardData();
      renderShell();
      syncPoolCounters();
      if(state.route==='conversations'){
        restoreComposer();
        var listEl=root.querySelector('.cs-chat-list');
        if(listEl){
          try{listEl.scrollTop=state.listScrollTop||0;}catch(e){}
          bindListScroll(listEl);
        }
        bindPoolRealtime();
      }
      if(state.route==='dashboard')startHoursTimer();
    }catch(e){
      paintSafeFallback();
    }
  }
  function noticeHtml(){return state.notice?'<div class="cs-toast show">'+esc(state.notice)+'</div>':''}
  function ensureLoginMounted(){
    var existing=root.querySelector('form[data-login]');
    if(existing){
      updateLoginChrome();
      return;
    }
    renderLogin();
  }
  function renderLogin(){
    // Never remount over an existing login form — that wiped typed values.
    if(root.querySelector('form[data-login]')){
      restoreLoginDraft();
      updateLoginChrome();
      return;
    }
    captureLoginDraft();
    var header=Auth&&Auth.brandHeader?Auth.brandHeader('客服端登录','使用后台创建的客服账号登录'):'<h1 class="mcj-auth-title">客服端登录</h1><p class="mcj-auth-desc">使用后台创建的客服账号登录</p>';
    var pwd=Auth&&Auth.passwordField?Auth.passwordField('password','密码'):'<label class="mcj-auth-field">密码<div class="mcj-auth-password password-field"><input name="password" type="password" autocomplete="current-password" required><button class="mcj-auth-eye" type="button" tabindex="-1" data-toggle-password aria-label="显示或隐藏密码">显示</button></div></label>';
    root.innerHTML=
      '<main class="mcj-auth-page">'+
      '<section class="mcj-auth-card">'+header+
      '<form class="mcj-auth-form" data-login autocomplete="on">'+
      '<label class="mcj-auth-field">邮箱<input name="account" type="text" inputmode="email" autocomplete="username" required placeholder="请输入客服邮箱"></label>'+
      pwd+
      '<label class="mcj-auth-check"><input name="remember" type="checkbox" checked> 记住登录</label>'+
      '<button class="mcj-auth-btn primary" type="submit"'+(state.loginBusy?' disabled':'')+'>'+(state.loginBusy?'登录中…':'登录')+'</button>'+
      '<p class="mcj-auth-error" data-auth-error>'+esc(state.loginError||'')+'</p>'+
      '<p class="mcj-auth-note">客服账号由管理员创建，停用账号无法登录。本页面不提供注册入口。</p>'+
      '</form></section></main>';
    restoreLoginDraft();
    updateLoginChrome();
    if(!window.__MCJCsAuthTogglesBound){
      window.__MCJCsAuthTogglesBound=true;
      root.addEventListener('click',function(e){
        var btn=e.target.closest('[data-toggle-password]');
        if(!btn)return;
        e.preventDefault();
        var wrap=btn.closest('.mcj-auth-password,.password-field')||btn.parentElement;
        var input=wrap&&wrap.querySelector('input');
        if(!input)return;
        captureLoginDraft();
        var value=input.value;
        var show=input.type==='password';
        input.type=show?'text':'password';
        input.value=value;
        if(state.loginDraft)state.loginDraft.password=value;
        btn.textContent=show?'隐藏':'显示';
      });
    }
  }
  function title(){return ({dashboard:'客服工作台',conversations:'统一会话池',orders:'订单处理',createOrder:'客服代下单',compensation:'申请补偿',reports:'工资中心',profile:'我的资料'})[state.route]||'客服端'}
  function renderShell(){
    var staff=(state.data&&state.data.staff)||(state.session&&state.session.user)||{};
    recomputeSummaryFromConversations();
    var unread=Number((state.data&&state.data.summary&&state.data.summary.unreadMessages)||0)||0;
    root.innerHTML='<div class="cs-shell"><aside class="cs-side"><div class="cs-brand"><strong>MEOW CUI JIAO</strong><span>Customer Service</span></div><nav class="cs-nav">'+NAV.map(function(n){
      if(n[0]==='logout')return '<button type="button" data-logout>'+n[1]+'</button>';
      var badge=n[0]==='conversations'?('<b class="cs-nav-unread" data-nav-unread'+(unread?'':' hidden')+'>'+(unread>99?'99+':String(unread||''))+'</b>'):'';
      return '<button type="button" class="'+(state.route===n[0]?'active':'')+'" data-route="'+n[2]+'">'+n[1]+badge+'</button>';
    }).join('')+'</nav></aside><section class="cs-main"><header class="cs-top"><div><h1>'+title()+'</h1><p>客服端只处理会话与订单主流程。</p></div><div class="cs-account"><span>'+esc(staff.name||staff.email||'客服')+'</span></div></header><main class="cs-page" data-route="'+esc(state.route||'dashboard')+'">'+pageHtml()+'</main></section></div>'+noticeHtml();
  }
  function maintenanceHtml(name){return '<div class="cs-page-head"><div><h2>'+esc(name||'模块已合并')+'</h2><p>该模块已合并到工作台其他页面，请返回工作台继续处理会话与订单。</p></div><button class="cs-btn primary" type="button" data-route="/customer-service/dashboard">返回工作台</button></div>'}
  function pageHtml(){
    var note='';
    if(state.loading)note+='<div class="cs-empty" style="padding:16px">正在读取真实数据...</div>';
    // create-order: never show page-level "部分数据暂不可用 / Supabase 请求失败"; use per-field tips only.
    if(state.error&&state.route!=='createOrder')note+='<div class="cs-dev-note"><strong>部分数据暂不可用</strong><span> '+esc(state.error)+'</span></div>';
    if(HIDDEN_MVP_ROUTES[state.route])return note+maintenanceHtml(title());
    if(state.route==='conversations')return note+conversationsHtml();
    if(state.route==='orders')return note+ordersHtml();
    if(state.route==='compensation')return note+compensationHtml();
    if(state.route==='reports')return note+reportsHtml();
    if(state.route==='createOrder')return (state.loading?note:'')+createOrderHtml();
    if(state.route==='profile')return note+profileHtml();
    return note+dashboardHtml();
  }
  function metric(label,value,key){
    var attr=key?' data-metric-'+esc(key):'';
    return '<article class="cs-card cs-metric"><span>'+esc(label)+'</span><strong'+attr+'>'+esc(value==null||value===''?'0':value)+'</strong></article>';
  }
  function dashboardHtml(){
    var s=(state.data&&state.data.summary)||{};
    var work=(state.data&&state.data.workData)||{};
    var att=work.todayAttendance||{};
    var reassign=s.needsReassign||0;
    var canIn=clockCanIn(att);
    var canOut=clockCanOut(att);
    var liveHours=liveTotalHours(att);
    var closedCount=Number(att.closedCount||0)||0;
    var clockInLabel=state.clockBusy?'处理中…':(canIn?(closedCount>0?'再次上班（加班）':'上班打卡'):'上班中');
    var clockOutLabel=state.clockBusy?'处理中…':(canOut?'下班打卡':'已下班');
    recomputeSummaryFromConversations();
    s=(state.data&&state.data.summary)||s;
    return '<div class="cs-page-head"><div><h2>工作台</h2><p>主流程：接待会话、确认付款、推进订单。</p></div><div class="cs-actions"><button class="cs-btn primary" type="button" data-route="/customer-service/conversations">进入会话池</button><button class="cs-btn" type="button" data-route="/customer-service/orders">订单处理</button></div></div>'+
      '<section class="cs-card" style="margin-bottom:14px" data-clock-panel><h3>今日打卡</h3><div class="cs-info-list">'+
      '<div><span>当前状态</span><strong data-clock-status>'+esc(att.attendanceStatus||'未打卡')+'</strong></div>'+
      '<div><span>本班上班</span><strong data-clock-in-at>'+esc(fmtAttDateTime(att.clockInText,att.clockInAt)||'-')+'</strong></div>'+
      '<div><span>本班下班</span><strong data-clock-out-at>'+esc(canOut?'上班中':(fmtAttDateTime(att.clockOutText,att.clockOutAt)||'-'))+'</strong></div>'+
      '<div><span>今日工时累计</span><strong data-live-hours>'+esc(liveHours!=null&&liveHours!==''?(liveHours+' 小时'):'-')+'</strong></div>'+
      '<div><span>今日加班工时</span><strong data-overtime-hours>'+esc((att.overtimeHours!=null?att.overtimeHours:0)+' 小时')+'</strong></div>'+
      '<div><span>今日班次</span><strong>'+esc((att.sessionCount!=null?att.sessionCount:closedCount+(canOut?1:0))+' 次')+'</strong></div>'+
      '</div><div class="cs-actions" style="margin-top:12px">'+
      '<button class="cs-btn primary" type="button" data-clock-in '+(!canIn||state.clockBusy?'disabled':'')+'>'+esc(clockInLabel)+'</button>'+
      '<button class="cs-btn" type="button" data-clock-out '+(!canOut||state.clockBusy?'disabled':'')+'>'+esc(clockOutLabel)+'</button>'+
      '</div></section>'+
      attendanceHistoryHtml()+
      (reassign?'<div class="cs-empty" style="margin-bottom:12px"><strong>待重新安排订单</strong><span>共 '+esc(reassign)+' 单陪玩无法接单或确认超时，请到订单处理中更换陪玩 / 推送抢单 / 联系老板 / 发起退款。</span></div>':'')+
      '<section class="cs-grid cs-metrics">'+
      metric('当前接待中会话',s.currentReceptions||0,'current')+
      metric('今日已接待会话',s.todayReceptions||0)+
      metric('今日完成订单',s.todayCompleted||0)+
      metric('今日协助付款',s.todayPaid||0)+
      metric('今日退款处理',s.todayRefunds||0)+
      metric('未读消息',s.unreadMessages||0,'unread')+
      metric('本月出勤天数',s.monthAttendanceDays||0)+
      metric('本月迟到次数',s.monthLateCount||0)+
      metric('本月缺勤次数',s.monthAbsenceCount||0)+
      metric('本月预计工资',money(s.estimatedSalary||0))+
      metric('今日收入',money(s.incomeToday||0))+
      metric('本月收入',money(s.incomeMonth||0))+
      metric('累计收入',money(s.incomeTotal||0))+
      metric('可申请工资',money(s.withdrawableSalary!=null?s.withdrawableSalary:s.estimatedSalary||0))+
      metric('待重新安排',reassign)+
      metric('今日处理订单数',s.todayHandled||0)+
      '</section>';
  }
  function parseProductCard(content){
    try{
      var data=typeof content==='string'?JSON.parse(content):content;
      if(data&&(data.kind==='gameplay_product'||data.productId))return data;
    }catch(e){}
    return null;
  }
  function productCardHtml(data){
    data=data||{};
    var price=data.fixedPrice===false?'咨询客服报价':moneyRate(data.price, data.pricingUnit||'每单');
    return '<div class="cs-product-card"><div class="cs-product-cover">'+(data.coverUrl?'<img src="'+esc(data.coverUrl)+'" alt="">':'MEOW')+'</div><div><strong>'+esc(data.name||'玩法商品')+'</strong><span>'+esc(price)+'</span><small>商品ID：'+esc(data.productId||'-')+' · 老板ID：'+esc(data.bossId||'-')+'</small><div class="cs-actions"><button class="cs-btn" type="button" data-route="/customer-service/create-order" data-gp-fill="'+esc(data.productId||'')+'" data-gp-name="'+esc(data.name||'')+'" data-gp-price="'+esc(data.price||0)+'" data-gp-unit="'+esc(data.pricingUnit||'')+'" data-gp-boss="'+esc(data.bossId||'')+'">创建正式订单</button></div></div></div>';
  }
  function isGameplayConversation(c,msgs){
    var list=(msgs||[]).filter(function(m){return c&&m.conversationId===c.id});
    return list.some(function(m){return m.messageType==='product_card'||/更多玩法/.test(String(m.content||''));});
  }
  function fmtChatTime(v){
    if(!v)return '';
    var d=new Date(v);
    if(isNaN(d.getTime()))return String(v);
    var now=new Date();
    var hh=String(d.getHours()).padStart(2,'0');
    var mm=String(d.getMinutes()).padStart(2,'0');
    var time=hh+':'+mm;
    var sameDay=d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();
    if(sameDay)return '今天 '+time;
    var yest=new Date(now);yest.setDate(now.getDate()-1);
    var isYest=d.getFullYear()===yest.getFullYear()&&d.getMonth()===yest.getMonth()&&d.getDate()===yest.getDate();
    if(isYest)return '昨天 '+time;
    return (d.getMonth()+1)+'/'+d.getDate()+' '+time;
  }
  function companionAcceptLabel(order){
    if(!order)return '-';
    var s=String(order.status||'');
    var note=String(order.note||order.cancelReason||'');
    if(s==='awaiting_payment')return '尚未付款';
    if(s==='claimed')return '等待陪玩确认';
    if(s==='confirmed')return '进行中';
    if(s==='in_progress')return '进行中';
    if(s==='pending'&&(/无法接单|拒单/.test(note)||order.needsReassign))return '需要重新安排';
    if(s==='pending'&&/确认超时/.test(note))return '需要重新安排';
    if(s==='pending')return '等待陪玩抢单';
    if(s==='waiting_boss_confirm')return '等待老板选择';
    if(s==='completed')return '已完成';
    return order.statusText||s||'-';
  }
  function paymentStatusLabel(order){
    if(!order)return '-';
    var s=String(order.status||'');
    if(s==='awaiting_payment')return '待付款';
    if(s==='cancelled')return '已取消';
    if(s==='refunded')return '已退款';
    return '已付款';
  }
  function companionContactBarHtml(){
    return '<div class="cs-companion-contact">'+
      '<div class="cs-new-chat-row">'+
      '<button class="cs-btn primary" type="button" data-cs-new-chat>+ 新建对话</button>'+
      '</div>'+
      '<input type="search" class="cs-companion-search" placeholder="搜索陪玩编号 / 昵称…" data-cs-companion-search autocomplete="off">'+
      '<div class="cs-companion-results" data-cs-companion-results hidden></div></div>';
  }
  function companionSearchHaystack(p){
    if(!p)return '';
    var code=String(p.companionCode||p.publicId||'').trim();
    if(!code&&p.companionUid!=null&&p.companionUid!==''){
      var n=Number(p.companionUid);
      if(Number.isFinite(n)&&n>0){
        var seq=n>=100001?n-100000:n;
        code='PW'+String(seq).padStart(5,'0');
      }else code=String(p.companionUid);
    }
    return [
      p.name,
      p.nickname,
      code,
      p.companionCode,
      p.publicId,
      p.companionUid,
      p.id,
      p.game
    ].map(function(x){return String(x==null?'':x).toLowerCase()}).join(' ');
  }
  function filterCompanions(q){
    q=String(q||'').trim().toLowerCase();
    var list=(state.data&&state.data.companions)||[];
    if(!q)return list.slice(0,8);
    var compact=q.replace(/\s+/g,'');
    return list.filter(function(p){
      var hay=companionSearchHaystack(p);
      if(hay.indexOf(q)>=0||hay.indexOf(compact)>=0)return true;
      // PW00002 / pw2 / 00002
      if(/^pw?\d+$/i.test(compact)){
        var code=String(p.companionCode||p.publicId||'').toLowerCase();
        if(!code&&p.companionUid!=null&&p.companionUid!==''){
          var n=Number(p.companionUid);
          if(Number.isFinite(n)&&n>0){
            var seq=n>=100001?n-100000:n;
            code='pw'+String(seq).padStart(5,'0');
          }
        }
        var digits=compact.replace(/^pw/i,'');
        if(code&&(code===compact||code.replace(/^pw/i,'')===digits||Number(p.companionUid)===Number(digits)))return true;
      }
      return false;
    }).slice(0,8);
  }
  function renderCompanionResults(input){
    var box=root.querySelector('[data-cs-companion-results]');
    if(!box)return;
    if(!input||!String(input.value||'').trim()){box.hidden=true;box.innerHTML='';return;}
    var q=String(input.value||'').trim();
    var items=filterCompanions(q);
    if(!items.length){
      box.hidden=false;
      box.innerHTML='<button type="button" class="cs-nc-person" data-start-companion="'+esc(q)+'">'+
        '<span class="cs-nc-avatar cs-nc-avatar-fallback">?</span>'+
        '<span class="cs-nc-person-main"><strong class="cs-nc-name">查找「'+esc(q)+'」</strong>'+
        '<span class="cs-nc-meta">按编号 / 昵称打开会话</span></span></button>';
      return;
    }
    box.hidden=false;
    box.innerHTML=items.map(function(p){
      return newChatPersonCardHtml('companion',p,'').replace('data-new-chat-pick=','data-start-companion=');
    }).join('');
  }
  function resolveOrderIdForCompanion(companionId){
    var cid=String(companionId||'').trim();
    var orders=(state.data&&state.data.orders)||[];
    var related=orders.filter(function(o){
      return String(o.companionId||o.companion_id||'')===cid;
    });
    if(related.length===1)return related[0].id;
    return '';
  }
  function personPublicCode(role,p){
    if(!p)return '';
    if(role==='companion'){
      var code=String(p.companionCode||p.publicId||'').trim();
      if(code)return code;
      if(p.companionUid!=null&&p.companionUid!==''){
        var n=Number(p.companionUid);
        if(Number.isFinite(n)&&n>0){
          var seq=n>=100001?n-100000:n;
          return 'PW'+String(seq).padStart(5,'0');
        }
      }
      return '';
    }
    var boss=String(p.bossUid||p.boss_uid||p.bossCode||'').trim();
    if(/^MCJ\d+$/i.test(boss))return boss.toUpperCase();
    return boss;
  }
  function personAvatarUrl(p){
    return String((p&&(p.avatarUrl||p.avatar||p.cardImageUrl||p.avatar_url))||'').trim();
  }
  function personOnlineMeta(role,p){
    if(role!=='companion')return {cls:'idle',text:'老板'};
    var raw=String(p.onlineStatus||p.online_status||'').toLowerCase();
    var label=String(p.onlineStatusLabel||'').trim();
    if(p.online===true||raw==='online'||/在线/.test(label))return {cls:'on',text:label||'在线'};
    if(raw==='busy'||raw==='in_service'||/接待|忙碌/.test(label))return {cls:'busy',text:label||'接待中'};
    return {cls:'off',text:label||'离线'};
  }
  function newChatPersonCardHtml(role,p,selectedId){
    var id=String(p.id||p.userId||'');
    var name=String(p.name||p.nickname||p.displayName||(role==='companion'?'陪玩':'老板')).trim();
    var code=personPublicCode(role,p);
    var game=String(p.game||p.mainGame||p.gameName||(role==='boss'?'—':'')).trim()||'—';
    var online=personOnlineMeta(role,p);
    var av=personAvatarUrl(p);
    var initial=esc((name||'?').slice(0,1));
    return '<button type="button" class="cs-nc-person'+(selectedId===id?' is-active':'')+'" data-new-chat-pick="'+esc(id)+'">'+
      (av
        ?'<img class="cs-nc-avatar" src="'+esc(av)+'" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling&&(this.nextElementSibling.hidden=false)">'
        :'')+
      '<span class="cs-nc-avatar cs-nc-avatar-fallback"'+(av?' hidden':'')+'>'+initial+'</span>'+
      '<span class="cs-nc-person-main">'+
        '<strong class="cs-nc-name">'+esc(name)+'</strong>'+
        '<span class="cs-nc-meta">'+esc(code||'未绑定编号')+' · '+esc(game)+'</span>'+
      '</span>'+
      '<span class="cs-nc-online '+online.cls+'">'+esc(online.text)+'</span>'+
      '</button>';
  }
  function newChatOrderCardHtml(o,selectedOrderId){
    var oid=String(o.id||'');
    var no=String(o.orderNo||o.order_no||'').trim();
    if(!no||/^[0-9a-f-]{20,}$/i.test(no))no=shortOrderNo(o.orderNo||o.id)||'订单';
    var st=o.statusText||paymentStatusLabel(o)||o.status||'';
    var game=o.game||'—';
    var who=o.companionName||o.bossName||'';
    return '<button type="button" class="cs-nc-order'+(selectedOrderId===oid?' is-active':'')+'" data-new-chat-order-pick="'+esc(oid)+'">'+
      '<span class="cs-nc-order-top"><strong>'+esc(no)+'</strong><em>'+esc(st)+'</em></span>'+
      '<span class="cs-nc-order-sub">'+esc(game)+(who?' · '+esc(who):'')+' · '+money(o.totalAmount||o.amount||0)+'</span>'+
      '</button>';
  }
  function openOrderPickModal(opts){
    opts=opts||{};
    var orders=opts.orders||[];
    var title=opts.title||'选择关联订单';
    var allowSkip=!!opts.allowSkip;
    var html='<div class="cs-dialog-head"><h3>'+esc(title)+'</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div>';
    if(!orders.length){
      html+='<p class="cs-muted">暂无可选订单。可先创建普通咨询，稍后在会话中关联订单。</p>';
      if(allowSkip)html+='<div class="cs-new-chat-footer"><button class="cs-btn primary" type="button" data-order-pick-skip>不关联订单</button></div>';
    }else{
      html+='<div class="cs-nc-order-list">'+orders.slice(0,20).map(function(o){return newChatOrderCardHtml(o,'');}).join('')+'</div>';
      if(allowSkip)html+='<div class="cs-new-chat-footer"><button class="cs-btn" type="button" data-order-pick-skip>不关联订单</button></div>';
    }
    modal(html,'cs-new-chat-dialog');
    var rootModal=document.querySelector('.cs-modal');
    if(!rootModal)return Promise.resolve('');
    return new Promise(function(resolve){
      function done(v){
        rootModal.remove();
        resolve(v||'');
      }
      rootModal.addEventListener('click',function(ev){
        if(ev.target.closest('[data-close-modal]')||ev.target===rootModal){done('');return;}
        var skip=ev.target.closest('[data-order-pick-skip]');
        if(skip){done('__skip__');return;}
        var pick=ev.target.closest('[data-new-chat-order-pick], [data-order-pick]');
        if(pick){done(pick.getAttribute('data-new-chat-order-pick')||pick.getAttribute('data-order-pick')||'');}
      });
    });
  }
  function openNewChatModal(){
    var bosses=((state.data&&state.data.bosses)||[]).slice();
    var companions=((state.data&&state.data.companions)||[]).slice();
    var allOrders=((state.data&&state.data.orders)||[]).slice();
    modal(
      '<div class="cs-dialog-head"><div><h3>新建对话</h3><p class="cs-nc-sub">选择对象后创建独立会话</p></div>'+
      '<button class="cs-btn cs-nc-close" type="button" data-close-modal aria-label="关闭">✕</button></div>'+
      '<div class="cs-nc-seg" role="tablist" data-new-chat-role-seg>'+
        '<button type="button" class="cs-nc-seg-btn is-active" data-new-chat-role="boss">老板</button>'+
        '<button type="button" class="cs-nc-seg-btn" data-new-chat-role="companion">陪玩</button>'+
      '</div>'+
      '<div class="cs-nc-seg cs-nc-seg-soft" role="tablist" data-new-chat-consult-seg>'+
        '<button type="button" class="cs-nc-seg-btn is-active" data-new-chat-consult="general">普通咨询</button>'+
        '<button type="button" class="cs-nc-seg-btn" data-new-chat-consult="order">订单咨询</button>'+
      '</div>'+
      '<div class="cs-nc-search-wrap">'+
        '<input type="search" class="cs-nc-search" data-new-chat-search placeholder="搜索昵称 / MCJ / PW 编号" autocomplete="off">'+
      '</div>'+
      '<div class="cs-nc-section-label">选择对象</div>'+
      '<div class="cs-nc-people" data-new-chat-results></div>'+
      '<div class="cs-nc-orders-wrap" data-new-chat-order-wrap hidden>'+
        '<div class="cs-nc-section-label">关联订单</div>'+
        '<div class="cs-nc-order-list" data-new-chat-orders></div>'+
      '</div>'+
      '<div class="cs-new-chat-footer">'+
        '<button class="cs-btn primary cs-nc-submit" type="button" data-new-chat-submit disabled>创建会话</button>'+
      '</div>',
      'cs-new-chat-dialog'
    );
    var rootModal=document.querySelector('.cs-modal');
    if(!rootModal)return;
    var selected={role:'boss',id:'',consult:'general',orderId:''};
    function filteredOrders(){
      if(!selected.id)return allOrders.slice(0,12);
      return allOrders.filter(function(o){
        if(selected.role==='boss')return String(o.bossId||o.boss_id||'')===selected.id;
        return String(o.companionId||o.companion_id||'')===selected.id;
      }).slice(0,12);
    }
    function paintOrders(){
      var wrap=rootModal.querySelector('[data-new-chat-order-wrap]');
      var box=rootModal.querySelector('[data-new-chat-orders]');
      if(!wrap||!box)return;
      wrap.hidden=selected.consult!=='order';
      if(selected.consult!=='order'){selected.orderId='';return;}
      var list=filteredOrders();
      var skipHtml='<button type="button" class="cs-nc-order cs-nc-order-skip'+(selected.orderId?'':' is-active')+'" data-new-chat-order-pick="">'+
        '<span class="cs-nc-order-top"><strong>不关联订单</strong><em>普通跟进</em></span>'+
        '<span class="cs-nc-order-sub">先聊需求，稍后再绑订单</span></button>';
      if(!list.length){
        box.innerHTML=skipHtml+'<p class="cs-muted cs-nc-empty-hint">该对象暂无订单，可先不关联。</p>';
        return;
      }
      box.innerHTML=skipHtml+list.map(function(o){return newChatOrderCardHtml(o,selected.orderId);}).join('');
    }
    function paintResults(){
      var q=String((rootModal.querySelector('[data-new-chat-search]')||{}).value||'').trim().toLowerCase();
      var role=selected.role;
      var list=role==='companion'?companions:bosses;
      var items=list.filter(function(p){
        if(!q)return true;
        var code=personPublicCode(role,p).toLowerCase();
        var hay=[p.name,p.nickname,p.displayName,code,p.bossUid,p.bossCode,p.companionCode,p.publicId,p.game,p.mainGame].map(function(x){return String(x||'').toLowerCase()}).join(' ');
        return hay.indexOf(q)>=0;
      }).slice(0,10);
      var box=rootModal.querySelector('[data-new-chat-results]');
      if(!box)return;
      if(!items.length){
        box.innerHTML='<p class="cs-muted cs-nc-empty-hint">未找到匹配'+(role==='companion'?'陪玩':'老板')+'。可输入完整编号后直接创建。</p>';
        return;
      }
      box.innerHTML=items.map(function(p){return newChatPersonCardHtml(role,p,selected.id);}).join('');
    }
    function syncUi(){
      rootModal.querySelectorAll('[data-new-chat-role]').forEach(function(btn){
        btn.classList.toggle('is-active',btn.getAttribute('data-new-chat-role')===selected.role);
      });
      rootModal.querySelectorAll('[data-new-chat-consult]').forEach(function(btn){
        btn.classList.toggle('is-active',btn.getAttribute('data-new-chat-consult')===selected.consult);
      });
      var btn=rootModal.querySelector('[data-new-chat-submit]');
      var searchVal=String((rootModal.querySelector('[data-new-chat-search]')||{}).value||'').trim();
      if(btn)btn.disabled=!(selected.id||searchVal);
      paintResults();
      paintOrders();
    }
    rootModal.addEventListener('input',function(ev){
      if(ev.target.matches('[data-new-chat-search]'))syncUi();
    });
    rootModal.addEventListener('click',function(ev){
      if(ev.target.closest('[data-close-modal]')||ev.target===rootModal){rootModal.remove();return;}
      var roleBtn=ev.target.closest('[data-new-chat-role]');
      if(roleBtn){
        selected.role=roleBtn.getAttribute('data-new-chat-role')||'boss';
        selected.id='';
        selected.orderId='';
        syncUi();
        return;
      }
      var consultBtn=ev.target.closest('[data-new-chat-consult]');
      if(consultBtn){
        selected.consult=consultBtn.getAttribute('data-new-chat-consult')||'general';
        if(selected.consult!=='order')selected.orderId='';
        syncUi();
        return;
      }
      var pick=ev.target.closest('[data-new-chat-pick]');
      if(pick){
        selected.id=pick.getAttribute('data-new-chat-pick')||'';
        selected.orderId='';
        syncUi();
        return;
      }
      var orderPick=ev.target.closest('[data-new-chat-order-pick]');
      if(orderPick){
        selected.orderId=orderPick.getAttribute('data-new-chat-order-pick')||'';
        paintOrders();
        return;
      }
      var submit=ev.target.closest('[data-new-chat-submit]');
      if(!submit)return;
      var searchVal=String((rootModal.querySelector('[data-new-chat-search]')||{}).value||'').trim();
      var targetId=selected.id||'';
      if(!targetId){
        toast(searchVal?'请从搜索结果中点选老板/陪玩后再创建':'请选择老板/陪玩后再创建');
        return;
      }
      var orderId=selected.consult==='order'?String(selected.orderId||'').trim():'';
      submit.disabled=true;
      submit.textContent='创建中…';
      api('start_consult',{
        targetRole:selected.role,
        targetId:targetId,
        bossId:selected.role==='boss'?targetId:undefined,
        companionId:selected.role==='companion'?targetId:undefined,
        orderId:orderId||undefined,
        consultType:selected.consult==='order'?(orderId?'current_order':'other'):'other',
        forceNew:true
      }).then(function(res){
        rootModal.remove();
        var conv=res.conversation||{};
        var cid=String(res.conversationId||conv.id||'').trim();
        if(!cid||!state.data){toast('创建失败');return;}
        var list=state.data.conversations||[];
        var idx=list.findIndex(function(c){return c.id===cid});
        var merged=Object.assign({id:cid},conv,{lockedByOther:!!conv.lockedByOther,currentServiceId:conv.currentServiceId||myServiceId()});
        if(idx>=0)list[idx]=Object.assign({},list[idx],merged);
        else list.unshift(merged);
        state.data.conversations=list;
        state.activeConversation=cid;
        state.convFilter=convBucket(merged);
        state.showConversationList=false;
        state.route='conversations';
        toast(res.message||'会话已创建');
        paint();
        loadActiveConversationMessages(cid).then(function(){bindRealtime(cid);});
      }).catch(function(err){
        submit.disabled=false;
        submit.textContent='创建会话';
        toast((err&&err.message)||'创建失败');
      });
    });
    syncUi();
  }
  function openCompanionChat(companionId){
    var id=String(companionId||'').trim();
    if(!id)return;
    // Prefer jumping to an existing local conversation when query matches nickname/code.
    var localHit=((state.data&&state.data.companions)||[]).find(function(p){
      return String(p.id)===id;
    });
    if(!localHit){
      var matches=filterCompanions(id);
      if(matches.length===1)id=matches[0].id;
    }
    var existing=((state.data&&state.data.conversations)||[]).find(function(c){
      var isCompanion=c.conversationType==='companion_support'||(!c.bossId&&c.companionId);
      if(!isCompanion)return false;
      if(localHit&&c.companionId&&c.companionId===localHit.id&&c.orderId)return true;
      if(c.companionId&&c.companionId===id&&c.orderId)return true;
      return false;
    });
    if(existing&&existing.id){
      state.activeConversation=existing.id;
      state.convFilter=convBucket(existing);
      state.showConversationList=false;
      state.route='conversations';
      state.suppressAutoSelect=false;
      var search=root.querySelector('[data-cs-companion-search]');
      if(search)search.value='';
      renderCompanionResults(null);
      paint();
      loadActiveConversationMessages(existing.id).then(function(){bindRealtime(existing.id);});
      toast('已打开陪玩订单会话');
      return;
    }
    var relatedOrders=((state.data&&state.data.orders)||[]).filter(function(o){
      var cid=localHit&&localHit.id||id;
      return String(o.companionId||o.companion_id||'')===String(cid);
    });
    var singleOrder=resolveOrderIdForCompanion(localHit&&localHit.id||id);
    function startWithOrder(orderId){
      var payload={companionId:id,forceNew:!orderId};
      if(orderId&&orderId!=='__skip__'){
        payload.orderId=orderId;
        payload.order_id=orderId;
      }
      api(orderId&&orderId!=='__skip__'?'start_companion_chat':'start_consult',Object.assign({
        targetRole:'companion',
        targetId:id,
        consultType:orderId&&orderId!=='__skip__'?'order_dock':'general'
      },payload)).then(function(res){
        var conv=res.conversation||{};
        var cid=String(res.conversationId||conv.id||'').trim();
        if(!cid||!state.data){toast('无法打开陪玩会话');return;}
        var list=state.data.conversations||[];
        var idx=list.findIndex(function(c){return c.id===cid});
        var merged=Object.assign({id:cid,bossName:conv.bossName||'陪玩'},conv,{lockedByOther:!!conv.lockedByOther,currentServiceId:conv.currentServiceId||(conv.lockedByOther?'':myServiceId())});
        if(idx>=0)list[idx]=Object.assign({},list[idx],merged);
        else list.unshift(merged);
        state.data.conversations=list;
        state.activeConversation=cid;
        state.convFilter=convBucket(merged);
        state.showConversationList=false;
        state.route='conversations';
        state.suppressAutoSelect=false;
        var search2=root.querySelector('[data-cs-companion-search]');
        if(search2)search2.value='';
        renderCompanionResults(null);
        toast(res.message||'已打开陪玩会话');
        paint();
        loadActiveConversationMessages(cid).then(function(){bindRealtime(cid);});
      }).catch(function(err){toast((err&&err.message)||'打开陪玩会话失败');});
    }
    if(singleOrder){startWithOrder(singleOrder);return;}
    openOrderPickModal({
      title:'联系陪玩 · 选择订单或普通咨询',
      orders:relatedOrders,
      allowSkip:true
    }).then(function(picked){
      if(!picked)return;
      startWithOrder(picked==='__skip__'?'':picked);
    });
  }
  function sanitizeBossLabel(name, code){
    var n=String(name||'').trim();
    var c=String(code||'').trim();
    if(/@/.test(n)||/^(boss|companion|service|admin|cs)\./i.test(n)||/\.(test|meow)\b/i.test(n)||/^[a-z0-9._+-]+\.[a-z0-9._+-]+\.\d{8,}$/i.test(n)){
      n='';
    }
    if(/^MCJ\d+$/i.test(c))return n||('老板 '+c.toUpperCase());
    return n||'老板';
  }
  function publicBossCode(c){
    var u=String((c&&(c.bossUid||c.boss_uid))||'').trim();
    if(/^MCJ\d+$/i.test(u))return u.toUpperCase();
    return '';
  }
  function shortOrderNo(raw){
    var s=String(raw||'').trim();
    if(!s||s==='无'||s==='无订单')return '';
    // Prefer trailing token after last dash (e.g. MCJ-...-XB1K → XB1K)
    var parts=s.split(/[-_]/).filter(Boolean);
    var tail=parts.length?parts[parts.length-1]:s;
    if(tail.length>=4&&tail.length<=10&&!/^[0-9]{10,}$/.test(tail))return tail;
    if(s.length<=10)return s;
    return s.slice(-8);
  }
  function listTimeLabel(v){
    if(!v)return '';
    var d=new Date(v);
    if(isNaN(d.getTime()))return '';
    var now=new Date();
    var hh=String(d.getHours()).padStart(2,'0');
    var mm=String(d.getMinutes()).padStart(2,'0');
    var time=hh+':'+mm;
    var sameDay=d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();
    if(sameDay)return time;
    var yest=new Date(now);yest.setDate(now.getDate()-1);
    if(d.getFullYear()===yest.getFullYear()&&d.getMonth()===yest.getMonth()&&d.getDate()===yest.getDate())return '昨天';
    return (d.getMonth()+1)+'/'+d.getDate();
  }
  function conversationStatusKind(c){
    if(isClosedConv(c))return 'ended';
    if(c&&(c.currentServiceId||isMineConv(c)))return 'active';
    return 'waiting';
  }
  function conversationCardHtml(c,active,data){
    var order=(data.orders||[]).find(function(o){return o.id===c.orderId})||{};
    var isCompanion=c.conversationType==='companion_support'||(!c.bossId&&c.companionId);
    var role=isCompanion?'陪玩':'老板';
    var bossCode=isCompanion?'':publicBossCode(c);
    var nick=isCompanion
      ? String(c.nickname||c.bossName||'').replace(/^陪玩\s*·\s*/,'')||'陪玩'
      : sanitizeBossLabel(c.nickname||c.bossName,bossCode);
    // Strip accidental UUID / email dumps from display name
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(nick)||/@/.test(nick))nick=role;
    var game=String(order.game||c.game||c.gameName||'').trim();
    if(!game){
      if(isGameplayConversation(c,data.messages))game='更多玩法';
      else if(isCompanion)game='陪玩咨询';
      else game='咨询';
    }
    var orderShort=shortOrderNo(c.orderNo||order.orderNo);
    var meta=orderShort?(game+' · '+orderShort):game;
    var kind=conversationStatusKind(c);
    var locked=isLockedByOther(c);
    var tagText=kind==='ended'?'⚪ 已结束':(kind==='active'?(locked?'🟠 对接中':'🟢 接待中'):'🟡 待接待');
    var preview=String(c.lastMessage||'暂无消息').replace(/\s+/g,' ').trim();
    var unread=Number(c.unread||c.unreadCount||0)||0;
    var unreadText=unread>99?'99+':String(unread);
    var time=listTimeLabel(c.lastTime||c.updatedAt||c.createdAt);
    var ownerLine=kind==='active'
      ?('<div class="cs-conv-row" style="font-size:11px;opacity:.8;margin-top:2px">负责：'+esc(c.assignedCsName||c.currentServiceName||'-')+(c.assignedAt||c.acceptedAt?(' · '+esc(listTimeLabel(c.assignedAt||c.acceptedAt))):'')+'</div>')
      :'';
    return '<button type="button" class="cs-conversation'+(active&&active.id===c.id?' active':'')+' is-'+kind+(locked?' is-locked':'')+'" data-conversation="'+esc(c.id)+'">'+
      '<div class="cs-conv-row cs-conv-row-top">'+
        '<strong class="cs-conv-name">'+esc(role+' · '+nick)+'</strong>'+
        (time?'<time class="cs-conv-time">'+esc(time)+'</time>':'')+
      '</div>'+
      '<div class="cs-conv-row cs-conv-row-mid">'+
        '<span class="cs-conv-meta">'+esc(meta)+'</span>'+
        '<span class="cs-conv-tag '+kind+'">'+esc(tagText)+'</span>'+
      '</div>'+
      ownerLine+
      '<div class="cs-conv-row cs-conv-row-bot">'+
        '<span class="cs-conv-preview">'+esc(preview)+'</span>'+
        (unread?'<b class="cs-conv-unread">'+esc(unreadText)+'</b>':'')+
      '</div>'+
      '</button>';
  }
  function conversationsHtml(){
    var data=state.data||{};
    var counts=filterCounts();
    var list=filteredConversations();
    var active=(data.conversations||[]).find(function(c){return c.id===state.activeConversation})||null;
    var msgs=(data.messages||[]).filter(function(m){return active&&m.conversationId===active.id});
    var order=(data.orders||[]).find(function(o){return active&&o.id===active.orderId});
    var activeProduct=null;
    msgs.forEach(function(m){if(m.messageType==='product_card')activeProduct=parseProductCard(m.content)||activeProduct;});
    var myId=myServiceId();
    var takenByOther=isLockedByOther(active);
    var takenByMe=isMineConv(active);
    var canReply=composerCanReply(active);
    var blockReason=composerBlockReason(active);
    var isClosed=isClosedConv(active);
    var lockedActive=takenByOther;
    var takeBtn=active?(isClosed
      ?'<button class="cs-btn" type="button" disabled>会话已结束</button>'+(active.orderId?'<button class="cs-btn" type="button" data-after-sales="'+esc(active.orderId)+'">创建售后会话</button>':'')
      :takenByOther
      ?'<button class="cs-btn" type="button" disabled>只读 · '+esc(active.assignedCsName||active.currentServiceName||'其他客服')+'</button>'+(isAdminSession()?'<button class="cs-btn primary" type="button" data-admin-takeover="'+esc(active.id)+'">管理员接管</button>':'')
      :(takenByMe
        ?'<button class="cs-btn" type="button" data-transfer-cs="'+esc(active.id)+'">转交客服</button><button class="cs-btn danger" type="button" data-end="'+esc(active.id)+'">结束对话</button>'
        :(!active.currentServiceId
          ?'<button class="cs-btn primary" type="button" data-take="'+esc(active.id)+'"'+(state.acceptingId===active.id?' disabled data-taking="1"':'')+'>'+(state.acceptingId===active.id?'接待中…':'开始接待')+'</button>'
          :''))):'';
    var bossLabel=active?((active.conversationType==='companion_support'||(!active.bossId&&active.companionId))?'':publicBossCode(active)):'';
    var activeTitle=active
      ? ((active.conversationType==='companion_support'||(!active.bossId&&active.companionId))
        ? ('陪玩 · '+(String(active.bossName||'').replace(/^陪玩\s*·\s*/,'')||'陪玩'))
        : sanitizeBossLabel(active.bossName,bossLabel))
      : '';
    var listOpen=!!state.showConversationList;
    var composerHtml=(active&&!isClosed)
      ?('<div class="cs-chat-composer" data-cs-composer-wrap>'+
        (lockedActive?lockPanelHtml(active):'')+
        '<p class="cs-composer-hint" data-cs-composer-hint'+(canReply?' hidden':'')+'>'+esc(canReply?'':blockReason)+'</p>'+
        '<form class="cs-chat-input" data-send-message action="#" method="post" autocomplete="off" onsubmit="return false;">'+
        '<div class="mcj-composer-tools">'+
        '<button class="mcj-composer-tool" type="button" data-cs-emoji'+(canReply?'':' disabled')+' aria-label="表情">😊</button>'+
        '<button class="mcj-composer-tool" type="button" data-cs-image'+(canReply?'':' disabled')+' aria-label="图片">🖼</button>'+
        '</div>'+
        '<textarea name="content" data-cs-composer rows="1" placeholder="'+esc(canReply?'输入消息，Enter 发送，Shift+Enter 换行':(blockReason||'无法回复'))+'" autocomplete="off" maxlength="2000"'+(canReply?'':' disabled readonly')+'></textarea>'+
        '<button class="cs-btn primary cs-send-btn" type="button" data-cs-send'+(canReply&&String(state.composerDraft||'').trim()?'':' disabled')+'>发送</button>'+
        '</form>'+
        '<div class="mcj-upload-status" data-cs-upload-status></div></div>')
      :'';
    var listHtml='<aside class="cs-chat-list'+(listOpen?' is-open':'')+'" data-cs-chat-list>'+
      '<div class="cs-chat-list-head"><strong>会话列表</strong><div class="cs-actions">'+
      '<button class="cs-btn" type="button" data-refresh>刷新</button>'+
      '<button class="cs-btn cs-list-close" type="button" data-close-conv-list>关闭</button>'+
      '</div></div>'+
      companionContactBarHtml()+
      '<div class="cs-conv-tabs" role="tablist">'+
      '<button type="button" class="cs-conv-tab'+(state.convFilter==='waiting'?' active':'')+'" data-conv-filter="waiting">待接待 <em>'+counts.waiting+'</em></button>'+
      '<button type="button" class="cs-conv-tab'+(state.convFilter==='active'?' active':'')+'" data-conv-filter="active">接待中 <em>'+counts.active+'</em></button>'+
      '<button type="button" class="cs-conv-tab'+(state.convFilter==='ended'?' active':'')+'" data-conv-filter="ended">已结束 <em>'+counts.ended+'</em></button>'+
      '</div>'+
      '<div data-cs-virt-body>'+virtualListHtml(list,active,data,state.listScrollTop||0,560)+'</div>'+
      '</aside>';
    var orderPanel=order
      ?('<div class="cs-info-list">'+
        '<div><span>订单编号</span><strong title="'+esc(order.orderNo||'')+'">'+esc(order.orderNo)+'</strong></div>'+
        '<div><span>付款状态</span><strong>'+esc(paymentStatusLabel(order))+'</strong></div>'+
        '<div><span>指定陪玩</span><strong>'+esc(order.companionName||'-')+'</strong></div>'+
        '<div><span>陪玩确认</span><strong>'+esc(companionAcceptLabel(order))+'</strong></div>'+
        '<div><span>确认时间</span><strong>'+esc(order.acceptedAt?fmtChatTime(order.acceptedAt):'-')+'</strong></div>'+
        '<div><span>拒绝原因</span><strong>'+esc((/无法接单[：:]?\s*(.+)/.exec(String(order.cancelReason||order.note||''))||[])[1]||'-')+'</strong></div>'+
        '<div><span>当前处理人</span><strong>'+esc(active&&active.currentServiceName?active.currentServiceName:'待接待')+'</strong></div>'+
        '<div><span>游戏</span><strong>'+esc(order.game||'-')+'</strong></div>'+
        '<div><span>金额</span><strong>'+money(order.totalAmount)+'</strong></div>'+
        '<div><span>订单状态</span><strong>'+esc(order.statusText||'-')+'</strong></div>'+
        (order.needsReassign?'<div><span>待处理</span><strong style="color:#ff6b7a">需要重新安排</strong></div>':'')+
        '</div><button class="cs-btn" type="button" data-route="/customer-service/orders">查看订单</button>')
      :(!activeProduct?'<div class="cs-empty">暂无关联订单</div>':'');
    return '<div class="cs-chat-layout'+(listOpen?' list-open':'')+'">'+
      (listOpen?'<div class="cs-chat-list-backdrop" data-close-conv-list></div>':'')+
      listHtml+
      '<section class="cs-chat-main">'+
      (active
        ?('<header class="cs-chat-head">'+
          '<div class="cs-chat-head-main">'+
          '<button class="cs-btn cs-back-list" type="button" data-open-conv-list>会话列表</button>'+
          '<div><h2>'+esc(activeTitle||'老板')+'</h2>'+
          '<p>'+(bossLabel?'编号 '+esc(bossLabel)+' · ':'')+(active.orderNo?'订单 '+esc(active.orderNo)+' · ':'')+esc(isClosed?'已结束':(active.currentServiceId?(active.currentServiceName||'接待中'):'待接待'))+'</p></div></div>'+
          takeBtn+
          '</header>'+
          '<div class="cs-chat-messages">'+(lockedActive?lockPanelHtml(active):'')+(msgs.length?msgs.map(messageHtml).join(''):'<div class="cs-empty">暂无消息</div>')+'</div>'+
          composerHtml)
        :'<div class="cs-empty cs-pick-session">请从左侧选择会话<button class="cs-btn primary" style="margin-top:12px" type="button" data-open-conv-list>打开会话列表</button></div>')+
      '</section>'+
      '<aside class="cs-chat-side"><h3>订单 / 商品资料</h3>'+(activeProduct?productCardHtml(activeProduct):'')+orderPanel+'</aside></div>';
  }
  function messageHtml(m){
    var when=fmtChatTime(m.createdAt||m.created_at);
    var senderRole=String(m.senderRole||m.sender_role||'').toLowerCase();
    var senderId=String(m.senderId||m.sender_id||'').trim();
    var system=senderRole==='system'||m.messageType==='system'||m.message_type==='system';
    var mine=!system&&(senderRole==='customer_service'||senderRole==='service'||senderId===myServiceId());
    if(m.messageType==='product_card'||m.message_type==='product_card'){
      var card=parseProductCard(m.content);
      if(card)return '<div class="cs-msg '+(mine?'mine':'')+'">'+productCardHtml(card)+'<small>'+esc(when)+'</small></div>';
    }
    if(m.messageType==='companion_card'||m.message_type==='companion_card'||(String(m.content||'').trim().charAt(0)==='{'&&/companionId|companion_card/.test(String(m.content||'')))){
      try{
        var cc=typeof m.content==='string'?JSON.parse(m.content):m.content;
        if(cc&&(cc.type==='companion_card'||cc.companionId)){
          return '<div class="cs-msg '+(mine?'mine':'')+'"><div class="cs-product-card" style="display:flex;gap:10px"><img src="'+esc(cc.avatarUrl||'')+'" alt="" style="width:52px;height:52px;border-radius:12px;object-fit:cover" onerror="this.style.display=\'none\'"><div><strong>'+esc(cc.nickname||'陪玩')+'</strong><p style="margin:4px 0;font-size:12px">ID '+esc(cc.companionCode||cc.companionId||'-')+' · '+esc(cc.level||'-')+' · '+esc(cc.game||'-')+' · '+money(cc.unitPrice||0)+'</p><p style="margin:0;font-size:12px">标签：'+esc(cc.tags||'-')+'</p><a class="cs-btn" href="'+esc(cc.detailUrl||'#')+'" target="_blank" rel="noopener">查看详情</a></div></div><small>'+esc(when)+'</small></div>';
        }
      }catch(e){}
    }
    var who=mine?(m.senderName||m.sender_name||'客服'):(system?'':(m.senderName||m.sender_name||(senderRole==='boss'?'老板':(senderRole==='companion'?'陪玩':''))));
    var Media=window.MCJChatMedia;
    var isImg=Media&&Media.isImageMessage(m);
    var body=isImg?Media.imageBubbleHtml(Media.imageUrlOf(m),esc):('<p>'+esc(m.content||'')+'</p>');
    var isImgPending=(m.messageType==='image'||m.message_type==='image');
    var pending=m._pending?(isImgPending?' · 上传中…':' · 发送中…'):'';
    var failed=m._failed?' · 发送失败 <button type="button" class="cs-link" data-retry-img="'+esc(m._localId||m.id||'')+'">重试</button>':'';
    return '<div class="cs-msg '+(mine?'mine':'')+(system?' system':'')+(m._failed?' failed':'')+'" data-msg-id="'+esc(m.id||m._localId||'')+'">'+(who?'<strong>'+esc(who)+'</strong>':'')+body+'<small>'+esc(when)+pending+failed+'</small></div>';
  }
  function ordersHtml(){
    var rows=((state.data&&state.data.orders)||[]).slice().filter(function(o){return !state.orderFilter||o.status===state.orderFilter});
    rows.sort(function(a,b){
      return String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||''));
    });
    var statuses=(state.data&&state.data.orderStatuses)||{};
    return '<div class="cs-page-head"><div><h2>订单处理</h2><p>确认付款、指派陪玩、处理退款，所有操作写入真实订单表。</p></div><div class="cs-actions"><button class="cs-btn primary" data-route="/customer-service/create-order">客服代下单</button></div></div><div class="cs-toolbar"><select data-order-filter><option value="">全部状态</option>'+Object.keys(statuses).map(function(k){return '<option value="'+esc(k)+'" '+(state.orderFilter===k?'selected':'')+'>'+esc(statuses[k])+'</option>'}).join('')+'</select><button class="cs-btn" data-refresh>刷新</button></div><section class="cs-table-wrap"><table class="cs-table"><thead><tr><th>订单编号</th><th>老板</th><th>陪玩</th><th>游戏</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>'+(rows.length?rows.map(orderRow).join(''):'<tr><td colspan="8"><div class="cs-empty">暂无订单</div></td></tr>')+'</tbody></table></section>';
  }
  function compensationHtml(){var bosses=(state.data&&state.data.bosses)||[],orders=(state.data&&state.data.orders)||[];return '<div class="cs-page-head"><div><h2>申请补偿</h2><p>客服只能提交申请，管理员审核通过后才会入账赠送猫粮。</p></div></div><form class="cs-card cs-form" data-compensation-form><label>老板 UID / 选择老板<select name="boss_id" required><option value="">请选择老板</option>'+bosses.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.bossUid||b.uid||'')+' / '+esc(b.name)+'</option>'}).join('')+'</select></label><label>或输入老板 UID<input name="boss_uid" placeholder="MCJ00001"></label><label>关联订单<select name="related_order_id"><option value="">可选</option>'+orders.map(function(o){return '<option value="'+esc(o.id)+'">'+esc(o.orderNo)+' / '+esc(o.bossName)+'</option>'}).join('')+'</select></label><label>类型<select name="request_type"><option value="bad_review">差评安抚</option><option value="after_sale">售后补偿</option><option value="activity">活动奖励</option><option value="other">其他</option></select></label><label>建议补偿猫粮<input name="suggested_amount" type="number" min="1" required></label><label>差评或投诉原因<textarea name="reason" required></textarea></label><label>客服说明<textarea name="staff_note"></textarea></label><button class="cs-btn primary" type="submit">提交申请</button></form>'}
  function orderRow(o){
    var actions=[];
    var isPublicHall=(!o.companionId)&&((String(o.assignmentType||'').toLowerCase()==='public')||!o.assignmentType||o.orderType==='open_grab'||o.status==='pending'||o.status==='waiting_boss_confirm');
    var proofBlock=(o.paymentReview&&o.paymentProofUrl&&!/^proof:/i.test(String(o.paymentProofUrl||'')))?('<div class="cs-proof-preview" style="margin:6px 0"><button type="button" class="cs-btn" data-proof-lightbox="'+esc(o.paymentProofUrl)+'" style="padding:0;border:0;background:transparent;cursor:zoom-in" title="查看付款截图大图"><img src="'+esc(o.paymentProofUrl)+'" alt="付款凭证" style="max-width:120px;max-height:120px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,.15);display:block"></button><div style="margin-top:4px"><button type="button" class="cs-btn" data-proof-lightbox="'+esc(o.paymentProofUrl)+'">查看大图</button></div></div>'):'';
    if(o.status==='awaiting_payment'){
      if(o.paymentReview){
        if(o.companionId){
          actions.push('<button class="cs-btn primary" data-confirm-payment="'+esc(o.id)+'">确认收款并通知陪玩</button>');
        }else{
          actions.push('<button class="cs-btn primary" data-confirm-payment="'+esc(o.id)+'" data-send-hall="1">确认收款并派单</button>');
        }
        actions.push('<button class="cs-btn" data-reject-payment-proof="'+esc(o.id)+'">驳回付款</button>');
      }else if(!o.companionId){
        actions.push('<button class="cs-btn primary" data-confirm-payment="'+esc(o.id)+'" data-send-hall="1">发送到抢单大厅</button>');
      }else{
        actions.push('<button class="cs-btn" data-confirm-payment="'+esc(o.id)+'">确认已付款</button>');
      }
    }
    var bossLocked=!!(o.companionId&&(o.status==='claimed'||o.status==='confirmed'||o.status==='in_progress'));
    var inGrabHall=isPublicHall&&(o.status==='pending'||o.status==='waiting_boss_confirm')&&!o.companionId;
    if(o.status==='claimed'){
      actions.push('<button class="cs-btn" data-status-order="'+esc(o.id)+'">查看订单</button>');
      if(o.needsReassign)actions.push('<button class="cs-btn primary" data-assign-order="'+esc(o.id)+'">重新指定陪玩</button>');
      actions.push('<button class="cs-btn" data-refund-order="'+esc(o.id)+'">取消订单</button>');
    }else if(inGrabHall){
      actions.push('<button class="cs-btn" data-view-grabs="'+esc(o.id)+'">查看抢单人('+(o.grabCount||0)+')</button>');
      actions.push('<button class="cs-btn" data-assign-order="'+esc(o.id)+'">指定陪玩</button>');
      actions.push('<button class="cs-btn" data-cancel-grab-hall="'+esc(o.id)+'">取消抢单</button>');
    }else{
      if(o.needsReassign&&!bossLocked)actions.push('<button class="cs-btn primary" data-assign-order="'+esc(o.id)+'">更换陪玩</button>');
      else if(!bossLocked&&(o.status==='pending'||o.status==='awaiting_payment'||o.status==='waiting_boss_confirm'))actions.push('<button class="cs-btn" data-assign-order="'+esc(o.id)+'">指定陪玩</button>');
      else if(bossLocked)actions.push('<span class="cs-note">负责人陪玩已锁定</span>');
      if((o.grabCount||0)>0||o.status==='waiting_boss_confirm'||o.status==='pending')actions.push('<button class="cs-btn" data-view-grabs="'+esc(o.id)+'">查看抢单人('+(o.grabCount||0)+')</button>');
    }
    if(o.status==='in_progress')actions.push('<button class="cs-btn primary" data-complete-order="'+esc(o.id)+'">结单</button>');
    if(o.status!=='claimed'&&!inGrabHall)actions.push('<button class="cs-btn" data-status-order="'+esc(o.id)+'">改状态</button>');
    actions.push('<button class="cs-btn" data-route="/customer-service/compensation" type="button">申请补偿</button>');
    if((o.status==='refund_requested'||o.needsReassign)&&o.status!=='claimed')actions.push('<button class="cs-btn" data-refund-order="'+esc(o.id)+'">'+(o.needsReassign?'发起退款':'处理退款')+'</button>');
    var orderConv=((state.data&&state.data.conversations)||[]).find(function(c){return c.orderId===o.id&&!isClosedConv(c);});
    if(orderConv&&isLockedByOther(orderConv)){
      actions=['<span class="cs-note">该订单正在由【'+esc(orderConv.assignedCsName||orderConv.currentServiceName||'其他客服')+'】处理中，当前仅可查看。</span>'];
      if((o.grabCount||0)>0||o.status==='waiting_boss_confirm'||o.status==='pending')actions.push('<button class="cs-btn" data-view-grabs="'+esc(o.id)+'">查看抢单人('+(o.grabCount||0)+')</button>');
    }
    var statusLabel=o.paymentReview?'待审核':o.statusText;
    var statusCell=esc(statusLabel)+(o.needsReassign?'<br><small style="color:#f59e0b">'+(esc(o.reassignHint||'待重新安排'))+'</small>':'')+(o.acceptedAt&&o.status==='confirmed'?'<br><small>确认：'+esc(o.acceptedAt)+'</small>':'')+(inGrabHall||o.status==='pending'||o.status==='waiting_boss_confirm'?'<br><small>抢单 '+(o.grabCount||0)+' 人</small>':'')+(o.preferredCompanionId?'<br><small style="color:#60a5fa">老板意向已提交</small>':'')+proofBlock;
    return '<tr'+(o.needsReassign?' style="background:rgba(245,158,11,.08)"':'')+(inGrabHall?' data-grab-hall="1"':'')+'><td>'+esc(o.orderNo)+'</td><td>'+esc(sanitizeBossLabel(o.bossName,publicBossCode(o)))+(publicBossCode(o)?'<br><small>'+esc(publicBossCode(o))+'</small>':'')+'</td><td>'+esc(o.companionName)+'</td><td>'+esc(o.game||'-')+'</td><td>'+money(o.totalAmount)+'</td><td>'+statusCell+'</td><td>'+esc(o.createdAt||'-')+'</td><td><div class="cs-actions">'+actions.join('')+'</div></td></tr>';
  }
  function createOrderHtml(){
    var bosses=(state.data&&state.data.bosses)||[];
    var companions=(state.data&&state.data.companions)||[];
    var services=(state.services||[]).filter(function(s){return s.allowOrder!==false});
    var errs=state.createOrderErrors||{};
    var bossesErr=errs.bosses||'';
    var companionsErr=errs.companions||'';
    var servicesErr=errs.services||state.servicesError||'';
    var draft=null;
    try{draft=JSON.parse(sessionStorage.getItem('mcjGameplayOrderDraft')||'null');}catch(e){draft=null;}
    var bossesTip=bossesErr
      ?('<div class="cs-empty" data-create-order-bosses-err>'+esc(bossesErr)+'</div>')
      :(!bosses.length?'<div class="cs-empty" data-create-order-bosses-empty>暂无老板账号，可手动输入老板 UID。</div>':'');
    var companionsTip=companionsErr
      ?('<div class="cs-empty" data-create-order-companions-err>'+esc(companionsErr)+'</div>')
      :(!companions.length?'<div class="cs-empty" data-create-order-companions-empty>暂无陪玩数据。</div>':'');
    var serviceField;
    if(services.length){
      serviceField='<label>服务<select name="game" required><option value="">请选择服务</option>'+(draft&&draft.name?'<option value="'+esc(draft.name)+'" selected>'+esc(draft.name)+' / 更多玩法</option>':'')+services.map(function(s){var price=s.defaultPrice||s.default_price||'';var label=(s.icon?s.icon+' ':'')+(s.name||'')+(price?' · '+price:'')+' / '+(s.category||'-');return '<option value="'+esc(s.name)+'">'+esc(label)+'</option>'}).join('')+'</select></label>';
    }else if(state.servicesSource==='missing_table'||/services\.sql|表未初始化/i.test(servicesErr||'')){
      serviceField='<label>服务<select name="game" disabled><option value="">暂不可用</option></select></label><div class="cs-empty" data-create-order-services-err>'+esc(servicesErr||'services 表未初始化。请在 Supabase SQL Editor 执行 supabase/services.sql。')+'</div>'+(draft&&draft.name?'<input type="hidden" name="game" value="'+esc(draft.name)+'">':'');
    }else{
      serviceField='<label>服务<select name="game" '+(draft&&draft.name?'':'disabled')+'><option value="">'+(servicesErr||'暂无服务配置')+'</option>'+(draft&&draft.name?'<option value="'+esc(draft.name)+'" selected>'+esc(draft.name)+' / 更多玩法</option>':'')+'</select></label><div class="cs-empty" data-create-order-services-empty>'+esc(servicesErr||'暂无服务配置')+'</div>';
    }
    return '<div class="cs-page-head"><div><h2>客服代下单</h2><p>客服根据老板需求代为创建订单。可通过老板 UID 识别账号。</p></div></div><form class="cs-card cs-form" data-order-form><label>选择老板<select name="boss_id"><option value="">请选择老板</option>'+bosses.map(function(b){return '<option value="'+esc(b.id)+'" '+(draft&&draft.bossId===b.id?'selected':'')+'>'+esc(b.bossUid||b.uid||'')+' / '+esc(b.name)+'</option>'}).join('')+'</select></label>'+bossesTip+'<label>或输入老板 UID<input name="boss_uid" placeholder="例如 MCJ00001" value=""></label><label>发布方式<select name="companion_id"><option value="">A · 发布到抢单大厅（公开抢单）</option>'+companions.map(function(p){return '<option value="'+esc(p.id)+'">B · 指定陪玩：'+esc(p.name)+' / '+esc((p.companionCode||p.publicId||(p.companionUid?('PW'+String(p.companionUid).padStart(5,'0')):''))||p.id)+' / '+esc(p.game||'-')+' / '+money(p.price)+'</option>'}).join('')+'</select></label>'+companionsTip+serviceField+'<label>订单类型<input name="order_type" value="'+(draft?'gameplay_mall':'customer_service')+'"></label><label>需求说明<textarea name="description" required>'+(draft?('更多玩法商品：'+(draft.name||'')+'（ID：'+(draft.productId||'')+'）\n计价：'+(draft.unit||'')+'\n数量：\n时长：\n游戏区服：\n开始时间：\n备注：'):'')+'</textarea></label><label>时长<input name="hours" type="number" min="1" value="1" required></label><label>单价 RM<input name="unit_price" type="number" min="0" value="'+esc(draft&&draft.price||'')+'" required></label><label>总金额 RM<input name="total_amount" type="number" min="1" value="'+esc(draft&&draft.price||'')+'" required></label><button class="cs-btn primary" type="submit">创建订单</button></form>';
  }
  function reportsHtml(){var work=(state.data&&state.data.workData)||{},salary=work.salary||{},cur=salary.current||{},history=salary.history||[],attRows=(work.attendance&&work.attendance.rows)||[],notices=(state.data&&state.data.notifications)||[],payrolls=(state.data&&state.data.payrolls)||[],settlements=(state.data&&state.data.commissionSettlements)||work.commissionSettlements||[],sum=(state.data&&state.data.summary)||{},cfg=work.config||{},withdrawable=sum.withdrawableSalary!=null?sum.withdrawableSalary:(cur.totalSalary||0);var noticeBlock=notices.length?'<section class="cs-card" style="margin-bottom:14px"><h3 style="margin:0 0 8px">工资通知</h3>'+notices.slice(0,8).map(function(n){return '<div style="padding:8px 0;border-bottom:1px solid #eee"><strong>'+esc(n.title||'通知')+'</strong><div style="color:#9ca3af;font-size:12px;margin-top:4px">'+esc(n.body||'')+'</div><div style="color:#6b7280;font-size:11px;margin-top:4px">'+esc(n.at||'')+'</div></div>'}).join('')+'</section>':'';var withdrawBlock='<section class="cs-card" style="margin-bottom:14px"><h3 style="margin:0 0 8px">每周五统一结算</h3><p style="margin:0 0 10px;color:#6b7280;font-size:13px">'+esc(((state.data&&state.data.weeklySettlement)||{}).csBannerBody||'周四 23:59 前 → 本周五；截止后 → 下周五。金额系统自动计算，不可手填。')+'</p><div class="cs-info-list"><div><span>本周可结算工资</span><strong>'+money(((state.data&&state.data.payrollSummary)||{}).settleableAmount!=null?state.data.payrollSummary.settleableAmount:withdrawable)+'</strong></div><div><span>已申请金额</span><strong>'+money(((state.data&&state.data.payrollSummary)||{}).appliedAmount||0)+'</strong></div><div><span>待周五发放金额</span><strong>'+money(((state.data&&state.data.payrollSummary)||{}).pendingFridayAmount||0)+'</strong></div><div><span>预计发放日期</span><strong>'+esc((((state.data&&state.data.weeklySettlement)||{}).nextSettlementDate||((state.data&&state.data.payrollSummary)||{}).nextSettlementDate||'-'))+( ((state.data&&state.data.weeklySettlement)||{}).nextSettlementDate?'（星期五）':'')+'</strong></div><div><span>可申请金额</span><strong>'+money(withdrawable)+'</strong></div></div><div class="cs-actions" style="margin-top:12px"><button class="cs-btn primary" type="button" data-request-salary-withdraw '+(Number(withdrawable)<=0?'disabled':'')+'>申请本周结算（'+money(withdrawable)+'）</button></div></section>';var rewardBlock='<section class="cs-table-wrap" style="margin-top:14px"><h3 style="margin:0 0 10px">奖励记录</h3><table class="cs-table"><thead><tr><th>订单号</th><th>奖励类型</th><th>固定奖励</th><th>提成</th><th>夜班补贴</th><th>全勤奖励</th><th>退款扣回</th><th>最终金额</th><th>状态</th></tr></thead><tbody>'+(settlements.length?settlements.map(function(r){return '<tr><td>'+esc(r.orderNo||'-')+'</td><td>'+esc(r.rewardType||'order_commission')+'</td><td>'+money(r.fixedRewardRm||0)+'</td><td>'+money(r.percentCommissionRm||0)+'</td><td>'+money(r.nightShiftRm||0)+'</td><td>'+money(r.attendanceBonusRm||0)+'</td><td>'+money(r.clawbackRm||0)+'</td><td>'+money(r.finalAmountRm||0)+'</td><td>'+esc(r.status||'-')+'</td></tr>'}).join(''):'<tr><td colspan="9">暂无奖励记录（完成订单后按后台佣金设置自动入账）</td></tr>')+'</tbody></table></section>';var payrollBlock='<section class="cs-table-wrap" style="margin-top:14px"><h3 style="margin:0 0 10px">历史结算记录</h3><table class="cs-table"><thead><tr><th>单号</th><th>周期</th><th>底薪</th><th>奖金</th><th>扣款</th><th>应发</th><th>预计发放</th><th>状态</th><th></th></tr></thead><tbody>'+(payrolls.length?payrolls.map(function(p){return '<tr><td>'+esc(p.payrollNo||'-')+'</td><td>'+esc((p.periodStart||'')+' ~ '+(p.periodEnd||''))+'</td><td>'+money(p.baseSalaryRm||0)+'</td><td>'+money(p.bonusRm||0)+'</td><td>'+money(p.deductionRm||0)+'</td><td>'+money(p.netSalaryRm||0)+'</td><td>'+esc(p.settlementDate||'-')+'</td><td>'+esc(p.statusText||p.status||'-')+'</td><td>'+(p.status!=='completed'?'<button class="cs-btn ghost" type="button" data-payroll-appeal="'+esc(p.id)+'">申诉</button>':'-')+'</td></tr>'}).join(''):'<tr><td colspan="9">暂无发放记录</td></tr>')+'</tbody></table></section>';return '<div class="cs-page-head"><div><h2>工资中心</h2><p>底薪/全勤/夜班/每单奖励/提成等全部实时读取后台佣金设置；订单提成按结算快照入账，改配置不影响历史单。</p></div></div>'+noticeBlock+withdrawBlock+'<section class="cs-grid cs-metrics">'+metric('基础工资',money(cur.baseSalary||0))+metric('全勤奖励',money(cur.attendanceBonus||0))+metric('接待奖励',money(cur.receptionBonus||0))+metric('订单提成',money(cur.orderCommission||0))+metric('夜班补贴',money(cur.nightShiftAllowance||0))+metric('迟到扣款',money(cur.lateDeduction||0))+metric('缺勤扣款',money(cur.absenceDeduction||0))+metric('其他调整',money(cur.otherAdjustment||0))+metric('本月预计工资',money(cur.totalSalary||0))+metric('工资状态',cur.status||'统计中')+'</section><section class="cs-table-wrap" style="margin-top:14px"><h3 style="margin:0 0 10px">本月打卡（工资计算依据）</h3><table class="cs-table"><thead><tr><th>日期</th><th>上班</th><th>下班</th><th>工时</th><th>迟到</th><th>缺勤</th><th>状态</th></tr></thead><tbody>'+(attRows.length?attRows.map(function(r){return '<tr><td>'+esc(r.reportDate||r.date||'-')+'</td><td>'+esc(r.clockInText||'-')+'</td><td>'+esc(r.clockOutText||'-')+'</td><td>'+esc(r.workHours!=null?r.workHours:'-')+'</td><td>'+esc(r.isLate?'是':'否')+'</td><td>'+esc(r.isAbsent?'是':'否')+'</td><td>'+esc(r.attendanceStatus||'-')+'</td></tr>'}).join(''):'<tr><td colspan="7">暂无打卡记录</td></tr>')+'</tbody></table></section>'+rewardBlock+payrollBlock+'<section class="cs-table-wrap" style="margin-top:14px"><table class="cs-table"><thead><tr><th>月份</th><th>基础工资</th><th>全勤奖励</th><th>接待奖励</th><th>订单提成</th><th>扣款合计</th><th>预计工资</th><th>状态</th></tr></thead><tbody>'+(history.length?history.map(function(r){var deductions=(Number(r.lateDeduction||0)+Number(r.absenceDeduction||0)+Number(r.earlyLeaveDeduction||0));return '<tr><td>'+esc(r.salaryMonth||'-')+'</td><td>'+money(r.baseSalary||0)+'</td><td>'+money(r.attendanceBonus||0)+'</td><td>'+money(r.receptionBonus||0)+'</td><td>'+money(r.orderCommission||0)+'</td><td>'+money(deductions)+'</td><td>'+money(r.totalSalary||0)+'</td><td>'+esc(r.status||'统计中')+'</td></tr>'}).join(''):'<tr><td colspan="8">暂无工资记录</td></tr>')+'</tbody></table></section>'}
  function reportStatus(s){return ({pending:'待审核',approved:'已批准',rejected:'已拒绝',paid:'已支付',completed:'已发放'})[s]||s||'-'}
  function profileHtml(){var s=(state.data&&state.data.staff)||state.session.user||{},work=(state.data&&state.data.workData)||{},cfg=work.config||{},att=work.attendance||{},sum=(state.data&&state.data.summary)||{},csName=String(s.name||s.displayName||'').trim()||'客服',avatar='<div class="cs-avatar" style="width:64px;height:64px;display:grid;place-items:center">'+esc(csName.slice(0,1))+'</div>';return '<section class="cs-card"><h2>我的资料</h2><div class="cs-user-card">'+avatar+'<div><strong>'+esc(csName)+'</strong><div style="color:#9ca3af;margin-top:4px">'+esc(cfg.shiftName||'默认班次')+'</div></div></div><div class="cs-info-list"><div><span>当前班次</span><strong>'+esc((cfg.shiftStart||'09:00')+' - '+(cfg.shiftEnd||'18:00'))+'</strong></div><div><span>入职日期</span><strong>'+esc(cfg.joinDate||'-')+'</strong></div><div><span>在线状态</span><strong>'+esc(sum.currentReceptions>0?'接待中':'在线')+'</strong></div><div><span>今日打卡状态</span><strong>'+esc((work.todayAttendance&&work.todayAttendance.attendanceStatus)||'未打卡')+'</strong></div><div><span>本月出勤</span><strong>'+esc((att.actualDays||0)+' / '+(att.standardDays||0))+'</strong></div><div><span>本月预计工资</span><strong>'+money(sum.estimatedSalary||0)+'</strong></div><div><span>历史工资记录</span><strong>'+esc((work.salary&&work.salary.history&&work.salary.history.length)||0)+' 条</strong></div></div></section>'}
  function sendChatImage(url){
    if(!url||!state.activeConversation)return Promise.resolve();
    var conv=activeConversation();
    if(!composerCanReply(conv)){
      toast(composerBlockReason(conv)||'当前无法发送消息');
      return Promise.resolve();
    }
    var localId='local-img-'+Date.now();
    var optimistic={
      id:localId,_localId:localId,_pending:true,
      conversationId:state.activeConversation,
      senderId:myServiceId()||'',
      senderRole:'customer_service',senderName:myServiceName()||'客服',
      messageType:'image',content:url,createdAt:new Date().toISOString()
    };
    if(!state.data)state.data=emptyDashboardData();
    if(!state.data.messages)state.data.messages=[];
    state.data.messages.push(optimistic);
    var box=root.querySelector('.cs-chat-messages');
    if(box){
      var empty=box.querySelector('.cs-empty');
      if(empty)empty.remove();
      box.insertAdjacentHTML('beforeend',messageHtml(optimistic));
      try{box.scrollTop=box.scrollHeight;}catch(e){}
    }
    return api('send_message',{conversation_id:state.activeConversation,content:url,message_type:'image'}).then(function(res){
      if(res&&res.messageRow){
        state.data.messages=(state.data.messages||[]).filter(function(m){return m.id!==localId&&m._localId!==localId;});
        if(!state.data.messages.some(function(m){return m.id===res.messageRow.id;})){
          state.data.messages.push(Object.assign({},res.messageRow,{conversationId:res.messageRow.conversationId||state.activeConversation}));
        }
        if(box){
          var old=box.querySelector('[data-msg-id="'+localId+'"]');
          if(old)old.outerHTML=messageHtml(res.messageRow);
        }
      }
      return softRefresh();
    }).catch(function(err){
      state.data.messages=(state.data.messages||[]).map(function(m){
        if(m.id!==localId&&m._localId!==localId)return m;
        return Object.assign({},m,{_pending:false,_failed:true});
      });
      if(box){
        var old=box.querySelector('[data-msg-id="'+localId+'"]');
        if(old)old.outerHTML=messageHtml(Object.assign({},optimistic,{_pending:false,_failed:true}));
      }
      toast(err.message||'图片发送失败');
    });
  }
  function sendChatMessage(){
    if(state.sendingChat)return;
    var conv=activeConversation();
    if(!composerCanReply(conv)){
      toast(composerBlockReason(conv)||'当前无法发送消息');
      syncComposerEnabled();
      return;
    }
    var input=root.querySelector(COMPOSER_SEL);
    var content=String((input&&input.value)||state.composerDraft||'');
    // Keep exact draft for failure restore; only trim for empty check / API.
    var trimmed=content.trim();
    if(!trimmed||!state.activeConversation)return;
    var cid=state.activeConversation;
    var localId='local-txt-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
    var optimistic={
      id:localId,_localId:localId,_pending:true,
      conversationId:cid,
      senderId:myServiceId()||'',
      senderRole:'customer_service',senderName:myServiceName()||'客服',
      messageType:'text',content:trimmed,createdAt:new Date().toISOString()
    };
    state.sendingChat=true;
    state.composerDraft='';
    if(state.composerDrafts)state.composerDrafts[cid]='';
    state.composerFocused=true;
    if(input){
      input.value='';
      try{input.style.height='';}catch(e){}
    }
    if(!state.data)state.data=emptyDashboardData();
    if(!state.data.messages)state.data.messages=[];
    state.data.messages.push(optimistic);
    var list=state.data.conversations||[];
    var cIdx=list.findIndex(function(c){return c.id===cid});
    if(cIdx>=0){
      list[cIdx]=Object.assign({},list[cIdx],{
        lastMessage:trimmed,
        lastTime:optimistic.createdAt,
        updatedAt:optimistic.createdAt,
        unread:0,unreadCount:0
      });
    }
    var box=root.querySelector('.cs-chat-messages');
    if(box){
      var empty=box.querySelector('.cs-empty');
      if(empty)empty.remove();
      box.insertAdjacentHTML('beforeend',messageHtml(optimistic));
      try{box.scrollTop=box.scrollHeight;}catch(e){}
    }else if(root.querySelector('.cs-chat-layout')){
      patchConversationMessages();
    }
    syncComposerEnabled();
    var safety=setTimeout(function(){state.sendingChat=false;syncComposerEnabled();},12000);
    api('send_message',{conversation_id:cid,content:trimmed}).then(function(res){
      if(res&&res.messageRow){
        var server=res.messageRow;
        if(!server.conversationId)server.conversationId=cid;
        state.data.messages=(state.data.messages||[]).filter(function(m){return m.id!==localId&&m._localId!==localId;});
        if(!state.data.messages.some(function(m){return m.id===server.id;})){
          state.data.messages.push(server);
        }
        if(box){
          var old=box.querySelector('[data-msg-id="'+localId+'"]');
          if(old)old.outerHTML=messageHtml(server);
        }
      }else{
        // No row returned — drop pending flag; softRefresh/realtime will reconcile.
        state.data.messages=(state.data.messages||[]).map(function(m){
          if(m.id!==localId&&m._localId!==localId)return m;
          return Object.assign({},m,{_pending:false});
        });
        if(box){
          var node=box.querySelector('[data-msg-id="'+localId+'"]');
          if(node)node.outerHTML=messageHtml(Object.assign({},optimistic,{_pending:false}));
        }
      }
      return softRefresh();
    }).catch(function(err){
      state.data.messages=(state.data.messages||[]).map(function(m){
        if(m.id!==localId&&m._localId!==localId)return m;
        return Object.assign({},m,{_pending:false,_failed:true});
      });
      if(box){
        var failedNode=box.querySelector('[data-msg-id="'+localId+'"]');
        if(failedNode)failedNode.outerHTML=messageHtml(Object.assign({},optimistic,{_pending:false,_failed:true}));
      }
      // Keep original text on failure; do not remount composer.
      state.composerDraft=content;
      if(!state.composerDrafts)state.composerDrafts={};
      state.composerDrafts[cid]=content;
      var input2=root.querySelector(COMPOSER_SEL);
      if(input2){
        input2.value=content;
        try{
          input2.focus({preventScroll:true});
          var len=content.length;
          input2.setSelectionRange(len,len);
        }catch(e){}
      }
      toast(err.message||'发送失败');
    }).finally(function(){
      clearTimeout(safety);
      state.sendingChat=false;
      syncComposerEnabled();
    });
  }
  document.addEventListener('input',function(e){
    if(!e.target||!e.target.closest)return;
    if(e.target.closest('form[data-login]'))captureLoginDraft();
    if(e.target.matches&&e.target.matches(COMPOSER_SEL)){
      state.composerDraft=String(e.target.value||'');
      if(state.activeConversation){
        if(!state.composerDrafts)state.composerDrafts={};
        state.composerDrafts[state.activeConversation]=state.composerDraft;
      }
      state.composerFocused=true;
      autoResizeComposer(e.target);
      syncComposerEnabled();
      syncKeyboardInset();
    }
    if(e.target.matches&&e.target.matches('[data-cs-companion-search]')){
      renderCompanionResults(e.target);
    }
  },true);
  document.addEventListener('focusin',function(e){
    if(e.target&&e.target.matches&&e.target.matches(COMPOSER_SEL)){
      state.composerFocused=true;
    }
  },true);
  document.addEventListener('focusout',function(e){
    if(e.target&&e.target.matches&&e.target.matches(COMPOSER_SEL)){
      state.composerDraft=String(e.target.value||'');
      if(state.activeConversation){
        if(!state.composerDrafts)state.composerDrafts={};
        state.composerDrafts[state.activeConversation]=state.composerDraft;
      }
      // Keep sticky focus flag during poll windows; only clear if focus left the composer wrap.
      setTimeout(function(){
        var ae=document.activeElement;
        if(!(ae&&ae.matches&&ae.matches(COMPOSER_SEL)))state.composerFocused=false;
      },0);
    }
  },true);
  document.addEventListener('change',function(e){
    if(!e.target||!e.target.matches)return;
    if(e.target.closest&&e.target.closest('form[data-login]'))captureLoginDraft();
    if(e.target.matches('[data-order-filter]')){state.orderFilter=e.target.value;paint()}
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter')return;
    if(e.isComposing||e.keyCode===229)return;
    if(e.target&&e.target.matches&&e.target.matches('[data-cs-companion-search]')){
      e.preventDefault();
      var q=String(e.target.value||'').trim();
      if(!q)return;
      var items=filterCompanions(q);
      openCompanionChat(items.length===1?items[0].id:q);
      return;
    }
    var input=e.target&&e.target.closest&&e.target.closest(COMPOSER_SEL);
    if(!input)return;
    // Shift+Enter = newline (textarea default); Enter alone = send.
    if(e.shiftKey)return;
    e.preventDefault();
    e.stopPropagation();
    sendChatMessage();
  },true);
  document.addEventListener('submit',function(e){
    if(e.target.matches('[data-send-message]')){
      e.preventDefault();
      e.stopPropagation();
      sendChatMessage();
      return;
    }
    if(e.target.matches('[data-login]')){e.preventDefault();var form=e.target;var fd=new FormData(form);var btn=form.querySelector('[type="submit"]');var remember=!!fd.get('remember');captureLoginDraft();state.loginError='';state.loginBusy=true;updateLoginChrome();if(Auth&&Auth.setFormError)Auth.setFormError(form,'');else{var box=form.querySelector('[data-auth-error]');if(box)box.textContent='';}if(Auth&&Auth.setLoading)Auth.setLoading(btn,true);else if(btn){btn.disabled=true;btn.textContent='登录中…';}api('login',{account:String(fd.get('account')||'').trim(),password:String(fd.get('password')||''),remember:remember}).then(function(res){saveSession(res.session,true);state.loginBusy=false;state.loginError='';state.loginDraft={account:'',password:'',remember:false};location.assign('/customer-service/dashboard/');}).catch(function(err){state.loginBusy=false;state.loginError=err.message||'账号或密码错误。';updateLoginChrome();if(Auth&&Auth.setLoading)Auth.setLoading(btn,false,'登录');else if(btn){btn.disabled=false;btn.textContent='登录';}if(Auth&&Auth.setFormError)Auth.setFormError(form,state.loginError);else{var errBox=form.querySelector('[data-auth-error]');if(errBox)errBox.textContent=state.loginError;else toast(state.loginError);}restoreLoginDraft();});return}if(e.target.matches('[data-order-form]')){e.preventDefault();var fd2=new FormData(e.target),order={};fd2.forEach(function(v,k){order[k]=String(v||'')});var bossId=String(order.boss_id||'').trim();var bossUid=String(order.boss_uid||'').trim();var companionId=String(order.companion_id||'').trim();if(!bossId&&!bossUid){toast('请选择老板或输入老板 UID');return;}order.boss_id=bossId||bossUid;order.boss_uid=bossUid||'';order.companion_id=companionId||null;if(!companionId){order.send_to_hall=true;order.order_type=order.order_type||'open_grab';}api('create_order',{order:order}).then(function(res){toast(res.message||(res.sentToGrabHall?'已发送至抢单大厅。':'订单已创建'));go('/customer-service/orders');return softRefresh()}).catch(function(err){toast(err.message||'创建订单失败')});return}if(e.target.matches('[data-compensation-form]')){e.preventDefault();var cf=new FormData(e.target),payload={};cf.forEach(function(v,k){payload[k]=String(v||'')});if(payload.boss_uid&&payload.boss_uid.trim())payload.boss_id=payload.boss_uid.trim();api('apply_compensation',payload).then(function(res){toast(res.message||'补偿申请已提交');go('/customer-service/orders');return softRefresh()}).catch(function(err){toast(err.message)});return}if(e.target.matches('[data-report-form]')){e.preventDefault();toast('客服不能自行填写应付工资，请使用工资记录申诉');return}
  });
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-clock-in]')){
      e.preventDefault();
      runClock('clock_in');
      return;
    }
    if(e.target.closest('[data-clock-out]')){
      e.preventDefault();
      runClock('clock_out');
      return;
    }
    if(e.target.closest('[data-cs-send]')){
      e.preventDefault();
      e.stopPropagation();
      sendChatMessage();
      return;
    }
    if(e.target.closest('[data-cs-emoji]')){
      e.preventDefault();
      var input=root.querySelector(COMPOSER_SEL);
      if(!input||input.disabled)return;
      var emojis=['😊','😂','👍','❤️','🙏','🔥','✨','😺','👌','🎉'];
      var pick=emojis[Math.floor(Math.random()*emojis.length)];
      // Simple panel: cycle insert common emoji via prompt-less - open small fixed set
      var panel=root.querySelector('[data-cs-emoji-panel]');
      if(!panel){
        panel=document.createElement('div');
        panel.setAttribute('data-cs-emoji-panel','1');
        panel.className='support-emoji-panel';
        panel.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:8px 0';
        panel.innerHTML=emojis.map(function(em){return '<button type="button" data-cs-pick-emoji="'+em+'">'+em+'</button>'}).join('');
        var wrap=root.querySelector('[data-cs-composer-wrap]');
        if(wrap)wrap.insertBefore(panel,wrap.querySelector('form'));
      }else{
        panel.hidden=!panel.hidden;
      }
      return;
    }
    var pickEm=e.target.closest('[data-cs-pick-emoji]');
    if(pickEm){
      e.preventDefault();
      var input2=root.querySelector(COMPOSER_SEL);
      if(!input2||input2.disabled)return;
      input2.value=String(input2.value||'')+pickEm.getAttribute('data-cs-pick-emoji');
      state.composerDraft=input2.value;
      syncComposerEnabled();
      input2.focus();
      return;
    }
    if(e.target.closest('[data-cs-image]')){
      e.preventDefault();
      var conv=activeConversation();
      if(!composerCanReply(conv)){toast(composerBlockReason(conv)||'当前无法发送图片');return}
      var Media=window.MCJChatMedia;
      if(!Media){toast('图片组件未加载');return}
      var token=(state.session&&state.session.token)||'';
      var statusEl=root.querySelector('[data-cs-upload-status]');
      Media.pickAndSendImages({
        token:token,
        multiple:true,
        onStatus:function(t){if(statusEl)statusEl.textContent=t||'';},
        onError:function(err){toast((err&&err.message)||'发送失败');},
        onUploaded:function(url){return sendChatImage(url);}
      }).then(function(){if(statusEl)setTimeout(function(){statusEl.textContent='';},1500);});
      return;
    }
    var retryImg=e.target.closest('[data-retry-img]');
    if(retryImg){
      e.preventDefault();
      var id=retryImg.getAttribute('data-retry-img');
      var node=root.querySelector('[data-msg-id="'+id+'"]');
      var url='';
      if(node){
        var a=node.querySelector('[data-chat-image]');
        url=a?a.getAttribute('data-chat-image'):'';
      }
      if(url)sendChatImage(url);
      return;
    }
    var filterBtn=e.target.closest('[data-conv-filter]');
    if(filterBtn){
      e.preventDefault();
      state.convFilter=filterBtn.getAttribute('data-conv-filter')||'active';
      if(state.route==='conversations'){
        if(root.querySelector('.cs-chat-layout')&&patchConversationMessages()){/* ok */}
        else paint();
      }
      return;
    }
    // Only real nav controls — never #serviceApp[data-route] (that mapped every chat click to 工作台).
    var r=e.target.closest('a[data-route], button[data-route]');
    if(r&&r!==root&&!r.closest('form[data-send-message], form[data-login]')){
    e.preventDefault();
    e.stopPropagation();
    var fill=r.getAttribute('data-gp-fill');
    if(fill!=null){
      try{sessionStorage.setItem('mcjGameplayOrderDraft',JSON.stringify({productId:fill,name:r.getAttribute('data-gp-name')||'',price:r.getAttribute('data-gp-price')||'',unit:r.getAttribute('data-gp-unit')||'',bossId:r.getAttribute('data-gp-boss')||''}));}catch(err){}
    }
    var targetPath=r.getAttribute('data-route');
    if(!targetPath||targetPath==='/'||targetPath==='/customer-service'||targetPath==='/customer-service/')return;
    setTimeout(function(){ go(targetPath); }, 0);
    return;
  }var appealBtn=e.target.closest('[data-payroll-appeal]');if(appealBtn){var reason=prompt('请填写工资异议申诉原因');if(!reason)return;api('appeal_payroll',{payrollId:appealBtn.dataset.payrollAppeal,reason:reason}).then(function(res){toast(res.message||'申诉已提交');return softRefresh()}).catch(function(err){toast(err.message)});return}
  var wdBtn=e.target.closest('[data-request-salary-withdraw]');if(wdBtn){if(wdBtn.disabled)return;if(!confirm('确认按系统计算金额申请本周结算？金额不可修改，将进入待周五结算。'))return;wdBtn.disabled=true;api('request_salary_withdraw',{}).then(function(res){toast(res.message||('已申请 '+money(res.amount||0)+'，预计发放 '+(res.settlementDate||'')));return softRefresh()}).catch(function(err){toast(err.message||'申请失败');wdBtn.disabled=false});return}
  var logoutCancel=e.target.closest('[data-logout-cancel]');
  if(logoutCancel){
    var cancelModal=logoutCancel.closest('.cs-modal');
    if(cancelModal)cancelModal.remove();
    state.logoutConfirmOpen=false;
    return;
  }
  var logoutConfirm=e.target.closest('[data-logout-confirm]');
  if(logoutConfirm){
    if(state.logoutBusy)return;
    state.logoutBusy=true;
    logoutConfirm.disabled=true;
    clearSession();
    if(window.MCJRoleGate&&window.MCJRoleGate.logout)window.MCJRoleGate.logout('customer_service');
    location.replace('/customer-service/login/');
    return;
  }
  if(e.target.closest('[data-logout]')){
    if(state.logoutConfirmOpen||document.querySelector('[data-logout-confirm-modal]'))return;
    state.logoutConfirmOpen=true;
    document.body.insertAdjacentHTML('beforeend',
      '<div class="cs-modal" data-logout-confirm-modal role="dialog" aria-modal="true" aria-labelledby="csLogoutTitle">'+
      '<div class="cs-dialog cs-form" style="max-width:360px;width:min(92vw,360px)">'+
      '<h3 id="csLogoutTitle" style="margin:0 0 8px;font-size:18px">确定退出登录？</h3>'+
      '<p style="margin:0 0 18px;color:var(--muted);line-height:1.55">退出后需要重新登录客服工作台。</p>'+
      '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">'+
      '<button type="button" class="cs-btn" data-logout-cancel>取消</button>'+
      '<button type="button" class="cs-btn primary" data-logout-confirm>确认退出</button>'+
      '</div></div></div>');
    return;
  }
  if(e.target.closest('[data-refresh]')){hardRefresh();return}
  var attPageBtn=e.target.closest('[data-att-page]');
  if(attPageBtn){
    e.preventDefault();
    if(attPageBtn.disabled)return;
    var dir=attPageBtn.getAttribute('data-att-page');
    var total=monthAttendanceRows().length;
    var maxPage=Math.max(0,Math.ceil(total/ATT_PAGE_SIZE)-1);
    if(dir==='prev')state.attPage=Math.max(0,(Number(state.attPage)||0)-1);
    else if(dir==='next')state.attPage=Math.min(maxPage,(Number(state.attPage)||0)+1);
    if(state.route==='dashboard')paint();
    return;
  }
  if(e.target.closest('[data-open-conv-list]')){state.showConversationList=true;if(state.route==='conversations')paint();return}
  if(e.target.closest('[data-close-conv-list]')){state.showConversationList=false;if(state.route==='conversations')paint();return}
  if(e.target.closest('[data-cs-new-chat]')){e.preventDefault();openNewChatModal();return}
  var startCompanionBtn=e.target.closest('[data-start-companion]');
  if(startCompanionBtn){
    e.preventDefault();
    openCompanionChat(startCompanionBtn.getAttribute('data-start-companion'));
    return;
  }
  var c=e.target.closest('[data-conversation]');if(c){e.preventDefault();e.stopPropagation();var cid=c.dataset.conversation;setTimeout(function(){
      var prev=state.activeConversation;
      if(prev&&prev!==cid){
        saveComposerDraftFor(prev);
        var pending=String((state.composerDrafts&&state.composerDrafts[prev])||state.composerDraft||'').trim();
        if(pending&&!confirm('当前会话有未发送内容，切换后将为你保留草稿。确定切换？'))return;
      }
      state.suppressAutoSelect=false;
      state.activeConversation=cid;
      state.showConversationList=false;
      state.route='conversations';
      // Switch filter tab to match selected conversation bucket.
      var picked=((state.data&&state.data.conversations)||[]).find(function(x){return x.id===cid});
      if(picked)state.convFilter=convBucket(picked);
      if(picked&&!isLockedByOther(picked))clearUnreadLocally(cid);
      loadComposerDraftFor(cid);
      paint();
      markConversationRead(cid);
      loadActiveConversationMessages(cid).then(function(){bindRealtime(cid);});
    },0);return}var take=e.target.closest('[data-take]');if(take){e.preventDefault();e.stopPropagation();
      if(take.disabled||take.getAttribute('data-taking')==='1')return;
      var cid=String(take.getAttribute('data-take')||take.dataset.take||'').trim();
      if(!cid){toast('会话无效');return;}
      take.setAttribute('data-taking','1');
      take.disabled=true;
      take.textContent='接待中…';
      acceptConversation(cid).then(function(){
        // Button DOM may have been replaced; sync via patch/paint.
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
        else if(state.route==='conversations')paint();
        syncComposerEnabled();
      }).catch(function(err){
        take.disabled=false;
        take.removeAttribute('data-taking');
        take.textContent='开始接待';
        toast(err&&err.message?err.message:'接待失败');
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
      });
      return;
    }var endTake=e.target.closest('[data-end]');if(endTake){e.preventDefault();if(!confirm('确认结束本次对话吗？结束后会话只读，聊天记录保留。'))return;
      var endId=String(endTake.dataset.end||'').trim();
      api('end_conversation',{id:endId,conversation_id:endId}).then(function(res){
        var rewardMsg=(res.reward&&res.reward.message)||'';
        var msg=rewardMsg||res.message||'已结束对话';
        if(!rewardMsg&&/奖励已到账|已结算.*猫粮/i.test(String(res.message||''))){
          msg='本次仅为咨询，未产生有效订单，不结算猫粮。';
        }
        toast(msg);
        applyEndedLocally(endId);
        state.acceptLock=null;
        state.activeConversation='';
        state.suppressAutoSelect=true;
        state.convFilter='ended';
        state.showConversationList=true;
        state.composerDraft='';
        state.route='conversations';
        paint();
        syncPoolCounters();
      }).catch(function(err){toast(err.message||'结束对话失败')});return}
    var transferBtn=e.target.closest('[data-transfer-cs]');
    if(transferBtn){e.preventDefault();openTransferModal(String(transferBtn.dataset.transferCs||'').trim());return;}
    var adminTake=e.target.closest('[data-admin-takeover]');
    if(adminTake){
      e.preventDefault();
      var aid=String(adminTake.dataset.adminTakeover||'').trim();
      if(!aid)return;
      if(!confirm('确认强制接管该订单会话？原负责客服将立即失去输入和操作权限。'))return;
      adminTake.disabled=true;
      api('admin_takeover',{id:aid,conversation_id:aid}).then(function(res){
        toast(res.message||'已接管');
        return softRefresh().then(function(){state.activeConversation=aid;state.convFilter='active';paint();});
      }).catch(function(err){adminTake.disabled=false;toast(err.message||'接管失败');});
      return;
    }
    var afterSales=e.target.closest('[data-after-sales]');
    if(afterSales){
      e.preventDefault();
      var oid=String(afterSales.dataset.afterSales||'').trim();
      if(!oid)return;
      if(!confirm('确认创建独立售后会话？将生成新会话并重新指定负责客服。'))return;
      afterSales.disabled=true;
      api('create_after_sales_conversation',{order_id:oid}).then(function(res){
        toast(res.message||'已创建售后会话');
        var nid=res.conversationId||(res.conversation&&res.conversation.id)||'';
        return softRefresh().then(function(){if(nid){state.activeConversation=nid;state.convFilter='active';}paint();});
      }).catch(function(err){afterSales.disabled=false;toast(err.message||'创建失败');});
      return;
    }
    var doTransfer=e.target.closest('[data-do-transfer]');
    if(doTransfer){
      e.preventDefault();
      var convId=String(doTransfer.dataset.doTransfer||'').trim();
      var sel=document.querySelector('[data-transfer-target]');
      var target=String((sel&&sel.value)||'').trim();
      if(!target){toast('请选择目标客服');return;}
      if(!confirm('确认转交？转交后你将立即变为只读，目标客服获得操作权限。'))return;
      doTransfer.disabled=true;
      api('transfer_to_cs',{id:convId,conversation_id:convId,target_cs_id:target}).then(function(res){
        toast(res.message||'转交成功');
        var modalEl=doTransfer.closest('.cs-modal');if(modalEl)modalEl.remove();
        return softRefresh();
      }).catch(function(err){doTransfer.disabled=false;toast(err.message||'转交失败');});
      return;
    }
    var proofLight=e.target.closest('[data-proof-lightbox]');if(proofLight){var pUrl=proofLight.getAttribute('data-proof-lightbox')||'';if(pUrl){var oldLb=document.getElementById('csProofLightbox');if(oldLb)oldLb.remove();var lb=document.createElement('div');lb.id='csProofLightbox';lb.className='cs-modal';lb.innerHTML='<div class="cs-dialog" style="max-width:min(96vw,920px);padding:12px;text-align:center"><img src="'+esc(pUrl)+'" alt="付款截图大图" style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:12px"><div style="margin-top:10px"><button class="cs-btn" type="button" data-close-modal>关闭</button></div></div>';document.body.appendChild(lb);}return;}var pay=e.target.closest('[data-confirm-payment]');if(pay){
      var sendHall=pay.getAttribute('data-send-hall')==='1';
      var payId=pay.dataset.confirmPayment||'';
      if(pay.disabled)return;
      pay.disabled=true;
      var oldPayText=pay.textContent;
      pay.textContent='处理中…';
      api(sendHall?'push_to_grab_hall':'confirm_payment',{id:payId}).then(function(res){
        var msg=res.message||(sendHall?'订单已发布到抢单大厅':'已确认付款');
        toast(msg);
        if(res.order&&state.data&&Array.isArray(state.data.orders)){
          var idx=state.data.orders.findIndex(function(o){return o.id===payId});
          if(idx>=0)state.data.orders[idx]=Object.assign({},state.data.orders[idx],res.order,{
            status:res.order.status||state.data.orders[idx].status,
            statusText:res.order.statusText||state.data.orders[idx].statusText,
            grabCount:res.order.grabCount!=null?res.order.grabCount:state.data.orders[idx].grabCount||0,
            paymentReview:false
          });
          paint();
        }
        return softRefresh().then(function(){
          if(res.sentToGrabHall||res.path==='grab_hall'){
            state.orderFilter='pending';
            state.route='/customer-service/orders';
            try{history.replaceState({},'', '/customer-service/orders/?focus='+encodeURIComponent(payId));}catch(err){}
            paint();
            var row=document.querySelector('tr[data-grab-hall="1"] td')||document.querySelector('[data-view-grabs="'+payId+'"]');
            if(row&&row.scrollIntoView)row.scrollIntoView({behavior:'smooth',block:'center'});
          }
        });
      }).catch(function(err){
        pay.disabled=false;
        pay.textContent=oldPayText||'确认收款并派单';
        toast(err.message||'确认付款失败');
      });
      return;
    }var rejectProof=e.target.closest('[data-reject-payment-proof]');if(rejectProof){var reason=String(prompt('请输入驳回付款原因')||'').trim();if(!reason){toast('驳回必须填写原因');return;}api('reject_payment_proof',{id:rejectProof.dataset.rejectPaymentProof,reason:reason}).then(function(res){toast(res.message||'已驳回付款凭证');return softRefresh()}).catch(function(err){toast(err.message)});return}var completeOrder=e.target.closest('[data-complete-order]');if(completeOrder){if(!confirm('确认将该订单标记为已完成？'))return;completeOrder.disabled=true;completeOrder.textContent='结单中…';api('update_order_status',{id:completeOrder.dataset.completeOrder,status:'completed'}).then(function(res){toast(res.message||'订单已结单');return softRefresh()}).catch(function(err){completeOrder.disabled=false;completeOrder.textContent='结单';toast(err.message||'结单失败')});return}var cancelHall=e.target.closest('[data-cancel-grab-hall]');if(cancelHall){if(!confirm('确认取消该订单的抢单发布？订单将关闭。'))return;var cid=cancelHall.dataset.cancelGrabHall;cancelHall.disabled=true;api('cancel_grab_hall',{id:cid,reason:'客服取消抢单'}).then(function(res){toast(res.message||'已取消抢单');return softRefresh()}).catch(function(err){cancelHall.disabled=false;toast(err.message||'取消失败')});return}var viewGrabs=e.target.closest('[data-view-grabs]');if(viewGrabs){openGrabList(viewGrabs.dataset.viewGrabs);return}var assign=e.target.closest('[data-assign-order]');if(assign){openAssign(assign.dataset.assignOrder);return}var st=e.target.closest('[data-status-order]');if(st){openStatus(st.dataset.statusOrder);return}var refund=e.target.closest('[data-refund-order]');if(refund){openRefund(refund.dataset.refundOrder);return}var close=e.target.closest('[data-close-modal]');if(close){close.closest('.cs-modal').remove();return}});
  function modal(html, dialogClass){
    var cls=String(dialogClass||'cs-form').trim()||'cs-form';
    document.body.insertAdjacentHTML('beforeend','<div class="cs-modal"><div class="cs-dialog '+cls+'">'+html+'</div></div>');
  }
  function openTransferModal(conversationId){
    var id=String(conversationId||'').trim();
    if(!id)return;
    modal('<div class="cs-dialog-head"><h3>转交客服</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div>'+
      '<p class="cs-note">转交后仅目标客服可回复与操作；聊天记录完整保留。</p>'+
      '<label>目标客服<select data-transfer-target><option value="">加载中…</option></select></label>'+
      '<button class="cs-btn primary" type="button" data-do-transfer="'+esc(id)+'" disabled>确认转交</button>');
    api('list_cs_staff',{}).then(function(res){
      var sel=document.querySelector('[data-transfer-target]');
      var btn=document.querySelector('[data-do-transfer="'+id+'"]');
      if(!sel)return;
      var me=myServiceId();
      var staff=(res.staff||[]).filter(function(s){return s.id&&s.id!==me;});
      if(!staff.length){
        sel.innerHTML='<option value="">暂无其他可转交客服</option>';
        return;
      }
      sel.innerHTML='<option value="">请选择客服</option>'+staff.map(function(s){
        return '<option value="'+esc(s.id)+'">'+esc(s.name)+(s.email?(' / '+s.email):'')+'</option>';
      }).join('');
      if(btn)btn.disabled=false;
    }).catch(function(err){
      toast(err.message||'加载客服列表失败');
    });
  }
  function openAssign(id, opts){
    opts=opts||{};
    var order=((state.data&&state.data.orders)||[]).find(function(o){return o.id===id})||{};
    var grabs=order.grabs||[];
    var intent=order.bossIntent||null;
    function grabCard(g){
      var c=g.companion||{};
      var preferred=!!(g.bossPreferred||(intent&&intent.companionId===g.companionId));
      return '<article class="cs-grab-card" style="border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin:8px 0">'+
        '<div style="display:flex;gap:10px;align-items:flex-start">'+
        (c.avatarUrl||c.cardImageUrl?'<img src="'+esc(c.avatarUrl||c.cardImageUrl)+'" alt="" style="width:52px;height:52px;border-radius:12px;object-fit:cover">':'<div style="width:52px;height:52px;border-radius:12px;background:#333;display:grid;place-items:center">'+(esc((c.nickname||'?').slice(0,1)))+'</div>')+
        '<div style="flex:1;min-width:0"><strong>'+esc(c.nickname||'陪玩')+(preferred?' · <span style="color:#60a5fa">老板意向</span>':'')+'</strong>'+
        '<p style="margin:4px 0;font-size:12px;opacity:.85">ID '+esc(c.companionUid||c.id||'-')+' · '+esc(c.level||'-')+' · '+esc(c.mainGame||c.game||'-')+'</p>'+
        '<p style="margin:0;font-size:12px;opacity:.85">单价 '+money(c.price||0)+' · 评分 '+esc(c.rating||'-')+' · 接单 '+esc(c.completedOrders||0)+' · '+esc(c.onlineStatusLabel||c.onlineStatus||'-')+'</p>'+
        (window.MCJCompanionIdentity&&window.MCJCompanionIdentity.renderTags
          ? window.MCJCompanionIdentity.renderTags({
              levelId:c.levelId||'',
              levelLabel:c.level||'',
              gender:c.gender||'',
              voiceType:c.voiceType||c.voice_type||'',
              certTags:c.certTags||[],
              tags:c.tags||'',
              includeLevel:false,
              includeGender:true,
              serviceLimit:4,
              className:'cs-id-tags'
            })
          : '<p style="margin:4px 0 0;font-size:12px">标签：'+esc(c.tags||'-')+'</p>')+
        (c.voiceUrl?'<p style="margin:4px 0 0"><a href="'+esc(c.voiceUrl)+'" target="_blank" rel="noopener">试听录音</a></p>':'')+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'+
        '<a class="cs-btn" href="'+esc(c.detailUrl||('/profile.html?player='+encodeURIComponent(c.id||'')))+'" target="_blank" rel="noopener">查看详情</a>'+
        '<button class="cs-btn primary" type="button" data-confirm-assign="'+esc(id)+'" data-companion-id="'+esc(g.companionId||c.id||'')+'">指定此陪玩</button>'+
        '<button class="cs-btn" type="button" data-push-to-boss="'+esc(id)+'" data-companion-id="'+esc(g.companionId||c.id||'')+'">推送给老板</button>'+
        '</div></div></div></article>';
    }
    var grabBlock=grabs.length
      ?('<div><h4 style="margin:0 0 8px">已抢单陪玩（'+grabs.length+'）</h4><p class="cs-note">可从抢单人中指定；指定后订单离开抢单大厅，进入待陪玩确认。</p>'+grabs.map(grabCard).join('')+'</div>')
      :'<p class="cs-composer-hint">暂无抢单记录。可先刷新，或从下方全量列表指定（开放抢单订单建议只从抢单人中选）。</p>';
    var cs=(state.data&&state.data.companions)||[];
    var optsList=cs.length?cs.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+(p.companionCode||p.publicId?(' / '+(p.companionCode||p.publicId)):'')+' / '+esc(p.game||'-')+'</option>'}).join(''):'<option value="">暂无陪玩，请手动输入 UID</option>';
    modal('<div class="cs-dialog-head"><h3>指定陪玩</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div>'+
      (intent?'<p class="cs-composer-hint">老板意向：'+esc(intent.companionName||intent.companionId)+'</p>':'')+
      grabBlock+
      '<hr style="border:0;border-top:1px solid rgba(255,255,255,.1);margin:14px 0">'+
      '<label>其他陪玩（非抢单大厅路径）<select data-assign-companion>'+optsList+'</select></label>'+
      '<label>或输入陪玩 UID / UUID<input data-assign-companion-uid placeholder="例如 PW00001 或 UUID"></label>'+
      '<p class="cs-composer-hint" data-assign-hint style="min-height:18px"></p>'+
      '<button class="cs-btn primary" type="button" data-do-assign="'+esc(id)+'">保存</button>');
    if(!grabs.length && !opts.skipFetch){
      api('list_grabs',{id:id}).then(function(res){
        order.grabs=res.grabs||[];
        order.grabCount=(res.grabs||[]).length;
        order.bossIntent=res.bossIntent||null;
        var idx=((state.data&&state.data.orders)||[]).findIndex(function(o){return o.id===id});
        if(idx>=0)state.data.orders[idx]=Object.assign({},state.data.orders[idx],order);
        var existing=document.querySelector('.cs-modal');if(existing)existing.remove();
        openAssign(id,{skipFetch:true});
      }).catch(function(){});
    }
  }
  function openGrabList(id){
    api('list_grabs',{id:id}).then(function(res){
      var grabs=res.grabs||[];
      var intent=res.bossIntent||null;
      var html=grabs.length?grabs.map(function(g){
        var c=g.companion||{};
        var avatar=c.avatarUrl||c.cardImageUrl
          ?('<img src="'+esc(c.avatarUrl||c.cardImageUrl)+'" style="width:48px;height:48px;border-radius:10px;object-fit:cover" alt="">')
          :('<div style="width:48px;height:48px;border-radius:10px;background:#333;display:grid;place-items:center">'+esc((c.nickname||'?').slice(0,1))+'</div>');
        return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">'+
          avatar+
          '<div style="flex:1;min-width:0"><strong>'+esc(c.nickname||'陪玩')+(g.bossPreferred?' · 老板意向':'')+'</strong>'+
          '<p style="margin:4px 0;font-size:12px">ID '+esc(c.companionUid||c.id||'-')+' · '+esc(c.level||'-')+' · 音色 '+esc(c.voiceType||c.voice_type||'-')+'</p>'+
          '<p style="margin:0;font-size:12px">'+esc(c.mainGame||c.game||'-')+' · 单价 '+money(c.price||0)+' · '+esc(c.onlineStatusLabel||c.onlineStatus||'-')+'</p>'+
          '<p style="margin:4px 0 0;font-size:12px">标签：'+esc(c.tags||'-')+'</p>'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'+
          '<a class="cs-btn" href="'+esc(c.detailUrl||('/profile.html?player='+encodeURIComponent(c.id||'')))+'" target="_blank" rel="noopener">资料详情</a>'+
          '<button class="cs-btn primary" type="button" data-confirm-assign="'+esc(id)+'" data-companion-id="'+esc(g.companionId||c.id||'')+'">指定此陪玩</button>'+
          '<button class="cs-btn" type="button" data-push-to-boss="'+esc(id)+'" data-companion-id="'+esc(g.companionId||c.id||'')+'">推送给老板</button>'+
          '</div></div></div>';
      }).join(''):'<p>暂无抢单人</p>';
      modal('<div class="cs-dialog-head"><h3>抢单人列表</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div>'+(intent?'<p>老板意向：'+esc(intent.companionName||intent.companionId)+'</p>':'')+'<p class="cs-note">可查看抢单人资料并指定；指定后订单离开抢单大厅。</p>'+html);
    }).catch(function(err){toast(err.message||'加载失败')});
  }
  function openStatus(id){
    var order=((state.data&&state.data.orders)||[]).find(function(o){return o.id===id})||{};
    var box=document.createElement('div');
    modal('<div class="cs-dialog-head"><h3>修改订单状态</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div><p>当前：'+esc(order.statusText||order.status||'-')+'</p><label>下一步状态<select data-next-status><option value="">加载中…</option></select></label><button class="cs-btn primary" type="button" data-do-status="'+esc(id)+'" disabled>保存</button>');
    api('allowed_order_statuses',{id:id}).then(function(res){
      var sel=document.querySelector('[data-next-status]');
      var btn=document.querySelector('[data-do-status="'+id+'"]');
      if(!sel)return;
      var options=res.options||{};
      var keys=Object.keys(options);
      if(!keys.length){
        sel.innerHTML='<option value="">当前无可选下一步（请用专用按钮推进）</option>';
        if(btn)btn.disabled=true;
        return;
      }
      sel.innerHTML=keys.map(function(k){return '<option value="'+esc(k)+'">'+esc(options[k])+'</option>'}).join('');
      if(btn)btn.disabled=false;
    }).catch(function(err){
      toast(err.message||'加载允许状态失败');
      var sel=document.querySelector('[data-next-status]');
      if(sel)sel.innerHTML='<option value="">加载失败</option>';
    });
  }
  function openRefund(id){modal('<div class="cs-dialog-head"><h3>处理退款（周五打款）</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div><p style="margin:0 0 10px;color:#6b7280;font-size:13px">批准后进入周五退款队列，不会即时到老板钱包。后台打款完成并上传凭证后才到账。</p><label>处理结果<select data-refund-decision><option value="approve">建议批准（入周五队列）</option><option value="reject">拒绝退款</option></select></label><label>拒绝后恢复状态<select data-restore-status><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label><label>备注<textarea data-refund-note required></textarea></label><button class="cs-btn primary" type="button" data-do-refund="'+esc(id)+'">保存</button>')}
  document.addEventListener('click',function(e){
    var pushBoss=e.target.closest('[data-push-to-boss]');
    if(pushBoss){
      var oid=pushBoss.getAttribute('data-push-to-boss')||'';
      var cid=pushBoss.getAttribute('data-companion-id')||'';
      if(!oid||!cid)return;
      pushBoss.disabled=true;
      var prev=pushBoss.textContent;
      pushBoss.textContent='推送中…';
      api('push_companion_to_boss',{id:oid,companion_id:cid}).then(function(res){
        toast(res.message||'已推送陪玩名片给老板。');
        pushBoss.disabled=false;
        pushBoss.textContent=prev||'推送给老板';
      }).catch(function(err){
        pushBoss.disabled=false;
        pushBoss.textContent=prev||'推送给老板';
        toast(err.message||'推送失败');
      });
      return;
    }
    var confirmAssign=e.target.closest('[data-confirm-assign]');
    if(confirmAssign){
      var orderId=confirmAssign.dataset.confirmAssign;
      var companionId=confirmAssign.dataset.companionId;
      if(!orderId||!companionId){toast('缺少订单或陪玩');return;}
      if(!confirm('确定指定该抢单陪玩？\n\n指定后订单离开抢单大厅，进入待陪玩确认；其他陪玩将无法再抢。'))return;
      confirmAssign.disabled=true;
      confirmAssign.textContent='指定中…';
      api('confirm_grab_assignment',{id:orderId,companion_id:companionId,from_grabs:true}).then(function(res){
        toast(res.message||'指定成功，订单已进入待陪玩确认');
        var modalEl=confirmAssign.closest('.cs-modal');if(modalEl)modalEl.remove();
        return softRefresh();
      }).catch(function(err){
        confirmAssign.disabled=false;
        confirmAssign.textContent='指定此陪玩';
        toast(err.message||'指定失败');
      });
      return;
    }
    var a=e.target.closest('[data-do-assign]');if(a){
    if(state.assignBusy||a.disabled)return;
    var uidInput=document.querySelector('[data-assign-companion-uid]');
    var sel=document.querySelector('[data-assign-companion]');
    var val=String((uidInput&&uidInput.value)||'').trim()||String((sel&&sel.value)||'').trim();
    var hint=document.querySelector('[data-assign-hint]');
    if(!val){if(hint)hint.textContent='请选择或输入陪玩';toast('请选择或输入陪玩');return;}
    if(!confirm('确定指定该陪玩？\n\n指定后，其他抢单陪玩将无法再接此订单。'))return;
    state.assignBusy=true;a.disabled=true;a.textContent='保存中…';if(hint)hint.textContent='正在指定陪玩…';
    var order=((state.data&&state.data.orders)||[]).find(function(o){return o.id===a.dataset.doAssign})||{};
    var grabs=order.grabs||[];
    var fromGrabs=grabs.some(function(g){return String(g.companionId||'')===String(val);}) || order.status==='pending' || order.status==='waiting_boss_confirm';
    api(fromGrabs?'confirm_grab_assignment':'assign_companion',{id:a.dataset.doAssign,companion_id:val,from_grabs:!!fromGrabs}).then(function(res){
      toast(res.message||'指定成功');
      var modalEl=a.closest('.cs-modal');if(modalEl)modalEl.remove();
      state.assignBusy=false;
      return softRefresh();
    }).catch(function(err){
      state.assignBusy=false;a.disabled=false;a.textContent='保存';
      if(hint)hint.textContent=err.message||'指定失败';
      toast(err.message||'指定失败');
    });
    return;
  }var s=e.target.closest('[data-do-status]');if(s){var status=document.querySelector('[data-next-status]').value;if(!status){toast('没有可切换的下一步状态');return;}s.disabled=true;s.textContent='保存中…';api('update_order_status',{id:s.dataset.doStatus,status:status}).then(function(res){toast(res.message||'已更新');s.closest('.cs-modal').remove();return softRefresh()}).catch(function(err){s.disabled=false;s.textContent='保存';toast(err.message)});return}var rf=e.target.closest('[data-do-refund]');if(rf){api('refund_decision',{id:rf.dataset.doRefund,decision:document.querySelector('[data-refund-decision]').value,restore_status:document.querySelector('[data-restore-status]').value,note:document.querySelector('[data-refund-note]').value}).then(function(res){toast(res.message||'已处理');rf.closest('.cs-modal').remove();return softRefresh()}).catch(function(err){toast(err.message)});return}});
  window.__MCJ_CS_DEBUG = state;
  function bootDashboard(){
    if(window.__MCJCsBooted)return;
    window.__MCJCsBooted=true;
    bindKeyboardInset();
    try{init()}catch(e){paintSafeFallback()}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootDashboard);
  else bootDashboard();
  if(window.MCJChatMedia)window.MCJChatMedia.bindLightboxClicks(document.getElementById('serviceApp')||document);
})();
