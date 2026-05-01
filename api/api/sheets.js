import { createSign } from 'crypto';

async function getAccessToken() {
  const SA_EMAIL = process.env.SA_EMAIL;
  const SA_KEY = process.env.SA_PRIVATE_KEY.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })).toString('base64url');

  const msg = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(msg);
  const signature = sign.sign(SA_KEY, 'base64url');
  const jwt = `${msg}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { columns, rows, sheetId } = req.body;

  try {
    const token = await getAccessToken();

    const getRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:A1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const getData = await getRes.json();
    const hasHeaders = getData.values && getData.values.length > 0;

    const values = [];
    if (!hasHeaders) values.push(columns);
    for (const row of rows) {
      values.push(columns.map(c => row[c] ?? ''));
    }

    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    const appendData = await appendRes.json();
    if (appendData.error) return res.status(500).json({ error: appendData.error.message });

    res.status(200).json({ success: true, updated: appendData.updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
