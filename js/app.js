// app.js — OPFS directo; si falla, descarga. Sin chequeos ni diagnósticos.

const canvas = document.getElementById('sigCanvas');
const bg = document.getElementById('bg');
const btnGuardar = document.getElementById('btnGuardar');
const btnLimpiar = document.getElementById('btnLimpiar');
const centerCta = document.getElementById('centerCta');
const toast = document.getElementById('toast');
const badge = document.getElementById('badge');
const btnExportar = document.getElementById('btnExportar'); // si existe

const CONFIG = {
  strokeColor: '#000000',
  strokeWidth: 5,
  exportOnlySignature: true,   // firma transparente
  filenamePrefix: 'firma_',
  autoClearSeconds: 15,
  exportWidth: 1080,
  exportHeight: 1920
};

let drawing=false, lastX=0, lastY=0, dirty=false, savedSinceLastDraw=false, autoClearTimer=null;

// === Fullscreen y orientación en el primer gesto del usuario ===
let _fsTried = false;

async function enterFullscreenIfPossible() {
  if (_fsTried) return;
  _fsTried = true;
  try {
    // Pide fullscreen sobre el documento
    if (document.fullscreenElement == null && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch(_) {}
  // Opcional: bloquear orientación vertical si el SO lo permite
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('portrait');
    }
  } catch(_) {}
}

// Engancha fullscreen al primer gesto (toque/clic) sobre el canvas o la UI
['pointerdown','touchstart','mousedown','click'].forEach(ev => {
  canvas.addEventListener(ev, enterFullscreenIfPossible, { once:true, passive:true });
});

// ------------ Canvas ------------
function resizeCanvas(){
  const dpr = Math.max(1, Math.min(window.devicePixelRatio||1, 2));
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width*dpr);
  canvas.height = Math.round(r.height*dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,r.width,r.height);
  dirty=false; savedSinceLastDraw=false;
}
window.addEventListener('resize', resizeCanvas, {passive:true});
resizeCanvas();

function pos(e){
  const r = canvas.getBoundingClientRect();
  let x,y;
  if (e.touches?.[0]) { x=e.touches[0].clientX; y=e.touches[0].clientY; }
  else if (e.changedTouches?.[0]) { x=e.changedTouches[0].clientX; y=e.changedTouches[0].clientY; }
  else { x=e.clientX; y=e.clientY; }
  return {x:x-r.left, y:y-r.top};
}

function startDraw(e){ e.preventDefault(); const p=pos(e);
  lastX=p.x; lastY=p.y; drawing=true; dirty=true; savedSinceLastDraw=false;
  centerCta?.classList.add('hidden'); scheduleAutoClear();
}
function moveDraw(e){ if(!drawing) return; e.preventDefault();
  const p=pos(e); const ctx=canvas.getContext('2d');
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
  centerCta?.classList.remove('hidden');
  cancelAutoClear();
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

// -------- OPFS directo; si falla, descarga --------
async function saveToOPFS(blob, filename){
  const root = await navigator.storage.getDirectory();
  const dir  = await root.getDirectoryHandle('firmas', {create:true});
  const fh   = await dir.getFileHandle(filename, {create:true});
  const w    = await fh.createWritable();
  await w.write(blob); await w.close();
}

async function downloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// export 1 firma
async function exportPNG(){
  if (!dirty) { showToast('Primero firme con el dedo'); return; }

  // salida 1080x1920 solo firma
  const out = document.createElement('canvas');
  out.width = CONFIG.exportWidth; out.height = CONFIG.exportHeight;
  const octx = out.getContext('2d');
  octx.clearRect(0,0,out.width,out.height);
  octx.drawImage(canvas, 0, 0, out.width, out.height);

  const blob = await canvasToPngBlobSafe(out);
  if (!blob) { showToast('No se pudo crear el PNG'); return; }

  const filename = CONFIG.filenamePrefix + ts() + '.png';

  try {
    await saveToOPFS(blob, filename);             // intenta OPFS sin preguntar nada
    savedSinceLastDraw = true;
    showToast('Guardado');                        // sin textos de entorno
    clearCanvas();
  } catch {
    await downloadBlob(blob, filename);           // fallback a descarga
    savedSinceLastDraw = true;
    showToast('Descargado');
    clearCanvas();
  }
}

// exportar todo (si el botón existe)
async function exportAllFromOPFS(){
  try {
    const root = await navigator.storage.getDirectory();
    const dir  = await root.getDirectoryHandle('firmas', {create:true});
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
    showToast(count?`Exportando ${count}`:'No hay archivos');
  } catch {
    showToast('No se pudo exportar');
  }
}

// botones
btnGuardar.addEventListener('click', ()=>{ exportPNG().catch(()=>showToast('Error')); });
btnLimpiar.addEventListener('click', ()=>{ clearCanvas(); showToast('Pantalla limpia'); });
btnExportar?.addEventListener('click', ()=>{ exportAllFromOPFS().catch(()=>showToast('Error exportando')); });

// ui menor
function showToast(msg){
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.style.display='none', 2000);
}

// marca versión visible para saber que cargó este JS
if (badge) badge.textContent = (badge.textContent ? badge.textContent + ' | ' : '') + 'v-NO-CHECKS';
