import { createHmac } from 'crypto';

const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
console.log('GOCARDLESS_WEBHOOK_SECRET set:', !!secret, '| length:', secret?.length ?? 0);

if (secret) {
  const testPayload = JSON.stringify({ events: [] });
  const sig = createHmac('sha256', secret).update(testPayload).digest('hex');
  console.log('HMAC test signature generated successfully (length:', sig.length, ')');
  console.log('Webhook verification: READY');
  process.exit(0);
} else {
  console.log('WARNING: Secret not set');
  process.exit(1);
}
