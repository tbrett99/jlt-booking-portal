import https from 'https';

const token = process.env.GOCARDLESS_ACCESS_TOKEN;
const env = process.env.GOCARDLESS_ENVIRONMENT;

console.log('Token set:', !!token, '| Env:', env);

const options = {
  hostname: 'api.gocardless.com',
  path: '/creditors',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'GoCardless-Version': '2015-07-06',
    'Accept': 'application/json',
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (d) => (data += d));
  res.on('end', () => {
    if (res.statusCode === 200) {
      const parsed = JSON.parse(data);
      console.log('SUCCESS - Creditor:', parsed.creditors?.[0]?.name ?? 'found');
    } else {
      console.log('ERROR', res.statusCode, data);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

req.end();
