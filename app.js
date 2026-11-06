import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const $ = (id) => document.getElementById(id);
const video = $('preview'), status = $('status'), select = $('cameraSelect');
let stream = null, mode = 'photo', facing = 'environment', recorder = null, chunks = [], flashOn = false, recording = false;

// Variables para MediaPipe Object Detector
let objectDetector = null;
let animFrameId = null;

const setStatus = (msg) => status.textContent = msg;
const activeTrack = () => stream?.getVideoTracks()[0];
const safeStop = () => { 
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (stream) stream.getTracks().forEach(t => t.stop()); 
  stream = null; 
};

// 1. Inicializar el detector de objetos con mayor precisión (EfficientDet-Lite2)
async function initMediaPipe() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float32/1/efficientdet_lite2.tflite",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      scoreThreshold: 0.5 // Bajamos temporalmente al 50% para facilitar detecciones en el celular
    });
    setStatus('Modelo listo. Pulsa "Activar cámara".');
  } catch (err) {
    setStatus(`Error al cargar el modelo: ${err.message}`);
  }
}

const canvasElement = $('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

function processVideoFrame() {
  if (stream && video.readyState >= 2 && objectDetector) {
    if (canvasElement.width !== video.videoWidth || canvasElement.height !== video.videoHeight) {
      canvasElement.width = video.videoWidth;
      canvasElement.height = video.videoHeight;
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Ejecutar detección en tiempo real
    const results = objectDetector.detectForVideo(video, performance.now());

    if (results.detections && results.detections.length > 0) {
      let infoObjetos = [];

      for (const detection of results.detections) {
        const bbox = detection.boundingBox;
        const category = detection.categories[0];
        const name = category.categoryName;
        const probabilidad = Math.round(category.score * 100);
        
        const anchoPx = Math.round(bbox.width);
        const altoPx = Math.round(bbox.height);

        infoObjetos.push(`${name} (${probabilidad}% | ${anchoPx}x${altoPx}px)`);

        // 1. Dibujar la caja delimitadora (Bounding Box)
        canvasCtx.strokeStyle = '#00FF00';
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeRect(bbox.originX, bbox.originY, bbox.width, bbox.height);

        // 2. Dibujar puntos verdes con borde blanco en las 4 esquinas
        const esquinas = [
          { x: bbox.originX, y: bbox.originY },                              
          { x: bbox.originX + bbox.width, y: bbox.originY },                  
          { x: bbox.originX, y: bbox.originY + bbox.height },                 
          { x: bbox.originX + bbox.width, y: bbox.originY + bbox.height }     
        ];

        for (const punto of esquinas) {
          canvasCtx.beginPath();
          canvasCtx.arc(punto.x, punto.y, 6, 0, 2 * Math.PI);
          canvasCtx.fillStyle = '#00FF00';
          canvasCtx.fill();
          canvasCtx.lineWidth = 2;
          canvasCtx.strokeStyle = '#FFFFFF';
          canvasCtx.stroke();
        }

        // 3. Texto informativo grande y legible en pantalla
        canvasCtx.fillStyle = '#00FF00';
        canvasCtx.font = 'bold 22px Arial';
        const textY = bbox.originY > 25 ? bbox.originY - 8 : bbox.originY + 25;
        canvasCtx.fillText(`${name}: ${probabilidad}% [${anchoPx}x${altoPx}px]`, bbox.originX, textY);
      }

      setStatus(`Detectado: ${infoObjetos.join(', ')}`);
    } else {
      setStatus('Cámara lista | Buscando objetos, plantas o electrodomésticos...');
    }
  }
  animFrameId = requestAnimationFrame(processVideoFrame);
}

async function enumerate() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  const current = activeTrack()?.getSettings()?.deviceId;
  select.replaceChildren();
  cams.forEach((c, i) => { 
    const opt = document.createElement('option'); 
    opt.value = c.deviceId; 
    opt.textContent = c.label || `Cámara ${i+1}`; 
    select.append(opt); 
  });
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
  if (!navigator.mediaDevices?.getUserMedia) { 
    setStatus('Se requiere HTTPS o localhost y un navegador compatible.'); 
    return; 
  }
  if (recording) return;
  safeStop();
  const videoConstraints = deviceId ? {deviceId:{exact:deviceId}} : {facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}};
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:videoConstraints,audio:false});
    video.srcObject = stream; 
    await video.play();
    const emptyEl = $('empty');
    if (emptyEl) { emptyEl.hidden = true; emptyEl.style.display = 'none'; }
    await enumerate(); 
    updateFeatures(); 
    setStatus('Cámara lista');
    processVideoFrame();
  } catch (err) {
    updateFeatures();
    setStatus(err.name === 'NotAllowedError' ? 'Permiso denegado. Habilita la cámara en el navegador.' : `No se pudo abrir la cámara: ${err.message}`);
  }
}

