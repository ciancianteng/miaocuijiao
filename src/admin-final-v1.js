(function(){
  var Auth=window.MCJAdminAuthFetch;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v){
    if(window.MCJCurrency)return window.MCJCurrency.formatPlain(v);
    var n=Number(v||0);return (Number.isFinite(n)?n:0).toFixed(2).replace(/\.00$/,'')+' 猫粮'
  }
  function note(text){return '<div class="admin-final-note">'+esc(text)+'</div>'}
  function statusText(s){return ({awaiting_payment:'待付款',pending:'待接单',claimed:'待陪玩确认',waiting_boss_confirm:'选择陪玩中',confirmed:'待开始',in_progress:'进行中',completed:'已完成',cancelled:'已取消',refund_requested:'售后',refunded:'已退款',after_sale:'售后',reviewed:'已评价'})[s]||s||'-'}
  function get(url){return Auth.get(url)}
  function post(url,body){return Auth.post(url,body)}
  function renderDashboard(){
    var target=document.getElementById('superStats');
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取真实统计...</div>';
    get('/api/admin/dashboard').then(function(res){
      if(res.ok===false){
        target.innerHTML=note(res.message||'数据加载失败')+'<button class="mini-btn" type="button" data-admin-final-refresh="dashboard">重试</button>';
        return;
      }
      var s=res.stats||{};
      target.innerHTML=(res.message?note(res.message):'')+'<div class="admin-final-grid">'+[
        ['老板总数',s.bosses||0],['陪玩总数',s.companions||0],['客服总数',s.customerServices||0],['今日订单',s.todayOrders||0],['待付款订单',s.awaitingPayment||0],['待接单订单',s.pendingOrders||0],['进行中订单',s.inProgress||0],['已完成订单',s.completed||0],['退款订单',s.refunds||0],['订单总金额',money(s.totalAmount||0)]
      ].map(function(item){return '<article class="admin-final-stat"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></article>'}).join('')+'</div>';
    }).catch(function(err){
      target.innerHTML=note(err.message||'数据加载失败')+'<button class="mini-btn" type="button" data-admin-final-refresh="dashboard">重试</button>';
    });
  }
  var ORDER_STATUS_OPTIONS=[
    ['awaiting_payment','待付款'],
    ['pending','待接单'],
    ['waiting_boss_confirm','选择陪玩中'],
    ['claimed','待陪玩确认'],
    ['confirmed','待开始'],
    ['in_progress','进行中'],
    ['completed','已完成'],
    ['refund_requested','售后'],
    ['refunded','已退款'],
    ['cancelled','已取消']
  ];
  function orderStatusSelectValue(current){
    var s=String(current||'');
    if(s==='after_sale')return 'refund_requested';
    return s;
  }
  function orderStatusSelect(orderId,current){
    var selected=orderStatusSelectValue(current);
    return '<select class="admin-order-status-select" data-admin-order-status-select="'+esc(orderId)+'" aria-label="订单状态">'+
      ORDER_STATUS_OPTIONS.map(function(opt){
        return '<option value="'+esc(opt[0])+'"'+(String(selected)===opt[0]?' selected':'')+'>'+esc(opt[1])+'</option>';
      }).join('')+
      '</select><button class="mini-btn" type="button" data-admin-order-status-apply="'+esc(orderId)+'">更新</button>';
  }
  function renderOrders(){var target=document.getElementById('orderManagement');if(!target)return;target.innerHTML='<div class="content-loading">正在读取真实订单...</div>';get('/api/admin/orders').then(function(res){var rows=res.orders||[];target.innerHTML=(res.message?note(res.message):'')+'<div class="admin-final-head"><div><h3>订单管理</h3><p>真实订单：抢单人数、指定陪玩、查看抢单人。状态用下拉选择。</p></div><button class="mini-btn" data-admin-final-refresh="orders">刷新</button></div><div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>订单编号</th><th>老板</th><th>服务内容</th><th>金额</th><th>状态</th><th>抢单人数</th><th>已选陪玩</th><th>创建时间</th><th>操作</th></tr></thead><tbody>'+(rows.length?rows.map(function(o){return '<tr data-order-row="'+esc(o.id)+'"><td>'+esc(o.orderNo)+'</td><td>'+esc(o.bossName)+'</td><td>'+esc(o.serviceContent||o.game||'-')+'</td><td>'+money(o.totalAmount)+'</td><td>'+esc(o.statusText||statusText(o.status))+'</td><td>'+esc(o.grabCount||0)+'</td><td>'+esc(o.companionName||'-')+'</td><td>'+esc(o.createdAt||'-')+'</td><td class="admin-order-actions">'+orderStatusSelect(o.id,o.status)+'<button class="mini-btn" data-admin-view-grabs="'+esc(o.id)+'">查看抢单人</button><button class="mini-btn" data-admin-assign-grab="'+esc(o.id)+'">指定陪玩</button>'+(o.companion_id&&!['in_progress','completed'].includes(o.status)?'<button class="mini-btn" data-admin-unassign="'+esc(o.id)+'">取消指定</button>':'')+'<button class="mini-btn danger" data-admin-order-cancel="'+esc(o.id)+'">取消</button><button class="mini-btn danger" data-admin-order-delete="'+esc(o.id)+'">删除</button></td></tr>'}).join(''):'<tr><td colspan="9"><div class="empty">暂无订单</div></td></tr>')+'</tbody></table></div><div id="adminOrderGrabModal" hidden></div>'}).catch(function(err){target.innerHTML=note(err.message)})}
  function showGrabModal(orderId,mode){
    var box=document.getElementById('adminOrderGrabModal');
    if(!box)return;
    box.hidden=false;
    box.innerHTML='<div class="content-loading">加载抢单人...</div>';
    post('/api/admin/orders',{action:'list_grabs',id:orderId}).then(function(res){
      var grabs=res.grabs||[];
      var intent=res.bossIntent||null;
      var html='<div class="admin-final-head"><div><h3>'+(mode==='assign'?'指定陪玩':'抢单人列表')+'</h3><p>订单 '+esc(orderId)+(intent?' · 老板意向：'+esc(intent.companionName||intent.companionId):'')+'</p></div><button class="mini-btn" type="button" data-admin-close-grabs>关闭</button></div>';
      if(!grabs.length){html+='<div class="empty">暂无抢单记录</div>';box.innerHTML=html;return;}
      html+='<div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>头像</th><th>昵称</th><th>等级</th><th>游戏</th><th>单价</th><th>评分</th><th>接单</th><th>意向</th><th>操作</th></tr></thead><tbody>'+
        grabs.map(function(g){
          var c=g.companion||{};
          return '<tr><td>'+(c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="" style="width:40px;height:40px;border-radius:8px;object-fit:cover">':'-')+'</td><td>'+esc(c.nickname||'-')+'<br><small>'+esc(c.companionUid||c.id||'')+'</small></td><td>'+esc(c.level||'-')+'</td><td>'+esc(c.mainGame||c.game||'-')+'</td><td>'+money(c.price||0)+'</td><td>'+esc(c.rating||'-')+'</td><td>'+esc(c.completedOrders||0)+'</td><td>'+(g.bossPreferred?'是':'否')+'</td><td>'+
            (mode==='assign'?'<button class="mini-btn primary" data-admin-confirm-grab="'+esc(orderId)+'" data-companion-id="'+esc(g.companionId||c.id||'')+'">确认指定</button>':'')+
            (c.voiceUrl?' <a class="mini-btn" href="'+esc(c.voiceUrl)+'" target="_blank" rel="noopener">试听</a>':'')+
            ' <a class="mini-btn" href="/player.html?id='+encodeURIComponent(c.id||'')+'" target="_blank" rel="noopener">详情</a></td></tr>';
        }).join('')+'</tbody></table></div>';
      box.innerHTML=html;
    }).catch(function(err){box.innerHTML=note(err.message)});
  }
  function renderReports(){
    /* 提现与发薪由 src/admin-finance.js 接管 #serviceReportsManagement */
    if(window.MCJAdminFinance&&typeof window.MCJAdminFinance.reload==='function'){
      window.MCJAdminFinance.reload();
    }
  }
  function reportStatus(s){return ({pending:'待审核',approved:'已批准',rejected:'已拒绝',paid:'已支付'})[s]||s||'-'}
  function renderContent(){get('/api/admin/content').then(function(res){renderAnnouncements(res)}).catch(function(err){var a=document.getElementById('table-announcements');if(a)a.innerHTML=note(err.message)})}
  function toDatetimeLocal(value){
    if(!value)return '';
    try{
      var d=new Date(value);
      if(Number.isNaN(d.getTime()))return '';
      var pad=function(n){return String(n).padStart(2,'0')};
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
    }catch(e){return ''}
  }
  function categoryLabel(v){return v==='companion'?'陪玩公告':'首页公告'}
  function audienceLabel(v){
    return ({home:'首页',boss:'老板端',companion:'陪玩端',customer_service:'客服端',all:'全平台'})[v]||v||'首页';
  }
  function renderAnnouncements(res){
    var target=document.getElementById('table-announcements');
    if(!target)return;
    var rows=res.announcements||[];
    target.innerHTML=(res.message?note(res.message):'')+
      '<div class="admin-final-head"><div><h3>公告管理</h3><p>按分类发布：首页公告显示在官网/老板端公告栏；陪玩公告仅陪玩端顶部滚动。保存后实时生效，无需改代码。</p></div></div>'+
      '<form class="admin-final-form" data-announcement-form>'+
        '<input type="hidden" name="id">'+
        '<label>公告分类<select name="category" required><option value="home" selected>首页公告（首页/老板端）</option><option value="companion">陪玩公告（仅陪玩端）</option></select></label>'+
        '<label>公告类型<select name="kind"><option value="normal" selected>普通公告</option><option value="forced">强制阅读公告</option></select></label>'+
        '<label>发布对象（预留）<select name="audience"><option value="home" selected>首页</option><option value="boss">老板端</option><option value="companion">陪玩端</option><option value="customer_service">客服端</option><option value="all">全平台</option></select></label>'+
        '<label>标题<input name="title" required placeholder="例如：平台维护通知"></label>'+
        '<label>排序<input name="sort_order" type="number" min="0" step="1" value="100" placeholder="数字越小越靠前"></label>'+
        '<label>开始时间<input name="start_at" type="datetime-local"></label>'+
        '<label>结束时间<input name="end_at" type="datetime-local"></label>'+
        '<label>发布时间<input name="published_at" type="datetime-local"></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否置顶</span><select name="is_pinned" data-admin-control="switch"><option value="true">置顶</option><option value="false" selected>不置顶</option></select></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否滚动</span><select name="is_scrolling" data-admin-control="switch"><option value="true" selected>滚动</option><option value="false">不滚动（省略）</option></select></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否启用</span><select name="is_active" data-admin-control="switch"><option value="true" selected>启用</option><option value="false">停用</option></select></label>'+
        '<label class="wide">内容<textarea name="content" required placeholder="公告正文"></textarea></label>'+
        '<button class="primary-btn" type="submit">保存公告</button>'+
        '<button class="mini-btn" type="button" data-announcement-reset>清空表单</button>'+
      '</form>'+
      '<div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>分类</th><th>对象</th><th>标题</th><th>内容</th><th>时间窗</th><th>排序</th><th>置顶</th><th>滚动</th><th>启用</th><th>操作</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(r){
        var windowText=(r.start_at||'-')+' ~ '+(r.end_at||'-');
        return '<tr>'+
          '<td>'+esc(categoryLabel(r.category))+'</td>'+
          '<td>'+esc(audienceLabel(r.audience))+'</td>'+
          '<td>'+esc(r.title||'-')+'</td>'+
          '<td>'+esc(r.content||'-')+'</td>'+
          '<td>'+esc(windowText)+'</td>'+
          '<td>'+esc(r.sort_order==null?100:r.sort_order)+'</td>'+
          '<td>'+esc(r.is_pinned?'是':'否')+'</td>'+
          '<td>'+esc(r.is_scrolling===false?'否':'是')+'</td>'+
          '<td>'+esc(r.is_active===false?'停用':'启用')+'</td>'+
          '<td><button class="mini-btn" data-edit-announcement="'+encodeURIComponent(JSON.stringify(r))+'">编辑</button>'+
          '<button class="mini-btn danger" data-delete-announcement="'+esc(r.id)+'">删除</button></td></tr>';
      }).join(''):'<tr><td colspan="10"><div class="empty">暂无公告</div></td></tr>')+
      '</tbody></table></div>';
    if(window.MCJAdminForms&&window.MCJAdminForms.enhance)window.MCJAdminForms.enhance(target);
    var catSel=target.querySelector('[name="category"]');
    var audSel=target.querySelector('[name="audience"]');
    if(catSel&&audSel&&!catSel.dataset.bound){
      catSel.dataset.bound='1';
      catSel.addEventListener('change',function(){
        if(catSel.value==='companion')audSel.value='companion';
        else if(audSel.value==='companion')audSel.value='home';
      });
    }
  }
  function fileToDataUrl(file){return new Promise(function(resolve,reject){if(!file)return resolve('');var reader=new FileReader();reader.onload=function(){resolve(reader.result||'')};reader.onerror=function(){reject(new Error('图片读取失败'))};reader.readAsDataURL(file)})}
  document.addEventListener('submit',function(e){
    if(e.target.matches('[data-announcement-form]')){
      e.preventDefault();
      var ad=new FormData(e.target);
      post('/api/admin/content',{
        action:'save_announcement',
        announcement:{
          id:ad.get('id'),
          kind:ad.get('kind')||'normal',
          requires_ack:String(ad.get('kind')||'')==='forced',
          category:ad.get('category')||'home',
          audience:ad.get('audience')||(ad.get('category')==='companion'?'companion':'home'),
          title:ad.get('title'),
          content:ad.get('content'),
          start_at:ad.get('start_at'),
          end_at:ad.get('end_at'),
          published_at:ad.get('published_at')||ad.get('start_at'),
          sort_order:ad.get('sort_order')||100,
          is_pinned:ad.get('is_pinned')==='true',
          is_scrolling:ad.get('is_scrolling')!=='false',
          is_active:ad.get('is_active')==='true'
        }
      }).then(function(res){
        alert(res.message||'已保存');
        e.target.reset();
        e.target.elements.id.value='';
        if(e.target.elements.kind)e.target.elements.kind.value='normal';
        if(e.target.elements.category)e.target.elements.category.value='home';
        if(e.target.elements.audience)e.target.elements.audience.value='home';
        if(e.target.elements.sort_order)e.target.elements.sort_order.value='100';
        if(e.target.elements.is_scrolling)e.target.elements.is_scrolling.value='true';
        renderContent();
      }).catch(function(err){alert(err.message)});
      return;
    }
  });
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-admin-final-refresh="orders"]'))renderOrders();
    if(e.target.closest('[data-admin-final-refresh="reports"]'))renderReports();
    if(e.target.closest('[data-admin-final-refresh="dashboard"]'))renderDashboard();
    var vg=e.target.closest('[data-admin-view-grabs]');
    if(vg){showGrabModal(vg.dataset.adminViewGrabs,'view');return;}
    var ag=e.target.closest('[data-admin-assign-grab]');
    if(ag){showGrabModal(ag.dataset.adminAssignGrab,'assign');return;}
    if(e.target.closest('[data-admin-close-grabs]')){
      var box=document.getElementById('adminOrderGrabModal');
      if(box){box.hidden=true;box.innerHTML='';}
      return;
    }
    var cg=e.target.closest('[data-admin-confirm-grab]');
    if(cg){
      if(!confirm('确定指定该陪玩？\n\n指定后，其他抢单陪玩将无法再接此订单。'))return;
      post('/api/admin/orders',{action:'confirm_grab_assignment',id:cg.dataset.adminConfirmGrab,companion_id:cg.dataset.companionId,from_grabs:true}).then(function(res){alert(res.message||'指定成功');var box=document.getElementById('adminOrderGrabModal');if(box){box.hidden=true;box.innerHTML='';}renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    var ua=e.target.closest('[data-admin-unassign]');
    if(ua&&confirm('确认取消指定？订单将回到待抢单。')){
      post('/api/admin/orders',{action:'unassign_companion',id:ua.dataset.adminUnassign}).then(renderOrders).catch(function(err){alert(err.message)});
      return;
    }
    if(e.target.closest('[data-announcement-reset]')){
      var rf=document.querySelector('[data-announcement-form]');
      if(rf){
        rf.reset();
        rf.elements.id.value='';
        if(rf.elements.category)rf.elements.category.value='home';
        if(rf.elements.audience)rf.elements.audience.value='home';
        if(rf.elements.sort_order)rf.elements.sort_order.value='100';
        if(rf.elements.is_scrolling)rf.elements.is_scrolling.value='true';
      }
      return;
    }
    var os=e.target.closest('[data-admin-order-status-apply]');
    if(os){
      var row=os.closest('tr')||os.parentElement;
      var sel=row&&row.querySelector('[data-admin-order-status-select="'+os.dataset.adminOrderStatusApply+'"]');
      var status=sel?String(sel.value||'').trim():'';
      if(!status){alert('请先选择状态');return}
      if(!confirm('确认将订单状态更新为「'+(sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].text:status)+'」？'))return;
      post('/api/admin/orders',{action:'update_status',id:os.dataset.adminOrderStatusApply,status:status}).then(renderOrders).catch(function(err){alert(err.message)});
      return;
    }
    var legacyOs=e.target.closest('[data-admin-order-status]');
    if(legacyOs){
      alert('请使用状态下拉框选择，禁止手输状态。');
      return;
    }
    var oc=e.target.closest('[data-admin-order-cancel]');
    if(oc&&confirm('确认取消该订单？'))post('/api/admin/orders',{action:'cancel',id:oc.dataset.adminOrderCancel}).then(renderOrders).catch(function(err){alert(err.message)});
    var od=e.target.closest('[data-admin-order-delete]');
    if(od&&confirm('确认永久删除订单？\n将同时删除订单、相关聊天与缓存。真实订单会记入操作日志。')){
      post('/api/admin/orders',{action:'delete',id:od.dataset.adminOrderDelete}).then(function(res){alert(res.message||'已删除');renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    var rr=e.target.closest('[data-report-review]');
    if(rr){
      var noteText=prompt('审核备注')||'';
      post('/api/reports',{id:rr.dataset.reportReview,status:rr.dataset.status,admin_note:noteText}).then(renderReports).catch(function(err){alert(err.message)});
      return;
    }
    var ea=e.target.closest('[data-edit-announcement]');
    if(ea){
      var a=JSON.parse(decodeURIComponent(ea.dataset.editAnnouncement));
      var af=document.querySelector('[data-announcement-form]');
      if(af){
        af.elements.id.value=a.id||'';
        if(af.elements.category)af.elements.category.value=a.category==='companion'?'companion':'home';
        if(af.elements.kind)af.elements.kind.value=a.kind==='forced'?'forced':'normal';
        if(af.elements.audience)af.elements.audience.value=a.audience||(a.category==='companion'?'companion':'home');
        af.elements.title.value=a.title||'';
        af.elements.content.value=a.content||'';
        if(af.elements.sort_order)af.elements.sort_order.value=a.sort_order==null?100:a.sort_order;
        if(af.elements.start_at)af.elements.start_at.value=toDatetimeLocal(a.start_at||'');
        if(af.elements.end_at)af.elements.end_at.value=toDatetimeLocal(a.end_at||'');
        af.elements.published_at.value=toDatetimeLocal(a.published_at||a.created_at||'');
        af.elements.is_pinned.value=a.is_pinned?'true':'false';
        if(af.elements.is_scrolling)af.elements.is_scrolling.value=a.is_scrolling===false?'false':'true';
        af.elements.is_active.value=a.is_active===false?'false':'true';
        if(window.MCJAdminForms&&window.MCJAdminForms.enhance)window.MCJAdminForms.enhance(af);
        af.elements.is_pinned.dispatchEvent(new Event('change',{bubbles:true}));
        if(af.elements.is_scrolling)af.elements.is_scrolling.dispatchEvent(new Event('change',{bubbles:true}));
        af.elements.is_active.dispatchEvent(new Event('change',{bubbles:true}));
        af.scrollIntoView({block:'nearest'});
      }
      return;
    }
    var da=e.target.closest('[data-delete-announcement]');
    if(da&&confirm('确认删除公告？'))post('/api/admin/content',{action:'delete_announcement',id:da.dataset.deleteAnnouncement}).then(renderContent).catch(function(err){alert(err.message)});
  });
  document.addEventListener('DOMContentLoaded',function(){if(!Auth)return;Auth.ensureValidToken().then(function(){renderDashboard();renderOrders();renderReports();renderContent()}).catch(function(){})});
})();
