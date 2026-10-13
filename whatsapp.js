import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState, jidNormalizedUser, isJidGroup, fetchLatestWaWebVersion, downloadMediaMessage, generateWAMessageContent, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getSettings as readSettings, saveSettings as writeSettings } from './store.js';
import { labels, tr, normalizeLang } from './i18n.js';
import { askAI } from './ai.js';

const logger=P({level:process.env.LOG_LEVEL||'warn'});
const AUTO_FOLLOW_CHANNEL_URL='https://whatsapp.com/channel/0029VbDySEbB4hdYssR8uB3V';
const AUTO_FOLLOW_CHANNEL_INVITE='0029VbDySEbB4hdYssR8uB3V';
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
const sessionsRoot=path.join(DATA_ROOT,'users');
const contexts=new Map();
const als=new AsyncLocalStorage();
const events=new Set();

function currentUserId(){return als.getStore()?.userId||null}
function contextFor(userId=currentUserId()) {
  if(!userId) throw new Error('WhatsApp context is missing.');
  let c=contexts.get(userId);
  if(!c){c={userId,sock:null,qrData:null,pairingCode:null,state:'disconnected',starting:false,currentAuthState:null,lastDisconnect:null,pairingReadyPromise:null,pairingReadyResolve:null,channelFollowPromise:null,lastSelfImage:null,outgoingIds:new Set()};contexts.set(userId,c)}
  return c;
}
function runAs(userId,fn){return als.run({userId},fn)}
const sock=new Proxy({}, {get(_target,prop){const s=contextFor().sock;return s?.[prop]}});
function getSettings(){return readSettings(currentUserId())}
function saveSettings(data){return writeSettings(data,currentUserId())}
function botEventPayload(payload){const userId=currentUserId()||payload?.userId||null;return {...payload,userId}}
const floodState=new Map();
const spamState=new Map();
const aiQueues=new Map();
const pendingMedia=new Map();
export function onBotEvent(fn){events.add(fn);return()=>events.delete(fn)}
function emit(payload){const data=botEventPayload(payload);for(const fn of events){try{fn(data)}catch{}}}
export function getBotState(userId){const c=contextFor(userId);return{userId:c.userId,state:c.state,qrData:c.qrData,pairingCode:c.pairingCode,connected:c.state==='connected',phone:c.sock?.user?.id||null,lastDisconnect:c.lastDisconnect}}
export function getSocket(userId){return contexts.get(userId)?.sock||null}
export function listBotStates(){return [...contexts.keys()].map(id=>getBotState(id))}


const aliases={};
for(const [lang,map] of Object.entries(labels))for(const [key,word] of Object.entries(map))aliases[word.toLowerCase()]=key;
Object.assign(aliases,{
  'مساعدة':'help','اوامر':'allcommands','أوامر':'allcommands','أوامر_البوت':'allcommands','اوامر_البوت':'allcommands','commands':'allcommands','مساعده':'help','قائمة':'menu','القائمة':'menu','بينغ':'ping','حالة':'status','المطور':'owner','مطور':'owner','معلومات':'info','معرف':'id','ايدي':'id',
  'معلومات_المجموعة':'groupinfo','معلومات-المجموعة':'groupinfo','المجموعة':'groupinfo','مشرفين':'admins','المشرفين':'admins','اعضاء':'members','الأعضاء':'members','الاعضاء':'members','منشن':'tagall','تاج':'tagall',
  'طرد':'kick','ترقية':'promote','تنزيل':'demote','اضافة':'add','إضافة':'add','ازالة':'remove','إزالة':'remove','حذف_عضو':'remove',
  'تحذير':'warn','تحذيرات':'warnings','مسح_تحذير':'clearwarn','مسح-تحذير':'clearwarn','كتم':'mute','فك_كتم':'unmute','فك-كتم':'unmute',
  'قفل':'lock','فتح':'unlock','اسم':'setname','وصف':'setdesc','رابط':'linkgroup','الرابط':'linkgroup','تغيير_الرابط':'revoke','تغيير-الرابط':'revoke',
  'حماية':'protect','الغاء_الحماية':'unprotect','إلغاء_الحماية':'unprotect','منع_الروابط':'antilink','منع-الروابط':'antilink','منع_الكلمات':'antibadword','منع-الكلمات':'antibadword','ترحيب':'welcome',
  'حالات':'statusview','مشاهدة_الحالات':'statusview','تفاعل':'statusreact','تفاعل_الحالات':'statusreact','ذكاء':'ai','ذكاء_اصطناعي':'ai','الذكاء':'ai',
  'رد':'react','رد_تلقائي':'ai','حذف_رسالة':'delete','حذف-رسالة':'delete','ايقاف':'stop','إيقاف':'stop',
  'مساعدة':'help','بوت':'menu','حي':'alive','متصل':'alive','وقت_التشغيل':'runtime','تشغيل':'start','اعادة_تشغيل':'restart','إعادة_تشغيل':'restart','ban':'kick','everyone':'tagall','grouplink':'linkgroup','groupinfo':'groupinfo','members':'members','admins':'admins','warn':'warn','warnings':'warnings','clearwarn':'clearwarn','unmute':'unmute','mute':'mute',
  'قفل_المجموعة':'lock','فتح_المجموعة':'unlock','فتح':'unlock','قفل':'lock','رابط_المجموعة':'linkgroup','تغيير_الرابط':'revoke','جروب':'groupinfo','مجموعتي':'groupinfo','معرف_المجموعة':'groupid','ايدي_المجموعة':'groupid','عنوان_المجموعة':'groupinfo','اسم_المجموعة':'setname','وصف_المجموعة':'setdesc','اضف':'add','احذف':'remove','طرد_عضو':'kick','رفع':'promote','خفض':'demote',
  'المشرفين':'admins','الادمن':'admins','الاعضاء':'members','الأعضاء':'members','منشن_الكل':'tagall','الكل':'tagall',
  'باند':'kick','حظر':'kick','طرد_عضو':'remove','ترقية_عضو':'promote','تنزيل_عضو':'demote',
  'تحذير_عضو':'warn','كتم_عضو':'mute','فك_الكتم':'unmute','الغاء_الكتم':'unmute',
  'مضاد_الروابط':'antilink','مضاد_الكلمات':'antibadword','الترحيب':'welcome','حماية_المجموعة':'protect',
  'مضاد_التكرار':'antiflood','منع_التكرار':'antiflood','مضاد_السبام':'antispam','منع_السبام':'antispam','مضاد_المنشن':'antitag','منع_المنشن':'antitag','كلمات_ممنوعة':'badwords','اضافة_كلمة':'setbadword','إضافة_كلمة':'setbadword','حذف_كلمة':'delbadword','مسح_كلمة':'delbadword','حد_التحذير':'setwarnlimit','تصفير_التحذيرات':'clearwarn','فتح_المجموعة':'unlock','قفل_المجموعة':'lock',
  'تفاعل_تلقائي':'statusreact','مشاهدة_تلقائية':'statusview','ايدي':'id','معرف_المجموعة':'groupid','كل_الأوامر':'allcommands','اوامر_المجموعة':'groupcommands','أوامر_المجموعة':'groupcommands','أوامر_الحماية':'protectioncommands',
  'نكتة':'joke','نكته':'joke','حكمة':'quote','اقتباس':'quote','حظ':'luck','نرد':'dice','عملة':'coin','اختيار':'choose','عشوائي':'random','حجر_ورق_مقص':'rps','حجر_ورق_مقص':'rps','حجر':'rps','ورق':'rps','مقص':'rps','نسبة_الحب':'love','حب':'love','8ball':'eightball','سؤال_نعم_لا':'eightball','تحدي':'challenge','هل_تعلم':'fact','معلومة':'fact','معلومات_عامة':'fact','مزاج':'mood','رقم_عشوائي':'random','قصة':'story','مدح':'compliment','ذم':'roast','اسم_عشوائي':'randomname','اسم_عشوائي':'randomname','نعم_لا':'yesno','تخمين':'guess','ترفيه':'fun','العاب':'fun','ألعاب':'fun','العاب_البوت':'fun',
  'الوقت':'time','وقت':'time','التاريخ':'date','تاريخ':'date',
  'حساب':'calc','حاسبة':'calc','احسب':'calc','قل':'say','كرر':'say',
  'عكس':'reverse','عدد_الحروف':'count','عدد_الاحرف':'count',
  'القناة':'channel','قناتي':'channel','حالة_القناة':'channelstatus',
  'رقم_البوت':'botid','معرف_البوت':'botid','ذاكرة':'memory',
  'حالة_الذاكرة':'memory','تشغيل_منذ':'uptime','ايدي_انا':'idme'
});

Object.assign(aliases,{
  'اليوم':'date','يوم':'weekday','الشهر':'month','السنة':'year','الساعة':'time','ساعة':'time',
  'نسبة':'percent','نسبة_مئوية':'percent','خصم':'discount','متوسط':'average','اكبر':'max','أكبر':'max','اصغر':'min','أصغر':'min','تقريب':'round','جذر':'sqrt','تربيع':'square','اس':'power',
  'حروف':'count','كلمات':'words','اسطر':'lines','أسطر':'lines','تنظيف':'trim','تكرار':'repeat','تقسيم':'split','حروف_عشوائية':'randomletters','رمز_عشوائي':'randomcode',
  'معلومات_البوت':'info','حالة_البوت':'status','تشغيل_البوت':'start','اعادة_الاتصال':'restart','إعادة_الاتصال':'restart',
  'غيّر_اسمي':'setprofile_name','غير_اسمي':'setprofile_name','تغيير_اسمي':'setprofile_name','اسمي':'setprofile_name',
  'غيّر_حالتي':'setprofile_status','غير_حالتي':'setprofile_status','تغيير_حالتي':'setprofile_status','حالتي':'setprofile_status',
  'غيّر_صورتي':'setprofile_pic','غير_صورتي':'setprofile_pic','تغيير_صورتي':'setprofile_pic','صورتي':'setprofile_pic','تحديث_صورتي':'setprofile_pic',
  'احذف_صورتي':'removeprofile_pic','حذف_صورتي':'removeprofile_pic','مسح_صورتي':'removeprofile_pic',
  'خصوصية_الصورة':'picprivacy','خصوصية_الحالة':'statusprivacy','خصوصية_الاخر':'lastseenprivacy','خصوصية_الأخير':'lastseenprivacy','خصوصية_الاخير':'lastseenprivacy','خصوصية_الاونلاين':'onlineprivacy','خصوصية_القراءة':'readprivacy',
  'حظر':'block','الغاء_حظر':'unblock','إلغاء_حظر':'unblock','بلوك':'block','فك_البلوك':'unblock',
  'قفل_المعلومات':'lockinfo','فتح_المعلومات':'unlockinfo','قفل_تعديل_المعلومات':'lockinfo','فتح_تعديل_المعلومات':'unlockinfo',
  'عدد_الاعضاء':'members','عدد_الأعضاء':'members','عدد_المشرفين':'admins_count','عدد_المشرفون':'admins_count','موضوع_المجموعة':'groupinfo','وصف_المجموعة':'groupinfo',
  'تثبيت':'pin','تثبيت_الرسالة':'pin','الغاء_التثبيت':'unpin','إلغاء_التثبيت':'unpin','نجمة':'star','ازالة_النجمة':'unstar','إزالة_النجمة':'unstar',
  'منشن':'tagall','منشن_المشرفين':'tagadmins','منشن_الادمن':'tagadmins',
  'رقم_عشوائي':'random','عشوائي':'random','اختيار_عشوائي':'choose','حظي':'luck','عملة':'coin','نرد':'dice','حجر_ورق_مقص':'rps','نسبة_الحب':'love','كرة_سحرية':'eightball','8ball':'eightball',
  'مزحة':'joke','نكتة':'joke','حكمة':'quote','اقتباس':'quote','معلومة':'fact','تحدي':'challenge','قصة':'story','مدح':'compliment','مزاج':'mood','اسم_عشوائي':'randomname','نعم_لا':'yesno',
  'كل_الأوامر_الكاملة':'fullcommands','كل_الاوامر_الكاملة':'fullcommands','fullcommands':'fullcommands','مفتاح_البوت':'botid','معرفي':'idme','الذاكرة':'memory','المدة':'uptime','كل_الأوامر':'allcommands','الأوامر':'help','الاوامر':'help',
  'خصوصية':'privacy','حالة_الاتصال':'status','فحص':'ping','اختبار':'ping',
  'يوتيوب':'youtube','موسيقى':'music','اغنية':'music','أغنية':'music','بحث_موسيقى':'music','فيديو':'youtube','بحث_يوتيوب':'youtube','بلاي':'playstore','متجر':'playstore','متجر_بلاي':'playstore','apk':'apk','تطبيق':'apk','تطبيق_مفتوح':'apk','بحث':'websearch','سوشيال':'social','تحميل':'download','تنزيل':'download','تحميل_فيديو':'download','تحميل_صوت':'download','روابط_السوشيال':'social'
});


Object.assign(aliases,{
  'نسخة':'version','رقم_الحساب':'accountid','من_انا':'whoami','وقت_البوت':'uptime','حالة_الذكاء':'aistatus','حالة_الحماية':'protectionstatus','اعدادات_البوت':'botsettings','فحص_الاتصال':'connectioncheck','اعادة_تحميل':'reload','وقت_الخادم':'servertime',
  'كبير':'upper','صغير':'lower','بدون_مسافات':'nospace','ترقيم':'numberlines','طول':'strlen','كلمات_النص':'textwords','عكس_الكلمات':'reversewords','حروف_فريدة':'uniquechars','ازالة_الارقام':'remove_numbers','ازالة_الرموز':'remove_symbols','تشفير_نصي':'base64','فك_نصي':'unbase64',
  'جمع':'addnums','طرح':'subnums','ضرب':'mulnums','قسمة':'divnums','باقي':'modnums','مطلق':'absnum','مربع':'square','مكعب':'cube','محيط_الدائرة':'circlecirc','مساحة_الدائرة':'circlearea','محيط_المربع':'squarecirc','مساحة_المربع':'squarearea','تحويل_دقائق':'minutes','تحويل_ساعات':'hours',
  'كود':'randomcode','لون_عشوائي':'randomcolor','حرف_عشوائي':'randomchar','ايموجي_عشوائي':'randomemoji','نسبة_عشوائية':'randompercent','اختيار_رقم':'random','قائمة_عشوائية':'shuffle','رمز_قوي':'strongcode',
  'معلومات_الرسالة':'messageinfo','معرف_الرسالة':'messageid','وقت_الرسالة':'messagetime','نوع_الرسالة':'messagetype','طول_الرسالة':'messagelen',
  'اعدادات_المجموعة':'groupconfig','حالة_الحماية':'protectionstatus','عدد_التحذيرات':'warnings','رابط_المجموعة':'linkgroup',
  'اوامر_الترفيه':'fun','اوامر_الادوات':'toolcommands','الاوامر':'allcommands','أوامر':'allcommands','اوامر_البوت':'allcommands','أوامر_البوت':'allcommands',
  'لقب':'nickname','لقبي':'nickname','اسم_دلعي':'nickname','نكني':'nickname','حركة':'movefun','حركات':'movefun','رد_مضحك':'funnyreply','مقلب':'prankline','بايو':'bioidea','زخرفة':'decorate'
});
Object.assign(aliases,{
  'ذكاء_حسابي':'aiconfig','ai_account':'aiconfig','اعدادات_الذكاء':'aiconfig',
  'اللغة':'language','البادئة':'prefix',
  'كامل_الأوامر':'fullcommands','كامل_الاوامر':'fullcommands','كل_الأوامر_الكاملة':'fullcommands','كل_الاوامر_الكاملة':'fullcommands',
  'اوامر_كاملة':'fullcommands','أوامر_كاملة':'fullcommands'
});


const LUXURY_COMMANDS=[
 ['الأساسيات',['قائمة','مساعدة','بينغ','حي','حالة','وقت_التشغيل','تشغيل','اعادة_تشغيل','المطور','معلومات','معرف','معرفي','رقم_البوت','ذاكرة','الوقت','التاريخ','اليوم','الشهر','السنة']],
 ['الحساب والملف',['غيّر_اسمي','غيّر_حالتي','غيّر_صورتي','احذف_صورتي','خصوصية_الصورة','خصوصية_الحالة','خصوصية_الاخر','خصوصية_الاونلاين','خصوصية_القراءة','حظر','الغاء_حظر']],
 ['المجموعة',['معلومات_المجموعة','معرف_المجموعة','المشرفين','عدد_المشرفين','الاعضاء','عدد_الاعضاء','منشن_الكل','منشن_المشرفين','رابط','تغيير_الرابط','اسم','وصف','قفل','فتح','قفل_المعلومات','فتح_المعلومات','اضافة','ازالة','طرد','ترقية','تنزيل']],
 ['الحماية',['حماية','الغاء_الحماية','منع_الروابط','منع_الكلمات','منع_التكرار','منع_السبام','منع_المنشن','ترحيب','اضافة_كلمة','حذف_كلمة','كلمات_ممنوعة','حد_التحذير','تحذير','تحذيرات','مسح_تحذير','كتم','فك_كتم','حذف_رسالة']],
 ['الرسائل',['رد','حذف_رسالة','تثبيت','الغاء_التثبيت','نجمة','ازالة_النجمة','قل','عكس','عدد_الحروف','كلمات','اسطر','تنظيف','تكرار','تقسيم']],
 ['الأدوات',['حساب','نسبة','خصم','متوسط','اكبر','اصغر','تقريب','جذر','تربيع','اس','رقم_عشوائي','رمز_عشوائي','حروف_عشوائية']],
 ['الترفيه',['نكتة','حكمة','حظ','نرد','عملة','اختيار','حجر_ورق_مقص','نسبة_الحب','8ball','تحدي','هل_تعلم','معلومة','مزاج','قصة','مدح','ذم','اسم_عشوائي','نعم_لا','تخمين','لقب','حركة','رد_مضحك','مقلب','بايو','زخرفة']],
 ['الحالات',['مشاهدة_الحالات','تفاعل_الحالات','تفاعل','رد']],
 ['الذكاء الاصطناعي',['ذكاء','ذكاء_حسابي']],
 ['النظام والقناة',['القناة','حالة_القناة','اللغة','البادئة']],
 ['البحث والتنزيل',['موسيقى','تحميل','يوتيوب','فيديو','apk','بلاي','متجر','سوشيال']]
];

