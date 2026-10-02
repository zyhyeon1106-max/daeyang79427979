const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pool, initDb, hashPin, generateToken, formatClassId } = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const hasPublicDir = fs.existsSync(path.join(__dirname, 'public', 'index.html'));
const publicPath = hasPublicDir ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(publicPath));

app.get('/css/style.css', (req, res) => {
  const p = hasPublicDir ? path.join(__dirname, 'public', 'css', 'style.css') : path.join(__dirname, 'style.css');
  res.sendFile(p);
});
app.get('/js/app.js', (req, res) => {
  const p = hasPublicDir ? path.join(__dirname, 'public', 'js', 'app.js') : path.join(__dirname, 'app.js');
  res.sendFile(p);
});
app.get('/js/confetti.js', (req, res) => {
  const p = hasPublicDir ? path.join(__dirname, 'public', 'js', 'confetti.js') : path.join(__dirname, 'confetti.js');
  res.sendFile(p);
});

const GOAL_MINUTES = 4782;
const GOAL_PAGES = 7942;

function normalizeClass(row) {
  if (!row) return null;
  return {
    id: row.id,
    grade: row.grade,
    classNumber: row.class_number,
    selectedMissions: Array.isArray(row.selected_missions) ? row.selected_missions : ['time', 'pages'],
    totalMinutes: row.total_minutes,
    totalPages: row.total_pages,
    createdAt: row.created_at
  };
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : null;

    if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const result = await pool.query(`
      SELECT c.*
      FROM sessions s
      JOIN classes c ON c.id = s.class_id
      WHERE s.token = $1
      LIMIT 1
    `, [token]);

    if (!result.rows[0]) {
      return res.status(401).json({ error: '유효하지 않거나 만료된 세션입니다. 다시 로그인해 주세요.' });
    }

    req.currentClass = normalizeClass(result.rows[0]);
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

app.get('/api/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.json({ loggedIn: false });

    const token = authHeader.substring(7).trim();
    const result = await pool.query(`
      SELECT c.*
      FROM sessions s
      JOIN classes c ON c.id = s.class_id
      WHERE s.token = $1
      LIMIT 1
    `, [token]);

    if (!result.rows[0]) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, class: normalizeClass(result.rows[0]) });
  } catch (err) { next(err); }
});

app.post('/api/classes/register', async (req, res, next) => {
  const { grade, classNumber, pin, selectedMissions } = req.body;
  const g = parseInt(grade, 10);
  const c = parseInt(classNumber, 10);

  if (!g || g < 1 || g > 6) return res.status(400).json({ error: '학년을 올바르게 선택해 주세요 (1~6학년).' });
  if (!c || c < 1 || c > 30) return res.status(400).json({ error: '반을 올바르게 입력해 주세요 (1~30반).' });
  if (!pin || !/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: '학급 비밀번호는 숫자 4자리로 입력해 주세요.' });
  if (!Array.isArray(selectedMissions) || selectedMissions.length === 0) return res.status(400).json({ error: '참여할 미션을 최소 1개 이상 선택해 주세요.' });

  const validMissions = [...new Set(selectedMissions.filter(m => m === 'time' || m === 'pages'))];
  if (validMissions.length === 0) return res.status(400).json({ error: '올바른 미션을 선택해 주세요.' });

  const classId = formatClassId(g, c);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM classes WHERE id = $1', [classId]);
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `이미 등록된 ${g}학년 ${c}반입니다. '우리 반으로 들어가기'에서 비밀번호를 입력해 주세요.` });
    }

    await client.query(`
      INSERT INTO classes (id, grade, class_number, pin_hash, selected_missions, total_minutes, total_pages)
      VALUES ($1, $2, $3, $4, $5::jsonb, 0, 0)
    `, [classId, g, c, hashPin(String(pin)), JSON.stringify(validMissions)]);

    const token = generateToken();
    await client.query('INSERT INTO sessions (token, class_id) VALUES ($1, $2)', [token, classId]);
    await client.query('COMMIT');

    res.json({
      ok: true,
      token,
      message: `${g}학년 ${c}반 등록이 완료되었습니다! 🎉`,
      class: { id: classId, grade: g, classNumber: c, selectedMissions: validMissions, totalMinutes: 0, totalPages: 0 }
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: `이미 등록된 ${g}학년 ${c}반입니다.` });
    next(err);
  } finally { client.release(); }
});

