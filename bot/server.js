import 'dotenv/config';
import http from 'node:http';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CODE = process.env.ADMIN_CODE;
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!TG_TOKEN || !ADMIN_CODE || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables. Check Render Environment.');
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TG_TOKEN}`;
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
let offset = 0;
const sessions = new Map();
const admins = new Set();\nconst failedCodes = new Map();
const products = new Map();
const statusLabels = { available:'В наличии', preorder:'Предзаказ', unavailable:'Нет в наличии' };

const serverHttp = http.createServer(async (req,res)=>{\n if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type'});res.end();return;}\n if(req.url==='/products' && req.method==='GET'){try{const data=await getProducts();res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'});res.end(JSON.stringify(data));}catch(e){res.writeHead(500,{'access-control-allow-origin':'*'});res.end('[]');}return;}\n res.writeHead(200,{'content-type':'text/plain'});res.end('SmileStore bot is running');});
serverHttp.listen(process.env.PORT || 10000, '0.0.0.0', ()=>console.log('SmileStore bot listening'));

async function tg(method, body) {
  const r=await fetch(`${API}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json(); if(!j.ok) console.error('Telegram API error:',j.description); return j.result;
}
async function send(chat,text,keyboard) {
  const payload={chat_id:chat,text,parse_mode:'HTML'};
  if(keyboard) payload.reply_markup=keyboard;
  return tg('sendMessage',payload);
}
const mainMenu={keyboard:[[{text:'➕ Добавить товар'},{text:'✏️ Редактировать товары'}],[{text:'📦 Наличие товаров'}]],resize_keyboard:true};
const inline=(rows)=>({inline_keyboard:rows});
async function getProducts(){
 const r=await fetch(`${SUPABASE_URL}/rest/v1/smilestore_products?select=*&order=created_at.desc`,{headers});
 if(!r.ok) throw new Error('Supabase select '+r.status+' '+await r.text());
 return r.json();
}
async function upsertProduct(p){
 const r=await fetch(`${SUPABASE_URL}/rest/v1/smilestore_products`,{method:'POST',headers:{...headers,'content-type':'application/json','Prefer':'return=representation'},body:JSON.stringify(p)});
 if(!r.ok) throw new Error('Supabase insert '+r.status+' '+await r.text());
 return r.json();
}
async function patchProduct(id,p){
 const r=await fetch(`${SUPABASE_URL}/rest/v1/smilestore_products?id=eq.${id}`,{method:'PATCH',headers:{...headers,'content-type':'application/json','Prefer':'return=representation'},body:JSON.stringify(p)});
 if(!r.ok) throw new Error('Supabase update '+r.status+' '+await r.text());
 return r.json();
}
async function deleteProduct(id){
 const r=await fetch(`${SUPABASE_URL}/rest/v1/smilestore_products?id=eq.${id}`,{method:'DELETE',headers});
 if(!r.ok) throw new Error('Supabase delete '+r.status+' '+await r.text());
}
async function uploadImage(fileId){
 const meta=await fetch(`${API}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r=>r.json());
 if(!meta.ok) throw new Error(meta.description||'Could not get Telegram file');
 const file=await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${meta.result.file_path}`);
 const bytes=Buffer.from(await file.arrayBuffer());
 const ext=(meta.result.file_path.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
 const path=`products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
 const up=await fetch(`${SUPABASE_URL}/storage/v1/object/smilestore-images/${path}`,{method:'POST',headers:{...headers,'content-type':file.headers.get('content-type')||'image/jpeg','x-upsert':'true'},body:bytes});
 if(!up.ok) throw new Error('Storage upload '+up.status+' '+await up.text());
 return `${SUPABASE_URL}/storage/v1/object/public/smilestore-images/${path}`;
}
function admin(chat){return admins.has(String(chat));}
function session(chat){if(!sessions.has(chat))sessions.set(chat,{});return sessions.get(chat);}
function reset(chat){sessions.delete(chat);}
async function editList(chat,mode){
 const list=await getProducts();
 if(!list.length){await send(chat,'Каталог пока пуст.',mainMenu);return;}
 await send(chat,'Выберите товар:',{inline_keyboard:list.map(p=>[{text:p.name,callback_data:`pick:${mode}:${p.id}`}])});
}
async function statusList(chat){
 const list=await getProducts();
 if(!list.length){await send(chat,'Каталог пока пуст.',mainMenu);return;}
 await send(chat,'Выберите товар для изменения наличия:',{inline_keyboard:list.map(p=>[{text:p.name,callback_data:`stock:${p.id}`}])});
}
async function handleMessage(m){
 const chat=m.chat.id, txt=m.text||'', s=session(chat);
 if(txt==='/start'){
   reset(chat); await send(chat,'Здравствуйте! Я бот управления <b>SmileStore</b>.\nДля входа в админ-панель введите код администратора.',{});
   return;
 }
 if(!admin(chat)){
   const now=Date.now(), attempt=failedCodes.get(String(chat))||{count:0,blockedUntil:0};
   if(attempt.blockedUntil>now){await send(chat,'⏳ Слишком много попыток. Попробуйте позже.');return;}
   if(txt.trim()===ADMIN_CODE){admins.add(String(chat));failedCodes.delete(String(chat));reset(chat);await send(chat,'✅ Код верный. Доступ к админ-панели открыт.',mainMenu);}
   else {attempt.count++;if(attempt.count>=5){attempt.count=0;attempt.blockedUntil=now+10*60*1000;}failedCodes.set(String(chat),attempt);await send(chat,attempt.blockedUntil>now?'⛔ 5 неверных попыток. Вход временно заблокирован на 10 минут.':'⛔ Код не подходит.');}
   return;
 }
 if(txt==='➕ Добавить товар'){reset(chat);s.action='add_photo';await send(chat,'Отправьте фотографию товара.');return;}
 if(txt==='✏️ Редактировать товары'){await editList(chat,'edit');return;}
 if(txt==='📦 Наличие товаров'){await statusList(chat);return;}
 if(s.action==='add_photo' && m.photo){
   const photo=m.photo[m.photo.length-1];s.photoId=photo.file_id;s.action='add_name';await send(chat,'Фото получено. Теперь отправьте название товара.');return;
 }
 if(s.action==='add_name' && txt){s.name=txt.trim();s.action='add_desc';await send(chat,'Напишите описание товара.');return;}
 if(s.action==='add_desc' && txt){s.description=txt.trim();s.action='add_price';await send(chat,'Укажите цену только цифрами (например: 189).');return;}
 if(s.action==='add_price' && txt){
   const price=txt.trim();if(!/^\\d+(?:[.,]\\d{1,2})?$/.test(price)){await send(chat,'Цена должна содержать только цифры (можно дробную часть через точку).');return;}
   try{const image_url=await uploadImage(s.photoId);await upsertProduct({name:s.name,description:s.description,price:Number(price.replace(',','.')),image_url,status:'available'});reset(chat);await send(chat,'✅ Товар успешно добавлен на сайт SmileStore!',mainMenu);}
   catch(e){console.error(e);await send(chat,'Не удалось сохранить товар. Проверьте настройки Render/Supabase.');}return;
 }
 if(s.action==='edit_field' && txt){const p=s.product;try{let patch={};if(s.field==='name')patch.name=txt.trim();else if(s.field==='description')patch.description=txt.trim();else if(s.field==='price'){if(!/^\\d+(?:[.,]\\d{1,2})?$/.test(txt.trim())){await send(chat,'Введите цену цифрами.');return;}patch.price=Number(txt.replace(',','.'));}else if(s.field==='image'){if(!m.photo){await send(chat,'Отправьте фотографию, пожалуйста.');return;}patch.image_url=await uploadImage(m.photo[m.photo.length-1].file_id);}await patchProduct(p.id,patch);reset(chat);await send(chat,'Изменения сохранены.',mainMenu);}catch(e){console.error(e);await send(chat,'Ошибка сохранения изменения.');}return;}
}
async function callback(q){
 const chat=q.message.chat.id,data=q.data;await tg('answerCallbackQuery',{callback_query_id:q.id});
 if(!admin(chat))return;
 if(data.startsWith('pick:')){
  const [,mode,id]=data.split(':');const list=await getProducts();const p=list.find(x=>String(x.id)===id);if(!p)return;
  const s=session(chat);s.product=p;
  await send(chat,`<b>${p.name}</b>\nЦена: ${p.price} сомони\nНаличие: ${statusLabels[p.status]||p.status}\nЧто изменить?`,inline([[{text:'Изменить фото',callback_data:'field:image'},{text:'Изменить название',callback_data:'field:name'}],[{text:'Изменить описание',callback_data:'field:description'},{text:'Изменить цену',callback_data:'field:price'}],[{text:'🗑 Удалить товар',callback_data:`delete:${p.id}`}],[{text:'Назад',callback_data:'back'}]]));
  return;
 }
 if(data==='back'){await send(chat,'Главное меню',mainMenu);return;}
 if(data.startsWith('field:')){const s=session(chat);s.field=data.split(':')[1];s.action='edit_field';await send(chat,s.field==='image'?'Отправьте новое фото товара.':s.field==='name'?'Введите новое название.':s.field==='description'?'Введите новое описание.':'Введите новую цену (цифрами).');return;}
 if(data.startsWith('delete:')){const id=data.split(':')[1];try{await deleteProduct(id);reset(chat);await send(chat,'Товар удалён.',mainMenu);}catch(e){console.error(e);await send(chat,'Не удалось удалить товар.');}return;}
 if(data.startsWith('stock:')){const id=data.split(':')[1];const list=await getProducts();const p=list.find(x=>String(x.id)===id);if(!p)return;await send(chat,`Выберите наличие для <b>${p.name}</b>:`,inline([[{text:'В наличии',callback_data:`setstock:${id}:available`}],[{text:'Предзаказ',callback_data:`setstock:${id}:preorder`}],[{text:'Нет в наличии',callback_data:`setstock:${id}:unavailable`}]]));return;}
 if(data.startsWith('setstock:')){const [,id,status]=data.split(':');try{await patchProduct(id,{status});await send(chat,'Наличие обновлено.',mainMenu);}catch(e){console.error(e);await send(chat,'Ошибка обновления наличия.');}return;}
}
async function loop(){
 while(true){try{
  const updates=await fetch(`${API}/getUpdates?timeout=25&offset=${offset}`).then(r=>r.json());
  if(updates.ok)for(const u of updates.result){offset=u.update_id+1;if(u.message)await handleMessage(u.message);if(u.callback_query)await callback(u.callback_query);}
 }catch(e){console.error('Polling error',e);await new Promise(r=>setTimeout(r,3000));}}
}
loop();
