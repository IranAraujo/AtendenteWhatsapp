import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined in environment variables for production security.');
}
const JWT_EXPIRES_IN = '7d';

export interface JwtUserPayload {
  userId: string;
  tenantId: string;
  role: string; professionalId?: string;
  email: string;
}

export function hashPassword(password: string): string {
  if (password.startsWith('$2a$') || password.startsWith('$2b$')) {
    return password; // Já está em hash
  }
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export function comparePassword(password: string, hash: string): boolean {
  if (!hash || !password) return false;
  if (!hash.startsWith('$2a$') && !hash.startsWith('$2b$')) {
    return password === hash || password.trim() === hash; // Fallback temporário para legado não migrado
  }
  return bcrypt.compareSync(password, hash) || bcrypt.compareSync(password.trim(), hash);
}

export function generateJwtToken(payload: JwtUserPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyJwtToken(token: string): JwtUserPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as JwtUserPayload;
    return decoded;
  } catch (err) {
    return null;
  }
}
