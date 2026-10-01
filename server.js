const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashPin, generateToken, formatClassId } = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Check if public folder exists, or if files were uploaded directly to root
const hasPublicDir = fs.existsSync(path.join(__dirname, 'public', 'index.html'));
const publicPath = hasPublicDir ? path.join(__dirname, 'public') : __dirname;

app.use(express.static(publicPath));

// Route mappings so /css/style.css and /js/*.js work even when in root
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

// Constants
const GOAL_MINUTES = 4782; // 79 hours 42 minutes
const GOAL_PAGES = 7942;   // 7,942 pages

// Authentication middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const sessionStmt = db.prepare('SELECT class_id FROM sessions WHERE token = ?');
  const session = sessionStmt.get(token);

  if (!session) {
    return res.status(401).json({ error: '유효하지 않거나 만료된 세션입니다. 다시 로그인해 주세요.' });
  }

  const classStmt = db.prepare(`
    SELECT id, grade, class_number as classNumber, selected_missions as selectedMissions, 
           total_minutes as totalMinutes, total_pages as totalPages, created_at as createdAt
    FROM classes WHERE id = ?
  `);
  const currentClass = classStmt.get(session.class_id);

  if (!currentClass) {
    return res.status(401).json({ error: '학급 정보를 찾을 수 없습니다.' });
  }

  try {
    currentClass.selectedMissions = JSON.parse(currentClass.selectedMissions);
  } catch (e) {
    currentClass.selectedMissions = ['time', 'pages'];
  }

  req.currentClass = currentClass;
  req.sessionToken = token;
  next();
}

// 1. Get current logged in session info
app.get('/api/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ loggedIn: false });
  }

  const token = authHeader.substring(7).trim();
  const sessionStmt = db.prepare('SELECT class_id FROM sessions WHERE token = ?');
  const session = sessionStmt.get(token);

  if (!session) {
    return res.json({ loggedIn: false });
  }

  const classStmt = db.prepare(`
    SELECT id, grade, class_number as classNumber, selected_missions as selectedMissions, 
           total_minutes as totalMinutes, total_pages as totalPages, created_at as createdAt
    FROM classes WHERE id = ?
  `);
  const currentClass = classStmt.get(session.class_id);

  if (!currentClass) {
    return res.json({ loggedIn: false });
  }

  try {
    currentClass.selectedMissions = JSON.parse(currentClass.selectedMissions);
  } catch (e) {
    currentClass.selectedMissions = ['time', 'pages'];
  }

  res.json({
    loggedIn: true,
    class: currentClass
  });
});

// 2. Class registration
app.post('/api/classes/register', (req, res) => {
  const { grade, classNumber, pin, selectedMissions } = req.body;

  const g = parseInt(grade, 10);
  const c = parseInt(classNumber, 10);

  if (!g || g < 1 || g > 6) {
    return res.status(400).json({ error: '학년을 올바르게 선택해 주세요 (1~6학년).' });
  }

  if (!c || c < 1 || c > 30) {
    return res.status(400).json({ error: '반을 올바르게 입력해 주세요 (1~30반).' });
  }

  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ error: '학급 비밀번호는 숫자 4자리로 입력해 주세요.' });
  }

  if (!Array.isArray(selectedMissions) || selectedMissions.length === 0) {
    return res.status(400).json({ error: '참여할 미션을 최소 1개 이상 선택해 주세요.' });
  }

  const validMissions = selectedMissions.filter(m => m === 'time' || m === 'pages');
  if (validMissions.length === 0) {
    return res.status(400).json({ error: '올바른 미션을 선택해 주세요.' });
  }

  const classId = formatClassId(g, c);

  // Check if class already exists
  const existingStmt = db.prepare('SELECT id FROM classes WHERE id = ?');
  const existing = existingStmt.get(classId);

  if (existing) {
    return res.status(409).json({
      error: `이미 등록된 ${g}학년 ${c}반입니다. '우리 반으로 들어가기'에서 비밀번호를 입력해 주세요.`
    });
  }

  const insertClass = db.prepare(`
    INSERT INTO classes (id, grade, class_number, pin_hash, selected_missions, total_minutes, total_pages)
    VALUES (?, ?, ?, ?, ?, 0, 0)
  `);

  insertClass.run(
    classId,
    g,
    c,
    hashPin(String(pin)),
    JSON.stringify(validMissions)
  );

  const token = generateToken();
  const insertSession = db.prepare('INSERT INTO sessions (token, class_id) VALUES (?, ?)');
  insertSession.run(token, classId);

  res.json({
    ok: true,
    token,
    message: `${g}학년 ${c}반 등록이 완료되었습니다! 🎉`,
    class: {
      id: classId,
      grade: g,
      classNumber: c,
      selectedMissions: validMissions,
      totalMinutes: 0,
      totalPages: 0
    }
  });
});

