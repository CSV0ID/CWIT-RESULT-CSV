const fs = require('fs');
const path = require('path');
const https = require('https');

const DEPT_MAP = {
  civil: 'Civil Engineering', electrical: 'Electrical Engineering',
  mechanical: 'Mechanical Engineering', etc: 'Electronics & Telecommunication Engineering',
  comp: 'Computer Engineering', comp_iot: 'Computer Engineering & IoT',
};

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(msg) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN || !CHAT_ID) return resolve();
    const data = JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true });
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(opts, () => resolve());
    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

function formatTg(student, type, email, fp, ip) {
  const label = `S26 ${type === 'backlog' ? 'Backlog' : 'Regular'} (CSV)`;
  const tag = email ? '📧 Contact Request' : '🔍 Checked';
  let msg = `<b>${tag} — ${label}</b>\n`;
  msg += `Dept: ${student.dept}\nRoll: <code>${student.roll}</code>\nName: ${student.name || '?'}\n`;
  msg += `SGPA: ${student.sgpa || '-'}\n`;
  for (const s of student.subjects) {
    if (type === 'backlog') {
      msg += `  • ${s.name}: ${s.th || '-'} ${s.thPass || '?'} · ${s.total} ${s.pct}% ${s.status}\n`;
    } else {
      msg += `  • ${s.name}: TH ${s.faTh}/${s.saTh}/${s.thObt}/${s.thMax} ${s.thPass} · PR ${s.faPr}/${s.saPr} · SLA ${s.sla} · ${s.totalObt}/${s.totalMax} ${s.totalPct}% ${s.status}\n`;
    }
  }
  if (email) msg += `\n📧 Contact: ${email}`;
  msg += `\n🧾 FP: <code>${fp || '?'}</code>\nIP: ${ip || '?'}`;
  return msg;
}

function parseCSV(text) {
  const lines = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === '\n' && !inQuotes) { lines.push(current); current = ''; continue; }
    current += ch;
  }
  if (current) lines.push(current);
  if (!lines.length) return [];
  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length === headers.length) {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = vals[idx]; });
      rows.push(obj);
    }
  }
  return rows;
}

function parseLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const type = req.query.type || 'regular';
  const dept = req.query.dept || '';
  const roll = (req.query.roll || '').trim();
  const email = req.query.email || '';
  const fingerprint = req.query.fp || '?';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';

  if (!roll) return res.status(400).json({ error: 'Missing roll parameter' });
  if (!dept) return res.status(400).json({ error: 'Missing dept parameter' });

  const deptName = DEPT_MAP[dept];
  if (!deptName) return res.status(400).json({ error: 'Invalid department' });

  const csvFile = type === 'backlog'
    ? path.join(__dirname, '..', 'cwit_s26_backlog_results.csv')
    : path.join(__dirname, '..', 'cwit_s26_regular_published.csv');

  try {
    const text = fs.readFileSync(csvFile, 'utf-8');
    const rows = parseCSV(text);
    const matches = rows.filter(r => r.RollNumber === roll && r.Department === deptName);

    if (!matches.length) {
      return res.status(200).json({ found: false, student: null, dept: deptName });
    }

    const student = matches[0];
    const subjects = [];
    for (let i = 1; i <= 9; i++) {
      const prefix = 'S' + i;
      const name = student[prefix + '_Name'];
      if (!name) continue;
      if (type === 'backlog') {
        subjects.push({
          name, code: student[prefix + '_Code'] || '',
          th: student[prefix + '_TH'] || '', thPass: student[prefix + '_TH-Pass'] || '',
          total: student[prefix + '_Total'] || '', pct: student[prefix + '_Pct'] || '',
          status: student[prefix + '_Status'] || '', cr: student[prefix + '_CR'] || '',
          practicals: student[prefix + '_Practicals'] || '',
        });
      } else {
        subjects.push({
          name, code: student[prefix + '_Code'] || '',
          faTh: student[prefix + '_FA-TH'] || '', saTh: student[prefix + '_SA-TH'] || '',
          thObt: student[prefix + '_TH-OBT'] || '', thMax: student[prefix + '_TH-MAX'] || '',
          thPct: student[prefix + '_TH-PCT'] || '',
          faPr: student[prefix + '_FA-PR'] || '', saPr: student[prefix + '_SA-PR'] || '',
          sla: student[prefix + '_SLA'] || '',
          totalObt: student[prefix + '_TOTAL-OBT'] || '', totalMax: student[prefix + '_TOTAL-MAX'] || '',
          totalPct: student[prefix + '_TOTAL-PCT'] || '',
          thPass: student[prefix + '_TH-Pass'] || '',
          status: student[prefix + '_STATUS'] || '', cr: student[prefix + '_CR'] || '',
        });
      }
    }

    const result = {
      found: true,
      dept: student.Department,
      roll: student.RollNumber,
      name: student.StudentName || student.studentName || '',
      year: student.Year || '',
      semester: student.Semester || student.Exam || '',
      sgpa: student.SGPA || '',
      resultStatus: student.resultStatus || student.ResultStatus || '',
      subjects,
    };

    {
      const tgMsg = formatTg(result, type, email, fingerprint, ip);
      await sendTelegram(tgMsg);
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
