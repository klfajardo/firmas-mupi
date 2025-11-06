// app.js — Guarda en OPFS; si falla, descarga. Incluye exportar todo + backup ZIP (?backup)

const canvas      = document.getElementById('sigCanvas');
const bg          = document.getElementById('bg');
const btnGuardar  = document.getElementById('btnGuardar');
const btnLimpiar  = document.getElementById('btnLimpiar');
const centerCta   = document.getElementById('centerCta');
const toast       = document.getElementById('toast');
const badge       = document.getElementById('badge');
const btnExportar = document.getElementById('btnExportar');

const CONFIG = {
  strokeColor: '#000000',
  strokeWidth: 5,
  exportOnlySignature: true, // solo firma (sin fondo)
  filenamePrefix: 'firma_',
  autoClearSeconds: 15,
  exportWidth: 1080,
  exportHeight: 1920
};

let drawing = false;
let lastX = 0, lastY = 0;
let dirty = false;
let savedSinceLastDraw = false;
let autoClearTimer = null;

// ------------ Canvas ------------
function resizeCanvas(){
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const r = canvas.getBoundingClientRect();
  canvas.width  = Math.round(r.width  * dpr);
  canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,r.width,r.height);
  dirty = false;
  savedSinceLastDraw = false;
}
window.addEventListener('resize', resizeCanvas, {passive:true});
resizeCanvas();

function pos(e){
  const r = canvas.getBoundingClientRect();
  let x, y;
  if (e.touches && e.touches[0]) {
    x = e.touches[0].clientX;
    y = e.touches[0].clientY;
  } else if (e.changedTouches && e.changedTouches[0]) {
    x = e.changedTouches[0].clientX;
    y = e.changedTouches[0].clientY;
  } else {
    x = e.clientX;
    y = e.clientY;
  }
  return { x: x - r.left, y: y - r.top };
}

function startDraw(e){
  e.preventDefault();
  const p = pos(e);
  lastX = p.x;
  lastY = p.y;
  drawing = true;
  dirty = true;
  savedSinceLastDraw = false;
  if (centerCta) centerCta.classList.add('hidden');
  scheduleAutoClear();
}

function moveDraw(e){
  if (!drawing) return;
  e.preventDefault();
  const p = pos(e);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = CONFIG.strokeColor;
  ctx.lineWidth = CONFIG.strokeWidth;
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  lastX = p.x;
  lastY = p.y;
  scheduleAutoClear();
}

function endDraw(e){
  if (!drawing) return;
  e.preventDefault();
  drawing = false;
}

// Eventos de dibujo (pointer + mouse + touch)
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
  dirty = false;
  savedSinceLastDraw = false;
  if (centerCta) centerCta.classList.remove('hidden');
  cancelAutoClear();
}

function scheduleAutoClear(){
  cancelAutoClear();
  if (!CONFIG.autoClearSeconds) return;
  autoClearTimer = setTimeout(() => {
    if (dirty && !savedSinceLastDraw) {
      clearCanvas();
      showToast('Se limpió por inactividad');
    }
  }, CONFIG.autoClearSeconds * 1000);
}

function cancelAutoClear(){
  if (autoClearTimer) {
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
  }
}

function ts(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function canvasToPngBlobSafe(cnv){
  return new Promise((resolve) => {
    try {
      cnv.toBlob(blob => {
        if (blob) return resolve(blob);
        const url = cnv.toDataURL('image/png');
        const bin = atob(url.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], {type:'image/png'}));
      }, 'image/png');
    } catch {
      try {
        const url = cnv.toDataURL('image/png');
        const bin = atob(url.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], {type:'image/png'}));
      } catch {
        resolve(null);
      }
    }
  });
}

// -------- OPFS directo; si falla, descarga --------
async function saveToOPFS(blob, filename){
  const root = await navigator.storage.getDirectory();
  const dir  = await root.getDirectoryHandle('firmas', {create:true});
  const fh   = await dir.getFileHandle(filename, {create:true});
  const w    = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

async function downloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ---- Guardar UNA firma ----
async function exportPNG(){
  if (!dirty) {
    showToast('Primero firme con el dedo');
    return;
  }

  const out = document.createElement('canvas');
  out.width = CONFIG.exportWidth;
  out.height = CONFIG.exportHeight;
  const octx = out.getContext('2d');
  octx.clearRect(0,0,out.width,out.height);
  octx.drawImage(canvas, 0, 0, out.width, out.height);

  const blob = await canvasToPngBlobSafe(out);
  if (!blob) {
    showToast('No se pudo crear el PNG');
    return;
  }

  const filename = CONFIG.filenamePrefix + ts() + '.png';

  try {
    await saveToOPFS(blob, filename); // intenta guardar silencioso
    savedSinceLastDraw = true;
    showToast('Guardado');
    clearCanvas();
  } catch {
    await downloadBlob(blob, filename); // fallback
    savedSinceLastDraw = true;
    showToast('Descargado');
    clearCanvas();
  }
}

// ---- Exportar todo (descargas múltiples) ----
async function exportAllFromOPFS(){
  try {
    const root = await navigator.storage.getDirectory();
    const dir  = await root.getDirectoryHandle('firmas', {create:true});
    let count = 0;
    for await (const entry of dir.values()){
      if (entry.kind === 'file'){
        const file = await entry.getFile();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 400);
        count++;
      }
    }
    showToast(count ? `Exportando ${count}` : 'No hay archivos');
  } catch (e) {
    showToast('No se pudo exportar');
  }
}

// ---- Exportar todo como ZIP (workaround ?backup) ----
async function exportAllAsZipFromOPFS(){
  try {
    if (typeof JSZip === 'undefined') {
      showToast('ZIP no disponible');
      return;
    }

    const root = await navigator.storage.getDirectory();
    const dir  = await root.getDirectoryHandle('firmas', {create:true});

    const zip = new JSZip();
    let count = 0;

    for await (const entry of dir.values()){
      if (entry.kind === 'file'){
        const file = await entry.getFile();
        zip.file(file.name, file);
        count++;
      }
    }

    if (!count) {
      showToast('No hay firmas para exportar');
      return;
    }

    showToast('Generando ZIP...');
    const blob = await zip.generateAsync({type:'blob'});

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'firmas_backup.zip';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);

    showToast('ZIP descargado');
  } catch (e) {
    showToast('Error al generar el ZIP');
  }
}

// ---- Botones ----
btnGuardar.addEventListener('click', () => {
  exportPNG().catch(() => showToast('Error'));
});

btnLimpiar.addEventListener('click', () => {
  clearCanvas();
  showToast('Pantalla limpia');
});

btnExportar?.addEventListener('click', () => {
  exportAllFromOPFS().catch(() => showToast('Error exportando'));
});

// ---- Toast ----
function showToast(msg){
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.style.display = 'none';
  }, 2000);
}

// ---- Badge de versión ----
if (badge) {
  badge.textContent = (badge.textContent ? badge.textContent + ' | ' : '') + 'v-backup1';
}

// ---- Trigger automático: ?backup ----
(function(){
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('backup')) {
      // pequeño delay para asegurar que todo está listo
      setTimeout(() => {
        exportAllAsZipFromOPFS().catch(() => showToast('Error backup'));
      }, 800);
    }
  } catch (e) {
    // silencio
  }
})();