// 3. Class login
app.post('/api/classes/login', (req, res) => {
  const { grade, classNumber, pin } = req.body;

  const g = parseInt(grade, 10);
  const c = parseInt(classNumber, 10);

  if (!g || !c) {
    return res.status(400).json({ error: '학년과 반을 올바르게 입력해 주세요.' });
  }

  if (!pin) {
    return res.status(400).json({ error: '4자리 학급 비밀번호를 입력해 주세요.' });
  }

  const classId = formatClassId(g, c);
  const classStmt = db.prepare(`
    SELECT id, grade, class_number as classNumber, pin_hash, selected_missions as selectedMissions, 
           total_minutes as totalMinutes, total_pages as totalPages, created_at as createdAt
    FROM classes WHERE id = ?
  `);
  const foundClass = classStmt.get(classId);

  if (!foundClass) {
    return res.status(404).json({
      error: `아직 등록되지 않은 ${g}학년 ${c}반입니다. '새 학급 등록하기'를 먼저 진행해 주세요!`
    });
  }

  if (foundClass.pin_hash !== hashPin(String(pin))) {
    return res.status(401).json({
      error: '학급 비밀번호(4자리)가 일치하지 않습니다. 다시 확인해 주세요!'
    });
  }

  const token = generateToken();
  const insertSession = db.prepare('INSERT INTO sessions (token, class_id) VALUES (?, ?)');
  insertSession.run(token, classId);

  let selectedMissions = ['time', 'pages'];
  try {
    selectedMissions = JSON.parse(foundClass.selectedMissions);
  } catch (e) {}

  res.json({
    ok: true,
    token,
    message: `반가워요! ${g}학년 ${c}반으로 입장했습니다. 📚`,
    class: {
      id: classId,
      grade: g,
      classNumber: c,
      selectedMissions,
      totalMinutes: foundClass.totalMinutes,
      totalPages: foundClass.totalPages
    }
  });
});

// 4. Class logout
app.post('/api/classes/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
    deleteSession.run(token);
  }
  res.json({ ok: true, message: '로그아웃 되었습니다.' });
});

// 5. Get current class details and recent records (Requires auth)
app.get('/api/my-class', authenticate, (req, res) => {
  const currentClass = req.currentClass;

  const recordsStmt = db.prepare(`
    SELECT id, class_id as classId, type, amount, book_title as bookTitle, student_name as studentName, created_at as createdAt
    FROM records
    WHERE class_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 50
  `);
  const records = recordsStmt.all(currentClass.id);

  res.json({
    class: currentClass,
    records,
    goals: {
      time: GOAL_MINUTES,
      pages: GOAL_PAGES
    }
  });
});

