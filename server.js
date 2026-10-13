import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { getSettings, updateSettings, saveSettings, createUser, findUserByPhone, verifyPassword, getUser, listUsers, publicUser } from './store.js';
import { askAI } from './ai.js';
import { startBot, getBotState, requestPairingCode, logout, onBotEvent, startAllBots } from './whatsapp.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();const server=http.createServer(app);
const io=new Server(server,{cors:{origin:true,credentials:true}});
const PORT=Number(process.env.PORT||3000);const HOST=process.env.HOST||'0.0.0.0';
app.use(helmet({contentSecurityPolicy:false}));app.use(cors());app.use(express.json({limit:'1mb'}));app.use(express.static(path.join(__dirname,'../public')));

const TOKEN_TTL=1000*60*60*24*30;
const SECRET=process.env.DASHBOARD_SECRET||crypto.randomBytes(32).toString('hex');
function sign(value){return crypto.createHmac('sha256',SECRET).update(value).digest('hex')}
function createToken(userId){const payload=Buffer.from(JSON.stringify({sub:userId,exp:Date.now()+TOKEN_TTL})).toString('base64url');return `${payload}.${sign(payload)}`}
function verifyToken(token){try{const [payload,sig]=String(token||'').split('.');if(!payload||!sig||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(payload))))return null;const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(!data.sub||data.exp<Date.now())return null;return getUser(data.sub)?data.sub:null}catch{return null}}
function tokenFromReq(req){return req.headers.authorization?.replace(/^Bearer\s+/i,'')||req.query.token||''}
function auth(req,res,next){const userId=verifyToken(tokenFromReq(req));if(!userId)return res.status(401).json({error:'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.'});req.userId=userId;req.user=getUser(userId);next()}
function normalizePhone(v){const d=String(v||'').replace(/\D/g,'');return d?`+${d}`:''}
function publicSettings(settings){
  const ai=settings.aiConfig||{};
  return {
    prefix:'.',language:'ar',antilink:Boolean(settings.antilink),antibadword:Boolean(settings.antibadword),welcome:Boolean(settings.welcome),
    statusAutoView:Boolean(settings.statusAutoView),statusAutoReact:Boolean(settings.statusAutoReact),statusReaction:settings.statusReaction||'💚',
    aiEnabled:Boolean(ai.enabled),aiProvider:ai.provider||'gemini',aiGroupMode:ai.groupMode||'mention',aiPrivate:ai.privateEnabled!==false,
    aiModel:ai.model||'gemini-3.8-flash',aiSystemPrompt:ai.systemPrompt||'',aiConfigured:Boolean(ai.apiKey),aiApiKeyMask:ai.apiKey?'••••••••'+String(ai.apiKey).slice(-4):'',
    aiTyping:ai.typingPresence!==false,aiRecording:Boolean(ai.recordingPresence)
  };
}
function publicAi(settings){const a=settings.aiConfig||{};return {provider:a.provider||'gemini',model:a.model||'gemini-3.8-flash',enabled:Boolean(a.enabled),apiKeySet:Boolean(a.apiKey),apiKeyMask:a.apiKey?'••••••••'+String(a.apiKey).slice(-4):'',groupMode:a.groupMode||'mention',privateEnabled:a.privateEnabled!==false,typingPresence:a.typingPresence!==false,recordingPresence:Boolean(a.recordingPresence),systemPrompt:a.systemPrompt||''}}

app.post('/api/auth/register',(req,res)=>{
  try{
    const {username,phone,password,confirmPassword}=req.body||{};
    if(String(password||'')!==String(confirmPassword||''))return res.status(400).json({error:'كلمتا المرور غير متطابقتين.'});
    const user=createUser({username,phone,password});
    const token=createToken(user.id);
    res.json({token,user:publicUser(user)});
  }catch(e){res.status(400).json({error:e.message||'تعذر إنشاء الحساب.'})}
});
app.post('/api/auth/login',(req,res)=>{
  const user=findUserByPhone(req.body?.phone);if(!user||!verifyPassword(req.body?.password,user.passwordHash))return res.status(401).json({error:'رقم الهاتف أو كلمة المرور غير صحيحة.'});
  res.json({token:createToken(user.id),user:publicUser(user)});
});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:publicUser(req.user)}));
app.post('/api/auth/logout',auth,(req,res)=>res.json({ok:true}));

