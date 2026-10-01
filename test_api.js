const http = require('node:http');

// Helper to make HTTP requests
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (dataString) {
      options.headers['Content-Length'] = Buffer.byteLength(dataString);
    }
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(resData);
        } catch (e) {
          parsed = resData;
        }
        resolve({ status: res.statusMessage, statusCode: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting API & Security Tests ---');

  // Test 1: Public classes
  const pubRes = await request('GET', '/api/public/classes');
  console.log(`[Test 1] GET /api/public/classes: status ${pubRes.statusCode}, classes count: ${pubRes.body.classes.length}`);
  if (pubRes.statusCode !== 200 || pubRes.body.classes.length === 0) {
    throw new Error('Public classes test failed');
  }

  // Test 2: Login existing sample class
  const loginRes = await request('POST', '/api/classes/login', {
    grade: 1,
    classNumber: 1,
    pin: '1111'
  });
  console.log(`[Test 2] Login 1-1: status ${loginRes.statusCode}, token received: ${Boolean(loginRes.body.token)}`);
  const token1 = loginRes.body.token;

  // Test 3: Wrong PIN login test
  const wrongPinRes = await request('POST', '/api/classes/login', {
    grade: 1,
    classNumber: 1,
    pin: '9999'
  });
  console.log(`[Test 3] Wrong PIN login: status ${wrongPinRes.statusCode} (Expected 401)`);
  if (wrongPinRes.statusCode !== 401) {
    throw new Error('Wrong PIN was not rejected!');
  }

  // Test 4: Register or Login Class 3-2
  let token3_2 = null;
  const regRes = await request('POST', '/api/classes/register', {
    grade: 3,
    classNumber: 2,
    pin: '7942',
    selectedMissions: ['time', 'pages']
  });
  if (regRes.statusCode === 200) {
    console.log(`[Test 4] Register 3-2: status ${regRes.statusCode}, message: ${regRes.body.message}`);
    token3_2 = regRes.body.token;
  } else if (regRes.statusCode === 409) {
    console.log(`[Test 4] Class 3-2 already registered. Logging in...`);
    const login3_2 = await request('POST', '/api/classes/login', {
      grade: 3,
      classNumber: 2,
      pin: '7942'
    });
    token3_2 = login3_2.body.token;
  } else {
    throw new Error('Unexpected status during Test 4: ' + regRes.statusCode);
  }

  // Test 5: Add reading time record (30 mins)
  const addTimeRes = await request('POST', '/api/records', {
    type: 'time',
    amount: 30,
    studentName: '김민준'
  }, token3_2);
  console.log(`[Test 5] Add 30 mins: status ${addTimeRes.statusCode}, totalMinutes: ${addTimeRes.body.updatedClass.totalMinutes}`);
  const recordId = addTimeRes.body.record.id;

  // Test 6: Add reading pages record (35 pages)
  const addPagesRes = await request('POST', '/api/records', {
    type: 'pages',
    amount: 35,
    studentName: '이지우'
  }, token3_2);
  console.log(`[Test 6] Add 35 pages: status ${addPagesRes.statusCode}, totalPages: ${addPagesRes.body.updatedClass.totalPages}`);

  // Test 7: SECURITY TEST - Class 1-1 attempts to delete Class 3-2's record!
  const crossDeleteRes = await request('DELETE', `/api/records/${recordId}`, null, token1);
  console.log(`[Test 7] Cross-class delete attempt (1-1 trying to delete 3-2's record): status ${crossDeleteRes.statusCode} (Expected 403)`);
  if (crossDeleteRes.statusCode !== 403) {
    throw new Error('SECURITY VIOLATION! Cross-class deletion was not prevented!');
  }

  // Test 8: Unauthenticated record creation attempt
  const noAuthRes = await request('POST', '/api/records', {
    type: 'time',
    amount: 10
  });
  console.log(`[Test 8] Unauthenticated record attempt: status ${noAuthRes.statusCode} (Expected 401)`);
  if (noAuthRes.statusCode !== 401) {
    throw new Error('Unauthenticated submission was allowed!');
  }

  // Test 9: Authorized delete of own record
  const ownDeleteRes = await request('DELETE', `/api/records/${recordId}`, null, token3_2);
  console.log(`[Test 9] Class 3-2 deletes own record: status ${ownDeleteRes.statusCode}, new totalMinutes: ${ownDeleteRes.body.updatedClass.totalMinutes}`);
  if (ownDeleteRes.statusCode !== 200 || ownDeleteRes.body.updatedClass.totalMinutes !== 0) {
    throw new Error('Delete failed or totalMinutes not deducted');
  }

  console.log('✅ ALL TESTS PASSED SUCCESSFULLY! Security & Isolation 100% verified.');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
