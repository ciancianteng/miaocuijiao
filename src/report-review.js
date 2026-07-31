(function(){
  var root=document.getElementById('reportApp');
  if(!root)return;
  var state={loading:true,error:'',reports:[],notice:''};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    return Number(v || 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function adminToken(){return localStorage.getItem('mcjAuthAccessToken')||sessionStorage.getItem('mcjAuthAccessToken')||''}
  function paint(){
    root.innerHTML='<main class="report-shell"><header class="report-head"><div><h1>工资报备审核</h1><p>只读取真实 customer_service_reports 数据，不显示假工资。</p></div><button class="report-btn" data-refresh>刷新</button></header>'+bodyHtml()+'</main>';
  }
  function bodyHtml(){
    if(state.loading)return '<section class="report-card"><div class="report-empty">正在读取真实报备数据...</div></section>';
    if(state.error)return '<section class="report-alert">'+esc(state.error)+'</section>';
    var rows=state.reports||[];
    return '<section class="report-card"><div class="report-table-wrap"><table class="report-table"><thead><tr><th>报备日期</th><th>客服ID</th><th>上班</th><th>下班</th><th>处理订单</th><th>金额</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>'+(rows.length?rows.map(rowHtml).join(''):'<tr><td colspan="9"><div class="report-empty">暂无工资报备</div></td></tr>')+'</tbody></table></div></section>';
  }
  function rowHtml(r){
    return '<tr><td>'+esc(r.report_date||'-')+'</td><td>'+esc(r.customer_service_id||'-')+'</td><td>'+esc(r.shift_start||'-')+'</td><td>'+esc(r.shift_end||'-')+'</td><td>'+esc(r.orders_handled||0)+'</td><td>'+money(r.salary_amount)+'</td><td>'+esc(r.status||'-')+'</td><td>'+esc(r.note||r.admin_note||'-')+'</td><td><div class="report-actions"><button class="report-btn primary" data-review="'+esc(r.id)+'" data-status="approved">通过</button><button class="report-btn" data-review="'+esc(r.id)+'" data-status="rejected">驳回</button><button class="report-btn" data-review="'+esc(r.id)+'" data-status="paid">标记已付</button></div></td></tr>';
  }
  function load(){
    state.loading=true;state.error='';paint();
    fetch('/api/reports',{headers:{Accept:'application/json',Authorization:'Bearer '+adminToken(),'x-mcj-access-token':adminToken()}}).then(function(res){return res.json().then(function(body){if(!res.ok||body.ok===false)throw new Error(body.message||'工资报备读取失败');return body})}).then(function(body){state.reports=body.reports||[]}).catch(function(err){state.error=err.message||'工资报备读取失败'}).finally(function(){state.loading=false;paint()});
  }
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-refresh]')){load();return}
    var btn=e.target.closest('[data-review]');
    if(!btn)return;
    var note=prompt('请输入审核备注')||'';
    fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+adminToken(),'x-mcj-access-token':adminToken()},body:JSON.stringify({id:btn.dataset.review,status:btn.dataset.status,admin_note:note})}).then(function(res){return res.json().then(function(body){if(!res.ok||body.ok===false)throw new Error(body.message||'审核失败');return body})}).then(load).catch(function(err){alert(err.message||'审核失败')});
  });
  load();
})();


