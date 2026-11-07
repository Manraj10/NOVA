import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs';
import { voice } from './voice.js';
import { render, anchorOf } from './draw.js';
import { makeSim } from './sim.js';
import { makeDrift } from './drift.js';
import { makeEars, MIC } from './ears.js';

const $ = id => document.getElementById(id);
const app = $('app'), video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const wait = ms => new Promise(r => setTimeout(r, ms));
// Phone haptics. Browsers refuse vibration until the person has tapped the page once.
const buzz = p => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(p); };

// Everything Nib says, per language. Field instructions come from the form reader in the chosen language.
const T = {
  en: {
    hold: 'Hold the form still. Reading it now.',
    count: (title, n) => `${title}. I found ${n} ${n === 1 ? 'place' : 'places'} to fill.`,
    first: l => `First: ${l}. Lay your free hand flat on the page, then point with one finger.`,
    none: "I can't find any blanks. Slide the whole form under the camera, then tap to try again.",
    next: 'Next:',
    stop: 'Stop.',
    coach: 'Write just to the right of your finger. Say done, or tap, when you finish.',
    coachTap: 'Write just to the right of your finger. Tap the screen when you finish.',
    ruler: 'Tip: slide a ruler or a card up until its edge touches your fingertip, and write along the edge. I will also tell you if your writing drifts.',
    lineEnd: 'End of the line.',
    lift: 'Lift your hand so I can read it.',
    wrote: t => `You wrote ${t}.`,
    blank: 'That spot still looks empty.',
    all: n => `All done. ${n} ${n === 1 ? 'field' : 'fields'} filled.`,
    handIn: 'You can hand the form in.',
    skipped: l => `You skipped ${l}.`,
    review: l => `I couldn't read ${l} clearly. Ask me to go back to it if you want to redo it.`,
    unsure: "I'll flag that one so you can check it at the end.",
    noHand: "I can't see your hand. Lay your whole hand flat on the page, then point.",
    noCamera: 'Nib needs the camera to see the form. Allow camera access for this page, then reload.',
    askHint: 'Hold the screen to ask me anything.',
    listening: 'Listening…',
    heardNothing: "I didn't catch that. Hold and ask again.",
    noMic: 'Voice questions need Chrome, with the microphone allowed.',
    noEars: "I can't use the microphone, so saying Nib won't work. Hold the screen to ask me instead.",
    left: n => `${n} ${n === 1 ? 'place' : 'places'} left.`,
    here: l => `You're on ${l}.`,
    firstOne: 'This is the first one.',
    offline: 'I can answer that once a model key is added.',
    nothingToFill: title => `${title && !/^(none|null|untitled|unknown)\.?$/i.test(title) ? `${title}. ` : ''}There's nothing to fill in here. Ask me where anything is, or ask me to read it.`,
    takeYou: "I'll take you there.",
    notClear: "I can't see that line clearly. Lift both hands off the page, then tap to read it again.",
    noLock: "I can't lock onto this page, so keep it still while we fill it in.",
    lost: "I lost where that one is after the page moved. Say read again to find it.",
    moved: "The page moved. Hold still, I'm reading it again.",
    penOff: 'Move your pen hand off the page for a moment.',
    holdStill: 'Hold the page still a second.',
    startTab: 'Tap anywhere to start',
    startClick: 'Click anywhere to start',
    noServer: "I can't reach the server. Check the Wi-Fi, then tap to try again.",
    firstShort: l => `First: ${l}.`,
    cancelled: 'Okay, stopped looking.',
    notFound: "I couldn't get you there. Let's carry on.",
    noKey: "Form reading isn't set up on this computer yet.",
    slow: 'That took too long. Hold still and try again.',
    busy: 'The reader is busy. Wait a few seconds, then try again.',
    noCredit: "The reader's key is out of credit.",
    readFail: "I couldn't read that. Hold still and try again.",
    confirm: 'Tap to keep it, or say redo.',
    redo: 'Okay. Write it again, then tap.',
    notChecked: "I couldn't check the whole page, so have someone look it over before you hand it in.",
    reopened: l => `${l} still looks empty to me. Let's go back to it.`,
    checkin: 'Before we start: rest one finger of your free hand on the page, and keep the pen away for a moment.',
    gotIt: 'Got it. I can see your finger.',
    oneHand: 'Just one hand for now.',
    stillReading: 'Still reading. Long forms take a moment.',
    almost: 'Almost there. Keep the page still.',
    checking: 'Checking the whole page.',
    missed: (n, l) => (n === 1 ? `One more place: ${l}.` : `${n} more places. First: ${l}.`),
  },
  es: {
    hold: 'Mantén el formulario quieto. Lo estoy leyendo.',
    count: (title, n) => `${title}. Encontré ${n} ${n === 1 ? 'espacio' : 'espacios'} por llenar.`,
    first: l => `Primero: ${l}. Pon la mano libre plana sobre la hoja y luego señala con un dedo.`,
    none: 'No encuentro espacios en blanco. Pon todo el formulario bajo la cámara y toca para intentar de nuevo.',
    next: 'Siguiente:',
    stop: 'Alto.',
    coach: 'Escribe justo a la derecha de tu dedo. Di listo, o toca, cuando termines.',
    coachTap: 'Escribe justo a la derecha de tu dedo. Toca la pantalla cuando termines.',
    ruler: 'Consejo: sube una regla o una tarjeta hasta que su borde toque la punta de tu dedo, y escribe sobre el borde. También te aviso si tu escritura se desvía.',
    lineEnd: 'Fin de la línea.',
    lift: 'Levanta la mano para que pueda leerlo.',
    wrote: t => `Escribiste ${t}.`,
    blank: 'Ese espacio todavía parece vacío.',
    all: n => `Listo. ${n} ${n === 1 ? 'campo lleno' : 'campos llenos'}.`,
    handIn: 'Ya puedes entregar el formulario.',
    skipped: l => `Saltaste ${l}.`,
    review: l => `No pude leer bien ${l}. Pídeme volver a ese campo si quieres rehacerlo.`,
    unsure: 'Lo marco para que lo revises al final.',
    noHand: 'No veo tu mano. Pon toda la mano plana sobre la hoja y luego señala.',
    noCamera: 'Nib necesita la cámara para ver el formulario. Permite el acceso a la cámara y recarga la página.',
    askHint: 'Mantén presionada la pantalla para preguntarme lo que sea.',
    listening: 'Escuchando…',
    heardNothing: 'No te entendí. Mantén presionado y pregunta otra vez.',
    noMic: 'Las preguntas por voz necesitan Chrome con el micrófono permitido.',
    noEars: 'No puedo usar el micrófono, así que decir Nib no funcionará. Mantén presionada la pantalla para preguntarme.',
    left: n => `Faltan ${n}.`,
    here: l => `Estás en ${l}.`,
    firstOne: 'Este es el primero.',
    offline: 'Puedo responder eso cuando se agregue una clave del modelo.',
    nothingToFill: title => `${title}. Aquí no hay nada que llenar. Pregúntame dónde está cualquier cosa, o pídeme que lo lea.`,
    takeYou: 'Te llevo ahí.',
    notClear: 'No veo bien esa línea. Levanta las dos manos de la hoja y toca para leerla otra vez.',
    noLock: 'No puedo fijar esta hoja, así que no la muevas mientras la llenamos.',
    lost: 'Perdí dónde está ese campo después de que se movió la hoja. Di leer otra vez para encontrarlo.',
    moved: 'La hoja se movió. No la muevas, la leo otra vez.',
    penOff: 'Aparta un momento de la hoja la mano del bolígrafo.',
    holdStill: 'Mantén la hoja quieta un segundo.',
    startTab: 'Toca para empezar',
    startClick: 'Haz clic para empezar',
    noServer: 'No puedo conectar con el servidor. Revisa el wifi y toca para reintentar.',
    firstShort: l => `Primero: ${l}.`,
    cancelled: 'Bien, dejo de buscar.',
    notFound: 'No pude llevarte ahí. Sigamos.',
    noKey: 'La lectura de formularios aún no está configurada en esta computadora.',
    slow: 'Tardó demasiado. Mantén la hoja quieta e inténtalo de nuevo.',
    busy: 'El lector está ocupado. Espera unos segundos y vuelve a intentarlo.',
    noCredit: 'La clave del lector se quedó sin crédito.',
    readFail: 'No pude leerlo. Mantén la hoja quieta e inténtalo de nuevo.',
    confirm: 'Toca para conservarlo, o di rehacer.',
    redo: 'Bien. Escríbelo otra vez y toca.',
    notChecked: 'No pude revisar toda la hoja; pide a alguien que la revise antes de entregarla.',
    reopened: l => `${l} todavía parece vacío. Volvamos ahí.`,
    checkin: 'Antes de empezar: apoya un dedo de la mano libre en la hoja y aleja el bolígrafo un momento.',
    gotIt: 'Listo. Veo tu dedo.',
    oneHand: 'Por ahora, solo una mano.',
    stillReading: 'Sigo leyendo. Los formularios largos toman un momento.',
    almost: 'Ya casi. Mantén la hoja quieta.',
    checking: 'Reviso toda la hoja.',
    missed: (n, l) => (n === 1 ? `Falta un lugar: ${l}.` : `Faltan ${n} lugares. Primero: ${l}.`),
  },
  hi: {
    hold: 'फ़ॉर्म को स्थिर रखिए। मैं इसे पढ़ रहा हूँ।',
    count: (title, n) => `${title}। भरने के लिए ${n} जगहें मिलीं।`,
    first: l => `पहले: ${l}। खाली हाथ को पन्ने पर सपाट रखिए, फिर एक उंगली से इशारा कीजिए।`,
    none: 'मुझे कोई खाली जगह नहीं दिखी। पूरा फ़ॉर्म कैमरे के नीचे रखिए और फिर टैप कीजिए।',
    next: 'अगला:',
    stop: 'रुकिए।',
    coach: 'अपनी उंगली के ठीक दाईं ओर लिखिए। पूरा होने पर हो गया बोलिए या टैप कीजिए।',
    coachTap: 'अपनी उंगली के ठीक दाईं ओर लिखिए। पूरा होने पर स्क्रीन पर टैप कीजिए।',
    ruler: 'सुझाव: एक रूलर या कार्ड को ऊपर सरकाइए जब तक उसका किनारा आपकी उंगली की नोक को न छू ले, और उसी किनारे के साथ लिखिए। लिखावट भटकेगी तो मैं बता दूँगा।',
    lineEnd: 'लाइन खत्म।',
    lift: 'हाथ हटाइए ताकि मैं पढ़ सकूँ।',
    wrote: t => `आपने लिखा: ${t}।`,
    blank: 'वह जगह अभी भी खाली लगती है।',
    all: n => `हो गया। ${n} जगहें भरी गईं।`,
    handIn: 'अब आप फ़ॉर्म जमा कर सकते हैं।',
    skipped: l => `आपने ${l} छोड़ दिया।`,
    review: l => `मैं ${l} ठीक से नहीं पढ़ पाया। दोबारा भरना हो तो मुझसे उस पर वापस जाने को कहिए।`,
    unsure: 'मैं इसे निशान लगा देता हूँ, ताकि आप आख़िर में जाँच सकें।',
    noHand: 'मुझे आपका हाथ नहीं दिख रहा। पूरा हाथ पन्ने पर सपाट रखिए, फिर इशारा कीजिए।',
    noCamera: 'फ़ॉर्म देखने के लिए Nib को कैमरा चाहिए। कैमरे की अनुमति दीजिए और पेज फिर से खोलिए।',
    askHint: 'कुछ भी पूछने के लिए स्क्रीन दबाकर रखिए।',
    listening: 'सुन रहा हूँ…',
    heardNothing: 'मैं समझ नहीं पाया। दबाकर रखिए और फिर पूछिए।',
    noMic: 'आवाज़ से सवाल के लिए Chrome और माइक्रोफ़ोन की अनुमति चाहिए।',
    noEars: 'मैं माइक्रोफ़ोन इस्तेमाल नहीं कर पा रहा, इसलिए निब बोलना काम नहीं करेगा। पूछने के लिए स्क्रीन दबाकर रखिए।',
    left: n => `${n} बाकी हैं।`,
    here: l => `आप ${l} पर हैं।`,
    firstOne: 'यह पहला है।',
    offline: 'मॉडल की कुंजी जुड़ने पर मैं इसका जवाब दे पाऊँगा।',
    nothingToFill: title => `${title}। यहाँ भरने के लिए कुछ नहीं है। मुझसे पूछिए कि कुछ भी कहाँ है, या पढ़ने को कहिए।`,
    takeYou: 'मैं आपको वहाँ ले चलता हूँ।',
    notClear: 'वह लाइन साफ़ नहीं दिख रही। दोनों हाथ पन्ने से हटाइए, फिर दोबारा पढ़ने के लिए टैप कीजिए।',
    noLock: 'मैं इस पन्ने को पकड़ नहीं पा रहा, इसलिए भरते समय इसे स्थिर रखिए।',
    lost: 'पन्ना हिलने के बाद मुझे वह जगह नहीं मिल रही। उसे ढूँढने के लिए फिर से पढ़ो बोलिए।',
    moved: 'पन्ना हिल गया। स्थिर रखिए, मैं फिर से पढ़ता हूँ।',
    penOff: 'पेन वाला हाथ एक पल के लिए पन्ने से हटाइए।',
    holdStill: 'एक पल पन्ना स्थिर रखिए।',
    startTab: 'शुरू करने के लिए छुएँ',
    startClick: 'शुरू करने के लिए क्लिक करें',
    noServer: 'सर्वर तक नहीं पहुँच पा रहा। वाई-फ़ाई देखिए, फिर दोबारा टैप कीजिए।',
    firstShort: l => `पहले: ${l}।`,
    cancelled: 'ठीक है, ढूँढना बंद किया।',
    notFound: 'मैं आपको वहाँ नहीं ले जा पाया। आगे चलते हैं।',
    noKey: 'इस कंप्यूटर पर फ़ॉर्म पढ़ना अभी सेट नहीं है।',
    slow: 'बहुत देर लगी। स्थिर रखिए और फिर से कोशिश कीजिए।',
    busy: 'पढ़ने वाला व्यस्त है। कुछ सेकंड रुकिए, फिर कोशिश कीजिए।',
    noCredit: 'पढ़ने वाले की कुंजी का क्रेडिट खत्म हो गया है।',
    readFail: 'मैं वह पढ़ नहीं पाया। स्थिर रखिए और फिर से कोशिश कीजिए।',
    confirm: 'रखने के लिए टैप कीजिए, या दोबारा लिखो बोलिए।',
    redo: 'ठीक है। फिर से लिखिए, फिर टैप कीजिए।',
    notChecked: 'मैं पूरा पन्ना जाँच नहीं पाया, जमा करने से पहले किसी से दिखवा लीजिए।',
    reopened: l => `${l} अभी भी खाली लगता है। वहीं वापस चलते हैं।`,
    checkin: 'शुरू करने से पहले: खाली हाथ की एक उंगली पन्ने पर रखिए, और पेन थोड़ी देर दूर रखिए।',
    gotIt: 'ठीक है। मुझे आपकी उंगली दिख रही है।',
    oneHand: 'अभी सिर्फ़ एक हाथ।',
    stillReading: 'अभी पढ़ रहा हूँ। लंबे फ़ॉर्म में थोड़ा समय लगता है।',
    almost: 'बस थोड़ा और। पन्ना स्थिर रखिए।',
    checking: 'मैं पूरा पन्ना जाँच रहा हूँ।',
    missed: (n, l) => (n === 1 ? `एक जगह और: ${l}।` : `${n} जगहें और। पहले: ${l}।`),
  },
  zh: {
    hold: '请把表格放稳，我正在读。',
    count: (title, n) => `${title}。我找到 ${n} 处要填写。`,
    first: l => `第一处：${l}。把空着的那只手平放在纸上，然后用一根手指指着。`,
    none: '我没找到空白处。请把整张表放到摄像头下，然后点一下重试。',
    next: '下一处：',
    stop: '停。',
    coach: '在手指右边写。写完说好了，或者点一下。',
    coachTap: '在手指右边写。写完点一下屏幕。',
    ruler: '小提示：把尺子或卡片往上推，直到边缘碰到指尖，然后沿着边缘写。字写歪了我也会提醒你。',
    lineEnd: '这一行到头了。',
    lift: '请把手移开，让我看一下。',
    wrote: t => `你写的是：${t}。`,
    blank: '这里看起来还是空的。',
    all: n => `全部完成，填了 ${n} 处。`,
    handIn: '可以交表了。',
    skipped: l => `你跳过了：${l}。`,
    review: l => `${l} 我没看清。想重写的话，让我回到那一处。`,
    unsure: '我先标记一下，最后提醒你检查。',
    noHand: '我看不到你的手。请把整只手平放在纸上，然后用手指指着。',
    noCamera: 'Nib 需要摄像头才能看到表格。请允许使用摄像头，然后刷新页面。',
    askHint: '按住屏幕就可以问我任何问题。',
    listening: '正在听…',
    heardNothing: '我没听清。按住屏幕再问一次。',
    noMic: '语音提问需要 Chrome，并允许使用麦克风。',
    noEars: '我用不了麦克风，所以说“Nib”不管用。请按住屏幕来问我。',
    left: n => `还剩 ${n} 处。`,
    here: l => `你现在在：${l}。`,
    firstOne: '这是第一处。',
    offline: '加上模型密钥后我就能回答这个问题。',
    nothingToFill: title => `${title}。这里没有要填的地方。可以问我任何东西在哪里，或者让我读给你听。`,
    takeYou: '我带你过去。',
    notClear: '我看不清那一行。请把两只手都从纸上拿开，然后点一下再读一遍。',
    noLock: '我没法固定这张纸，填写时请别移动它。',
    lost: '纸移动后我找不到那一处了。说“再读一遍”来重新找。',
    moved: '纸动了。请别动，我再读一遍。',
    penOff: '请先把拿笔的手从纸上移开一下。',
    holdStill: '请让纸保持不动一下。',
    startTab: '点击任意处开始',
    startClick: '点击任意处开始',
    noServer: '连不上服务器。请检查无线网络，然后点一下重试。',
    firstShort: l => `第一处：${l}。`,
    cancelled: '好，不找了。',
    notFound: '我没能带你过去，我们继续吧。',
    noKey: '这台电脑还没有设置读表功能。',
    slow: '时间太长了。请保持不动，再试一次。',
    busy: '读取服务正忙，请等几秒再试。',
    noCredit: '读取服务的额度用完了。',
    readFail: '我没能读出来。请保持不动，再试一次。',
    confirm: '点一下保留，或者说“重写”。',
    redo: '好的，再写一遍，然后点一下。',
    notChecked: '我没能检查整页，交表前请找人看一下。',
    reopened: l => `${l} 看起来还是空的，我们回去看看。`,
    checkin: '开始之前：用空着的手把一根手指放在纸上，先把笔拿开一下。',
    gotIt: '好了，我看到你的手指了。',
    oneHand: '现在只用一只手。',
    stillReading: '还在读。长表格需要一点时间。',
    almost: '快好了。请保持纸张不动。',
    checking: '我检查一下整页。',
    missed: (n, l) => (n === 1 ? `还有一处：${l}。` : `还有 ${n} 处。先填：${l}。`),
  },
};

