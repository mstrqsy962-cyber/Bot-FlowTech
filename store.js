import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function resolveDataRoot(){
  if(process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  try{
    fs.accessSync('/data', fs.constants.W_OK);
    return '/data';
  }catch{
    return path.resolve('./data');
  }
}
const DATA_ROOT=resolveDataRoot();
const USERS_FILE=path.join(DATA_ROOT,'users.json');
const LEGACY_FILE=path.join(DATA_ROOT,'settings.json');
const LEGACY_LOCAL=path.resolve('./data/settings.json');
const USERS_DIR=path.join(DATA_ROOT,'users');

export const defaults={
  prefix:'.',language:'ar',antilink:true,antibadword:false,welcome:true,
  statusAutoView:true,statusAutoReact:true,statusReaction:'💚',
  aiEnabled:false,aiProvider:process.env.AI_PROVIDER||'gemini',aiGroupMode:'mention',aiPrivate:true,
  aiModel:process.env.AI_MODEL||'gemini-3.8-flash',
  aiSystemPrompt:'أنت FlowTech، مساعد واتساب مفيد ومختصر. أجب بلغة المستخدم وبأسلوب طبيعي ومحترم.',
  warnings:{},badwords:[],seenStatuses:[],groups:{},muted:{},aiSessions:{},aiUsers:{},
  aiTyping:true,aiRecording:false,
  aiConfig:{provider:process.env.AI_PROVIDER||'gemini',model:process.env.AI_MODEL||'gemini-3.8-flash',apiKey:'',enabled:false,groupMode:'mention',privateEnabled:true,typingPresence:true,recordingPresence:false,systemPrompt:''}
};

function ensureRoot(){fs.mkdirSync(DATA_ROOT,{recursive:true,mode:0o700});fs.mkdirSync(USERS_DIR,{recursive:true,mode:0o700});}
function atomicWrite(file,data){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});try{fs.chmodSync(tmp,0o600)}catch{}fs.renameSync(tmp,file);}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return structuredClone(fallback)}}
function userFile(userId){return path.join(USERS_DIR,String(userId).replace(/[^a-zA-Z0-9_-]/g,'_'),'settings.json')}

export function ensureLegacySettings(){
  ensureRoot();
  if(!fs.existsSync(LEGACY_FILE)){
    if(LEGACY_LOCAL!==LEGACY_FILE && fs.existsSync(LEGACY_LOCAL)){
      try{fs.copyFileSync(LEGACY_LOCAL,LEGACY_FILE)}catch{}
    }
    if(!fs.existsSync(LEGACY_FILE))atomicWrite(LEGACY_FILE,defaults);
  }
  try{fs.chmodSync(LEGACY_FILE,0o600)}catch{}
}

export function getSettings(userId=null){
  ensureRoot();
  if(!userId){ensureLegacySettings();return {...structuredClone(defaults),...readJson(LEGACY_FILE,defaults),prefix:'.',language:'ar'};}
  const file=userFile(userId);
  if(!fs.existsSync(file)){
    const legacy=getSettings(null);
    const initial={...structuredClone(defaults),...legacy,prefix:'.',language:'ar'};
    atomicWrite(file,initial);
    return initial;
  }
  return {...structuredClone(defaults),...readJson(file,defaults),prefix:'.',language:'ar'};
}
export function saveSettings(data,userId=null){
  ensureRoot();
  const file=userId?userFile(userId):LEGACY_FILE;
  const next={...structuredClone(defaults),...data,prefix:'.',language:'ar'};
  atomicWrite(file,next);return next;
}
export function updateSettings(patch,userId=null){return saveSettings({...getSettings(userId),...patch},userId)}

function loadUsers(){ensureRoot();return readJson(USERS_FILE,{});}
function saveUsers(users){ensureRoot();atomicWrite(USERS_FILE,users);}
function normalizeEmail(v){return String(v||'').trim().toLowerCase()}
function normalizePhone(v){
  const raw=String(v||'').trim().replace(/[\s().-]/g,'');
  if(!raw)return '';
  const digits=raw.replace(/\D/g,'');
  return digits ? `+${digits}` : '';
}
function normalizeUsername(v){return String(v||'').trim()}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.scryptSync(String(password),salt,64).toString('hex');return `${salt}:${hash}`;
}
export function verifyPassword(password,stored){
  try{const [salt,hash]=String(stored).split(':');if(!salt||!hash)return false;const actual=crypto.scryptSync(String(password),salt,64);return crypto.timingSafeEqual(actual,Buffer.from(hash,'hex'));}catch{return false}
}
export function createUser({username,phone,password}){
  username=normalizeUsername(username);phone=normalizePhone(phone);
  if(!/^[A-Za-z0-9_\-.]{3,32}$/.test(username))throw new Error('اسم المستخدم يجب أن يكون 3-32 حرفًا إنجليزيًا، ويمكن أن يحتوي _ أو - أو .');
  if(!/^\+\d{8,15}$/.test(phone))throw new Error('رقم الهاتف غير صحيح. اكتبه مع رمز الدولة، مثل +9677xxxxxxxx.');
  if(String(password).length<6||String(password).length>128)throw new Error('كلمة المرور يجب أن تكون من 6 أحرف على الأقل.');
  const users=loadUsers();
  if(Object.values(users).some(u=>u.phone===phone))throw new Error('هذا الرقم مستخدم بالفعل.');
  if(Object.values(users).some(u=>u.username.toLowerCase()===username.toLowerCase()))throw new Error('اسم المستخدم مستخدم بالفعل.');
  const id=crypto.randomBytes(12).toString('hex');
  users[id]={id,username,phone,passwordHash:hashPassword(password),createdAt:new Date().toISOString()};
  saveUsers(users);getSettings(id);return users[id];
}
export function findUserByPhone(phone){const p=normalizePhone(phone);return Object.values(loadUsers()).find(u=>u.phone===p)||null}
export function getUser(userId){return loadUsers()[userId]||null}
export function listUsers(){return Object.values(loadUsers())}
export function userCount(){return listUsers().length}
export function publicUser(user){return user?{id:user.id,username:user.username,phone:user.phone||'',createdAt:user.createdAt}:null}