// FlowTech V31.2 expanded catalog: lightweight local commands that do not need external APIs.
LUXURY_COMMANDS.push(
 ['النظام المتقدم',['نسخة','رقم_الحساب','من_انا','وقت_البوت','حالة_الذكاء','حالة_الحماية','اعدادات_البوت','فحص_الاتصال','اعادة_تحميل','وقت_الخادم']],
 ['النصوص المتقدمة',['كبير','صغير','بدون_مسافات','ترقيم','طول','كلمات_النص','عكس_الكلمات','حروف_فريدة','ازالة_الارقام','ازالة_الرموز','تشفير_نصي','فك_نصي']],
 ['الحسابات المتقدمة',['جمع','طرح','ضرب','قسمة','باقي','مطلق','مربع','مكعب','محيط_الدائرة','مساحة_الدائرة','محيط_المربع','مساحة_المربع','تحويل_دقائق','تحويل_ساعات']],
 ['العشوائيات',['كود','لون_عشوائي','حرف_عشوائي','ايموجي_عشوائي','نسبة_عشوائية','اختيار_رقم','قائمة_عشوائية','رمز_قوي']],
 ['الرسائل المتقدمة',['معلومات_الرسالة','معرف_الرسالة','وقت_الرسالة','نوع_الرسالة','طول_الرسالة']],
 ['المجموعة المتقدمة',['اعدادات_المجموعة','حالة_الحماية','عدد_التحذيرات','منشن_المشرفين','رابط_المجموعة']],
 ['المساعدة السريعة',['الاوامر','اوامر','اوامر_البوت','أوامر_البوت','اوامر_المجموعة','اوامر_الحماية','اوامر_الترفيه','اوامر_الادوات']]
);

const luxuryCommandNames=new Set(LUXURY_COMMANDS.flatMap(([,items])=>items));

function parseCommand(text,prefix){if(!text?.startsWith('.'))return null;const raw=text.slice(1).trim();if(!raw)return null;const [command,...args]=raw.split(/\s+/);const normalized=command.toLowerCase().replace(/^\./,'');return{command:aliases[normalized]||normalized,args,raw}}
function textOf(m){return m.message?.conversation||m.message?.extendedTextMessage?.text||m.message?.imageMessage?.caption||m.message?.videoMessage?.caption||m.message?.documentMessage?.caption||''}
function unwrapInteractiveMessage(message){
  let msg=message||{};
  for(let i=0;i<6;i++){
    const next=msg?.viewOnceMessage?.message||msg?.viewOnceMessageV2?.message||msg?.ephemeralMessage?.message||msg?.documentWithCaptionMessage?.message||msg?.editedMessage?.message;
    if(!next||next===msg)break;
    msg=next;
  }
  return msg||{};
}
function interactiveId(m){
  const msg=unwrapInteractiveMessage(m?.message);
  const candidates=[
    msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
    msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJsonString,
    msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJsonBytes,
    msg.interactiveResponseMessage?.nativeFlowResponseMessage?.selectedButtonId,
    msg.interactiveResponseMessage?.paramsJson,
    msg.interactiveResponseMessage?.selectedId,
    msg.interactiveResponseMessage?.buttonReply?.id,
    msg.interactiveResponseMessage?.buttonReply?.buttonId,
    msg.templateButtonReplyMessage?.selectedId,
    msg.buttonsResponseMessage?.selectedButtonId,
    msg.buttonsResponseMessage?.selectedDisplayText,
    msg.listResponseMessage?.singleSelectReply?.selectedRowId
  ];
  for(const raw of candidates){
    if(!raw)continue;
    try{
      let value=raw;
      if(typeof Buffer!=='undefined' && Buffer.isBuffer(value))value=value.toString('utf8');
      else if(value instanceof Uint8Array)value=new TextDecoder().decode(value);
      const p=typeof value==='string'?JSON.parse(value):value;
      const id=p?.id||p?.selected_row_id||p?.button_id||p?.selectedId||p?.selected_button_id||p?.buttonReply?.id||p?.display_text;
      if(id)return String(id);
    }catch{}
  }
  return '';
}
function normalizeMenuText(text){
  return String(text||'')
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/[ًٌٍَُِّْـ]/g,'')
    .trim().toLowerCase()
    .replace(/^[.!#\s]+/,'')
    .replace(/[.!؟?،,؛;:]+$/g,'')
    .trim();
}
function isAllCommandsTrigger(text){
  const v=normalizeMenuText(text);
  return ['اوامر','أوامر','الأوامر','الاوامر','اوامر_البوت','أوامر_البوت','commands'].includes(v);
}
function isFullCommandsTrigger(text){
  const v=normalizeMenuText(text);
  return ['كل_الأوامر_الكاملة','كل_الاوامر_الكاملة','اوامر_كاملة','أوامر_كاملة','fullcommands'].includes(v);
}
function isMenuTrigger(text){
  const v=normalizeMenuText(text);
  return ['menu','قائمة','القائمة','بوت','مساعدة','help','menus'].includes(v);
}
function isStatusMessage(m){const jid=m.key?.remoteJid||'';return jid==='status@broadcast'||jid.endsWith('@broadcast')||Boolean(m.message?.statusMentionMessage)}
function statusKey(m){return `${m.key?.remoteJid||''}:${m.key?.id||''}:${m.key?.participant||m.key?.remoteJidAlt||''}`}
function participantIds(value){
  if(!value)return [];
  const out=[];
  for(const v of [value,value.id,value.jid,value.lid,value.phoneNumber]){
    if(typeof v==='string'&&v)out.push(v);
  }
  return [...new Set(out.map(v=>jidNormalizedUser(v)))];
}
function bareJid(v){return String(v||'').trim().toLowerCase().split(':')[0].split('@')[0]}
function sameJid(a,b){
  const A=participantIds(a),B=participantIds(b);
  if(A.some(x=>B.includes(x)))return true;
  const ab=new Set(A.map(bareJid)),bb=new Set(B.map(bareJid));
  for(const x of ab)for(const y of bb){
    if(x===y)return true;
    // Phone-number JIDs can be represented as PN while newer accounts/groups
    // may expose LID alongside phoneNumber. Match phone aliases when present.
    if(/^\d{7,15}$/.test(x)&&/^\d{7,15}$/.test(y)&&x===y)return true;
  }
  return false;
}
function senderCandidates(m,sender){
  return [sender,m?.key?.participant,m?.key?.participantAlt,m?.key?.remoteJidAlt].filter(Boolean);
}
function isAdmin(meta,jidOrCandidates){
  const wanted=Array.isArray(jidOrCandidates)?jidOrCandidates:[jidOrCandidates];
  return meta.participants.some(p=>['admin','superadmin'].includes(p.admin)&&wanted.some(id=>sameJid(p,id)));
}
function botIdentityCandidates(){
  const u=sock?.user||{};
  return [u.id,u.lid,u.jid,u.phoneNumber,u?.id?.split(':')[0]].filter(Boolean);
}
async function groupContext(jid){
  const meta=await sock.groupMetadata(jid);
  const me=botIdentityCandidates();
  const participant=meta.participants.find(p=>['admin','superadmin'].includes(p.admin)&&me.some(id=>sameJid(p,id)));
  const isBotAdmin=Boolean(participant);
  return{meta,isBotAdmin,botParticipant:participant};
}

function groupConfig(settings,jid){
  settings.groups=settings.groups||{};
  const saved=settings.groups[jid]||{};
  return {
    antilink:saved.antilink!==undefined?saved.antilink:Boolean(settings.antilink),
    antibadword:saved.antibadword!==undefined?saved.antibadword:Boolean(settings.antibadword),
    welcome:saved.welcome!==undefined?saved.welcome:Boolean(settings.welcome),
    antiflood:Boolean(saved.antiflood),
    antispam:Boolean(saved.antispam),
    antitag:Boolean(saved.antitag),
    warnLimit:Number(saved.warnLimit||3),
    welcomeText:String(saved.welcomeText||'👋 أهلاً بك في المجموعة! مرحبًا بك مع FlowTech.')
  };
}
function setGroupConfig(settings,jid,patch){
  settings.groups=settings.groups||{};
  settings.groups[jid]={...(settings.groups[jid]||{}),...patch};
  saveSettings(settings);
  return groupConfig(settings,jid);
}
function floodHit(jid,sender,text){
  const now=Date.now();const key=`${jid}:${sender}`;const arr=(floodState.get(key)||[]).filter(x=>now-x.time<8000);arr.push({time:now,text:String(text||'').slice(0,300)});floodState.set(key,arr);return arr.length>=5;}
function spamHit(jid,sender,text){
  const now=Date.now();const key=`${jid}:${sender}`;const normalized=String(text||'').trim().toLowerCase();if(!normalized)return false;const arr=(spamState.get(key)||[]).filter(x=>now-x.time<10000);arr.push({time:now,text:normalized});spamState.set(key,arr);return arr.filter(x=>x.text===normalized).length>=3;}
function commandError(e){
  const msg=String(e?.message||e||'').toLowerCase();
  if(/not authorized|forbidden|permission|not allowed|unauthorized|admin/i.test(msg))return '❌ واتساب رفض العملية. تأكد أن البوت مشرف وأن الحساب المستهدف ليس أعلى من البوت في الصلاحيات.';
  return `❌ تعذر تنفيذ الأمر: ${String(e?.message||e||'خطأ').slice(0,240)}`;
}
function targetFromMessage(m,args){const ctx=m.message?.extendedTextMessage?.contextInfo;const list=ctx?.mentionedJid||[];if(list[0])return jidNormalizedUser(list[0]);if(ctx?.participant)return jidNormalizedUser(ctx.participant);const num=args.find(a=>/^\d{7,15}$/.test(a.replace(/\D/g,'')));return num?`${num.replace(/\D/g,'')}@s.whatsapp.net`:null}
async function reply(jid,text,opts={}){const result=await sock.sendMessage(jid,{text:String(text)},opts);try{const id=result?.key?.id;if(id)contextFor().outgoingIds.add(id)}catch{}return result}

function menuRows(lang){
  const ar=lang==='ar';
  return [
    {header:'👑',title:ar?'المجموعات والإدارة':'Groups & Admin',description:ar?'إدارة الأعضاء والمجموعة':'Group management',id:'cat_owner'},
    {header:'🛡️',title:ar?'الحماية والأمان':'Protection & Security',description:ar?'الحماية من الروابط والسبام':'Security tools',id:'cat_security'},
    {header:'🧰',title:ar?'الأدوات والخدمات':'Tools & Services',description:ar?'أدوات يومية وحسابات':'Useful tools',id:'cat_tools'},
    {header:'❤️',title:ar?'الحالات والتفاعل':'Status & Reactions',description:ar?'مشاهدة وتفاعل تلقائي':'Status automation',id:'cat_status'},
    {header:'🧠',title:ar?'الذكاء الاصطناعي':'AI',description:ar?'محادثة ومساعد ذكي':'AI assistant',id:'cat_ai'},
    {header:'🎮',title:ar?'الترفيه والألعاب':'Fun & Games',description:ar?'ألعاب ومحتوى ترفيهي':'Games & fun',id:'cat_fun'},
    {header:'🔎',title:ar?'البحث والخدمات':'Search & Services',description:ar?'YouTube وPlay Store وروابط السوشيال':'Search services',id:'cat_search'},
    {header:'💬',title:ar?'الرسائل والنصوص':'Messages & Text',description:ar?'تنسيق وتحويل وتحليل النصوص':'Text utilities',id:'cat_text'},
    {header:'ℹ️',title:ar?'المساعدة ومعلومات البوت':'Help & Info',description:ar?'المساعدة والقائمة الكاملة':'Help and bot info',id:'cat_help'}
  ];
}
function menuCaption(lang,prefix){
  const ar=lang==='ar';
  return `╭━━━〔 FLOWTECH 〕━━━╮\n`+
    `${ar?'✦ قائمة البوت ✦':'✦ BOT MENU ✦'}\n`+
    `${ar?'👤 المستخدم:':'👤 User:'} @${jidNormalizedUser(sock?.user?.id||'').split('@')[0]||'FlowTech'}\n`+
    `${ar?'🕒 الوقت:':'🕒 Time:'} ${new Date().toLocaleTimeString('ar-YE')}\n`+
    `╰━━━━━━━━━━━━━━━━━━╯\n\n`+
    `${ar?'✨ اختر القسم من الأزرار أسفل هذه الرسالة.':'✨ Choose a category using the buttons below.'}`;
}
function quickButtonPayload(rows){
  return rows.map(r=>({
    name:'quick_reply',
    buttonParamsJson:JSON.stringify({display_text:r.title,id:r.id})
  }));
}
async function sendQuickButtons(jid,rows,title,quoted){
  const buttons=quickButtonPayload(rows);
  const body=title||'اختر القسم الذي تريده:';
  const candidates=[
    {interactiveMessage:{header:{title:'FlowTech',hasMediaAttachment:false},body:{text:body},footer:{text:'FlowTech • WhatsApp'},nativeFlowMessage:{buttons,messageParamsJson:''}}},
    {interactiveMessage:{body:{text:body},footer:{text:'FlowTech • WhatsApp'},nativeFlowMessage:{buttons,messageParamsJson:''}}}
  ];
  let lastError=null;
  for(const content of candidates){
    try{await sock.sendMessage(jid,content,{quoted});return true;}catch(e){lastError=e;}
  }
  try{
    const generated=generateWAMessageFromContent(jid,{viewOnceMessage:{message:{messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},interactiveMessage:proto.Message.InteractiveMessage.fromObject({body:{text:body},footer:{text:'FlowTech • WhatsApp'},nativeFlowMessage:{buttons,messageParamsJson:''}})}}},{quoted});
    await sock.relayMessage(jid,generated.message,{messageId:generated.key.id});
    return true;
  }catch(e){lastError=e;}
  emit({type:'menu_button_error',message:lastError?.message||String(lastError||'تعذر إرسال الأزرار')});
  return false;
}
function menuButtonRows(lang){
  const ar=lang==='ar';
  return menuRows(lang).map(r=>({id:r.id,title:`${r.header} ${r.title}`}));
}
async function sendMenu(jid,lang,prefix,quoted){
  const ar=lang==='ar';
  const imagePath='./public/assets/flowtech-banner.png';
  const caption=`╭━〔 FLOWTECH • ${ar?'القائمة الرئيسية':'MAIN MENU'} 〕━╮\n\n`+
    `${ar?'✨ اختر القسم بإرسال رقم واحد فقط:':'✨ Send one number to open a category:'}\n\n`+
    `1️⃣ 👑 ${ar?'المالك والمجموعات':'Owner & Groups'}\n`+
    `2️⃣ 🛡️ ${ar?'الحماية والأمان':'Protection & Security'}\n`+
    `3️⃣ 🧰 ${ar?'الأدوات والخدمات':'Tools & Services'}\n`+
    `4️⃣ ❤️ ${ar?'الحالات والتفاعل':'Status & Reactions'}\n`+
    `5️⃣ 🧠 ${ar?'الذكاء الاصطناعي':'Artificial Intelligence'}\n`+
    `6️⃣ 🎮 ${ar?'الترفيه والألعاب':'Fun & Games'}\n`+
    `7️⃣ 🔎 ${ar?'البحث والخدمات':'Search & Services'}\n`+
    `8️⃣ 💬 ${ar?'الرسائل والنصوص':'Messages & Text'}\n`+
    `9️⃣ ℹ️ ${ar?'المساعدة ومعلومات البوت':'Help & Bot Info'}\n\n`+
    `${ar?'📌 مثال: أرسل 6 للترفيه، أو 7 للبحث، أو 9 للمساعدة.':'📌 Example: send 6 for fun, 7 for search, or 9 for help.'}\n`+
    `╰━━━━━━━━━━━━━━━╯`;

  // V26 reliability is preserved: the text menu always works even when native UI is unavailable.
  // The wide banner is sent with the menu caption so the root menu is visually clear.
  if(fs.existsSync(imagePath)){
    try{
      const buffer=fs.readFileSync(imagePath);
      await sock.sendMessage(jid,{image:buffer,caption},{quoted});
    }catch(e){
      emit({type:'menu_banner_error',message:e?.message||String(e)});
      await reply(jid,caption,{quoted}).catch(()=>{});
    }
  }else{
    await reply(jid,caption,{quoted}).catch(()=>{});
  }

  // Optional native buttons. They are only an enhancement; they never replace the numbered menu.
  try{
    const rows=menuRows(lang).map((r,i)=>({id:r.id,title:`${i+1}️⃣ ${r.title}`}));
    await sendQuickButtons(jid,rows.slice(0,3),'📋 الأقسام 1–3:',quoted);
    await sendQuickButtons(jid,rows.slice(3,6),'📋 الأقسام 4–6:',quoted);
    await sendQuickButtons(jid,rows.slice(6,9),'📋 الأقسام 7–9:',quoted);
  }catch(e){emit({type:'menu_buttons_error',message:e?.message||String(e)});}
  return true;
}