const ACTION = { confirm: 'Keep it', checkin: 'Skip', start: 'Start', reading: 'Reading…', reveal: 'Reading…', idle: 'Read the page', guide: 'Repeat', find: 'Repeat', write: 'Done writing', check: 'Reading…', done: 'New page' };
const CUE = { up: '↑', down: '↓', left: '←', right: '→' };
const KIND = { text: 'Write', date: 'Date', number: 'Number', checkbox: 'Check', signature: 'Sign', button: 'Tap' };

const S = {
  sim: new URLSearchParams(location.search).has('sim') ? makeSim() : null,
  lang: T[store.get('nib.lang')] ? store.get('nib.lang') : 'en',
  mode: 'start',
  fields: [], i: 0, title: '',
  tip: null, tipSeen: 0, trail: [], handPts: [], pointer: null,
  onTarget: false, arrivedSince: 0, prox: 1,
  lastCue: 0, lastBeep: 0, lastNoHand: 0, cue: '', pulses: [],
  sweepAt: 0, burstAt: 0, revealStart: 0, flag: null, hole: null, fit: null,
  startedAt: 0, finishedAt: 0, elapsed: '', epoch: 0,
  lastSay: '', words: [], wordAt: 0, wordK: -1, boundary: false,
};
const t = () => T[S.lang];
const drift = makeDrift(); // Codex's page-movement guard

// ---------- voice and word-by-word captions ----------
voice.init();
voice.lang = S.lang;
voice.onCaption = (text, cue) => { if (!cue) showCaption(text); };
voice.onWord = i => {
  S.boundary = performance.now();
  S.wordK = -1;
  S.words.forEach((w, j) => { if (Number(w.dataset.at) <= i) S.wordK = j; });
  S.wordAt = S.boundary;
  S.shownK = S.wordK;
  S.words.forEach((w, j) => { w.classList.toggle('said', j <= S.wordK); w.classList.toggle('now', j === S.wordK); });
  follow(S.wordK);
};
voice.onEnd = () => { for (const w of S.words) { w.classList.add('said'); w.classList.remove('now'); } S.words = []; };
function follow(k) {
  const p = $('captionText'), w = S.words[k];
  if (w && p.scrollHeight > p.clientHeight) p.scrollTop = Math.max(0, w.offsetTop - p.clientHeight / 3);
}
// Every spoken line is also an event, so a test robot (bot.js) can "hear" Nib the way a blind user would.
const say = (text, opts) => {
  if (!opts?.cue) S.lastSay = text;
  dispatchEvent(new CustomEvent('nib:say', { detail: { text, cue: !!opts?.cue } }));
  return voice.say(text, opts);
};

function showCaption(text) {
  const p = $('captionText');
  p.replaceChildren();
  p.scrollTop = 0;
  let at = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part) {
      if (/^\s+$/.test(part)) p.append(part);
      else {
        const s = document.createElement('span');
        s.textContent = part;
        s.dataset.at = at;
        p.append(s);
      }
    }
    at += part.length;
  }
  S.words = [...p.querySelectorAll('span')];
  S.wordAt = performance.now();
  S.wordK = -1;
  S.shownK = -2;
  S.boundary = 0;
}

// Word events drive the highlight. If they stop coming (some voices never send them),
// keep lighting words at a speaking pace from the last one heard.
function tickWords(now) {
  if (!S.words.length || (S.boundary && now - S.boundary < 700)) return;
  const k = Math.max(S.wordK, Math.floor((now - S.wordAt) / 290) + (S.boundary ? S.wordK : 0));
  if (k === S.shownK) return;
  S.shownK = k;
  S.words.forEach((w, j) => { w.classList.toggle('said', j <= k); w.classList.toggle('now', j === k); });
  follow(k);
}

// ---------- hand tracking ----------
let hands = null, lastVideoTime = -1;
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

async function loadHands() {
  status('Loading hand tracking…');
  try {
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = delegate => HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2,
      // A hand seen from above, back up, scores lower than a palm, so detect a bit more readily.
      minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.35 });
    hands = await make('GPU').catch(() => make('CPU'));
    status('Ready. Hand tracking is on.');
  } catch {
    status('Hand tracking could not load. Check the internet connection, then reload.');
  }
}

