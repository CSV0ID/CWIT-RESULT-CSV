const fs = require('fs');
const path = require('path');

const DEPT_MAP = {
  civil: 'Civil Engineering',
  electrical: 'Electrical Engineering',
  mechanical: 'Mechanical Engineering',
  etc: 'Electronics & Telecommunication Engineering',
  comp: 'Computer Engineering',
  comp_iot: 'Computer Engineering & IoT',
};

const DEPT_LABELS = {
  civil: 'Civil Engineering',
  electrical: 'Electrical Engineering',
  mechanical: 'Mechanical Engineering',
  etc: 'Electronics & Telecommunication Engineering',
  comp: 'Computer Engineering',
  comp_iot: 'Computer Engineering & IoT',
};

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

    const matches = rows.filter(r => {
      return r.RollNumber === roll && r.Department === deptName;
    });

    if (!matches.length) {
      return res.status(200).json({ found: false, student: null, dept: deptName });
    }

    const student = matches[0];
    // Parse subjects
    const subjects = [];
    for (let i = 1; i <= 9; i++) {
      const prefix = 'S' + i;
      const name = student[prefix + '_Name'];
      if (!name) continue;
      if (type === 'backlog') {
        subjects.push({
          name,
          code: student[prefix + '_Code'] || '',
          credits: student[prefix + '_Credits'] || '',
          th: student[prefix + '_TH'] || '',
          thPass: student[prefix + '_TH-Pass'] || '',
          total: student[prefix + '_Total'] || '',
          pct: student[prefix + '_Pct'] || '',
          status: student[prefix + '_Status'] || '',
          cr: student[prefix + '_CR'] || '',
          practicals: student[prefix + '_Practicals'] || '',
        });
      } else {
        subjects.push({
          name,
          code: student[prefix + '_Code'] || '',
          credits: student[prefix + '_Credits'] || '',
          faTh: student[prefix + '_FA-TH'] || '',
          saTh: student[prefix + '_SA-TH'] || '',
          thObt: student[prefix + '_TH-OBT'] || '',
          thMax: student[prefix + '_TH-MAX'] || '',
          thPct: student[prefix + '_TH-PCT'] || '',
          faPr: student[prefix + '_FA-PR'] || '',
          saPr: student[prefix + '_SA-PR'] || '',
          sla: student[prefix + '_SLA'] || '',
          totalObt: student[prefix + '_TOTAL-OBT'] || '',
          totalMax: student[prefix + '_TOTAL-MAX'] || '',
          totalPct: student[prefix + '_TOTAL-PCT'] || '',
          thPass: student[prefix + '_TH-Pass'] || '',
          thwgPass: student[prefix + '_THWG-Pass'] || '',
          faPrPass: student[prefix + '_FA-PR-Pass'] || '',
          saPrPass: student[prefix + '_SA-PR-Pass'] || '',
          slaPass: student[prefix + '_SLA-Pass'] || '',
          status: student[prefix + '_STATUS'] || '',
          cr: student[prefix + '_CR'] || '',
        });
      }
    }

    return res.status(200).json({
      found: true,
      dept: student.Department,
      roll: student.RollNumber,
      name: student.StudentName || student.studentName || '',
      year: student.Year || '',
      semester: student.Semester || student.Exam || '',
      sgpa: student.SGPA || '',
      resultStatus: student.resultStatus || student.ResultStatus || '',
      subjects,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