// 6. Record reading time or pages (STRICT AUTHENTICATION & CLASS ISOLATION)
app.post('/api/records', authenticate, (req, res) => {
  const currentClass = req.currentClass;
  const { type, amount, bookTitle, studentName } = req.body;

  if (type !== 'time' && type !== 'pages') {
    return res.status(400).json({ error: '기록 종류는 독서 시간(time) 또는 쪽수(pages)여야 합니다.' });
  }

  const amt = parseInt(amount, 10);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: '1 이상의 올바른 숫자를 입력해 주세요.' });
  }

  // Reasonableness safeguard check
  if (type === 'time' && amt > 1440) { // more than 24 hours in one shot
    return res.status(400).json({ error: '한 번에 1,440분(24시간)을 초과하여 기록할 수 없습니다.' });
  }
  if (type === 'pages' && amt > 10000) {
    return res.status(400).json({ error: '한 번에 10,000쪽을 초과하여 기록할 수 없습니다.' });
  }

  // Ensure this class is participating in this mission
  let missions = currentClass.selectedMissions;
  if (!missions.includes(type)) {
    missions.push(type);
    const updateMissions = db.prepare('UPDATE classes SET selected_missions = ? WHERE id = ?');
    updateMissions.run(JSON.stringify(missions), currentClass.id);
    currentClass.selectedMissions = missions;
  }

  const sanitizedBookTitle = bookTitle ? String(bookTitle).trim().substring(0, 60) : '재미있는 책';
  const sanitizedName = studentName ? String(studentName).trim().substring(0, 20) : null;
  const recordId = crypto.randomUUID();

  // Insert record strictly linked to req.currentClass.id
  const insertRecord = db.prepare(`
    INSERT INTO records (id, class_id, type, amount, book_title, student_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertRecord.run(recordId, currentClass.id, type, amt, sanitizedBookTitle, sanitizedName);

  // Update class total
  if (type === 'time') {
    const updateMinutes = db.prepare('UPDATE classes SET total_minutes = total_minutes + ? WHERE id = ?');
    updateMinutes.run(amt, currentClass.id);
  } else {
    const updatePages = db.prepare('UPDATE classes SET total_pages = total_pages + ? WHERE id = ?');
    updatePages.run(amt, currentClass.id);
  }

  // Fetch updated class
  const classStmt = db.prepare(`
    SELECT id, grade, class_number as classNumber, selected_missions as selectedMissions, 
           total_minutes as totalMinutes, total_pages as totalPages
    FROM classes WHERE id = ?
  `);
  const updatedClass = classStmt.get(currentClass.id);
  try {
    updatedClass.selectedMissions = JSON.parse(updatedClass.selectedMissions);
  } catch (e) {}

  res.json({
    ok: true,
    message: type === 'time' 
      ? `「${sanitizedBookTitle}」 ${amt}분의 독서 시간이 기록되었습니다! 📚` 
      : `「${sanitizedBookTitle}」 ${amt}쪽의 독서 기록이 추가되었습니다! 📖`,
    record: {
      id: recordId,
      classId: currentClass.id,
      type,
      amount: amt,
      bookTitle: sanitizedBookTitle,
      studentName: sanitizedName,
      createdAt: new Date().toISOString()
    },
    updatedClass
  });
});

// 7. Delete record (STRICT AUTHENTICATION - CAN ONLY DELETE OWN CLASS'S RECORD)
app.delete('/api/records/:id', authenticate, (req, res) => {
  const currentClass = req.currentClass;
  const { id } = req.params;

  // Verify the record exists and belongs to the authenticated class
  const recordStmt = db.prepare('SELECT id, class_id, type, amount FROM records WHERE id = ?');
  const record = recordStmt.get(id);

  if (!record) {
    return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
  }

  if (record.class_id !== currentClass.id) {
    return res.status(403).json({ error: '다른 학급의 기록은 삭제할 수 없습니다!' });
  }

  // Delete record
  const deleteStmt = db.prepare('DELETE FROM records WHERE id = ?');
  deleteStmt.run(id);

  // Deduct from class total
  if (record.type === 'time') {
    const deductMinutes = db.prepare('UPDATE classes SET total_minutes = MAX(0, total_minutes - ?) WHERE id = ?');
    deductMinutes.run(record.amount, currentClass.id);
  } else {
    const deductPages = db.prepare('UPDATE classes SET total_pages = MAX(0, total_pages - ?) WHERE id = ?');
    deductPages.run(record.amount, currentClass.id);
  }

  // Fetch updated class
  const classStmt = db.prepare(`
    SELECT id, grade, class_number as classNumber, selected_missions as selectedMissions, 
           total_minutes as totalMinutes, total_pages as totalPages
    FROM classes WHERE id = ?
  `);
  const updatedClass = classStmt.get(currentClass.id);
  try {
    updatedClass.selectedMissions = JSON.parse(updatedClass.selectedMissions);
  } catch (e) {}

  res.json({
    ok: true,
    message: '기록이 성공적으로 취소/삭제되었습니다.',
    updatedClass
  });
});

// 8. Public school-wide status (Read-only, sanitized, no editing capabilities)
app.get('/api/public/classes', (req, res) => {
  const classesStmt = db.prepare(`
    SELECT id, grade, class_number as classNumber, selected_missions as selectedMissions, 
           total_minutes as totalMinutes, total_pages as totalPages, created_at as createdAt
    FROM classes
    ORDER BY grade ASC, class_number ASC
  `);
  const rawClasses = classesStmt.all();

  let schoolTotalMinutes = 0;
  let schoolTotalPages = 0;

  const classes = rawClasses.map(c => {
    let missions = ['time', 'pages'];
    try {
      missions = JSON.parse(c.selectedMissions);
    } catch (e) {}

    schoolTotalMinutes += c.totalMinutes;
    schoolTotalPages += c.totalPages;

    const isTimeCompleted = missions.includes('time') && c.totalMinutes >= GOAL_MINUTES;
    const isPagesCompleted = missions.includes('pages') && c.totalPages >= GOAL_PAGES;
    const isDoubleCompleted = isTimeCompleted && isPagesCompleted;

    const timePercentage = missions.includes('time') 
      ? Math.min(100, (c.totalMinutes / GOAL_MINUTES) * 100) 
      : null;
    const pagesPercentage = missions.includes('pages') 
      ? Math.min(100, (c.totalPages / GOAL_PAGES) * 100) 
      : null;

    return {
      id: c.id,
      grade: c.grade,
      classNumber: c.classNumber,
      selectedMissions: missions,
      totalMinutes: c.totalMinutes,
      totalPages: c.totalPages,
      timePercentage: timePercentage !== null ? Number(timePercentage.toFixed(1)) : null,
      pagesPercentage: pagesPercentage !== null ? Number(pagesPercentage.toFixed(1)) : null,
      isTimeCompleted,
      isPagesCompleted,
      isDoubleCompleted
    };
  });

  // Calculate school-wide hours and minutes
  const schoolHours = Math.floor(schoolTotalMinutes / 60);
  const schoolRemMinutes = schoolTotalMinutes % 60;

  res.json({
    classes,
    schoolSummary: {
      totalClasses: classes.length,
      schoolTotalMinutes,
      schoolHours,
      schoolRemMinutes,
      schoolTotalPages,
      goalMinutes: GOAL_MINUTES,
      goalPages: GOAL_PAGES
    }
  });
});

// 9. Admin API: Verify admin password
const ADMIN_KEY = process.env.ADMIN_KEY || 'daeyang7942';

app.post('/api/admin/verify', (req, res) => {
  const { key } = req.body || {};
  if (key === ADMIN_KEY) {
    return res.json({ ok: true, message: '선생님/관리자 모드가 인증되었습니다.' });
  }
  return res.status(401).json({ error: '관리자 비밀번호가 일치하지 않습니다.' });
});

// 10. Admin API: Delete a class and all associated data
app.delete('/api/admin/classes/:id', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: '관리자 권한이 없습니다.' });
  }

  const classId = req.params.id;
  const classStmt = db.prepare('SELECT id, grade, class_number as classNumber FROM classes WHERE id = ?');
  const target = classStmt.get(classId);

  if (!target) {
    return res.status(404).json({ error: '삭제할 학급을 찾을 수 없습니다.' });
  }

  // Delete all records and sessions for this class
  db.prepare('DELETE FROM records WHERE class_id = ?').run(classId);
  db.prepare('DELETE FROM sessions WHERE class_id = ?').run(classId);
  db.prepare('DELETE FROM classes WHERE id = ?').run(classId);

  res.json({
    ok: true,
    message: `${target.grade}학년 ${target.classNumber}반이 성공적으로 삭제되었습니다.`
  });
});

// Fallback to index.html for SPA
app.use((req, res) => {
  const indexPath = hasPublicDir ? path.join(__dirname, 'public', 'index.html') : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`「7942 학급 독서 미션」 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
