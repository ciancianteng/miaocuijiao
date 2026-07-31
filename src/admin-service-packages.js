(function(){
  var Auth=window.MCJAdminAuthFetch;
  function parse(res){return Auth?Auth.parseJson(res):res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(e){throw new Error('接口返回格式错误')}if(!res.ok||body.ok===false)throw new Error(body.message||('请求失败：HTTP '+res.status));return body})}
  function get(){return (Auth?Auth.fetch:fetch)('/api/admin/service-packages',{headers:Auth?Auth.getAuthHeaders():{}}).then(parse)}
  function post(body){return (Auth?Auth.post:fetch)('/api/admin/service-packages',body||{})}
  window.MCJAdminServicePackages={get:get,post:post};
})();