app.get('/api/state',auth,(req,res)=>{
  const s=getSettings(req.userId);res.json({bot:getBotState(req.userId),settings:publicSettings(s),ai:publicAi(s),user:publicUser(req.user),meta:{name:process.env.BOT_NAME||'FlowTech',developer:process.env.DEVELOPER_NAME||'القميشي',contact:process.env.CONTACT_PHONE||process.env.OWNER_PHONE||'',dev2Name:process.env.DEV2_NAME||'أحمد العباسي',dev2Phone:process.env.DEV2_PHONE||'967739020737',auth:true}});
});
app.post('/api/start',auth,async(req,res)=>{try{await startBot(req.userId);res.json(getBotState(req.userId))}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/pair',auth,async(req,res)=>{try{const code=await requestPairingCode(req.userId,req.body.phone);res.json({code})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/logout-whatsapp',auth,async(req,res)=>{try{await logout(req.userId);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/settings',auth,(req,res)=>res.json(publicSettings(getSettings(req.userId))));
app.post('/api/settings',auth,(req,res)=>{
  const allowed=['antilink','antibadword','welcome','statusAutoView','statusAutoReact','statusReaction'];
  const patch={};for(const k of allowed)if(req.body[k]!==undefined)patch[k]=req.body[k];patch.language='ar';patch.prefix='.';
  if(patch.statusReaction!==undefined)patch.statusReaction=String(patch.statusReaction).slice(0,8);
  res.json(publicSettings(updateSettings(patch,req.userId)));
});

app.get('/api/ai-user',auth,(req,res)=>res.json(publicAi(getSettings(req.userId))));
app.post('/api/ai-user',auth,(req,res)=>{
  const provider=String(req.body.provider||'gemini').toLowerCase();if(!['gemini','openai'].includes(provider))return res.status(400).json({error:'مزود AI غير صالح.'});
  const settings=getSettings(req.userId);const old=settings.aiConfig||{};const incoming=String(req.body.apiKey||'').trim();const apiKey=incoming||old.apiKey||'';
  if(!apiKey)return res.status(400).json({error:'أدخل مفتاح API أولاً.'});
  settings.aiConfig={...old,provider,model:String(req.body.model||'').trim()||old.model||(provider==='openai'?'gpt-5.5':'gemini-3.8-flash'),apiKey,enabled:Boolean(req.body.enabled),groupMode:req.body.groupMode==='all'?'all':'mention',privateEnabled:req.body.privateEnabled!==false,typingPresence:req.body.typingPresence!==false,recordingPresence:Boolean(req.body.recordingPresence),systemPrompt:String(req.body.systemPrompt||'').slice(0,3000)};
  const botPhone=normalizePhone(getBotState(req.userId).phone);
  if(botPhone){settings.aiUsers=settings.aiUsers||{};settings.aiUsers[botPhone]={...settings.aiConfig};}
  saveSettings(settings,req.userId);res.json(publicAi(settings));
});
app.post('/api/ai-user/test',auth,async(req,res)=>{
  const a=getSettings(req.userId).aiConfig||{};if(!a.apiKey)return res.status(400).json({error:'لا يوجد مفتاح API محفوظ لحسابك.'});
  try{const out=await askAI({provider:a.provider,model:a.model,prompt:'قل: تم اختبار الذكاء الاصطناعي بنجاح.',system:a.systemPrompt,apiKey:a.apiKey});res.json({ok:true,text:out.text})}catch(e){res.status(400).json({error:e.message})}
});
app.get('/api/ai-users',auth,(req,res)=>res.json({users:[{...publicAi(getSettings(req.userId)),scope:'حسابك فقط'}]}));
app.delete('/api/ai-user',auth,(req,res)=>{const s=getSettings(req.userId);s.aiConfig={...(s.aiConfig||{}),apiKey:'',enabled:false};s.aiUsers={};saveSettings(s,req.userId);res.json({ok:true})});

io.use((socket,next)=>{const userId=verifyToken(socket.handshake.auth?.token||socket.handshake.query?.token);if(!userId)return next(new Error('Unauthorized'));socket.userId=userId;next()});
io.on('connection',socket=>{socket.join(`user:${socket.userId}`);socket.emit('bot:event',{type:'state',...getBotState(socket.userId)});});
onBotEvent(payload=>{if(payload?.userId)io.to(`user:${payload.userId}`).emit('bot:event',payload);});

app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));

server.listen(PORT,HOST,async()=>{
  console.log(`FlowTech dashboard: http://${HOST==='0.0.0.0'?'localhost':HOST}:${PORT}`);
  const users=listUsers();
  if(users.length)await startAllBots(users.map(u=>u.id));
});
