(function(){
  'use strict';

  if (window.MCJ_DATE_FLOW_FILTER_READY) return;
  window.MCJ_DATE_FLOW_FILTER_READY = true;

  var STORE_KEY = 'mcjPlatformData.v1';
  var STATE_KEY = 'mcjDateFlowFilter.v1';
  var PAGE_SIZE = 10;

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function money(value){
    return 'RM ' + Number(value || 0).toFixed(2);
  }

  function readJson(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
    catch(e){ return fallback; }
  }

  function readStore(){
    return readJson(STORE_KEY, {});
  }

  function readState(){
    return readJson(STATE_KEY, {});
  }

  function writeState(role, state){
    var all = readState();
    all[role] = state;
    localStorage.setItem(STATE_KEY, JSON.stringify(all));
  }

  function pad(number){
    return String(number).padStart(2, '0');
  }

  function localDate(offset){
    var date = new Date();
    date.setDate(date.getDate() + (offset || 0));
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function monthRange(offset){
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth() + (offset || 0), 1);
    var last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return {
      startDate: first.getFullYear() + '-' + pad(first.getMonth() + 1) + '-' + pad(first.getDate()),
      endDate: last.getFullYear() + '-' + pad(last.getMonth() + 1) + '-' + pad(last.getDate())
    };
  }

  function defaultState(){
    var today = localDate(0);
    return { startDate: today, endDate: today, quick: 'today', keyword: '', status: '', type: '', page: 1 };
  }

  function getState(role){
    return Object.assign(defaultState(), readState()[role] || {});
  }

  function quickRange(key){
    if (key === 'today') return { startDate: localDate(0), endDate: localDate(0), quick: key, page: 1 };
    if (key === 'yesterday') return { startDate: localDate(-1), endDate: localDate(-1), quick: key, page: 1 };
    if (key === '7days') return { startDate: localDate(-6), endDate: localDate(0), quick: key, page: 1 };
    if (key === '30days') return { startDate: localDate(-29), endDate: localDate(0), quick: key, page: 1 };
    if (key === 'month') return Object.assign(monthRange(0), { quick: key, page: 1 });
    if (key === 'lastMonth') return Object.assign(monthRange(-1), { quick: key, page: 1 });
    return { quick: 'custom', page: 1 };
  }

  function dateToTime(value, endOfDay){
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return new Date(value + (endOfDay ? 'T23:59:59.999+08:00' : 'T00:00:00.000+08:00')).getTime();
    }
    var time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function rowTime(row){
    var fields = [
      'paid_at','paidAt','completed_at','completedAt','finishedAt','refunded_at','refundedAt',
      'withdrawn_at','withdrawnAt','applyAt','apply_at','settledAt','settled_at',
      'created_at','createdAt','time','date','startAt','endAt','updatedAt'
    ];
    for (var i = 0; i < fields.length; i++) {
      var time = dateToTime(row && row[fields[i]]);
      if (time) return time;
    }
    return 0;
  }

  function inDateRange(row, state){
    var time = rowTime(row);
    if (!time) return false;
    return time >= dateToTime(state.startDate, false) && time <= dateToTime(state.endDate, true);
  }

  function typeOf(row){
    return row.flowType || row.type || row.incomeType || row.sourceType || row.order_type || row.orderType || row.kind || '';
  }

  function statusOf(row){
    return row.status || row.order_status || row.orderStatus || row.paymentStatus || row.settlementStatus || '';
  }

  function amountOf(row){
    return Number(row.amount || row.paid_amount || row.paidAmount || row.totalAmount || row.budget || row.originalAmount || row.original_amount || row.orderAmount || 0);
  }

  function orderNo(row){
    return row.order_no || row.orderNo || row.order_number || row.orderId || row.order_id || row.id || '';
  }

  function playerName(row){
    return row.playerName || row.player || row.companionName || row.companion || row.player_id || row.playerId || row.companion_id || '';
  }

  function bossName(row){
    return row.bossName || row.boss || row.customerName || row.customer || row.user || row.boss_id || row.customer_id || '';
  }

  function serviceName(row){
    return row.customerServiceName || row.serviceAgentName || row.serviceName || row.customer_service_id || row.service_id || row.owner || '';
  }

  function unique(values){
    var seen = Object.create(null);
    return values.filter(function(value){
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function currentUser(role){
    var key = role === 'companion' ? 'companionUser' : role === 'service' ? 'customerServiceUser' : 'adminUser';
    return readJson(key, {});
  }

  function matchesUser(row, user, fields){
    var id = user.id || user.user_id || user.uid || user.player_id || user.companion_id || '';
    var name = user.nickname || user.name || '';
    if (!id && !name) return false;
    return fields.some(function(field){
      var value = row && row[field];
      return value && (String(value) === String(id) || String(value) === String(name));
    });
  }

  function belongsToRole(row, role){
    if (role === 'admin') return true;
    var user = currentUser(role);
    if (role === 'companion') {
      return matchesUser(row, user, ['playerId','player_id','companion_id','companionId','playerName','player','companionName','nickname']);
    }
    return matchesUser(row, user, ['customerServiceId','customer_service_id','service_id','ownerId','owner','customerServiceName','serviceAgentName','serviceName']);
  }

  function financeRows(db){
    var rows = [];
    (db.finance || []).forEach(function(item){ rows.push(Object.assign({ flowType: item.type || '财务流水' }, item)); });
    (db.orders || []).forEach(function(item){ rows.push(Object.assign({ flowType: '订单流水' }, item)); });
    (db.withdrawals || []).forEach(function(item){ rows.push(Object.assign({ flowType: '提现记录' }, item)); });
    (db.refunds || []).forEach(function(item){ rows.push(Object.assign({ flowType: '退款记录' }, item)); });
    (db.recharges || []).forEach(function(item){ rows.push(Object.assign({ flowType: '充值记录' }, item)); });
    (db.incomeRecords || []).forEach(function(item){ rows.push(Object.assign({ flowType: item.incomeType || '收入流水' }, item)); });
    (db.referral_commission_records || []).forEach(function(item){ rows.push(Object.assign({ flowType: item.commission_type || '邀请返利' }, item)); });
    return rows;
  }

  function filteredRows(role, state){
    var keyword = String(state.keyword || '').toLowerCase();
    var rows = financeRows(readStore()).filter(function(row){
      if (!inDateRange(row, state)) return false;
      if (!belongsToRole(row, role)) return false;
      if (state.status && statusOf(row) !== state.status) return false;
      if (state.type && typeOf(row) !== state.type) return false;
      if (keyword && JSON.stringify(row || {}).toLowerCase().indexOf(keyword) < 0) return false;
      return true;
    });
    rows.sort(function(a, b){ return rowTime(b) - rowTime(a); });
    return rows;
  }

  function sum(rows, predicate, getter){
    return rows.filter(predicate || function(){ return true; }).reduce(function(total, row){
      return total + Number((getter || amountOf)(row) || 0);
    }, 0);
  }

  function countStatus(rows, pattern){
    return rows.filter(function(row){ return pattern.test(String(statusOf(row))); }).length;
  }

  function statsFor(role, rows){
    if (role === 'admin') {
      return [
        ['总营业额', money(sum(rows, function(row){ return /订单|充值|营业|收入/.test(typeOf(row)); }))],
        ['平台利润', money(sum(rows, null, function(row){ return row.platformProfit || row.platformCommission || row.platform_fee || row.platformCommissionAmount || 0; }))],
        ['陪玩应得金额', money(sum(rows, null, function(row){ return row.playerIncome || row.companion_income || row.netAmount || row.income || 0; }))],
        ['客服工资或提成', money(sum(rows, null, function(row){ return row.serviceCommission || row.customerServiceCommission || row.serviceSalary || 0; }))],
        ['退款金额', money(sum(rows, function(row){ return /退款/.test(typeOf(row)); }, function(row){ return row.refundAmount || amountOf(row); }))],
        ['提现金额', money(sum(rows, function(row){ return /提现/.test(typeOf(row)); }))],
        ['完成订单数量', countStatus(rows, /完成|completed/i)],
        ['取消/退款订单数量', countStatus(rows, /取消|退款|cancel|refund/i)]
      ];
    }
    if (role === 'companion') {
      return [
        ['接单总数', rows.filter(function(row){ return /订单/.test(typeOf(row)); }).length],
        ['完成订单数', countStatus(rows, /完成|completed/i)],
        ['订单总金额', money(sum(rows, function(row){ return /订单/.test(typeOf(row)); }))],
        ['自己实际收入', money(sum(rows, null, function(row){ return row.netAmount || row.income || row.playerIncome || row.companion_income || 0; }))],
        ['平台抽成金额', money(sum(rows, null, function(row){ return row.platformCommission || row.platform_fee || row.platformCommissionAmount || 0; }))],
        ['礼物收入', money(sum(rows, function(row){ return /礼物/.test(typeOf(row)); }, function(row){ return row.netAmount || row.income || amountOf(row); }))],
        ['邀请返利', money(sum(rows, function(row){ return /返点|返利|邀请/.test(typeOf(row)); }))],
        ['已提现金额', money(sum(rows, function(row){ return /提现/.test(typeOf(row)); }))]
      ];
    }
    return [
      ['接待老板数量', unique(rows.map(bossName)).length],
      ['创建订单数量', rows.filter(function(row){ return /订单/.test(typeOf(row)); }).length],
      ['成交订单数量', countStatus(rows, /完成|completed/i)],
      ['退款处理数量', rows.filter(function(row){ return /退款|售后/.test(typeOf(row) + statusOf(row)); }).length],
      ['基础工资', money(sum(rows, function(row){ return /底薪/.test(typeOf(row)); }))],
      ['订单提成', money(sum(rows, function(row){ return /提成|派单/.test(typeOf(row)); }, function(row){ return row.serviceCommission || row.customerServiceCommission || amountOf(row); }))],
      ['奖金/扣款', money(sum(rows, function(row){ return /奖金|奖励|扣款/.test(typeOf(row)); }))],
      ['应发工资', money(sum(rows, function(row){ return /工资|提成|奖金|奖励|扣款/.test(typeOf(row)); }))]
    ];
  }

  function dailyTrend(rows){
    var map = {};
    rows.forEach(function(row){
      var time = rowTime(row);
      if (!time) return;
      var date = new Date(time).toISOString().slice(0, 10);
      map[date] = (map[date] || 0) + amountOf(row);
    });
    return Object.keys(map).sort().map(function(date){ return { date: date, amount: map[date] }; });
  }

  function optionList(rows, getter){
    return unique(rows.map(getter).filter(Boolean)).sort();
  }

  function renderToolbar(role, state, rows){
    var quicks = [
      ['today','今日'], ['yesterday','昨日'], ['7days','近7天'], ['30days','近30天'],
      ['month','本月'], ['lastMonth','上月'], ['custom','自定义']
    ];
    return '<section class="mcj-date-flow-toolbar" data-date-flow-toolbar="' + role + '">' +
      '<div class="mcj-date-flow-quick">' + quicks.map(function(item){
        return '<button type="button" class="' + (state.quick === item[0] ? 'active' : '') + '" data-date-quick="' + item[0] + '">' + item[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="mcj-date-flow-fields">' +
        '<label>开始日期<input type="date" data-date-start value="' + esc(state.startDate) + '"></label>' +
        '<label>结束日期<input type="date" data-date-end value="' + esc(state.endDate) + '"></label>' +
        '<button type="button" data-date-query>查询</button>' +
        '<button type="button" data-date-reset>重置</button>' +
      '</div>' +
      '<div class="mcj-date-flow-fields secondary">' +
        '<input data-date-keyword placeholder="搜索订单号、用户、游戏或流水" value="' + esc(state.keyword) + '">' +
        '<select data-date-status><option value="">全部状态</option>' + optionList(rows, statusOf).map(function(value){
          return '<option value="' + esc(value) + '"' + (state.status === value ? ' selected' : '') + '>' + esc(value) + '</option>';
        }).join('') + '</select>' +
        '<select data-date-type><option value="">全部流水类型</option>' + optionList(rows, typeOf).map(function(value){
          return '<option value="' + esc(value) + '"' + (state.type === value ? ' selected' : '') + '>' + esc(value) + '</option>';
        }).join('') + '</select>' +
        '<button type="button" data-date-export="csv">导出 CSV</button>' +
        '<button type="button" data-date-export="xls">导出 Excel</button>' +
      '</div>' +
      '<p class="mcj-date-flow-error" hidden></p>' +
    '</section>';
  }

  function renderStats(role, rows){
    var trend = dailyTrend(rows).slice(-14);
    var max = Math.max.apply(null, trend.map(function(item){ return item.amount; }).concat([1]));
    return '<section class="mcj-date-flow-summary">' +
      '<div class="mcj-date-flow-metrics">' + statsFor(role, rows).map(function(item){
        return '<div><span>' + esc(item[0]) + '</span><strong>' + esc(item[1]) + '</strong></div>';
      }).join('') + '</div>' +
      '<div class="mcj-date-flow-chart">' + (trend.length ? trend.map(function(item){
        var height = Math.max(8, Math.round(item.amount / max * 100));
        return '<span style="--h:' + height + '%" title="' + esc(item.date + ' ' + money(item.amount)) + '"><i></i><b>' + esc(item.date.slice(5)) + '</b></span>';
      }).join('') : '<p>该时间范围暂无数据</p>') + '</div>' +
    '</section>';
  }

  function headers(role){
    if (role === 'admin') return ['流水编号','日期时间','订单编号','流水类型','老板','陪玩','客服','订单金额','陪玩收入','平台利润','退款金额','支付方式','订单状态','操作'];
    if (role === 'companion') return ['日期时间','订单编号','老板昵称或ID','游戏','订单类型','订单金额','平台抽成','实际收入','结算状态'];
    return ['日期时间','订单编号','老板','陪玩','订单金额','客服提成','订单状态'];
  }

  function cells(role, row){
    var date = new Date(rowTime(row) || Date.now()).toLocaleString('zh-CN', { hour12: false });
    if (role === 'admin') {
      return [
        row.id || row.flowId || '', date, orderNo(row), typeOf(row), bossName(row), playerName(row), serviceName(row),
        money(amountOf(row)), money(row.playerIncome || row.companion_income || row.netAmount || 0),
        money(row.platformProfit || row.platformCommission || row.platform_fee || row.platformCommissionAmount || 0),
        money(row.refundAmount || (/退款/.test(typeOf(row)) ? amountOf(row) : 0)), row.method || row.paymentMethod || '',
        statusOf(row), '<button type="button" data-flow-detail="' + esc(row.id || orderNo(row)) + '">查看</button>'
      ];
    }
    if (role === 'companion') {
      return [
        date, orderNo(row), bossName(row), row.game || row.service || '', typeOf(row), money(amountOf(row)),
        money(row.platformCommission || row.platform_fee || row.platformCommissionAmount || 0),
        money(row.netAmount || row.income || row.playerIncome || row.companion_income || 0), statusOf(row)
      ];
    }
    return [
      date, orderNo(row), bossName(row), playerName(row), money(amountOf(row)),
      money(row.serviceCommission || row.customerServiceCommission || row.commission || 0), statusOf(row)
    ];
  }

  function renderTable(role, rows, state){
    var page = Math.max(1, Math.min(Number(state.page || 1), Math.max(1, Math.ceil(rows.length / PAGE_SIZE))));
    var shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return '<section class="mcj-date-flow-table">' +
      '<div class="mcj-date-flow-table-head"><h3>流水明细</h3><span>' + rows.length + ' 条记录</span></div>' +
      (shown.length ? '<div class="mcj-date-flow-scroll"><table><thead><tr>' + headers(role).map(function(h){
        return '<th>' + esc(h) + '</th>';
      }).join('') + '</tr></thead><tbody>' + shown.map(function(row){
        return '<tr>' + cells(role, row).map(function(cell){ return '<td>' + cell + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' : '<div class="mcj-date-flow-empty">该时间范围暂无数据</div>') +
      '<div class="mcj-date-flow-pages"><button type="button" data-date-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button><span>第 ' + page + ' / ' + Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) + ' 页</span><button type="button" data-date-page="' + (page + 1) + '"' + (page >= Math.ceil(rows.length / PAGE_SIZE) ? ' disabled' : '') + '>下一页</button></div>' +
    '</section>';
  }

  function render(host, role){
    var state = getState(role);
    var baseRows = financeRows(readStore()).filter(function(row){ return belongsToRole(row, role) && inDateRange(row, state); });
    var rows = filteredRows(role, state);
    host.innerHTML = renderToolbar(role, state, baseRows) + renderStats(role, rows) + renderTable(role, rows, state);
    bind(host, role);
  }

  function validate(state){
    if (!state.startDate || !state.endDate) return '请选择开始日期和结束日期';
    if (dateToTime(state.startDate, false) > dateToTime(state.endDate, true)) return '开始日期不能晚于结束日期';
    return '';
  }

  function collect(host, role){
    var state = getState(role);
    state.startDate = host.querySelector('[data-date-start]').value;
    state.endDate = host.querySelector('[data-date-end]').value;
    state.keyword = host.querySelector('[data-date-keyword]').value.trim();
    state.status = host.querySelector('[data-date-status]').value;
    state.type = host.querySelector('[data-date-type]').value;
    state.quick = state.quick || 'custom';
    state.page = Number(state.page || 1);
    return state;
  }

  function bind(host, role){
    host.querySelectorAll('[data-date-quick]').forEach(function(button){
      button.addEventListener('click', function(){
        var state = Object.assign(getState(role), quickRange(button.dataset.dateQuick));
        writeState(role, state);
        render(host, role);
      });
    });

    host.querySelector('[data-date-query]').addEventListener('click', function(){
      var state = Object.assign(collect(host, role), { quick: 'custom', page: 1 });
      var error = validate(state);
      if (error) {
        var node = host.querySelector('.mcj-date-flow-error');
        node.textContent = error;
        node.hidden = false;
        return;
      }
      writeState(role, state);
      render(host, role);
    });

    host.querySelector('[data-date-reset]').addEventListener('click', function(){
      writeState(role, defaultState());
      render(host, role);
    });

    host.querySelectorAll('[data-date-keyword],[data-date-status],[data-date-type]').forEach(function(input){
      input.addEventListener('change', function(){
        var state = Object.assign(collect(host, role), { page: 1 });
        writeState(role, state);
        render(host, role);
      });
    });

    host.querySelectorAll('[data-date-page]').forEach(function(button){
      button.addEventListener('click', function(){
        if (button.disabled) return;
        var state = getState(role);
        state.page = Number(button.dataset.datePage || 1);
        writeState(role, state);
        render(host, role);
      });
    });

    host.querySelectorAll('[data-date-export]').forEach(function(button){
      button.addEventListener('click', function(){
        exportRows(role, filteredRows(role, getState(role)), button.dataset.dateExport);
      });
    });
  }

  function exportRows(role, rows, format){
    var data = [headers(role)].concat(rows.map(function(row){
      return cells(role, row).map(function(cell){
        return String(cell).replace(/<[^>]+>/g, '');
      });
    }));
    var csv = data.map(function(row){
      return row.map(function(cell){ return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = new Blob(['\ufeff' + csv], { type: format === 'xls' ? 'application/vnd.ms-excel;charset=utf-8' : 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'mcj-' + role + '-flow-' + localDate(0) + (format === 'xls' ? '.xls' : '.csv');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function installStyles(){
    if (document.getElementById('mcj-date-flow-style')) return;
    var style = document.createElement('style');
    style.id = 'mcj-date-flow-style';
    style.textContent =
      '.mcj-date-flow-host{margin:14px 0 22px;display:block}.mcj-date-flow-toolbar,.mcj-date-flow-summary,.mcj-date-flow-table{border:1px solid rgba(255,120,190,.26);background:rgba(15,12,20,.74);box-shadow:0 18px 50px rgba(0,0,0,.22);backdrop-filter:blur(16px);border-radius:18px;padding:16px;margin-bottom:14px}.mcj-date-flow-quick,.mcj-date-flow-fields{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.mcj-date-flow-quick{margin-bottom:12px}.mcj-date-flow-quick button,.mcj-date-flow-fields button{border:1px solid rgba(255,126,196,.35);background:rgba(255,80,160,.08);color:#ffe9f5;border-radius:999px;padding:9px 14px;cursor:pointer;white-space:nowrap}.mcj-date-flow-quick button.active,.mcj-date-flow-fields button:hover{background:linear-gradient(135deg,rgba(255,75,166,.9),rgba(255,160,210,.72));color:#170b13;box-shadow:0 0 18px rgba(255,91,170,.25)}.mcj-date-flow-fields label{display:grid;gap:7px;color:#f9c7df;font-size:13px;min-width:156px}.mcj-date-flow-fields input,.mcj-date-flow-fields select{height:42px;min-width:156px;border:1px solid rgba(255,126,196,.28);background:#17141c;color:#fff;border-radius:12px;padding:0 13px;box-sizing:border-box}.mcj-date-flow-fields.secondary{margin-top:12px}.mcj-date-flow-fields.secondary input{min-width:240px;flex:1}.mcj-date-flow-error{color:#ff8fb9;margin:10px 0 0}.mcj-date-flow-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.mcj-date-flow-metrics div{border:1px solid rgba(255,126,196,.18);background:rgba(255,255,255,.045);border-radius:14px;padding:14px}.mcj-date-flow-metrics span{display:block;color:#c7a7b8;font-size:13px}.mcj-date-flow-metrics strong{display:block;margin-top:8px;color:#fff;font-size:22px}.mcj-date-flow-chart{height:140px;margin-top:14px;display:flex;gap:8px;align-items:end;border-top:1px solid rgba(255,126,196,.13);padding-top:14px;overflow-x:auto}.mcj-date-flow-chart span{min-width:34px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:8px}.mcj-date-flow-chart i{display:block;width:16px;height:var(--h);border-radius:999px;background:linear-gradient(180deg,#ff8fc9,#ff3f9f);box-shadow:0 0 12px rgba(255,89,168,.28)}.mcj-date-flow-chart b{font-size:11px;color:#bc9aac;font-weight:600}.mcj-date-flow-chart p,.mcj-date-flow-empty{width:100%;text-align:center;color:#bba6b3;padding:30px 0}.mcj-date-flow-table-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.mcj-date-flow-table-head h3{margin:0;color:#fff}.mcj-date-flow-table-head span{color:#caa9ba}.mcj-date-flow-scroll{overflow:auto;border:1px solid rgba(255,126,196,.14);border-radius:14px}.mcj-date-flow-table table{width:100%;border-collapse:collapse;min-width:900px}.mcj-date-flow-table th,.mcj-date-flow-table td{padding:12px 13px;border-bottom:1px solid rgba(255,126,196,.12);text-align:left;color:#f6edf3;font-size:13px;white-space:nowrap}.mcj-date-flow-table th{position:sticky;top:0;background:#17141c;color:#ffc8df;z-index:1}.mcj-date-flow-table td button{border:1px solid rgba(255,126,196,.32);background:rgba(255,80,160,.08);color:#ffd7eb;border-radius:999px;padding:6px 12px}.mcj-date-flow-pages{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px;color:#d8bdcc}.mcj-date-flow-pages button{border:1px solid rgba(255,126,196,.26);background:rgba(255,255,255,.05);color:#fff;border-radius:10px;padding:8px 12px}.mcj-date-flow-pages button:disabled{opacity:.38;cursor:not-allowed}@media(max-width:760px){.mcj-date-flow-toolbar,.mcj-date-flow-summary,.mcj-date-flow-table{padding:13px;border-radius:16px}.mcj-date-flow-fields label,.mcj-date-flow-fields input,.mcj-date-flow-fields select,.mcj-date-flow-fields.secondary input{min-width:0;width:100%}.mcj-date-flow-fields button{flex:1}.mcj-date-flow-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.mcj-date-flow-metrics strong{font-size:18px}}';
    document.head.appendChild(style);
  }

  function mount(container, role){
    if (!container || container.querySelector('.mcj-date-flow-host')) return;
    var host = document.createElement('div');
    host.className = 'mcj-date-flow-host';
    host.dataset.dateFlowRole = role;
    container.insertBefore(host, container.firstChild);
    render(host, role);
  }

  function activePanel(selector){
    return Array.prototype.find.call(document.querySelectorAll(selector), function(panel){
      return panel.offsetParent !== null || panel.classList.contains('active');
    });
  }

  function detect(){
    installStyles();
    var path = location.pathname;
    var hash = (location.hash || '#dashboard').replace('#','');
    if (/\/admin\//.test(path) && ['dashboard','finance','withdrawals','orders','statistics','recharges'].indexOf(hash) >= 0) {
      mount(document.getElementById('adminContent'), 'admin');
    }
    if (/\/companion\//.test(path)) {
      mount(activePanel('[data-companion-panel="home"],[data-companion-panel="income"]'), 'companion');
    }
    if (/\/customer-service\//.test(path)) {
      mount(activePanel('[data-service-panel="home"],[data-service-panel="salary"]'), 'service');
    }
  }

  function boot(){
    detect();
    var observer = new MutationObserver(function(){ detect(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('hashchange', function(){ setTimeout(detect, 0); });
    window.addEventListener('mcj:platform-data-updated', function(){
      document.querySelectorAll('.mcj-date-flow-host').forEach(function(host){
        render(host, host.dataset.dateFlowRole);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