function trackHands(now) {
  if (S.sim || !hands || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const r = hands.detectForVideo(video, now);
  S.handPts = r.landmarks || [];
  S.handLabels = (r.handedness || r.handednesses || []).map(h => h?.[0]?.categoryName || '');
  S.trackN = (S.trackN || 0) + 1;
  if (!S.handPts.length) {
    // A fresh empty tracking result invalidates the old fingertip immediately, even if
    // it was seen less than 150 ms ago. Returning with its dwell could falsely arrive.
    S.pointerIdx = -1;
    S.tip = null;
    S.tipSeen = 0;
    S.arrivedSince = 0;
    S.onTarget = false;
    return;
  }
  S.handAt = now;
  S.pointerIdx = pickPointer(now);
  if (S.pointerIdx < 0) { S.tipSeen = 0; S.arrivedSince = 0; S.onTarget = false; return; }
  const tip = S.handPts[S.pointerIdx][8];
  setTip(tip.x, tip.y, now);
}

// One hand points (resting on the page), the other holds the pen. Never follow the pen hand:
// learn the pointing hand from the first hand that shows up alone and isn't gripping a pen, then
// prefer that hand, avoid pen grips, and stay with the hand already being followed.
const pinching = h => Math.hypot(h[4].x - h[8].x, h[4].y - h[8].y) < 0.45 * Math.hypot(h[0].x - h[9].x, h[0].y - h[9].y);
function pickPointer(now) {
  const H = S.handPts, L = S.handLabels;
  if (H.length === 1) {
    // The pointing hand left and only the pen hand is in view: follow nothing rather than the pen.
    if (S.pointerLabel && S.pointerLabel !== 'any' && L[0] && L[0] !== S.pointerLabel && pinching(H[0])) return -1;
    return 0;
  }
  const fresh = S.tip && now - S.tipSeen < 600;
  // Staying with the followed hand only breaks near-ties (jitter), so one wrong frame can't stick.
  const score = (h, i) => (S.pointerLabel && L[i] === S.pointerLabel ? 1 : 0) - (pinching(h) ? 2 : 0)
    + (fresh && dist(h[8], S.tip) < 0.06 ? 1 : 0);
  let best = 0;
  H.forEach((h, i) => { if (score(h, i) > score(H[best], best)) best = i; });
  return best;
}

// One Euro filter (Casiez et al. 2012) for the camera fingertip: heavy smoothing when the finger rests
// (no jitter at the target), light smoothing when it moves (no lag). The practice mouse needs none.
const EURO = { minCutoff: 1, beta: 7, dCutoff: 1 }; // beta tuned for frame-fraction units
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
function setTip(x, y, now) {
  const e = S.euro;
  if (S.sim || !S.tip || !e || now - S.tipSeen > 300) S.euro = { x, y, dx: 0, dy: 0, t: now };
  else {
    const dt = Math.max(0.005, (now - e.t) / 1000), ad = alpha(EURO.dCutoff, dt);
    e.dx += ad * ((x - e.x) / dt - e.dx);
    e.dy += ad * ((y - e.y) / dt - e.dy);
    const a = alpha(EURO.minCutoff + EURO.beta * Math.hypot(e.dx, e.dy), dt);
    e.x += a * (x - e.x);
    e.y += a * (y - e.y);
    e.t = now;
  }
  S.tip = { x: S.euro.x, y: S.euro.y };
  S.tipSeen = now;
  S.trail.push({ ...S.tip });
  if (S.trail.length > 16) S.trail.shift();
}

const aspect = () => { const s = source(); return s.w / s.h || 4 / 3; };
const dist = (p, q) => Math.hypot((p.x - q.x) * aspect(), p.y - q.y);

// ---------- frame source: camera or practice form ----------
function source() {
  if (S.sim) return { img: S.sim.canvas, w: S.sim.canvas.width, h: S.sim.canvas.height };
  return { img: video, w: video.videoWidth, h: video.videoHeight };
}

// Phones get the full 4:3 sensor (16:9 crops it, and a narrower view cuts the hand off), zoomed out
// to the widest lens where Safari allows it. The mic comes in the same capture as the camera: on
// iPhone a second, separate capture can silence the first.
const PHONE = matchMedia('(pointer: coarse)').matches;
async function startCamera(isCurrent = () => true, onCleanup = () => {}) {
  const id = $('camera').value;
  const tall = PHONE && innerHeight > innerWidth;
  const size = !PHONE ? { width: { ideal: 1920 }, height: { ideal: 1080 } }
    : tall ? { width: { ideal: 1440 }, height: { ideal: 1920 }, aspectRatio: { ideal: 3 / 4 } } : { width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 } };
  const video_ = id ? { deviceId: { exact: id }, ...size } : { facingMode: { ideal: 'environment' }, ...size };
  let stream, mic, picture, released = false;
  const release = () => {
    if (!stream || released) return;
    released = true;
    stream.getTracks().forEach(track => track.stop());
    if (S.mic === mic) S.mic = null;
    if (video.srcObject === picture) video.srcObject = null;
  };
  const check = () => { if (!isCurrent()) throw Object.assign(new Error('Camera startup was cancelled.'), { name: 'AbortError' }); };
  onCleanup(release);
  try {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: MIC }); }
    catch (e) {
      check();
      if (e?.name === 'NotFoundError' || e?.name === 'NotAllowedError') stream = await navigator.mediaDevices.getUserMedia({ video: video_ });
      else throw e;
    }
    check();
    mic = stream.getAudioTracks().length ? new MediaStream(stream.getAudioTracks()) : null;
    picture = new MediaStream(stream.getVideoTracks());
    S.mic = mic; video.srcObject = picture;
    const track = stream.getVideoTracks()[0];
    try {
      const zoom = track.getCapabilities?.().zoom;
      if (zoom && zoom.min < (track.getSettings().zoom ?? 1)) await track.applyConstraints({ advanced: [{ zoom: zoom.min }] });
    } catch { /* no zoom control on this browser */ }
    check();
    await video.play(); check();
    await listCameras(); check();
  } catch (e) { release(); throw e; }
}

async function listCameras() {
  const sel = $('camera');
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const keep = sel.value;
    sel.replaceChildren(new Option('Default camera', ''), ...cams.map((c, k) => new Option(c.label || `Camera ${k + 1}`, c.deviceId)));
    sel.value = keep;
    sel.closest('.cam').hidden = cams.filter(c => c.label).length < 2;
  } catch { /* no camera list on this browser */ }
}

