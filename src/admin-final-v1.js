(function(){
  var Auth=window.MCJAdminAuthFetch;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v){
    if(window.MCJCurrency)return window.MCJCurrency.formatPlain(v);
    var n=Number(v||0);return (Number.isFinite(n)?n:0).toFixed(2).replace(/\.00$/,'')+' 猫粮'
  }
  function note(text){return '<div class="admin-final-note">'+esc(text)+'</div>'}
  function statusText(s){return ({awaiting_payment:'待付款',pending:'等待陪玩确认',claimed:'等待陪玩确认',waiting_boss_confirm:'待老板确认',confirmed:'待开始',in_progress:'进行中',completed:'已完成',cancelled:'已取消',refund_requested:'售后',refunded:'退款',after_sale:'售后'})[s]||s||'-'}
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
  function renderOrders(){var target=document.getElementById('orderManagement');if(!target)return;target.innerHTML='<div class="content-loading">正在读取真实订单...</div>';get('/api/admin/orders').then(function(res){var rows=res.orders||[];target.innerHTML=(res.message?note(res.message):'')+'<div class="admin-final-head"><div><h3>订单管理</h3><p>管理平台真实订单，不显示本地假订单。</p></div><button class="mini-btn" data-admin-final-refresh="orders">刷新</button></div><div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>订单编号</th><th>老板</th><th>陪玩</th><th>客服</th><th>游戏</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>'+(rows.length?rows.map(function(o){return '<tr><td>'+esc(o.orderNo)+'</td><td>'+esc(o.bossName)+'</td><td>'+esc(o.companionName)+'</td><td>'+esc(o.serviceName)+'</td><td>'+esc(o.game||'-')+'</td><td>'+money(o.totalAmount)+'</td><td>'+esc(o.statusText||statusText(o.status))+'</td><td>'+esc(o.createdAt||'-')+'</td><td><button class="mini-btn" data-admin-order-status="'+esc(o.id)+'">改状态</button><button class="mini-btn danger" data-admin-order-cancel="'+esc(o.id)+'">取消</button><button class="mini-btn danger" data-admin-order-delete="'+esc(o.id)+'">删除</button></td></tr>'}).join(''):'<tr><td colspan="9"><div class="empty">暂无订单</div></td></tr>')+'</tbody></table></div>'}).catch(function(err){target.innerHTML=note(err.message)})}
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
  function renderAnnouncements(res){
    var target=document.getElementById('table-announcements');
    if(!target)return;
    var rows=res.announcements||[];
    target.innerHTML=(res.message?note(res.message):'')+
      '<div class="admin-final-head"><div><h3>公告管理</h3><p>保存后立即同步首页 Banner 下方公告栏。关闭显示后首页自动隐藏；置顶公告永远排在第一条。</p></div></div>'+
      '<form class="admin-final-form" data-announcement-form>'+
        '<input type="hidden" name="id">'+
        '<label>标题<input name="title" required placeholder="例如：平台维护通知"></label>'+
        '<label>发布时间<input name="published_at" type="datetime-local"></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否置顶</span><select name="is_pinned" data-admin-control="switch"><option value="true">置顶</option><option value="false" selected>不置顶</option></select></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否显示</span><select name="is_active" data-admin-control="switch"><option value="true" selected>显示</option><option value="false">隐藏</option></select></label>'+
        '<label class="wide">内容<textarea name="content" required placeholder="公告正文"></textarea></label>'+
        '<button class="primary-btn" type="submit">保存公告</button>'+
        '<button class="mini-btn" type="button" data-announcement-reset>清空表单</button>'+
      '</form>'+
      '<div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>标题</th><th>内容</th><th>发布时间</th><th>置顶</th><th>显示</th><th>操作</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(r){
        return '<tr>'+
          '<td>'+esc(r.title||'-')+'</td>'+
          '<td>'+esc(r.content||'-')+'</td>'+
          '<td>'+esc(r.published_at||r.created_at||'-')+'</td>'+
          '<td>'+esc(r.is_pinned?'是':'否')+'</td>'+
          '<td>'+esc(r.is_active?'显示':'隐藏')+'</td>'+
          '<td><button class="mini-btn" data-edit-announcement="'+encodeURIComponent(JSON.stringify(r))+'">编辑</button>'+
          '<button class="mini-btn danger" data-delete-announcement="'+esc(r.id)+'">删除</button></td></tr>';
      }).join(''):'<tr><td colspan="6"><div class="empty">暂无公告</div></td></tr>')+
      '</tbody></table></div>';
    if(window.MCJAdminForms&&window.MCJAdminForms.enhance)window.MCJAdminForms.enhance(target);
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
          title:ad.get('title'),
          content:ad.get('content'),
          published_at:ad.get('published_at'),
          is_pinned:ad.get('is_pinned')==='true',
          is_active:ad.get('is_active')==='true'
        }
      }).then(function(res){
        alert(res.message||'已保存');
        e.target.reset();
        e.target.elements.id.value='';
        renderContent();
      }).catch(function(err){alert(err.message)});
      return;
    }
  });
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-admin-final-refresh="orders"]'))renderOrders();
    if(e.target.closest('[data-admin-final-refresh="reports"]'))renderReports();
    if(e.target.closest('[data-admin-final-refresh="dashboard"]'))renderDashboard();
    if(e.target.closest('[data-announcement-reset]')){
      var rf=document.querySelector('[data-announcement-form]');
      if(rf){rf.reset();rf.elements.id.value='';}
      return;
    }
    var os=e.target.closest('[data-admin-order-status]');
    if(os){
      var status=prompt('输入状态码：\nawaiting_payment=待付款\npending/claimed=等待陪玩确认\nwaiting_boss_confirm=待老板确认\nconfirmed=待开始\nin_progress=进行中\ncompleted=已完成\nrefund_requested=售后\nrefunded=退款\ncancelled=已取消');
      if(status)post('/api/admin/orders',{action:'update_status',id:os.dataset.adminOrderStatus,status:status}).then(renderOrders).catch(function(err){alert(err.message)});
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
        af.elements.title.value=a.title||'';
        af.elements.content.value=a.content||'';
        af.elements.published_at.value=toDatetimeLocal(a.published_at||a.created_at||'');
        af.elements.is_pinned.value=a.is_pinned?'true':'false';
        af.elements.is_active.value=a.is_active===false?'false':'true';
        if(window.MCJAdminForms&&window.MCJAdminForms.enhance)window.MCJAdminForms.enhance(af);
        af.elements.is_pinned.dispatchEvent(new Event('change',{bubbles:true}));
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