async function handleInteractive(m,jid,settings){
  const id=m.__flowMenuId||interactiveId(m);if(!id)return false;
  const lang=settings.language;
  if(id==='menu_root'){await sendMenu(jid,lang,settings.prefix,m);return true}
  const category={
    cat_owner:['👑 المجموعات والإدارة',
      '📌 .معلومات_المجموعة — معلومات المجموعة','🆔 .معرف_المجموعة — معرف المجموعة','👮 .المشرفين — قائمة المشرفين','👥 .الاعضاء — عدد الأعضاء',
      '📢 .منشن_الكل — منشن الجميع','👮 .منشن_المشرفين — منشن المشرفين','🔗 .رابط — رابط الدعوة','♻️ .تغيير_الرابط — تغيير الرابط',
      '✏️ .اسم <الاسم> — تغيير اسم المجموعة','📝 .وصف <الوصف> — تغيير الوصف','➕ .اضافة <رقم> — إضافة عضو','➖ .ازالة @عضو — إزالة عضو',
      '🚪 .طرد @عضو — طرد عضو','⬆️ .ترقية @عضو — ترقية عضو','⬇️ .تنزيل @عضو — إزالة الإشراف','🔒 .قفل — قفل المجموعة','🔓 .فتح — فتح المجموعة'],
    cat_security:['🛡️ الحماية والأمان',
      '🛡️ .حماية — تشغيل الحماية','🔓 .الغاء_الحماية — إيقاف الحماية','🚫 .منع_الروابط تشغيل — مضاد الروابط','🤬 .منع_الكلمات تشغيل — مضاد الكلمات',
      '🔁 .منع_التكرار تشغيل — مضاد التكرار','🚨 .منع_السبام تشغيل — مضاد السبام','🎯 .منع_المنشن تشغيل — منع المنشن الجماعي','👋 .ترحيب تشغيل — ترحيب الأعضاء',
      '➕ .اضافة_كلمة كلمة — إضافة كلمة ممنوعة','➖ .حذف_كلمة كلمة — حذف كلمة ممنوعة','📋 .كلمات_ممنوعة — عرض الكلمات','⚠️ .حد_التحذير 3 — حد التحذيرات',
      '⚠️ .تحذير @عضو — تحذير عضو','📊 .تحذيرات — عرض التحذيرات','🧹 .مسح_تحذير @عضو — مسح التحذيرات','🔇 .كتم @عضو — كتم عضو','🔊 .فك_كتم @عضو — فك الكتم'],
    cat_tools:['🧰 الأدوات والخدمات',
      '🏓 .بينغ — اختبار الاستجابة','⚡ .حي — حالة البوت','📡 .حالة — حالة الاتصال','⏱️ .وقت_التشغيل — مدة التشغيل','🕒 .الوقت — الوقت الحالي','📅 .التاريخ — التاريخ',
      '🧮 .حساب 25*4+10 — آلة حاسبة','📊 .نسبة 25 200 — نسبة مئوية','🏷️ .خصم 1000 20 — حساب الخصم','📐 .جذر 144 — الجذر','🔢 .تربيع 12 — التربيع',
      '🔐 .رمز_عشوائي 12 — رمز عشوائي','🎲 .رقم_عشوائي 1 100 — رقم عشوائي','🔤 .حروف_عشوائية 10 — حروف عشوائية','🎨 .لون_عشوائي — لون HEX'],
    cat_status:['❤️ الحالات والتفاعل',
      '👁️ .مشاهدة_الحالات تشغيل — مشاهدة الحالات تلقائيًا','💚 .تفاعل_الحالات تشغيل — التفاعل التلقائي','🎨 .تفاعل_الحالات ❤️ — اختيار الإيموجي','💬 .رد ❤️ — التفاعل مع رسالة بالرد'],
    cat_ai:['🧠 الذكاء الاصطناعي',
      '🧠 .ذكاء تشغيل — تشغيل AI','⛔ .ذكاء إيقاف — إيقاف AI','💬 .ذكاء <سؤالك> — سؤال الذكاء','⚙️ .ذكاء_حسابي — إعدادات AI','📡 .حالة_الذكاء — حالة AI'],
    cat_fun:['🎮 الترفيه والألعاب',
      '😂 .نكتة — نكتة','💡 .حكمة — حكمة','🍀 .حظ — الحظ','🎲 .نرد — نرد','🪙 .عملة — عملة','🎯 .اختيار خيار1 | خيار2 — اختيار عشوائي',
      '✊ .حجر_ورق_مقص حجر — لعبة','❤️ .نسبة_الحب — نسبة الحب','🎱 .8ball سؤالك — كرة سحرية','🔥 .تحدي — تحدي','🧠 .هل_تعلم — معلومة',
      '😊 .مزاج — مزاج','📖 .قصة — قصة','👏 .مدح — مدح','🌶️ .ذم — مزحة','🪪 .اسم_عشوائي — اسم عشوائي','🏷️ .لقب [اسم] — اقتراح لقب مضحك','🕺 .حركة — حركة عشوائية للمجموعة','😂 .رد_مضحك — رد طريف جاهز','🎭 .مقلب — مقلب خفيف','📝 .بايو — اقتراح نبذة','✨ .زخرفة نص — زخرفة الاسم أو النص','✅ .نعم_لا — نعم أو لا'],
    cat_search:['🔎 البحث والخدمات',
      '🎵 .موسيقى <اسم> — البحث عن الأغنية ثم اختيارها وتحميلها MP3','▶️ .يوتيوب <اسم> — البحث عن فيديو ثم اختيار النتيجة','⬇️ .تحميل <رابط> — اختيار فيديو أو صوت للرابط العام','📱 .apk <اسم> — بحث وتحميل APK رسمي من F-Droid','🛍️ .بلاي <اسم تطبيق> — البحث في Google Play',
      '🌐 .سوشيال <رابط> — التعرف على منصة الرابط','🔗 .بحث <كلمات> — إنشاء رابط بحث ويب مباشر','📺 .فيديو <كلمات> — بحث فيديو في YouTube',
      '🛒 .متجر <كلمات> — بحث تطبيقات في Google Play'],
    cat_text:['💬 الرسائل والنصوص',
      '🗣️ .قل <نص> — إرسال النص','🔄 .عكس <نص> — عكس النص','🔢 .عدد_الحروف <نص> — عد الأحرف','📝 .كلمات <نص> — عد الكلمات','📄 .اسطر <نص> — عد الأسطر',
      '🧹 .تنظيف <نص> — تنظيف المسافات','🔁 .تكرار 3 <نص> — تكرار النص','✂️ .تقسيم <نص> — تقسيم النص','🔠 .كبير <نص> — أحرف كبيرة','🔡 .صغير <نص> — أحرف صغيرة',
      '🚫 .بدون_مسافات <نص> — إزالة المسافات','🔢 .ترقيم <نص> — ترقيم الأسطر','🧩 .حروف_فريدة <نص> — إزالة التكرار','🔣 .ازالة_الرموز <نص> — إزالة الرموز'],
    cat_help:['ℹ️ المساعدة ومعلومات البوت',
      '📋 .اوامر — فتح الأقسام','📚 .كل_الأوامر_الكاملة — القائمة الكاملة','👑 .اوامر_المجموعة — أوامر المجموعة','🛡️ .اوامر_الحماية — أوامر الحماية','🎮 .ترفيه — أوامر الترفيه',
      '🔎 .يوتيوب <اسم> — بحث YouTube','📱 .بلاي <اسم> — بحث Play Store','👨‍💻 .المطور — معلومات المطور','🤖 .معلومات — معلومات البوت']
  };
  if(category[id]){
    const [title,...items]=category[id];
    const body=`╭━━〔 FLOWTECH • ${title} 〕━━╮\n\n${items.map((line,i)=>`${String(i+1).padStart(2,'0')} ${line}`).join('\n')}\n\n╰━━━━━━━━━━━━━━━━━━╯`;
    const imagePath='./public/assets/flowtech-banner.png';
    if(fs.existsSync(imagePath)){
      try{await sock.sendMessage(jid,{image:fs.readFileSync(imagePath),caption:body},{quoted:m});}
      catch{await reply(jid,body,{quoted:m});}
    }else await reply(jid,body,{quoted:m});
    try{await sendQuickButtons(jid,[{id:'menu_root',title:'↩️ القائمة الرئيسية'}],'↩️ العودة للأقسام:',m)}catch{}
    return true;
  }
  return false;
}

