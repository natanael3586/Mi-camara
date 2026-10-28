const $ = (id) => document.getElementById(id);
const video = $('preview'), status = $('status'), select = $('cameraSelect');
let stream = null, mode = 'photo', facing = 'environment', recorder = null, chunks = [], flashOn = false, recording = false;
const setStatus = (msg) => status.textContent = msg;
const supports = (track, key) => track?.getCapabilities?.()?.[key];
const activeTrack = () => stream?.getVideoTracks()[0];
const safeStop = () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
async function enumerate() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  const current = activeTrack()?.getSettings()?.deviceId;
  select.replaceChildren();
  cams.forEach((c, i) => { const opt = document.createElement('option'); opt.value = c.deviceId; opt.textContent = c.label || `Cámara ${i+1}`; select.append(opt); });
  if (current && cams.some(c => c.deviceId === current)) select.value = current;
  select.disabled = recording || cams.length < 2;
}
function updateFeatures() {
  const track = activeTrack(), caps = track?.getCapabilities?.() || {}, settings = track?.getSettings?.() || {};
  const zoom = $('zoom');
  if (caps.zoom && Number.isFinite(caps.zoom.min) && Number.isFinite(caps.zoom.max)) {
    zoom.min = caps.zoom.min; zoom.max = caps.zoom.max; zoom.step = caps.zoom.step || 0.1;
    zoom.value = settings.zoom ?? caps.zoom.min; zoom.disabled = false;
  } else { zoom.min = zoom.max = zoom.value = 1; zoom.disabled = true; }
  $('zoomValue').textContent = `${Number(zoom.value).toFixed(1)}×`;
  $('flashBtn').disabled = !caps.torch;
  $('flashBtn').textContent = '⚡ Flash'; flashOn = false;
  $('captureBtn').disabled = !stream;
  $('stopBtn').disabled = !recording;
  $('flipBtn').disabled = recording;
}
async function startCamera(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) { setStatus('Se requiere HTTPS o localhost y un navegador compatible.'); return; }
  if (recording) return;
  safeStop();
  const videoConstraints = deviceId ? {deviceId:{exact:deviceId}} : {facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}};
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:videoConstraints,audio:false});
    video.srcObject = stream; await video.play();
    $('empty').hidden = true; $('empty').style.display = 'none';
    await enumerate(); updateFeatures(); setStatus('Cámara lista');
  } catch (err) {
    updateFeatures();
    setStatus(err.name === 'NotAllowedError' ? 'Permiso denegado. Habilita la cámara en el navegador.' : `No se pudo abrir la cámara: ${err.message}`);
  }
}
$('startBtn').onclick = () => startCamera();
select.onchange = () => startCamera(select.value);
$('flipBtn').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };
$('zoom').oninput = async (e) => {
  const value = Number(e.target.value); $('zoomValue').textContent = `${value.toFixed(1)}×`;
  try { await activeTrack()?.applyConstraints({advanced:[{zoom:value}]}); } catch { setStatus('El zoom no está disponible para esta cámara.'); }
};
$('flashBtn').onclick = async () => {
  try { flashOn = !flashOn; await activeTrack().applyConstraints({advanced:[{torch:flashOn}]}); $('flashBtn').textContent = flashOn ? '⚡ Encendido' : '⚡ Flash'; }
  catch { flashOn = false; setStatus('Flash no disponible en este dispositivo.'); }
};
function setMode(next) {
  if (recording) return;
  mode = next; $('photoMode').classList.toggle('active',next==='photo'); $('videoMode').classList.toggle('active',next==='video');
  $('captureBtn').setAttribute('aria-label',next==='photo'?'Tomar fotografía':'Iniciar grabación');
}
$('photoMode').onclick = () => setMode('photo'); $('videoMode').onclick = () => setMode('video');
function offerDownload(blob, filename) {
  const link = $('downloadLink'), old = link.dataset.url;
  if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(blob); link.dataset.url = url; link.href = url; link.download = filename;
  link.textContent = `Descargar ${filename}`; link.hidden = false; link.click();
}
function takePhoto() {
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  if (!canvas.width || !canvas.height) return setStatus('Espera a que la cámara esté lista.');
  canvas.getContext('2d').drawImage(video,0,0);
  canvas.toBlob(blob => { if (blob) { offerDownload(blob,`foto-${Date.now()}.jpg`); setStatus('Fotografía capturada'); } },'image/jpeg',0.95);
}
async function beginRecording() {
  if (!window.MediaRecorder) return setStatus('Tu navegador no permite grabar video.');
  try {
    const mic = await navigator.mediaDevices.getUserMedia({audio:true});
    const combined = new MediaStream([...stream.getVideoTracks(),...mic.getAudioTracks()]);
    const mime = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(combined,mime?{mimeType:mime}:undefined); chunks=[];
    recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm', ext = type.includes('mp4')?'mp4':'webm';
      if(chunks.length) offerDownload(new Blob(chunks,{type}),`video-${Date.now()}.${ext}`);
      mic.getTracks().forEach(t=>t.stop()); recording=false; $('captureBtn').classList.remove('recording');
      $('stopBtn').disabled=true; $('flipBtn').disabled=false; enumerate(); setStatus('Video finalizado');
    };
    recorder.start(); recording=true; $('captureBtn').classList.add('recording'); $('stopBtn').disabled=false;
    $('flipBtn').disabled=true; select.disabled=true; setStatus('● Grabando video');
  } catch(err) { setStatus(`No se pudo grabar: ${err.message}`); }
}
function stopRecording(){ if(recorder?.state==='recording') recorder.stop(); }
$('captureBtn').onclick = () => { if (!stream) return; if(mode==='photo') takePhoto(); else if(recording) stopRecording(); else beginRecording(); };
$('stopBtn').onclick = stopRecording;
window.addEventListener('pagehide',safeStop);
if (!window.isSecureContext) setStatus('Abre la app con HTTPS o localhost para activar la cámara.');
