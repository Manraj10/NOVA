// Practice mode: a drawn clinic form stands in for the camera, and the mouse stands in for a fingertip.
// Also the stage fallback if the venue camera or Wi-Fi dies.

const W = 1280, H = 960;
const INK = '#24408E';

// Positions are fractions of the paper. y is the baseline of the blank line.
const FORM = [
  { label: 'Full name', kind: 'text', at: [0.08, 0.215], line: [0.33, 0.92], answer: 'Alex Kim',
    say: { en: 'Write your full name.', es: 'Escribe tu nombre completo.' } },
  { label: 'Date of birth', kind: 'date', at: [0.08, 0.285], line: [0.33, 0.62], answer: '04/12/2004',
    say: { en: 'Write your date of birth: month, day, year.', es: 'Escribe tu fecha de nacimiento: mes, día y año.' } },
  { label: 'Phone number', kind: 'number', at: [0.08, 0.355], line: [0.33, 0.72], answer: '412-555-0187',
    say: { en: 'Write your phone number.', es: 'Escribe tu número de teléfono.' } },
  { label: 'Home address', kind: 'text', at: [0.08, 0.425], line: [0.33, 0.92], answer: '5000 Forbes Ave, Pittsburgh',
    say: { en: 'Write your home address.', es: 'Escribe tu dirección.' } },
  { label: 'Privacy notice', kind: 'checkbox', box: [0.08, 0.475], answer: 'checked',
    say: { en: 'Put a check in this box to say you read the privacy notice.', es: 'Marca esta casilla para decir que leíste el aviso de privacidad.' } },
  // hidden: the first read "misses" it, so the final check has something real to catch.
  { label: 'Initials', kind: 'text', at: [0.08, 0.745], line: [0.2, 0.42], answer: 'AK', hidden: true,
    say: { en: 'Write your initials to agree to the consent above.', es: 'Escribe tus iniciales para aceptar el consentimiento.' } },
  { label: 'Signature', kind: 'signature', at: [0.08, 0.80], line: [0.33, 0.78], answer: 'Alex Kim',
    say: { en: 'Sign your name along the line.', es: 'Firma a lo largo de la línea.' } },
  { label: 'Date', kind: 'date', at: [0.08, 0.87], line: [0.33, 0.56], answer: '11/07/2026',
    say: { en: "Write today's date.", es: 'Escribe la fecha de hoy.' } },
];

const LABELS_ES = { 'Full name': 'Nombre completo', 'Date of birth': 'Fecha de nacimiento', 'Phone number': 'Teléfono', 'Home address': 'Dirección', 'Privacy notice': 'Aviso de privacidad', Signature: 'Firma', Date: 'Fecha', Initials: 'Iniciales' };

