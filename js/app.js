// app.js — OPFS silencioso si hay soporte; si no, muestra causa (HTTPS/incógnito/soporte)

const canvas = document.getElementById('sigCanvas');
const bg = document.getElementById('bg');
const btnGuardar = document.getElementById('btnGuardar');
const btnLimpiar = document.getElementById('btnLimpiar');
const centerCta = document.getElementById('centerCta');
const toast = document.getElementById('toast');
const badge = document.getElementById('badge');
const btnExportar = document.getElementById('btnExportar');

const CONFIG = {
  strokeColor: '#000000',
  strokeWidth: 5,
  exportOnlySignature: true,  // firma transparente
  filenamePrefix: 'firma_',
  autoClearSeconds: 15,
  exportWidth: 1080,
  exportHeight: 1920
};

let drawing=false, lastX=0, lastY=0, dirty=false, savedSinceLastDraw=false, autoClearTimer=null;

// ====== Diagnóstico de entorno ======
const env = {
  secure: window.isSecureContext === true, // HTTPS o PWA
  hasOPFS: !!(navigator.storage && navigator.storage.getDirectory),
  incognitoLike: false, // no hay API oficial; inferimos por persist()
  readyForSilent: false
};

async function initPersistence(){
  try {
    if (navigator.storage?.persist) {
      const persisted = await navigator.storage.persisted();
      if (!persisted) {
        const granted = await navigator.storage.persist().catch(()=>false);
        env.incognitoLike = (granted === false);
      } else {
        env.incognitoLike = false;
      }
    }
  } catch {
    env.incognitoLike = true;
  }
  env.readyForSilent = env.secure && env.hasOPFS && !env.incognitoLike;
  // Badge con estado
  if (badge) {
    badge.textContent =
      env.readyForSilent ? 'Listo: OPFS' :
      !env.secure ? 'No HTTPS/PWA' :
      !env.hasOPFS ? 'Sin OPFS' :
      'Incógnito / sin persist.';
  }
}
initPersistence();

// ===== Canvas / Dibujo =====
function resizeCanvas(){
  const dpr = Math.max(1, Math.min(window.devicePixelRatio||1, 2));
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width*dpr);
  canvas.height = Math.round(rect.height*dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,rect.width,rect.height);
  dirty=false; savedSinceLastDraw=false;
}
window.addEventListener('resize', resizeCanvas, {passive:true});
resizeCanvas();

function getPosFromEvent(e){
  const r = canvas.getBoundingClientRect();
  let x,y;
  if (e.touches?.[0]) { x=e.touches[0].clientX; y=e.touches[0].clientY; }
  else if (e.changedTouches?.[0]) { x=e.changedTouches[0].clientX; y=e.changedTouches[0].clientY; }
  else { x=e.clientX; y=e.clientY; }
  return {x:x-r.left, y:y-r.top};
}
function startDraw(e){ e.preventDefault(); const p=getPosFromEvent(e);
  lastX=p.x; lastY=p.y; drawing=true; dirty=true; savedSinceLastDraw=false;
  centerCta?.classList.add('hidden'); scheduleAutoClear();
}
function moveDraw(e){ if(!drawing) return; e.preventDefault();
  const p=getPosFromEvent(e); const ctx=canvas.getContext('2d');
  ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=CONFIG.strokeColor; ctx.lineWidth=CONFIG.strokeWidth;
  ctx.beginPath(); ctx.moveTo(lastX,lastY); ctx.lineTo(p.x,p.y); ctx.stroke();
  lastX=p.x; lastY=p.y; scheduleAutoClear();
}
function endDraw(e){ if(!drawing) return; e.preventDefault(); drawing=false; }

canvas.addEventListener('pointerdown', startDraw, {passive:false});
canvas.addEventListener('pointermove', moveDraw, {passive:false});
window.addEventListener('pointerup', endDraw, {passive:false});
canvas.addEventListener('pointercancel', endDraw, {passive:false});
canvas.addEventListener('pointerleave', endDraw, {passive:false});
canvas.addEventListener('mousedown', startDraw, {passive:false});
canvas.addEventListener('mousemove', moveDraw, {passive:false});
window.addEventListener('mouseup', endDraw, {passive:false});
canvas.addEventListener('touchstart', startDraw, {passive:false});
canvas.addEventListener('touchmove', moveDraw, {passive:false});
canvas.addEventListener('touchend', endDraw, {passive:false});