app.post('/api/classes/login', async (req, res, next) => {
  try {
    const { grade, classNumber, pin } = req.body;
    const g = parseInt(grade, 10);
    const c = parseInt(classNumber, 10);
    if (!g || !c) return res.status(400).json({ error: '학년과 반을 올바르게 입력해 주세요.' });
    if (!pin) return res.status(400).json({ error: '4자리 학급 비밀번호를 입력해 주세요.' });

    const classId = formatClassId(g, c);
    const result = await pool.query('SELECT * FROM classes WHERE id = $1 LIMIT 1', [classId]);
    const foundClass = result.rows[0];
    if (!foundClass) return res.status(404).json({ error: `아직 등록되지 않은 ${g}학년 ${c}반입니다. '새 학급 등록하기'를 먼저 진행해 주세요!` });
    if (foundClass.pin_hash !== hashPin(String(pin))) return res.status(401).json({ error: '학급 비밀번호(4자리)가 일치하지 않습니다. 다시 확인해 주세요!' });

    const token = generateToken();
    await pool.query('INSERT INTO sessions (token, class_id) VALUES ($1, $2)', [token, classId]);

    res.json({ ok: true, token, message: `반가워요! ${g}학년 ${c}반으로 입장했습니다. 📚`, class: normalizeClass(foundClass) });
  } catch (err) { next(err); }
});

app.post('/api/classes/logout', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [authHeader.substring(7).trim()]);
    }
    res.json({ ok: true, message: '로그아웃 되었습니다.' });
  } catch (err) { next(err); }
});

app.get('/api/my-class', authenticate, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, class_id AS "classId", type, amount, book_title AS "bookTitle",
             student_name AS "studentName", created_at AS "createdAt"
      FROM records
      WHERE class_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.currentClass.id]);

    res.json({ class: req.currentClass, records: result.rows, goals: { time: GOAL_MINUTES, pages: GOAL_PAGES } });
  } catch (err) { next(err); }
});

