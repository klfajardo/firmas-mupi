// app.js — Guarda SILENCIOSO en OPFS + botón de exportar todas

const canvas = document.getElementById('sigCanvas');
const bg = document.getElementById('bg');
const btnGuardar = document.getElementById('btnGuardar');
const btnLimpiar = document.getElementById('btnLimpiar');
const centerCta = document.getElementById('centerCta');
const toast = document.getElementById('toast');
const badge = document.getElementById('badge');
const btnExportar = document.getElementById('btnExportar'); // <- nuevo

const CONFIG = {
  strokeColor: '#000000',     // cambia a '#FFFFFF' si tu arte es oscuro
  strokeWidth: 5,
  exportOnlySignature: true,  // PNG transparente solo firma
  filenamePrefix: 'firma_',
  autoClearSeconds: 15,
  exportWidth: 1080,
  exportHeight: 1920
};

let drawing = false;
let lastX=0, lastY=0;
let dirty = false;
let savedSinceLastDraw = false;
let autoClearTimer = null;

// === Pedir persistencia para reducir riesgo de eviction ===
(async () => {
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist().catch(()=>{});
    }
  } catch {}
})();

// ===== Canvas / Dibujo =====
function resizeCanvas(){
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,rect.width,rect.height);
  dirty = false;
  savedSinceLastDraw = false;
}
window.addEventListener('resize', resizeCanvas, {passive:true});
resizeCanvas();

function getPosFromEvent(e){
  const rect = canvas.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches[0]) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
  else if (e.changedTouches && e.changedTouches[0]) { clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY; }
  else { clientX = e.clientX; clientY = e.clientY; }
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function startDraw(e){
  e.preventDefault();
  const p = getPosFromEvent(e);
  lastX = p.x; lastY = p.y;
  drawing = true;
  dirty = true;
  savedSinceLastDraw = false;
  if (centerCta) centerCta.classList.add('hidden');
  scheduleAutoClear();
}
function moveDraw(e){
  if (!drawing) return;
  e.preventDefault();
  const p = getPosFromEvent(e);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = CONFIG.strokeColor;
  ctx.lineWidth = CONFIG.strokeWidth;
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  lastX = p.x; lastY = p.y;
  scheduleAutoClear();
}
function endDraw(e){
  if (!drawing) return;
  e.preventDefault();
  drawing = false;
}

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
  const rect = canvas.getBoundingClientRect();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,rect.width,rect.height);
  dirty = false;
  savedSinceLastDraw = false;
  if (centerCta) centerCta.classList.remove('hidden');
  cancelAutoClear();
}

function scheduleAutoClear(){
  cancelAutoClear();
  if (!CONFIG.autoClearSeconds || CONFIG.autoClearSeconds <= 0) return;
  autoClearTimer = setTimeout(()=>{
    if (dirty && !savedSinceLastDraw) {
      clearCanvas();
      showToast('Se limpió por inactividad');
    }
  }, CONFIG.autoClearSeconds * 1000);
}
function cancelAutoClear(){
  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null; }
}

function ts(){
  const d = new Date();
  const pad = n=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

// ===== Helper: toBlob robusto =====
function canvasToPngBlobSafe(cnv){
  return new Promise((resolve) => {
    try {
      cnv.toBlob((blob)=>{
        if (blob) return resolve(blob);
        const dataURL = cnv.toDataURL('image/png');
        const bin = atob(dataURL.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], {type:'image/png'}));
      }, 'image/png');
    } catch {
      try {
        const dataURL = cnv.toDataURL('image/png');
        const bin = atob(dataURL.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], {type:'image/png'}));
      } catch {
        resolve(null);
      }
    }
  });
}

// ===== Guardar 1 firma en OPFS (silencioso) =====
async function saveOneToOPFS(blob, filename){
  const root = await navigator.storage.getDirectory();              // OPFS root
  const dir = await root.getDirectoryHandle('firmas', {create:true});
  const fileHandle = await dir.getFileHandle(filename, {create:true});
  const w = await fileHandle.createWritable();
  await w.write(blob);
  await w.close(); // atómico al cerrar
}

// ===== Exportar TODO desde OPFS (descargas múltiples) =====
async function exportAllFromOPFS(){
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('firmas', {create:true});
  for await (const entry of dir.values()){
    if (entry.kind === 'file'){
      const file = await entry.getFile();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 400);
    }
  }
  showToast('Exportación lanzada');
}

// ===== Exportar UNA firma (flujo principal) =====
async function exportPNG(){
  if (!dirty) { showToast('Primero firme con el dedo'); return; }

  // Render SOLO firma 1080x1920 (evita taint por bg)
  const out = document.createElement('canvas');
  out.width = CONFIG.exportWidth;
  out.height = CONFIG.exportHeight;
  const octx = out.getContext('2d');
  octx.clearRect(0,0,out.width,out.height);
  octx.drawImage(canvas, 0, 0, out.width, out.height);

  const blob = await canvasToPngBlobSafe(out);
  if (!blob) { showToast('No se pudo crear el PNG'); return; }

  const filename = CONFIG.filenamePrefix + ts() + '.png';
  await saveOneToOPFS(blob, filename); // <<< guarda sin prompt

  savedSinceLastDraw = true;
  showToast('Guardado ✔ (interno)');
  clearCanvas();
}

// ===== Botones =====
btnGuardar.addEventListener('click', ()=>{
  exportPNG().catch(err => showToast(err.message || String(err)));
});
btnLimpiar.addEventListener('click', ()=>{
  clearCanvas();
  showToast('Pantalla limpia');
});
btnExportar?.addEventListener('click', ()=>{
  exportAllFromOPFS().catch(err => showToast(err.message || String(err)));
});

// ===== UI menor ===== /
function showToast(msg){
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.style.display='none', 2000);
}
(function(){
  const ua = navigator.userAgent;
  badge.textContent = (window.matchMedia('(display-mode: standalone)').matches ? 'PWA' :
                      ua.includes('Electron') ? 'Electron' : 'Navegador');
})();