function clearCanvas(){
  const r = canvas.getBoundingClientRect();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,r.width,r.height);
  dirty=false; savedSinceLastDraw=false;
  centerCta?.classList.remove('hidden'); cancelAutoClear();
}
function scheduleAutoClear(){
  cancelAutoClear();
  if (!CONFIG.autoClearSeconds) return;
  autoClearTimer = setTimeout(()=>{
    if (dirty && !savedSinceLastDraw) { clearCanvas(); showToast('Se limpió por inactividad'); }
  }, CONFIG.autoClearSeconds*1000);
}
function cancelAutoClear(){ if (autoClearTimer){ clearTimeout(autoClearTimer); autoClearTimer=null; } }

function ts(){
  const d=new Date(), pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// toBlob robusto
function canvasToPngBlobSafe(cnv){
  return new Promise((resolve)=>{
    try {
      cnv.toBlob(b=>{
        if (b) return resolve(b);
        const url=cnv.toDataURL('image/png');
        const bin=atob(url.split(',')[1]); const arr=new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        resolve(new Blob([arr],{type:'image/png'}));
      }, 'image/png');
    } catch {
      try {
        const url=cnv.toDataURL('image/png');
        const bin=atob(url.split(',')[1]); const arr=new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        resolve(new Blob([arr],{type:'image/png'}));
      } catch { resolve(null); }
    }
  });
}

// OPFS helpers
async function saveOneToOPFS(blob, filename){
  const root = await navigator.storage.getDirectory();
  const dir  = await root.getDirectoryHandle('firmas', {create:true});
  const fh   = await dir.getFileHandle(filename, {create:true});
  const w    = await fh.createWritable();
  await w.write(blob); await w.close();
}
async function exportAllFromOPFS(){
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('firmas', {create:true});
  let count=0;
  for await (const entry of dir.values()){
    if (entry.kind === 'file'){
      const file = await entry.getFile();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 400);
      count++;
    }
  }
  showToast(count ? `Exportando ${count} archivo(s)` : 'No hay archivos');
}

// export 1 firma
async function exportPNG(){
  if (!dirty) { showToast('Primero firme con el dedo'); return; }

  // Render solo firma (1080x1920)
  const out = document.createElement('canvas');
  out.width = CONFIG.exportWidth; out.height = CONFIG.exportHeight;
  const octx = out.getContext('2d');
  octx.clearRect(0,0,out.width,out.height);
  octx.drawImage(canvas, 0, 0, out.width, out.height);

  const blob = await canvasToPngBlobSafe(out);
  if (!blob) { showToast('No se pudo crear el PNG'); return; }

  // Guardado silencioso si el entorno lo permite
  if (env.readyForSilent){
    try {
      await saveOneToOPFS(blob, CONFIG.filenamePrefix + ts() + '.png');
      savedSinceLastDraw = true;
      showToast('Guardado ✔ (interno)');
      clearCanvas();
      return;
    } catch (e){
      showToast('Error guardando interno');
    }
  }

  // Si caés acá, el entorno no permite OPFS silencioso
  // Mostramos motivo concreto para que sepas qué cambiar
  if (!env.secure) {
    showToast('Abra la página por HTTPS o instale como PWA. (No file:// / content://)');
  } else if (env.incognitoLike) {
    showToast('Desactive incógnito. El modo privado borra/impide el guardado.');
  } else if (!env.hasOPFS) {
    showToast('Navegador sin OPFS. Use Chrome/Edge actual.');
  } else {
    showToast('Entorno no apto para guardado silencioso.');
  }
}

// botones
btnGuardar.addEventListener('click', ()=>{ exportPNG().catch(e=>showToast('Error inesperado')); });
btnLimpiar.addEventListener('click', ()=>{ clearCanvas(); showToast('Pantalla limpia'); });
btnExportar?.addEventListener('click', ()=>{ exportAllFromOPFS().catch(e=>showToast('No se pudo exportar')); });

// UI menor
function showToast(msg){
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.style.display='none', 2200);
}
(function(){
  const ua = navigator.userAgent;
  badge.textContent = (window.matchMedia('(display-mode: standalone)').matches ? 'PWA' :
                       ua.includes('Electron') ? 'Electron' : (window.isSecureContext?'HTTPS':'No seguro'));
})();
