export const LANGS = ['ar','en','fr'];
const t = {
  ar: {
    menu:'قائمة FlowTech', help:'المساعدة', ping:'البوت يعمل بسرعة.', status:'حالة البوت: متصل.', owner:'المطور', info:'معلومات البوت',
    adminOnly:'هذا الأمر للمشرفين فقط.', groupOnly:'هذا الأمر يعمل داخل المجموعات فقط.', userMissing:'حدد عضوًا أو قم بالرد على رسالته.',
    kicked:'تم طرد العضو.', promoted:'تمت ترقية العضو إلى مشرف.', demoted:'تم خفض العضو من الإشراف.', warned:'تم تسجيل تحذير.',
    tagall:'منشن للجميع', groupInfo:'معلومات المجموعة', antiLinkOn:'مضاد الروابط مفعّل.', antiLinkOff:'مضاد الروابط متوقف.',
    antiBadOn:'مضاد الكلمات مفعّل.', antiBadOff:'مضاد الكلمات متوقف.', welcomeOn:'الترحيب مفعّل.', welcomeOff:'الترحيب متوقف.',
    prefix:'البادئة الحالية', language:'اللغة الحالية', usage:'الاستخدام', unknown:'أمر غير معروف. اكتب !مساعدة', noPermission:'لا أملك صلاحية تنفيذ هذا الإجراء.',
    settings:'الإعدادات', connected:'متصل', disconnected:'غير متصل'
  },
  en: {
    menu:'FlowTech Menu', help:'Help', ping:'Bot is online.', status:'Bot status: connected.', owner:'Developer', info:'Bot information',
    adminOnly:'This command is for group admins only.', groupOnly:'This command works in groups only.', userMissing:'Mention a member or reply to their message.',
    kicked:'Member removed.', promoted:'Member promoted.', demoted:'Member demoted.', warned:'Warning recorded.',
    tagall:'Mention everyone', groupInfo:'Group information', antiLinkOn:'Anti-link enabled.', antiLinkOff:'Anti-link disabled.',
    antiBadOn:'Anti-badword enabled.', antiBadOff:'Anti-badword disabled.', welcomeOn:'Welcome enabled.', welcomeOff:'Welcome disabled.',
    prefix:'Current prefix', language:'Current language', usage:'Usage', unknown:'Unknown command. Type !help', noPermission:'I cannot perform this action.',
    settings:'Settings', connected:'Connected', disconnected:'Disconnected'
  },
  fr: {
    menu:'Menu FlowTech', help:'Aide', ping:'Le bot est en ligne.', status:'État: connecté.', owner:'Développeur', info:'Informations du bot',
    adminOnly:'Commande réservée aux admins.', groupOnly:'Cette commande fonctionne dans les groupes.', userMissing:'Mentionnez un membre ou répondez à son message.',
    kicked:'Membre supprimé.', promoted:'Membre promu.', demoted:'Membre rétrogradé.', warned:'Avertissement enregistré.',
    tagall:'Mentionner tout le monde', groupInfo:'Infos du groupe', antiLinkOn:'Anti-liens activé.', antiLinkOff:'Anti-liens désactivé.',
    antiBadOn:'Anti-mots activé.', antiBadOff:'Anti-mots désactivé.', welcomeOn:'Accueil activé.', welcomeOff:'Accueil désactivé.',
    prefix:'Préfixe actuel', language:'Langue actuelle', usage:'Utilisation', unknown:'Commande inconnue. Tapez !help', noPermission:'Action non autorisée.',
    settings:'Paramètres', connected:'Connecté', disconnected:'Déconnecté'
  }
};
export function tr(lang,key){ return t[lang]?.[key] ?? t.en[key] ?? key; }
export function normalizeLang(v){ return LANGS.includes(v) ? v : 'ar'; }
export const labels = {
  ar: { menu:'قائمة', help:'مساعدة', ping:'بينغ', status:'حالة', owner:'المطور', info:'معلومات', kick:'طرد', promote:'ترقية', demote:'خفض', warn:'تحذير', tagall:'تاج_الكل', groupinfo:'معلومات_المجموعة', antilink:'مضاد_روابط', antibadword:'مضاد_كلمات', welcome:'ترحيب', language:'لغة', prefix:'بادئة', statusview:'مشاهدة_الحالات', statusreact:'تفاعل_الحالات', ai:'ذكاء', menu_basic:'أساسيات', menu_group:'المجموعة', menu_protection:'الحماية', menu_status:'الحالات', menu_ai:'الذكاء', menu_settings:'الإعدادات' },
  en: { menu:'menu', help:'help', ping:'ping', status:'status', owner:'owner', info:'info', kick:'kick', promote:'promote', demote:'demote', warn:'warn', tagall:'tagall', groupinfo:'groupinfo', antilink:'antilink', antibadword:'antibadword', welcome:'welcome', language:'language', prefix:'prefix', statusview:'statusview', statusreact:'statusreact', ai:'ai', menu_basic:'basics', menu_group:'group', menu_protection:'protection', menu_status:'statuses', menu_ai:'ai_menu', menu_settings:'settings' },
  fr: { menu:'menu', help:'help', ping:'ping', status:'status', owner:'owner', info:'info', kick:'kick', promote:'promote', demote:'demote', warn:'warn', tagall:'tagall', groupinfo:'groupinfo', antilink:'antilink', antibadword:'antibadword', welcome:'welcome', language:'langue', prefix:'prefixe', statusview:'voir_statuts', statusreact:'reaction_statuts', ai:'ia', menu_basic:'base', menu_group:'groupe', menu_protection:'protection', menu_status:'statuts', menu_ai:'ia_menu', menu_settings:'reglages' }
};