export function makeSim() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const ph = H * 0.94, pw = ph * 8.5 / 11;
  let px = (W - pw) / 2, py = (H - ph) / 2;
  const X = f => px + f * pw, Y = f => py + f * ph;
  const fonts = Promise.all(['600 40px Caveat', '400 20px Arial'].map(f => document.fonts.load(f).catch(() => {})));
  const written = new Set();

  function boxOf(f) {
    if (f.kind === 'checkbox') {
      const s = 0.034 * pw;
      return { x0: X(f.box[0]) / W, y0: (Y(f.box[1]) - s) / H, x1: (X(f.box[0]) + s) / W, y1: Y(f.box[1]) / H };
    }
    return { x0: X(f.line[0]) / W, y0: (Y(f.at[1]) - 0.042 * ph) / H, x1: X(f.line[1]) / W, y1: (Y(f.at[1]) + 0.006 * ph) / H };
  }

  function paint() {
    // table
    g.fillStyle = '#3a3330';
    g.fillRect(0, 0, W, H);
    // paper with a soft shadow
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = 30;
    g.shadowOffsetY = 10;
    g.fillStyle = '#fbfaf6';
    g.fillRect(px, py, pw, ph);
    g.restore();

    g.fillStyle = '#1d1d1f';
    g.font = `700 ${0.034 * ph}px Arial, sans-serif`;
    g.fillText('Allegheny Family Clinic', X(0.08), Y(0.085));
    g.font = `400 ${0.02 * ph}px Arial, sans-serif`;
    g.fillStyle = '#444';
    g.fillText('New patient form  ·  Please print clearly', X(0.08), Y(0.118));
    g.fillStyle = '#1d1d1f';
    g.fillRect(X(0.08), Y(0.135), 0.84 * pw, 2);

    g.font = `400 ${0.019 * ph}px Arial, sans-serif`;
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 1.5;
    for (const f of FORM) {
      if (f.kind === 'checkbox') {
        const s = 0.034 * pw;
        g.strokeRect(X(f.box[0]), Y(f.box[1]) - s, s, s);
        g.fillStyle = '#1d1d1f';
        g.fillText('I have read the Notice of Privacy Practices.', X(f.box[0]) + s + 12, Y(f.box[1]) - s * 0.25);
        continue;
      }
      g.fillStyle = '#1d1d1f';
      g.fillText(f.label, X(f.at[0]), Y(f.at[1]));
      g.beginPath();
      g.moveTo(X(f.line[0]), Y(f.at[1]));
      g.lineTo(X(f.line[1]), Y(f.at[1]));
      g.stroke();
    }

    // consent paragraph, so the page reads like a real form
    g.fillStyle = '#555';
    g.font = `700 ${0.019 * ph}px Arial, sans-serif`;
    g.fillText('Consent to treatment', X(0.08), Y(0.56));
    g.font = `400 ${0.0165 * ph}px Arial, sans-serif`;
    const para = [
      'I agree to examination and treatment by the providers of Allegheny Family',
      'Clinic. I understand I may ask questions about my care at any time, and that',
      'I may refuse any treatment. I authorize the clinic to bill my insurance and',
      'I accept responsibility for charges my insurance does not cover.',
    ];
    para.forEach((l, i) => g.fillText(l, X(0.08), Y(0.595 + i * 0.03)));

    // office-use box: should be ignored
    g.strokeStyle = '#999';
    g.setLineDash([4, 4]);
    g.strokeRect(X(0.62), Y(0.905), 0.3 * pw, 0.06 * ph);
    g.setLineDash([]);
    g.fillStyle = '#999';
    g.font = `400 ${0.014 * ph}px Arial, sans-serif`;
    g.fillText('OFFICE USE ONLY', X(0.64), Y(0.93));

    for (const f of FORM) if (written.has(f.label)) ink(f);
  }

  function ink(f) {
    g.save();
    g.fillStyle = INK;
    g.strokeStyle = INK;
    if (f.kind === 'checkbox') {
      const s = 0.034 * pw, x = X(f.box[0]), y = Y(f.box[1]) - s;
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + s * 0.18, y + s * 0.55);
      g.lineTo(x + s * 0.42, y + s * 0.82);
      g.lineTo(x + s * 0.86, y + s * 0.12);
      g.stroke();
    } else {
      const sig = f.kind === 'signature';
      g.font = `600 ${(sig ? 0.05 : 0.036) * ph}px Caveat, cursive`;
      g.translate(X(f.line[0]) + 0.012 * pw, Y(f.at[1]) - 0.008 * ph);
      if (sig) g.transform(1, 0, -0.25, 1, 0, 0);
      g.fillText(f.answer, 0, 0);
    }
    g.restore();
  }

  fonts.then(paint);
  paint();

  const asField = (f, es) => ({ label: es ? LABELS_ES[f.label] : f.label, kind: f.kind, say: f.say[es ? 'es' : 'en'], hint: '', ...boxOf(f), _key: f.label });
  const region = (x0, y0, x1, y1) => ({ x0: X(x0) / W, y0: Y(y0) / H, x1: X(x1) / W, y1: Y(y1) / H });
  const field = l => boxOf(FORM.find(f => f.label === l));
  // "Where is…" answers for the drawn form: [question words, box, English, Spanish].
  const SPOTS = [
    [/sign|firma/, () => field('Signature'), 'This is the signature line, near the bottom.', 'Esta es la línea para firmar, cerca del final.'],
    [/birth|nacimiento/, () => field('Date of birth'), 'This is where your date of birth goes.', 'Aquí va tu fecha de nacimiento.'],
    [/phone|tel[eé]fono/, () => field('Phone number'), 'This is the phone number line.', 'Esta es la línea del teléfono.'],
    [/address|direcci/, () => field('Home address'), 'This is the home address line.', 'Esta es la línea de la dirección.'],
    [/privacy|notice|check ?box|privacidad|casilla/, () => field('Privacy notice'), 'This is the privacy notice check box.', 'Esta es la casilla del aviso de privacidad.'],
    [/initial|iniciales/, () => field('Initials'), 'This is the initials line, under the consent paragraph.', 'Esta es la línea de las iniciales, debajo del consentimiento.'],
    [/consent|treatment|agree|consentimiento|tratamiento/, () => region(0.08, 0.535, 0.92, 0.695), "This is the consent to treatment. It says you agree to examination and treatment, you may refuse any treatment, and you accept charges your insurance doesn't cover.", 'Este es el consentimiento: aceptas examen y tratamiento, puedes rechazar cualquier tratamiento y aceptas los cargos que tu seguro no cubra.'],
    [/office|oficina/, () => region(0.62, 0.905, 0.92, 0.965), "This is the office use box. It's for clinic staff, so leave it empty.", 'Este es el recuadro de uso de oficina. Es para el personal, así que déjalo vacío.'],
    [/clinic|title|top|cl[ií]nica|t[ií]tulo/, () => region(0.08, 0.045, 0.62, 0.125), 'This is the top of the page: Allegheny Family Clinic, new patient form.', 'Arriba dice: Allegheny Family Clinic, formulario de paciente nuevo.'],
    [/date|fecha/, () => field('Date'), "This is today's date line, next to the signature.", 'Esta es la línea de la fecha de hoy.'],
  ];

  return {
    canvas,
    async parse(lang) {
      await new Promise(r => setTimeout(r, 1500)); // the real reader takes a moment too
      const es = lang === 'es';
      return {
        title: es ? 'Formulario de paciente nuevo, Allegheny Family Clinic' : 'Allegheny Family Clinic, new patient form',
        fields: FORM.filter(f => !f.hidden).map(f => asField(f, es)),
      };
    },
    write(field) {
      written.add(field._key);
      paint();
    },
    read(field, lang) {
      const f = FORM.find(x => x.label === field._key);
      const es = lang === 'es';
      if (f.kind === 'checkbox') return { text: 'checked', legible: true, spoken: es ? 'La casilla está marcada.' : 'The box is checked.' };
      return { text: f.answer, legible: true, spoken: es ? `Escribiste ${f.answer}.` : `You wrote ${f.answer}.` };
    },
    review(lang) {
      const es = lang === 'es';
      return { summary: '', missing: FORM.filter(f => f.hidden && !written.has(f.label)).map(f => asField(f, es)) };
    },
    find(q, lang) {
      const s = q.toLowerCase();
      if (!/where|find|show me|point|take me|d[oó]nde|busca|mu[eé]strame/.test(s)) return null;
      const spot = SPOTS.find(([re]) => re.test(s));
      return spot && { label: '', box: spot[1](), say: spot[lang === 'es' ? 3 : 2] };
    },
    reset() {
      written.clear();
      px = (W - pw) / 2;
      py = (H - ph) / 2;
      paint();
    },
    // Moves the paper by a fraction of the frame, like a pen pushing a real page.
    nudge(dx, dy) {
      px += dx * W;
      py += dy * H;
      paint();
    },
  };
}