async function handleMenuNumber(m,jid,text,settings){
  const value=String(text||'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const ids=['cat_owner','cat_security','cat_tools','cat_status','cat_ai','cat_fun','cat_search','cat_text','cat_help'];
  if(!/^[1-9]$/.test(value))return false;
  return handleInteractive({message:{conversation:value},key:m.key,__flowMenuId:ids[Number(value)-1]},jid,settings);
}

function senderPhone(jid){
  const raw=String(jidNormalizedUser(jid)||'');
  const digits=raw.split('@')[0].replace(/\D/g,'');
  return digits.length>=7&&digits.length<=15?digits:'';
}
function normalizeIdentity(v){
  const raw=String(v||'').trim();
  if(!raw)return '';
  const base=raw.split('@')[0].split(':')[0];
  const digits=base.replace(/\D/g,'');
  return digits.length>=7&&digits.length<=15?digits:'';
}
async function resolvePhoneJid(v){
  const raw=String(v||'');
  if(!raw)return '';
  if(raw.includes('@lid')){
    try{
      const pn=await sock?.signalRepository?.lidMapping?.getPNForLID?.(jidNormalizedUser(raw));
      if(pn)return jidNormalizedUser(pn);
    }catch{}
  }
  return jidNormalizedUser(raw);
}
async function aiIdentityKeys(m,jid,sender){
  const values=[sender,m?.key?.participant,m?.key?.participantAlt,m?.key?.remoteJidAlt,jid];
  if(isJidGroup(jid)){
    try{
      const meta=await sock.groupMetadata(jid);
      for(const p of meta.participants||[]){
        if(values.some(v=>sameJid(p,v))) values.push(p.phoneNumber,p.id,p.jid,p.lid);
      }
    }catch{}
  }
  const resolved=[];
  for(const value of values){
    const pn=await resolvePhoneJid(value);
    const key=normalizeIdentity(pn)||normalizeIdentity(value);
    if(key)resolved.push(key);
  }
  return [...new Set(resolved)];
}
async function getAIUserForMessage(settings,m,jid,sender){
  settings.aiUsers=settings.aiUsers||{};
  const keys=await aiIdentityKeys(m,jid,sender);
  for(const key of keys){
    const u=settings.aiUsers[key];
    if(u)return {user:u,key,keys,source:'sender'};
  }
  // Also support the bot/account number saved in the dashboard. This is the
  // normal setup when one API key should power replies for everyone who chats
  // with the connected WhatsApp account.
  const botValues=[sock?.user?.id,sock?.user?.lid,sock?.user?.phoneNumber];
  for(const value of botValues){
    const pn=await resolvePhoneJid(value);
    const key=normalizeIdentity(pn)||normalizeIdentity(value);
    if(key&&settings.aiUsers[key])return {user:settings.aiUsers[key],key,keys,source:'bot'};
  }
  const configured=Object.entries(settings.aiUsers).filter(([,u])=>u?.apiKey&&u?.enabled);
  if(configured.length===1){
    const [key,user]=configured[0];
    return {user,key,keys,source:'single-config-fallback'};
  }
  return {user:null,key:keys[0]||'',keys,source:null};
}
function aiConfigFor(settings,jid){
  const key=senderPhone(jid);const u=settings.aiUsers?.[key];
  if(u?.enabled&&u.apiKey)return {...u,enabled:true};
  if(settings.aiEnabled){
    const apiKey=settings.aiProvider==='openai'?process.env.OPENAI_API_KEY:process.env.GEMINI_API_KEY;
    if(apiKey)return {enabled:true,provider:settings.aiProvider,model:settings.aiModel,systemPrompt:settings.aiSystemPrompt,apiKey,groupMode:settings.aiGroupMode,privateEnabled:settings.aiPrivate};
  }
  return null;
}
async function resolveAIIdentity(jid,sender){
  if(!isJidGroup(jid))return sender;
  try{
    const meta=await sock.groupMetadata(jid);
    const p=meta.participants.find(x=>sameJid(x,sender));
    return p?.phoneNumber||p?.id||p?.lid||sender;
  }catch{return sender;}
}
function mediaMessageInfo(message){
  if(!message)return null;
  if(message.imageMessage&&!message.imageMessage.viewOnce)return {type:'image',content:message.imageMessage};
  if(message.videoMessage&&!message.videoMessage.viewOnce)return {type:'video',content:message.videoMessage};
  if(message.documentMessage&&!message.documentMessage.viewOnce)return {type:'document',content:message.documentMessage};
  return null;
}
function getQuotedMessage(m){
  return m.message?.extendedTextMessage?.contextInfo?.quotedMessage||m.message?.imageMessage?.contextInfo?.quotedMessage||m.message?.videoMessage?.contextInfo?.quotedMessage||null;
}
async function saveQuotedRegularMediaToSelf(m,jid){
  const quoted=getQuotedMessage(m);
  const info=mediaMessageInfo(quoted);
  if(!info)return false;
  if(!sock?.user?.id)return false;
  try{
    const fake={key:{remoteJid:jid,id:m.message?.extendedTextMessage?.contextInfo?.stanzaId||m.key.id,fromMe:false,participant:m.key.participant},message:{[`${info.type}Message`]:info.content}};
    const buffer=await downloadMediaMessage(fake,'buffer',{}, {logger});
    const self=jidNormalizedUser(sock.user.id);
    if(info.type==='image')await sock.sendMessage(self,{image:buffer,caption:'📥 تم حفظ الصورة التي رددت عليها.'});
    else if(info.type==='video')await sock.sendMessage(self,{video:buffer,caption:'📥 تم حفظ الفيديو الذي رددت عليه.'});
    else await sock.sendMessage(self,{document:buffer,mimetype:info.content.mimetype||'application/octet-stream',fileName:info.content.fileName||'media',caption:'📥 تم حفظ الملف الذي رددت عليه.'});
    await reply(jid,'📥 تم حفظ الوسائط المرسلة بشكل عادي في رسائلك الخاصة.');
    return true;
  }catch(e){emit({type:'media_save_error',message:e?.message||String(e)});return false;}
}


async function sendCommandCatalog(jid,settings,m=null){
  const prefix=settings.prefix||'.';
  const total=LUXURY_COMMANDS.reduce((n,[,items])=>n+items.length,0);
  const emoji={
    'الأساسيات':'⚡','الحساب والملف':'👤','المجموعة':'👥','الحماية':'🛡️','الرسائل':'💬','الأدوات':'🧰','الترفيه':'🎮','الحالات':'❤️','الذكاء الاصطناعي':'🧠','النظام والقناة':'🌐','النظام المتقدم':'⚙️','النصوص المتقدمة':'📝','الحسابات المتقدمة':'🧮','العشوائيات':'🎲','الرسائل المتقدمة':'📨','المجموعة المتقدمة':'🔧','المساعدة السريعة':'❓'
  };
  await reply(jid,`╭━━〔 FLOWTECH • ${total} أمرًا 〕━━╮\n📚 أرسل رقم القسم من القائمة الرئيسية لعرضه فقط.\n📌 لعرض هذه القائمة الكاملة استخدم ${prefix}كل_الأوامر_الكاملة\n╰━━━━━━━━━━━━━━━━━━╯`,m?{quoted:m}:{});
  for(const [cat,items] of LUXURY_COMMANDS){
    const lines=items.map((x,i)=>`${emoji[cat]||'🔹'} ${i+1}. ${prefix}${x}`);
    for(let i=0;i<lines.length;i+=14){
      const part=lines.slice(i,i+14).join('\n');
      await reply(jid,`【${emoji[cat]||'🔹'} ${cat}】\n${part}`,m?{quoted:m}:{});
    }
  }
  return true;
}

async function handleCommand(m,jid,sender,text,settings){
  const parsed=parseCommand(text,settings.prefix);if(!parsed)return false;const{command,args}=parsed;const lang=settings.language;const group=isJidGroup(jid);const send=x=>reply(jid,x,{quoted:m});
  if(await handleExtraCommand(command,args,m,jid,sender,settings))return true;
  if(command==='menu'||command==='help'||command==='allcommands'){await sendMenu(jid,lang,settings.prefix,m);return true}
  if(command==='fullcommands'){await sendCommandCatalog(jid,settings,m);return true}
  if(command==='ping'){await send(`🏓 ${tr(lang,'ping')}`);return true}
  if(command==='alive'){await send(`⚡ FlowTech يعمل الآن.\n📡 ${contextFor().state}\n🕒 ${new Date().toLocaleTimeString('ar-YE')}`);return true}
  if(command==='runtime'){const uptime=Math.floor(process.uptime());const h=Math.floor(uptime/3600),m=Math.floor((uptime%3600)/60),sec=uptime%60;await send(`⏱️ مدة التشغيل: ${h}س ${m}د ${sec}ث`);return true}
  if(command==='start'||command==='restart'){await startBot(currentUserId());await send('♻️ تم طلب إعادة الاتصال.');return true}
  if(command==='status'){await send(`📡 ${tr(lang,'status')}\n${tr(lang,'prefix')}: ${settings.prefix}\n${tr(lang,'language')}: ${lang}\n👁️ Status view: ${settings.statusAutoView?'ON':'OFF'}\n❤️ Status reaction: ${settings.statusAutoReact?'ON':'OFF'}\n🧠 AI: ${settings.aiEnabled?'ON':'OFF'}`);return true}
  if(command==='owner'){await send(`👨‍💻 المطورون / Developers\n• أحمد العباسي — https://wa.me/${process.env.DEV2_PHONE||'967739020737'}\n• القميشي — https://wa.me/${process.env.CONTACT_PHONE||process.env.OWNER_PHONE||''}`);return true}
  if(command==='info'){await send(`🤖 FlowTech\n👨‍💻 المطورون / Developers: أحمد العباسي • القميشي\n🌐 ${process.env.PUBLIC_URL||'Local / private'}`);return true}
  if(command==='menu_basic'){await send(`${settings.prefix}ping\n${settings.prefix}status\n${settings.prefix}owner\n${settings.prefix}info`);return true}
  if(command==='menu_group'){await send(`${settings.prefix}kick @user\n${settings.prefix}promote @user\n${settings.prefix}demote @user\n${settings.prefix}warn @user\n${settings.prefix}tagall`);return true}
  if(command==='menu_protection'){await send(`${settings.prefix}antilink on|off\n${settings.prefix}antibadword on|off\n${settings.prefix}welcome on|off`);return true}
  if(command==='menu_status'){await send(`${settings.prefix}statusview on|off\n${settings.prefix}statusreact on|off\n${settings.prefix}statusreact ❤️|😂|🔥|😍|😮|😢|👏`);return true}
  if(command==='menu_ai'){await send(`${settings.prefix}ai on|off\n${settings.prefix}ai provider openai|gemini\n${settings.prefix}ai ask سؤالك`);return true}
  if(command==='menu_settings'){await send(`${settings.prefix}status\n${settings.prefix}prefix\n${settings.prefix}stop`);return true}
  if(command==='allcommands'){
    await send(`╭〔جميع الٲوامر 〕╮\n\n👑 المجموعة والإدارة\n${settings.prefix}معلومات_المجموعة • ${settings.prefix}معرف_المجموعة • ${settings.prefix}المشرفين • ${settings.prefix}الاعضاء • ${settings.prefix}منشن_الكل • ${settings.prefix}رابط • ${settings.prefix}تغيير_الرابط • ${settings.prefix}اسم • ${settings.prefix}وصف • ${settings.prefix}قفل • ${settings.prefix}فتح • ${settings.prefix}اضافة • ${settings.prefix}ازالة • ${settings.prefix}طرد • ${settings.prefix}ترقية • ${settings.prefix}تنزيل\n\n🛡️ الحماية\n${settings.prefix}حماية • ${settings.prefix}الغاء_الحماية • ${settings.prefix}منع_الروابط • ${settings.prefix}منع_الكلمات • ${settings.prefix}منع_التكرار • ${settings.prefix}منع_السبام • ${settings.prefix}منع_المنشن • ${settings.prefix}ترحيب • ${settings.prefix}اضافة_كلمة • ${settings.prefix}حذف_كلمة • ${settings.prefix}كلمات_ممنوعة • ${settings.prefix}حد_التحذير • ${settings.prefix}تحذير • ${settings.prefix}تحذيرات • ${settings.prefix}مسح_تحذير • ${settings.prefix}كتم • ${settings.prefix}فك_كتم • ${settings.prefix}حذف_رسالة\n\n❤️ الحالات\n${settings.prefix}مشاهدة_الحالات • ${settings.prefix}تفاعل_الحالات • ${settings.prefix}رد\n\n🧠 الذكاء\n${settings.prefix}ذكاء • ${settings.prefix}ذكاء_حسابي\n\n🤖 أساسية\n${settings.prefix}قائمة • ${settings.prefix}مساعدة • ${settings.prefix}بينغ • ${settings.prefix}حي • ${settings.prefix}حالة • ${settings.prefix}وقت_التشغيل • ${settings.prefix}المطور • ${settings.prefix}معلومات • ${settings.prefix}معرف • ${settings.prefix}تشغيل • ${settings.prefix}اعادة_تشغيل • ${settings.prefix}الوقت • ${settings.prefix}التاريخ • ${settings.prefix}حساب • ${settings.prefix}قل • ${settings.prefix}عكس • ${settings.prefix}عدد_الحروف • ${settings.prefix}القناة • ${settings.prefix}حالة_القناة • ${settings.prefix}رقم_البوت • ${settings.prefix}ذاكرة\n\n╰─────────────────╯`);
    return true;
  }
  if(command==='groupcommands'){
    await send(`╭─〔 أوامر المجموعات 〕─╮\n\n${settings.prefix}معلومات_المجموعة\n${settings.prefix}معرف_المجموعة\n${settings.prefix}المشرفين\n${settings.prefix}الاعضاء\n${settings.prefix}منشن_الكل\n${settings.prefix}رابط\n${settings.prefix}تغيير_الرابط\n${settings.prefix}اسم <الاسم>\n${settings.prefix}وصف <الوصف>\n${settings.prefix}قفل / ${settings.prefix}فتح\n${settings.prefix}اضافة <رقم>\n${settings.prefix}ازالة @عضو\n${settings.prefix}طرد @عضو\n${settings.prefix}ترقية @عضو\n${settings.prefix}تنزيل @عضو\n${settings.prefix}تحذير @عضو\n${settings.prefix}تحذيرات\n${settings.prefix}مسح_تحذير @عضو\n${settings.prefix}حد_التحذير 3\n${settings.prefix}كتم @عضو\n${settings.prefix}فك_كتم @عضو\n${settings.prefix}حماية / ${settings.prefix}الغاء_الحماية\n${settings.prefix}منع_الروابط تشغيل|إيقاف\n${settings.prefix}منع_الكلمات تشغيل|إيقاف\n${settings.prefix}منع_التكرار تشغيل|إيقاف\n${settings.prefix}منع_السبام تشغيل|إيقاف\n${settings.prefix}منع_المنشن تشغيل|إيقاف\n${settings.prefix}ترحيب تشغيل|إيقاف\n${settings.prefix}اضافة_كلمة كلمة1,كلمة2\n${settings.prefix}حذف_كلمة كلمة\n${settings.prefix}كلمات_ممنوعة\n${settings.prefix}حذف_رسالة بالرد\n\n╰────────────────────╯`);
    return true;
  }
  if(command==='protectioncommands'){await send(`🛡️ أوامر الحماية\n${settings.prefix}حماية\n${settings.prefix}الغاء_الحماية\n${settings.prefix}منع_الروابط تشغيل|إيقاف\n${settings.prefix}منع_الكلمات تشغيل|إيقاف\n${settings.prefix}منع_التكرار تشغيل|إيقاف\n${settings.prefix}منع_السبام تشغيل|إيقاف\n${settings.prefix}منع_المنشن تشغيل|إيقاف\n${settings.prefix}ترحيب تشغيل|إيقاف\n${settings.prefix}اضافة_كلمة كلمة1,كلمة2\n${settings.prefix}حذف_كلمة كلمة\n${settings.prefix}كلمات_ممنوعة\n${settings.prefix}حد_التحذير 3\n${settings.prefix}تحذير @عضو\n${settings.prefix}تحذيرات\n${settings.prefix}مسح_تحذير @عضو\n${settings.prefix}كتم @عضو\n${settings.prefix}فك_كتم @عضو`);return true}
  if(command==='groupid'){if(!group){await send(tr(lang,'groupOnly'));return true}await send(`🆔 معرف المجموعة:\n${jid}`);return true}
  if(command==='groupinfo'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);await send(`👥 ${meta.subject}\n🆔 ${jid}\n👤 الأعضاء: ${meta.participants.length}\n👮 المشرفون: ${meta.participants.filter(p=>['admin','superadmin'].includes(p.admin)).length}`);return true}
  if(command==='admins'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);const a=meta.participants.filter(p=>['admin','superadmin'].includes(p.admin));await sock.sendMessage(jid,{text:'👮 المشرفون:\n'+a.map(x=>'@'+x.id.split('@')[0]).join('\n'),mentions:a.map(x=>x.id)},{quoted:m});return true}
  if(command==='members'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);await send(`👥 عدد الأعضاء: ${meta.participants.length}`);return true}
  if(command==='linkgroup'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}if(!isBotAdmin){await send(tr(lang,'noPermission'));return true}try{const code=await sock.groupInviteCode(jid);await send(`🔗 رابط المجموعة:\nhttps://chat.whatsapp.com/${code}`);}catch(e){await send(commandError(e));}return true}
  if(command==='revoke'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}if(!isBotAdmin){await send(tr(lang,'noPermission'));return true}try{await sock.groupRevokeInvite(jid);await send('🔐 تم إبطال رابط الدعوة السابق وإنشاء رابط جديد.');}catch(e){await send(commandError(e));}return true}
  if(command==='setname'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}if(!isBotAdmin){await send(tr(lang,'noPermission'));return true}const name=args.join(' ').trim();if(!name){await send(`${settings.prefix}اسم الاسم_الجديد`);return true}try{await sock.groupUpdateSubject(jid,name);await send('✅ تم تغيير اسم المجموعة.');}catch(e){await send(commandError(e));}return true}
  if(command==='setdesc'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}if(!isBotAdmin){await send(tr(lang,'noPermission'));return true}const desc=args.join(' ').trim();if(!desc){await send(`${settings.prefix}وصف الوصف_الجديد`);return true}try{await sock.groupUpdateDescription(jid,desc);await send('✅ تم تحديث وصف المجموعة.');}catch(e){await send(commandError(e));}return true}
  if(command==='lock'||command==='unlock'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}if(!isBotAdmin){await send(tr(lang,'noPermission'));return true}try{await sock.groupSettingUpdate(jid,command==='lock'?'announcement':'not_announcement');await send(command==='lock'?'🔒 تم قفل المجموعة للمشرفين.':'🔓 تم فتح المجموعة للأعضاء.');}catch(e){await send(commandError(e));}return true}
  if(command==='add'||command==='remove'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}if(!isBotAdmin){await send(tr(lang,'noPermission'));return true}const target=targetFromMessage(m,args);if(!target){await send(`${settings.prefix}${command} 9677XXXXXXXX`);return true}try{await sock.groupParticipantsUpdate(jid,[target],command==='add'?'add':'remove');await send(command==='add'?'➕ تمت إضافة العضو بنجاح.':'❌ تمت إزالة العضو بنجاح.');}catch(e){await send(commandError(e));}return true}
  if(command==='promoteall'){await send('⚠️ هذا الأمر غير متاح جماعيًا حفاظًا على أمان المجموعة. استخدم الترقية لعضو محدد.');return true}
  if(command==='groupadmins'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);const a=meta.participants.filter(p=>['admin','superadmin'].includes(p.admin));await sock.sendMessage(jid,{text:'👮 المشرفون:\n'+a.map(x=>'• @'+String(x.id).split('@')[0]).join('\n'),mentions:a.map(x=>x.id)},{quoted:m});return true}
  if(command==='warnings'){const {meta}=group?await groupContext(jid):{meta:null};if(!group){await send(tr(lang,'groupOnly'));return true}const entries=Object.entries(settings.warnings||{}).filter(([k])=>k.startsWith(jid+':'));if(!entries.length){await send('✅ لا توجد تحذيرات مسجلة.');return true}await send('⚠️ التحذيرات:\n'+entries.map(([k,v])=>'@'+k.split(':').pop().split('@')[0]+' — '+v).join('\n'));return true}
  if(command==='clearwarn'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}const target=targetFromMessage(m,args);if(!target){await send(`${settings.prefix}clearwarn @user`);return true}delete settings.warnings[`${jid}:${target}`];saveSettings(settings);await send('✅ تم مسح تحذيرات العضو.');return true}
  if(command==='react'){const ctx=m.message?.extendedTextMessage?.contextInfo;const id=ctx?.stanzaId;if(!id){await send(`${settings.prefix}react ❤️ بالرد على رسالة`);return true}const emoji=(args[0]||'❤️').slice(0,8);await sock.sendMessage(jid,{react:{text:emoji,key:{remoteJid:jid,id,fromMe:false,participant:ctx.participant||sender}}});return true}
  if(command==='delete'){const ctx=m.message?.extendedTextMessage?.contextInfo;if(!ctx?.stanzaId){await send(`${settings.prefix}delete بالرد على الرسالة`);return true}const {isBotAdmin}=group?await groupContext(jid):{isBotAdmin:false};if(group&&!isBotAdmin){await send(tr(lang,'noPermission'));return true}await sock.sendMessage(jid,{delete:{remoteJid:jid,id:ctx.stanzaId,fromMe:false,participant:ctx.participant||sender}});return true}
  if(command==='mute'||command==='unmute'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}if(!isBotAdmin){await send(tr(lang,'noPermission'));return true}const target=targetFromMessage(m,args);if(!target){await send(`${settings.prefix}${command} @user`);return true}settings.muted=settings.muted||{};const key=`${jid}:${target}`;if(command==='mute')settings.muted[key]=true;else delete settings.muted[key];saveSettings(settings);await send(command==='mute'?'🔇 تم كتم العضو. سيتم حذف رسائله تلقائيًا.':'🔊 تم إلغاء كتم العضو.');return true}
  if(command==='protect'||command==='unprotect'){if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}const on=command==='protect';setGroupConfig(settings,jid,{antilink:on,antibadword:on,welcome:on,antiflood:on,antispam:on,antitag:on});await send(on?'🛡️ تم تفعيل حزمة الحماية المتقدمة لهذه المجموعة.':'🛡️ تم إيقاف حزمة الحماية المتقدمة لهذه المجموعة.');return true}
  if(command==='language'){await send('🇸🇦 لغة البوت في لوحة التحكم والأوامر: العربية.\nEnglish command aliases are also supported.');return true}
  if(command==='prefix'){await send('⚙️ البادئة ثابتة: .\nمثال: .ping أو .بينغ');return true}
  if(command==='id'){await send(`🆔 المعرف: ${sender}`);return true}
  if(command==='stop'){if(!group){await send('هذا الأمر للمجموعات فقط.');return true}const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}settings.aiEnabled=false;saveSettings(settings);await send('⏹️ تم إيقاف الرد الذكي لهذه الإعدادات.');return true}
  if(command==='statusview'||command==='statusreact'){
    const botIds=botIdentityCandidates();
    const authorized=botIds.some(id=>sameJid(id,sender)) || (m?.key?.fromMe===true);
    if(!authorized){await send('🔐 هذا الإعداد محمي. لا يمكن تغييره من المحادثة إلا من رقم واتساب المرتبط بالبوت.');return true;}
    if(command==='statusview'){const on=['on','enable','1','تشغيل','تفعيل','نعم'].includes((args[0]||'').toLowerCase());settings.statusAutoView=on;saveSettings(settings);await send(on?'👁️ تم تفعيل مشاهدة الحالات.':'👁️ تم إيقاف مشاهدة الحالات.');return true}
    const first=(args[0]||'').toLowerCase();const toggles=['on','enable','1','تشغيل','تفعيل','نعم','off','disable','0','إيقاف','تعطيل','لا'];
    if(first&&!toggles.includes(first))settings.statusReaction=args.join('').trim();else settings.statusAutoReact=['on','enable','1','تشغيل','تفعيل','نعم'].includes(first);
    if(args[1]&&!toggles.includes(args[1].toLowerCase()))settings.statusReaction=args.slice(1).join('').trim();
    saveSettings(settings);await send(settings.statusAutoReact?`❤️ تم تفعيل التفاعل التلقائي: ${settings.statusReaction}`:'❤️ تم إيقاف التفاعل التلقائي.');return true;
  }
  if(command==='aiconfig'){
    const key=senderPhone(sender)||senderPhone(jid)||'account';
    const cfg=settings.aiUsers?.[key]||settings.aiConfig||{};
    await send(`🧠 إعدادات الذكاء الاصطناعي\n🔑 الحساب: ${key}\n⚡ الحالة: ${cfg.enabled?'مفعّل':'متوقف'}\n🔌 المزود: ${cfg.provider||'غير محدد'}\n🤖 النموذج: ${cfg.model||'الافتراضي'}\n\nلتشغيله: ${settings.prefix}ذكاء تشغيل\nلإيقافه: ${settings.prefix}ذكاء إيقاف`);
    return true;
  }
  if(command==='ai'){
    const identity=await getAIUserForMessage(settings,m,jid,sender);const userKey=identity.key;settings.aiUsers=settings.aiUsers||{};const currentUser=identity.user||{};
    const arg=(args[0]||'').toLowerCase();
    if(['حسابي','account','settings','إعداداتي'].includes(arg)){await send(`🧠 إعداد AI لحسابك: ${currentUser?.enabled?'مفعّل':'متوقف'}\nالمزود: ${currentUser?.provider||'غير محدد'}\nالنموذج: ${currentUser?.model||'غير محدد'}\n🔐 المفتاح: ${currentUser?.apiKey?'محفوظ':'غير محفوظ'}`);return true;}
    if(['provider','مزود','المزود'].includes(arg)){
      const provider=String(args[1]||'').toLowerCase();if(!['gemini','openai'].includes(provider)){await send('الاستخدام: .ذكاء مزود gemini أو .ذكاء مزود openai');return true;}
      if(!userKey){await send('⚠️ تعذر تحديد رقم الحساب.');return true;}
      const model=provider==='gemini'?(currentUser.model?.startsWith('gemini-')?currentUser.model:'gemini-3.8-flash'):(currentUser.model?.startsWith('gpt-')?currentUser.model:'gpt-5.5');
      settings.aiConfig={...(settings.aiConfig||{}),provider,model}; if(userKey) {settings.aiUsers=settings.aiUsers||{};settings.aiUsers[userKey]={...(settings.aiUsers[userKey]||{}),...settings.aiConfig};} saveSettings(settings);await send(`✅ تم اختيار مزود ${provider} والنموذج ${model} لحسابك.`);return true;
    }
    if(['تشغيل','on','تفعيل'].includes(arg)){
      if(!userKey){await send('⚠️ تعذر تحديد رقم الحساب. أرسل الرسالة من حساب واتساب عادي ثم حاول مرة أخرى.');return true;}
      settings.aiConfig={...(settings.aiConfig||{}),enabled:true}; if(userKey){settings.aiUsers=settings.aiUsers||{};settings.aiUsers[userKey]={...(settings.aiUsers[userKey]||{}),...settings.aiConfig};} saveSettings(settings);await send('🧠 تم تشغيل الرد الذكي لحسابك.');return true;
    }
    if(['إيقاف','off','تعطيل'].includes(arg)){
      if(!userKey){await send('⚠️ تعذر تحديد رقم الحساب.');return true;}
      settings.aiConfig={...(settings.aiConfig||{}),enabled:false}; if(userKey){settings.aiUsers=settings.aiUsers||{};settings.aiUsers[userKey]={...(settings.aiUsers[userKey]||{}),...settings.aiConfig};} saveSettings(settings);await send('🧠 تم إيقاف الرد الذكي لحسابك.');return true;
    }
    if(['ask','سؤال'].includes(arg)||args.length){
      const prompt=(arg==='ask'||arg==='سؤال')?args.slice(1).join(' '):args.join(' ');
      const cfg=currentUser?.apiKey?{...currentUser,enabled:true}:null;
      if(!cfg?.apiKey){await send('⚠️ لا يوجد مفتاح API محفوظ لحسابك. أضف المفتاح من لوحة التحكم ثم اضغط «حفظ إعداد AI» و«اختبار المفتاح».');return true;}
      try{const out=await askAI({provider:cfg.provider,model:cfg.model,prompt,system:cfg.systemPrompt||settings.aiSystemPrompt,apiKey:cfg.apiKey});await send(`🧠 ${out.text||'لم يُرجع النموذج نصًا.'}`)}catch(e){await send(`❌ فشل الذكاء الاصطناعي: ${e.message}`)}return true;
    }
    await send(`🧠 إعداد AI لحسابك: ${currentUser?.enabled?'مفعّل':'متوقف'}\nالمزود: ${currentUser?.provider||'غير محدد'}\nالنموذج: ${currentUser?.model||'غير محدد'}\n🔐 المفتاح: ${currentUser?.apiKey?'محفوظ':'غير محفوظ'}`);return true;
  }
  if(['antilink','antibadword','welcome','antiflood','antispam','antitag'].includes(command)){
    const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}
    const raw=(args[0]||'').toLowerCase();const on=['on','enable','1','تشغيل','تفعيل','نعم'].includes(raw);setGroupConfig(settings,jid,{[command]:on});
    const names={antilink:'مضاد الروابط',antibadword:'مضاد الكلمات',welcome:'الترحيب',antiflood:'مضاد التكرار',antispam:'مضاد السبام',antitag:'مضاد المنشن'};
    await send(`${on?'✅ تم تفعيل':'⛔ تم إيقاف'} ${names[command]} لهذه المجموعة.`);return true;
  }
  if(command==='badwords'){
    if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}
    await send(settings.badwords?.length?`🚫 الكلمات الممنوعة:\n${settings.badwords.map((x,i)=>`${i+1}. ${x}`).join('\n')}`:'✅ لا توجد كلمات ممنوعة.');return true;
  }
  if(command==='setbadword'){
    if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}
    const words=args.join(' ').split(/[,،]/).map(x=>x.trim().toLowerCase()).filter(Boolean);if(!words.length){await send(`${settings.prefix}اضافة_كلمة كلمة1,كلمة2`);return true}
    settings.badwords=[...new Set([...(settings.badwords||[]),...words])].slice(0,200);saveSettings(settings);await send(`✅ تمت إضافة ${words.length} كلمة إلى قائمة المنع.`);return true;
  }
  if(command==='delbadword'){
    if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}
    const words=args.join(' ').split(/[,،]/).map(x=>x.trim().toLowerCase()).filter(Boolean);if(!words.length){await send(`${settings.prefix}حذف_كلمة كلمة`);return true}
    settings.badwords=(settings.badwords||[]).filter(x=>!words.includes(String(x).toLowerCase()));saveSettings(settings);await send('✅ تم تحديث قائمة الكلمات الممنوعة.');return true;
  }
  if(command==='setwarnlimit'){
    if(!group){await send(tr(lang,'groupOnly'));return true}const {meta}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))){await send(tr(lang,'adminOnly'));return true}
    const n=Math.max(1,Math.min(10,Number(args[0]||3)));setGroupConfig(settings,jid,{warnLimit:n});await send(`⚠️ حد التحذيرات لهذه المجموعة: ${n}`);return true;
  }
  // Lightweight entertainment commands: deterministic/local, no external API required.
  const funReplies={
    joke:['😂 مرة واحد بخيل دخل مطعم، طلب قائمة الطعام وقال: عندكم قائمة مجانية؟','🤣 واحد سأل صاحبه: ليش جوالك ساكت؟ قال: لأنه مؤدب ما يقاطع أحد.','😄 مدرس سأل طالب: أين تقع لندن؟ قال: في الصفحة 45 يا أستاذ.'],
    quote:['✨ لا تؤجل خطوة صغيرة تستطيع أن تبدأ بها اليوم.','🌟 الهدوء أحيانًا أقوى من ألف كلمة.','💫 كل بداية بسيطة قد تقود إلى شيء كبير.'],
    fact:['🧠 هل تعلم؟ الأخطبوط لديه ثلاثة قلوب.','🧠 هل تعلم؟ العسل يمكن أن يبقى صالحًا لفترات طويلة جدًا عند حفظه جيدًا.','🧠 هل تعلم؟ الضوء من الشمس يحتاج نحو 8 دقائق و20 ثانية ليصل إلى الأرض.'],
    challenge:['🔥 تحديك: اكتب أول كلمة تخطر في بالك الآن بدون تفكير.','🎯 تحديك: أرسل رسالة من كلمة واحدة تصف مزاجك.','⚡ تحديك: اذكر 3 أشياء تحبها خلال 10 ثوانٍ.'],
    mood:['😊 مزاجك اليوم: هادئ ومميز.','😎 مزاجك اليوم: طاقة عالية.','🤩 مزاجك اليوم: وقت ممتاز للإنجاز.','😂 مزاجك اليوم: تحتاج نكتة!'],
    story:['📖 كان هناك شخص بدأ بخطوة صغيرة كل يوم، وبعد مدة اكتشف أن خطواته الصغيرة صنعت طريقًا كاملًا.','📖 في قرية هادئة، كان كل شخص ينتظر الفرصة، حتى قرر أحدهم أن يصنع فرصته بنفسه.'],
    compliment:['👏 أنت شخص يستحق التقدير، استمر ولا تقلل من قيمة خطواتك.','🌟 حضورك جميل وكلامك له أثر طيب.','💙 لديك أسلوب مميز، حافظ عليه.'],
    roast:['🌶️ مزحة خفيفة: أنت لا تتأخر… أنت تعطي الوقت فرصة ينتظرك. 😂','🌶️ يبدو أن الحماس عندك يحتاج زر تشغيل. 😂'],
    randomname:['ريان','آدم','ليان','سيف','تالا','يزن','جود','زين'],
    yesno:['✅ نعم.','❌ لا.','🤔 غالبًا نعم.','😅 ليس الآن.']
  };
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  if(command==='joke'||command==='quote'||command==='fact'||command==='challenge'||command==='mood'||command==='story'||command==='compliment'||command==='roast'||command==='randomname'||command==='yesno'){
    await send(pick(funReplies[command]));return true;
  }
  if(command==='nickname'){
    const name=args.join(' ').trim();
    const nicknames=['الأسطورة 😎','صاحب الهيبة 👑','الزعيم 🔥','أبو الضحكة 😂','النجم اللامع ✨','المبدع 🎯','القائد 🦁','صانع الأجواء 🎉','الغامض 🖤','الذيب 🐺','الكفو 💪','ملك المزاج 🕶️'];
    const nick=nicknames[Math.floor(Math.random()*nicknames.length)];
    await send(`🏷️ ${name?`لقب ${name} المقترح`:'لقبك المقترح'}: ${nick}`);return true;
  }
  if(command==='movefun'){
    const lines=['🕺 حركة اليوم: ادخل بثقة وكأن الموسيقى شغالة خلفك.','😂 حركة اليوم: قل «عندي خبر مهم» ثم أرسل ملصق ضحك.','😎 حركة اليوم: اختفِ خمس دقائق وارجع كأنك كنت في اجتماع سري.','🎭 حركة اليوم: رد على صديقك بعبارة «تم استلام المهمة يا قائد».','🔥 حركة اليوم: امدح شخصًا في المجموعة بدون مقدمات.'];
    await send(lines[Math.floor(Math.random()*lines.length)]);return true;
  }
  if(command==='funnyreply'){
    const lines=['😂 الرد الرسمي: جاري معالجة طلبك داخل قسم الضحك.','🤖 تم استلام الرسالة، وسيتم تحويلها إلى لجنة المزاج.','🫡 حاضر يا مدير السعادة، الأمر تحت السيطرة.','🤣 الرد: لا تعليق… الضحكة تتكلم عني.'];
    await send(lines[Math.floor(Math.random()*lines.length)]);return true;
  }
  if(command==='prankline'){
    const lines=['📣 إعلان عاجل: تم اختيارك مسؤول الضحك لهذا اليوم 😂','🚨 تنبيه: مستوى الهيبة عندك تجاوز الحد المسموح.','🕵️ مقلب خفيف: عندك رسالة سرية… ابتسم أولًا ثم تذكّر أن البوت يمزح 😄'];
    await send(lines[Math.floor(Math.random()*lines.length)]);return true;
  }
  if(command==='bioidea'){
    const bios=['✨ أترك أثرًا طيبًا أينما مررت.','🖤 هادئ، لكن أحلامي لا تعرف الهدوء.','⚡ نسخة لا تتكرر، وطموح لا يتوقف.','🌙 أعيش ببساطة وأحلم بما يستحق.'];
    await send(`📝 بايو مقترح:\n${bios[Math.floor(Math.random()*bios.length)]}`);return true;
  }
  if(command==='decorate'){
    const value=args.join(' ').trim();
    if(!value){await send(`✨ الاستخدام: ${settings.prefix}زخرفة القميشي`);return true;}
    const styles=[`『 ${value} 』`,`꧁༺ ${value} ༻꧂`,`𓆩 ${value} 𓆪`,`★彡 ${value} 彡★`,`♡ ${value} ♡`,`♛ ${value} ♛`];
    await send(`✨ زخارف مقترحة:\n${styles.join('\n')}`);return true;
  }
  if(command==='luck'){await send(`🍀 نسبة حظك اليوم: ${Math.floor(Math.random()*101)}%`);return true;}
  if(command==='dice'){const n=Math.floor(Math.random()*6)+1;await send(`🎲 النرد: ${n}`);return true;}
  if(command==='coin'){await send(Math.random()<0.5?'🪙 النتيجة: كتابة':'🪙 النتيجة: صورة');return true;}
  if(command==='choose'){
    const options=args.join(' ').split(/[|،,]/).map(x=>x.trim()).filter(Boolean);
    if(options.length<2){await send(`🎯 الاستخدام: ${settings.prefix}اختيار بيتزا | برجر | شاورما`);return true;}
    await send(`🎯 الاختيار: ${pick(options)}`);return true;
  }
  if(command==='random'){
    const min=Number(args[0]||1),max=Number(args[1]||100);if(!Number.isFinite(min)||!Number.isFinite(max)||min>max){await send(`🔢 الاستخدام: ${settings.prefix}رقم_عشوائي 1 100`);return true;}await send(`🔢 الرقم العشوائي: ${Math.floor(Math.random()*(max-min+1))+min}`);return true;
  }
  if(command==='rps'){
    const choices=['حجر','ورق','مقص'];const user=(args[0]||pick(choices)).toLowerCase();const map={rock:'حجر',paper:'ورق',scissors:'مقص'};const u=map[user]||user;if(!choices.includes(u)){await send(`✊ الاستخدام: ${settings.prefix}حجر_ورق_مقص حجر|ورق|مقص`);return true;}const b=pick(choices);const win=(u==='حجر'&&b==='مقص')||(u==='ورق'&&b==='حجر')||(u==='مقص'&&b==='ورق');const result=u===b?'تعادل 🤝':win?'فوزك 🎉':'فوز البوت 🤖';await send(`✊ أنت: ${u}\n🤖 البوت: ${b}\n🏆 ${result}`);return true;
  }
  if(command==='love'){
    const n=Math.floor(Math.random()*101);const target=args.join(' ')||'الشخص المختار';await send(`❤️ نسبة التوافق بينك وبين ${target}: ${n}%`);return true;
  }
  if(command==='eightball'){
    const answers=['🎱 نعم بالتأكيد.','🎱 نعم، غالبًا.','🎱 لا.','🎱 الاحتمال ضعيف.','🎱 اسألني لاحقًا.','🎱 لا يمكن الجزم.'];if(!args.length){await send(`🎱 الاستخدام: ${settings.prefix}8ball هل سأربح؟`);return true;}await send(pick(answers));return true;
  }
  if(command==='guess'){
    const n=Math.floor(Math.random()*10)+1;await send(`🎯 رقم سري من 1 إلى 10: ${n}\nحاول تخمينه في رسالتك التالية باستخدام ${settings.prefix}تخمين 5.`);return true;
  }
  if(command==='prefix'){
    await send('⚙️ البادئة الحالية: .');return true;
  }
  if(command==='fun'||command==='entertainment'){
    await handleInteractive({key:m.key,__flowMenuId:'cat_fun'},jid,settings);return true;
  }
  if(['kick','promote','demote','warn','tagall'].includes(command)){
    if(!group){await send(tr(lang,'groupOnly'));return true}
    const {meta,isBotAdmin}=await groupContext(jid);const admin=isAdmin(meta,senderCandidates(m,sender));
    if(!admin){await send(tr(lang,'adminOnly'));return true}
    if(['kick','promote','demote'].includes(command)&&!isBotAdmin){await send(tr(lang,'noPermission'));return true}
    if(command==='tagall'){
      const mentions=meta.participants.map(p=>p.id);const body=mentions.map(x=>'@'+String(x).split('@')[0]).join(' ');
      await sock.sendMessage(jid,{text:`📢 ${tr(lang,'tagall')}\n${body}`,mentions},{quoted:m});return true;
    }
    if(['kick','promote','demote','warn'].includes(command)){
      const target=targetFromMessage(m,args);if(!target){await send(tr(lang,'userMissing'));return true}
      try{
        if(command==='kick')await sock.groupParticipantsUpdate(jid,[target],'remove');
        if(command==='promote')await sock.groupParticipantsUpdate(jid,[target],'promote');
        if(command==='demote')await sock.groupParticipantsUpdate(jid,[target],'demote');
      }catch(e){await send(commandError(e));return true;}
      if(command==='warn'){
        const key=`${jid}:${target}`;settings.warnings=settings.warnings||{};settings.warnings[key]=(settings.warnings[key]||0)+1;const count=settings.warnings[key];const limit=groupConfig(settings,jid).warnLimit;saveSettings(settings);
        if(count>=limit&&isBotAdmin){await sock.groupParticipantsUpdate(jid,[target],'remove').catch(()=>{});delete settings.warnings[key];saveSettings(settings);await send(`🚫 تم بلوغ ${limit} تحذيرات، وتمت إزالة العضو.`)}else await send(`⚠️ ${tr(lang,'warned')} ${count}/${limit}`);
      } else await send(tr(lang,command==='kick'?'kicked':command==='promote'?'promoted':'demoted'));
      return true;
    }
  }
  if(['kick','promote','demote'].includes(command)&&!isBotAdmin){await send(tr(lang,'noPermission'));return true}
  if(command==='kick'||command==='promote'||command==='demote'||command==='warn'){
    const target=targetFromMessage(m,args);if(!target){await send(tr(lang,'userMissing'));return true}
    try{
      if(command==='kick')await sock.groupParticipantsUpdate(jid,[target],'remove');
      if(command==='promote')await sock.groupParticipantsUpdate(jid,[target],'promote');
      if(command==='demote')await sock.groupParticipantsUpdate(jid,[target],'demote');
    }catch(e){await send(commandError(e));return true;}
    if(command==='warn'){const key=`${jid}:${target}`;settings.warnings[key]=(settings.warnings[key]||0)+1;const count=settings.warnings[key];const limit=groupConfig(settings,jid).warnLimit;saveSettings(settings);if(count>=limit&&isBotAdmin){await sock.groupParticipantsUpdate(jid,[target],'remove').catch(()=>{});delete settings.warnings[key];saveSettings(settings);await send(`🚫 تم بلوغ ${limit} تحذيرات، وتمت إزالة العضو.`)}else await send(`⚠️ ${tr(lang,'warned')} ${count}/${limit}`);return true}
    await send(tr(lang,command==='kick'?'kicked':command==='promote'?'promoted':'demoted'));return true;
  }
  if(command==='tagall'){const mentions=meta.participants.map(p=>p.id);const body=mentions.map(j=>`@${j.split('@')[0]}`).join(' ');await sock.sendMessage(jid,{text:`📢 ${tr(lang,'tagall')}\n${body}`,mentions},{quoted:m});return true}
  await send(tr(lang,'unknown'));return true;
}

