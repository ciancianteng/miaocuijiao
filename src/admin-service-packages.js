(function(){
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v){var n=Number(v||0);return 'RM'+(Number.isFinite(n)?n:0).toFixed(2)}
  function token(){return localStorage.getItem('mcjAuthAccessToken')||sessionStorage.getItem('mcjAuthAccessToken')||''}
  function headers(){return {'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+token(),'x-mcj-access-token':token()}}
  function parse(res){return res.json().catch(function(){return {}}).then(function(body){if(!res.ok||body.ok===false)throw new Error(body.message||'请求失败');return body})}
  function get(){return fetch('/api/admin/service-packages',{headers:headers()}).then(parse)}
  function post(body){return fetch('/api/admin/service-packages',{method:'POST',headers:headers(),body:JSON.stringify(body||{})}).then(parse)}
  function levelText(row){return 'Lv'+(row.levelMin||1)+'-Lv'+(row.levelMax||5)}
  function duration(row){var n=Number(row.durationMinutes||0);return n%60===0?(n/60)+'小时':n+'分钟'}
  function render(rows,message){
    var target=document.getElementById('table-gameplays');if(!target)return;
    rows=rows||[];
    target.innerHTML=(message?'<div class="admin-final-note">'+esc(message)+'</div>':'')+
      '<div class="admin-final-head"><div><h3>更多玩法管理</h3><p>管理老板端固定玩法套餐，保存后同步到更多玩法页面。</p></div><button class="mini-btn" type="button" data-package-refresh>刷新</button></div>'+
      '<form class="admin-final-form" data-service-package-form><input type="hidden" name="id">'+
      '<label>玩法名称<input name="name" required placeholder="例如：三角洲护航"></label>'+
      '<label>所属游戏<input name="game" required placeholder="例如：Delta Force"></label>'+
      '<label>玩法分类<input name="category" placeholder="护航 / 排位 / 教学"></label>'+
      '<label>固定价格 RM<input name="fixedPrice" type="number" min="1" step="0.01" required placeholder="30"></label>'+
      '<label>服务时长（分钟）<input name="durationMinutes" type="number" min="1" step="1" value="60" required></label>'+
      '<label>适用最低等级<input name="levelMin" type="number" min="1" max="5" value="1"></label>'+
      '<label>适用最高等级<input name="levelMax" type="number" min="1" max="5" value="5"></label>'+
      '<label>排序<input name="sortOrder" type="number" step="1" value="100"></label>'+
      '<label>是否启用<select name="isActive"><option value="true">启用</option><option value="false">停用</option></select></label>'+
      '<label class="wide">玩法说明<textarea name="description" placeholder="展示给老板看的玩法说明"></textarea></label>'+
      '<div class="wide row"><button class="primary-btn" type="submit">保存玩法</button><button class="ghost-btn" type="button" data-package-reset>取消编辑</button></div></form>'+
      '<div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>玩法名称</th><th>游戏</th><th>分类</th><th>价格</th><th>时长</th><th>等级</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(row){return '<tr><td>'+esc(row.name)+'</td><td>'+esc(row.game)+'</td><td>'+esc(row.category||'-')+'</td><td>'+money(row.fixedPrice)+'</td><td>'+esc(duration(row))+'</td><td>'+esc(levelText(row))+'</td><td>'+esc(row.sortOrder)+'</td><td>'+esc(row.isActive?'启用':'停用')+'</td><td><button class="mini-btn" type="button" data-package-edit="'+encodeURIComponent(JSON.stringify(row))+'">编辑</button><button class="mini-btn" type="button" data-package-toggle="'+esc(row.id)+'" data-package-active="'+(row.isActive?'false':'true')+'">'+(row.isActive?'停用':'启用')+'</button><button class="mini-btn danger" type="button" data-package-delete="'+esc(row.id)+'">删除</button></td></tr>'}).join(''):'<tr><td colspan="9"><div class="empty">暂无更多玩法</div></td></tr>')+
      '</tbody></table></div>';
  }
  function load(){var target=document.getElementById('table-gameplays');if(!target)return;target.innerHTML='<div class="content-loading">正在读取更多玩法...</div>';get().then(function(res){render(res.packages||[],res.message||'')}).catch(function(err){render([],err.message)})}
  function fill(row){var form=document.querySelector('[data-service-package-form]');if(!form)return;form.elements.id.value=row.id||'';form.elements.name.value=row.name||'';form.elements.game.value=row.game||'';form.elements.category.value=row.category||'';form.elements.fixedPrice.value=row.fixedPrice||'';form.elements.durationMinutes.value=row.durationMinutes||60;form.elements.levelMin.value=row.levelMin||1;form.elements.levelMax.value=row.levelMax||5;form.elements.sortOrder.value=row.sortOrder||100;form.elements.isActive.value=row.isActive===false?'false':'true';form.elements.description.value=row.description||'';form.scrollIntoView({block:'nearest'})}
  document.addEventListener('submit',function(e){if(!e.target.matches('[data-service-package-form]'))return;e.preventDefault();var fd=new FormData(e.target);post({action:'save',package:{id:fd.get('id'),name:fd.get('name'),game:fd.get('game'),category:fd.get('category'),fixedPrice:fd.get('fixedPrice'),durationMinutes:fd.get('durationMinutes'),levelMin:fd.get('levelMin'),levelMax:fd.get('levelMax'),sortOrder:fd.get('sortOrder'),isActive:fd.get('isActive')==='true',description:fd.get('description')}}).then(function(res){alert(res.message||'已保存');load()}).catch(function(err){alert(err.message)})});
  document.addEventListener('click',function(e){if(e.target.closest('[data-package-refresh]')){load();return}if(e.target.closest('[data-package-reset]')){var f=document.querySelector('[data-service-package-form]');if(f)f.reset();return}var edit=e.target.closest('[data-package-edit]');if(edit){fill(JSON.parse(decodeURIComponent(edit.dataset.packageEdit)));return}var toggle=e.target.closest('[data-package-toggle]');if(toggle){post({action:'toggle',id:toggle.dataset.packageToggle,isActive:toggle.dataset.packageActive==='true'}).then(function(res){alert(res.message||'已更新');load()}).catch(function(err){alert(err.message)});return}var del=e.target.closest('[data-package-delete]');if(del&&confirm('确认删除该玩法？')){post({action:'delete',id:del.dataset.packageDelete}).then(function(res){alert(res.message||'已删除');load()}).catch(function(err){alert(err.message)})}});
  document.addEventListener('DOMContentLoaded',load);
})();