app.post('/api/records', authenticate, async (req, res, next) => {
  const currentClass = req.currentClass;
  const { type, amount, bookTitle, studentName } = req.body;

  if (type !== 'time' && type !== 'pages') return res.status(400).json({ error: '기록 종류는 독서 시간(time) 또는 쪽수(pages)여야 합니다.' });
  const amt = parseInt(amount, 10);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: '1 이상의 올바른 숫자를 입력해 주세요.' });
  if (type === 'time' && amt > 1440) return res.status(400).json({ error: '한 번에 1,440분(24시간)을 초과하여 기록할 수 없습니다.' });
  if (type === 'pages' && amt > 10000) return res.status(400).json({ error: '한 번에 10,000쪽을 초과하여 기록할 수 없습니다.' });

  const sanitizedBookTitle = bookTitle ? String(bookTitle).trim().substring(0, 60) : '재미있는 책';
  const sanitizedName = studentName ? String(studentName).trim().substring(0, 20) : null;
  const recordId = crypto.randomUUID();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!currentClass.selectedMissions.includes(type)) {
      const missions = [...new Set([...currentClass.selectedMissions, type])];
      await client.query('UPDATE classes SET selected_missions = $1::jsonb WHERE id = $2', [JSON.stringify(missions), currentClass.id]);
    }

    await client.query(`
      INSERT INTO records (id, class_id, type, amount, book_title, student_name)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [recordId, currentClass.id, type, amt, sanitizedBookTitle, sanitizedName]);

    const update = type === 'time'
      ? await client.query('UPDATE classes SET total_minutes = total_minutes + $1 WHERE id = $2 RETURNING *', [amt, currentClass.id])
      : await client.query('UPDATE classes SET total_pages = total_pages + $1 WHERE id = $2 RETURNING *', [amt, currentClass.id]);

    await client.query('COMMIT');
    const updatedClass = normalizeClass(update.rows[0]);

    res.json({
      ok: true,
      message: type === 'time' ? `「${sanitizedBookTitle}」 ${amt}분의 독서 시간이 기록되었습니다! 📚` : `「${sanitizedBookTitle}」 ${amt}쪽의 독서 기록이 추가되었습니다! 📖`,
      record: { id: recordId, classId: currentClass.id, type, amount: amt, bookTitle: sanitizedBookTitle, studentName: sanitizedName, createdAt: new Date().toISOString() },
      updatedClass
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client.release(); }
});

app.delete('/api/records/:id', authenticate, async (req, res, next) => {
  const currentClass = req.currentClass;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT id, class_id, type, amount FROM records WHERE id = $1 FOR UPDATE', [req.params.id]);
    const record = result.rows[0];
    if (!record) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
    }
    if (record.class_id !== currentClass.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '다른 학급의 기록은 삭제할 수 없습니다!' });
    }

    await client.query('DELETE FROM records WHERE id = $1', [record.id]);
    const update = record.type === 'time'
      ? await client.query('UPDATE classes SET total_minutes = GREATEST(0, total_minutes - $1) WHERE id = $2 RETURNING *', [record.amount, currentClass.id])
      : await client.query('UPDATE classes SET total_pages = GREATEST(0, total_pages - $1) WHERE id = $2 RETURNING *', [record.amount, currentClass.id]);

    await client.query('COMMIT');
    res.json({ ok: true, message: '기록이 성공적으로 취소/삭제되었습니다.', updatedClass: normalizeClass(update.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client.release(); }
});

app.get('/api/public/classes', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM classes ORDER BY grade ASC, class_number ASC');
    let schoolTotalMinutes = 0;
    let schoolTotalPages = 0;

    const classes = result.rows.map(row => {
      const c = normalizeClass(row);
      const missions = c.selectedMissions;
      schoolTotalMinutes += c.totalMinutes;
      schoolTotalPages += c.totalPages;

      const isTimeCompleted = missions.includes('time') && c.totalMinutes >= GOAL_MINUTES;
      const isPagesCompleted = missions.includes('pages') && c.totalPages >= GOAL_PAGES;
      const isDoubleCompleted = isTimeCompleted && isPagesCompleted;
      const timePercentage = missions.includes('time') ? Math.min(100, (c.totalMinutes / GOAL_MINUTES) * 100) : null;
      const pagesPercentage = missions.includes('pages') ? Math.min(100, (c.totalPages / GOAL_PAGES) * 100) : null;

      return {
        id: c.id, grade: c.grade, classNumber: c.classNumber, selectedMissions: missions,
        totalMinutes: c.totalMinutes, totalPages: c.totalPages,
        timePercentage: timePercentage !== null ? Number(timePercentage.toFixed(1)) : null,
        pagesPercentage: pagesPercentage !== null ? Number(pagesPercentage.toFixed(1)) : null,
        isTimeCompleted, isPagesCompleted, isDoubleCompleted
      };
    });

    res.json({
      classes,
      schoolSummary: {
        totalClasses: classes.length,
        schoolTotalMinutes,
        schoolHours: Math.floor(schoolTotalMinutes / 60),
        schoolRemMinutes: schoolTotalMinutes % 60,
        schoolTotalPages,
        goalMinutes: GOAL_MINUTES,
        goalPages: GOAL_PAGES
      }
    });
  } catch (err) { next(err); }
});

const ADMIN_KEY = process.env.ADMIN_KEY || 'daeyang7942';

app.post('/api/admin/verify', (req, res) => {
  const { key } = req.body || {};
  if (key === ADMIN_KEY) return res.json({ ok: true, message: '선생님/관리자 모드가 인증되었습니다.' });
  return res.status(401).json({ error: '관리자 비밀번호가 일치하지 않습니다.' });
});

app.delete('/api/admin/classes/:id', async (req, res, next) => {
  try {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) return res.status(403).json({ error: '관리자 권한이 없습니다.' });

    const result = await pool.query('DELETE FROM classes WHERE id = $1 RETURNING grade, class_number', [req.params.id]);
    const target = result.rows[0];
    if (!target) return res.status(404).json({ error: '삭제할 학급을 찾을 수 없습니다.' });

    res.json({ ok: true, message: `${target.grade}학년 ${target.class_number}반이 성공적으로 삭제되었습니다.` });
  } catch (err) { next(err); }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'postgresql' });
  } catch (err) {
    res.status(500).json({ ok: false, database: 'disconnected' });
  }
});

app.use((req, res) => {
  const indexPath = hasPublicDir ? path.join(__dirname, 'public', 'index.html') : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
});

async function start() {
  try {
    await initDb();
    await pool.query('SELECT 1');
    app.listen(PORT, () => {
      console.log(`「7942 학급 독서 미션」 서버가 포트 ${PORT}에서 실행 중입니다.`);
      console.log('[DB] Supabase PostgreSQL 연결 완료 — 기록은 Render 재시작 후에도 유지됩니다.');
    });
  } catch (err) {
    console.error('[STARTUP ERROR] Supabase PostgreSQL 연결에 실패했습니다.', err);
    process.exit(1);
  }
}

start();
