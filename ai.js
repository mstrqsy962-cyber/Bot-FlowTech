import OpenAI from 'openai';

function clean(s){return String(s||'').trim().slice(0,12000);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function isRetryableGeminiError(status,message){
  const s=String(message||'').toLowerCase();
  return status===408||status===425||status===429||status===500||status===502||status===503||status===504||/high demand|tempor|overloaded|unavailable|resource exhausted|rate limit|try again later|fetch failed|network|econnreset|etimedout|enotfound|enetwork|socket hang up/.test(s);
}
function isNetworkError(error){
  const s=String(error?.message||error||'').toLowerCase();
  const cause=String(error?.cause?.code||error?.cause?.message||'').toLowerCase();
  return error?.name==='TypeError' || /fetch failed|network|econnreset|etimedout|enotfound|enetwork|eai_again|socket hang up/.test(`${s} ${cause}`);
}
function isModelSelectionError(status,message){
  const s=String(message||'').toLowerCase();
  return status===404||/model .*not found|not found.*model|model.*not supported|unsupported model|unknown model|is not available/.test(s);
}

async function geminiRequest({url,body,timeoutMs=9000}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(url,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},signal:controller.signal,body:JSON.stringify(body)});
  }catch(e){
    if(e?.name==='AbortError'){
      const err=new Error('انتهت مهلة اتصال Gemini.');err.status=504;err.code='GEMINI_TIMEOUT';throw err;
    }
    const err=new Error(isNetworkError(e)?'تعذر الاتصال بخدمة Gemini مؤقتًا.':String(e?.message||e));
    err.status=503;err.code=isNetworkError(e)?'GEMINI_NETWORK':'GEMINI_FETCH';err.cause=e?.cause;
    throw err;
  }finally{clearTimeout(timer);}
}

async function geminiGenerate({model,key,prompt,system}){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body={
    system_instruction:{parts:[{text:system||'أنت مساعد مفيد ومختصر. أجب بلغة المستخدم.'}]},
    contents:[{role:'user',parts:[{text:prompt}]}],
    generationConfig:{temperature:.6,maxOutputTokens:450}
  };
  let last=null;
  // Keep the normal path fast: one short retry only for transient network/capacity errors.
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await geminiRequest({url,body,timeoutMs:9000});
      const data=await r.json().catch(()=>({}));
      if(!r.ok){
        const err=new Error(data?.error?.message||`Gemini HTTP ${r.status}`);
        err.status=r.status;
        err.retryAfter=Number(r.headers?.get?.('retry-after')||0)||0;
        throw err;
      }
      const text=(data.candidates||[]).flatMap(c=>c.content?.parts||[]).map(p=>p.text||'').join('').trim();
      if(!text)throw new Error('Gemini لم يُرجع نصًا.');
      return text;
    }catch(e){
      last=e;
      if(!isRetryableGeminiError(e?.status,e?.message))throw e;
      if(attempt===0){
        const retryDelay=e?.retryAfter>0?Math.min(e.retryAfter*1000,1500):isNetworkError(e)?250:300;
        await sleep(retryDelay);
      }
    }
  }
  throw last||new Error('تعذر الاتصال بـ Gemini.');
}

export async function askAI({provider, model, prompt, system, previousResponseId, apiKey}={}){
  provider=(provider||process.env.AI_PROVIDER||'gemini').toLowerCase();
  prompt=clean(prompt); system=clean(system);
  if(!prompt) return {text:'',responseId:null,model:model||null};

  if(provider==='openai'){
    const key=apiKey||process.env.OPENAI_API_KEY;
    if(!key) throw new Error('لم تتم إضافة مفتاح OpenAI لهذا المستخدم.');
    const client=new OpenAI({apiKey:key,timeout:30000,maxRetries:2});
    const response=await client.responses.create({
      model:model||process.env.OPENAI_MODEL||'gpt-5.5',
      instructions:system||'أنت مساعد مفيد ومختصر. أجب بلغة المستخدم.',
      input:prompt,
      ...(previousResponseId?{previous_response_id:previousResponseId}:{}),
      max_output_tokens:800
    });
    return {text:response.output_text||'',responseId:response.id,model:model||process.env.OPENAI_MODEL||'gpt-5.5'};
  }

  if(provider==='gemini'){
    const key=apiKey||process.env.GEMINI_API_KEY;
    if(!key) throw new Error('لم تتم إضافة مفتاح Gemini.');
    const requested=model||process.env.GEMINI_MODEL||'gemini-3.5-flash-lite';
    const fallback=['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite'];
    const models=[requested,...fallback].filter((v,i,a)=>v&&a.indexOf(v)===i);
    let last=null;
    for(const mdl of models){
      try{
        const text=await geminiGenerate({model:mdl,key,prompt,system});
        return {text,responseId:null,model:mdl};
      }catch(e){
        last=e;
        if(!isRetryableGeminiError(e?.status,e?.message) && !isModelSelectionError(e?.status,e?.message))throw e;
        await sleep(isModelSelectionError(e?.status,e?.message)?50:200);
      }
    }
    throw new Error(`تعذر الرد من Gemini حاليًا بعد إعادة المحاولة تلقائيًا. آخر خطأ: ${last?.message||'غير معروف'}`);
  }
  throw new Error(`مزود AI غير مدعوم: ${provider}`);
}