// region is in frame fractions; crops get upscaled so small handwriting stays readable
function snapshot(region, keep) {
  const { img, w, h } = source();
  const r = region || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const x0 = Math.max(0, r.x0) * w, y0 = Math.max(0, r.y0) * h;
  const sw = (Math.min(1, r.x1) * w) - x0, sh = (Math.min(1, r.y1) * h) - y0;
  const scale = region ? Math.min(2, 1200 / sw) : Math.min(1, 1600 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext('2d').drawImage(img, x0, y0, sw, sh, 0, 0, c.width, c.height);
  if (keep) Object.assign(keep, { canvas: c, w, h }); // the exact frame, kept by the caller that sent it
  return c.toDataURL('image/jpeg', 0.85);
}

async function api(path, payload) {
  const t0 = performance.now();
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout?.(60000) });
  const j = await r.json().catch(() => ({}));
  S.lastApi = { job: path.replace('/api/', ''), secs: (performance.now() - t0) / 1000 };
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status}).`);
  return j;
}

// ---------- the flow ----------
// iPhone and iPad (coaching text and camera-permission help differ there).
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Hands are on the paper, not the screen, so keep it from sleeping (a locked phone stops the camera).
let wake = null;
async function stayAwake() {
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* not supported or not allowed: fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || S.mode === 'start') return;
  if (wake?.released !== false) stayAwake();
  voice.ctx?.resume?.();
  if (S.sim) return;
  const track = video.srcObject?.getVideoTracks()[0];
  if (track?.readyState === 'live') video.play().catch(() => {});
  else if (track) {
    video.srcObject.getTracks().forEach(x => x.stop());
    lastVideoTime = -1;
    startCamera().catch(() => say(t().noCamera));
  }
});

function cameraFail(e) {
  const m = !window.isSecureContext || !navigator.mediaDevices ? ['The camera needs https', 'Open this page over https, or on localhost.']
    : e?.name === 'NotAllowedError' ? ['Camera is blocked', IOS ? 'Tap aA in the address bar, then Website Settings, Camera, Allow. Then tap to try again.' : 'Click the camera icon in the address bar, choose Allow, then click to try again.']
      : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? ['No camera found', 'Connect a camera, then try again.']
        : e?.name === 'NotReadableError' ? ['Another app is using the camera', 'Close it, then try again.']
          : ['The camera did not start', 'Reload the page and try again.'];
  const a = $('alert');
  a.querySelector('strong').textContent = m[0];
  a.querySelector('p').textContent = m[1];
  a.hidden = false;
}

async function begin() {
  if (S.mode !== 'start' || S.cameraStarting) return;
  const ep = S.epoch, attempt = { cancelled: false, release: null,
    cancel() { this.cancelled = true; this.release?.(); } };
  S.cameraStarting = attempt;
  S.voicePaused = false; talkDone();
  const current = () => !attempt.cancelled && S.cameraStarting === attempt && ep === S.epoch;
  $('alert').hidden = true;
  voice.unlock(); stayAwake(); warmVoice();
  app.dataset.screen = 'run'; $('ambient').classList.add('on');
  try {
    // Retire audio-only fallback before re-opening camera+audio. One listener
    // owns the mic at a time; iOS receives a single combined capture again.
    const previousStart = S.earsStarting;
    for (const ears of new Set([S.ears, S.earsPending])) ears?.stop();
    S.ears = null; S.earsPending = null; S.earsStarting = null;
    for (const track of S.mic?.getTracks?.() || []) track.stop();
    S.mic = null;
    if (previousStart) await previousStart.catch(() => {}); // an uncancellable permission prompt must settle before another capture
    if (!current()) return;
    if (!S.sim) await startCamera(current, release => { attempt.release = release; });
    if (!current()) return;
    startEars();
    await readForm();
  } catch (e) {
    if (!current() || e?.name === 'AbortError') return;
    setMode('start'); app.dataset.screen = 'start';
    cameraFail(e); $('ambient').classList.remove('on');
    startEars(); // same controller, audio-only: global voice survives camera denial
    return say(t().noCamera, { system: true });
  } finally { if (S.cameraStarting === attempt) S.cameraStarting = null; }
}

async function readForm() {
  const ep = ++S.epoch;
  setMode('reading');
  S.fields = [];
  S.title = '';
  S.reviewed = false;
  S.reviewFailed = false;
  S.find = null;
  S.readT0 = 0;
  S.driftOn = false;
  S.pointerLabel = null; // every page starts with a fresh finger check-in (camera only)
  renderLists();
  say(t().hold);
  await wait(900); // let the camera settle focus and exposure
  if (ep !== S.epoch) return;
  // A slow read should never be silent: count the seconds on screen and say what's happening.
  const t0 = performance.now(), told = new Set();
  S.readT0 = t0;
  const ticker = setInterval(() => {
    if (S.mode !== 'reading') return;
    const secs = Math.round((performance.now() - t0) / 1000);
    $('docTitle').textContent = `Reading… ${secs} s`;
    if (secs >= 7 && !told.has(7)) { told.add(7); say(t().stillReading, { soft: true }); }
    if (secs >= 20 && !told.has(20)) { told.add(20); say(t().almost, { soft: true }); }
  }, 500);
  try {
    const shot = {};
    const image = snapshot(null, shot); // also the frozen reference for the page-movement guard
    const out = S.sim ? await S.sim.parse(S.lang) : await api('/api/parse', { image, lang: S.lang }).finally(() => clearInterval(ticker));
    clearInterval(ticker);
    if (ep !== S.epoch) return; // a newer read started meanwhile
    S.readSecs = (performance.now() - t0) / 1000; // shown to the room: measured, not claimed
    S.title = out.title || '';
    S.fields = (out.fields || []).map(f => ({ ...f, done: false }));
    warmVoice();
    // A menu, letter or receipt with nothing to fill is still worth reading: say what it is and offer "where is…".
    if (!S.fields.length) { setMode('idle'); renderLists(); $('docTitle').textContent = S.title; return say(S.title ? t().nothingToFill(S.title) : t().none); }
    captureDrift(shot);
    await reveal();
    if (!S.sim && !S.driftOn) await say(t().noLock); // said once, then guidance runs on the last read
    if (S.sim || S.pointerLabel) activate(0, true);
    else checkin();
  } catch (e) {
    clearInterval(ticker);
    if (ep !== S.epoch) return;
    setMode('idle');
    setCue('error');
    renderLists();
    speakErr(e);
  }
}

// One clean scan pass that "finds" each field top to bottom, in sync with the side panel.
async function reveal() {
  const now = performance.now();
  S.revealStart = now;
  const ys = S.fields.map(f => f.y0), lo = Math.min(...ys), hi = Math.max(...ys);
  S.fields.forEach(f => { f.revealAt = now + 120 + ((f.y0 - lo) / ((hi - lo) || 1)) * 1150; });
  setMode('reveal');
  renderLists();
  $('docTitle').textContent = S.title;
  await Promise.all([say(`${t().count(S.title, S.fields.length)} ${t().askHint}`), wait(1700)]);
}

// Finger check-in: before guiding, wait for one open hand (not holding a pen) to rest on the page,
// lock it as the pointing hand, and say so. Two hands get a nudge; nothing ever dead-ends.
function checkin() {
  setMode('checkin');
  S.checkinAt = performance.now();
  S.checkinHeld = 0;
  S.lastNudge = 0;
  renderLists();
  say(t().checkin);
}

function checkinTick(now) {
  const H = now - (S.handAt || 0) < 300 ? S.handPts : [];
  const one = H.length === 1 && !pinching(H[0]);
  if (one && S.checkinLabel !== S.handLabels[0]) { S.checkinLabel = S.handLabels[0]; S.checkinHeld = 0; } // same hand for the whole hold
  if (one) {
    S.checkinHeld ||= now;
    if (now - S.checkinHeld > 900) {
      S.pointerLabel = S.handLabels[0] || S.pointerLabel || 'any';
      voice.chime();
      buzz([30, 30, 60]);
      return activate(0, true, `${t().gotIt} ${t().firstShort(S.fields[0].label)}`);
    }
  } else S.checkinHeld = 0;
  if (H.length > 1 && now - S.lastNudge > 5000 && !voice.busy()) { S.lastNudge = now; say(t().oneHand, { cue: true }); }
  if (!H.length && now - S.checkinAt > 9000 && now - S.lastNudge > 9000 && !voice.busy()) { S.lastNudge = now; say(t().checkin, { soft: true }); }
  if (now - S.checkinAt > 25000) activate(0, true); // never strand anyone here
}

function activate(i, first = false, intro = '') {
  S.i = i;
  S.arrivedSince = 0;
  S.sweepAt = performance.now();
  if (first) S.startedAt = performance.now();
  setMode('guide');
  renderLists();
  const f = S.fields[i];
  S.lastDir = null;
  S.tolBoost = 1;
  S.nearSince = 0;
  say(intro || (first ? t().first(f.label) : `${t().next} ${f.label}.`)); // the field name must finish before any direction
}

// What the finger is being guided to: the field to fill, or any spot the person asked about ("where is the total?").
const target = () => (S.mode === 'find' ? S.find : S.fields[S.i]);

function guide(now) {
  const f = target();
  if (!f) return;
  if (S.mode === 'find' && now - f.at > 30000) return abortFind(t().notFound);
  if (!pageOk(now)) return;
  if (!S.tip || now - S.tipSeen > 400) {
    S.onTarget = false;
    S.arrivedSince = 0; // a finger that comes back must dwell again, not land on an old timer
    S.prox = 1;
    setCue('');
    if (now - S.lastNoHand > 5000 && !voice.busy()) { S.lastNoHand = now; say(t().noHand, { cue: true }); }
    return;
  }
  const g = offset(f, S.tip);
  S.onTarget = g.inside;
  S.prox = Math.min(1, g.d / 0.55);
  setCue(g.inside ? 'on' : g.dir);
  pace(now, g);
  if (g.inside) {
    // Say "stop" the instant the finger lands, so it doesn't drift past while the dwell timer runs.
    if (!S.arrivedSince) { S.stopSaid = true; say(t().stop, { cue: true }); }
    S.arrivedSince ||= now;
    if (now - S.arrivedSince > 450 && now - S.tipSeen < 150) (S.mode === 'find' ? found : arrive)(f);
    return;
  }
  S.arrivedSince = 0;
  if (g.m < 2) {
    S.nearSince ||= now;
    if (now - S.nearSince > 2500 && (S.tolBoost || 1) < 1.75) { S.tolBoost = (S.tolBoost || 1) + 0.25; S.nearSince = now; }
  } else S.nearSince = 0;
  // A change of direction is said at once; the same direction repeats only every 1.3 s.
  const turn = g.dir !== S.lastDir || g.near !== S.lastNear;
  if (!voice.busy() && now - S.lastCue > (turn ? 300 : 1300)) {
    S.lastCue = now;
    S.lastDir = g.dir;
    S.lastNear = g.near;
    say(voice.cueWord(g.dir, g.near), { cue: true });
  }
}

// ---------- stay on the line ----------
// A blind writer can't see the blank, so handwriting drifts up or down and runs past its end.
// While writing, follow the pen hand (gripping, not the resting pointer). Its height over the first
// strokes is the baseline; drifting more than half a line off it says "a little up/down" once, then
// a soft two-note tone repeats (rising: go up, falling: go down) until the pen is back. Reaching the
// end of the blank is said once. The pen point is estimated from thumb and index tips; only the
// change from the baseline matters, so a constant offset to the real nib cancels out.
// ponytail: an axis-aligned blank, so a page tilted several degrees shifts the line along its length.
function penPoint(now) {
  if (now - (S.handAt || 0) > 250) return null;
  const H = S.handPts;
  let k = H.findIndex((h, i) => i !== S.pointerIdx && pinching(h));
  if (k < 0 && H.length === 1 && S.pointerIdx < 0) k = 0; // only the pen hand is in view
  if (k < 0) return null;
  const h = H[k];
  return { x: (h[4].x + h[8].x) / 2, y: (h[4].y + h[8].y) / 2 };
}

function keepLine(now) {
  if (S.voicePaused) return;
  const f = S.fields[S.i];
  if (!f || f.kind === 'checkbox' || f.kind === 'button' || voice.speaking) return;
  const p = penPoint(now);
  if (!p || p.x < f.x0 - 0.03 || p.x > f.x1 + 0.08 || Math.abs(p.y - f.y1) > (f.y1 - f.y0) * 3 + 0.03) return;
  const L = (S.line ||= { y: p.y, n: 0, at: now, off: 0, said: 0, beat: 0, end: false });
  L.y += (p.y - L.y) * 0.15; // smooth out the up-and-down of letters
  if (L.n < 18) { L.n++; L.base = L.y; return; } // the first ~0.6 s of strokes set the baseline
  const lineH = Math.max(f.y1 - f.y0, 0.015), drift = L.y - L.base; // + is lower on the page
  const off = Math.abs(drift) > lineH * 0.5 ? Math.sign(drift) : 0;
  if (off !== L.off) { L.off = off; L.since = now; L.said = 0; if (!off) voice.beep(880, 0.04, 0.05); }
  if (off && now - L.since > 400) {
    const dir = off > 0 ? 'up' : 'down';
    if (!L.said) { L.said = now; say(voice.cueWord(dir, true), { cue: true }); }
    else if (now - L.beat > 900) {
      L.beat = now;
      voice.beep(dir === 'up' ? 520 : 780, 0.07, 0.07);
      setTimeout(() => voice.beep(dir === 'up' ? 780 : 520, 0.09, 0.07), 90);
    }
  }
  if (!L.end && p.x > f.x1 - 0.01) { L.end = true; say(t().lineEnd, { cue: true }); }
}

// ponytail: venue knob. ?tol=1.5 widens the "you're there" zone when fingertip jitter in bad light
// keeps a finger from ever settling inside it.
const TOL = Math.min(3, Math.max(0.5, Number(new URLSearchParams(location.search).get('tol')) || (S.sim ? 1 : 1.3))); // real tracking jitters more than a mouse

// How far the fingertip is from where it should be, in units of frame height.
function offset(f, tip) {
  const k = aspect(), a = anchorOf(f);
  const dx = (a.x - tip.x) * k, dy = a.y - tip.y;
  const pointy = f.kind === 'checkbox' || f.kind === 'button' || f.kind === 'find';
  const boost = S.tolBoost || 1; // grows if the finger hovers close but jitter keeps it from landing
  const tolX = (pointy ? Math.max(((f.x1 - f.x0) * k) / 2, 0.02) : 0.04) * TOL * boost;
  const tolY = Math.max((f.y1 - f.y0) / 2, 0.02) * TOL * boost;
  const ex = Math.abs(dx) / tolX, ey = Math.abs(dy) / tolY;
  return {
    inside: ex <= 1 && ey <= 1,
    // Get onto the right row first, then slide along it.
    dir: ey >= ex ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right'),
    near: Math.max(ex, ey) < 3 || Math.hypot(dx, dy) < 0.1, // within ~3 cm: slow down
    d: Math.hypot(dx, dy),
    dx,
    m: Math.max(ex, ey),
  };
}

// Parking-sensor beeps: faster and higher as the finger closes in, panned toward the target.
function pace(now, g) {
  // Never silent: under speech the beeps just get quieter.
  const d = Math.min(g.d, 0.6) / 0.6;
  const every = g.inside ? 90 : 140 + d * 560;
  if (now - S.lastBeep < every) return;
  S.lastBeep = now;
  voice.beep(g.inside ? 1100 : 440 + (1 - d) * 520, 0.045, voice.busy() ? 0.035 : 0.08, g.dx / 0.25);
  S.pulses.push({ t: now, on: g.inside });
  if (S.pulses.length > 8) S.pulses.shift();
  buzz(g.inside ? 25 : 12);
}

// "Where is the total?" Guide the finger to any spot on the page, read what's there, then carry on.
function goFind(out) {
  const back = S.mode === 'find' ? S.find.back : S.mode;
  S.find = { label: out.label || '', kind: 'find', ...out.box, say: out.say, back, q: S.lastQ, at: performance.now() };
  S.arrivedSince = 0;
  S.sweepAt = performance.now();
  S.lastDir = null;
  S.tolBoost = 1;
  S.nearSince = 0;
  setMode('find');
  renderLists();
  say(t().takeYou, { soft: true });
}

function abortFind(msg) {
  const back = S.find?.back || 'idle';
  S.find = null;
  S.onTarget = false;
  S.arrivedSince = 0;
  setMode(back);
  S.cue = null;
  setCue(back === 'done' ? 'done' : back === 'write' ? 'write' : '');
  renderLists();
  say(msg);
}

function found(f) {
  S.burstPt = anchorOf(f);
  S.find = null;
  S.onTarget = false;
  S.burstAt = performance.now();
  voice.chime();
  buzz([40, 40, 80]);
  setMode(f.back);
  S.cue = null;
  setCue(f.back === 'done' ? 'done' : f.back === 'write' ? 'write' : '');
  renderLists();
  say(f.say);
}

function arrive(f) {
  const ep = S.epoch, index = S.i;
  setMode('write');
  S.onTarget = false;
  S.burstPt = anchorOf(f);
  S.burstAt = performance.now();
  voice.chime();
  buzz([40, 40, 80]);
  const coached = S.fields.some(x => x.done && !x.skipped);
  const stop = S.stopSaid ? '' : `${t().stop} `;
  S.stopSaid = false;
  const coaching = say(`${stop}${f.say}${f.hint ? ` ${f.hint}` : ''}${coached ? '' : ` ${IOS ? t().coachTap : t().coach}`}`);
  const speech = voice.seq;
  coaching.then(() => {
    if (!coached && !S.sim && S.mode === 'write' && !S.rulerSaid && !S.voicePaused && !app.dataset.talk
      && ep === S.epoch && index === S.i && S.fields[index] === f && speech === voice.seq) {
      S.rulerSaid = true; say(t().ruler, { soft: true });
    }
  });
  S.line = null; // a fresh blank: learn the writing height again
}

async function finishWriting() {
  if (S.mode !== 'write') return;
  const f = S.fields[S.i], ep = S.epoch;
  const stale = () => ep !== S.epoch || S.mode !== 'check' || S.fields[S.i] !== f;
  setMode('check');
  if (S.sim) S.sim.write(f);
  else { say(t().lift); S.clearView = await handAway(f); }
  if (stale()) return;
  const page = S.driftOn ? await settlePage() : 'ok';
  if (stale()) return;
  if (page === 'moved') return pageMoved('read');
  if (!S.sim && (S.clearView === false || page === 'unknown') && !S.retriedView) {
    S.retriedView = true;
    setMode('write');
    return say(t().notClear);
  }
  S.retriedView = false;
  const image = snapshot(expand(f));
  readback.show(image, f.label);
  try {
    const out = S.sim ? (await wait(700), S.sim.read(f, S.lang)) : await api('/api/read', { image, label: f.label, kind: f.kind, lang: S.lang });
    if (stale()) return;
    const empty = !out.text || out.text === 'empty';
    if (empty) {
      readback.result('', false);
      readback.hide(1800);
      setMode('write');
      return say(t().blank);
    }
    f.answer = out.text;
    f.legible = out.legible;
    f.review = !out.legible; // unclear writing is never silently accepted: flagged, then listed at the end
    readback.result(out.text, out.legible);
    setMode('confirm'); // only a proposal until the person keeps it
    renderLists();
    say(`${out.spoken || t().wrote(f.answer)}${f.review ? ` ${t().unsure}` : ''} ${t().confirm}`);
  } catch (e) {
    if (stale()) return;
    readback.hide();
    setMode('write');
    setCue('error');
    return speakErr(e);
  }
}

// ---------- page movement (Codex's guard in drift.js) ----------
// Hand outlines in frame fractions, so the guard ignores the printed detail they cover.
function handRects(now) {
  if (S.sim || now - (S.handAt || 0) > 300) return [];
  const c = v => Math.min(1, Math.max(0, v));
  return S.handPts.map(h => {
    const xs = h.map(p => c(p.x)), ys = h.map(p => c(p.y));
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x0, y0, x1: Math.max(x0 + 0.002, Math.max(...xs)), y1: Math.max(y0 + 0.002, Math.max(...ys)) };
  }).map(r => ({ ...r, x1: Math.min(1, r.x1), y1: Math.min(1, r.y1) }));
}

// Lock onto the page as it was read: the frozen parse frame, around the places to fill.
function captureDrift(shot) {
  const F = S.fields.filter(f => !f.stale);
  S.driftOn = false;
  if (!shot?.canvas || !shot.w || !shot.h || !F.length) return;
  const { w, h } = shot;
  const m = 0.06, c = v => Math.min(1, Math.max(0, v));
  const region = { x0: c(Math.min(...F.map(f => f.x0)) - m), y0: c(Math.min(...F.map(f => f.y0)) - m), x1: c(Math.max(...F.map(f => f.x1)) + m), y1: c(Math.max(...F.map(f => f.y1)) + m) };
  // ponytail: low-texture pages can't be locked; guidance then runs on the last read (readout: "Page lock: off")
  S.driftOn = drift.capture({ img: shot.canvas, w, h }, region);
}

// Guidance only steers on a verified page. Unverified: stop, reset the dwell, and say how to fix it.
function pageOk(now) {
  if (!S.driftOn) return true;
  if (drift.moved(source(), handRects(now))) { pageMoved(); return false; }
  if (drift.verified) { S.pauseSince = 0; return true; }
  S.arrivedSince = 0;
  S.onTarget = false;
  S.prox = 1;
  if (!S.pauseSince) { S.pauseSince = now; S.pauseSaid = false; setCue(''); }
  if (!S.pauseSaid && now - S.pauseSince > 700 && !voice.busy()) {
    S.pauseSaid = true;
    S.lastCue = 0; // the next direction comes as soon as the page is verified again
    say(S.handPts.length > 1 && now - (S.handAt || 0) < 300 ? t().penOff : t().holdStill);
  }
  return false;
}

// A checkpoint while the hands are clear: a few fresh looks, 400 ms apart (the guard needs two mismatches).
async function settlePage() {
  for (let k = 0; k < 4; k++) {
    await wait(400);
    if (drift.moved(source(), handRects(performance.now()))) return 'moved';
    if (drift.verified) return 'ok';
  }
  return 'unknown';
}

// The page moved: read it again, keep every answer, and carry on from the same place.
// resume 'read': the person just wrote, so read that field at its new position next.
async function pageMoved(resume) {
  const ep = ++S.epoch, cur = S.fields[S.i], oldMode = S.mode, oldFind = S.find;
  S.find = null;
  S.line = null; // a moved page invalidates the pen-hand writing baseline
  S.driftOn = false;
  S.onTarget = false;
  S.arrivedSince = 0;
  S.movedN = (S.movedN || 0) + 1;
  readback.hide();
  setMode('reading');
  renderLists();
  // Use two fresh FROZEN frames. The paper may still move after the alarm.
  try {
    let previous = null;
    for (let attempt = 0; attempt < 4 && !S.sim; attempt++) {
      const shot = {};
      snapshot(null, shot);
      const model = drift.relocation({ img: shot.canvas, w: shot.w, h: shot.h }, handRects(performance.now()));
      const project = (m, x, y) => ({ x: m.xx * x + m.xy * y + m.tx, y: m.yx * x + m.yy * y + m.ty });
      const agrees = model && previous && model.w === previous.w && model.h === previous.h
        && [[0, 0], [model.w, 0], [0, model.h], [model.w, model.h]].every(([x, y]) => {
          const a = project(previous, x, y), b = project(model, x, y);
          return Math.hypot(a.x - b.x, a.y - b.y) <= model.analysisScale;
        });
      if (agrees) {
        const mapBox = f => {
          if (f.stale) return { ...f };
          if (!['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(f[k])) || f.x0 >= f.x1 || f.y0 >= f.y1) return null;
          // Keep the quadrilateral across corrections: re-rotating a previous
          // axis-aligned bounding box would inflate it on every move.
          const original = f.pageCorners || [[f.x0, f.y0], [f.x1, f.y0], [f.x0, f.y1], [f.x1, f.y1]];
          const corners = original.map(([x, y]) => project(model, x * model.w, y * model.h));
          const xs = corners.map(p => p.x / model.w), ys = corners.map(p => p.y / model.h);
          const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
          if (box.x0 < 0 || box.y0 < 0 || box.x1 > 1 || box.y1 > 1) return null;
          return { ...f, ...box, pageCorners: corners.map(p => [p.x / model.w, p.y / model.h]) };
        };
        const mapped = S.fields.map(mapBox), mappedFind = oldFind ? mapBox(oldFind) : null;
        if (mapped.every(Boolean) && (!oldFind || mappedFind)) {
          const before = S.fields;
          S.fields = mapped;
          // Seed only printed detail outside current hands, in the EXACT fitted frame.
          const F = mapped.filter(f => !f.stale), c = v => Math.min(1, Math.max(0, v)), margin = 0.06;
          const region = { x0: c(Math.min(...F.map(f => f.x0)) - margin), y0: c(Math.min(...F.map(f => f.y0)) - margin),
            x1: c(Math.max(...F.map(f => f.x1)) + margin), y1: c(Math.max(...F.map(f => f.y1)) + margin) };
          S.driftOn = F.length > 0 && drift.capture({ img: shot.canvas, w: shot.w, h: shot.h }, region, handRects(performance.now()));
          if (S.driftOn) {
            S.reviewed = false;
            S.pauseSince = 0; S.pauseSaid = false; S.lastCue = 0; S.lastDir = null;
            S.tip = null; S.tipSeen = 0; S.pointerIdx = -1; // require a fresh fingertip/dwell
            const adjusted = { en: 'The page moved. I adjusted.', es: 'La página se movió. Ya la ajusté.',
              hi: 'पन्ना हिला था। मैंने जगह ठीक कर ली है।', zh: '纸张移动了。我已调整位置。' };
            await say(adjusted[S.lang] || adjusted.en);
            if (ep !== S.epoch) return;
            if (resume === 'read' && cur && !cur.done) {
              setMode('write'); renderLists(); return finishWriting();
            }
            if (oldMode === 'find' && mappedFind) { S.find = mappedFind; setMode('find'); }
            else setMode(oldMode === 'write' || oldMode === 'guide' ? oldMode : 'guide');
            renderLists();
            return;
          }
          S.fields = before; // failed recapture must not become accepted geometry
        }
        break;
      }
      previous = model;
      await wait(150);
      if (ep !== S.epoch) return;
    }
  } catch { /* unknown position: use the full reread below */ }
  if (ep !== S.epoch) return;
  await say(t().moved);
  await wait(300);
  if (ep !== S.epoch) return;
  S.readT0 = performance.now();
  try {
    const shot = {};
    const image = snapshot(null, shot);
    const out = S.sim ? await S.sim.parse(S.lang) : await api('/api/parse', { image, lang: S.lang, all: true });
    if (ep !== S.epoch) return;
    const fresh = (out.fields || []).map(f => ({ ...f, done: false }));
    const key = f => (f.label || '').trim().toLowerCase();
    const count = (list, k) => list.filter(f => key(f) === k).length;
    const used = new Set(), merged = [];
    for (const old of S.fields) {
      const same = count(S.fields, key(old)) === count(fresh, key(old)); // ambiguous repeats stay unresolved
      const k = !same ? -1 : fresh.findIndex((f, j) => !used.has(j) && key(f) === key(old));
      if (k >= 0) {
        used.add(k);
        const { x0, y0, x1, y1, say: line, hint } = fresh[k];
        merged.push({ ...old, x0, y0, x1, y1, say: line || old.say, hint: hint || old.hint, stale: false, pageCorners: undefined });
      } else if (old.done) merged.push({ ...old, stale: true }); // answer kept; its box is unknown now, so it isn't drawn
      // an unfilled place the new read can't find is dropped: the final check looks at the whole page
    }
    fresh.forEach((f, j) => { if (!used.has(j)) merged.push(f); });
    S.fields = merged;
    warmVoice();
    S.reviewed = false; // the page moved: the final check must look again
    captureDrift(shot);
    if (!S.sim && !S.driftOn) await say(t().noLock);
    if (ep !== S.epoch) return;
    const i = cur ? S.fields.findIndex(f => f.label === cur.label && !f.done) : -1;
    if (resume === 'read' && i >= 0) {
      S.i = i;
      setMode('write');
      renderLists();
      return finishWriting();
    }
    const next = i >= 0 ? i : S.fields.findIndex(f => !f.done);
    if (next < 0) return review();
    activate(next);
  } catch (e) {
    if (ep !== S.epoch) return;
    setMode('idle');
    setCue('error');
    renderLists();
    speakErr(e);
  }
}

// Never read provider or model text to a blind user: one short, localized line they can act on.
function speakErr(e) {
  const m = e?.message || '';
  console.warn('[nib]', m);
  if (/Form reading is off/.test(m)) return say(t().noKey);
  if (e?.name === 'TimeoutError' || /too long|timed out|TimeoutError/i.test(m)) return say(t().slow);
  if (e instanceof TypeError) return say(t().noServer); // fetch itself failed: no network or no server
  if (/rate-limit|wait a few/i.test(m)) return say(t().busy);
  if (/out of credits/i.test(m)) return say(t().noCredit);
  return say(t().readFail);
}

// The person heard the readback and keeps it.
function keep() {
  if (S.mode !== 'confirm') return;
  $('readback').dataset.state = 'kept';
  const f = S.fields[S.i];
  f.done = true;
  f.doneAt = performance.now();
  readback.hide(600);
  next();
}

// The readback was wrong: write it again in the same place.
function redo() {
  if (S.mode !== 'confirm') return;
  Object.assign(S.fields[S.i], { answer: '', review: false });
  readback.hide();
  setMode('write');
  renderLists();
  say(t().redo);
}

// Wait until no hand covers the field (or 5 s pass), so the photo shows the writing.
function handAway(f) {
  const r = expand(f);
  return new Promise(resolve => {
    const start = performance.now();
    let clearSince = 0;
    let asked = false;
    const tick = () => {
      const now = performance.now();
      const covering = now - (S.handAt || 0) < 300 && S.handPts.some(h => {
        const xs = h.map(p => p.x), ys = h.map(p => p.y);
        return Math.min(...xs) - 0.02 < r.x1 && Math.max(...xs) + 0.02 > r.x0 && Math.min(...ys) - 0.02 < r.y1 && Math.max(...ys) + 0.02 > r.y0;
      });
      if (covering) clearSince = 0;
      else if (!clearSince) clearSince = now;
      if (clearSince && now - clearSince > 600) return resolve(true);
      if (now - start > 5000 && !asked) { asked = true; say(t().lift); }
      if (now - start > 12000) return resolve(false);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// Handwriting sits above the line and drifts up, so read a generous crop above it. Below the line
// only leave room for descenders: any more catches the next row's writing.
function expand(f) {
  const h = f.y1 - f.y0;
  const c = v => Math.min(1, Math.max(0, v));
  return { x0: c(f.x0 - 0.03), x1: c(f.x1 + 0.03), y0: c(f.y0 - Math.max(h, 0.05)), y1: c(f.y1 + Math.max(h * 0.25, 0.008)) };
}

// The next field still to fill: after this one first, then wrap around to any left earlier (after a jump).
function next() {
  const pending = S.fields.map((f, k) => k).filter(k => !S.fields[k].done);
  const n = pending.find(k => k > S.i) ?? pending[0];
  if (n === undefined) return review();
  activate(n);
}

const iou = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i);
};

// Before "all done", look at the whole page once more. Blanks the first read missed, or ones still empty,
// get added and guided to, so a miss is never silent. One pass per form.
async function review() {
  if (S.reviewed || !S.fields.length) return finish();
  S.reviewed = true;
  const ep = S.epoch;
  setMode('reading');
  S.readT0 = performance.now();
  say(S.sim ? t().checking : `${t().checking} ${t().lift}`);
  try {
    if (!S.sim && !(await handAway({ x0: 0, y0: 0, x1: 1, y1: 1 }))) throw new Error('covered'); // a covered page is not checked
    const ledger = S.fields.map(({ label, done, skipped, answer: a }) => ({ label, done, skipped, answer: a }));
    const out = S.sim ? (await wait(1200), S.sim.review(S.lang)) : await api('/api/review', { image: snapshot(), fields: ledger, lang: S.lang });
    if (ep !== S.epoch) return;
    S.reviewFailed = out.unplaced > 0; // a missing place it could not locate: the page is not confirmed clear
    const fresh = [], reopened = [];
    for (const m of out.missing || []) {
      const hit = S.fields.find(f => iou(f, m) > 0.3);
      if (!hit) fresh.push(m);
      else if (hit.done && !hit.skipped) reopened.push(hit); // "filled", but the page shows it empty (skips stay skipped)
    }
    reopened.forEach(f => Object.assign(f, { done: false, answer: '', review: false, reopened: true }));
    S.fields.push(...fresh.map(f => ({ ...f, done: false, added: true })));
    const todo = S.fields.map((f, k) => k).filter(k => !S.fields[k].done);
    if (!todo.length) return finish();
    const first = S.fields[todo[0]];
    activate(todo[0], false, first.reopened ? t().reopened(first.label) : t().missed(todo.length, first.label));
  } catch {
    if (ep !== S.epoch) return;
    S.reviewFailed = true; // the page was NOT checked: never say it's ready to hand in
    finish();
  }
}

// Says what was filled, skipped and flagged. "Hand it in" only when nothing needs another look.
function finish() {
  S.finishedAt = performance.now();
  const s = Math.round((S.finishedAt - S.startedAt) / 1000);
  S.elapsed = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  S.fields.forEach((f, k) => { if (f.done && !f.skipped) f.doneAt = S.finishedAt + 380 + k * 70; });
  setMode('done');
  setCue('done');
  renderLists();
  buzz([60, 60, 60, 60, 160]);
  const filled = S.fields.filter(f => f.done && !f.skipped);
  const skipped = S.fields.filter(f => f.skipped).map(f => f.label);
  const review = filled.filter(f => f.review).map(f => f.label);
  say([
    t().all(filled.length),
    skipped.length && t().skipped(skipped.join(', ')),
    review.length && t().review(review.join(', ')),
    S.reviewFailed && t().notChecked,
    !skipped.length && !review.length && !S.reviewFailed && t().handIn,
  ].filter(Boolean).join(' '));
}

function skip() {
  if (S.mode === 'find') return abortFind(t().cancelled);
  if (S.mode !== 'guide' && S.mode !== 'write') return;
  readback.hide();
  const f = S.fields[S.i];
  f.done = true;
  f.skipped = true;
  renderLists();
  next();
}

function repeat() { if (S.lastSay) say(S.lastSay); }

function again() {
  S.sim?.reset();
  $('docTitle').textContent = '';
  readForm();
}

function primary() {
  ({ start: begin, confirm: keep, checkin: () => activate(0, true), idle: readForm, guide: repeat, find: repeat, write: finishWriting, done: again })[S.mode]?.();
}

// Jump to any field to fill (or refill) it.
function goTo(k) {
  const f = S.fields[k];
  if (!f || ['start', 'reading', 'reveal', 'check'].includes(S.mode)) return;
  if (f.stale) return say(t().lost); // its box is from before the page moved
  Object.assign(f, { done: false, skipped: false, review: false, answer: '' });
  readback.hide();
  activate(k);
}

function back() {
  if (S.mode === 'find') return abortFind(t().cancelled); // never wipe an answer just to stop looking
  const k = S.mode === 'done' ? S.fields.length - 1 : S.i - 1;
  if (k < 0) return say(t().firstOne);
  goTo(k);
}

function setLang(code) {
  if (!T[code]) return;
  S.lang = code;
  voice.lang = code;
  store.set('nib.lang', code);
  for (const o of document.querySelectorAll('[data-lang]')) o.setAttribute('aria-pressed', String(o.dataset.lang === code));
  const tab = document.querySelector('.tab');
  tab.textContent = matchMedia('(pointer: coarse)').matches ? t().startTab : t().startClick;
  tab.lang = code;
  $('captionText').lang = code;
  if (voice.rec) voice.listen(voice.onCommand); // the browser recognizer, when it is the ears: new language
  if (S.mode !== 'start') warmVoice();
}

// Warm the natural voice for what Nib will say: direction words, every fixed line, and each place's
// name and instruction exactly as arrive() and activate() phrase them. Clips are cached by text.
function warmVoice() {
  const w = t(), cues = ['up', 'down', 'left', 'right'].flatMap(d => [voice.cueWord(d, false), voice.cueWord(d, true)]);
  const places = S.fields.filter(f => !f.done).flatMap((f, i) => {
    const body = `${f.say}${f.hint ? ` ${f.hint}` : ''}`, coach = ` ${IOS ? w.coachTap : w.coach}`;
    return [i === 0 ? w.first(f.label) : `${w.next} ${f.label}.`, `${w.stop} ${body}`, body, ...(i === 0 ? [`${w.stop} ${body}${coach}`] : [])];
  });
  voice.prefetch([...cues, ...places, ...Object.values(w).filter(v => typeof v === 'string')]);
}

function onVoiceCommand(cmd, rest) {
  if (cmd === 'nav') {
    const routes = { around: './around.html', memory: './memory.html', home: './' };
    if (typeof rest !== 'string' || !Object.hasOwn(routes, rest)) return;
    // End this Paper session before leaving. Late model/ASR results and an old
    // PTT completion must not act on the next page or reopen browser listening.
    S.cameraStarting?.cancel?.(); S.cameraStarting = null;
    S.answerSerial = (S.answerSerial || 0) + 1;
    S.epoch++;
    S.earsPttGeneration = (S.earsPttGeneration || 0) + 1;
    S.mode = 'start';
    S.awaitQ = 0; S.awaitQContext = null; S.earsDelivery = null;
    clearTimeout(talk.auto);
    voice.onCommand = null;
    voice.cloud = false; // remaining warm-up jobs cannot start new network fetches
    const rec = voice.rec; voice.rec = null;
    try { rec?.abort(); } catch { /* recognizer already stopped */ }
    voice.stop({ resumeEars: false });
    for (const ears of new Set([S.ears, S.earsPending])) ears?.stop();
    S.ears = null; S.earsPending = null;
    const live = talk.live; talk.live = null; talk.context = null;
    try { Promise.resolve(live?.stop?.()).catch(() => {}); } catch { /* already stopped */ }
    for (const track of S.mic?.getTracks?.() || []) {
      try { track.stop(); } catch { /* capture already ended */ }
    }
    S.mic = null; voice.micOpen = false;
    if (typeof video !== 'undefined') {
      for (const track of video.srcObject?.getTracks?.() || []) { try { track.stop(); } catch { /* ended */ } }
      video.srcObject = null;
    }
    location.assign(routes[rest]);
  }
  else if (cmd === 'done') { if (S.mode === 'write') finishWriting(); else if (S.mode === 'confirm') keep(); }
  else if (cmd === 'redo') redo();
  else if (cmd === 'repeat') repeat();
  else if (cmd === 'skip') skip();
  else if (cmd === 'ask') {
    if (rest && S.paperControl?.(rest)) return;
    if (rest) {
      voice.stop(); // an inline wake interrupts coaching before the model answers
      if (S.mode === 'start') return S.paperControl?.('help');
      return answer(rest);
    }
    return talkStart({ auto: true });
  }
}

// ---------- hands-free: "Nib" ----------
// Nib's own ears (ears.js) open once in the start tap and stay open. Say "Nib", then the question;
// or "Hey Nib, <question>"; or a bare command like "done". Anything heard while Nib talks is ignored.
async function startEars() {
  voice.onCommand = onVoiceCommand;
  if (new URLSearchParams(location.search).has('bot')) return; // the robot finger has no mouth
  if (S.earsStarting) return S.earsStarting;
  if (S.ears?.stream) return S.ears;
  S.paperControl = text => {
    const words = String(text || '').toLowerCase().trim().replace(/[.!?]+$/g, '');
    if (!/^(help|what can i say|stop|pause|quiet|resume|continue|retry|try again|start|start reading)$/.test(words)) return false;
    S.answerSerial = (S.answerSerial || 0) + 1;
    voice.stop(); S.awaitQ = 0; S.awaitQContext = null; clearTimeout(talk.auto);
    const speak = line => say(line, { system: true }); // immediate system voice; no model request
    if (/^(stop|pause|quiet)$/.test(words)) {
      S.voicePaused = true; S.arrivedSince = 0; S.onTarget = false;
      talkDone(); speak('Guidance paused. Say Nib, resume, when you are ready.'); return true;
    }
    if (/^(resume|continue)$/.test(words)) {
      S.voicePaused = false; S.arrivedSince = 0; S.onTarget = false; S.line = null;
      talkDone(); speak(S.mode === 'start' ? 'Say Nib, retry, to try the camera again.' : 'Guidance is on.'); return true;
    }
    if (/^(retry|try again|start|start reading)$/.test(words)) {
      if (S.cameraStarting) { speak('The camera is still starting. You can say Home.'); return true; }
      S.voicePaused = false; talkDone();
      if (S.mode === 'start') begin();
      else if (S.mode === 'idle') readForm();
      else if (S.mode === 'done') again();
      else speak('A form is already open. Say help for the controls.');
      return true;
    }
    talkDone();
    speak(S.mode === 'start'
      ? 'You are in Trace. The camera is not ready. Say Nib, retry, to try again. You can also say Home, Around me, or Memory.'
      : 'You are in Trace. Say Nib, then your question. Say stop to pause guidance and resume to continue. While writing, say done. Keep an answer only after you hear it read back. You can also say Home, Around me, or Memory.');
    return true;
  };
  S.ears = null;
  let sequence = 0;
  const sessionCurrent = token => !!token && !talk.live
    && token.epoch === S.epoch && token.lang === S.lang && token.ptt === (S.earsPttGeneration || 0);
  const current = token => sessionCurrent(token) && token.mode === S.mode
    && token.field === S.fields[S.i] && token.index === S.i;
  const ears = makeEars({
    ctx: voice.ctx,
    lang: () => S.lang,
    ignore: () => !!talk.live, // barge-in remains available while Nib speaks
    // Snapshot at speech onset, not when a slow transcription comes back. In
    // particular, "done" spoken while writing must never Keep a later readback.
    onCapture: () => ({ epoch: S.epoch, mode: S.mode, field: S.fields[S.i], index: S.i,
      lang: S.lang, ptt: S.earsPttGeneration || 0, sequence: ++sequence, capturedAt: performance.now(),
      echoContext: voice.echoSnapshot?.() }),
    isCurrent: sessionCurrent,
    onText: (text, token) => {
      if (voice.echo(text, token.echoContext)) return;
      const destination = voice.navigation?.(text);
      if (destination) return onVoiceCommand('nav', destination);
      const spoken = voice.wake?.(text)?.rest ?? text;
      const globalControl = /^(help|what can i say|stop|pause|quiet)[.!?]*$/i.test(spoken.trim());
      if ((current(token) || globalControl) && S.paperControl?.(spoken)) return;
      if (!current(token)) {
        const wake = voice.wake(text);
        if (wake) {
          // Wake is global, but an inline relative instruction was spoken in a
          // different context. Listen afresh rather than act on the new field.
          S.earsDelivery = token;
          try { talkStart({ auto: true }); } finally { S.earsDelivery = null; }
          if (wake.rest) {
            const retry = { en: 'Please ask that again.', es: 'Por favor, pregunta otra vez.',
              hi: 'कृपया फिर से पूछिए।', zh: '请再问一次。' };
            say(retry[S.lang] || retry.en, { system: true }); // immediate system fallback, no network wait
          }
        }
        return;
      }
      if (S.awaitQ && gotQuestion(text, token)) return;
      S.earsDelivery = token; // lets a bare wake phrase identify its ordered follow-up
      try { voice.handle(text); } finally { S.earsDelivery = null; }
    },
  });
  S.earsPending = ears;
  let pending;
  pending = (async () => {
    try {
      voice.micOpen = true;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* Safari only */ }
      // Resume inside the start interaction; never switch an open iOS mic to playback.
      try { voice.ctx.resume?.()?.catch?.(() => {}); } catch { /* unsupported audio context */ }
      const active = await ears.start(S.mic);
      if (S.earsPending !== ears) { ears.stop(); return null; }
      S.ears = active;
      S.earsErr = '';
      // A recovered custom listener replaces the browser fallback, rather than
      // dispatching every utterance twice through two recognizers.
      const rec = voice.rec;
      voice.rec = null;
      try { rec?.abort(); } catch { /* already stopped */ }
      return active;
    } catch (e) {
      ears.stop();
      if (S.earsPending !== ears) return null;
      if (e?.name !== 'AbortError') {
        voice.micOpen = false;
        S.earsErr = e?.name || 'error';
        say(t().noEars, { system: true });
        voice.listen(onVoiceCommand);
      }
      return null;
    } finally {
      if (S.earsPending === ears) S.earsPending = null;
      if (S.earsStarting === pending) S.earsStarting = null;
    }
  })();
  S.earsStarting = pending;
  return pending;
}

function awaitQuestion() {
  voice.stop(); // "Nib" cuts Nib off
  S.awaitQ = performance.now() + 8000;
  const waiting = S.awaitQContext = { epoch: S.epoch, mode: S.mode, field: S.fields[S.i], index: S.i,
    lang: S.lang, ptt: S.earsPttGeneration || 0, after: S.earsDelivery?.sequence || 0, until: S.awaitQ };
  app.dataset.talk = 'listening';
  $('talk').setAttribute('aria-pressed', 'true');
  renderSessionContext();
  setCue('listen');
  showHeard('');
  voice.earcon(true);
  buzz(20);
  clearTimeout(talk.auto);
  const expire = () => {
    if (!S.awaitQ || S.awaitQContext !== waiting) return;
    const same = !talk.live && S.epoch === waiting.epoch && S.mode === waiting.mode
      && S.fields[S.i] === waiting.field && S.i === waiting.index && S.lang === waiting.lang
      && (S.earsPttGeneration || 0) === waiting.ptt;
    const now = performance.now();
    // The person gets eight seconds to start a question. If that timely phrase
    // is still being captured/queued/transcribed, allow at most ten extra seconds.
    const pending = same && S.ears?.hasPending(token => token.sequence > waiting.after && token.capturedAt <= waiting.until);
    if (pending && now < waiting.until + 10000) {
      talk.auto = setTimeout(expire, Math.min(250, waiting.until + 10000 - now));
      return;
    }
    S.awaitQ = 0; S.awaitQContext = null;
    voice.earcon(false);
    if (!talk.live) talkDone();
    if (same) say(t().heardNothing);
  };
  talk.auto = setTimeout(expire, 8000);
}

function gotQuestion(text, token) {
  const waiting = S.awaitQContext;
  if (!S.awaitQ || !waiting || !token || token.sequence <= waiting.after || token.capturedAt > waiting.until
    || performance.now() > waiting.until + 10000 || talk.live
    || S.epoch !== waiting.epoch || S.mode !== waiting.mode || S.fields[S.i] !== waiting.field
    || S.i !== waiting.index || S.lang !== waiting.lang || (S.earsPttGeneration || 0) !== waiting.ptt) return false;
  const wake = voice.wake?.(text);
  if (wake && !wake.rest) return false; // another bare wake renews listening; it is not the question
  const question = wake ? wake.rest : text;
  S.awaitQ = 0;
  S.awaitQContext = null;
  clearTimeout(talk.auto);
  voice.earcon(false);
  showHeard(question);
  onVoiceCommand('ask', question);
  return true;
}

// ---------- listening: hold to ask ----------
// Hold the screen (or Space, or the Ask button) and talk. Nib answers from the form itself,
// and can also act: skip, go back, jump to a field, switch language.
const talk = { live: null, auto: 0 };

function talkStart({ auto = false } = {}) {
  if (talk.live) return;
  if (auto && S.ears) return awaitQuestion(); // "Nib": the next phrase our own ears hear is the question
  if (!voice.heard) return say(t().noMic);
  voice.unlock();
  talk.live = voice.hear(words => showHeard(words), auto ? () => talkEnd() : null);
  if (!talk.live) return;
  S.earsPttGeneration = (S.earsPttGeneration || 0) + 1; // the ears drop anything captured before a hold-to-ask
  talk.context = { epoch: S.epoch, mode: S.mode, index: S.i, field: S.fields[S.i], lang: S.lang,
    ptt: S.earsPttGeneration, answer: S.answerSerial || 0, wake: S.awaitQContext };
  app.dataset.talk = 'listening';
  $('talk').setAttribute('aria-pressed', 'true');
  setCue('listen');
  showHeard('');
  voice.earcon(true);
  buzz(20);
  clearTimeout(talk.auto);
  if (auto) talk.auto = setTimeout(talkEnd, 7000); // the wake phrase has no button to let go of
}

async function talkEnd() {
  const live = talk.live;
  if (!live) return;
  const context = talk.context;
  S.earsPttGeneration = (S.earsPttGeneration || 0) + 1;
  const released = S.earsPttGeneration;
  talk.live = null;
  clearTimeout(talk.auto);
  $('talk').setAttribute('aria-pressed', 'false');
  voice.earcon(false);
  const q = await live.stop();
  const sessionCurrent = context && talk.context === context && context.epoch === S.epoch && context.lang === S.lang
    && context.ptt + 1 === released && released === S.earsPttGeneration
    && context.answer === (S.answerSerial || 0) && context.wake === S.awaitQContext;
  if (!sessionCurrent) return; // navigation, a new capture or a newer Ask owns its own UI
  const destination = voice.navigation?.(q);
  if (destination) { talk.context = null; return onVoiceCommand('nav', destination); }
  talk.context = null;
  if (context.mode !== S.mode || context.index !== S.i || context.field !== S.fields[S.i]) {
    if (app.dataset.talk === 'listening') talkDone();
    return; // an old writing utterance can never Keep a later readback
  }
  if (!q) { talkDone(); return say(t().heardNothing); }
  const question = voice.wake?.(q)?.rest ?? q;
  await onVoiceCommand('ask', question);
}

function talkDone() {
  if (S.voicePaused) { app.dataset.talk = 'paused'; setCue(''); return; }
  delete app.dataset.talk;
  S.cue = null;
  setCue({ write: 'write', reading: 'wait', reveal: 'wait', check: 'wait', done: 'done' }[S.mode] || '');
}

function showHeard(text) {
  S.words = [];
  $('captionText').textContent = text ? `“${text}”` : t().listening;
}

async function answer(q) {
  // Even an immediate local/practice answer supersedes an older model request.
  const serial = S.answerSerial = (S.answerSerial || 0) + 1;
  const context = { epoch: S.epoch, mode: S.mode, index: S.i, field: S.fields[S.i],
    lang: S.lang, ptt: S.earsPttGeneration || 0, wake: S.awaitQContext };
  const current = () => serial === S.answerSerial && context.epoch === S.epoch
    && context.mode === S.mode && context.index === S.i && context.field === S.fields[S.i]
    && context.lang === S.lang && context.ptt === (S.earsPttGeneration || 0)
    && context.wake === S.awaitQContext && app.dataset.talk === 'thinking';
  S.lastQ = q;
  app.dataset.talk = 'thinking';
  showHeard(q);
  setCue('think');
  if (localAnswer(q)) return;
  // Practice mode has no model key, so the drawn form answers "where is…" itself.
  const hit = S.sim && S.mode !== 'start' && S.sim.find(q, S.lang);
  if (hit) {
    if (!current()) return;
    talkDone();
    return act({ action: 'find', ...hit });
  }
  try {
    const out = await api('/api/ask', {
      question: q,
      image: S.mode === 'start' ? undefined : snapshot(),
      fields: S.fields.map(({ label, kind, done, answer: a }) => ({ label, kind, done, answer: a })),
      current: S.i,
      mode: S.mode,
      lang: S.lang,
    });
    if (!current()) return; // a newer question or changed interaction owns the UI now
    talkDone();
    act(out);
  } catch (e) {
    if (!current()) return;
    talkDone();
    if (S.sim && /Form reading is off/.test(e.message)) say(t().offline);
    else speakErr(e);
  }
}

// Plain commands answer instantly, with no model call.
function localAnswer(q) {
  const s = q.toLowerCase().trim().replace(/[.!?¿¡]+/g, '');
  const f = S.fields[S.i];
  const run = fn => { talkDone(); fn(); return true; };
  if (/^(i'?m )?(done|finished)$|^next$|^listo$|^terminé$/.test(s) && S.mode === 'write') return run(finishWriting);
  if (/^(yes|keep( it)?|done|ok(ay)?|correct|sí|listo|हाँ|好|对)$/.test(s) && S.mode === 'confirm') return run(keep);
  if (/^(redo|no|wrong|that'?s wrong|rehacer|no es correcto|दोबारा लिखो|重写)$/.test(s) && S.mode === 'confirm') return run(redo);
  if (/^(repeat|again|say (that|it) again|repite|otra vez)$/.test(s)) return run(repeat);
  if (/^(skip|skip (this|it|this one)|saltar)$/.test(s)) return run(skip);
  if (/^(go )?back$|^previous( one)?$|^anterior$/.test(s)) return run(back);
  if (/^(cancel|never ?mind|stop|forget it|cancelar|olvídalo|रहने दो|算了|取消)$/.test(s) && S.mode === 'find') return run(() => abortFind(t().cancelled));
  if (/how many (are )?(left|more)|cuántos faltan/.test(s) && S.fields.length) return run(() => say(t().left(S.fields.filter(x => !x.done).length)));
  if (/where am i|which (field|one)|what field|dónde estoy/.test(s) && f) return run(() => say(t().here(f.label)));
  return false;
}

function act(out) {
  switch (out.action) {
    case 'done': if (S.mode === 'write') return finishWriting(); break;
    case 'skip': if (S.mode === 'find' || S.mode === 'guide' || S.mode === 'write') return skip(); break;
    case 'back': return back();
    case 'goto': if (out.field >= 0 && out.field < S.fields.length) return goTo(out.field); break;
    case 'repeat': return repeat();
    case 'reread': return again();
    case 'find': if (out.box) return goFind(out); break;
    case 'language':
      setLang(out.lang);
      // Re-read the page so the field names come back in the new language. The parse prompt skips
      // blanks that are already filled in, so only what is left gets listed.
      if (S.fields.length && !S.fields.some(f => f.done) && ['idle', 'guide'].includes(S.mode)) return say(out.say).then(readForm);
      break;
  }
  return say(out.say);
}

// ---------- the handwriting card ----------
const readback = {
  timer: 0,
  typing: [],
  stopTyping() { this.typing.forEach(clearTimeout); this.typing = []; },
  show(image, label) {
    clearTimeout(this.timer);
    this.stopTyping();
    $('rbImg').src = image;
    $('rbLabel').textContent = label;
    $('rbText').textContent = '';
    $('readback').dataset.state = 'reading';
    $('readback').hidden = false;
  },
  result(text, legible) {
    const el = $('rbText');
    $('readback').dataset.state = text ? (legible ? 'ok' : 'unsure') : 'empty';
    this.stopTyping();
    el.textContent = '';
    if (!text) { el.textContent = 'Nothing written yet'; return; }
    this.typing = [...text].map((ch, k) => setTimeout(() => { el.textContent += ch; }, k * 28));
  },
  hide(after = 0) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.stopTyping(); $('readback').hidden = true; }, after);
  },
};

// ---------- UI ----------
function setMode(m) {
  S.mode = m;
  app.dataset.mode = m;
  const btn = $('action');
  btn.textContent = ACTION[m];
  btn.disabled = m === 'reading' || m === 'reveal' || m === 'check';
  if (m === 'reading' || m === 'reveal' || m === 'check') setCue('wait');
  if (m === 'write') setCue('write');
  if (m === 'confirm') setCue('confirm');
  if (m === 'idle') setCue('');
}

function setCue(c) {
  if (c === S.cue) return;
  S.cue = c;
  $('cue').dataset.cue = c;
  app.dataset.cue = c || '';
  $('cueGlyph').textContent = CUE[c] || { on: '●', write: '✎', done: '✓', error: '!', confirm: '?' }[c] || '';
  $('cueWord').textContent = CUE[c] ? voice.cueWord(c, false) : { on: 'here', write: 'write', done: 'done', listen: 'listening', think: 'thinking', error: 'retry', confirm: 'keep?' }[c] || '';
}

function renderLists() {
  renderSessionContext();
  const state = (f, k) => (f.skipped ? 'skipped' : f.done && (f.review || f.stale) ? 'review' : f.done ? 'done' : k === S.i && ['guide', 'write', 'check', 'confirm'].includes(S.mode) ? 'active' : 'todo');
  const prev = S.prevStates || [];
  S.prevStates = S.fields.map((f, k) => state(f, k));
  const just = (li, k) => {
    if (prev[k] !== undefined && prev[k] !== li.dataset.state) li.dataset.just = li.dataset.state;
    else if (prev.length && prev[k] === undefined) li.dataset.just = 'new';
  };
  $('progress').replaceChildren(...S.fields.map((f, k) => {
    const li = document.createElement('li');
    li.dataset.state = state(f, k);
    just(li, k);
    li.title = `${k + 1}. ${f.label}`;
    return li;
  }));
  const doneCount = S.fields.filter(f => f.done && !f.skipped).length;
  app.style.setProperty('--p', S.fields.length ? doneCount / S.fields.length : 0);
  const kept = ({ en: 'kept', es: 'guardados', hi: 'रखे', zh: '已保留' })[S.lang] || 'kept';
  $('count').innerHTML = S.fields.length ? `<b>${doneCount}</b> / ${S.fields.length} ${kept}` : ''; // numbers + fixed UI strings only

  $('panelTitle').textContent = S.title || (S.mode === 'reading' ? 'Reading the page…' : 'No form yet');
  const n = S.fields.length, meta = $('panelMeta'), seek = $('panelFind');
  meta.hidden = !(n || S.title) || S.mode === 'reading';
  meta.textContent = n ? `${n} ${n === 1 ? 'place' : 'places'} · read in ${(S.readSecs ?? 0).toFixed(1)} s` : 'Nothing to fill · ask where anything is';
  seek.hidden = S.mode !== 'find';
  seek.textContent = S.mode === 'find' ? (S.find?.q ? `“${S.find.q}”` : 'it on the page') : '';
  $('fieldList').replaceChildren(...S.fields.map((f, k) => {
    const li = document.createElement('li');
    li.dataset.state = state(f, k);
    if (f.review || f.stale) li.dataset.flag = 'review';
    else if (f.added) li.dataset.flag = 'added';
    if (li.dataset.state === 'active') li.setAttribute('aria-current', 'step');
    just(li, k);
    if (S.mode === 'reveal') li.style.animationDelay = `${Math.round(f.revealAt - S.revealStart)}ms`;
    else if (!li.dataset.just) li.style.animation = 'none';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = f.review || f.stale ? '?' : f.done && !f.skipped ? '✓' : k + 1;
    const body = document.createElement('div');
    body.className = 'f-body';
    const label = document.createElement('span');
    label.className = 'f-label';
    label.textContent = f.label;
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = `, ${f.stale ? 'location needs checking' : f.review ? 'check this' : f.added ? 'caught by the final check' : li.dataset.state}`;
    label.append(sr);
    const kind = document.createElement('span');
    kind.className = 'f-kind';
    kind.textContent = f.skipped ? 'Skipped' : f.stale ? 'Location needs checking' : f.review ? 'Check this' : f.added ? 'Final check' : KIND[f.kind] || 'Write';
    body.append(label, kind);
    if (f.answer) {
      const a = document.createElement('span');
      a.className = 'f-answer';
      a.textContent = f.answer;
      body.append(a);
    } else if (f.hint && li.dataset.state === 'active') {
      const h = document.createElement('span');
      h.className = 'f-hint';
      h.textContent = f.hint;
      body.append(h);
    }
    li.append(n, body);
    return li;
  }));
  $('fieldList').querySelector('[data-state="active"]')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  const foot = $('panelFoot');
  if (S.mode === 'done') {
    const filled = S.fields.filter(f => f.done && !f.skipped).length;
    const caught = S.fields.filter(f => f.added).length, look = S.fields.filter(f => f.review || f.stale || f.skipped || !f.done).length;
    const clean = !look && !S.reviewFailed;
    const cell = (k, v, warn) => `<div${warn ? ' class="warn"' : ''}><dt>${k}</dt><dd>${v}</dd></div>`;
    // Numbers and fixed English only: nothing from the page or the model goes into this HTML.
    foot.innerHTML = `<p class="ft-kicker">${clean ? 'Answers kept' : 'Review before you finish'}</p><strong class="ft-time">${S.elapsed}</strong><span class="ft-unit">start to finish</span><dl class="ft-grid">`
      + cell('Answers kept', `${filled}<small>/${S.fields.length}</small>`)
      + cell('Read the page in', `${(S.readSecs ?? 0).toFixed(1)}<small> s</small>`)
      + cell('Final check caught', S.reviewFailed ? '–' : caught)
      + cell('Needs another look', look, look > 0 || S.reviewFailed) + '</dl>'
      + (S.reviewFailed ? '<p class="ft-note">The final page check did not finish. Review the paper before using it.</p>' : '');
    foot.toggleAttribute('data-open', !clean);
    foot.hidden = false;
  } else foot.hidden = true;
}

// Context remains visible on a phone, where the full field list is hidden. These are
// presentation labels only: they never verify coordinates, accept an answer or steer.
function renderSessionContext() {
  const mode = $('sessionMode'), status = $('sessionState'), field = $('currentField');
  if (!mode || !status || !field) return;
  const update = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const english = { practice: 'Practice', live: 'Live camera', ready: 'Ready', reading: 'Reading the page', reveal: 'Places found', checkin: 'Find your fingertip', guide: 'Follow the directions', find: 'Find on the page', write: 'Your turn to write', check: 'Reading your writing', confirm: 'Check the readback', done: 'Review your answers', listening: 'Listening', thinking: 'Thinking', paused: 'Guidance paused' };
  const copy = ({
    en: english,
    es: { practice: 'Práctica', live: 'Cámara en vivo', ready: 'Listo', reading: 'Leyendo la página', reveal: 'Lugares encontrados', checkin: 'Buscando tu dedo', guide: 'Sigue las indicaciones', find: 'Busca en la página', write: 'Es tu turno de escribir', check: 'Leyendo lo escrito', confirm: 'Comprueba la lectura', done: 'Revisa tus respuestas', listening: 'Escuchando', thinking: 'Pensando', paused: 'Guía en pausa' },
    hi: { practice: 'अभ्यास', live: 'लाइव कैमरा', ready: 'तैयार', reading: 'पन्ना पढ़ रहा हूँ', reveal: 'जगहें मिल गईं', checkin: 'उंगली खोज रहा हूँ', guide: 'निर्देशों का पालन करें', find: 'पन्ने पर खोजें', write: 'अब आप लिखें', check: 'आपका लिखा पढ़ रहा हूँ', confirm: 'पढ़ा हुआ जाँचें', done: 'अपने उत्तर जाँचें', listening: 'सुन रहा हूँ', thinking: 'सोच रहा हूँ', paused: 'मार्गदर्शन रुका हुआ है' },
    zh: { practice: '练习', live: '实时相机', ready: '准备就绪', reading: '正在阅读页面', reveal: '已找到填写位置', checkin: '正在寻找指尖', guide: '请按指示移动', find: '在页面上查找', write: '请开始书写', check: '正在读取手写内容', confirm: '请核对识别结果', done: '检查你的答案', listening: '正在聆听', thinking: '正在思考', paused: '引导已暂停' },
  })[S.lang] || english;
  update(mode, S.sim ? copy.practice : copy.live);
  mode.dataset.kind = S.sim ? 'practice' : 'live';
  update(status, copy[app.dataset.talk || S.mode] || copy.ready);
  const active = ['guide', 'write', 'check', 'confirm'].includes(S.mode) && S.fields[S.i];
  const found = S.mode === 'find' && S.find;
  field.hidden = !active && !found;
  update(field, active ? `${S.i + 1}. ${active.label}` : found ? (found.q || found.label || '') : '');
  field.title = field.textContent;
  app.toggleAttribute('data-field-active', !field.hidden);
}

// The judges' readout: is the hand really tracked, and how fast is the AI answering?
function hud(now) {
  renderSessionContext();
  if (!S.sim && ambientVideo.srcObject !== video.srcObject) { ambientVideo.srcObject = video.srcObject; ambientVideo.play().catch(() => {}); }
  const secs = (now - (S.hudAt || now)) / 1000 || 1;
  S.fps = Math.round((S.trackN || 0) / secs);
  S.trackN = 0;
  S.hudAt = now;
  const hands = now - (S.handAt || 0) < 500 ? S.handPts.length : 0;
  const row = (k, v, ok = true) => `<span>${k}</span><b${ok ? '' : ' class="warn"'}>${v}</b>`;
  const lock = S.fields.length ? row('Page lock', !S.driftOn ? 'off' : drift.verified ? 'locked' : 'checking', !S.driftOn || drift.verified) : '';
  const ai = S.lastApi ? row('Last AI call', `${S.lastApi.job} · ${S.lastApi.secs.toFixed(1)} s`) : '';
  $('panelHud').innerHTML = S.sim ? row('Mode', 'Practice') + row('Fingertip', 'your pointer') + lock + ai
    : row('Hand tracking', `${S.fps} fps`, S.fps >= 15) + row('Hands in view', hands || 'none', !!hands)
      + (S.pointerLabel ? row('Pointing hand', 'locked') : '') + lock + ai
      + row('Ears ("Nib")', S.ears ? 'listening' : S.earsErr ? `off (${S.earsErr})` : 'off', !!S.ears);
}

function status(text) { $('status').textContent = text; }

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop(now) {
  requestAnimationFrame(loop);
  resize();
  if (S.sim && S.pointer) setTip(S.pointer.x, S.pointer.y, now);
  trackHands(now);
  if ((S.mode === 'guide' || S.mode === 'find') && !app.dataset.talk) guide(now); // guidance pauses while you talk
  else if (S.mode === 'checkin' && !app.dataset.talk) checkinTick(now);
  else if (S.mode === 'write' && !S.sim) keepLine(now);
  else S.prox = 1;
  $('cue').style.setProperty('--close', S.mode === 'guide' || S.mode === 'find' ? (1 - S.prox).toFixed(2) : 0);
  tickWords(now);
  if (now - (S.hudAt || 0) > 1000) hud(now);
  render(ctx, S, source(), now);
}

// Practice mode: the pointer is the fingertip. A resting pointer is a resting finger, so it stays tracked.
canvas.addEventListener('pointermove', e => {
  if (!S.sim || !S.fit) return;
  const r = canvas.getBoundingClientRect(), { s, ox, oy, w, h } = S.fit;
  const x = (e.clientX - r.left - ox) / (w * s), y = (e.clientY - r.top - oy) / (h * s);
  S.pointer = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
});
canvas.addEventListener('pointerleave', () => { S.pointer = null; });

// With the camera, the whole picture is the button, for people who can't find one:
// tap = the main action, press and hold = ask a question.
const press = { timer: 0, talking: false };
$('stage').addEventListener('pointerdown', e => {
  if (S.sim || S.mode === 'start' || e.target.closest?.('button, a, select, aside, figure')) return;
  press.timer = setTimeout(() => { press.timer = 0; press.talking = true; talkStart(); }, 350);
});
addEventListener('pointerup', e => {
  if (press.talking) { press.talking = false; talkEnd(); }
  else if (press.timer) { clearTimeout(press.timer); press.timer = 0; if (e.target.closest?.('#stage')) primary(); }
});
addEventListener('pointercancel', () => {
  if (press.talking) { press.talking = false; talkEnd(); }
  clearTimeout(press.timer);
  press.timer = 0;
});
$('stage').addEventListener('contextmenu', e => e.preventDefault()); // long-press must not open a menu

// The Ask button: hold to talk, or tap once to start and once to stop.
const ask = { downAt: 0, endOnUp: false };
$('talk').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (talk.live) { ask.endOnUp = true; return; }
  ask.downAt = performance.now();
  talkStart();
});
$('talk').addEventListener('pointerup', () => {
  if (!talk.live) return;
  if (ask.endOnUp || performance.now() - ask.downAt > 450) { ask.endOnUp = false; talkEnd(); }
});
$('talk').addEventListener('click', e => { if (e.detail === 0) (talk.live ? talkEnd() : talkStart()); }); // keyboard

$('startBtn').addEventListener('click', begin);
$('rbRedo').addEventListener('click', redo);
$('action').addEventListener('click', primary);

for (const b of document.querySelectorAll('[data-lang]')) {
  b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang));
  b.addEventListener('click', () => setLang(b.dataset.lang));
}

// Keys: Space tap = main action, Space hold = ask. Enter = main action. R repeat, S skip, M mute beeps.
const space = { timer: 0, held: false };
addEventListener('keydown', e => {
  if (e.target.closest?.('button, a, select, input')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    if (e.repeat || space.timer || space.held) return;
    space.timer = setTimeout(() => { space.timer = 0; space.held = true; talkStart(); }, 280);
  } else if (k === 'enter') { e.preventDefault(); primary(); }
  else if (k === 'r') repeat();
  else if (k === 's') skip();
  else if (k === 'm') voice.muted = !voice.muted;
});
addEventListener('keyup', e => {
  if (e.key !== ' ') return;
  if (space.held) { space.held = false; talkEnd(); }
  else if (space.timer) { clearTimeout(space.timer); space.timer = 0; if (!e.target.closest?.('button, a, select, input')) primary(); }
});

// Which model reads the form, so nobody demos with reading switched off by accident.
const offline = () => { $('reader').textContent = 'Form reader offline · practice mode still works'; app.dataset.reader = 'off'; };
fetch('/api/status').then(r => r.json()).then(s => {
  if (!s.reader) return offline();
  $('reader').textContent = `Form reader: ${s.reader}`;
  app.dataset.reader = 'on';
}).catch(offline);

if (matchMedia('(pointer: coarse)').matches) {
  document.querySelector('.lede').textContent = document.querySelector('.lede').textContent.replace(' or the Space key', '');
}
window.nib = S; // lets you poke at state from the console, at the venue too
window.nibAsk = answer; // and type a question as if it were spoken (a fallback when the room is too loud)
// The backdrop: the same live page, blurred behind the glass (CSS does the blur on the GPU).
const ambientVideo = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
ambientVideo.setAttribute('playsinline', '');
$('ambient').append(S.sim ? S.sim.canvas : ambientVideo);
if (S.sim) {
  if (new URLSearchParams(location.search).has('bot')) import('./bot.js').then(m => m.startBot(S)); // robot finger test
  app.dataset.sim = '';
  status(matchMedia('(pointer: coarse)').matches ? 'Practice mode: drag your finger across the picture. Use the yellow button when you finish writing.' : 'Practice mode: your pointer is the fingertip. Tap Space when you finish writing; hold Space to ask.');
  $('modeLink').href = 'paper.html'; // Paper lives at paper.html now; ./ is the home hub
  $('modeLink').textContent = 'Use the camera instead';
} else {
  loadHands();
  listCameras(); // a laptop with a saved camera permission and a USB webcam shows the picker before Start
  if (!navigator.mediaDevices?.getUserMedia) status('This browser cannot open the camera. Use Chrome or Safari over https.');
}
setLang(S.lang);
setMode('start');
renderLists();
requestAnimationFrame(loop);
// Opened by voice ("Hey Nib, open Trace") there is no tap: start like Around me when iPhone allows sound.
(async () => {
  if (S.sim || new URLSearchParams(location.search).has('bot')) return;
  try {
    const mic = await voice.autoUnlock(MIC);
    if (!mic) return;
    try { if (S.mode === 'start') await begin(); } finally { mic.getTracks().forEach(t => t.stop()); }
  } catch { /* no permission yet: the start screen stays */ }
})();
