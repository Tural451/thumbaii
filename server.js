require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "data.json");

app.use(express.json({limit:"20kb"}));
app.use(express.static(path.join(__dirname, "public")));

function load(){
  try{return JSON.parse(fs.readFileSync(DATA,"utf8"))}
  catch{return {plan:"free", usage:{}, history:[]}}
}
function save(d){fs.writeFileSync(DATA,JSON.stringify(d,null,2))}
function today(){return new Date().toISOString().slice(0,10)}
function limit(plan){return plan==="free"?1:plan==="pro"?30:100}
function used(d){
  if(d.plan==="free") return d.usage.month===new Date().toISOString().slice(0,7)?(d.usage.count||0):0;
  return d.usage.date===today()?(d.usage.count||0):0;
}

app.get("/api/status",(req,res)=>{
 const d=load(); res.json({plan:d.plan,used:used(d),limit:limit(d.plan)})
});

app.get("/api/history",(req,res)=>res.json({items:load().history.slice(0,30)}));

app.post("/api/dev-plan",(req,res)=>{
 // Demo-only plan switch. Replace this endpoint with real payment/webhook logic in production.
 const p=req.body?.plan;
 if(!["free","pro","premium"].includes(p)) return res.status(400).json({error:"Invalid plan"});
 const d=load();d.plan=p;d.usage={};save(d);
 res.json({message:`Demo plan: ${p}`});
});

app.post("/api/generate",async(req,res)=>{
 try{
   const {prompt,style,goal}=req.body||{};
   if(!prompt || prompt.length<3) return res.status(400).json({error:"Слишком короткая тема"});
   const d=load();
   const max=limit(d.plan), u=used(d);
   if(u>=max) return res.status(429).json({error:`Лимит ${max} генерац${d.plan==="free"?"ия":"ий"} исчерпан. Перейди на другой план.`});

   const key=process.env.OPENROUTER_API_KEY;
   if(!key) return res.status(500).json({error:"Не найден OPENROUTER_API_KEY. Создай .env и добавь ключ."});

   const system=`Ты — эксперт по YouTube thumbnails и viral content. Отвечай на русском.
Сделай концепцию для ролика. Верни строго JSON без markdown:
{"title":"короткий цепляющий заголовок","text":"подробная концепция превью: композиция, главный объект, фон, свет, цвета, короткий текст на превью и почему это должно работать"}.
Не обещай гарантированный CTR. Будь конкретным.`;

   const user=`Тема: ${prompt}
Стиль: ${style||"Gaming"}
Цель: ${goal||"Максимальный CTR"}`;

   const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
     method:"POST",
     headers:{
       "Authorization":`Bearer ${key}`,
       "Content-Type":"application/json",
       "HTTP-Referer":process.env.SITE_URL||"http://localhost:3000",
       "X-Title":"ThumbAI"
     },
     body:JSON.stringify({
       model:"openrouter/free",
       messages:[{role:"system",content:system},{role:"user",content:user}],
       temperature:0.8,
       max_tokens:700
     })
   });
   const raw=await response.json();
   if(!response.ok) return res.status(502).json({error:raw?.error?.message||"OpenRouter API error"});
   let content=raw?.choices?.[0]?.message?.content||"";
   content=content.replace(/^```json\s*/i,"").replace(/\s*```$/,"").trim();

   let out;
   try{out=JSON.parse(content)}
   catch{out={title:"AI-концепция",text:content}}

   if(d.plan==="free"){
     d.usage={month:new Date().toISOString().slice(0,7),count:u+1};
   }else{
     d.usage={date:today(),count:u+1};
   }
   d.history.unshift({title:out.title||"AI-концепция",text:out.text||content,prompt,createdAt:new Date().toISOString()});
   d.history=d.history.slice(0,30);
   save(d);

   res.json({title:out.title||"AI-концепция",text:out.text||content});
 }catch(e){
   console.error(e);
   res.status(500).json({error:"Ошибка сервера: "+e.message});
 }
});

app.listen(PORT,()=>console.log(`ThumbAI: http://localhost:${PORT}`));