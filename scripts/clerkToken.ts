import 'dotenv/config';
import { clerkClient } from '@clerk/express';

async function main() {
  const userId = process.argv[2];
  const template = process.argv[3]; // optional JWT template for a longer-lived token

  if (!userId) {
    console.error('Usage: npm run clerk:token -- <clerkUserId> [jwtTemplateName]');
    process.exit(1);
  }

  const session = await clerkClient.sessions.createSession({ userId });
  const { jwt } = await clerkClient.sessions.getToken(session.id, template);

  console.log('\nBearer token:\n');
  console.log(jwt);
  console.log('\nExample request:\n');
  console.log(`curl http://localhost:3001/api/v1/users/me -H "Authorization: Bearer ${jwt}"`);
  if (!template) {
    console.log('\nNote: default session tokens expire in ~60s. Re-run to mint a fresh one,');
    console.log(
      'or create a JWT template in the Clerk dashboard and pass its name as the 2nd arg for a longer-lived token.',
    );
  }
}

main().catch((err) => {
  console.error('Failed to mint token:', err);
  process.exit(1);
});
