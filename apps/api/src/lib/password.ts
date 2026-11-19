import bcrypt from "bcryptjs";

const ROUNDS = 12;

// Compared against when the email doesn't exist, so a failed login takes
// the same time whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}
