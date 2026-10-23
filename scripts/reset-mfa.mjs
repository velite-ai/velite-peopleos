// Server-side recovery: removes the authenticator of one login (for example after a lost phone), so that person can sign in
// with their password and set up a new one under Password & security. Run it on the server, e.g.
//   docker exec -i -e TARGET_EMAIL=person@velite.in web-t12xccwccugnf8hnjzfabydb sh -c 'cat > /app/q.mjs && node /app/q.mjs' < /opt/velite-deploy/src/scripts/reset-mfa.mjs
import p from 'postgres';
const sql = p(process.env.DATABASE_URL, { max: 1 });
const email = (process.env.TARGET_EMAIL || '').trim().toLowerCase();
if (!email) { console.log('Set TARGET_EMAIL to the login to reset.'); process.exit(1); }
const [user] = await sql`SELECT id,email,mfa_required FROM users WHERE email=${email}`;
if (!user) { console.log('No login with that email.'); process.exit(1); }
const removed = await sql.begin(async tx => {
  const rows = await tx`DELETE FROM user_mfa WHERE user_id=${user.id} RETURNING user_id`;
  await tx`UPDATE users SET mfa_required=false,updated_at=now() WHERE id=${user.id}`;
  await tx`DELETE FROM login_attempts WHERE email=${email} AND succeeded=false`;
  await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,reason) VALUES (NULL,'auth.mfa_reset_on_server','user',${user.id},'Authenticator removed from the server (recovery)')`;
  return rows.length;
});
console.log(removed ? `Authenticator removed for ${email}. They can sign in with the password and set up a new one.` : `${email} had no authenticator set up. Their sign-in code requirement was cleared.`);
process.exit(0);
