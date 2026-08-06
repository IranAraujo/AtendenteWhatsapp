import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'saas_atendente_jwt_secret_key_2026_super_secure';
const JWT_EXPIRES_IN = '7d';

export interface JwtUserPayload {
  userId: string;
  tenantId: string;
  role: string;
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
  if (!hash) return false;
  if (!hash.startsWith('$2a$') && !hash.startsWith('$2b$')) {
    return password === hash; // Fallback temporário para legado não migrado
  }
  return bcrypt.compareSync(password, hash);
}

export function generateJwtToken(payload: JwtUserPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyJwtToken(token: string): JwtUserPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtUserPayload;
    return decoded;
  } catch (err) {
    return null;
  }
}
