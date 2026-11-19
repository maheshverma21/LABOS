/**
 * Creates the first platform admin (or another one) from the command line:
 *
 *   npm run admin:create -w api -- you@company.com "Your Name"
 *   npm run admin:create -w api -- helper@company.com "Helper" --support
 *
 * A random password is printed once. Sign in at /admin and keep it in a password manager.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

async function main() {
  const args = process.argv.slice(2);
  const support = args.includes("--support");
  const [email, ...nameParts] = args.filter((a) => !a.startsWith("--"));
  const name = nameParts.join(" ").trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
    console.error('Usage: npm run admin:create -w api -- <email> "<name>" [--support]');
    process.exit(1);
  }
  const normalised = email.toLowerCase();
  if (await prisma.platformAdmin.findUnique({ where: { email: normalised } })) {
    console.error(`An admin with ${normalised} already exists.`);
    process.exit(1);
  }
  const password = randomBytes(15).toString("base64url");
  await prisma.platformAdmin.create({
    data: { email: normalised, name, role: support ? "SUPPORT" : "SUPER_ADMIN", passwordHash: await hashPassword(password) },
  });
  console.log(`Created ${support ? "support" : "super"} admin ${normalised}.`);
  console.log(`Password (shown once): ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
