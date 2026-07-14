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

function parseLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'; i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '"'; i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current); current = '';
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = [];
  let mismatchCount = 0;
  let sampleHeaderLen = headers.length;
  let sampleValsLen = 0;
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (i === 1) sampleValsLen = vals.length;
    if (vals.length && vals.length === headers.length) {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = vals[idx]; });
      rows.push(obj);
    } else {
      mismatchCount++;
      if (mismatchCount <= 1) {
        sampleHeaderLen = headers.length;
        sampleValsLen = vals.length;
      }
    }
  }
  return { headers, rows, totalLines: lines.length - 1, mismatchCount, sampleHeaderLen, sampleValsLen };
}

function parseRawSubjects(rawJson) {
  const data = JSON.parse(rawJson || '{}');
  const subjects = [];
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (typeof v === 'object' && v.subjectName) {
      const cols = {};
      for (const ck of Object.keys(v)) {
        if (ck.startsWith('col_')) cols[ck] = v[ck];
      }
      const vals = Object.values(cols);
      const s = { name: v.subjectName || '', code: v.courseCode || '', credits: v.courseCredits || '' };

      if (vals[0] && /^\d+$/.test(vals[0]) && parseInt(vals[0]) >= 25) {
        if (vals[0] === '70' && vals[1] === '30' && vals[2] !== '100' && vals[3] === '100') {
          s.faTh = `${vals[5] || '-'}/${vals[1]}`;
          s.saTh = `${vals[4] || '-'}/${vals[0]}`;
          const thObt = (parseInt(vals[4]) || 0) + (parseInt(vals[5]) || 0);
          s.th = `${thObt}/${vals[3]}`;
        } else {
          s.saTh = `${vals[3] || '-'}/${vals[0]}`;
          s.faTh = `${vals[4] || '-'}/${vals[1]}`;
          s.th = `${vals[5] || '-'}/${vals[2]}`;
        }
      }

      const compLabels = ['faPr', 'saPr', 'sla'];
      let ci = 0;
      let i = (s.faTh ? 6 : 0);
      while (i < vals.length - 2 && ci < 3) {
        const vv = vals[i];
        if (vv === '' || !/^\d+$/.test(vv)) { i++; continue; }
        const nv = parseInt(vv);
        if (nv === 25 || nv === 50) {
          s[compLabels[ci]] = `${vals[i+2] || '-'}/${vv}`;
          i += 3; ci++;
        } else { break; }
      }

      const remaining = vals.slice(i);
      let cr = null;
      const passFail = [];
      for (let j = remaining.length - 1; j >= 0; j--) {
        const rv = remaining[j];
        if (rv === 'Pass' || rv === 'Fail') passFail.unshift(rv);
        else if (/^\d+$/.test(rv) && parseInt(rv) <= 10 && cr === null) { cr = rv; continue; }
        else break;
      }
      if (cr) s.cr = cr;
      if (passFail.length >= 1) s.status = passFail[passFail.length - 1];
      if (passFail.length >= 2) s.thPass = passFail[0];

      const trailerLen = passFail.length + (cr ? 1 : 0);
      const core = trailerLen > 0 ? remaining.slice(0, remaining.length - trailerLen) : remaining;
      const digitCore = core.map((v, j) => /^\d+$/.test(v) ? [j, parseInt(v)] : null).filter(x => x);

      let totalMax = null, totalObt = null;
      for (let idx = digitCore.length - 1; idx >= 0; idx--) {
        const [j, v] = digitCore[idx];
        if (v >= 100) {
          for (let k = idx - 1; k >= 0; k--) {
            const [pj, pv] = digitCore[k];
            if (j - pj <= 3 && pv < v) { totalMax = v; totalObt = pv; break; }
          }
          if (!totalMax) { totalMax = v; }
          break;
        }
      }
      if (!totalMax) {
        const tem = v.totalExamMarks ? parseInt(parseFloat(v.totalExamMarks)) : null;
        if (tem) { totalMax = tem; totalObt = Math.max(...digitCore.map(x => x[1]).filter(x => x < tem)); }
      }
      if (totalMax) s.totalMax = String(totalMax);
      if (totalObt) s.totalObt = String(totalObt);
      if (totalMax && totalObt) s.totalPct = String(Math.round((totalObt / totalMax) * 100));

      subjects.push(s);
    }
  }
  return subjects;
}

function formatTg(student, type, email, fp, ip) {
  const label = `S26 ${type === 'backlog' ? 'Backlog' : 'Regular'} (CSV)`;
  const tag = email ? '\u{1F4E7} Contact Request' : '\u{1F50D} Checked';
  let msg = `<b>${tag} — ${label}</b>\n`;
  msg += `Dept: ${student.dept}\nRoll: <code>${student.roll}</code>\nName: ${student.name || '?'}\n`;
  msg += `SGPA: ${student.sgpa || '-'}\n`;
  for (const s of student.subjects) {
    if (type === 'backlog') {
      msg += `  \u2022 ${s.name}: ${s.th || '-'} ${s.thPass || '?'} \u00B7 ${s.total} ${s.pct}% ${s.status}\n`;
    } else {
      const fa = s.faTh || '-', sa = s.saTh || '-', th = s.th || '-';
      const fp_ = s.faPr || '-', sp = s.saPr || '-', sla_ = s.sla || '-';
      const tot = s.totalObt && s.totalMax ? `${s.totalObt}/${s.totalMax}` : '-';
      const pct = s.totalPct || '-';
      msg += `  \u2022 ${s.name}: ${fa}/${sa}/${th} \u00B7 PR ${fp_}/${sp} \u00B7 SLA ${sla_} \u00B7 ${tot} ${pct}% ${s.status}\n`;
    }
  }
  if (email) msg += `\n\u{1F4E7} Contact: ${email}`;
  msg += `\n\u{1F9FE} FP: <code>${fp || '?'}</code>\nIP: ${ip || '?'}`;
  return msg;
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
    : path.join(__dirname, '..', 'cwit_s26_regular_published_with_raw.csv');

  try {
    const text = fs.readFileSync(csvFile, 'utf-8');
    const parsed = parseCSV(text);
    const { rows } = parsed;

    const matches = rows.filter(r => r.RollNumber === roll && r.Department === deptName);

    if (!matches.length) {
      return res.status(200).json({ found: false, student: null, dept: deptName, debug: { totalRows: rows.length, totalLines: parsed.totalLines, mismatches: parsed.mismatchCount } });
    }

    const student = matches[0];
    let subjects = [];
    if (type === 'backlog') {
      for (let i = 1; i <= 9; i++) {
        const prefix = 'S' + i;
        const name = student[prefix + '_Name'];
        if (!name) continue;
        subjects.push({
          name, code: student[prefix + '_Code'] || '',
          th: student[prefix + '_TH'] || '', thPass: student[prefix + '_TH-Pass'] || '',
          total: student[prefix + '_Total'] || '', pct: student[prefix + '_Pct'] || '',
          status: student[prefix + '_Status'] || '', cr: student[prefix + '_CR'] || '',
          practicals: student[prefix + '_Practicals'] || '',
        });
      }
    } else {
      const raw = (student._raw_json || '').replace(/\r$/, '');
      subjects = parseRawSubjects(raw);
    }

    const result = {
      found: true,
      dept: student.Department,
      roll: student.RollNumber,
      name: student.StudentName || '',
      semester: student.Semester || '',
      sgpa: student.SGPA || '',
      resultStatus: student.resultStatus || '',
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