// Enlaces de eventos seguros para los botones
const startBtnEl = $('startBtn');
if (startBtnEl) {
  startBtnEl.onclick = () => startCamera();
}

if (select) {
  select.onchange = () => startCamera(select.value);
}

const flipBtnEl = $('flipBtn');
if (flipBtnEl) {
  flipBtnEl.onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };
}

const zoomEl = $('zoom');
if (zoomEl) {
  zoomEl.oninput = async (e) => {
    const value = Number(e.target.value); 
    $('zoomValue').textContent = `${value.toFixed(1)}×`;
    try { await activeTrack()?.applyConstraints({advanced:[{zoom:value}]}); } catch { setStatus('El zoom no está disponible para esta cámara.'); }
  };
}

const flashBtnEl = $('flashBtn');
if (flashBtnEl) {
  flashBtnEl.onclick = async () => {
    try { 
      flashOn = !flashOn; 
      await activeTrack().applyConstraints({advanced:[{torch:flashOn}]}); 
      flashBtnEl.textContent = flashOn ? '⚡ Encendido' : '⚡ Flash'; 
    }
    catch { 
      flashOn = false; 
      setStatus('Flash no disponible en este dispositivo.'); 
    }
  };
}

function setMode(next) {
  if (recording) return;
  mode = next; 
  $('photoMode')?.classList.toggle('active', next==='photo'); 
  $('videoMode')?.classList.toggle('active', next==='video');
  $('captureBtn')?.setAttribute('aria-label', next==='photo'?'Tomar fotografía':'Iniciar grabación');
}

$('photoMode')?.addEventListener('click', () => setMode('photo'));
$('videoMode')?.addEventListener('click', () => setMode('video'));

function offerDownload(blob, filename) {
  const link = $('downloadLink'), old = link?.dataset?.url;
  if (old) URL.revokeObjectURL(old);
  if (!link) return;
  const url = URL.createObjectURL(blob); 
  link.dataset.url = url; 
  link.href = url; 
  link.download = filename;
  link.textContent = `Descargar ${filename}`; 
  link.hidden = false; 
  link.click();
}

function takePhoto() {
  const canvas = document.createElement('canvas'); 
  canvas.width = video.videoWidth; 
  canvas.height = video.videoHeight;
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
      mic.getTracks().forEach(t=>t.stop()); recording=false; $('captureBtn')?.classList.remove('recording');
      const stopBtn = $('stopBtn'); if (stopBtn) stopBtn.disabled=true; 
      const flipBtn = $('flipBtn'); if (flipBtn) flipBtn.disabled=false; 
      enumerate(); setStatus('Video finalizado');
    };
    recorder.start(); recording=true; $('captureBtn')?.classList.add('recording'); 
    const stopBtn = $('stopBtn'); if (stopBtn) stopBtn.disabled=false;
    const flipBtn = $('flipBtn'); if (flipBtn) flipBtn.disabled=true; 
    if (select) select.disabled=true; 
    setStatus('● Grabando video');
  } catch(err) { setStatus(`No se pudo grabar: ${err.message}`); }
}

function stopRecording(){ if(recorder?.state==='recording') recorder.stop(); }

const captureBtnEl = $('captureBtn');
if (captureBtnEl) {
  captureBtnEl.onclick = () => { if (!stream) return; if(mode==='photo') takePhoto(); else if(recording) stopRecording(); else beginRecording(); };
}

const stopBtnEl = $('stopBtn');
if (stopBtnEl) {
  stopBtnEl.onclick = stopRecording;
}

window.addEventListener('pagehide', safeStop);
if (!window.isSecureContext) setStatus('Abre la app con HTTPS o localhost para activar la cámara.');

initMediaPipe();