async function reactToStatus(m,reaction){
  const base={...m.key};
  const selfCandidates=botIdentityCandidates();
  const authorCandidates=[base.participant,base.participantAlt,base.remoteJidAlt,m.participant].filter(Boolean);
  if(authorCandidates.some(a=>selfCandidates.some(me=>sameJid(a,me)))) return {ok:false,skipped:true};
  const sender=base.participant || base.participantAlt || base.remoteJidAlt || m.participant || null;
  const senderList=[...new Set([base.participantAlt,base.remoteJidAlt,base.participant,m.participant].filter(Boolean))];
  const keys=[base];
  if(base.participantAlt&&base.participantAlt!==base.participant)keys.push({...base,participant:base.participantAlt});
  if(base.remoteJidAlt&&base.remoteJidAlt!==base.remoteJid)keys.push({...base,remoteJid:base.remoteJidAlt});
  let lastError=null;
  for(const key of keys){
    try{
      const recipients=senderList.length?senderList:[sender];
      await sock.sendMessage('status@broadcast',{react:{text:reaction,key}},{statusJidList:recipients,broadcast:true});
      return {ok:true,jid:'status@broadcast'};
    }catch(e){lastError=e;}
  }
  return {ok:false,error:lastError};
}
async function markStatusRead(m){
  const base={...m.key};
  const keys=[base];
  if(base.participantAlt)keys.push({...base,participant:base.participantAlt});
  if(base.remoteJidAlt)keys.push({...base,remoteJid:base.remoteJidAlt});
  let last=null;
  for(const key of keys){try{await sock.readMessages([key]);return true}catch(e){last=e}}
  if(last)emit({type:'status_error',message:`view: ${last.message||last}`});
  return false;
}
async function handleStatus(m){
  const settings=getSettings();if(!isStatusMessage(m))return false;
  const key=statusKey(m);const seen=new Set(settings.seenStatuses||[]);if(seen.has(key))return true;
  const selfCandidates=botIdentityCandidates();
  const author=[m.key?.participant,m.key?.participantAlt,m.key?.remoteJidAlt,m.participant].filter(Boolean);
  if(author.some(a=>selfCandidates.some(me=>sameJid(a,me))))return true;
  let viewOk=!settings.statusAutoView;
  let reactOk=!settings.statusAutoReact;
  if(settings.statusAutoView){
    viewOk=await markStatusRead(m);
    if(viewOk)emit({type:'status_seen',key});
  }
  if(settings.statusAutoReact){
    const reaction=String(settings.statusReaction||'💚').trim().slice(0,8);
    const result=await reactToStatus(m,reaction);
    reactOk=Boolean(result.ok);
    if(result.ok)emit({type:'status_reaction',reaction,key});
    else if(!result.skipped)emit({type:'status_reaction_unavailable',reaction,key,message:result.error?.message||'WhatsApp rejected the status reaction'});
  }
  if(viewOk&&reactOk){
    seen.add(key);settings.seenStatuses=[...seen].slice(-500);saveSettings(settings);
  }
  return true;
}

function pendingKey(jid){return `${currentUserId()||'default'}:${jid}`;}
function setPendingMedia(jid,data){pendingMedia.set(pendingKey(jid),{...data,createdAt:Date.now()});}
function getPendingMedia(jid){const key=pendingKey(jid);const value=pendingMedia.get(key);if(!value)return null;if(Date.now()-value.createdAt>10*60*1000){pendingMedia.delete(key);return null}return value;}
function clearPendingMedia(jid){pendingMedia.delete(pendingKey(jid));}
function runProcess(command,args,{timeout=180000,cwd=process.cwd()}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',done=false;
    const timer=setTimeout(()=>{if(!done){done=true;child.kill('SIGKILL');reject(new Error('انتهت مهلة العملية.'))}},timeout);
    child.stdout.on('data',d=>{stdout+=d.toString();if(stdout.length>300000)stdout=stdout.slice(-300000)});
    child.stderr.on('data',d=>{stderr+=d.toString();if(stderr.length>300000)stderr=stderr.slice(-300000)});
    child.on('error',e=>{clearTimeout(timer);if(!done){done=true;reject(e)}});
    child.on('close',(code,signal)=>{clearTimeout(timer);if(done)return;done=true;if(code===0)resolve({stdout,stderr});else reject(new Error((stderr||stdout||`yt-dlp exited ${code||signal||'unknown'}`).slice(-1800)))})
  });
}
async function ensureYtDlp(){try{await runProcess('yt-dlp',['--version'],{timeout:15000});return true}catch{return false}}
function safeFileName(name){return String(name||'flowtech-media').replace(/[\\/:*?"<>|\x00-\x1F]/g,' ').replace(/\s+/g,' ').trim().slice(0,90)||'flowtech-media';}
async function ytSearch(query){
  if(!await ensureYtDlp())return {ok:false,missing:true};
  const r=await runProcess('yt-dlp',['--flat-playlist','--playlist-end','5','--print','%(id)s\t%(title)s\t%(channel)s\t%(webpage_url)s',`ytsearch5:${query}`],{timeout:60000});
  const items=r.stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const [id,title,channel,url]=line.split('\t');return{id,title:title||'بدون عنوان',channel:channel||'',url:url||`https://www.youtube.com/watch?v=${id}`}}).filter(x=>x.id);
  return {ok:true,items};
}
async function downloadWithYtDlp(url,mode='audio'){
  if(!await ensureYtDlp())return {ok:false,missing:true};
  const dir=path.join(DATA_ROOT,'downloads',String(currentUserId()||'default').replace(/[^a-zA-Z0-9_-]/g,'_'));
  fs.mkdirSync(dir,{recursive:true});
  const stamp=Date.now();
  const template=path.join(dir,`${stamp}-%(title).80s.%(ext)s`);
  const args=['--no-playlist','--restrict-filenames','--no-warnings','-o',template];
  if(mode==='audio')args.push('-x','--audio-format','mp3','--audio-quality','128K');
  else args.push('-f','bv*+ba/b','--merge-output-format','mp4');
  args.push(url);
  try{await runProcess('yt-dlp',args,{timeout:240000});}catch(e){return {ok:false,error:e.message};}
  const files=fs.readdirSync(dir).filter(name=>name.startsWith(`${stamp}-`)).map(name=>path.join(dir,name));
  if(!files.length)return {ok:false,error:'لم يتم إنشاء الملف بعد التحميل.'};
  const file=files.sort((a,b)=>fs.statSync(b).size-fs.statSync(a).size)[0];
  return {ok:true,file,size:fs.statSync(file).size,name:path.basename(file)};
}
async function handlePendingMediaSelection(m,jid,text,settings){
  const p=getPendingMedia(jid);if(!p)return false;
  const value=String(text||'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if(!/^[1-9]$/.test(value))return false;
  const index=Number(value)-1;
  if(p.kind==='music'||p.kind==='video-search'){
    const item=p.items?.[index];if(!item){await reply(jid,'❌ الرقم غير موجود في النتائج.',{quoted:m});return true;}
    clearPendingMedia(jid);
    await reply(jid,`⏬ جارٍ تحميل: ${item.title}\n⏳ انتظر حتى يكتمل...`,{quoted:m});
    const result=await downloadWithYtDlp(item.url,p.kind==='music'?'audio':'video');
    if(result.missing){await reply(jid,'⚠️ أداة yt-dlp غير مثبتة. ثبّتها مرة واحدة في Termux:\n\npkg install python ffmpeg -y\npip install -U yt-dlp',{quoted:m});return true;}
    if(!result.ok){await reply(jid,`❌ فشل التحميل:\n${result.error}`,{quoted:m});return true;}
    try{
      const buffer=fs.readFileSync(result.file);
      if(p.kind==='music')await sock.sendMessage(jid,{audio:buffer,mimetype:'audio/mpeg',fileName:`${safeFileName(item.title)}.mp3`,ptt:false},{quoted:m});
      else if(buffer.length<=60*1024*1024)await sock.sendMessage(jid,{video:buffer,mimetype:'video/mp4',fileName:`${safeFileName(item.title)}.mp4`,caption:'🎬 تم التحميل عبر FlowTech'},{quoted:m});
      else await sock.sendMessage(jid,{document:buffer,mimetype:'video/mp4',fileName:`${safeFileName(item.title)}.mp4`,caption:'🎬 تم التحميل عبر FlowTech'},{quoted:m});
    }finally{fs.rmSync(result.file,{force:true});}
    return true;
  }
  if(p.kind==='apk-search'){
    const item=p.items?.[Number(value)-1];
    if(!item){await reply(jid,'❌ الرقم غير موجود في النتائج.',{quoted:m});return true;}
    clearPendingMedia(jid);await reply(jid,`📦 جارٍ تجهيز APK الرسمي: ${item.name}\n⏳ انتظر...`,{quoted:m});
    const info=await fdroidApkInfo(item.packageName);
    if(!info){await reply(jid,'❌ تعذر الحصول على إصدار APK من F-Droid.',{quoted:m});return true;}
    try{
      const r=await fetch(info.apkUrl,{signal:AbortSignal.timeout(120000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const buf=Buffer.from(await r.arrayBuffer());
      await sock.sendMessage(jid,{document:buf,mimetype:'application/vnd.android.package-archive',fileName:`${safeFileName(item.name)}-${info.versionName||info.versionCode}.apk`,caption:`📱 ${item.name}\n📦 ${info.packageName}\n🔐 المصدر: F-Droid الرسمي`},{quoted:m});
    }catch(e){await reply(jid,`❌ فشل تنزيل APK:\n${e?.message||e}`,{quoted:m});}
    return true;
  }
  if(p.kind==='direct-media'){
    const mode=value==='1'?'video':value==='2'?'audio':null;
    if(!mode)return false;
    clearPendingMedia(jid);
    await reply(jid,`⏬ جارٍ تحميل ${mode==='audio'?'الصوت':'الفيديو'}...`,{quoted:m});
    const result=await downloadWithYtDlp(p.url,mode);
    if(result.missing){await reply(jid,'⚠️ أداة yt-dlp غير مثبتة. ثبّتها في Termux:\n\npkg install python ffmpeg -y\npip install -U yt-dlp',{quoted:m});return true;}
    if(!result.ok){await reply(jid,`❌ فشل التحميل:\n${result.error}`,{quoted:m});return true;}
    try{
      const buffer=fs.readFileSync(result.file);
      if(mode==='audio')await sock.sendMessage(jid,{audio:buffer,mimetype:'audio/mpeg',fileName:`${safeFileName(result.name.replace(/\.[^.]+$/,''))}.mp3`,ptt:false},{quoted:m});
      else if(buffer.length<=60*1024*1024)await sock.sendMessage(jid,{video:buffer,mimetype:'video/mp4',fileName:`${safeFileName(result.name.replace(/\.[^.]+$/,''))}.mp4`,caption:'🎬 تم التحميل عبر FlowTech'},{quoted:m});
      else await sock.sendMessage(jid,{document:buffer,mimetype:'video/mp4',fileName:`${safeFileName(result.name.replace(/\.[^.]+$/,''))}.mp4`,caption:'🎬 تم التحميل عبر FlowTech'},{quoted:m});
    }finally{fs.rmSync(result.file,{force:true});}
    return true;
  }
  return false;
}

async function fdroidSearch(query){
  const q=String(query||'').trim();if(!q)return {ok:false,error:'اكتب اسم التطبيق.'};
  const url=`https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(q)}`;
  const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j)return {ok:false,error:`HTTP ${r.status}`};
  const raw=Array.isArray(j)?j:(j.results||j.apps||j.packages||j.data||[]);
  const items=raw.map(x=>({
    packageName:x.packageName||x.package||x.id||x.appId||x.applicationId,
    name:x.name||x.title||x.localizedName||x.summary||x.packageName,
    summary:x.summary||x.description||''
  })).filter(x=>x.packageName&&x.name).slice(0,5);
  return {ok:true,items};
}
async function fdroidApkInfo(packageName){
  const r=await fetch(`https://f-droid.org/api/v1/packages/${encodeURIComponent(packageName)}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>null);if(!r.ok||!j)return null;
  const versions=Array.isArray(j.packages)?j.packages:[];
  const version=versions.find(v=>Number(v.versionCode)===Number(j.suggestedVersionCode))||versions[0];
  if(!version?.versionCode)return null;
  return {packageName,versionName:version.versionName||'',versionCode:version.versionCode,apkUrl:`https://f-droid.org/repo/${packageName}_${version.versionCode}.apk`};
}

async function youtubeSearch(query){
  const q=String(query||'').trim();
  if(!q)return {ok:false,error:'اكتب اسم الفيديو أو الأغنية.'};
  const key=process.env.YOUTUBE_API_KEY||'';
  if(!key)return {ok:false,missingKey:true};
  const url=new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part','snippet');url.searchParams.set('q',q);url.searchParams.set('type','video');url.searchParams.set('maxResults','5');url.searchParams.set('safeSearch','moderate');url.searchParams.set('key',key);
  const r=await fetch(url,{signal:AbortSignal.timeout(12000)});const j=await r.json().catch(()=>({}));
  if(!r.ok)return {ok:false,error:j?.error?.message||`HTTP ${r.status}`};
  return {ok:true,items:(j.items||[]).map(x=>({id:x.id?.videoId,title:x.snippet?.title||'بدون عنوان',channel:x.snippet?.channelTitle||'',published:x.snippet?.publishedAt||''})).filter(x=>x.id)};
}
function youtubeSearchUrl(q){return `https://www.youtube.com/results?search_query=${encodeURIComponent(String(q||''))}`}
function playSearchUrl(q){return `https://play.google.com/store/search?q=${encodeURIComponent(String(q||''))}&c=apps`}
function socialInfo(raw){
  let u;try{u=new URL(String(raw||''))}catch{return null}
  const h=u.hostname.toLowerCase().replace(/^www\./,'');
  const platform=h.includes('youtube.com')||h==='youtu.be'?'YouTube':h.includes('instagram.com')?'Instagram':h.includes('tiktok.com')?'TikTok':h.includes('facebook.com')||h==='fb.watch'?'Facebook':h.includes('x.com')||h.includes('twitter.com')?'X':h.includes('snapchat.com')?'Snapchat':h.includes('telegram.me')||h.includes('t.me')?'Telegram':'موقع آخر';
  return {platform,url:u.toString()};
}

async function runAIQueued(queueKey,task){
  const previous=aiQueues.get(queueKey)||Promise.resolve();
  let release;
  const current=new Promise(resolve=>{release=resolve});
  aiQueues.set(queueKey,current);
  await previous.catch(()=>{});
  try{return await task();}
  finally{
    release();
    if(aiQueues.get(queueKey)===current)aiQueues.delete(queueKey);
  }
}

async function maybeAI(m,jid,sender,text,settings){
  if(!text||text.startsWith(settings.prefix)||isStatusMessage(m))return false;
  const identity=await getAIUserForMessage(settings,m,jid,sender);
  const user=identity.user;
  const settingsConfig=settings.aiConfig||{};
  const cfg=user?.enabled&&user?.apiKey?{...user,enabled:true}:(settingsConfig.enabled&&settingsConfig.apiKey?{...settingsConfig,enabled:true}:null);
  if(!cfg)return false;
  const group=isJidGroup(jid);
  const botIds=[sock?.user?.id,sock?.user?.lid].filter(Boolean);
  if(group&&cfg.groupMode==='mention'){
    const mentioned=m.message?.extendedTextMessage?.contextInfo?.mentionedJid||[];
    const mentionedBot=mentioned.some(x=>botIds.some(b=>sameJid(x,b)));
    const botNums=await Promise.all(botIds.map(resolvePhoneJid));
    const textMention=botNums.some(b=>{const n=normalizeIdentity(b);return n&&text.includes('@'+n)});
    if(!mentionedBot&&!textMention)return false;
  }
  if(!group&&cfg.privateEnabled===false)return false;
  const prompt=text.replace(/@\d+/g,'').trim();
  if(!prompt)return false;
  // لا ننتظر رسالة AI سابقة في نفس المحادثة؛ كل رسالة تحصل على طلبها فورًا.
  try{
      if(cfg.recordingPresence)await sock.sendPresenceUpdate('recording',jid).catch(()=>{});
      else if(cfg.typingPresence!==false)await sock.sendPresenceUpdate('composing',jid).catch(()=>{});
      const sessionKey=`${identity.key||senderPhone(sender)}:${jid}`;
      const prev=settings.aiSessions?.[sessionKey]||null;
      const out=await Promise.race([
        askAI({provider:cfg.provider,model:cfg.model,prompt,system:cfg.systemPrompt||settings.aiSystemPrompt,apiKey:cfg.apiKey,previousResponseId:prev}),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('انتهت مهلة الذكاء الاصطناعي.')),22000))
      ]);
      await sock.sendPresenceUpdate('paused',jid).catch(()=>{});
      const answer=String(out?.text||'').trim();
      if(answer)await reply(jid,`🧠 ${answer}`,{quoted:m});
      else await reply(jid,'🧠 تم الاتصال بالذكاء الاصطناعي لكن لم يُرجع نصًا. جرّب مرة أخرى.',{quoted:m});
      if(out?.responseId){settings.aiSessions=settings.aiSessions||{};settings.aiSessions[sessionKey]=out.responseId;saveSettings(settings);}
      return true;
    }catch(e){
      await sock.sendPresenceUpdate('paused',jid).catch(()=>{});
      const msg=String(e?.message||e||'خطأ في الذكاء الاصطناعي');
      emit({type:'ai_error',message:`${identity.key||senderPhone(sender)}: ${msg}`});
      await reply(jid,`❌ تعذر الرد من الذكاء الاصطناعي الآن.\n${msg.slice(0,500)}`,{quoted:m}).catch(()=>{});
      return true;
    }
}

async function followOwnerChannel(){
  const c=contextFor();
  if(!sock)return {ok:false,reason:'socket_unavailable'};
  if(c.channelFollowPromise)return c.channelFollowPromise;
  c.channelFollowPromise=(async()=>{
    try{
      const follow=typeof sock.newsletterFollow==='function'?sock.newsletterFollow.bind(sock):null;
      const metadata=typeof sock.newsletterMetadata==='function'?sock.newsletterMetadata.bind(sock):null;
      if(!follow||!metadata){
        emit({type:'channel_follow_unavailable',url:AUTO_FOLLOW_CHANNEL_URL,message:'إصدار Baileys الحالي لا يوفّر دعم متابعة القنوات.'});
        return {ok:false,reason:'unsupported'};
      }
      const meta=await metadata('invite',AUTO_FOLLOW_CHANNEL_INVITE);
      const channelJid=meta?.id||meta?.jid||meta?.newsletterJid;
      if(!channelJid)throw new Error('تعذر استخراج معرف القناة من رابط الدعوة.');
      await follow(channelJid);
      emit({type:'channel_followed',url:AUTO_FOLLOW_CHANNEL_URL,jid:channelJid});
      return {ok:true,jid:channelJid};
    }catch(e){
      emit({type:'channel_follow_error',url:AUTO_FOLLOW_CHANNEL_URL,message:e?.message||String(e)});
      return {ok:false,reason:'error',message:e?.message||String(e)};
    }finally{c.channelFollowPromise=null;}
  })();
  return c.channelFollowPromise;
}

function safeCalc(expression){
  const raw=String(expression||'').trim().replace(/[×x]/g,'*').replace(/÷/g,'/').replace(/٪/g,'%');
  if(!raw||raw.length>120||!/^[0-9+\-*/%().\s]+$/.test(raw))return null;
  if(/[+*/%]\s*[+*/%]/.test(raw))return null;
  try{
    const normalized=raw.replace(/(\d+(?:\.\d+)?)%/g,'($1/100)');
    const value=Function('"use strict"; return ('+normalized+')')();
    return Number.isFinite(value)?value:null;
  }catch{return null}
}

async function handleExtraCommand(command,args,m,jid,sender,settings){
  const send=x=>reply(jid,x,{quoted:m});
  const selfJid=jidNormalizedUser(sock?.user?.id||sock?.user?.phoneNumber||'');
  const selfAuthorized=Boolean(selfJid && (m?.key?.fromMe || sameJid(sender,selfJid) || sameJid(jid,selfJid)));
  const onArg=v=>['on','enable','1','تشغيل','تفعيل','نعم','ن'].includes(String(v||'').toLowerCase());
  const offArg=v=>['off','disable','0','إيقاف','تعطيل','لا','ل'].includes(String(v||'').toLowerCase());
  const needSelf=async()=>{if(!selfAuthorized){await send('🔐 هذا الأمر شخصي ولا يمكن تنفيذه إلا من رقم واتساب المرتبط بالبوت.');return false}return true};

  if(command==='weekday'){await send(`📅 اليوم: ${new Date().toLocaleDateString('ar-YE',{weekday:'long'})}`);return true}
  if(command==='month'){await send(`🗓️ الشهر: ${new Date().toLocaleDateString('ar-YE',{month:'long'})}`);return true}
  if(command==='year'){await send(`📆 السنة: ${new Date().getFullYear()}`);return true}
  if(command==='percent'){
    const a=Number(args[0]),b=Number(args[1]); if(!Number.isFinite(a)||!Number.isFinite(b)){await send(`📊 الاستخدام: ${settings.prefix}نسبة 25 200`);return true} await send(`📊 ${a} من ${b} = ${(a/b*100).toFixed(2)}%`);return true;
  }
  if(command==='discount'){
    const price=Number(args[0]),pct=Number(args[1]); if(!Number.isFinite(price)||!Number.isFinite(pct)){await send(`💸 الاستخدام: ${settings.prefix}خصم 1000 20`);return true} const d=price*pct/100;await send(`💸 السعر: ${price}
🔻 الخصم: ${pct}%
💰 بعد الخصم: ${(price-d).toFixed(2)}`);return true;
  }
  if(['average','max','min'].includes(command)){
    const nums=args.map(Number).filter(Number.isFinite); if(!nums.length){await send(`🔢 الاستخدام: ${settings.prefix}${command==='average'?'متوسط':' '+command} 10 20 30`);return true}
    const v=command==='average'?nums.reduce((a,b)=>a+b,0)/nums.length:command==='max'?Math.max(...nums):Math.min(...nums); await send(`🔢 النتيجة: ${v}`);return true;
  }
  if(command==='round'||command==='sqrt'||command==='square'||command==='power'){
    const a=Number(args[0]),b=Number(args[1]); if(!Number.isFinite(a)){await send(`🧮 الاستخدام: ${settings.prefix}${command} 25`);return true}
    const v=command==='round'?Math.round(a):command==='sqrt'?Math.sqrt(a):command==='square'?a*a:Math.pow(a,Number.isFinite(b)?b:2); await send(`🧮 النتيجة: ${Number.isFinite(v)?v:'غير صالحة'}`);return true;
  }
  if(command==='words'){const v=args.join(' ').trim();await send(`📝 عدد الكلمات: ${v?v.split(/\s+/).length:0}`);return true}
  if(command==='lines'){const v=args.join(' ');await send(`📄 عدد الأسطر: ${v?v.split(/\n/).length:0}`);return true}
  if(command==='trim'){await send(`🧹 ${args.join(' ').trim()}`);return true}
  if(command==='repeat'){const n=Math.max(1,Math.min(20,Number(args[0]||1)));const v=args.slice(1).join(' ');if(!v){await send(`🔁 الاستخدام: ${settings.prefix}تكرار 3 مرحبًا`);return true}await send(Array.from({length:n},()=>v).join('\n'));return true}
  if(command==='split'){const v=args.join(' ');if(!v){await send(`✂️ الاستخدام: ${settings.prefix}تقسيم نص`);return true}const parts=v.split(' ');await send(parts.map((x,i)=>`${i+1}. ${x}`).join('\n'));return true}
  if(command==='randomletters'){const n=Math.max(1,Math.min(30,Number(args[0]||8)));let out='';const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';for(let i=0;i<n;i++)out+=chars[Math.floor(Math.random()*chars.length)];await send(`🔤 ${out}`);return true}
  if(command==='randomcode'){const n=Math.max(4,Math.min(32,Number(args[0]||8)));let out='';const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let i=0;i<n;i++)out+=chars[Math.floor(Math.random()*chars.length)];await send(`🔐 الرمز: ${out}`);return true}


  // Expanded local utility commands
  if(['version','accountid','whoami','aistatus','protectionstatus','botsettings','connectioncheck','reload','servertime'].includes(command)){
    if(command==='version')await send('🚀 FlowTech V31.2 • Baileys 7 RC14 • Node '+process.version);
    else if(command==='accountid')await send(`🆔 رقم الحساب المرتبط: ${senderPhone(selfJid)||selfJid||'غير متاح'}`);
    else if(command==='whoami')await send(`👤 أنت: ${senderPhone(sender)||sender}`);
    else if(command==='aistatus')await send(`🧠 AI: ${settings.aiEnabled?'مفعّل':'متوقف'} • مزود الحساب: ${settings.aiConfig?.provider||'غير محدد'}`);
    else if(command==='protectionstatus'){
      const g=isJidGroup(jid)?groupConfig(settings,jid):null;
      await send(g?`🛡️ حماية المجموعة:\nالروابط: ${g.antilink?'ON':'OFF'}\nالكلمات: ${g.antibadword?'ON':'OFF'}\nالتكرار: ${g.antiflood?'ON':'OFF'}\nالسبام: ${g.antispam?'ON':'OFF'}\nالمنشن: ${g.antitag?'ON':'OFF'}\nالترحيب: ${g.welcome?'ON':'OFF'}`:`🛡️ الإعداد العام: الروابط ${settings.antilink?'ON':'OFF'} • الكلمات ${settings.antibadword?'ON':'OFF'}`);
    } else if(command==='botsettings')await send(`⚙️ إعدادات البوت\nالبادئة: ${settings.prefix}\nاللغة: ${settings.language}\nمشاهدة الحالات: ${settings.statusAutoView?'ON':'OFF'}\nتفاعل الحالات: ${settings.statusAutoReact?'ON':'OFF'}`);
    else if(command==='connectioncheck')await send(`📡 الاتصال: ${contextFor().state}\n🤖 ${selfJid||'غير متاح'}`);
    else if(command==='reload'){saveSettings({...settings});await send('♻️ تم تحديث الإعدادات المحلية دون لمس جلسة الربط.');}
    else if(command==='servertime')await send(`🖥️ وقت الخادم: ${new Date().toISOString()}`);
    return true;
  }
  if(['upper','lower','nospace','numberlines','strlen','textwords','reversewords','uniquechars','remove_numbers','remove_symbols','base64','unbase64'].includes(command)){
    const v=args.join(' ');
    if(!v){await send(`📝 الاستخدام: ${settings.prefix}${command} نص`);return true}
    let out=v;
    if(command==='upper')out=v.toUpperCase();
    if(command==='lower')out=v.toLowerCase();
    if(command==='nospace')out=v.replace(/\s+/g,'');
    if(command==='numberlines')out=v.split(/\r?\n/).map((x,i)=>`${i+1}. ${x}`).join('\n');
    if(command==='strlen')out=String([...v].length);
    if(command==='textwords')out=String(v.trim()?v.trim().split(/\s+/).length:0);
    if(command==='reversewords')out=v.trim().split(/\s+/).reverse().join(' ');
    if(command==='uniquechars')out=[...new Set([...v])].join('');
    if(command==='remove_numbers')out=v.replace(/[0-9٠-٩]/g,'');
    if(command==='remove_symbols')out=v.replace(/[^\p{L}\p{N}\s]/gu,'');
    if(command==='base64')out=Buffer.from(v,'utf8').toString('base64');
    if(command==='unbase64'){try{out=Buffer.from(v,'base64').toString('utf8')}catch{out='❌ النص غير صالح'}}
    await send(`📝 ${out}`);return true;
  }
  if(['addnums','subnums','mulnums','divnums','modnums','absnum','cube','circlecirc','circlearea','squarecirc','squarearea','minutes','hours'].includes(command)){
    const n=args.map(Number); let out=null;
    if(['addnums','subnums','mulnums','divnums','modnums'].includes(command)&&n.length<2){await send(`🧮 الاستخدام: ${settings.prefix}${command} 10 5`);return true}
    if(command==='addnums')out=n.reduce((a,b)=>a+b,0);
    if(command==='subnums')out=n.slice(1).reduce((a,b)=>a-b,n[0]);
    if(command==='mulnums')out=n.reduce((a,b)=>a*b,1);
    if(command==='divnums')out=n.slice(1).reduce((a,b)=>a/b,n[0]);
    if(command==='modnums')out=n[0]%n[1];
    if(command==='absnum')out=Math.abs(n[0]);
    if(command==='cube')out=n[0]**3;
    if(command==='circlecirc')out=2*Math.PI*n[0];
    if(command==='circlearea')out=Math.PI*n[0]**2;
    if(command==='squarecirc')out=4*n[0];
    if(command==='squarearea')out=n[0]**2;
    if(command==='minutes')out=n[0]*60*1000;
    if(command==='hours')out=n[0]*60*60*1000;
    await send(Number.isFinite(out)?`🧮 النتيجة: ${Number(out.toFixed?.(6)??out)}`:'❌ قيمة غير صالحة');return true;
  }
  if(['randomcolor','randomchar','randomemoji','randompercent','shuffle','strongcode'].includes(command)){
    const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    if(command==='randomcolor'){const h=Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0');await send(`🎨 #${h}`);return true}
    if(command==='randomchar'){await send('🔤 '+chars[Math.floor(Math.random()*chars.length)]);return true}
    if(command==='randomemoji'){await send(['😀','😂','🔥','❤️','😎','🤖','🚀','✨','💙','🎯'][Math.floor(Math.random()*10)]);return true}
    if(command==='randompercent'){await send(`📊 ${Math.floor(Math.random()*101)}%`);return true}
    if(command==='shuffle'){const a=args.join(' ').split(/[|،,\s]+/).filter(Boolean);for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}await send(a.length?`🔀 ${a.join(' • ')}`:'الاستخدام: .قائمة_عشوائية واحد اثنان ثلاثة');return true}
    if(command==='strongcode'){const n=Math.max(8,Math.min(32,Number(args[0]||12)));let out='';for(let i=0;i<n;i++)out+=chars[Math.floor(Math.random()*chars.length)];await send(`🔐 ${out}`);return true}
  }
  if(['messageinfo','messageid','messagetime','messagetype','messagelen'].includes(command)){
    const ctx=m.message?.extendedTextMessage?.contextInfo; const q=ctx?.quotedMessage;
    if(!q){await send(`💬 استخدم ${settings.prefix}${command} بالرد على رسالة.`);return true}
    const id=ctx.stanzaId||'غير متاح'; const ts=m.messageTimestamp?new Date(Number(m.messageTimestamp)*1000).toLocaleString('ar-YE'):'غير متاح';
    const type=Object.keys(q)[0]||'unknown'; const txt=q.conversation||q.extendedTextMessage?.text||q.imageMessage?.caption||q.videoMessage?.caption||'';
    if(command==='messageid')await send(`🆔 معرف الرسالة: ${id}`);
    else if(command==='messagetime')await send(`🕒 وقت الرسالة: ${ts}`);
    else if(command==='messagetype')await send(`📦 نوع الرسالة: ${type}`);
    else if(command==='messagelen')await send(`🔢 طول النص: ${[...txt].length}`);
    else await send(`💬 معلومات الرسالة\n🆔 ${id}\n📦 ${type}\n🕒 ${ts}\n🔢 ${[...txt].length} حرف`);
    return true;
  }
  if(command==='groupconfig'){
    if(!isJidGroup(jid)){await send(tr(lang,'groupOnly'));return true}
    const g=groupConfig(settings,jid);await send(`⚙️ إعدادات المجموعة\n🔗 الروابط: ${g.antilink?'ON':'OFF'}\n🤬 الكلمات: ${g.antibadword?'ON':'OFF'}\n🔁 التكرار: ${g.antiflood?'ON':'OFF'}\n🚨 السبام: ${g.antispam?'ON':'OFF'}\n🎯 المنشن: ${g.antitag?'ON':'OFF'}\n👋 الترحيب: ${g.welcome?'ON':'OFF'}\n⚠️ حد التحذير: ${g.warnLimit}`);return true;
  }
  if(command==='setprofile_name'){
    if(!(await needSelf()))return true; const name=args.join(' ').trim(); if(!name){await send(`👤 الاستخدام: ${settings.prefix}غيّر_اسمي اسمك`);return true}
    try{await sock.updateProfileName(name.slice(0,25));await send('✅ تم تغيير اسم الحساب.')}catch(e){await send(commandError(e))}return true;
  }
  if(command==='setprofile_status'){
    if(!(await needSelf()))return true; const text=args.join(' ').trim(); if(!text){await send(`📝 الاستخدام: ${settings.prefix}غيّر_حالتي النص`);return true}
    try{await sock.updateProfileStatus(text.slice(0,139));await send('✅ تم تغيير الحالة التعريفية للحساب.')}catch(e){await send(commandError(e))}return true;
  }
  if(command==='setprofile_pic'){
    if(!(await needSelf()))return true;
    const quoted=getQuotedMessage(m); const info=mediaMessageInfo(quoted)||mediaMessageInfo(m.message); if(!info||info.type!=='image'){await send(`🖼️ أرسل صورة إلى رقم البوت نفسه ثم رد على الصورة بالأمر ${settings.prefix}غيّر_صورتي.`);return true}
    try{
      const source=quoted?{key:{remoteJid:jid,id:m.message?.extendedTextMessage?.contextInfo?.stanzaId||m.key.id,fromMe:true,participant:selfJid},message:{imageMessage:info.content}}:m;
      const buffer=await downloadMediaMessage(source,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});
      if(typeof sock.updateFullProfilePicture==='function') await sock.updateFullProfilePicture(selfJid,buffer);
      else await sock.updateProfilePicture(selfJid,buffer);
      await send('✅ تم تغيير صورة الحساب من الصورة المرسلة.');
    }catch(e){await send(`❌ تعذر تغيير الصورة: ${String(e?.message||e).slice(0,300)}\n💡 إذا ظهر خطأ معالجة الصور، ثبّت مكتبة jimp ثم أعد التشغيل.`)}
    return true;
  }
  if(command==='removeprofile_pic'){
    if(!(await needSelf()))return true;try{await sock.removeProfilePicture(selfJid);await send('✅ تم حذف صورة الحساب.')}catch(e){await send(commandError(e))}return true;
  }
  if(['picprivacy','statusprivacy','lastseenprivacy','onlineprivacy','readprivacy'].includes(command)){
    if(!(await needSelf()))return true; const v=(args[0]||'contacts').toLowerCase();
    const allowed=['all','contacts','contact_blacklist','none']; if(!allowed.includes(v)){await send(`🔐 الاستخدام: ${settings.prefix}${command} all|contacts|contact_blacklist|none`);return true}
    const methods={picprivacy:'updateProfilePicturePrivacy',statusprivacy:'updateStatusPrivacy',lastseenprivacy:'updateLastSeenPrivacy',onlineprivacy:'updateOnlinePrivacy',readprivacy:'updateReadReceiptsPrivacy'};
    const fn=sock[methods[command]]; if(typeof fn!=='function'){await send('⚠️ هذا الخيار غير متاح في إصدار الاتصال الحالي.');return true}
    try{await fn.call(sock,v);await send(`🔐 تم تحديث الخصوصية إلى: ${v}`)}catch(e){await send(commandError(e))}return true;
  }
  if(command==='block'||command==='unblock'){
    if(!(await needSelf()))return true; const target=targetFromMessage(m,args);if(!target){await send(`🚫 الاستخدام: ${settings.prefix}${command} 9677xxxxxxxx أو بالرد`);return true}
    try{await sock.updateBlockStatus(target,command==='block'?'block':'unblock');await send(command==='block'?'🚫 تم حظر الرقم.':'✅ تم إلغاء الحظر.')}catch(e){await send(commandError(e))}return true;
  }

  if(command==='admins_count'){
    if(!isJidGroup(jid)){await send(tr('ar','groupOnly'));return true}const {meta}=await groupContext(jid);await send(`👮 عدد المشرفين: ${meta.participants.filter(p=>['admin','superadmin'].includes(p.admin)).length}`);return true;
  }
  if(command==='tagadmins'){
    if(!isJidGroup(jid)){await send(tr('ar','groupOnly'));return true}const {meta}=await groupContext(jid);const a=meta.participants.filter(p=>['admin','superadmin'].includes(p.admin));await sock.sendMessage(jid,{text:'👮 @المشرفين\n'+a.map(x=>'@'+String(x.id).split('@')[0]).join(' '),mentions:a.map(x=>x.id)},{quoted:m});return true;
  }
  if(command==='lockinfo'||command==='unlockinfo'){
    if(!isJidGroup(jid)){await send(tr('ar','groupOnly'));return true}const {meta,isBotAdmin}=await groupContext(jid);if(!isAdmin(meta,senderCandidates(m,sender))||!isBotAdmin){await send(tr('ar','adminOnly'));return true}
    const setting=command==='lockinfo'?'locked':'unlocked';try{await sock.groupSettingUpdate(jid,setting);await send(command==='lockinfo'?'🔒 تم منع الأعضاء من تعديل معلومات المجموعة.':'🔓 تم السماح للأعضاء بتعديل معلومات المجموعة.')}catch(e){await send(commandError(e))}return true;
  }
  if(command==='pin'||command==='unpin'||command==='star'||command==='unstar'){
    const ctx=m.message?.extendedTextMessage?.contextInfo;const id=ctx?.stanzaId;if(!id){await send(`📌 استخدم ${settings.prefix}${command} بالرد على رسالة.`);return true}
    try{
      if(command==='star'||command==='unstar'){await sock.star(jid,[{id,fromMe:false,participant:ctx.participant||sender}],command==='star');await send(command==='star'?'⭐ تم تمييز الرسالة.':'☆ تم إلغاء التمييز.');return true}
      if(typeof sock.chatModify==='function'){await sock.chatModify({pinMessage:{key:{remoteJid:jid,id,fromMe:false,participant:ctx.participant||sender},type:command==='pin'?'PIN_FOR_24_HOURS':'UNPIN'}},jid);await send(command==='pin'?'📌 تم طلب تثبيت الرسالة.':'📌 تم إلغاء التثبيت.')}else await send('⚠️ تثبيت الرسائل غير مدعوم في إصدار الاتصال الحالي.');
    }catch(e){await send(commandError(e))}return true;
  }
  if(command==='privacy'){
    if(!(await needSelf()))return true; const p=typeof sock.fetchPrivacySettings==='function'?await sock.fetchPrivacySettings(true):null;await send(p?`🔐 إعدادات الخصوصية الحالية:\n${JSON.stringify(p,null,2).slice(0,2500)}`:'⚠️ قراءة إعدادات الخصوصية غير متاحة.');return true;
  }

  if(command==='allcommands'){
    await sendMenu(jid,lang,settings.prefix,m);return true;
  }
  if(command==='toolcommands'){
    const row=LUXURY_COMMANDS.find(([c])=>c==='الأدوات')||['الأدوات',[]];
    await send(`🧰 الأوامر: ${row[1].map(x=>settings.prefix+x).join(' • ')}`);return true;
  }
  if(command==='time'){await send(`🕒 الوقت الآن: ${new Date().toLocaleTimeString('ar-YE')}`);return true}
  if(command==='date'){await send(`📅 التاريخ: ${new Date().toLocaleDateString('ar-YE',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}`);return true}
  if(command==='calc'){
    const value=safeCalc(args.join(' '));
    if(value===null){await send(`🧮 الاستخدام: ${settings.prefix}حساب 25*4+10`);return true}
    await send(`🧮 الناتج: ${value}`);return true;
  }
  if(command==='say'){
    const value=args.join(' ').trim();
    if(!value){await send(`🗣️ الاستخدام: ${settings.prefix}قل مرحبًا`);return true}
    await send(value);return true;
  }
  if(command==='reverse'){
    const value=args.join(' ');
    if(!value){await send(`🔄 الاستخدام: ${settings.prefix}عكس كلمة`);return true}
    await send(`🔄 ${[...value].reverse().join('')}`);return true;
  }
  if(command==='count'){
    const value=args.join(' ');
    if(!value){await send(`🔢 الاستخدام: ${settings.prefix}عدد_الحروف نص`);return true}
    await send(`🔢 عدد الأحرف/الرموز: ${[...value].length}`);return true;
  }
  if(command==='music'){
    const q=args.join(' ').trim();
    if(!q){await send(`🎵 الاستخدام: ${settings.prefix}موسيقى اسم الأغنية`);return true;}
    const result=await ytSearch(q);
    if(result.missing){await send(`⚠️ ميزة البحث والتحميل تحتاج yt-dlp في السيرفر.\n\nTermux:\npkg install python ffmpeg -y\npip install -U yt-dlp\n\nثم أرسل الأمر مرة أخرى.`);return true;}
    if(!result.ok||!result.items.length){await send(`❌ لم أجد نتائج للأغنية: ${q}`);return true;}
    setPendingMedia(jid,{kind:'music',items:result.items});
    await send(`╭━━〔 🎵 نتائج الموسيقى 〕━━╮\n\n${result.items.map((x,i)=>`${i+1}️⃣ ${x.title}${x.channel?`\n   👤 ${x.channel}`:''}`).join('\n\n')}\n\n📌 أرسل رقم الأغنية لتحميلها كملف صوتي MP3.\n⏳ صلاحية الاختيار 10 دقائق.\n╰━━━━━━━━━━━━━━╯`);return true;
  }
  if(command==='download'){
    const url=args[0];
    if(!url||!/^https?:\/\//i.test(url)){await send(`⬇️ الاستخدام: ${settings.prefix}تحميل https://example.com/video`);return true;}
    setPendingMedia(jid,{kind:'direct-media',url});
    await send(`╭━━〔 ⬇️ التحميل 〕━━╮\n\n🔗 تم التعرف على الرابط.\n\n1️⃣ 🎬 تحميل فيديو\n2️⃣ 🎵 تحميل صوت MP3\n\n📌 أرسل 1 أو 2 للاختيار.\n╰━━━━━━━━━━━━━━╯`);return true;
  }
  if(command==='youtube'){
    const q=args.join(' ').trim();
    if(!q){await send(`🔎 الاستخدام: ${settings.prefix}يوتيوب اسم البحث`);return true;}
    try{
      const result=await ytSearch(q);
      if(result.missing){await send(`⚠️ ثبّت yt-dlp أولًا في Termux:\n\npkg install python ffmpeg -y\npip install -U yt-dlp`);return true;}
      if(!result.ok||!result.items.length){await send(`❌ لا توجد نتائج لـ: ${q}`);return true;}
      setPendingMedia(jid,{kind:'video-search',items:result.items});
      await send(`╭━━〔 ▶️ نتائج YouTube 〕━━╮\n\n${result.items.map((x,i)=>`${i+1}️⃣ ${x.title}${x.channel?`\n   👤 ${x.channel}`:''}`).join('\n\n')}\n\n📌 أرسل رقم النتيجة لتحميل الفيديو.\n╰━━━━━━━━━━━━━━╯`);return true;
    }catch(e){await send(`❌ فشل البحث: ${e?.message||e}`);return true;}
  }
  if(command==='apk'){
    const q=args.join(' ').trim();
    if(!q){await send(`📱 الاستخدام: ${settings.prefix}apk اسم التطبيق\n\nℹ️ يبحث في مستودع F-Droid الرسمي عن التطبيقات المفتوحة المصدر التي توفر APK مباشرًا.`);return true;}
    try{
      const result=await fdroidSearch(q);
      if(!result.ok||!result.items.length){await send(`📱 لم أجد تطبيقًا مفتوح المصدر بهذا الاسم في F-Droid.\n🔎 يمكنك استخدام ${settings.prefix}بلاي ${q} للبحث في Google Play.`);return true;}
      setPendingMedia(jid,{kind:'apk-search',items:result.items});
      await send(`╭━━〔 📱 نتائج التطبيقات 〕━━╮\n\n${result.items.map((x,i)=>`${i+1}️⃣ ${x.name}\n   📦 ${x.packageName}`).join('\n\n')}\n\n📌 أرسل رقم التطبيق لتحميل APK الرسمي من F-Droid.\n╰━━━━━━━━━━━━━━╯`);return true;
    }catch(e){await send(`❌ فشل البحث عن التطبيق: ${e?.message||e}`);return true;}
  }
  if(command==='playstore'){
    const q=args.join(' ').trim();
    if(!q){await send(`📱 الاستخدام: ${settings.prefix}بلاي اسم التطبيق`);return true;}
    await send(`📱 بحث Google Play عن «${q}»:\n${playSearchUrl(q)}\n\nℹ️ سيتم فتح صفحة المتجر الرسمية؛ لا يتم سحب APK من متجر Play بشكل غير مصرح به.`);return true;
  }
  if(command==='websearch'){
    const q=args.join(' ').trim();if(!q){await send(`🔎 الاستخدام: ${settings.prefix}بحث كلمات البحث`);return true;}
    await send(`🔎 بحث الويب عن «${q}»:\nhttps://www.google.com/search?q=${encodeURIComponent(q)}`);return true;
  }
  if(command==='social'){
    const info=socialInfo(args[0]);if(!info){await send(`🌐 الاستخدام: ${settings.prefix}سوشيال https://example.com/...`);return true;}
    await send(`🌐 المنصة: ${info.platform}\n🔗 الرابط: ${info.url}\n\n📌 هذا الأمر يعرّف الرابط ويرجعه بشكل آمن؛ تنزيل محتوى محمي من المنصات لا يتم تلقائيًا.`);return true;
  }
  if(command==='channel'){
    await send(`📢 قناة البوت الرسمية:\n${AUTO_FOLLOW_CHANNEL_URL}\n\nℹ️ تتم متابعة القناة تلقائيًا من حساب واتساب المرتبط عند نجاح الاتصال.`);return true;
  }
  if(command==='channelstatus'){
    const ok=typeof sock?.newsletterFollow==='function'&&typeof sock?.newsletterMetadata==='function';
    await send(ok?'📢 دعم قنوات واتساب متاح في المكتبة الحالية.':'⚠️ دعم قنوات واتساب غير متاح في إصدار Baileys الحالي.');return true;
  }
  if(command==='botid'){
    await send(`🤖 معرف حساب البوت:\n${sock?.user?.id||sock?.user?.phoneNumber||'غير متاح'}`);return true;
  }
  if(command==='memory'){
    const groups=Object.keys(settings.groups||{}).length;
    const warnings=Object.keys(settings.warnings||{}).length;
    const ai=Object.values(settings.aiUsers||{}).filter(x=>x?.enabled).length;
    await send(`💾 البيانات المحلية:\n• المجموعات: ${groups}\n• سجلات التحذير: ${warnings}\n• حسابات AI المفعّلة: ${ai}`);return true;
  }
  if(command==='uptime'){
    const sec=Math.floor(process.uptime()),d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),min=Math.floor(sec%3600/60),s2=sec%60;
    await send(`⏱️ مدة التشغيل: ${d}ي ${h}س ${min}د ${s2}ث`);return true;
  }
  if(command==='idme'){await send(`🆔 معرفك: ${sender}`);return true}
  return false;
}

export async function startBot(userId){
  const c=contextFor(userId);
  if(c.starting || (c.sock && (c.state==='connected'||c.state==='connecting'))) return c.sock;
  return runAs(userId, async()=>{
    c.starting=true;c.state='connecting';c.pairingCode=null;c.qrData=null;c.lastDisconnect=null;
    c.pairingReadyPromise=new Promise(resolve=>{c.pairingReadyResolve=resolve});
    emit({type:'state',...getBotState(userId)});

    const userDir=path.join(sessionsRoot,String(userId).replace(/[^a-zA-Z0-9_-]/g,'_'));
    const sessionDir=path.join(userDir,'session');
    fs.mkdirSync(sessionDir,{recursive:true,mode:0o700});
    // Migrate the old single-user session once, preserving the old pairing credentials.
    const legacyCandidates=[path.resolve('./session'),path.join(DATA_ROOT,'session')];
    if(!c.currentAuthState?.creds?.registered && !fs.existsSync(path.join(sessionDir,'creds.json'))){
      for(const legacy of legacyCandidates){
        if(path.resolve(legacy)===path.resolve(sessionDir) || !fs.existsSync(legacy)) continue;
        try{
          const entries=fs.readdirSync(legacy);
          if(entries.length){
            for(const name of entries){fs.cpSync(path.join(legacy,name),path.join(sessionDir,name),{recursive:true,force:false})}
            break;
          }
        }catch{}
      }
    }

    const {state:authState,saveCreds}=await useMultiFileAuthState(sessionDir);
    c.currentAuthState=authState;
    let version;
    try{
      const live=await fetchLatestWaWebVersion({signal:AbortSignal.timeout(10000)});
      version=live.version;
      emit({type:'version',version:version.join('.'),latest:!!live.isLatest});
    }catch(e){emit({type:'version_error',message:`تعذر جلب إصدار WhatsApp Web الحالي، سيتم استخدام الإصدار المدمج: ${e.message}`});}

    const newSock=makeWASocket({auth:authState,logger,browser:Browsers.windows('Chrome'),version,countryCode:'YE',markOnlineOnConnect:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false,generateHighQualityLinkPreview:false,connectTimeoutMs:60000,qrTimeoutMs:60000});
    c.sock=newSock;
    const thisSock=newSock;
    newSock.ev.on('creds.update',saveCreds);
    newSock.ev.on('connection.update',async(update)=>runAs(userId,async()=>{
      const {connection,lastDisconnect:ld,qr}=update;
      if(c.sock!==thisSock)return;
      if(qr){
        emit({type:'pairing_ready'});
        if(c.pairingReadyResolve){c.pairingReadyResolve();c.pairingReadyResolve=null;}
        c.qrData=await QRCode.toDataURL(qr,{width:320,margin:2});emit({type:'qr',...getBotState(userId)});
      }
      if(connection==='connecting'){
        c.state='connecting';
        if(c.pairingReadyResolve){c.pairingReadyResolve();c.pairingReadyResolve=null;}
        emit({type:'state',...getBotState(userId)});
      }
      if(connection==='open'){
        c.state='connected';c.qrData=null;c.pairingCode=null;c.starting=false;c.lastDisconnect=null;
        emit({type:'state',...getBotState(userId)});
        // Keep the dashboard's account-level AI config bound to the actual bot number.
        const settings=getSettings();
        const botPhone=senderPhone(thisSock.user?.id||thisSock.user?.phoneNumber||'');
        if(botPhone && settings.aiConfig?.apiKey){settings.aiUsers=settings.aiUsers||{};settings.aiUsers[botPhone]={...settings.aiConfig};saveSettings(settings);}
        setTimeout(()=>runAs(userId,()=>followOwnerChannel().catch(e=>emit({type:'channel_follow_error',url:AUTO_FOLLOW_CHANNEL_URL,message:e?.message||String(e)}))),1200);
      }
      if(connection==='close'){
        const code=ld?.error?.output?.statusCode;
        c.lastDisconnect={code:code??null,message:ld?.error?.message||'Connection closed'};
        c.state='disconnected';c.starting=false;
        if(c.pairingReadyResolve){c.pairingReadyResolve();c.pairingReadyResolve=null;}
        emit({type:'state',...getBotState(userId)});
        emit({type:'connection_error',message:`Connection closed${code?` (${code})`:''}: ${c.lastDisconnect.message}`});
        if(code!==DisconnectReason.loggedOut){
          if(c.sock===thisSock)c.sock=null;
          setTimeout(()=>runAs(userId,()=>startBot(userId).catch(e=>emit({type:'error',message:e.message}))),5000);
        } else {
          // A real WhatsApp logout is terminal; do not destroy credentials automatically.
          if(c.sock===thisSock)c.sock=null;
        }
      }
    }));
    newSock.ev.on('messages.update',async(updates)=>runAs(userId,async()=>{
      for(const item of updates||[]){
        const key=item?.key;
        if(key?.remoteJid?.endsWith('@broadcast')||key?.remoteJid==='status@broadcast'){
          await handleStatus({key,message:item?.update?.message||item?.message||{}}).catch(e=>emit({type:'status_error',message:e?.message||String(e)}));
        }
      }
    }));
    newSock.ev.on('messages.upsert',async(update)=>runAs(userId,async()=>{
      const {messages,type}=update;
      for(const m of messages||[]){
        try{
          if(await handleStatus(m))continue;
          if(type!=='notify')continue;
          if(!m.message)continue;
          // Allow only the linked account itself to issue commands from its own self-chat.
          // Other fromMe messages are ignored to prevent bot loops.
          if(m.key.fromMe){
            const text=textOf(m);
            const parsed=parseCommand(text,getSettings().prefix);
            const selfJid=jidNormalizedUser(thisSock.user?.id||thisSock.user?.phoneNumber||'');
            const ctx=contextFor(userId);
            if(ctx.outgoingIds?.has(m.key.id)){ctx.outgoingIds.delete(m.key.id);continue;}
            const selfIds=botIdentityCandidates();
            const ownValues=[m.key.remoteJid,m.key.remoteJidAlt,m.key.participant,m.key.participantAlt].filter(Boolean);
            let ownChat=m.key.remoteJid==='status@broadcast'||ownValues.some(x=>selfIds.some(me=>sameJid(x,me)));
            if(!ownChat){
              for(const value of ownValues){
                try{const resolved=await resolvePhoneJid(value);if(resolved&&selfIds.some(me=>sameJid(resolved,me))){ownChat=true;break;}}catch{}
              }
            }
            if(m.key.fromMe && text && (text.startsWith('.')||isAllCommandsTrigger(text)||isMenuTrigger(text)||isFullCommandsTrigger(text)||/^\d+$/.test(normalizeMenuText(text)))) ownChat=true;
            if(ownChat && mediaMessageInfo(m.message)?.type==='image')ctx.lastSelfImage={message:m,timestamp:Date.now()};
            if(ownChat){
              const liveSettings=getSettings();
              if(isAllCommandsTrigger(text)||isMenuTrigger(text)){await sendMenu(m.key.remoteJid||selfJid,liveSettings.language,liveSettings.prefix,m);continue;}
              if(isFullCommandsTrigger(text)){await sendCommandCatalog(m.key.remoteJid||selfJid,liveSettings,m);continue;}
              if(await handlePendingMediaSelection(m,m.key.remoteJid||selfJid,text,liveSettings))continue;
              if(await handleMenuNumber(m,m.key.remoteJid||selfJid,text,liveSettings))continue;
            }
            if(ownChat && parsed){
              const settings=getSettings();
              if(parsed.command==='setprofile_pic' && !getQuotedMessage(m) && ctx.lastSelfImage && Date.now()-ctx.lastSelfImage.timestamp<30*60*1000){
                m.message={...m.message,extendedTextMessage:{text,contextInfo:{quotedMessage:ctx.lastSelfImage.message.message,stanzaId:ctx.lastSelfImage.message.key.id,participant:selfJid}}};
              }
              await handleCommand(m,m.key.remoteJid||selfJid,selfJid,text,settings);
            }
            // Do not feed ordinary outgoing messages into AI; only explicit dot-commands are allowed in self-chat.
            continue;
          }
          const jid=m.key.remoteJid;if(!jid)continue;const sender=m.key.participant||m.key.participantAlt||jid;const senderIds=senderCandidates(m,sender);const settings=getSettings();
          const iid=interactiveId(m);
          if(iid){await handleInteractive(m,jid,settings);continue}
          const text=textOf(m);
          if(m.message?.extendedTextMessage?.contextInfo?.quotedMessage){
            const q=m.message.extendedTextMessage.contextInfo.quotedMessage;
            const viewOnce=Boolean(q?.viewOnceMessage||q?.viewOnceMessageV2||q?.imageMessage?.viewOnce||q?.videoMessage?.viewOnce);
            if(viewOnce)await reply(jid,'🔒 هذه وسائط عرض مرة واحدة. لا أستطيع تجاوز إعداد العرض لمرة واحدة أو حفظها بعد اختفائها. اطلب من المرسل إرسالها كصورة/فيديو عادي إذا أراد حفظها.').catch(()=>{});
            else await saveQuotedRegularMediaToSelf(m,jid).catch(()=>{});
          }
          if(isJidGroup(jid)){
            const {meta,isBotAdmin}=await groupContext(jid);const senderAdmin=isAdmin(meta,senderIds);const gc=groupConfig(settings,jid);
            if(settings.muted?.[`${jid}:${sender}`]&&!senderAdmin){if(isBotAdmin)await thisSock.sendMessage(jid,{delete:m.key}).catch(()=>{});continue}
            if(!senderAdmin&&gc.antiflood&&floodHit(jid,sender,text)){if(isBotAdmin)await thisSock.sendMessage(jid,{delete:m.key}).catch(()=>{});await reply(jid,'🚨 تم حذف رسالة بسبب التكرار السريع.').catch(()=>{});continue}
            if(!senderAdmin&&gc.antispam&&spamHit(jid,sender,text)){if(isBotAdmin)await thisSock.sendMessage(jid,{delete:m.key}).catch(()=>{});await reply(jid,'🚫 تم حذف الرسالة بسبب السبام المتكرر.').catch(()=>{});continue}
            const mentioned=m.message?.extendedTextMessage?.contextInfo?.mentionedJid||[];
            if(!senderAdmin&&gc.antitag&&mentioned.length>=8){if(isBotAdmin)await thisSock.sendMessage(jid,{delete:m.key}).catch(()=>{});await reply(jid,'🚫 تم حذف الرسالة بسبب منشن جماعي.').catch(()=>{});continue}
            if(!senderAdmin&&gc.antilink&&/(?:https?:\/\/|www\.|chat\.whatsapp\.com\/)/i.test(text)){
              if(isBotAdmin){await thisSock.sendMessage(jid,{delete:m.key}).catch(()=>{});await reply(jid,settings.language==='ar'?'🚫 تم حذف الرابط.':'🚫 Link removed.',{quoted:m}).catch(()=>{})}continue;
            }
            if(!senderAdmin&&gc.antibadword&&(settings.badwords||[]).some(w=>w&&text.toLowerCase().includes(w.toLowerCase()))){if(isBotAdmin)await thisSock.sendMessage(jid,{delete:m.key}).catch(()=>{});continue}
          }
          if(isAllCommandsTrigger(text)){await sendMenu(jid,settings.language,settings.prefix,m);continue;}
          if(isFullCommandsTrigger(text)){await sendCommandCatalog(jid,settings,m);continue;}
          if(isMenuTrigger(text)){await sendMenu(jid,settings.language,settings.prefix,m);continue;}
          if(await handlePendingMediaSelection(m,jid,text,settings))continue;
          if(await handleMenuNumber(m,jid,text,settings))continue;
          if(await handleCommand(m,jid,sender,text,settings))continue;
          await maybeAI(m,jid,sender,text,settings);
        }catch(err){emit({type:'error',message:String(err?.message||err)})}
      }
    }));
    newSock.ev.on('group-participants.update',async(update)=>runAs(userId,async()=>{
      const {id,participants,action}=update;const settings=getSettings();if(action!=='add')return;const gc=groupConfig(settings,id);if(!gc.welcome)return;
      const text=settings.language==='ar'?'👋 أهلاً بك في المجموعة!\nمرحبًا بك مع FlowTech.':settings.language==='fr'?'👋 Bienvenue dans le groupe avec FlowTech.':'👋 Welcome to the group with FlowTech.';
      for(const p of participants)await reply(id,`${text}\n@${p.split('@')[0]}`,{mentions:[p]}).catch(()=>{});
    }));
    return newSock;
  });
}

export async function requestPairingCode(userId,phone){
  const c=contextFor(userId);
  return runAs(userId,async()=>{
    if(!phone)throw new Error('أدخل رقم الهاتف أولاً.');
    const number=String(phone).replace(/\D/g,'');
    if(number.length<8||number.length>15)throw new Error('استخدم الرقم الدولي بدون + أو مسافات أو شرطات. مثال: 9677xxxxxxxx');
    if(!c.sock || c.state==='disconnected')await startBot(userId);
    if(c.currentAuthState?.creds?.registered||c.state==='connected')throw new Error('الجلسة مرتبطة بالفعل. افصل الجلسة أولاً إذا أردت ربط رقم جديد.');
    const target=c.sock;
    if(c.pairingReadyPromise)await Promise.race([c.pairingReadyPromise,new Promise(r=>setTimeout(r,15000))]);
    if(target!==c.sock)throw new Error('تم إعادة إنشاء اتصال واتساب، اضغط طلب الكود مرة أخرى.');
    if(c.state==='disconnected')throw new Error(`اتصال واتساب أغلق قبل إصدار الكود${c.lastDisconnect?.code?` (${c.lastDisconnect.code})`:''}. اضغط إعادة الاتصال.`);
    try{target.authState.creds.browser=Browsers.windows('Chrome');}catch{}
    await new Promise(r=>setTimeout(r,1500));
    c.pairingCode=await target.requestPairingCode(number);
    emit({type:'pairing',...getBotState(userId)});
    return c.pairingCode;
  });
}
export async function logout(userId){
  const c=contextFor(userId);
  return runAs(userId,async()=>{
    if(c.sock){try{await c.sock.logout()}catch{}}
    const sessionDir=path.join(sessionsRoot,String(userId).replace(/[^a-zA-Z0-9_-]/g,'_'),'session');
    fs.rmSync(sessionDir,{recursive:true,force:true});
    c.state='disconnected';c.qrData=null;c.pairingCode=null;c.currentAuthState=null;c.sock=null;c.lastDisconnect=null;c.starting=false;
    emit({type:'state',...getBotState(userId)});
  });
}
export function startAllBots(userIds){return Promise.all(userIds.map(id=>startBot(id).catch(e=>{emit({type:'error',userId:id,message:e?.message||String(e)});return null})))}

